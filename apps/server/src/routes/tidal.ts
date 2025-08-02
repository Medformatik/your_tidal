import { Router } from "express";
import { z } from "zod";
import {
  getTrackByTidalId,
  getSongs,
  getSongsPer,
  getMostListenedSongs,
  getMostListenedArtist,
  getTimePer,
  albumDateRatio,
  featRatio,
  popularityPer,
  differentArtistsPer,
  getDayRepartition,
  getBestArtistsPer,
  getLongestListeningSession,
  getBest,
  ItemType,
  getBestOfHour,
} from "../database";
import {
  CollaborativeMode,
  getCollaborativeBestAlbums,
  getCollaborativeBestArtists,
  getCollaborativeBestSongs,
} from "../database/queries/collaborative";
import { DateFormatter, intervalToDisplay } from "../tools/date";
import { logger } from "../tools/logger";
import {
  affinityAllowed,
  isLoggedOrGuest,
  logged,
  validate,
  withHttpClient,
} from "../tools/middleware";
import { TIDALRequest, LoggedRequest, Timesplit } from "../tools/types";
import { toDate, toNumber } from "../tools/zod";

export const router = Router();

// TIDAL playback is handled client-side with the TIDAL SDK Player
// This endpoint validates track availability and prepares for client-side playback
const playSchema = z.object({
  id: z.string(),
});

router.post("/play", logged, withHttpClient, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { id } = validate(req.body, playSchema);

  try {
    // Use TidalAPI to validate track and prepare for playback
    const { TidalAPI } = await import("../tools/apis/tidalApi");
    const tidalApi = new TidalAPI(user._id.toString());
    
    const result = await tidalApi.playTrack(id);
    res.status(200).send(result);
  } catch (e) {
    logger.error(e);
    
    if (e instanceof Error && e.message.includes("not found")) {
      res.status(404).send({ error: "TRACK_NOT_FOUND" });
    } else if (e instanceof Error && e.message.includes("not accessible")) {
      res.status(403).send({ error: "TRACK_NOT_ACCESSIBLE" });
    } else {
      res.status(500).send({ error: "TIDAL_ERROR" });
    }
  }
});

const gethistorySchema = z.object({
  number: z.preprocess(toNumber, z.number().max(20)),
  offset: z.preprocess(toNumber, z.number()),
  start: z.preprocess(toDate, z.date().optional()),
  end: z.preprocess(toDate, z.date().optional()),
});

router.get("/gethistory", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { number, offset, start, end } = validate(req.query, gethistorySchema);

  const tracks = await getSongs(
    user._id.toString(),
    offset,
    number,
    start && end ? { start, end } : undefined,
  );
  res.status(200).send(tracks);
});

const interval = z.object({
  start: z.preprocess(toDate, z.date()),
  end: z.preprocess(
    toDate,
    z.date().default(() => new Date()),
  ),
});

const intervalPerSchema = z.object({
  start: z.preprocess(toDate, z.date()),
  end: z.preprocess(
    toDate,
    z.date().default(() => new Date()),
  ),
  timeSplit: z.nativeEnum(Timesplit).default(Timesplit.day),
});

router.get("/listened_to", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end } = validate(req.query, interval);

  const result = await getSongsPer(user, start, end);
  if (result.length > 0) {
    res.status(200).send({ count: result[0].count });
    return;
  }
  res.status(200).send({ count: 0 });
});

router.get("/most_listened", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end, timeSplit } = validate(req.query, intervalPerSchema);

  const result = await getMostListenedSongs(user, start, end, timeSplit);
  res.status(200).send(result);
});

router.get("/most_listened_artist", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end, timeSplit } = validate(req.query, intervalPerSchema);

  const result = await getMostListenedArtist(user, start, end, timeSplit);
  res.status(200).send(result);
});

router.get("/songs_per", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end, timeSplit } = validate(req.query, intervalPerSchema);

  const result = await getSongsPer(user, start, end, timeSplit);
  res.status(200).send(result);
});

router.get("/time_per", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end, timeSplit } = validate(req.query, intervalPerSchema);

  const result = await getTimePer(user, start, end, timeSplit);
  res.status(200).send(result);
});

router.get("/album_date_ratio", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end, timeSplit } = validate(req.query, intervalPerSchema);

  const result = await albumDateRatio(user, start, end, timeSplit);
  res.status(200).send(result);
});

router.get("/feat_ratio", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end, timeSplit } = validate(req.query, intervalPerSchema);

  const result = await featRatio(user, start, end, timeSplit);
  res.status(200).send(result);
});

router.get("/popularity_per", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end, timeSplit } = validate(req.query, intervalPerSchema);

  const result = await popularityPer(user, start, end, timeSplit);
  res.status(200).send(result);
});

router.get("/different_artists_per", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end, timeSplit } = validate(req.query, intervalPerSchema);

  const result = await differentArtistsPer(user, start, end, timeSplit);
  res.status(200).send(result);
});

router.get("/time_per_hour_of_day", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end } = validate(req.query, interval);

  const result = await getDayRepartition(user, start, end);
  res.status(200).send(result);
});

router.get("/best_artists_per", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end, timeSplit } = validate(req.query, intervalPerSchema);

  const result = await getBestArtistsPer(user, start, end, timeSplit);
  res.status(200).send(result);
});

const intervalPerSchemaNbOffset = z.object({
  start: z.preprocess(toDate, z.date()),
  end: z.preprocess(
    toDate,
    z.date().default(() => new Date()),
  ),
  nb: z.preprocess(toNumber, z.number().min(1).max(30)),
  offset: z.preprocess(toNumber, z.number().min(0).default(0)),
  sortKey: z.string().default("count"),
});

router.get("/top/songs", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end, nb, offset, sortKey } = validate(
    req.query,
    intervalPerSchemaNbOffset,
  );

  const result = await getBest(ItemType.track, user, start, end, nb, offset);
  res.status(200).send(result);
});

router.get("/top/artists", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end, nb, offset, sortKey } = validate(
    req.query,
    intervalPerSchemaNbOffset,
  );

  const result = await getBest(ItemType.artist, user, start, end, nb, offset);
  res.status(200).send(result);
});

router.get("/top/albums", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end, nb, offset, sortKey } = validate(
    req.query,
    intervalPerSchemaNbOffset,
  );

  const result = await getBest(ItemType.album, user, start, end, nb, offset);
  res.status(200).send(result);
});

const collaborativeSchema = intervalPerSchema.merge(
  z.object({
    otherIds: z.array(z.string()).min(1),
    mode: z.nativeEnum(CollaborativeMode),
  }),
);

export function normalizeOtherIdsQuery(query: any) {
  if (query['otherIds[]']) {
    query.otherIds = Array.isArray(query['otherIds[]'])
      ? query['otherIds[]']
      : [query['otherIds[]']];
    delete query['otherIds[]'];
  }
  return query;
}

router.get(
  "/collaborative/top/songs",
  logged,
  affinityAllowed,
  async (req, res) => {
    const normalizedQuery = normalizeOtherIdsQuery(req.query);
    const { user } = req as LoggedRequest;
    const { start, end, otherIds, mode } = validate(
      normalizedQuery,
      collaborativeSchema,
    );
    const result = await getCollaborativeBestSongs(
      [user._id.toString(), ...otherIds.filter(e => e.length > 0)],
      start,
      end,
      mode,
      50,
    );
    res.status(200).send(result);
  },
);

router.get(
  "/collaborative/top/albums",
  logged,
  affinityAllowed,
  async (req, res) => {
    const normalizedQuery = normalizeOtherIdsQuery(req.query);
    const { user } = req as LoggedRequest;
    const { start, end, otherIds, mode } = validate(
      normalizedQuery,
      collaborativeSchema,
    );

    const result = await getCollaborativeBestAlbums(
      [user._id.toString(), ...otherIds],
      start,
      end,
      mode,
    );
    res.status(200).send(result);
  },
);

router.get(
  "/collaborative/top/artists",
  logged,
  affinityAllowed,
  async (req, res) => {
    const normalizedQuery = normalizeOtherIdsQuery(req.query);
    const { user } = req as LoggedRequest;
    const { start, end, otherIds, mode } = validate(
      normalizedQuery,
      collaborativeSchema,
    );

    const result = await getCollaborativeBestArtists(
      [user._id.toString(), ...otherIds],
      start,
      end,
      mode,
    );
    res.status(200).send(result);
  },
);

router.get("/top/hour-repartition/songs", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end } = validate(req.query, interval);

  const tracks = await getBestOfHour(ItemType.track, user, start, end);
  res.status(200).send(tracks);
});

router.get(
  "/top/hour-repartition/albums",
  isLoggedOrGuest,
  async (req, res) => {
    const { user } = req as LoggedRequest;
    const { start, end } = validate(req.query, interval);

    const albums = await getBestOfHour(ItemType.album, user, start, end);
    res.status(200).send(albums);
  },
);

router.get(
  "/top/hour-repartition/artists",
  isLoggedOrGuest,
  async (req, res) => {
    const { user } = req as LoggedRequest;
    const { start, end } = validate(req.query, interval);

    const artists = await getBestOfHour(ItemType.artist, user, start, end);
    res.status(200).send(artists);
  },
);

router.get("/top/sessions", isLoggedOrGuest, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { start, end } = validate(req.query, interval);

  const result = await getLongestListeningSession(
    user._id.toString(),
    start,
    end,
  );
  res.status(200).send(result);
});

// Session tracking endpoints for recently played functionality
const sessionStartSchema = z.object({
  trackId: z.string(),
  startedAt: z.string().optional(),
});

const sessionEndSchema = z.object({
  trackId: z.string(),
  playedAt: z.string().optional(),
  endedAt: z.string().optional(),
  duration: z.number().optional(),
});

router.post("/session/start", logged, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { trackId, startedAt } = validate(req.body, sessionStartSchema);

  try {
    const { updateCurrentSession } = await import("../database/queries/recentlyPlayed");
    await updateCurrentSession(
      user._id.toString(),
      trackId,
      startedAt ? new Date(startedAt) : new Date()
    );
    res.status(200).send({ success: true });
  } catch (e) {
    logger.error(e);
    res.status(500).send({ error: "Failed to start session" });
  }
});

router.post("/session/end", logged, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { trackId, playedAt, endedAt, duration } = validate(req.body, sessionEndSchema);

  try {
    const { storeTrackPlay, endCurrentSession } = await import("../database/queries/recentlyPlayed");
    
    // End the current session
    await endCurrentSession(user._id.toString(), endedAt ? new Date(endedAt) : undefined);
    
    // If duration is provided and >= 30 seconds, store the play
    if (duration && duration >= 30) {
      await storeTrackPlay({
        userId: user._id.toString(),
        trackId,
        playedAt: playedAt ? new Date(playedAt) : new Date(),
        source: 'tidal'
      });
    }
    
    res.status(200).send({ success: true });
  } catch (e) {
    logger.error(e);
    res.status(500).send({ error: "Failed to end session" });
  }
});

router.get("/recently-played", logged, async (req, res) => {
  const { user } = req as LoggedRequest;
  const { number = 20, offset = 0 } = validate(req.query, z.object({
    number: z.preprocess(toNumber, z.number().max(50).default(20)),
    offset: z.preprocess(toNumber, z.number().default(0)),
  }));

  try {
    const { TidalAPI } = await import("../tools/apis/tidalApi");
    const tidalApi = new TidalAPI(user._id.toString());
    
    const recentTracks = await tidalApi.getRecentlyPlayed(number, offset);
    res.status(200).send(recentTracks);
  } catch (e) {
    logger.error(e);
    res.status(500).send({ error: "Failed to get recently played tracks" });
  }
});

router.get("/current-session", logged, async (req, res) => {
  const { user } = req as LoggedRequest;

  try {
    const { getCurrentSession } = await import("../database/queries/recentlyPlayed");
    const session = await getCurrentSession(user._id.toString());
    res.status(200).send(session);
  } catch (e) {
    logger.error(e);
    res.status(500).send({ error: "Failed to get current session" });
  }
});

// TIDAL playlists endpoint using the proper API
router.get("/playlists", logged, withHttpClient, async (req, res) => {
  const { user } = req as LoggedRequest;
  
  try {
    const { TidalAPI } = await import("../tools/apis/tidalApi");
    const tidalApi = new TidalAPI(user._id.toString());
    
    const playlists = await tidalApi.playlists();
    res.status(200).send(playlists);
  } catch (e) {
    logger.error(e);
    res.status(500).send({ error: "Failed to get playlists" });
  }
});