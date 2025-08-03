import { AxiosError, AxiosInstance } from 'axios';
import { Types } from 'mongoose';
import { getUserFromField, storeInUser } from '../../database';
import { TidalTrack } from '../../database/schemas/track';
import { logger } from '../logger';
import { chunk, wait } from '../misc';
import { TIDAL } from '../oauth/Provider';
import { PromiseQueue } from '../queue';

export const tqueue = new PromiseQueue();

// JSON:API compliant response structures
interface TidalAPIResponse<T> {
  data: T;
  links?: {
    next?: string;
    prev?: string;
    self?: string;
  };
  meta?: any;
  included?: any[];
}

interface TidalUser {
  id: string;
  type: string;
  attributes: {
    country: string;
    username: string;
    email?: string;
    emailVerified?: boolean;
    firstName?: string;
    lastName?: string;
    nostrPublicKey?: string;
  };
}

interface TidalPlaylist {
  id: string;
  type: string;
  attributes: {
    name: string;
    description?: string;
    accessType: 'PUBLIC' | 'UNLISTED';
    bounded: boolean;
    createdAt: string;
    lastModifiedAt: string;
    duration?: string;
    numberOfItems?: number;
    playlistType: 'EDITORIAL' | 'USER' | 'MIX' | 'ARTIST';
    privacy?: 'PUBLIC' | 'PRIVATE';
    externalLinks: any[];
  };
}

interface TidalTrackResource {
  id: string;
  type: string;
  attributes: {
    title: string;
    duration: string; // ISO 8601 format
    explicit: boolean;
    isrc: string;
    key: string;
    keyScale: string;
    mediaTags: string[];
    popularity: number;
    accessType?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
    availability?: ('STREAM' | 'DJ' | 'STEM')[];
    bpm?: number;
    copyright?: string;
    createdAt?: string;
    externalLinks?: any[];
    genreTags?: string[];
    spotlighted?: boolean;
    toneTags?: string[];
    version?: string;
  };
  relationships?: {
    artists?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    albums?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
  };
}

interface TidalArtist {
  id: string;
  type: string;
  attributes: {
    name: string;
    popularity: number;
    contributionsEnabled?: boolean;
    contributionsSalesPitch?: string;
    externalLinks?: any[];
    handle?: string;
    spotlighted?: boolean;
  };
  relationships?: {
    albums?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    biography?: {
      data: {
        id: string;
        type: string;
      };
    };
    owners?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    profileArt?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    radio?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    roles?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    similarArtists?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    trackProviders?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    tracks?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    videos?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
  };
}

interface TidalAlbum {
  id: string;
  type: string;
  attributes: {
    barcodeId: string;
    duration: string; // ISO 8601 format
    explicit: boolean;
    mediaTags: string[];
    numberOfItems: number; // Changed from numberOfTracks
    numberOfVolumes: number;
    popularity: number;
    title: string;
    type: 'ALBUM' | 'EP' | 'SINGLE'; // Changed from albumType
    availability?: ('STREAM' | 'DJ' | 'STEM')[];
    copyright?: string;
    externalLinks?: any[];
    releaseDate?: string; // ISO-8601 date format
  };
  relationships?: {
    artists?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    coverArt?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    items?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    owners?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    providers?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
    similarAlbums?: {
      data: Array<{
        id: string;
        type: string;
      }>;
    };
  };
}

export class TidalAPI {
  private client!: AxiosInstance;

  private tidalId!: string;

  constructor(private readonly userId: string) {}

  private async checkToken() {
    // Refresh the token if it expires in less than two minutes (1000ms * 120)
    const user = await getUserFromField(
      '_id',
      new Types.ObjectId(this.userId),
      true,
    );
    let access: string | null | undefined = user?.accessToken;
    if (!user) {
      throw new Error('User not found');
    }
    if (!user.tidalId) {
      throw new Error('User has no TIDAL id');
    }
    this.tidalId = user.tidalId;
    if (Date.now() > user.expiresIn - 1000 * 120) {
      const token = user.refreshToken;
      if (!token) {
        return;
      }
      const infos = await TIDAL.refresh(token);

      await storeInUser('_id', user._id, infos);
      logger.info(`Refreshed token for ${user.username}`);
      access = infos.accessToken;
    }
    if (access) {
      this.client = TIDAL.getHttpClient(access);
    } else {
      throw new Error('Could not get any access token');
    }
  }

  public async raw(url: string) {
    const res = await tqueue.queue(async () => {
      await this.checkToken();
      return this.client.get(url);
    });

    return res;
  }

  public async playTrack(trackId: string) {
    // TIDAL playback is handled by the client-side SDK
    // The server provides the track ID to the client, which uses @tidal-music/player
    // This endpoint validates the track exists and user has access
    try {
      const track = await this.getTrack(trackId);
      if (!track) {
        throw new Error('Track not found or not accessible');
      }

      // Return track information for client-side playback
      return {
        success: true,
        trackId: trackId,
        track: track,
        message: 'Track ready for playback - use client-side TIDAL SDK Player',
      };
    } catch (e) {
      logger.error(`Failed to prepare track ${trackId} for playback:`, e);
      throw new Error('Track not available for playback');
    }
  }

  public async me() {
    const res = await tqueue.queue(async () => {
      await this.checkToken();
      return this.client.get('/users/me');
    });
    return res.data as TidalAPIResponse<TidalUser>;
  }

  public async playlists() {
    const items: TidalPlaylist[] = [];
    let cursor: string | undefined;

    do {
      const res = await tqueue.queue(async () => {
        await this.checkToken();
        const params: any = {
          countryCode: 'US',
          [`filter[r.owners.id]`]: this.tidalId,
        };
        if (cursor) {
          params['page[cursor]'] = cursor;
        }
        return this.client.get('/playlists', { params });
      });

      const response = res.data as TidalAPIResponse<TidalPlaylist[]>;
      if (Array.isArray(response.data)) {
        items.push(...response.data);
      }
      cursor = response.links?.next
        ? new URL(response.links.next).searchParams.get('page[cursor]') ||
          undefined
        : undefined;
    } while (cursor);

    return items;
  }

  private async internAddToPlaylist(playlistId: string, trackIds: string[]) {
    // TIDAL playlist management using proper API endpoints
    try {
      // Add tracks to playlist using TIDAL API
      const response = await this.client.post(
        `/playlists/${playlistId}/relationships/items`,
        {
          data: trackIds.map(trackId => ({
            type: 'tracks',
            id: trackId,
          })),
          meta: {
            positionBefore: '',
          },
        },
        {
          params: {
            countryCode: 'US',
          },
        },
      );

      return response.data;
    } catch (e) {
      logger.error(`Failed to add tracks to playlist ${playlistId}:`, e);
      throw new Error('Failed to add tracks to playlist');
    }
  }

  public async addToPlaylist(playlistId: string, trackIds: string[]) {
    return await tqueue.queue(async () => {
      await this.checkToken();
      return this.internAddToPlaylist(playlistId, trackIds);
    });
  }

  public async createPlaylist(name: string, trackIds: string[] = []) {
    return await tqueue.queue(async () => {
      await this.checkToken();

      // Create playlist first
      const { data } = await this.client.post(
        `/playlists`,
        {
          data: {
            type: 'playlists',
            attributes: {
              name: name,
              description: `Created by YourTIDAL on ${new Date().toLocaleDateString()}`,
            },
          },
        },
        {
          params: {
            countryCode: 'US',
          },
        },
      );

      const playlist = data as TidalAPIResponse<TidalPlaylist>;

      // Add tracks if provided
      if (trackIds.length > 0) {
        await this.internAddToPlaylist(playlist.data.id, trackIds);
      }

      return playlist.data;
    });
  }

  async getTracks(tidalIds: string[]) {
    // TIDAL API supports individual track fetching
    const tracks: (TidalTrackResource | null)[] = [];

    for (const id of tidalIds) {
      try {
        const res = await tqueue.queue(async () => {
          await this.checkToken();
          return this.client.get(`/tracks/${id}`, {
            params: {
              countryCode: 'US',
              include: 'artists,albums', // Include related resources
            },
          });
        });

        const response = res.data as TidalAPIResponse<TidalTrackResource>;
        tracks.push(response.data);
      } catch (e) {
        logger.warn(`Failed to fetch track ${id}:`, e);
        tracks.push(null);
      }
    }

    return tracks;
  }

  public async search(track: string, artist: string) {
    try {
      const res = await tqueue.queue(async () => {
        await this.checkToken();
        const limitedTrack = track.slice(0, 100);
        const limitedArtist = artist.slice(0, 100);
        const query = `${limitedTrack} ${limitedArtist}`;
        return this.client.get(`/searchResults/${encodeURIComponent(query)}`, {
          params: {
            countryCode: 'US',
            include: 'tracks',
          },
        });
      });

      const response = res.data as TidalAPIResponse<any>;
      // The main search endpoint returns the search result object with relationships
      // We need to access the included tracks from the response
      if (response.included && Array.isArray(response.included)) {
        const tracks = response.included.filter(
          (item: any) => item.type === 'tracks',
        ) as TidalTrackResource[];
        return tracks.length > 0 ? tracks[0] : undefined;
      }
      return undefined;
    } catch (e) {
      if (e instanceof AxiosError) {
        if (e.response?.status === 404) {
          return undefined;
        }
      }
      throw e;
    }
  }

  // Get track details by ID
  public async getTrack(trackId: string) {
    try {
      const res = await tqueue.queue(async () => {
        await this.checkToken();
        return this.client.get(`/tracks/${trackId}`, {
          params: {
            countryCode: 'US',
            include: 'artists,albums',
          },
        });
      });

      const response = res.data as TidalAPIResponse<TidalTrackResource>;
      return response.data;
    } catch (e) {
      if (e instanceof AxiosError && e.response?.status === 404) {
        return null;
      }
      throw e;
    }
  }

  // Get artist details by ID
  public async getArtist(artistId: string) {
    try {
      const res = await tqueue.queue(async () => {
        await this.checkToken();
        return this.client.get(`/artists/${artistId}`, {
          params: {
            countryCode: 'US',
          },
        });
      });

      const response = res.data as TidalAPIResponse<TidalArtist>;
      return response.data;
    } catch (e) {
      if (e instanceof AxiosError && e.response?.status === 404) {
        return null;
      }
      throw e;
    }
  }

  // Get album details by ID
  public async getAlbum(albumId: string) {
    try {
      const res = await tqueue.queue(async () => {
        await this.checkToken();
        return this.client.get(`/albums/${albumId}`, {
          params: {
            countryCode: 'US',
            include: 'artists',
          },
        });
      });

      const response = res.data as TidalAPIResponse<TidalAlbum>;
      return response.data;
    } catch (e) {
      if (e instanceof AxiosError && e.response?.status === 404) {
        return null;
      }
      throw e;
    }
  }

  // Get user's collection items
  public async getUserCollection(
    type: 'albums' | 'artists' | 'playlists' = 'albums',
  ) {
    const items: any[] = [];
    let cursor: string | undefined;

    do {
      const res = await tqueue.queue(async () => {
        await this.checkToken();
        const params: any = {
          countryCode: 'US',
          locale: 'en-US',
        };
        if (cursor) {
          params['page[cursor]'] = cursor;
        }
        return this.client.get(
          `/userCollections/${this.tidalId}/relationships/${type}`,
          { params },
        );
      });

      const response = res.data as TidalAPIResponse<any[]>;
      if (Array.isArray(response.data)) {
        items.push(...response.data);
      }
      cursor = response.links?.next
        ? new URL(response.links.next).searchParams.get('page[cursor]') ||
          undefined
        : undefined;
    } while (cursor);

    return items;
  }

  // Recently played tracking - Custom implementation since TIDAL doesn't provide this API
  public async recordPlayback(trackId: string, playedAt?: Date) {
    const playbackRecord = {
      userId: this.userId,
      trackId: trackId,
      playedAt: playedAt || new Date(),
      source: 'tidal',
    };

    try {
      // Store in our own database for recently played tracking
      const { storeTrackPlay } = await import(
        '../../database/queries/recentlyPlayed'
      );
      await storeTrackPlay(playbackRecord);
      logger.info(
        `Recorded playback for user ${this.userId}, track ${trackId}`,
      );
    } catch (e) {
      logger.error('Failed to record playback:', e);
      throw e;
    }
  }

  // Get recently played tracks from our own tracking
  public async getRecentlyPlayed(limit: number = 50, offset: number = 0) {
    try {
      const { getRecentlyPlayed } = await import(
        '../../database/queries/recentlyPlayed'
      );
      const recentTracks = await getRecentlyPlayed(this.userId, limit, offset);

      // Enrich with full track information from TIDAL API
      const enrichedTracks = [];
      for (const playRecord of recentTracks) {
        try {
          const trackInfo = await this.getTrack(playRecord.trackId);
          if (trackInfo) {
            enrichedTracks.push({
              ...playRecord,
              track: trackInfo,
            });
          }
        } catch (e) {
          logger.warn(
            `Failed to fetch track info for ${playRecord.trackId}:`,
            e,
          );
          // Include record even without track info
          enrichedTracks.push(playRecord);
        }
      }

      return enrichedTracks;
    } catch (e) {
      logger.error('Failed to get recently played tracks:', e);
      throw e;
    }
  }

  // Get current listening session data (for real-time tracking)
  public async getCurrentSession() {
    try {
      const { getCurrentSession } = await import(
        '../../database/queries/recentlyPlayed'
      );
      return await getCurrentSession(this.userId);
    } catch (e) {
      logger.error('Failed to get current session:', e);
      return null;
    }
  }

  // Update current session (for tracking current track)
  public async updateCurrentSession(trackId: string, startedAt?: Date) {
    try {
      const { updateCurrentSession } = await import(
        '../../database/queries/recentlyPlayed'
      );
      await updateCurrentSession(this.userId, trackId, startedAt || new Date());
    } catch (e) {
      logger.error('Failed to update current session:', e);
      throw e;
    }
  }
}
