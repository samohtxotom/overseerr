import type PlexAPI from '@server/api/plexapi';
import TautulliAPI from '@server/api/tautulli';
// Legacy import removed - now using standardized approach via BaseCollectionSync
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
// import { extractErrorMessage } from '@server/lib/utils/templateUtils'; // Not needed in new implementation
import logger from '@server/logger';
import { COLLECTION_LIMITS, getRuntimeConfig } from './ConfigurationConstants';
import { BaseCollectionSync } from './BaseCollectionSync';
import type {
  CollectionItem,
  SyncResult,
  CollectionOperationResult,
  CollectionSyncOptions,
  MissingItem,
  FilteringStats,
  TautulliSourceData,
} from './types';
import { CollectionSyncErrorType } from './types';

interface TautulliCollectionItem extends CollectionItem {
  totalPlays: number;
}

// TautulliSourceData interface is now imported from types.ts

/**
 * New Tautulli Collection Sync implementation using the base class
 * 
 * This implementation uses the shared foundation utilities and follows
 * the standardized pipeline while maintaining identical functionality
 * to the original TautulliCollectionSync class.
 */
export class TautulliCollectionSync extends BaseCollectionSync {
  private tautulliClient: TautulliAPI | null = null;

  constructor() {
    super('tautulli');
  }

  /**
   * Validate that Tautulli is properly configured
   */
  protected async validateConfiguration(): Promise<void> {
    const settings = getSettings();
    if (!settings.tautulli.apiKey || !settings.tautulli.hostname) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'Tautulli not configured - missing API key or hostname'
      );
    }

    // Test connection by getting the client
    await this.getTautulliClient();
  }

  /**
   * Process a single Tautulli collection configuration
   */
  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>,
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    try {
      // Validate configuration
      if (!this.isValidTautulliConfig(config)) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Invalid Tautulli configuration: ${config.name}`
        );
      }

      // For 'both' media types, we need separate API calls for movies and TV
      if (config.mediaType === 'both') {
        return await this.processBothMediaTypesWithSeparateAPICalls(
          config,
          plexClient,
          allCollections,
          processedCollectionKeys,
          options
        );
      } else {
        // For single media type, use standard flow
        const sourceData = await this.fetchSourceData(config, options);
        const { items, stats } = await this.mapSourceDataToItems(sourceData, config);

        if (items.length === 0) {
          logger.warn('No items to create collection from', {
            label: 'Tautulli Collections',
            configName: config.name,
            originalStatsCount: stats?.original || 0,
            filteredCount: stats?.filtered || 0,
            removedCount: stats?.removed || 0,
          });
          return { created: 0, updated: 0 };
        }

        // Use the new media type processing strategy
        return await this.processWithMediaTypeStrategy(items, config, plexClient, allCollections, processedCollectionKeys);
      }
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process Tautulli collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create template context for Tautulli collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<any> {
    const timeRangeDays = this.getTimeRangeDays(config);
    const statType = config.tautulliStatType || 'plays';
    const subtype = this.getSubtypeFromConfig(config);

    return this.templateEngine.createTautulliContext(
      mediaType,
      timeRangeDays,
      statType,
      subtype
    );
  }

  /**
   * Fetch data from Tautulli API
   */
  protected async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions
  ): Promise<TautulliSourceData[]> {
    const tautulli = await this.getTautulliClient();
    const timeRangeDays = this.getTimeRangeDays(config);
    const statType = config.tautulliStatType || 'plays';
    const collectionType = this.getCollectionTypeFromSubtype(config.subtype);
    
    // For single media type processing, use the specified mediaType
    // For 'both', we'll fetch both types separately in the caller
    const mediaType = config.mediaType === 'both' ? 'movie' : config.mediaType;

    if (options?.apiTimeout) {
      // Note: TautulliAPI doesn't currently support timeout, but we could extend it
      logger.debug(`API timeout set to ${options.apiTimeout}ms`, {
        label: 'Tautulli Collections',
      });
    }

    const tautulliStats = await tautulli.getContent(
      mediaType!,
      timeRangeDays,
      statType,
      collectionType,
      config.maxItems
    );

    // Convert TautulliHomeStatRow[] to TautulliSourceData[] - the old code worked directly with the raw data
    return tautulliStats as TautulliSourceData[];
  }

  /**
   * Map Tautulli source data to standardized collection items
   */
  protected async mapSourceDataToItems(
    sourceData: TautulliSourceData[],
    config?: CollectionConfig
  ): Promise<{
    items: TautulliCollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    const minimumPlays = COLLECTION_LIMITS.MINIMUM_PLAYS;

    const filteredItems = sourceData.filter((item) => {
      const totalPlays = item.total_plays || item.plays || 0;
      const hasRatingKey = item.rating_key || item.grandparent_rating_key;
      return totalPlays >= minimumPlays && hasRatingKey;
    });

    const mappedItems: TautulliCollectionItem[] = filteredItems
      .map((item) => ({
        ratingKey: (item.rating_key || item.grandparent_rating_key)?.toString() || '',
        title: item.title || item.grandparent_title || 'Unknown',
        totalPlays: item.total_plays || item.plays || 0,
        type: (item.media_type || (item.grandparent_title ? 'tv' : 'movie')) as 'movie' | 'tv',
      }))
      .filter((item) => item.ratingKey && item.title !== 'Unknown');

    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'insufficient plays': sourceData.length - filteredItems.length,
        'missing rating key': filteredItems.length - mappedItems.length,
      }
    );

    return {
      items: mappedItems,
      stats,
      missingItems: [],
    };
  }

  /**
   * Create collection in Plex
   */
  protected async createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: any[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>
  ): Promise<CollectionOperationResult> {
    try {
      // Use the new standardized approach via BaseCollectionSync
      const result = await this.createOrUpdateCollectionStandardized(
        items,
        collectionName,
        mediaType,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys
      );

      // Update config with rating key if we got one
      this.updateConfigWithRatingKey(config, result.collectionRatingKey);

      return {
        created: result.created,
        updated: result.updated,
        collectionRatingKey: result.collectionRatingKey,
        itemCount: result.itemCount || items.length,
        stats: result.stats,
      };
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to create Tautulli collection ${collectionName}`,
        { collectionName, itemCount: items.length },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Private helper methods

  private async getTautulliClient(): Promise<TautulliAPI> {
    if (this.tautulliClient) {
      return this.tautulliClient;
    }

    const settings = getSettings();
    this.tautulliClient = new TautulliAPI(settings.tautulli);
    return this.tautulliClient;
  }

  private isValidTautulliConfig(config: CollectionConfig): boolean {
    return (
      config.type === 'tautulli' &&
      (config.subtype?.includes('most_popular') ||
        config.subtype?.includes('most_watched'))
    );
  }

  private getTimeRangeDays(config: CollectionConfig): number {
    // New implementation only supports modern customDays config
    return config.customDays && config.customDays > 0 ? config.customDays : COLLECTION_LIMITS.DEFAULT_TIME_PERIOD_DAYS;
  }

  private getSubtypeFromConfig(config: CollectionConfig): string {
    return config.subtype || 'most_popular';
  }

  private getCollectionTypeFromSubtype(subtype: string): 'most_popular' | 'most_watched' {
    return subtype.includes('most_popular') ? 'most_popular' : 'most_watched';
  }

  /**
   * Process 'both' media types with separate API calls (like legacy implementation)
   */
  private async processBothMediaTypesWithSeparateAPICalls(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>,
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    let totalCreated = 0;
    let totalUpdated = 0;

    const tautulli = await this.getTautulliClient();
    const timeRangeDays = this.getTimeRangeDays(config);
    const statType = config.tautulliStatType || 'plays';
    const collectionType = this.getCollectionTypeFromSubtype(config.subtype);

    // Process Movies
    try {
      const movieSourceData = await tautulli.getContent(
        'movie',
        timeRangeDays,
        statType,
        collectionType,
        config.maxItems
      );

      const { items: movieItems, stats: movieStats } = await this.mapSourceDataToItems(movieSourceData, config);

      if (movieItems.length > 0) {
        const movieCollectionName = await this.generateCollectionNameWithCustom(config, 'movie');
        const movieResult = await this.createCollection(
          movieItems,
          'movie',
          movieCollectionName,
          plexClient,
          allCollections,
          config,
          processedCollectionKeys
        );

        totalCreated += movieResult.created;
        totalUpdated += movieResult.updated;

        // Log movie processing stats
        if (movieStats && movieStats.removed > 0) {
          logger.info(
            `Tautulli movie collection processed: ${movieItems.length} final items (${movieStats.removed} items filtered out from ${movieStats.original} total)`,
            {
              label: 'Tautulli Collections',
              configName: config.name,
              mediaType: 'movie',
              finalItems: movieItems.length,
              originalCount: movieStats.original,
              removedCount: movieStats.removed,
            }
          );
        }
      } else {
        logger.warn('No movie items to create collection from', {
          label: 'Tautulli Collections',
          configName: config.name,
          originalStatsCount: movieStats?.original || 0,
          filteredCount: movieStats?.filtered || 0,
          removedCount: movieStats?.removed || 0,
        });
      }
    } catch (error) {
      logger.error(`Failed to process movie collection for ${config.name}`, {
        label: 'Tautulli Collections',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Process TV Shows  
    try {
      const tvSourceData = await tautulli.getContent(
        'tv',
        timeRangeDays,
        statType,
        collectionType,
        config.maxItems
      );

      const { items: tvItems, stats: tvStats } = await this.mapSourceDataToItems(tvSourceData, config);

      if (tvItems.length > 0) {
        const tvCollectionName = await this.generateCollectionNameWithCustom(config, 'tv');
        const tvResult = await this.createCollection(
          tvItems,
          'tv',
          tvCollectionName,
          plexClient,
          allCollections,
          config,
          processedCollectionKeys
        );

        totalCreated += tvResult.created;
        totalUpdated += tvResult.updated;

        // Log TV processing stats
        if (tvStats && tvStats.removed > 0) {
          logger.info(
            `Tautulli TV collection processed: ${tvItems.length} final items (${tvStats.removed} items filtered out from ${tvStats.original} total)`,
            {
              label: 'Tautulli Collections',
              configName: config.name,
              mediaType: 'tv',
              finalItems: tvItems.length,
              originalCount: tvStats.original,
              removedCount: tvStats.removed,
            }
          );
        }
      } else {
        logger.warn('No TV items to create collection from', {
          label: 'Tautulli Collections',
          configName: config.name,
          originalStatsCount: tvStats?.original || 0,
          filteredCount: tvStats?.filtered || 0,
          removedCount: tvStats?.removed || 0,
        });
      }
    } catch (error) {
      logger.error(`Failed to process TV collection for ${config.name}`, {
        label: 'Tautulli Collections',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return { created: totalCreated, updated: totalUpdated };
  }

}

// Export the new implementation
export default TautulliCollectionSync;