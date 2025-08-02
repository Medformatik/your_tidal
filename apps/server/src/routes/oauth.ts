import { Request, Response, Router } from "express";
import { sign } from "jsonwebtoken";
import { z } from "zod";
import {
  createUser,
  getUserCount,
  getUserFromField,
  storeInUser,
} from "../database";
import { get, getWithDefault } from "../tools/env";
import { logger } from "../tools/logger";
import {
  logged,
  validate,
  withGlobalPreferences,
  withHttpClient,
} from "../tools/middleware";
import { TIDAL } from "../tools/oauth/Provider";
import { GlobalPreferencesRequest, TIDALRequest } from "../tools/types";
import { getPrivateData } from "../database/queries/privateData";

export const router = Router();

function storeTokenInCookie(
  request: Request,
  response: Response,
  token: string,
) {
  response.cookie("token", token, {
    sameSite: "strict",
    httpOnly: true,
    secure: request.secure,
  });
}

const OAUTH_COOKIE_NAME = "oauth";
const tidalCallbackOAuthCookie = z.object({
  state: z.string(),
});
type OAuthCookie = z.infer<typeof tidalCallbackOAuthCookie>;

router.get("/tidal", async (req, res) => {
  const isOffline = get("OFFLINE_DEV_ID");
  if (isOffline) {
    const privateData = await getPrivateData();
    if (!privateData?.jwtPrivateKey) {
      throw new Error("No private data found, cannot sign JWT");
    }
    const token = sign({ userId: isOffline }, privateData.jwtPrivateKey, {
      expiresIn: getWithDefault("COOKIE_VALIDITY_MS", "1h") as `${number}`,
    });
    storeTokenInCookie(req, res, token);
    res.status(204).end();
    return;
  }
  const { url, state } = await TIDAL.getRedirect();
  const oauthCookie: OAuthCookie = {
    state,
  };

  res.cookie(OAUTH_COOKIE_NAME, oauthCookie, {
    sameSite: "lax",
    httpOnly: true,
    secure: req.secure,
  });

  res.redirect(url);
});

const tidalCallback = z.object({
  code: z.string(),
  state: z.string(),
});

router.get("/tidal/callback", withGlobalPreferences, async (req, res) => {
  const { query, globalPreferences } = req as GlobalPreferencesRequest;
  const { code, state } = validate(query, tidalCallback);

  try {
    const cookie = tidalCallbackOAuthCookie.parse(
      req.cookies[OAUTH_COOKIE_NAME],
    );

    if (state !== cookie.state) {
      throw new Error("State does not match");
    }

    const infos = await TIDAL.exchangeCode(code, cookie.state);

    const client = TIDAL.getHttpClient(infos.accessToken);
    const { data: tidalMe } = await client.get("/v2/me");
    let user = await getUserFromField("tidalId", tidalMe.data.id, false);
    if (!user) {
      if (!globalPreferences.allowRegistrations) {
        return res.redirect(`${get("CLIENT_ENDPOINT")}/registrations-disabled`);
      }
      const nbUsers = await getUserCount();
      user = await createUser(
        tidalMe.data.attributes.username || tidalMe.data.attributes.firstName || "TIDAL User",
        tidalMe.data.id,
        nbUsers === 0,
      );
    }
    await storeInUser("_id", user._id, infos);
    const privateData = await getPrivateData();
    if (!privateData?.jwtPrivateKey) {
      throw new Error("No private data found, cannot sign JWT");
    }
    const token = sign(
      { userId: user._id.toString() },
      privateData.jwtPrivateKey,
      {
        expiresIn: getWithDefault("COOKIE_VALIDITY_MS", "1h") as `${number}`,
      },
    );
    storeTokenInCookie(req, res, token);
  } catch (e) {
    logger.error(e);
  } finally {
    res.clearCookie(OAUTH_COOKIE_NAME);
  }
  return res.redirect(get("CLIENT_ENDPOINT"));
});

router.get("/tidal/me", logged, withHttpClient, async (req, res) => {
  const { client } = req as TIDALRequest;

  try {
    const { data: me } = await client.raw("/v2/users/me?countryCode=US");
    res.status(200).send(me);
  } catch (e) {
    logger.error(e);
    res.status(500).send({ code: "TIDAL_ERROR" });
  }
});
