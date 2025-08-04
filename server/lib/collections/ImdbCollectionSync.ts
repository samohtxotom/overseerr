import type { ImdbListItem} from '@server/api/imdb';
import ImdbAPI, { ImdbTopList } from '@server/api/imdb';
import TmdbAPI from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { createOrUpdateCollection } from '@server/lib/collectionsUtils';
import { BaseCollectionSync } from './BaseCollectionSync';
import type { CollectionConfig } from '@server/lib/settings';
import { CollectionSyncErrorType } from './types';
import type { ImdbTemplateContext, ImdbSourceData, CollectionSyncOptions } from './types';
import { autoRequestService } from './AutoRequestService';
import logger from '@server/logger';

// ImdbSourceData interface is now imported from types.ts

/**
 * IMDb Collection Sync - Implementation for IMDb top lists and custom lists
 * 
 * Supports IMDb Top 250, Popular lists, and custom user lists.
 * Uses web scraping since IMDb doesn't have a public API for lists.
 */
export class ImdbCollectionSync extends BaseCollectionSync {
  private imdbClient: ImdbAPI;
  private tmdbClient: TmdbAPI;

  constructor() {
    super('imdb');
    this.imdbClient = new ImdbAPI();
    this.tmdbClient = new TmdbAPI();
  }

  protected async validateConfiguration(): Promise<void> {
    // IMDb lists are public and don't require API keys
    // For custom lists, we use simple axios approach so no complex validation needed
    // For predefined lists, we could validate but it's not critical since they're public
    
    logger.debug('IMDb configuration validation - skipping complex validation', {
      label: 'IMDb Collections Debug'
    });
    
    // No validation needed for IMDb since:
    // 1. Custom lists use simple axios (no complex dependencies)
    // 2. Predefined lists are public IMDb URLs
    // 3. Any connectivity issues will be caught during actual fetching
  }

  protected async fetchSourceData(
    config: CollectionConfig,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: CollectionSyncOptions
  ): Promise<ImdbSourceData[]> {
    try {
      let imdbData: ImdbListItem[] = [];

      if (config.subtype === 'custom') {
        // Custom IMDb list - use the simple approach that works in fetch-title
        if (!config.imdbCustomListUrl) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            'Custom IMDb list URL is required'
          );
        }

        // Use the same approach as fetch-title endpoint (which works)
        const axios = (await import('axios')).default;
        
        logger.debug(`Fetching IMDb custom list with simple approach: ${config.imdbCustomListUrl}`, {
          label: 'IMDb Collections',
          configName: config.name,
          url: config.imdbCustomListUrl
        });

        const response = await axios.get(config.imdbCustomListUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          timeout: 10000
        });

        // Parse the HTML to extract movie/TV show items
        imdbData = this.parseImdbListHtml(response.data, config.maxItems);
        
        logger.info(`Successfully fetched ${imdbData.length} items from IMDb custom list`, {
          label: 'IMDb Collections',
          configName: config.name,
          itemCount: imdbData.length
        });
      } else {
        // Predefined IMDb lists - use the same simple axios approach
        logger.debug('Using simple axios approach for predefined IMDb list', {
          label: 'IMDb Collections Debug',
          configName: config.name,
          subtype: config.subtype,
          mediaType: config.mediaType
        });

        const predefinedUrl = this.getPredefinedListUrl(config.subtype, config.mediaType);
        const axios = (await import('axios')).default;
        
        logger.debug(`Fetching predefined IMDb list: ${predefinedUrl}`, {
          label: 'IMDb Collections Debug',
          configName: config.name,
          url: predefinedUrl
        });

        const response = await axios.get(`https://www.imdb.com${predefinedUrl}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          timeout: 10000
        });

        logger.debug('Predefined list response received', {
          label: 'IMDb Collections Debug',
          configName: config.name,
          statusCode: response.status,
          dataLength: response.data?.length || 0
        });

        // Parse using the same HTML parsing method
        imdbData = this.parseImdbListHtml(response.data, config.maxItems);
        
        logger.debug('Predefined list parsed', {
          label: 'IMDb Collections Debug',
          configName: config.name,
          itemCount: imdbData.length
        });
      }

      // Convert ImdbListItem to ImdbSourceData and resolve TMDb IDs
      logger.info(`Starting TMDb ID resolution for ${imdbData.length} items`, {
        label: 'IMDb Collections',
        configName: config.name,
        itemsToProcess: imdbData.length
      });

      const sourceData: ImdbSourceData[] = [];
      
      for (let i = 0; i < imdbData.length; i++) {
        const item = imdbData[i];
        
        // Log progress every 10 items or for small lists every 5 items
        const logInterval = imdbData.length > 50 ? 10 : 5;
        if (i % logInterval === 0 || i === imdbData.length - 1) {
          const percentage = Math.round(((i + 1) / imdbData.length) * 100);
          logger.info(`Resolving TMDb IDs: ${i + 1}/${imdbData.length} (${percentage}%)`, {
            label: 'IMDb Collections',
            configName: config.name,
            progress: `${i + 1}/${imdbData.length}`,
            percentage
          });
        }

        try {
          // Try to resolve TMDb ID from IMDb ID
          const tmdbId = await this.resolveTmdbIdFromImdbId(item.imdbId);
          
          sourceData.push({
            imdbId: item.imdbId,
            title: item.title,
            year: item.year,
            type: item.type,
            tmdbId,
          });
        } catch (error) {
          logger.warn(`Failed to resolve TMDb ID for IMDb ${item.imdbId} (${item.title}): ${error instanceof Error ? error.message : 'Unknown error'}`, {
            label: 'IMDb Collections',
            configName: config.name,
            imdbId: item.imdbId,
            title: item.title
          });
          // Still include the item without TMDb ID - might be resolved later
          sourceData.push({
            imdbId: item.imdbId,
            title: item.title,
            year: item.year,
            type: item.type,
          });
        }
      }

      return sourceData;
    } catch (error) {
      logger.error(`Failed to fetch IMDb data for ${config.name}`, {
        label: 'IMDb Collections',
        configName: config.name,
        subtype: config.subtype,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch IMDb list data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { subtype: config.subtype, mediaType: config.mediaType },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Parse IMDb list HTML to extract movie/TV items
   * Supports both custom lists (HTML parsing) and predefined lists (JSON-LD)
   */
  private parseImdbListHtml(html: string, maxItems: number): ImdbListItem[] {
    const items: ImdbListItem[] = [];
    
    try {
      // First, try to parse JSON-LD structured data (used by predefined lists like Top 250)
      const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
      if (jsonLdMatch) {
        try {
          const jsonData = JSON.parse(jsonLdMatch[1]);
          if (jsonData['@type'] === 'ItemList' && jsonData.itemListElement) {
            logger.debug('Found JSON-LD structured data, parsing...', {
              label: 'IMDb Collections Debug',
              itemCount: jsonData.itemListElement.length
            });

            for (let i = 0; i < Math.min(jsonData.itemListElement.length, maxItems); i++) {
              const item = jsonData.itemListElement[i];
              const movieData = item.item;
              
              if (movieData && movieData.url) {
                const imdbIdMatch = movieData.url.match(/\/title\/(tt\d+)/);
                if (imdbIdMatch) {
                  // Determine type based on @type or genre
                  let type: 'movie' | 'tv' = 'movie';
                  if (movieData['@type'] === 'TVSeries' || 
                      movieData['@type'] === 'TVEpisode' ||
                      (movieData.genre && movieData.genre.toLowerCase().includes('tv'))) {
                    type = 'tv';
                  }

                  // Extract year from duration or other metadata if available
                  let year: number | undefined;
                  if (movieData.datePublished) {
                    year = parseInt(movieData.datePublished.substring(0, 4));
                  }

                  items.push({
                    imdbId: imdbIdMatch[1],
                    title: movieData.name || movieData.alternateName,
                    year,
                    type,
                  });
                }
              }
            }

            logger.debug(`Parsed ${items.length} items from JSON-LD data`, {
              label: 'IMDb Collections Debug',
              itemCount: items.length
            });

            return items;
          }
        } catch (jsonError) {
          logger.debug('Failed to parse JSON-LD, falling back to HTML parsing', {
            label: 'IMDb Collections Debug',
            error: jsonError instanceof Error ? jsonError.message : 'Unknown error'
          });
        }
      }

      // Fallback to HTML parsing for custom lists
      logger.debug('Using HTML parsing approach', {
        label: 'IMDb Collections Debug'
      });

      let listItemMatches = html.match(/<li[^>]*class="[^"]*ipc-metadata-list-summary-item[^"]*"[^>]*>.*?<\/li>/gs);
      
      // If the first pattern doesn't work, try alternative patterns
      if (!listItemMatches) {
        listItemMatches = html.match(/<div[^>]*class="[^"]*titleColumn[^"]*"[^>]*>.*?<\/div>/gs) ||
                         html.match(/<div[^>]*class="[^"]*list[^"]*item[^"]*"[^>]*>.*?<\/div>/gs);
      }

      // If no matches found, return empty array
      if (!listItemMatches) {
        logger.warn('No list items found in IMDb HTML', {
          label: 'IMDb Collections Debug',
          htmlLength: html.length
        });
        return items;
      }

      // Process each item found
      for (let i = 0; i < Math.min(listItemMatches.length, maxItems); i++) {
        const item = listItemMatches[i];
        
        // Extract IMDb ID
        const imdbIdMatch = item.match(/\/title\/(tt\d+)/);
        if (!imdbIdMatch) continue;
        
        const imdbId = imdbIdMatch[1];
        
        // Extract title
        let title = '';
        const titleMatch = item.match(/<h3[^>]*class="[^"]*ipc-title__text[^"]*"[^>]*>.*?(\d+\.\s*)?([^<]+)<\/h3>/s) ||
                          item.match(/<a[^>]*class="[^"]*titleColumn[^"]*"[^>]*>([^<]+)<\/a>/s) ||
                          item.match(/alt="([^"]+)"/);
        
        if (titleMatch) {
          title = (titleMatch[2] || titleMatch[1]).trim();
        }
        
        // Extract year 
        let year: number | undefined;
        const yearMatch = item.match(/\((\d{4})\)/);
        if (yearMatch) {
          year = parseInt(yearMatch[1]);
        }
        
        // Determine type (movie vs TV show)
        let type: 'movie' | 'tv' = 'movie'; // Default to movie
        const lowerItem = item.toLowerCase();
        
        // Check for TV show indicators
        if (lowerItem.includes('titletype-tvseries') || 
            lowerItem.includes('tv series') ||
            lowerItem.includes('tv-series') ||
            lowerItem.includes('tvseries') ||
            lowerItem.includes('episodes') ||
            lowerItem.includes('seasons')) {
          type = 'tv';
        }
        
        if (title && imdbId) {
          items.push({
            imdbId,
            title,
            year,
            type,
          });
        }
      }
      
      logger.debug(`Parsed ${items.length} items from IMDb HTML`, {
        label: 'IMDb Collections Debug',
        itemCount: items.length,
        htmlLength: html.length
      });
      
    } catch (error) {
      logger.error(`Failed to parse IMDb HTML: ${error}`, {
        label: 'IMDb Collections Debug',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    
    return items;
  }

  protected async mapSourceDataToItems(
    sourceData: ImdbSourceData[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    config?: CollectionConfig
  ) {
    const mediaRepository = getRepository(Media);
    const mappedItems: any[] = [];
    const missingItems: any[] = [];

    for (const item of sourceData) {
      if (!item.tmdbId) {
        // Skip items without TMDb ID as we can't map them to Overseerr
        logger.debug(`Skipping IMDb item ${item.imdbId} (${item.title}) - no TMDb ID found`);
        continue;
      }

      const media = await mediaRepository.findOne({
        where: { 
          tmdbId: item.tmdbId, 
          mediaType: item.type === 'movie' ? MediaType.MOVIE : MediaType.TV 
        },
      });

      if (media?.ratingKey) {
        mappedItems.push({ 
          ratingKey: media.ratingKey, 
          title: item.title, 
          type: item.type, 
          tmdbId: item.tmdbId 
        });
      } else {
        missingItems.push({ 
          tmdbId: item.tmdbId, 
          mediaType: item.type, 
          title: item.title 
        });
      }
    }

    const stats = this.createFilteringStats(
      sourceData.length, 
      mappedItems.length, 
      { 
        'missing from plex': missingItems.length,
        'no tmdb id': sourceData.filter(item => !item.tmdbId).length
      }
    );
    
    return { items: mappedItems, missingItems, stats };
  }

  protected async createTemplateContext(config: CollectionConfig, mediaType: 'movie' | 'tv'): Promise<ImdbTemplateContext> {
    return this.templateEngine.createImdbContext(mediaType, config.subtype || 'popular') as ImdbTemplateContext;
  }

  protected async processConfiguration(
    config: any, 
    plexClient: any, 
    allCollections: any[], 
    processedCollectionKeys?: Set<string>
  ) {
    logger.debug('Starting IMDb processConfiguration', {
      label: 'IMDb Collections Debug',
      configName: config.name,
      configId: config.id,
      subtype: config.subtype,
      mediaType: config.mediaType
    });

    try {
      const sourceData = await this.fetchSourceData(config);
      logger.debug('Source data fetched successfully', {
        label: 'IMDb Collections Debug',
        configName: config.name,
        sourceDataLength: sourceData.length
      });

      const { items, missingItems } = await this.mapSourceDataToItems(sourceData);
      logger.debug('Source data mapped to items', {
        label: 'IMDb Collections Debug',
        configName: config.name,
        itemsLength: items.length,
        missingItemsLength: missingItems?.length || 0
      });

      if (missingItems && missingItems.length > 0) {
        logger.debug('Processing auto requests', {
          label: 'IMDb Collections Debug',
          configName: config.name,
          missingItemsCount: missingItems.length
        });
        await this.handleAutoRequests(missingItems, config);
      }

      if (items.length === 0) {
        logger.debug('No items found, returning early', {
          label: 'IMDb Collections Debug',
          configName: config.name
        });
        return { created: 0, updated: 0 };
      }

      logger.debug('Processing collection creation', {
        label: 'IMDb Collections Debug',
        configName: config.name,
        mediaType: config.mediaType,
        itemsCount: items.length
      });

      if (config.mediaType === 'both') {
        return await this.processBothMediaTypes(
          items, config, plexClient, allCollections, processedCollectionKeys
        );
      } else {
        return await this.processSingleMediaType(
          items, config, plexClient, allCollections, processedCollectionKeys
        );
      }
    } catch (error) {
      logger.error('Error in IMDb processConfiguration', {
        label: 'IMDb Collections Debug',
        configName: config.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        errorType: typeof error,
        errorConstructor: error?.constructor?.name
      });
      throw error; // Re-throw to be handled by base class
    }
  }

  protected async createCollection(
    items: any[], 
    mediaType: 'movie' | 'tv', 
    collectionName: string, 
    plexClient: any, 
    allCollections: any[], 
    config: any, 
    processedCollectionKeys?: Set<string>
  ) {
    const dummyUser = { id: 0 } as any;
    const result = await createOrUpdateCollection(
      dummyUser, items, mediaType, plexClient, allCollections, config.visibilityConfig, 
      collectionName, true, `OverseerrImdb${config.id}`, processedCollectionKeys,
      config.sortOrderLibrary, (config as any)._totalCollectionsInLibrary, config.customPoster
    );
    return { 
      isNew: result.isNew, 
      hasChanges: result.hasChanges, 
      collectionName, 
      itemCount: items.length 
    };
  }

  private async handleAutoRequests(missingItems: any[], config: any): Promise<void> {
    // Use the shared auto-request service
    await autoRequestService.processAutoRequests(missingItems, config, 'imdb');
  }

  private async processBothMediaTypes(
    items: any[],
    config: any,
    plexClient: any,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<any> {
    let totalCreated = 0;
    let totalUpdated = 0;

    // Split items by media type
    const { movieItems, tvItems } = this.splitItemsByMediaType(items);

    // Process movies if we have any
    if (movieItems.length > 0) {
      const movieTemplate = config.customMovieTemplate || config.template || config.name;
      const movieCollectionName = this.templateEngine.processTemplate(
        movieTemplate,
        await this.createTemplateContext(config, 'movie')
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
    }

    // Process TV shows if we have any
    if (tvItems.length > 0) {
      const tvTemplate = config.customTVTemplate || config.template || config.name;
      const tvCollectionName = this.templateEngine.processTemplate(
        tvTemplate,
        await this.createTemplateContext(config, 'tv')
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
    }

    return { created: totalCreated, updated: totalUpdated };
  }

  private async processSingleMediaType(
    items: any[],
    config: any,
    plexClient: any,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<any> {
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

    return {
      created: result.isNew ? 1 : 0,
      updated: result.hasChanges && !result.isNew ? 1 : 0,
    };
  }

  /**
   * Get the URL path for predefined IMDb lists
   */
  private getPredefinedListUrl(subtype: string, mediaType?: string): string {
    switch (subtype) {
      case 'top_250':
        return mediaType === 'tv' ? '/chart/toptv/' : '/chart/top/';
      case 'popular':
        return mediaType === 'tv' ? '/chart/tvmeter/' : '/chart/moviemeter/';
      case 'most_popular':
        return mediaType === 'tv' ? '/chart/tvpopular/' : '/chart/boxoffice/';
      default:
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Unknown IMDb subtype: ${subtype}`
        );
    }
  }

  /**
   * Get the appropriate IMDb list type based on config (kept for compatibility)
   */
  private getImdbListType(subtype: string, mediaType?: string): ImdbTopList {
    switch (subtype) {
      case 'top_250':
        return mediaType === 'tv' ? ImdbTopList.TOP_250_TV : ImdbTopList.TOP_250_MOVIES;
      case 'popular':
        return mediaType === 'tv' ? ImdbTopList.POPULAR_TV : ImdbTopList.POPULAR_MOVIES;
      case 'most_popular':
        return mediaType === 'tv' ? ImdbTopList.MOST_POPULAR_TV : ImdbTopList.MOST_POPULAR_MOVIES;
      default:
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Unknown IMDb subtype: ${subtype}`
        );
    }
  }

  /**
   * Resolve TMDb ID from IMDb ID using TMDb's external ID lookup
   */
  private async resolveTmdbIdFromImdbId(imdbId: string): Promise<number | undefined> {
    try {
      const result = await this.tmdbClient.getMediaByImdbId({ imdbId });
      return result?.id;
    } catch (error) {
      logger.debug(`Failed to resolve TMDb ID for IMDb ${imdbId}: ${error.message}`);
      return undefined;
    }
  }
}

export default ImdbCollectionSync;