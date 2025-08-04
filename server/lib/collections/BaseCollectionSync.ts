import type PlexAPI from '@server/api/plexapi';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';
import type { TemplateEngine } from './TemplateEngine';
import { templateEngine } from './TemplateEngine';
import type { ServiceUserManager } from './ServiceUserManager';
import { serviceUserManager } from './ServiceUserManager';
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
   * Split collection items by media type
   */
  protected splitItemsByMediaType(items: CollectionItem[]): {
    movieItems: CollectionItem[];
    tvItems: CollectionItem[];
  } {
    const movieItems = items.filter(item => item.type === 'movie');
    const tvItems = items.filter(item => item.type === 'tv');
    
    return { movieItems, tvItems };
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

}

/**
 * Utility functions for collection sync operations
 */
export class CollectionSyncUtils {
  /**
   * Validate collection configuration
   */
  static validateConfig(config: CollectionConfig): boolean {
    return !!(
      config.id &&
      config.name &&
      config.type &&
      config.maxItems &&
      config.maxItems > 0
    );
  }

  /**
   * Sanitize collection name for Plex
   */
  static sanitizeCollectionName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim()
      .substring(0, 100); // Limit length
  }

  /**
   * Create collection label for identification
   */
  static createCollectionLabel(
    source: CollectionSource,
    configId: number,
    userId?: number
  ): string {
    const baseLabel = `overseerr:${source}:${configId}`;
    return userId ? `${baseLabel}:user:${userId}` : baseLabel;
  }

  /**
   * Parse collection label to extract information
   */
  static parseCollectionLabel(label: string): {
    source?: CollectionSource;
    configId?: number;
    userId?: number;
  } {
    const parts = label.split(':');
    if (parts[0] !== 'overseerr' || parts.length < 3) {
      return {};
    }

    const result: any = {
      source: parts[1] as CollectionSource,
      configId: parseInt(parts[2], 10),
    };

    if (parts.length >= 5 && parts[3] === 'user') {
      result.userId = parseInt(parts[4], 10);
    }

    return result;
  }

  /**
   * Calculate progress percentage
   */
  static calculateProgress(current: number, total: number): number {
    if (total === 0) return 100;
    return Math.round((current / total) * 100);
  }

  /**
   * Create a delay for rate limiting
   */
  static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default BaseCollectionSync;