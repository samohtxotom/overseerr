import TmdbAPI from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { updateCollectionContents } from '@server/lib/collectionsUtils';
import { BaseCollectionSync } from './BaseCollectionSync';
import type { CollectionConfig } from '@server/lib/settings';
import { CollectionSyncErrorType } from './types';
import type { LetterboxdTemplateContext, LetterboxdSourceData, CollectionSyncOptions } from './types';
import { autoRequestService } from './AutoRequestService';
import logger from '@server/logger';

interface LetterboxdListItem {
  title: string;
  year: number;
  letterboxdUrl: string;
}

/**
 * Letterboxd Collection Sync - Implementation for Letterboxd custom lists
 * 
 * Supports custom Letterboxd lists via web scraping since Letterboxd doesn't have a public API.
 */
export class LetterboxdCollectionSync extends BaseCollectionSync {
  private tmdbClient: TmdbAPI;

  constructor() {
    super('letterboxd');
    this.tmdbClient = new TmdbAPI();
  }

  protected async validateConfiguration(): Promise<void> {
    // Letterboxd lists are public and don't require API keys
    // Custom lists use simple axios approach so no complex validation needed
    
    logger.debug('Letterboxd configuration validation - skipping complex validation', {
      label: 'Letterboxd Collections Debug'
    });
    
    // No validation needed for Letterboxd since:
    // 1. Custom lists use simple axios (no complex dependencies)
    // 2. Lists are public Letterboxd URLs
    // 3. Any connectivity issues will be caught during actual fetching
  }

  protected async fetchSourceData(
    config: CollectionConfig,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: CollectionSyncOptions
  ): Promise<LetterboxdSourceData[]> {
    try {
      if (config.subtype !== 'custom' || !config.letterboxdCustomListUrl) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          'Custom Letterboxd list URL is required'
        );
      }

      // Use the same approach as fetch-title endpoint
      const axios = (await import('axios')).default;
      
      logger.debug(`Fetching Letterboxd custom list: ${config.letterboxdCustomListUrl}`, {
        label: 'Letterboxd Collections',
        configName: config.name,
        url: config.letterboxdCustomListUrl
      });

      const response = await axios.get(config.letterboxdCustomListUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 10000
      });

      // Parse the HTML to extract movie items
      const letterboxdData = this.parseLetterboxdListHtml(response.data, config.maxItems);
      
      logger.info(`Successfully fetched ${letterboxdData.length} items from Letterboxd custom list`, {
        label: 'Letterboxd Collections',
        configName: config.name,
        itemCount: letterboxdData.length
      });

      // Convert to LetterboxdSourceData and resolve TMDb IDs
      logger.info(`Starting TMDb ID resolution for ${letterboxdData.length} items`, {
        label: 'Letterboxd Collections',
        configName: config.name,
        itemsToProcess: letterboxdData.length
      });

      const sourceData: LetterboxdSourceData[] = [];
      
      for (let i = 0; i < letterboxdData.length; i++) {
        const item = letterboxdData[i];
        
        try {
          // Search for the movie on TMDb using title and year
          const searchResults = await this.tmdbClient.searchMovies({
            query: item.title,
            year: item.year
          });

          if (searchResults.results && searchResults.results.length > 0) {
            const tmdbMovie = searchResults.results[0];
            
            sourceData.push({
              title: item.title,
              year: item.year,
              letterboxdUrl: item.letterboxdUrl,
              tmdbId: tmdbMovie.id,
              mediaType: 'movie' as const
            });
          } else {
            logger.warn(`No TMDb match found for Letterboxd item: ${item.title} (${item.year})`, {
              label: 'Letterboxd Collections',
              configName: config.name,
              itemTitle: item.title,
              itemYear: item.year
            });
          }
        } catch (error) {
          logger.warn(`Error resolving TMDb ID for ${item.title}:`, {
            label: 'Letterboxd Collections',
            configName: config.name,
            error: error instanceof Error ? error.message : 'Unknown error',
            itemTitle: item.title
          });
        }
      }

      logger.info(`TMDb ID resolution complete: ${sourceData.length}/${letterboxdData.length} items resolved`, {
        label: 'Letterboxd Collections',
        configName: config.name,
        resolvedItems: sourceData.length,
        totalItems: letterboxdData.length
      });

      return sourceData;
    } catch (error) {
      logger.error('Error fetching Letterboxd source data:', {
        label: 'Letterboxd Collections',
        configName: config.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      if (error instanceof Error && error.name === 'CollectionSyncError') {
        throw error;
      }
      
      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch Letterboxd data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  protected async mapSourceDataToItems(
    sourceData: LetterboxdSourceData[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    config?: CollectionConfig
  ) {
    const mediaRepository = getRepository(Media);
    const mappedItems: any[] = [];
    const missingItems: any[] = [];

    for (const item of sourceData) {
      if (!item.tmdbId) {
        // Skip items without TMDb ID as we can't map them to Overseerr
        logger.debug(`Skipping Letterboxd item ${item.letterboxdUrl} (${item.title}) - no TMDb ID found`);
        continue;
      }

      const media = await mediaRepository.findOne({
        where: { 
          tmdbId: item.tmdbId, 
          mediaType: MediaType.MOVIE 
        },
      });

      if (media?.ratingKey) {
        mappedItems.push({ 
          ratingKey: media.ratingKey, 
          title: item.title, 
          type: 'movie', 
          tmdbId: item.tmdbId 
        });
      } else {
        missingItems.push({ 
          tmdbId: item.tmdbId, 
          mediaType: 'movie', 
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

  protected async createTemplateContext(config: CollectionConfig, mediaType: 'movie' | 'tv'): Promise<LetterboxdTemplateContext> {
    const baseContext = await this.templateEngine.createLetterboxdContext(mediaType, config.subtype || 'custom') as LetterboxdTemplateContext;
    
    return {
      ...baseContext,
      listUrl: config.letterboxdCustomListUrl || '',
      listName: this.extractListNameFromUrl(config.letterboxdCustomListUrl || '')
    };
  }

  protected async processConfiguration(
    config: any, 
    plexClient: any, 
    allCollections: any[], 
    processedCollectionKeys?: Set<string>
  ) {
    logger.debug('Starting Letterboxd processConfiguration', {
      label: 'Letterboxd Collections Debug',
      configName: config.name,
      configId: config.id,
      subtype: config.subtype,
      mediaType: config.mediaType
    });

    try {
      const sourceData = await this.fetchSourceData(config);
      logger.debug('Source data fetched successfully', {
        label: 'Letterboxd Collections Debug',
        configName: config.name,
        sourceDataLength: sourceData.length
      });

      const { items, missingItems } = await this.mapSourceDataToItems(sourceData);
      logger.debug('Source data mapped to items', {
        label: 'Letterboxd Collections Debug',
        configName: config.name,
        itemsLength: items.length,
        missingItemsLength: missingItems?.length || 0
      });

      if (missingItems && missingItems.length > 0) {
        logger.debug('Processing auto requests', {
          label: 'Letterboxd Collections Debug',
          configName: config.name,
          missingItemsCount: missingItems.length
        });
        await this.handleAutoRequests(missingItems, config);
      }

      if (items.length === 0) {
        logger.debug('No items found, returning early', {
          label: 'Letterboxd Collections Debug',
          configName: config.name
        });
        return { created: 0, updated: 0 };
      }

      logger.debug('Processing collection creation', {
        label: 'Letterboxd Collections Debug',
        configName: config.name,
        mediaType: config.mediaType,
        itemsCount: items.length
      });

      // Letterboxd is movies only, so no need to handle 'both' media types
      const mediaType = 'movie';
      const templateContext = await this.createTemplateContext(config, mediaType);
      const collectionName = this.templateEngine.processTemplate(config.template, templateContext);

      const result = await this.createCollection(
        items, mediaType, collectionName, plexClient, allCollections, config, processedCollectionKeys
      );

      return { 
        created: result.isNew ? 1 : 0, 
        updated: result.hasChanges && !result.isNew ? 1 : 0 
      };
    } catch (error) {
      logger.error(`Error in Letterboxd processConfiguration for ${config.name}:`, {
        label: 'Letterboxd Collections',
        configName: config.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return { created: 0, updated: 0 };
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
    const result = await updateCollectionContents(
      dummyUser, items, mediaType, plexClient, allCollections, config.visibilityConfig, 
      collectionName, true, `overseerrletterboxd${config.id}`, processedCollectionKeys,
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
    await autoRequestService.processAutoRequests(missingItems, config, 'letterboxd');
  }

  private parseLetterboxdListHtml(html: string, maxItems: number): LetterboxdListItem[] {
    const items: LetterboxdListItem[] = [];
    
    try {
      // Parse HTML using simple regex patterns based on Kometa's approach
      // Look for poster containers and film details
      const posterContainerRegex = /<li[^>]*class="[^"]*(?:poster-container|film-detail)[^"]*"[^>]*>(.*?)<\/li>/gs;
      const filmIdRegex = /data-film-id="([^"]+)"/;
      const targetLinkRegex = /data-target-link="([^"]+)"/;
      const yearRegex = /<small[^>]*>.*?<a[^>]*>(\d{4})<\/a>/;
      const titleRegex = /<img[^>]*alt="([^"]+)"/;
      
      let match;
      let count = 0;
      
      while ((match = posterContainerRegex.exec(html)) !== null && count < maxItems) {
        const itemHtml = match[1];
        
        // Extract film ID
        const filmIdMatch = itemHtml.match(filmIdRegex);
        if (!filmIdMatch) continue;
        
        // Extract target link (movie slug)
        const targetLinkMatch = itemHtml.match(targetLinkRegex);
        if (!targetLinkMatch) continue;
        
        // Extract year
        const yearMatch = itemHtml.match(yearRegex);
        const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
        
        // Extract title from img alt text
        const titleMatch = itemHtml.match(titleRegex);
        if (!titleMatch) continue;
        
        const title = titleMatch[1];
        const slug = targetLinkMatch[1];
        const letterboxdUrl = `https://letterboxd.com${slug}`;
        
        items.push({
          title: title,
          year: year,
          letterboxdUrl: letterboxdUrl
        });
        
        count++;
      }
      
      logger.info(`Successfully parsed ${items.length} movies from Letterboxd list`, {
        label: 'Letterboxd Collections',
        itemCount: items.length,
        requestedMax: maxItems
      });
      
    } catch (error) {
      logger.error('Error parsing Letterboxd HTML:', {
        label: 'Letterboxd Collections',
        error: error instanceof Error ? error.message : 'Unknown error',
        htmlLength: html.length
      });
    }
    
    return items;
  }

  private extractListNameFromUrl(url: string): string {
    const match = url.match(/letterboxd\.com\/[^/]+\/list\/([^/?]+)/);
    if (match) {
      return match[1].replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
    }
    return '';
  }
}