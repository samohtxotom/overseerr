import type PlexAPI from '@server/api/plexapi';
import TautulliAPI from '@server/api/tautulli';
import { createOrUpdateCollection } from '@server/lib/collectionsUtils';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { extractErrorMessage } from '@server/lib/utils/templateUtils';
import logger from '@server/logger';

interface TautulliCollectionItem {
  ratingKey: string;
  title: string;
  totalPlays: number;
  type: string;
}

class TautulliCollectionSync {
  private tautulliClient: TautulliAPI | null = null;

  private async getTautulliClient(): Promise<TautulliAPI> {
    if (this.tautulliClient) {
      return this.tautulliClient;
    }

    const settings = getSettings();
    if (!settings.tautulli.apiKey || !settings.tautulli.hostname) {
      throw new Error('Tautulli not configured');
    }

    this.tautulliClient = new TautulliAPI(settings.tautulli);
    return this.tautulliClient;
  }

  public async processTautulliCollections(
    collectionConfigs: CollectionConfig[],
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    const tautulliConfigs = collectionConfigs.filter(
      (config) =>
        config.type === 'tautulli' &&
        (config.subtype?.includes('most_popular') ||
          config.subtype?.includes('most_watched'))
    );

    if (tautulliConfigs.length === 0) {
      return { created: 0, updated: 0 };
    }

    try {
      const tautulli = await this.getTautulliClient();

      for (const config of tautulliConfigs) {
        const result = await this.processTautulliCollection(
          config,
          tautulli,
          plexClient,
          allCollections,
          processedCollectionKeys
        );

        created += result.created;
        updated += result.updated;
      }

      if (created > 0 || updated > 0) {
        logger.info(
          `Tautulli collection processing: ${created} created, ${updated} updated`,
          {
            label: 'Tautulli Collections',
          }
        );
      }

      return { created, updated };
    } catch (error) {
      logger.error(`Failed to process Tautulli collections: ${error}`, {
        label: 'Tautulli Collections',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { created: 0, updated: 0 };
    }
  }

  private async processTautulliCollection(
    config: CollectionConfig,
    tautulli: TautulliAPI,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    try {
      // Determine the number of days to use
      let timeRangeDays: number;

      if (config.customDays && config.customDays > 0) {
        // Use custom days if specified
        timeRangeDays = config.customDays;
      } else {
        // Fall back to legacy period mapping or subtype parsing for backwards compatibility
        if (config.period === 'week') {
          timeRangeDays = 7;
        } else if (config.period === 'month') {
          timeRangeDays = 30;
        } else if (config.subtype === 'most_popular_30_days') {
          timeRangeDays = 30;
        } else {
          // Default fallback
          timeRangeDays = 30;
        }
      }

      // Determine stat type (plays or duration)
      const statType = config.tautulliStatType || 'plays';

      // For single media type processing, use the specified mediaType
      // For 'both', we'll process separately (legacy behavior maintained)
      const mediaType =
        config.mediaType === 'both' ? 'movie' : config.mediaType;

      if (config.mediaType === 'both') {
        // Process both movies and TV shows
        let totalCreated = 0;
        let totalUpdated = 0;

        // Movies

        const collectionType = config.subtype.includes('most_popular')
          ? 'most_popular'
          : 'most_watched';
        const movieStats = await tautulli.getContent(
          'movie',
          timeRangeDays,
          statType,
          collectionType,
          config.maxItems
        );

        const movieResult = await this.mapTautulliToPlexItems(movieStats);
        const movieItems = movieResult.items;

        if (movieItems.length > 0) {
          const movieTemplate =
            config.mediaType === 'both' && config.customMovieTemplate
              ? config.customMovieTemplate
              : config.template;

          const movieCollectionName = movieTemplate
            .replace('{mediaType}', 'Movies')
            .replace('{days}', timeRangeDays.toString())
            .replace('{customdays}', timeRangeDays.toString())
            .replace(
              '{statType}',
              statType === 'plays' ? 'Play Count' : 'Watch Duration'
            )
            .replace('{servername}', await this.getPlexServerName())
            .replace('{subtype}', this.getSubtypeLabel(config.subtype));

          const movieCollectionResult = await this.createTautulliCollection(
            movieItems,
            'movie',
            movieCollectionName,
            plexClient,
            allCollections,
            `OverseerrTautulli${config.id}`,
            processedCollectionKeys,
            movieResult.stats
          );

          totalCreated += movieCollectionResult.created;
          totalUpdated += movieCollectionResult.updated;
        } else {
          logger.warn('No movie items to create collection from', {
            label: 'Tautulli Collections',
            configName: config.name,
          });
        }

        // TV Shows

        const tvStats = await tautulli.getContent(
          'tv',
          timeRangeDays,
          statType,
          collectionType,
          config.maxItems
        );

        const tvResult = await this.mapTautulliToPlexItems(tvStats);
        const tvItems = tvResult.items;

        if (tvItems.length > 0) {
          const tvTemplate =
            config.mediaType === 'both' && config.customTVTemplate
              ? config.customTVTemplate
              : config.template;

          const tvCollectionName = tvTemplate
            .replace('{mediaType}', 'TV Shows')
            .replace('{days}', timeRangeDays.toString())
            .replace('{customdays}', timeRangeDays.toString())
            .replace(
              '{statType}',
              statType === 'plays' ? 'Play Count' : 'Watch Duration'
            )
            .replace('{servername}', await this.getPlexServerName())
            .replace('{subtype}', this.getSubtypeLabel(config.subtype));

          const tvCollectionResult = await this.createTautulliCollection(
            tvItems,
            'tv',
            tvCollectionName,
            plexClient,
            allCollections,
            `OverseerrTautulli${config.id}`,
            processedCollectionKeys,
            tvResult.stats
          );

          totalCreated += tvCollectionResult.created;
          totalUpdated += tvCollectionResult.updated;
        } else {
          logger.warn('No TV items to create collection from', {
            label: 'Tautulli Collections',
            configName: config.name,
          });
        }

        return { created: totalCreated, updated: totalUpdated };
      } else {
        // Process single media type

        const collectionType = config.subtype.includes('most_popular')
          ? 'most_popular'
          : 'most_watched';
        const stats = await tautulli.getContent(
          mediaType!,
          timeRangeDays,
          statType,
          collectionType,
          config.maxItems
        );

        const mappingResult = await this.mapTautulliToPlexItems(stats);
        const plexItems = mappingResult.items;

        if (plexItems.length === 0) {
          logger.warn('No items to create collection from', {
            label: 'Tautulli Collections',
            configName: config.name,
            originalStatsCount: mappingResult.stats.original,
            filteredCount: mappingResult.stats.filtered,
            removedCount: mappingResult.stats.removed,
          });
          return { created: 0, updated: 0 };
        }

        const singleCollectionName = config.template
          .replace('{mediaType}', mediaType === 'movie' ? 'Movies' : 'TV Shows')
          .replace('{days}', timeRangeDays.toString())
          .replace('{customdays}', timeRangeDays.toString())
          .replace(
            '{statType}',
            statType === 'plays' ? 'Play Count' : 'Watch Duration'
          )
          .replace('{servername}', await this.getPlexServerName())
          .replace('{subtype}', this.getSubtypeLabel(config.subtype));

        const result = await this.createTautulliCollection(
          plexItems,
          mediaType!,
          singleCollectionName,
          plexClient,
          allCollections,
          `OverseerrTautulli${config.id}`,
          processedCollectionKeys,
          mappingResult.stats
        );

        return result;
      }
    } catch (error) {
      logger.error(
        `Failed to process Tautulli collection ${config.name}: ${error}`,
        {
          label: 'Tautulli Collections',
          configName: config.name,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      return { created: 0, updated: 0 };
    }
  }

  private async processWeeklyCollection(
    tautulli: TautulliAPI,
    mediaType: 'movie' | 'tv',
    plexClient: PlexAPI,
    allCollections: any[],
    limit: number
  ): Promise<{ created: number; updated: number }> {
    try {
      const stats = await tautulli.getMostWatchedContent(
        mediaType,
        7,
        'plays',
        limit
      );
      const mappingResult = await this.mapTautulliToPlexItems(stats);
      const plexItems = mappingResult.items;

      if (plexItems.length === 0) {
        return { created: 0, updated: 0 };
      }

      const collectionName = `📊 Most Watched ${
        mediaType === 'movie' ? 'Movies' : 'TV Shows'
      } This Week`;

      return await this.createTautulliCollection(
        plexItems,
        mediaType,
        collectionName,
        plexClient,
        allCollections,
        undefined, // customLabel
        undefined, // processedCollectionKeys not available in legacy methods
        mappingResult.stats
      );
    } catch (error) {
      logger.error(
        `Failed to process weekly ${mediaType} collection: ${error}`,
        {
          label: 'Tautulli Collections',
        }
      );
      return { created: 0, updated: 0 };
    }
  }

  private async processMonthlyCollection(
    tautulli: TautulliAPI,
    mediaType: 'movie' | 'tv',
    plexClient: PlexAPI,
    allCollections: any[],
    limit: number
  ): Promise<{ created: number; updated: number }> {
    try {
      const stats = await tautulli.getMostWatchedContent(
        mediaType,
        30,
        'plays',
        limit
      );
      const mappingResult = await this.mapTautulliToPlexItems(stats);
      const plexItems = mappingResult.items;

      if (plexItems.length === 0) {
        return { created: 0, updated: 0 };
      }

      const collectionName = `📈 Most Watched ${
        mediaType === 'movie' ? 'Movies' : 'TV Shows'
      } This Month`;

      return await this.createTautulliCollection(
        plexItems,
        mediaType,
        collectionName,
        plexClient,
        allCollections,
        undefined, // customLabel
        undefined, // processedCollectionKeys not available in legacy methods
        mappingResult.stats
      );
    } catch (error) {
      logger.error(
        `Failed to process monthly ${mediaType} collection: ${error}`,
        {
          label: 'Tautulli Collections',
        }
      );
      return { created: 0, updated: 0 };
    }
  }

  private async mapTautulliToPlexItems(
    tautulliStats: any[]
  ): Promise<{
    items: TautulliCollectionItem[];
    stats: { original: number; filtered: number; removed: number };
  }> {
    const minimumPlays = 3; // Default minimum plays requirement

    const filteredItems = tautulliStats.filter((item) => {
      // More robust validation
      const totalPlays = item.total_plays || item.plays || 0;
      const hasRatingKey = item.rating_key || item.grandparent_rating_key;
      const passesFilter = totalPlays >= minimumPlays && hasRatingKey;

      if (!passesFilter) {
        logger.debug('Item filtered out', {
          label: 'Tautulli Collections',
          title: item.title || item.grandparent_title,
          totalPlays,
          hasRatingKey: !!hasRatingKey,
          reason:
            totalPlays < minimumPlays ? 'insufficient plays' : 'no rating key',
        });
      }

      return passesFilter;
    });

    const mappedItems = filteredItems
      .map((item) => ({
        ratingKey: (item.rating_key || item.grandparent_rating_key)?.toString(),
        title: item.title || item.grandparent_title || 'Unknown',
        totalPlays: item.total_plays || item.plays || 0,
        type: item.media_type || (item.grandparent_title ? 'tv' : 'movie'),
      }))
      .filter((item) => item.ratingKey && item.title !== 'Unknown'); // Final safety check

    return {
      items: mappedItems,
      stats: {
        original: tautulliStats.length,
        filtered: filteredItems.length,
        removed: tautulliStats.length - filteredItems.length,
      },
    };
  }

  private async createTautulliCollection(
    items: TautulliCollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: any[],
    customLabel?: string,
    processedCollectionKeys?: Set<string>,
    filteringStats?: { original: number; filtered: number; removed: number }
  ): Promise<{ created: number; updated: number }> {
    try {
      // Create a fake user object for Tautulli collections
      const tautulliUser = {
        id: 0,
        plexId: null,
        displayName: 'Tautulli Statistics',
        plexUsername: 'tautulli',
        plexTitle: 'Statistics',
        username: 'tautulli',
        email: 'tautulli@overseerr',
      } as any;

      const result = await createOrUpdateCollection(
        tautulliUser,
        items,
        mediaType,
        plexClient,
        allCollections,
        collectionName,
        'shared', // Visible to all users
        true, // isTautulliCollection
        customLabel, // Use custom label if provided
        processedCollectionKeys // Pass through processedCollectionKeys parameter
      );

      const finalResult = {
        created: result.isNew ? 1 : 0,
        updated: result.hasChanges && !result.isNew ? 1 : 0,
      };

      // Log filtering summary if stats are provided
      if (filteringStats && filteringStats.removed > 0) {
        logger.info(
          `Tautulli collection created: ${items.length} final items (${filteringStats.removed} items filtered out from ${filteringStats.original} total)`,
          {
            label: 'Tautulli Collections',
            collectionName,
            finalItems: items.length,
            originalCount: filteringStats.original,
            filteredCount: filteringStats.filtered,
            removedCount: filteringStats.removed,
          }
        );
      }

      return finalResult;
    } catch (error) {
      logger.error(
        `Failed to create Tautulli collection ${collectionName}: ${extractErrorMessage(
          error
        )}`,
        {
          label: 'Tautulli Collections',
          collectionName,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          itemCount: items.length,
        }
      );
      return { created: 0, updated: 0 };
    }
  }

  /**
   * Get the Plex server name from settings
   */
  private async getPlexServerName(): Promise<string> {
    const settings = getSettings();
    return settings.plex.name || 'Plex Server';
  }

  /**
   * Get human-readable label for subtype (clean, without " - Play Count" etc)
   */
  private getSubtypeLabel(subtype: string): string {
    switch (subtype) {
      case 'most_popular_plays':
      case 'most_popular_duration':
        return 'Most Popular';
      case 'most_watched_plays':
      case 'most_watched_duration':
        return 'Most Watched';
      default:
        return subtype;
    }
  }
}

export default TautulliCollectionSync;
