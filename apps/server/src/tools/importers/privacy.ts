/* eslint-disable no-await-in-loop */
import { readFile, unlink } from 'fs/promises';
import { z } from 'zod';
import {
  addTrackIdsToUser,
  getCloseTrackId,
  storeFirstListenedAtIfLess,
} from '../../database';
import { setImporterStateCurrent } from '../../database/queries/importer';
import { RecentlyPlayedTrack } from '../../database/schemas/track';
import { User } from '../../database/schemas/user';
import {
  getTracksAlbumsArtists,
  storeTrackAlbumArtist,
} from '../../tidal/dbTools';
import { logger } from '../logger';
import {
  beforeParenthesis,
  minOfArray,
  removeDiacritics,
  retryPromise,
} from '../misc';
import { TidalAPI } from '../apis/tidalApi';
import { Unpack } from '../types';
import { Infos } from '../../database/schemas/info';
import { getFromCache, setToCache, TidalTrackCacheItem } from './cache';
import {
  HistoryImporter,
  ImporterStateTypes,
  PrivacyImporterState,
} from './types';

const privacyFileSchema = z.array(
  z.object({
    endTime: z.string(),
    artistName: z.string(),
    trackName: z.string(),
    msPlayed: z.number(),
  }),
);

export type PrivacyItem = Unpack<z.infer<typeof privacyFileSchema>>;

export class PrivacyImporter
  implements HistoryImporter<ImporterStateTypes.privacy>
{
  private id: string;

  private userId: string;

  private elements: PrivacyItem[] | null;

  private currentItem: number;

  private tidalApi: TidalAPI;

  constructor(user: User) {
    this.id = '';
    this.userId = user._id.toString();
    this.elements = null;
    this.currentItem = 0;
    this.tidalApi = new TidalAPI(this.userId);
  }

  search = async (track: string, artist: string) => {
    const res = await retryPromise(
      () => this.tidalApi.search(track, artist),
      10,
      30,
    );
    return res;
  };

  storeItems = async (userId: string, items: RecentlyPlayedTrack[]) => {
    const { tracks, albums, artists } = await getTracksAlbumsArtists(
      userId,
      items.map(it => it.track),
    );
    await storeTrackAlbumArtist({ tracks, albums, artists });
    const finalInfos: Omit<Infos, 'owner'>[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!;
      const date = new Date(`${item.played_at}Z`);
      const duplicate = await getCloseTrackId(
        this.userId.toString(),
        item.track.id,
        date,
        60,
      );
      const currentImportDuplicate = finalInfos.find(
        e => Math.abs(e.played_at.getTime() - date.getTime()) <= 60 * 1000,
      );
      if (duplicate.length > 0 || currentImportDuplicate) {
        logger.info(
          `${item.track.attributes.title} - ${item.track.relationships.artists.data[0]?.id} was duplicate`,
        );
        continue;
      }
      const [primaryArtist] = item.track.relationships.artists.data;
      if (!primaryArtist) {
        continue;
      }
      finalInfos.push({
        played_at: date,
        id: item.track.id,
        primaryArtistId: primaryArtist.id,
        albumId: item.track.relationships.album.data.id,
        artistIds: item.track.relationships.artists.data.map((e: any) => e.id),
        durationMs: item.track.attributes.duration * 1000, // TIDAL uses seconds, convert to ms
      });
    }
    await setImporterStateCurrent(this.id, this.currentItem + 1);
    await addTrackIdsToUser(this.userId.toString(), finalInfos);
    const min = minOfArray(finalInfos, info => info.played_at.getTime());
    if (min) {
      const minInfo = finalInfos[min.minIndex];
      if (minInfo) {
        await storeFirstListenedAtIfLess(this.userId, minInfo.played_at);
      }
    }
  };

  initWithJSONContent = async (content: any[]) => {
    const value = privacyFileSchema.safeParse(content);
    if (value.success) {
      this.elements = value.data;
      return content;
    }
    logger.error(
      'If you submitted the right files and this error comes up, please open an issue with the following logs at https://github.com/Medformatik/your_tidal',
      JSON.stringify(value.error.issues, null, ' '),
    );
    return null;
  };

  initWithFiles = async (filePaths: string[]) => {
    const files = await Promise.all(filePaths.map(f => readFile(f)));
    const filesContent = files.map(f => JSON.parse(f.toString()));

    const totalContent = filesContent.reduce<PrivacyItem[]>((acc, curr) => {
      acc.push(...curr);
      return acc;
    }, []);

    if (!this.initWithJSONContent(totalContent)) {
      return false;
    }

    return true;
  };

  init = async (
    existingState: PrivacyImporterState | null,
    filePaths: string[],
  ) => {
    try {
      this.currentItem = existingState?.current ?? 0;
      const success = await this.initWithFiles(filePaths);
      if (success) {
        return { total: this.elements!.length };
      }
    } catch (e) {
      logger.error(e);
    }
    return null;
  };

  trySearching = async (
    artistName: string,
    trackName: string,
  ): Promise<TidalTrackCacheItem> => {
    let found = await this.search(
      removeDiacritics(trackName),
      removeDiacritics(artistName),
    );
    if (!found) {
      found = await this.search(
        removeDiacritics(beforeParenthesis(trackName)),
        removeDiacritics(beforeParenthesis(artistName)),
      );
    }
    if (!found) {
      return { exists: false };
    }
    // Convert TidalTrackResource to TidalTrack format
    const tidalTrack = {
      ...found,
      attributes: {
        ...found.attributes,
        explicit: false, // Default value since TidalTrackResource doesn't include this
        duration: Number(found.attributes.duration) || 0,
      },
      relationships: {
        artists: found.relationships?.artists || { data: [] },
        album: found.relationships?.albums?.data?.[0] ? { data: found.relationships.albums.data[0] } : { data: { id: '', type: 'album' } },
      }
    };
    return { exists: true, track: tidalTrack };
  };

  run = async (id: string) => {
    this.id = id;
    let items: RecentlyPlayedTrack[] = [];
    if (!this.elements) {
      return false;
    }
    for (let i = this.currentItem; i < this.elements.length; i += 1) {
      this.currentItem = i;
      const content = this.elements[i]!;
      if (content.msPlayed < 30 * 1000) {
        // If track was played for less than 30 seconds
        logger.info(
          `Track ${content.trackName} - ${
            content.artistName
          } was passed, only listened for ${Math.floor(
            content.msPlayed / 1000,
          )} seconds`,
        );
        continue;
      }
      let item = getFromCache(
        this.userId.toString(),
        content.trackName,
        content.artistName,
      );
      if (!item) {
        item = await this.trySearching(content.artistName, content.trackName);
        setToCache(
          this.userId.toString(),
          content.trackName,
          content.artistName,
          item,
        );
        if (!item.exists) {
          logger.warn(
            `${content.trackName} by ${content.artistName} was not found by search`,
          );
          continue;
        }
      }
      if (!item.exists) {
        continue;
      }
      logger.info(
        `Adding ${item.track.attributes.title} - ${item.track.relationships.artists.data[0]?.id} from data (${i}/${this.elements.length})`,
      );
      items.push({ track: item.track, played_at: content.endTime });
      if (items.length >= 20) {
        await this.storeItems(this.userId, items);
        items = [];
      }
    }
    if (items.length > 0) {
      await this.storeItems(this.userId, items);
      items = [];
    }
    return true;
  };

  // eslint-disable-next-line class-methods-use-this
  cleanup = async (filePaths: string[]) => {
    await Promise.all(filePaths.map(f => unlink(f)));
  };
}
