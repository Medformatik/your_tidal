import mongoose from "mongoose";
import { TrackModel, AlbumModel, ArtistModel } from "../database/Models";
import { TidalAlbum, Album } from "../database/schemas/album";
import { TidalArtist, Artist } from "../database/schemas/artist";
import { TidalTrack, Track } from "../database/schemas/track";
import { logger } from "../tools/logger";
import { minOfArray, retryPromise, uniqBy, wait } from "../tools/misc";
import { TidalAPI } from "../tools/apis/tidalApi";
import {
  addTrackIdsToUser,
  storeInUser,
  storeFirstListenedAtIfLess,
} from "../database";
import { Infos } from "../database/schemas/info";
import { longWriteDbLock } from "../tools/lock";
import { Metrics } from "../tools/metrics";

// TIDAL API has different data structure and doesn't support batch operations like Spotify
export const getTracks = async (userId: string, ids: string[]) => {
  const tidalApi = new TidalAPI(userId);
  const tidalTracks: TidalTrack[] = [];

  // Process tracks individually since TIDAL doesn't support batch fetching
  for (const id of ids) {
    try {
      const { data } = await retryPromise(
        () => tidalApi.raw(`/v2/tracks/${id}?countryCode=US`),
        10,
        30
      );
      
      if (data.data) {
        tidalTracks.push(data.data);
        logger.info(
          `Storing non existing track ${data.data.attributes.title}`
        );
      }
    } catch (error) {
      logger.warn(`Failed to fetch track ${id}:`, error);
    }
    
    // Add delay to respect rate limits
    await wait(100);
  }

  const tracks = tidalTracks.map<Track>(track => {
    return {
      ...track.attributes,
      id: track.id,
      name: track.attributes.title,
      duration_ms: track.attributes.duration * 1000, // TIDAL gives duration in seconds
      track_number: track.attributes.trackNumber || 0,
      disc_number: track.attributes.volumeNumber || 1,
      explicit: track.attributes.explicit,
      popularity: track.attributes.popularity || 0,
      uri: `tidal:track:${track.id}`,
      type: "track",
      href: `https://openapi.tidal.com/v2/tracks/${track.id}`,
      is_local: false,
      preview_url: "",
      available_markets: ["US"], // TIDAL availability is handled differently
      external_ids: { isrc: track.attributes.isrc },
      external_urls: {},
      album: track.relationships.album.data.id,
      artists: track.relationships.artists.data.map(artist => artist.id),
    };
  });

  Metrics.ingestedTracksTotal.inc({ user: userId }, tracks.length);
  return tracks;
};

export const getAlbums = async (userId: string, ids: string[]) => {
  const tidalApi = new TidalAPI(userId);
  const tidalAlbums: TidalAlbum[] = [];

  for (const id of ids) {
    try {
      const { data } = await retryPromise(
        () => tidalApi.raw(`/v2/albums/${id}?countryCode=US`),
        10,
        30
      );
      
      if (data.data) {
        tidalAlbums.push(data.data);
        logger.info(
          `Storing non existing album ${data.data.attributes.title}`
        );
      }
    } catch (error) {
      logger.warn(`Failed to fetch album ${id}:`, error);
    }
    
    await wait(100);
  }

  const albums: Album[] = tidalAlbums.map(alb => {
    return {
      ...alb.attributes,
      id: alb.id,
      name: alb.attributes.title,
      album_type: "album",
      release_date: alb.attributes.releaseDate || "",
      release_date_precision: "day",
      popularity: alb.attributes.popularity || 0,
      uri: `tidal:album:${alb.id}`,
      type: "album",
      href: `https://openapi.tidal.com/v2/albums/${alb.id}`,
      available_markets: ["US"],
      copyrights: [],
      external_ids: { upc: alb.attributes.upc },
      external_urls: {},
      genres: [],
      images: [], // TIDAL images would need separate API call
      artists: alb.relationships.artists.data.map(art => art.id),
    };
  });

  Metrics.ingestedAlbumsTotal.inc({ user: userId }, albums.length);
  return albums;
};

export const getArtists = async (userId: string, ids: string[]) => {
  const tidalApi = new TidalAPI(userId);
  const artists: Artist[] = [];

  for (const id of ids) {
    try {
      const { data } = await retryPromise(
        () => tidalApi.raw(`/v2/artists/${id}?countryCode=US`),
        10,
        30
      );
      
      if (data.data) {
        const artist = data.data;
        artists.push({
          id: artist.id,
          name: artist.attributes.name,
          type: "artist",
          uri: `tidal:artist:${artist.id}`,
          href: `https://openapi.tidal.com/v2/artists/${artist.id}`,
          popularity: artist.attributes.popularity || 0,
          genres: [],
          images: [], // TIDAL images would need separate API call
          external_urls: {},
          followers: { total: 0 },
        });
        
        logger.info(`Storing non existing artist ${artist.attributes.name}`);
      }
    } catch (error) {
      logger.warn(`Failed to fetch artist ${id}:`, error);
    }
    
    await wait(100);
  }

  Metrics.ingestedArtistsTotal.inc({ user: userId }, artists.length);
  return artists;
};

const getTracksAndRelatedAlbumArtists = async (
  userId: string,
  ids: string[],
) => {
  const tracks = await getTracks(userId, ids);

  return {
    tracks,
    artists: [...new Set(tracks.flatMap(e => e.artists)).values()],
    albums: [...new Set(tracks.map(e => e.album)).values()],
  };
};

export const getTracksAlbumsArtists = async (
  userId: string,
  tidalTracks: TidalTrack[],
) => {
  const ids = tidalTracks.map(track => track.id);
  const storedTracks: Track[] = await TrackModel.find({ id: { $in: ids } });
  const missingTrackIds = ids.filter(
    id => !storedTracks.find(stored => stored.id.toString() === id.toString()),
  );

  if (missingTrackIds.length === 0) {
    logger.info("No missing tracks, passing...");
    return {
      tracks: [],
      albums: [],
      artists: [],
    };
  }

  const {
    tracks,
    artists: relatedArtists,
    albums: relatedAlbums,
  } = await getTracksAndRelatedAlbumArtists(userId, missingTrackIds);

  const storedAlbums: Album[] = await AlbumModel.find({
    id: { $in: relatedAlbums },
  });
  const missingAlbumIds = relatedAlbums.filter(
    alb => !storedAlbums.find(salb => salb.id.toString() === alb.toString()),
  );

  const storedArtists: Artist[] = await ArtistModel.find({
    id: { $in: relatedArtists },
  });
  const missingArtistIds = relatedArtists.filter(
    alb => !storedArtists.find(salb => salb.id.toString() === alb.toString()),
  );

  const albums =
    missingAlbumIds.length > 0 ? await getAlbums(userId, missingAlbumIds) : [];
  const artists =
    missingArtistIds.length > 0
      ? await getArtists(userId, missingArtistIds)
      : [];

  return {
    tracks,
    albums,
    artists,
  };
};

export async function storeTrackAlbumArtist({
  tracks,
  albums,
  artists,
}: {
  tracks?: Track[];
  albums?: Album[];
  artists?: Artist[];
}) {
  if (tracks) {
    await TrackModel.create(uniqBy(tracks, item => item.id));
  }
  if (albums) {
    await AlbumModel.create(uniqBy(albums, item => item.id));
  }
  if (artists) {
    await ArtistModel.create(uniqBy(artists, item => item.id));
  }
}

export async function storeIterationOfLoop(
  userId: string,
  iterationTimestamp: number,
  tracks: Track[],
  albums: Album[],
  artists: Artist[],
  infos: Omit<Infos, "owner">[],
) {
  await longWriteDbLock.lock();

  await storeTrackAlbumArtist({
    tracks,
    albums,
    artists,
  });

  await addTrackIdsToUser(userId, infos);

  await storeInUser("_id", new mongoose.Types.ObjectId(userId), {
    lastTimestamp: iterationTimestamp,
  });

  const min = minOfArray(infos, item => item.played_at.getTime());

  if (min) {
    const minInfo = infos[min.minIndex]?.played_at;
    if (minInfo) {
      await storeFirstListenedAtIfLess(userId, minInfo);
    }
  }

  longWriteDbLock.unlock();
}