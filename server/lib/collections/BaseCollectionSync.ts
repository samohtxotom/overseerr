import type PlexAPI from '@server/api/plexapi';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';
import type { TemplateEngine } from './TemplateEngine';
import { templateEngine } from './TemplateEngine';
import type { ServiceUserManager } from './ServiceUserManager';
import { serviceUserManager } from './ServiceUserManager';
import { 
  mediaTypeProcessorFactory,
  type MediaTypeProcessor,
  type MediaProcessingContext,
  type MediaProcessingResult 
} from './MediaTypeStrategies';
import type {
  CollectionItem,
  SyncResult,
  CollectionSyncInterface,
  CollectionOperationResult,
  AutoRequestConfig,
  MissingItem,
  AutoRequestResult,
  CollectionSyncError,
  CollectionSyncOptions,
  FilteringStats,
  CollectionSource,
  TimeRestrictionResult,
  SourceTemplateContext,
  CollectionSourceData,
} from './types';
import { CollectionSyncErrorType } from './types';
import { TimeRestrictionUtils } from './TimeRestrictionUtils';
import { CollectionConfigUpdater } from './CollectionConfigUpdater';
import { CollectionSyncUtils } from './CollectionSyncUtils';
import CollectionUpdateStrategy from './CollectionUpdateStrategy';

/**
 * Abstract base class for all collection sync implementations
 * 
 * Provides common functionality and enforces a consistent pipeline across
 * all collection sync sources (Overseerr, Tautulli, Trakt).
 */
export abstract class BaseCollectionSync implements CollectionSyncInterface {
  protected templateEngine: TemplateEngine;
  protected serviceUserManager: ServiceUserManager;
  protected source: CollectionSource;

  constructor(source: CollectionSource) {
    this.templateEngine = templateEngine;
    this.serviceUserManager = serviceUserManager;
    this.source = source;
  }

  /**
   * Main entry point for processing collections
   * Implements the common pipeline that all sources follow
   */
  public async processCollections(
    collectionConfigs: CollectionConfig[],
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>,
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    const startTime = Date.now();
    let created = 0;
    let updated = 0;
    const errors: CollectionSyncError[] = [];

    // Filter configs for this source
    const sourceConfigs = this.filterConfigsForSource(collectionConfigs);
    
    if (sourceConfigs.length === 0) {
      return { created: 0, updated: 0 };
    }

    try {
      // Validate source is properly configured
      await this.validateConfiguration();

      // Process each configuration
      for (let i = 0; i < sourceConfigs.length; i++) {
        const config = sourceConfigs[i];
        
        try {
          // Check time restrictions and determine effective visibility
          const timeRestrictionResult = this.evaluateTimeRestriction(config);
          const removeFromPlexWhenInactive = config.timeRestriction?.removeFromPlexWhenInactive ?? false;
          
          // Determine the effective configuration to use
          let effectiveConfig = config;
          
          if (!timeRestrictionResult.isActive && !removeFromPlexWhenInactive) {
            // Collection is inactive but should use inactive visibility settings
            const inactiveVisibilityConfig = config.timeRestriction?.inactiveVisibilityConfig ?? {
              usersHome: false,
              serverOwnerHome: false,
              libraryRecommended: true,
              libraryTabOnly: false,
            };
            
            logger.debug(
              `Processing collection ${config.name} with inactive visibility settings - time restriction not met (${timeRestrictionResult.reason})`,
              { 
                label: `${this.source} Collections`,
                configId: config.id,
                reason: timeRestrictionResult.reason,
                nextActivation: timeRestrictionResult.nextActivation,
                inactiveVisibility: inactiveVisibilityConfig,
              }
            );
            
            // Override visibility config for inactive collections
            effectiveConfig = {
              ...config,
              visibilityConfig: inactiveVisibilityConfig,
            };
          } else if (!timeRestrictionResult.isActive && removeFromPlexWhenInactive) {
            // Collection is inactive and should be removed completely - skip processing
            logger.debug(
              `Skipping collection ${config.name} - time restriction not met and set to remove from Plex (${timeRestrictionResult.reason})`,
              { 
                label: `${this.source} Collections`,
                configId: config.id,
                reason: timeRestrictionResult.reason,
                nextActivation: timeRestrictionResult.nextActivation,
              }
            );

            // If collection is time-restricted and inactive, try to remove it from Plex
            await this.handleInactiveCollection(config, plexClient, allCollections, processedCollectionKeys);
            continue;
          }

          // Process individual configuration (using effective config with potentially overridden visibility)
          const result = await this.processConfiguration(
            effectiveConfig,
            plexClient,
            allCollections,
            processedCollectionKeys,
            options
          );

          created += result.created;
          updated += result.updated;
        } catch (error) {
          const syncError = this.createSyncError(
            CollectionSyncErrorType.COLLECTION_ERROR,
            `Failed to process configuration ${config.name}`,
            { configId: config.id, configName: config.name },
            error instanceof Error ? error : new Error(String(error))
          );
          
          errors.push(syncError);
          
          if (options?.onError) {
            options.onError(syncError);
          }

          logger.error(syncError.message, {
            label: `${this.source} Collections`,
            ...syncError.details,
          });
        }
      }

      // Log summary if any changes were made
      if (created > 0 || updated > 0) {
        logger.info(
          `${this.source} collection processing: ${created} created, ${updated} updated`,
          {
            label: `${this.source} Collections`,
            processingTime: Date.now() - startTime,
          }
        );
      }

      return { 
        created, 
        updated, 
        details: { 
          processingTime: Date.now() - startTime,
          errors: errors.length,
        }
      };
    } catch (error) {
      const syncError = this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        `Failed to process ${this.source} collections`,
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      
      logger.error(syncError.message, {
        label: `${this.source} Collections`,
        error: syncError.details,
      });

      return { created: 0, updated: 0, error: syncError.message };
    }
  }

  /**
   * Filter collection configurations for this specific source
   */
  protected filterConfigsForSource(configs: CollectionConfig[]): CollectionConfig[] {
    return configs.filter(config => config.type === this.source);
  }

  /**
   * Create a standardized sync error
   */
  protected createSyncError(
    type: CollectionSyncErrorType,
    message: string,
    context: Record<string, any> = {},
    originalError?: Error
  ): CollectionSyncError {
    return {
      type,
      message,
      details: context,
      originalError,
      context: {
        source: this.source,
        ...context,
      },
    };
  }

  /**
   * Generate collection name using template engine
   */
  protected async generateCollectionName(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv',
    customTemplate?: string
  ): Promise<string> {
    let templateToUse = customTemplate || config.template || config.name;
    
    // Handle custom template selection - use the actual custom template content instead of "custom"
    if (templateToUse === 'custom') {
      templateToUse = mediaType === 'movie' 
        ? (config.customMovieTemplate || config.name)
        : (config.customTVTemplate || config.name);
    }
    
    const context = await this.createTemplateContext(config, mediaType);
    
    return this.templateEngine.processTemplate(templateToUse, context);
  }

  /**
   * Generate collection names with custom templates for movies/TV
   */
  protected async generateCollectionNameWithCustom(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<string> {
    const context = await this.createTemplateContext(config, mediaType);
    
    return this.templateEngine.processTemplateWithCustom(
      config.template || config.name,
      config.customMovieTemplate,
      config.customTVTemplate,
      context
    );
  }

  /**
   * Process missing items with auto-request functionality
   */
  protected async processAutoRequests(
    missingItems: MissingItem[],
    config: AutoRequestConfig & { id: number; name: string }
  ): Promise<AutoRequestResult> {
    if (!config.searchMissingMovies && !config.searchMissingTV) {
      return {
        autoApproved: 0,
        manualApproval: 0,
        alreadyRequested: 0,
        skipped: 0,
        total: 0,
      };
    }

    try {
      // This would be implemented by subclasses that support auto-requests
      // For now, return empty result
      return {
        autoApproved: 0,
        manualApproval: 0,
        alreadyRequested: 0,
        skipped: 0,
        total: missingItems.length,
      };
    } catch (error) {
      logger.error(`Failed to process auto-requests for ${config.name}: ${error}`, {
        label: `${this.source} Collections`,
      });
      
      return {
        autoApproved: 0,
        manualApproval: 0,
        alreadyRequested: 0,
        skipped: 0,
        total: 0,
      };
    }
  }

  /**
   * Create filtering statistics
   */
  protected createFilteringStats(
    original: number,
    filtered: number,
    removalReasons?: Record<string, number>
  ): FilteringStats {
    return {
      original,
      filtered,
      removed: original - filtered,
      removalReasons,
    };
  }

  /**
   * Update collection config with Plex rating key after collection operation
   */
  protected updateConfigWithRatingKey(config: CollectionConfig, collectionRatingKey?: string): void {
    if (collectionRatingKey && typeof config.id === 'number') {
      // Extract library ID from config for multi-library support
      // Handle both single string and array formats
      const libraryId = Array.isArray(config.libraryId) ? config.libraryId[0] : config.libraryId;
      CollectionConfigUpdater.updateConfigWithRatingKey(config.id, collectionRatingKey, libraryId);
    }
  }

  /**
   * Validate and sanitize collection items before processing
   */
  protected validateAndSanitizeItems(items: CollectionItem[]): {
    validItems: CollectionItem[];
    invalidItems: any[];
    validationErrors: string[];
  } {
    const validation = CollectionSyncUtils.validateCollectionItems(items);
    
    if (validation.errors.length > 0) {
      logger.warn(
        `Found ${validation.invalid.length} invalid items in ${this.source} collection`,
        {
          label: `${this.source} Collections`,
          errors: validation.errors.slice(0, 5), // Log first 5 errors to avoid spam
          totalErrors: validation.errors.length,
        }
      );
    }

    return {
      validItems: validation.valid,
      invalidItems: validation.invalid,
      validationErrors: validation.errors,
    };
  }

  /**
   * Apply common filtering to collection items (duplicates, invalid items, etc.)
   */
  protected applyCommonFiltering(
    items: CollectionItem[],
    config: CollectionConfig
  ): {
    filteredItems: CollectionItem[];
    stats: FilteringStats;
  } {
    const originalCount = items.length;
    const removalReasons: Record<string, number> = {};

    // Remove duplicates based on ratingKey
    const uniqueItems = items.reduce((acc, item) => {
      const existing = acc.find(existing => existing.ratingKey === item.ratingKey);
      if (existing) {
        removalReasons.duplicates = (removalReasons.duplicates || 0) + 1;
        return acc;
      }
      return [...acc, item];
    }, [] as CollectionItem[]);

    // Apply maxItems limit if specified
    let finalItems = uniqueItems;
    if (config.maxItems && config.maxItems > 0 && uniqueItems.length > config.maxItems) {
      finalItems = uniqueItems.slice(0, config.maxItems);
      removalReasons.maxItemsLimit = uniqueItems.length - config.maxItems;
    }

    return {
      filteredItems: finalItems,
      stats: this.createFilteringStats(originalCount, finalItems.length, removalReasons),
    };
  }

  /**
   * Log collection processing results with standardized format
   */
  protected logProcessingResults(
    config: CollectionConfig,
    result: CollectionOperationResult,
    processingTime: number,
    additionalContext?: Record<string, any>
  ): void {
    const logLevel = result.created > 0 || result.updated > 0 ? 'info' : 'debug';
    const action = result.created > 0 ? 'created' : result.updated > 0 ? 'updated' : 'processed';

    logger[logLevel](
      `Collection ${action}: ${config.name} (${result.itemCount || 0} items)`,
      {
        label: `${this.source} Collections`,
        configId: config.id,
        configName: config.name,
        action,
        created: result.created,
        updated: result.updated,
        itemCount: result.itemCount,
        processingTime,
        ...additionalContext,
      }
    );
  }

  /**
   * Handle rate limiting with exponential backoff
   */
  protected async handleRateLimit(attempt: number, maxAttempts?: number): Promise<void> {
    // Import here to avoid circular dependency
    const { API_CONFIG } = await import('./ConfigurationConstants');
    
    const effectiveMaxAttempts = maxAttempts || API_CONFIG.RATE_LIMIT.MAX_ATTEMPTS;
    
    if (attempt >= effectiveMaxAttempts) {
      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Rate limit exceeded after ${effectiveMaxAttempts} attempts`
      );
    }

    const delay = Math.min(
      API_CONFIG.RATE_LIMIT.BASE_DELAY_MS * Math.pow(API_CONFIG.RATE_LIMIT.BACKOFF_MULTIPLIER, attempt), 
      API_CONFIG.RATE_LIMIT.MAX_DELAY_MS
    );
    
    logger.warn(
      `Rate limit hit for ${this.source}, waiting ${delay}ms before retry (attempt ${attempt + 1}/${effectiveMaxAttempts})`,
      {
        label: `${this.source} Collections`,
        attempt: attempt + 1,
        maxAttempts: effectiveMaxAttempts,
        delay,
      }
    );

    await CollectionSyncUtils.delay(delay);
  }

  /**
   * Create collection name with fallbacks and sanitization
   */
  protected async createSanitizedCollectionName(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv',
    fallbackName?: string
  ): Promise<string> {
    try {
      const rawName = await this.generateCollectionName(config, mediaType);
      return CollectionSyncUtils.sanitizeCollectionName(rawName);
    } catch (error) {
      logger.warn(
        `Failed to generate collection name for ${config.name}, using fallback`,
        {
          label: `${this.source} Collections`,
          configId: config.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      
      const fallback = fallbackName || config.name || `${this.source} Collection`;
      return CollectionSyncUtils.sanitizeCollectionName(fallback);
    }
  }

  /**
   * Validate configuration with detailed error reporting
   */
  protected validateConfigurationDetailed(config: CollectionConfig, requiredFields: string[]): void {
    const missingFields = CollectionSyncUtils.validateRequiredFields(config, requiredFields);
    
    if (missingFields.length > 0) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        `Configuration validation failed for ${config.name}`,
        {
          configId: config.id,
          missingFields,
          providedFields: Object.keys(config),
        }
      );
    }
  }

  /**
   * Standardized collection creation/update using incremental approach
   * This is the ONLY method that should be used for collection updates
   */
  protected async createOrUpdateCollectionStandardized(
    items: CollectionItem[],
    collectionName: string,
    mediaType: 'movie' | 'tv',
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>,
    userInfo?: { userId?: number | string; customLabel?: string }
  ): Promise<CollectionOperationResult> {
    // Support user-specific collections for services like Overseerr
    const customLabel = userInfo?.customLabel || 
      CollectionSyncUtils.createCollectionLabel(
        this.source, 
        config.id, 
        userInfo?.userId ? Number(userInfo.userId) : undefined
      );
    
    const updateStrategy = CollectionUpdateStrategy.create(plexClient, allCollections);
    
    const updateResult = await updateStrategy.createOrUpdateCollection(items, {
      collectionName,
      mediaType,
      visibilityConfig: config.visibilityConfig || {
        usersHome: true,
        serverOwnerHome: false,
        libraryRecommended: true,
        libraryTabOnly: false,
      },
      customLabel,
      sortOrderLibrary: config.sortOrderLibrary,
      totalCollectionsInLibrary: (config as any)._totalCollectionsInLibrary,
      customPoster: config.customPoster,
      processedCollectionKeys,
    });

    // Update config with rating key if collection was created/updated
    if (updateResult.collectionRatingKey) {
      this.updateConfigWithRatingKey(config, updateResult.collectionRatingKey);
    }

    return {
      created: updateResult.created,
      updated: updateResult.updated,
      collectionRatingKey: updateResult.collectionRatingKey,
      itemCount: updateResult.itemCount,
      stats: updateResult.updateStats,
    };
  }

  // Abstract methods that must be implemented by subclasses

  /**
   * Validate that the source is properly configured
   * (e.g., API keys are present, services are reachable)
   */
  protected abstract validateConfiguration(): Promise<void>;

  /**
   * Process a single collection configuration
   */
  protected abstract processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>,
    options?: CollectionSyncOptions
  ): Promise<SyncResult>;

  /**
   * Create template context specific to this source
   */
  protected abstract createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<SourceTemplateContext>;

  /**
   * Fetch data from the external source (Trakt API, Tautulli API, etc.)
   */
  protected abstract fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions
  ): Promise<CollectionSourceData[]>;

  /**
   * Map source data to standardized CollectionItem format
   */
  protected abstract mapSourceDataToItems(
    sourceData: CollectionSourceData[],
    config?: CollectionConfig
  ): Promise<{
    items: CollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }>;

  /**
   * Create collection in Plex using the standardized pipeline
   */
  protected abstract createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: any[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>
  ): Promise<CollectionOperationResult>;

  /**
   * Evaluate time restrictions for a collection configuration
   * 
   * @param config - Collection configuration to evaluate
   * @returns TimeRestrictionResult indicating if collection should be active
   */
  protected evaluateTimeRestriction(config: CollectionConfig): TimeRestrictionResult {
    return TimeRestrictionUtils.evaluateTimeRestriction(config.timeRestriction);
  }

  /**
   * Handle collections that are currently inactive due to time restrictions
   * This removes the collection from Plex if it exists
   * 
   * @param config - Collection configuration
   * @param plexClient - Plex API client
   * @param allCollections - All collections from Plex
   * @param processedCollectionKeys - Set to track processed collection keys
   */
  protected async handleInactiveCollection(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<void> {
    try {
      // Generate the collection label that would be used for this config
      const collectionLabel = CollectionSyncUtils.createCollectionLabel(
        this.source,
        config.id
      );

      // Find existing collections with this label
      const existingCollections = allCollections.filter(collection => 
        collection.labels?.some((label: any) => label.tag === collectionLabel)
      );

      // This method is only called when removeFromPlexWhenInactive is true
      // So we only need the original deletion behavior
      for (const collection of existingCollections) {
        try {
          logger.info(
            `Removing time-restricted collection: ${collection.title}`,
            {
              label: `${this.source} Collections`,
              configId: config.id,
              configName: config.name,
              collectionId: collection.ratingKey,
            }
          );

          // Remove the collection from Plex
          await plexClient.deleteCollection(collection.ratingKey);
          
          // Mark as processed to avoid conflicts
          if (processedCollectionKeys) {
            processedCollectionKeys.add(collection.ratingKey);
          }
        } catch (error) {
          logger.warn(
            `Failed to remove time-restricted collection ${collection.title}: ${error}`,
            {
              label: `${this.source} Collections`,
              configId: config.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          );
        }
      }
    } catch (error) {
      logger.warn(
        `Failed to handle inactive collection for ${config.name}: ${error}`,
        {
          label: `${this.source} Collections`,
          configId: config.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
    }
  }

  /**
   * Process collections using media type processing strategies
   * This replaces duplicate media type handling logic across collection services
   */
  protected async processWithMediaTypeStrategy(
    items: CollectionItem[],
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>,
    userInfo?: { userId?: number | string; customLabel?: string }
  ): Promise<MediaProcessingResult> {
    const mediaType = config.mediaType as 'movie' | 'tv' | 'both';
    
    try {
      // Get appropriate processor for the media type
      const processor = mediaTypeProcessorFactory.getProcessor(mediaType, this);
      
      // Create processing context
      const context: MediaProcessingContext = {
        plexClient,
        allCollections,
        processedCollectionKeys,
        userInfo,
      };

      // Process using the strategy
      const result = await processor.process(items, config, context);
      
      logger.debug(`Media type processing completed`, {
        label: `${this.source} Collections`,
        configName: config.name,
        mediaType,
        created: result.created,
        updated: result.updated,
        itemCount: result.itemCount,
      });

      return result;
    } catch (error) {
      logger.error(`Media type processing failed`, {
        label: `${this.source} Collections`,
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

}

export default BaseCollectionSync;