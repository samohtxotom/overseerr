import type { User } from '@server/entity/User';
import type { TautulliSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { uniqWith } from 'lodash';

export interface TautulliHistoryRecord {
  date: number;
  duration: number;
  friendly_name: string;
  full_title: string;
  grandparent_rating_key: number;
  grandparent_title: string;
  original_title: string;
  group_count: number;
  group_ids?: string;
  guid: string;
  ip_address: string;
  live: number;
  machine_id: string;
  media_index: number;
  media_type: string;
  originally_available_at: string;
  parent_media_index: number;
  parent_rating_key: number;
  parent_title: string;
  paused_counter: number;
  percent_complete: number;
  platform: string;
  product: string;
  player: string;
  rating_key: number;
  reference_id?: number;
  row_id?: number;
  session_key?: string;
  started: number;
  state?: string;
  stopped: number;
  thumb: string;
  title: string;
  transcode_decision: string;
  user: string;
  user_id: number;
  watched_status: number;
  year: number;
}

interface TautulliHistoryResponse {
  response: {
    result: string;
    message?: string;
    data: {
      draw: number;
      recordsTotal: number;
      recordsFiltered: number;
      total_duration: string;
      filter_duration: string;
      data: TautulliHistoryRecord[];
    };
  };
}

interface TautulliWatchStats {
  query_days: number;
  total_time: number;
  total_plays: number;
}

interface TautulliWatchStatsResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliWatchStats[];
  };
}

interface TautulliWatchUser {
  friendly_name: string;
  user_id: number;
  user_thumb: string;
  username: string;
  total_plays: number;
  total_time: number;
}

interface TautulliWatchUsersResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliWatchUser[];
  };
}

interface TautulliInfo {
  tautulli_install_type: string;
  tautulli_version: string;
  tautulli_branch: string;
  tautulli_commit: string;
  tautulli_platform: string;
  tautulli_platform_release: string;
  tautulli_platform_version: string;
  tautulli_platform_linux_distro: string;
  tautulli_platform_device_name: string;
  tautulli_python_version: string;
}

interface TautulliInfoResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliInfo;
  };
}

interface TautulliHomeStatRow {
  rating_key: string;
  title: string;
  total_plays: number;
  media_type: string;
  grandparent_rating_key?: string;
  grandparent_title?: string;
  plays?: number;
}

interface TautulliHomeStat {
  stat_id: string;
  stat_type?: string;
  rows: TautulliHomeStatRow[];
}

interface TautulliHomeStatsResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliHomeStat[];
  };
}

class TautulliAPI {
  private axios: AxiosInstance;

  constructor(settings: TautulliSettings) {
    this.axios = axios.create({
      baseURL: `${settings.useSsl ? 'https' : 'http'}://${settings.hostname}:${
        settings.port
      }${settings.urlBase ?? ''}`,
      params: { apikey: settings.apiKey },
    });
  }

  public async getInfo(): Promise<TautulliInfo> {
    try {
      return (
        await this.axios.get<TautulliInfoResponse>('/api/v2', {
          params: { cmd: 'get_tautulli_info' },
        })
      ).data.response.data;
    } catch (e) {
      logger.error('Something went wrong fetching Tautulli server info', {
        label: 'Tautulli API',
        errorMessage: e.message,
      });
      throw new Error(
        `[Tautulli] Failed to fetch Tautulli server info: ${e.message}`
      );
    }
  }

  public async getMediaWatchStats(
    ratingKey: string
  ): Promise<TautulliWatchStats[]> {
    try {
      return (
        await this.axios.get<TautulliWatchStatsResponse>('/api/v2', {
          params: {
            cmd: 'get_item_watch_time_stats',
            rating_key: ratingKey,
            grouping: 1,
          },
        })
      ).data.response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching media watch stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          ratingKey,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch media watch stats: ${e.message}`
      );
    }
  }

  public async getMediaWatchUsers(
    ratingKey: string
  ): Promise<TautulliWatchUser[]> {
    try {
      return (
        await this.axios.get<TautulliWatchUsersResponse>('/api/v2', {
          params: {
            cmd: 'get_item_user_stats',
            rating_key: ratingKey,
            grouping: 1,
          },
        })
      ).data.response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching media watch users from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          ratingKey,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch media watch users: ${e.message}`
      );
    }
  }

  public async getUserWatchStats(user: User): Promise<TautulliWatchStats> {
    try {
      if (!user.plexId) {
        throw new Error('User does not have an associated Plex ID');
      }

      return (
        await this.axios.get<TautulliWatchStatsResponse>('/api/v2', {
          params: {
            cmd: 'get_user_watch_time_stats',
            user_id: user.plexId,
            query_days: 0,
            grouping: 1,
          },
        })
      ).data.response.data[0];
    } catch (e) {
      logger.error(
        'Something went wrong fetching user watch stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          user: user.displayName,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch user watch stats: ${e.message}`
      );
    }
  }

  public async getUserWatchHistory(
    user: User
  ): Promise<TautulliHistoryRecord[]> {
    let results: TautulliHistoryRecord[] = [];

    try {
      if (!user.plexId) {
        throw new Error('User does not have an associated Plex ID');
      }

      const take = 100;
      let start = 0;

      while (results.length < 20) {
        const tautulliData = (
          await this.axios.get<TautulliHistoryResponse>('/api/v2', {
            params: {
              cmd: 'get_history',
              grouping: 1,
              order_column: 'date',
              order_dir: 'desc',
              user_id: user.plexId,
              media_type: 'movie,episode',
              length: take,
              start,
            },
          })
        ).data.response.data.data;

        if (!tautulliData.length) {
          return results;
        }

        results = uniqWith(results.concat(tautulliData), (recordA, recordB) =>
          recordA.grandparent_rating_key && recordB.grandparent_rating_key
            ? recordA.grandparent_rating_key === recordB.grandparent_rating_key
            : recordA.parent_rating_key && recordB.parent_rating_key
            ? recordA.parent_rating_key === recordB.parent_rating_key
            : recordA.rating_key === recordB.rating_key
        );

        start += take;
      }

      return results.slice(0, 20);
    } catch (e) {
      logger.error(
        'Something went wrong fetching user watch history from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          user: user.displayName,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch user watch history: ${e.message}`
      );
    }
  }

  public async getHomeStats(
    timeRange = 30,
    statsType: 'plays' | 'duration' = 'plays',
    statId = 'top_movies',
    statsCount = 20,
    statsStart = 0
  ): Promise<TautulliHomeStatRow[]> {
    try {
      const response = await this.axios.get<TautulliHomeStatsResponse>(
        '/api/v2',
        {
          params: {
            cmd: 'get_home_stats',
            time_range: timeRange,
            stats_type: statsType,
            stat_id: statId,
            stats_count: statsCount,
            stats_start: statsStart,
          },
        }
      );

      const data = response.data.response.data;

      // When requesting a specific stat_id, Tautulli returns the stat object directly
      if (
        data &&
        typeof data === 'object' &&
        'stat_id' in data &&
        data.stat_id === statId
      ) {
        const statObject = data as unknown as TautulliHomeStat;
        return statObject.rows || [];
      }

      // Handle array format (when no specific stat_id is requested)
      if (Array.isArray(data) && data.length > 0) {
        // Handle the correct response structure
        if (data[0] && 'stat_id' in data[0]) {
          const statObject = data.find((stat) => stat.stat_id === statId);
          logger.info('Found stat object in array', {
            label: 'Tautulli API',
            statId,
            foundObject: !!statObject,
            rowsCount: statObject ? statObject.rows.length : 0,
            rows: statObject ? statObject.rows.slice(0, 3) : [],
          });
          return statObject ? statObject.rows : [];
        }

        // Fallback for backward compatibility - if data is already an array of rows
        logger.info('Using fallback data structure', {
          label: 'Tautulli API',
          dataLength: data.length,
          firstFewItems: data.slice(0, 3),
        });
        return data as unknown as TautulliHomeStatRow[];
      }

      logger.warn('No data returned from Tautulli', {
        label: 'Tautulli API',
        statId,
        timeRange,
        statsType,
      });

      return [];
    } catch (e) {
      logger.error('Something went wrong fetching home stats from Tautulli', {
        label: 'Tautulli API',
        errorMessage: e.message,
        timeRange,
        statsType,
        statId,
        statsCount,
        statsStart,
      });
      throw new Error(`[Tautulli] Failed to fetch home stats: ${e.message}`);
    }
  }

  public async getLibraryWatchTimeStats(
    sectionId: string,
    queryDays = '7,30'
  ): Promise<any[]> {
    try {
      return (
        await this.axios.get('/api/v2', {
          params: {
            cmd: 'get_library_watch_time_stats',
            section_id: sectionId,
            query_days: queryDays,
          },
        })
      ).data.response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching library watch time stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          sectionId,
          queryDays,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch library watch time stats: ${e.message}`
      );
    }
  }

  public async getContent(
    mediaType: 'movie' | 'tv',
    timeRangeDays = 30,
    statType: 'plays' | 'duration' = 'plays',
    collectionType: 'most_popular' | 'most_watched' = 'most_popular',
    limit = 20
  ): Promise<TautulliHomeStatRow[]> {
    try {
      // Determine the correct stat ID based on media type and collection type
      let statId: string;
      if (collectionType === 'most_popular') {
        statId = mediaType === 'movie' ? 'popular_movies' : 'popular_tv';
      } else {
        // most_watched
        statId = mediaType === 'movie' ? 'top_movies' : 'top_tv';
      }

      const stats = await this.getHomeStats(
        timeRangeDays,
        statType,
        statId,
        limit,
        0
      );

      // Return the stats (already limited by the API call)
      return stats;
    } catch (e) {
      logger.error('Something went wrong fetching content from Tautulli', {
        label: 'Tautulli API',
        errorMessage: e.message,
        mediaType,
        timeRangeDays,
        statType,
        collectionType,
        limit,
      });
      throw new Error(
        `[Tautulli] Failed to fetch ${collectionType} content: ${e.message}`
      );
    }
  }

  // Keep the old method for backwards compatibility, but make it use the new one
  public async getMostWatchedContent(
    mediaType: 'movie' | 'tv',
    timeRangeDays = 30,
    statType: 'plays' | 'duration' = 'plays',
    limit = 20
  ): Promise<TautulliHomeStatRow[]> {
    return this.getContent(
      mediaType,
      timeRangeDays,
      statType,
      'most_watched',
      limit
    );
  }
}

export default TautulliAPI;
