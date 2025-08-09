import TmdbAPI from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { In } from 'typeorm';
import Media from '@server/entity/Media';
// Legacy import removed - now using standardized approach via BaseCollectionSync
import { BaseCollectionSync } from './BaseCollectionSync';
import type { CollectionConfig } from '@server/lib/settings';
import { CollectionSyncErrorType } from './types';
import type { TmdbTemplateContext, TmdbSourceData, CollectionSyncOptions } from './types';
import { autoRequestService } from './AutoRequestService';

// TmdbSourceData interface is now imported from types.ts

/**
 * TMDb Collection Sync - Simple implementation for trending/popular/top-rated content
 */
export class TmdbCollectionSync extends BaseCollectionSync {
  private tmdbClient: TmdbAPI;

  constructor() {
    super('tmdb');
    this.tmdbClient = new TmdbAPI();
  }

  protected async validateConfiguration(): Promise<void> {
    try {
      await this.tmdbClient.getMovieTrending({ page: 1, timeWindow: 'day' });
    } catch (error) {
      throw this.createSyncError(CollectionSyncErrorType.CONFIGURATION_ERROR, 'TMDb API is not accessible');
    }
  }

  protected async fetchSourceData(
    config: CollectionConfig,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: CollectionSyncOptions
  ): Promise<TmdbSourceData[]> {
    const statType = config.subtype.split('_')[0];
    const tmdbData: TmdbSourceData[] = [];

    switch (statType) {
      case 'trending': {
        const timeWindow = config.subtype.includes('week') ? 'week' : 'day';
        if (config.mediaType === 'movie' || config.mediaType === 'both') {
          const data = await this.tmdbClient.getMovieTrending({ page: 1, timeWindow });
          tmdbData.push(...data.results.map(item => ({ ...item, media_type: 'movie' as const })));
        }
        if (config.mediaType === 'tv' || config.mediaType === 'both') {
          const data = await this.tmdbClient.getTvTrending({ page: 1, timeWindow });
          tmdbData.push(...data.results.map(item => ({ ...item, media_type: 'tv' as const })));
        }
        break;
      }
      case 'popular': {
        if (config.mediaType === 'movie' || config.mediaType === 'both') {
          const data = await this.tmdbClient.getDiscoverMovies({ sortBy: 'popularity.desc', page: 1 });
          tmdbData.push(...data.results.map(item => ({ ...item, media_type: 'movie' as const })));
        }
        if (config.mediaType === 'tv' || config.mediaType === 'both') {
          const data = await this.tmdbClient.getDiscoverTv({ sortBy: 'popularity.desc', page: 1 });
          tmdbData.push(...data.results.map(item => ({ ...item, media_type: 'tv' as const })));
        }
        break;
      }
      case 'top': {
        if (config.mediaType === 'movie' || config.mediaType === 'both') {
          const data = await this.tmdbClient.getDiscoverMovies({ sortBy: 'vote_average.desc', page: 1 });
          tmdbData.push(...data.results.map(item => ({ ...item, media_type: 'movie' as const })));
        }
        if (config.mediaType === 'tv' || config.mediaType === 'both') {
          const data = await this.tmdbClient.getDiscoverTv({ sortBy: 'vote_average.desc', page: 1 });
          tmdbData.push(...data.results.map(item => ({ ...item, media_type: 'tv' as const })));
        }
        break;
      }
      case 'custom': {
        if (!config.tmdbCustomListUrl) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            'Custom TMDb URL required'
          );
        }
        const urlMatch = config.tmdbCustomListUrl.match(/themoviedb\.org\/collection\/(\d+)/);
        if (!urlMatch) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            'Invalid TMDb collection URL'
          );
        }
        const collectionData = await this.tmdbClient.getCollection({ collectionId: parseInt(urlMatch[1], 10) });
        if (collectionData.parts) {
          tmdbData.push(...collectionData.parts.map(item => ({ ...item, media_type: 'movie' as const })));
        }
        break;
      }
    }

    return tmdbData.slice(0, config.maxItems);
  }

  protected async mapSourceDataToItems(
    sourceData: TmdbSourceData[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    config?: CollectionConfig
  ) {
    const mediaRepository = getRepository(Media);
    const mappedItems: any[] = [];
    const missingItems: any[] = [];

    // Extract all TMDB IDs and prepare lookup data
    const tmdbLookups: { tmdbId: number; mediaType: 'movie' | 'tv'; title: string }[] = [];
    for (const item of sourceData) {
      const tmdbId = item.id;
      const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
      const title = item.title || item.name || 'Unknown';
      tmdbLookups.push({ tmdbId, mediaType, title });
    }

    // Fetch all media in a single batch query to avoid N+1
    const tmdbIds = tmdbLookups.map(lookup => lookup.tmdbId);
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
    for (const lookup of tmdbLookups) {
      const mediaTypeEnum = lookup.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV;
      const key = `${lookup.tmdbId}-${mediaTypeEnum}`;
      const media = mediaLookup.get(key);

      if (media?.ratingKey) {
        mappedItems.push({ 
          ratingKey: media.ratingKey, 
          title: lookup.title, 
          type: lookup.mediaType, 
          tmdbId: lookup.tmdbId 
        });
      } else {
        missingItems.push({ 
          tmdbId: lookup.tmdbId, 
          mediaType: lookup.mediaType, 
          title: lookup.title 
        });
      }
    }

    const stats = this.createFilteringStats(sourceData.length, mappedItems.length, { 'missing from plex': missingItems.length });
    return { items: mappedItems, missingItems, stats };
  }

  protected async createTemplateContext(config: CollectionConfig, mediaType: 'movie' | 'tv'): Promise<TmdbTemplateContext> {
    return this.templateEngine.createTmdbContext(mediaType, config.subtype?.split('_')[0] || 'popular') as TmdbTemplateContext;
  }

  protected async processConfiguration(config: any, plexClient: any, allCollections: any[], processedCollectionKeys?: Set<string>) {
    const sourceData = await this.fetchSourceData(config);
    const { items, missingItems, stats } = await this.mapSourceDataToItems(sourceData);

    if (missingItems && missingItems.length > 0) {
      await this.handleAutoRequests(missingItems, config);
    }

    if (items.length === 0) return { created: 0, updated: 0 };

    // Use the new media type processing strategy
    return await this.processWithMediaTypeStrategy(items, config, plexClient, allCollections, processedCollectionKeys);
  }

  protected async createCollection(items: any[], mediaType: 'movie' | 'tv', collectionName: string, plexClient: any, allCollections: any[], config: any, processedCollectionKeys?: Set<string>) {
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
    
    return result;
  }

  private async handleAutoRequests(missingItems: any[], config: any): Promise<void> {
    // Use the shared auto-request service
    await autoRequestService.processAutoRequests(missingItems, config, 'tmdb');
  }

}

export default TmdbCollectionSync;