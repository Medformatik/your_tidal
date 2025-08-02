/* eslint-disable @typescript-eslint/no-unused-vars */
import Axios from "axios";
import { generateRandomString, sha256 } from "../crypto";
import { credentials } from "./credentials";

export class Provider {
  static getRedirect = () => {};

  // @ts-ignore
  static exchangeCode = (code: string, state: string) => {};

  // @ts-ignore
  static refresh = refreshToken => {};

  // @ts-ignore
  static getUniqueID = accessToken => {};

  // @ts-ignore
  static getHttpClient = accessToken => {};
}

export class TIDAL extends Provider {
  static getRedirect = async () => {
    const { scopes } = credentials.tidal;
    const { redirectUri } = credentials.tidal;

    const authorizeUrl = new URL("https://login.tidal.com/authorize");
    const state = generateRandomString(32);

    authorizeUrl.searchParams.append("client_id", credentials.tidal.clientId);
    authorizeUrl.searchParams.append("response_type", "code");
    authorizeUrl.searchParams.append("redirect_uri", redirectUri);
    authorizeUrl.searchParams.append("state", state);
    authorizeUrl.searchParams.append("scope", scopes);

    return {
      url: authorizeUrl.toString(),
      state,
    };
  };

  static exchangeCode = async (code: string, state: string) => {
    const { data } = await Axios.post(
      "https://auth.tidal.com/v1/oauth2/token",
      null,
      {
        params: {
          grant_type: "authorization_code",
          code,
          redirect_uri: credentials.tidal.redirectUri,
          client_id: credentials.tidal.clientId,
          client_secret: credentials.tidal.clientSecret,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: Date.now() + data.expires_in * 1000,
    };
  };

  static refresh = async (refresh: string) => {
    const { data } = await Axios.post(
      "https://auth.tidal.com/v1/oauth2/token",
      null,
      {
        params: {
          grant_type: "refresh_token",
          refresh_token: refresh,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(
            `${credentials.tidal.clientId}:${credentials.tidal.clientSecret}`,
          ).toString("base64")}`,
        },
      },
    );

    return {
      accessToken: data.access_token as string,
      expiresIn: Date.now() + data.expires_in * 1000,
    };
  };

  static getHttpClient = (accessToken: string) =>
    Axios.create({
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
      },
      baseURL: "https://openapi.tidal.com",
    });
}
