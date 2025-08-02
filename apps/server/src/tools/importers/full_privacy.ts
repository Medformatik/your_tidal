/* eslint-disable @typescript-eslint/no-loop-func */
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
import { minOfArray, retryPromise } from '../misc';
import { TidalAPI } from '../apis/tidalApi';
import { Unpack } from '../types';
import { Infos } from '../../database/schemas/info';
import { getFromCacheString, setToCacheString } from './cache';
import {
  FullPrivacyImporterState,
  HistoryImporter,
  ImporterStateTypes,
} from './types';

const fullPrivacyFileSchema = z.array(
  z.object({
    ts: z.string(),
    ms_played: z.number(),
    tidal_track_uri: z.string().nullable(),
    master_metadata_track_name: z.string().nullable(),
    master_metadata_album_artist_name: z.string().nullable(),
  }),
);

export type FullPrivacyItem = Unpack<z.infer<typeof fullPrivacyFileSchema>>;

export class FullPrivacyImporter
  implements HistoryImporter<ImporterStateTypes.fullPrivacy>
{
  private id: string;

  private userId: string;

  private elements: FullPrivacyItem[] | null;

  private currentItem: number;

  private tidalApi: TidalAPI;

  constructor(user: User) {
    this.id = '';
    this.userId = user._id.toString();
    this.elements = null;
    this.currentItem = 0;
    this.tidalApi = new TidalAPI(this.userId);
  }

  static idFromTidalURI = (uri: string) => uri.split(':')[2];

  search = async (tidalIds: string[]) => {
    if (tidalIds.length === 0) {
      return [];
    }
    const res = await retryPromise(
      () => this.tidalApi.getTracks(tidalIds),
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
    await storeTrackAlbumArtist({
      tracks,
      albums,
      artists,
    });
    const finalInfos: Omit<Infos, 'owner'>[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!;
      const date = new Date(item.played_at);
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
    const value = fullPrivacyFileSchema.safeParse(content);
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

    const totalContent = filesContent.reduce<FullPrivacyItem[]>((acc, curr) => {
      acc.push(...curr);
      return acc;
    }, []);

    if (!this.initWithJSONContent(totalContent)) {
      return false;
    }

    return true;
  };

  init = async (
    existingState: FullPrivacyImporterState | null,
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

  checkIdsToSearch = async (
    idsToSearch: Record<string, string[]>,
    items: RecentlyPlayedTrack[],
    force = false,
  ) => {
    const ids = Object.keys(idsToSearch);
    if (ids.length < 45 && !force) {
      return idsToSearch;
    }
    const searchedItems = await this.search(ids);
    for (const [index, searchedItem] of searchedItems.entries()) {
      const id = ids[index];
      if (!id) {
        continue;
      }
      if (searchedItem === null) {
        setToCacheString(this.userId.toString(), id, { exists: false });
        continue;
      }
      const playedAt = idsToSearch[searchedItem.id];
      if (!playedAt) {
        logger.error('Cannot add item', searchedItem.id, 'no played_at found');
        continue;
      }
      // Convert TidalTrackResource to TidalTrack format
      const tidalTrack = {
        ...searchedItem,
        attributes: {
          ...searchedItem.attributes,
          explicit: false, // Default value since TidalTrackResource doesn't include this
          duration: searchedItem.attributes.duration || 0,
        },
        relationships: {
          artists: searchedItem.relationships?.artists || { data: [] },
          album: searchedItem.relationships?.albums?.data?.[0] ? { data: searchedItem.relationships.albums.data[0] } : { data: { id: '', type: 'album' } },
        }
      };
      
      setToCacheString(this.userId.toString(), searchedItem.id, {
        exists: true,
        track: tidalTrack,
      });
      playedAt.forEach(pa => {
        items.push({ track: tidalTrack, played_at: pa });
      });
      logger.info(
        `Adding ${searchedItem.attributes.title} - ${searchedItem.relationships?.artists?.data?.[0]?.id || 'unknown'} from data`,
      );
    }
    idsToSearch = {};
    return idsToSearch;
  };

  run = async (id: string) => {
    this.id = id;
    let items: RecentlyPlayedTrack[] = [];
    // Id of song to played_at
    let idsToSearch: Record<string, string[]> = {};
    if (!this.elements) {
      return false;
    }
    for (let i = this.currentItem; i < this.elements.length; i += 1) {
      this.currentItem = i;
      logger.info(`Importing... (${i}/${this.elements.length})`);
      const content = this.elements[i]!;
      if (
        !content.tidal_track_uri ||
        !content.master_metadata_track_name ||
        !content.master_metadata_album_artist_name
      ) {
        continue;
      }
      if (content.ms_played < 30 * 1000) {
        // If track was played for less than 30 seconds
        logger.info(
          `Track ${content.master_metadata_track_name} - ${
            content.master_metadata_album_artist_name
          } was passed, only listened for ${Math.floor(
            content.ms_played / 1000,
          )} seconds`,
        );
        continue;
      }
      const tidalId = FullPrivacyImporter.idFromTidalURI(
        content.tidal_track_uri,
      );
      if (!tidalId) {
        logger.warn(
          `Could not get tidal id from uri: ${content.tidal_track_uri}`,
        );
        continue;
      }
      const item = getFromCacheString(this.userId.toString(), tidalId);
      if (!item) {
        const arrayOfPlayedAt = idsToSearch[tidalId] ?? [];
        arrayOfPlayedAt.push(content.ts);
        idsToSearch[tidalId] = arrayOfPlayedAt;
        idsToSearch = await this.checkIdsToSearch(idsToSearch, items);
      } else if (item.exists) {
        items.push({ track: item.track, played_at: content.ts });
      }
      if (items.length >= 20) {
        await this.storeItems(this.userId, items);
        items = [];
      }
    }
    await this.checkIdsToSearch(idsToSearch, items, true);
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
