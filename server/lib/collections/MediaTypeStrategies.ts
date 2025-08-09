import type PlexAPI from '@server/api/plexapi';
import type { CollectionConfig } from '@server/lib/settings';
import type { 
  CollectionItem, 
  SyncResult,
  CollectionOperationResult
} from './types';
import logger from '@server/logger';

/**
 * Context for media type processing operations
 */
export interface MediaProcessingContext {
  plexClient: PlexAPI;
  allCollections: any[];
  processedCollectionKeys?: Set<string>;
  userInfo?: {
    userId?: number | string;
    customLabel?: string;
  };
}

/**
 * Result of media type processing
 */
export interface MediaProcessingResult {
  created: number;
  updated: number;
  itemCount: number;
  collectionKeys: string[];
  error?: string;
}

/**
 * Base interface for media type processing strategies
 */
export interface MediaTypeProcessor {
  canHandle(mediaType: 'movie' | 'tv' | 'both'): boolean;
  process(
    items: CollectionItem[], 
    config: CollectionConfig, 
    context: MediaProcessingContext
  ): Promise<MediaProcessingResult>;
  generateCollectionName(
    config: CollectionConfig, 
    mediaType: 'movie' | 'tv',
    context: MediaProcessingContext
  ): Promise<string>;
}

/**
 * Strategy for processing single media type collections (movie OR tv)
 */
export class SingleMediaTypeProcessor implements MediaTypeProcessor {
  constructor(private collectionSync: any) {} // Will be BaseCollectionSync

  canHandle(mediaType: 'movie' | 'tv' | 'both'): boolean {
    return mediaType === 'movie' || mediaType === 'tv';
  }

  async process(
    items: CollectionItem[], 
    config: CollectionConfig, 
    context: MediaProcessingContext
  ): Promise<MediaProcessingResult> {
    if (!this.canHandle(config.mediaType as any)) {
      throw new Error(`SingleMediaTypeProcessor cannot handle mediaType: ${config.mediaType}`);
    }

    const mediaType = config.mediaType as 'movie' | 'tv';
    
    // Filter items by the specified media type
    const filteredItems = items.filter(item => item.type === mediaType);
    
    if (filteredItems.length === 0) {
      logger.debug(`No ${mediaType} items found for collection`, {
        label: 'Single Media Type Processor',
        configName: config.name,
        mediaType,
        totalItems: items.length,
      });
      
      return {
        created: 0,
        updated: 0,
        itemCount: 0,
        collectionKeys: [],
      };
    }

    const collectionName = await this.generateCollectionName(config, mediaType, context);
    
    try {
      const result = await this.collectionSync.createOrUpdateCollectionStandardized(
        filteredItems,
        collectionName,
        mediaType,
        config,
        context.plexClient,
        context.allCollections,
        context.processedCollectionKeys,
        context.userInfo
      );

      return {
        created: result.created || 0,
        updated: result.updated || 0,
        itemCount: result.itemCount || 0,
        collectionKeys: result.collectionRatingKey ? [result.collectionRatingKey] : [],
        error: result.error,
      };
    } catch (error) {
      logger.error(`Failed to process single media type collection`, {
        label: 'Single Media Type Processor',
        configName: config.name,
        mediaType,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        created: 0,
        updated: 0,
        itemCount: 0,
        collectionKeys: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async generateCollectionName(
    config: CollectionConfig, 
    mediaType: 'movie' | 'tv',
    context: MediaProcessingContext
  ): Promise<string> {
    // Use the collection sync's existing name generation logic
    if (this.collectionSync.generateCollectionNameWithCustom) {
      return await this.collectionSync.generateCollectionNameWithCustom(config, mediaType);
    }
    
    // Fallback to template or config name
    const template = mediaType === 'movie' 
      ? (config.customMovieTemplate || config.template || config.name)
      : (config.customTVTemplate || config.template || config.name);
    
    return template;
  }
}

/**
 * Strategy for processing "both" media type collections (separate movie and TV collections)
 */
export class BothMediaTypeProcessor implements MediaTypeProcessor {
  constructor(private collectionSync: any) {} // Will be BaseCollectionSync

  canHandle(mediaType: 'movie' | 'tv' | 'both'): boolean {
    return mediaType === 'both';
  }

  async process(
    items: CollectionItem[], 
    config: CollectionConfig, 
    context: MediaProcessingContext
  ): Promise<MediaProcessingResult> {
    if (!this.canHandle(config.mediaType as any)) {
      throw new Error(`BothMediaTypeProcessor cannot handle mediaType: ${config.mediaType}`);
    }

    // Split items by media type
    const { movieItems, tvItems } = this.splitItemsByMediaType(items);
    
    const results: MediaProcessingResult = {
      created: 0,
      updated: 0,
      itemCount: 0,
      collectionKeys: [],
    };

    // Process movie collection if we have movie items
    if (movieItems.length > 0) {
      try {
        const movieResult = await this.processSingleType(
          movieItems, 
          config, 
          'movie', 
          context
        );
        
        results.created += movieResult.created;
        results.updated += movieResult.updated;
        results.itemCount += movieResult.itemCount;
        results.collectionKeys.push(...movieResult.collectionKeys);
        
        if (movieResult.error) {
          results.error = (results.error || '') + `Movie collection error: ${movieResult.error}; `;
        }
      } catch (error) {
        const errorMsg = `Movie processing failed: ${error instanceof Error ? error.message : String(error)}`;
        results.error = (results.error || '') + errorMsg + '; ';
        
        logger.error(`Failed to process movie collection`, {
          label: 'Both Media Type Processor',
          configName: config.name,
          error: errorMsg,
        });
      }
    } else {
      logger.debug('No movie items to process', {
        label: 'Both Media Type Processor',
        configName: config.name,
      });
    }

    // Process TV collection if we have TV items
    if (tvItems.length > 0) {
      try {
        const tvResult = await this.processSingleType(
          tvItems, 
          config, 
          'tv', 
          context
        );
        
        results.created += tvResult.created;
        results.updated += tvResult.updated;
        results.itemCount += tvResult.itemCount;
        results.collectionKeys.push(...tvResult.collectionKeys);
        
        if (tvResult.error) {
          results.error = (results.error || '') + `TV collection error: ${tvResult.error}; `;
        }
      } catch (error) {
        const errorMsg = `TV processing failed: ${error instanceof Error ? error.message : String(error)}`;
        results.error = (results.error || '') + errorMsg + '; ';
        
        logger.error(`Failed to process TV collection`, {
          label: 'Both Media Type Processor',
          configName: config.name,
          error: errorMsg,
        });
      }
    } else {
      logger.debug('No TV items to process', {
        label: 'Both Media Type Processor',
        configName: config.name,
      });
    }

    // Clean up error message if both succeeded
    if (results.error && results.error.trim().endsWith(';')) {
      results.error = results.error.trim().slice(0, -1);
    }

    logger.info(`Completed both media types processing`, {
      label: 'Both Media Type Processor',
      configName: config.name,
      movieItems: movieItems.length,
      tvItems: tvItems.length,
      totalCreated: results.created,
      totalUpdated: results.updated,
    });

    return results;
  }

  private async processSingleType(
    items: CollectionItem[],
    config: CollectionConfig,
    mediaType: 'movie' | 'tv',
    context: MediaProcessingContext
  ): Promise<MediaProcessingResult> {
    const collectionName = await this.generateCollectionName(config, mediaType, context);
    
    const result = await this.collectionSync.createOrUpdateCollectionStandardized(
      items,
      collectionName,
      mediaType,
      config,
      context.plexClient,
      context.allCollections,
      context.processedCollectionKeys,
      context.userInfo
    );

    return {
      created: result.created || 0,
      updated: result.updated || 0,
      itemCount: result.itemCount || 0,
      collectionKeys: result.collectionRatingKey ? [result.collectionRatingKey] : [],
      error: result.error,
    };
  }

  private splitItemsByMediaType(items: CollectionItem[]): {
    movieItems: CollectionItem[];
    tvItems: CollectionItem[];
  } {
    const movieItems: CollectionItem[] = [];
    const tvItems: CollectionItem[] = [];

    for (const item of items) {
      if (item.type === 'movie') {
        movieItems.push(item);
      } else if (item.type === 'tv') {
        tvItems.push(item);
      } else {
        logger.warn('Item has unknown media type, skipping', {
          label: 'Both Media Type Processor',
          itemTitle: item.title,
          mediaType: item.type,
        });
      }
    }

    return { movieItems, tvItems };
  }

  async generateCollectionName(
    config: CollectionConfig, 
    mediaType: 'movie' | 'tv',
    context: MediaProcessingContext
  ): Promise<string> {
    // Use the collection sync's existing name generation logic
    if (this.collectionSync.generateCollectionNameWithCustom) {
      return await this.collectionSync.generateCollectionNameWithCustom(config, mediaType);
    }
    
    // Fallback to template or config name
    const template = mediaType === 'movie' 
      ? (config.customMovieTemplate || config.template || config.name)
      : (config.customTVTemplate || config.template || config.name);
    
    return template;
  }
}

/**
 * Factory for creating appropriate media type processors
 */
export class MediaTypeProcessorFactory {
  private static processors = new Map<string, (collectionSync: any) => MediaTypeProcessor>();
  
  static {
    // Register default processors
    MediaTypeProcessorFactory.registerProcessor('single', (sync) => new SingleMediaTypeProcessor(sync));
    MediaTypeProcessorFactory.registerProcessor('both', (sync) => new BothMediaTypeProcessor(sync));
  }

  /**
   * Register a custom media type processor
   */
  public static registerProcessor(
    name: string, 
    factory: (collectionSync: any) => MediaTypeProcessor
  ): void {
    this.processors.set(name, factory);
  }

  /**
   * Get the appropriate processor for a given media type
   */
  public static getProcessor(
    mediaType: 'movie' | 'tv' | 'both', 
    collectionSync: any
  ): MediaTypeProcessor {
    let processor: MediaTypeProcessor;

    if (mediaType === 'both') {
      const factory = this.processors.get('both');
      if (!factory) {
        throw new Error('Both media type processor not registered');
      }
      processor = factory(collectionSync);
    } else {
      const factory = this.processors.get('single');
      if (!factory) {
        throw new Error('Single media type processor not registered');
      }
      processor = factory(collectionSync);
    }

    if (!processor.canHandle(mediaType)) {
      throw new Error(`Processor cannot handle media type: ${mediaType}`);
    }

    return processor;
  }

  /**
   * Get all registered processor names
   */
  public static getRegisteredProcessors(): string[] {
    return Array.from(this.processors.keys());
  }
}

/**
 * Template selection strategy interface
 */
export interface TemplateSelectionStrategy {
  selectTemplate(config: CollectionConfig, mediaType: 'movie' | 'tv'): string;
  getDefaultTemplate(mediaType: 'movie' | 'tv'): string;
}

/**
 * Standard template selection strategy
 * Uses custom templates when available, falls back to standard template or name
 */
export class StandardTemplateStrategy implements TemplateSelectionStrategy {
  selectTemplate(config: CollectionConfig, mediaType: 'movie' | 'tv'): string {
    // Priority: custom template > standard template > config name
    const customTemplate = mediaType === 'movie' 
      ? config.customMovieTemplate 
      : config.customTVTemplate;
    
    return customTemplate || config.template || config.name;
  }

  getDefaultTemplate(mediaType: 'movie' | 'tv'): string {
    return mediaType === 'movie' ? 'Movies Collection' : 'TV Shows Collection';
  }
}

/**
 * Custom template strategy for advanced template selection
 */
export class CustomTemplateStrategy implements TemplateSelectionStrategy {
  constructor(private templateMap: Record<string, string> = {}) {}

  selectTemplate(config: CollectionConfig, mediaType: 'movie' | 'tv'): string {
    const key = `${config.type}_${mediaType}`;
    const customTemplate = this.templateMap[key];
    
    if (customTemplate) {
      return customTemplate;
    }

    // Fallback to standard strategy
    const standardStrategy = new StandardTemplateStrategy();
    return standardStrategy.selectTemplate(config, mediaType);
  }

  getDefaultTemplate(mediaType: 'movie' | 'tv'): string {
    return this.templateMap[mediaType] || new StandardTemplateStrategy().getDefaultTemplate(mediaType);
  }

  setTemplate(key: string, template: string): void {
    this.templateMap[key] = template;
  }
}

// Export singleton factory
export const mediaTypeProcessorFactory = MediaTypeProcessorFactory;