import type PlexAPI from '@server/api/plexapi';
import TraktAPI, { type TraktListResponse } from '@server/api/trakt';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { In } from 'typeorm';
import Media from '@server/entity/Media';
import { createOrUpdateCollection } from '@server/lib/collectionsUtils';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { BaseCollectionSync } from './BaseCollectionSync';
import { autoRequestService } from './AutoRequestService';
import type {
  CollectionItem,
  SyncResult,
  CollectionOperationResult,
  CollectionSyncOptions,
  MissingItem,
  FilteringStats,
  TraktTemplateContext,
  TraktSourceData,
} from './types';
import { CollectionSyncErrorType } from './types';

interface TraktCollectionItem extends CollectionItem {
  tmdbId: number;
}

// TraktSourceData interface is now imported from types.ts

/**
 * New Trakt Collection Sync implementation using the base class
 * 
 * Handles multiple Trakt API types (trending, popular, watched, custom lists)
 * with auto-request functionality and comprehensive error handling.
 */
export class TraktCollectionSync extends BaseCollectionSync {
  private traktClients: Map<string, TraktAPI> = new Map();

  constructor() {
    super('trakt');
  }

  /**
   * Validate that Trakt API is properly configured
   */
  protected async validateConfiguration(): Promise<void> {
    const settings = getSettings();
    if (!settings.trakt.apiKey) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'Trakt API key not configured'
      );
    }
  }

  /**
   * Process a single Trakt collection configuration
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
      if (!this.isValidTraktConfig(config)) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Invalid Trakt configuration: ${config.name}`
        );
      }

      // Fetch data from Trakt API
      const sourceData = await this.fetchSourceData(config, options);
      
      // Map to standardized format
      const { items, missingItems, stats } = await this.mapSourceDataToItems(sourceData, config);

      // Handle auto-requests for missing items
      if (missingItems && missingItems.length > 0) {
        await this.handleAutoRequests(missingItems, config);
      }

      if (items.length === 0) {
        logger.warn('No items to create collection from', {
          label: 'Trakt Collections',
          configName: config.name,
          originalStatsCount: stats?.original || 0,
          filteredCount: stats?.filtered || 0,
          removedCount: stats?.removed || 0,
        });
        return { created: 0, updated: 0 };
      }

      // Process collections based on media type configuration
      if (config.mediaType === 'both') {
        return await this.processBothMediaTypes(
          items,
          config,
          plexClient,
          allCollections,
          processedCollectionKeys,
          stats
        );
      } else {
        return await this.processSingleMediaType(
          items,
          config,
          plexClient,
          allCollections,
          processedCollectionKeys,
          stats
        );
      }
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process Trakt collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create template context for Trakt collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<TraktTemplateContext> {
    const statType = this.getStatTypeFromSubtype(config.subtype);
    
    return this.templateEngine.createTraktContext(
      mediaType,
      statType || 'trending'
    ) as TraktTemplateContext;
  }

  /**
   * Fetch data from Trakt API
   */
  protected async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions
  ): Promise<TraktSourceData[]> {
    const settings = getSettings();
    const apiKey = settings.trakt.apiKey;
    if (!apiKey) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'Trakt API key not configured'
      );
    }
    const traktClient = this.getTraktClient(apiKey);
    const statType = this.getStatTypeFromSubtype(config.subtype);
    
    const traktData: TraktSourceData[] = [];

    if (options?.apiTimeout) {
      logger.debug(`API timeout set to ${options.apiTimeout}ms`, {
        label: 'Trakt Collections',
      });
    }

    try {
      switch (statType) {
        case 'trending':
          if (config.mediaType === 'movie' || config.mediaType === 'both') {
            const movieData = await traktClient.getTrending('movies', config.maxItems);
            traktData.push(...movieData);
          }
          if (config.mediaType === 'tv' || config.mediaType === 'both') {
            const showData = await traktClient.getTrending('shows', config.maxItems);
            traktData.push(...showData);
          }
          break;

        case 'popular':
          if (config.mediaType === 'movie' || config.mediaType === 'both') {
            const movieData = await traktClient.getPopular('movies', config.maxItems);
            traktData.push(...movieData);
          }
          if (config.mediaType === 'tv' || config.mediaType === 'both') {
            const showData = await traktClient.getPopular('shows', config.maxItems);
            traktData.push(...showData);
          }
          break;

        case 'watched': {
          const period = this.getPeriodFromConfig(config);
          if (config.mediaType === 'movie' || config.mediaType === 'both') {
            const movieData = await traktClient.getWatched('movies', period, config.maxItems);
            traktData.push(...movieData);
          }
          if (config.mediaType === 'tv' || config.mediaType === 'both') {
            const showData = await traktClient.getWatched('shows', period, config.maxItems);
            traktData.push(...showData);
          }
          break;
        }

        case 'custom': {
          if (!config.traktCustomListUrl) {
            throw this.createSyncError(
              CollectionSyncErrorType.CONFIGURATION_ERROR,
              'Custom Trakt list URL is required for custom list collections'
            );
          }

          // Strip query parameters from URL before calling Trakt API
          const cleanUrl = config.traktCustomListUrl?.split('?')[0] || config.traktCustomListUrl;
          let customListData = await traktClient.getCustomList(
            cleanUrl,
            config.maxItems
          );

          // Smart promotion: Convert episodes/seasons to their parent shows, and include full movies/shows
          customListData = customListData.map((item): TraktListResponse => {
            // If it's an episode or season, promote it to the parent show
            if (item.episode && item.episode.show) {
              return {
                ...item,
                type: 'show' as const,
                show: item.episode.show,
                movie: undefined, // Clear any movie data
                episode: undefined // Clear episode data to avoid confusion
              };
            }
            if (item.season && item.season.show) {
              return {
                ...item,
                type: 'show' as const, 
                show: item.season.show,
                movie: undefined, // Clear any movie data
                season: undefined // Clear season data to avoid confusion
              };
            }
            // Return movies and shows as-is
            return item;
          }).filter((item) => {
            // Only include items that now have proper movie or show data with TMDB IDs
            const hasValidMovie = item.movie && item.movie.ids && item.movie.ids.tmdb;
            const hasValidShow = item.show && item.show.ids && item.show.ids.tmdb;
            return hasValidMovie || hasValidShow;
          });

          // Filter by media type if specified
          if (config.mediaType && config.mediaType !== 'both') {
            const targetType = config.mediaType === 'movie' ? 'movie' : 'show';
            customListData = customListData.filter(
              (item) =>
                (item.movie && targetType === 'movie') ||
                (item.show && targetType === 'show')
            );
          }

          // Apply ordering modifications
          customListData = this.applyOrderingOptions(customListData, config);

          traktData.push(...customListData);
          break;
        }

        default:
          throw this.createSyncError(
            CollectionSyncErrorType.API_ERROR,
            `Unknown Trakt stat type: ${statType} (from subtype: ${config.subtype})`
          );
      }

      return traktData;
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch data from Trakt API`,
        { statType, mediaType: config.mediaType },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Map Trakt source data to standardized collection items
   */
  protected async mapSourceDataToItems(
    sourceData: TraktSourceData[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    config?: CollectionConfig
  ): Promise<{
    items: TraktCollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    const mediaRepository = getRepository(Media);
    const mappedItems: TraktCollectionItem[] = [];
    const missingItems: MissingItem[] = [];

    // Extract all TMDB IDs and prepare lookup data
    const traktLookups: { tmdbId: number; mediaType: 'movie' | 'tv'; title: string }[] = [];
    for (const item of sourceData) {
      try {
        const mediaItem = item.movie || item.show;
        if (!mediaItem?.ids?.tmdb) continue;

        const tmdbId = mediaItem.ids.tmdb;
        const mediaType = item.movie ? 'movie' : 'tv';
        traktLookups.push({ tmdbId, mediaType, title: mediaItem.title });
      } catch (error) {
        logger.warn(`Failed to process Trakt item: ${error}`, {
          label: 'Trakt Collections',
        });
      }
    }

    // Fetch all media in a single batch query to avoid N+1
    const tmdbIds = traktLookups.map(lookup => lookup.tmdbId);
    const allMedia = await mediaRepository.find({
      where: { tmdbId: In(tmdbIds) },
      select: ['tmdbId', 'mediaType', 'ratingKey']
    });

    // Create a lookup map for O(1) access
    const mediaLookup = new Map<string, Media>();
    for (const media of allMedia) {
      const key = `${media.tmdbId}-${media.mediaType}`;
      mediaLookup.set(key, media);
    }

    // Process items using the lookup map
    for (const lookup of traktLookups) {
      const mediaTypeEnum = lookup.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV;
      const key = `${lookup.tmdbId}-${mediaTypeEnum}`;
      const media = mediaLookup.get(key);

      if (media?.ratingKey) {
        mappedItems.push({
          ratingKey: media.ratingKey,
          title: lookup.title,
          type: lookup.mediaType,
          tmdbId: lookup.tmdbId,
        });
      } else {
        // Item exists in Trakt but not in Plex/Overseerr
        missingItems.push({
          tmdbId: lookup.tmdbId,
          mediaType: lookup.mediaType,
          title: lookup.title,
        });
      }
    }

    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'missing from plex': missingItems.length,
        'invalid data': sourceData.length - mappedItems.length - missingItems.length,
      }
    );

    return {
      items: mappedItems,
      missingItems,
      stats,
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
      // For Trakt collections, we don't need a real user since we provide custom title and use global collection mode
      // The user parameter is ignored when customTitle and isGlobalCollection=true are provided
      const dummyUser = { id: 0 } as any; // Minimal object to satisfy function signature

      const result = await createOrUpdateCollection(
        dummyUser, // Not used due to customTitle + isGlobalCollection=true
        items,
        mediaType,
        plexClient,
        allCollections,
        config.visibilityConfig,
        collectionName,
        true, // isGlobalCollection
        `OverseerrTrakt${config.id}`, // Custom label
        processedCollectionKeys,
        config.sortOrderLibrary,
        (config as any)._totalCollectionsInLibrary,
        config.customPoster
      );

      return {
        isNew: result.isNew,
        hasChanges: result.hasChanges,
        collectionName,
        itemCount: items.length,
      };
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to create Trakt collection ${collectionName}`,
        { collectionName, itemCount: items.length },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Private helper methods

  /**
   * Apply ordering options (reverse, randomize) to data array
   */
  private applyOrderingOptions<T>(data: T[], config: CollectionConfig): T[] {
    let processedData = [...data];
    
    const shouldReverse = config.reverseOrder ?? false;
    const shouldRandomize = config.randomizeOrder ?? false;
    
    // Mutual exclusion: randomize takes precedence over reverse
    if (shouldRandomize) {
      // Fisher-Yates shuffle algorithm for true randomization
      for (let i = processedData.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [processedData[i], processedData[j]] = [processedData[j], processedData[i]];
      }
      
      logger.debug(`Applied randomization to ${processedData.length} items`, {
        label: 'Trakt Collections',
        collection: config.name
      });
    } else if (shouldReverse) {
      processedData = processedData.reverse();
      
      logger.debug(`Applied reverse order to ${processedData.length} items`, {
        label: 'Trakt Collections',  
        collection: config.name
      });
    }
    
    return processedData;
  }

  private getTraktClient(apiKey: string): TraktAPI {
    if (!this.traktClients.has(apiKey)) {
      this.traktClients.set(apiKey, new TraktAPI(apiKey));
    }
    return this.traktClients.get(apiKey)!;
  }

  private isValidTraktConfig(config: CollectionConfig): boolean {
    return (
      config.type === 'trakt' &&
      config.subtype !== undefined &&
      ['trending', 'popular', 'watched', 'custom'].some(type => 
        config.subtype.startsWith(type)
      )
    );
  }

  private getStatTypeFromSubtype(subtype: string | undefined): string {
    if (!subtype) return 'trending';
    
    // Handle special case for most_watched_* subtypes
    if (subtype.startsWith('most_watched_')) {
      return 'watched';
    }
    
    // Extract stat type from subtype (e.g., "trending_7_days" -> "trending")
    return subtype.split('_')[0];
  }

  private getPeriodFromConfig(config: CollectionConfig): 'weekly' | 'monthly' {
    // Derive period from subtype (e.g., 'most_watched_week' -> 'weekly', 'most_watched_month' -> 'monthly')
    if (config.subtype?.includes('month')) {
      return 'monthly';
    }
    return 'weekly'; // Default for week or any other subtype
  }

  private async handleAutoRequests(
    missingItems: MissingItem[],
    config: CollectionConfig
  ): Promise<void> {
    // Use the shared auto-request service
    await autoRequestService.processAutoRequests(missingItems, config, 'trakt');
  }


  private async processBothMediaTypes(
    items: TraktCollectionItem[],
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>,
    stats?: FilteringStats
  ): Promise<SyncResult> {
    let totalCreated = 0;
    let totalUpdated = 0;

    // Split items by media type
    const { movieItems, tvItems } = this.splitItemsByMediaType(items);

    // Process movies if we have any
    if (movieItems.length > 0) {
      const movieTemplate = config.customMovieTemplate || config.template || config.name;
      const movieContext = await this.createTemplateContext(config, 'movie');
      const movieCollectionName = this.templateEngine.processTemplate(
        movieTemplate,
        movieContext
      );
      
      const movieResult = await this.createCollection(
        movieItems,
        'movie',
        movieCollectionName,
        plexClient,
        allCollections,
        config,
        processedCollectionKeys
      );

      totalCreated += movieResult.isNew ? 1 : 0;
      totalUpdated += movieResult.hasChanges && !movieResult.isNew ? 1 : 0;
    } else {
      logger.warn('No movie items to create collection from', {
        label: 'Trakt Collections',
        configName: config.name,
      });
    }

    // Process TV shows if we have any
    if (tvItems.length > 0) {
      const tvTemplate = config.customTVTemplate || config.template || config.name;
      const tvContext = await this.createTemplateContext(config, 'tv');
      const tvCollectionName = this.templateEngine.processTemplate(
        tvTemplate,
        tvContext
      );

      const tvResult = await this.createCollection(
        tvItems,
        'tv',
        tvCollectionName,
        plexClient,
        allCollections,
        config,
        processedCollectionKeys
      );

      totalCreated += tvResult.isNew ? 1 : 0;
      totalUpdated += tvResult.hasChanges && !tvResult.isNew ? 1 : 0;
    } else {
      logger.warn('No TV items to create collection from', {
        label: 'Trakt Collections',
        configName: config.name,
      });
    }

    // Log filtering summary if stats are provided
    if (stats && stats.removed > 0) {
      logger.info(
        `Trakt collection processed: ${items.length} final items (${stats.removed} items filtered out from ${stats.original} total)`,
        {
          label: 'Trakt Collections',
          configName: config.name,
          finalItems: items.length,
          originalCount: stats.original,
          filteredCount: stats.filtered,
          removedCount: stats.removed,
        }
      );
    }

    return { created: totalCreated, updated: totalUpdated };
  }

  private async processSingleMediaType(
    items: TraktCollectionItem[],
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>,
    stats?: FilteringStats
  ): Promise<SyncResult> {
    const mediaType = config.mediaType as 'movie' | 'tv';
    const collectionName = await this.generateCollectionName(config, mediaType);

    const result = await this.createCollection(
      items,
      mediaType,
      collectionName,
      plexClient,
      allCollections,
      config,
      processedCollectionKeys
    );

    // Log filtering summary if stats are provided
    if (stats && stats.removed > 0) {
      logger.info(
        `Trakt collection processed: ${items.length} final items (${stats.removed} items filtered out from ${stats.original} total)`,
        {
          label: 'Trakt Collections',
          configName: config.name,
          finalItems: items.length,
          originalCount: stats.original,
          filteredCount: stats.filtered,
          removedCount: stats.removed,
        }
      );
    }

    return {
      created: result.isNew ? 1 : 0,
      updated: result.hasChanges && !result.isNew ? 1 : 0,
    };
  }
}

// Export the new implementation
export default TraktCollectionSync;