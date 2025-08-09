import logger from '@server/logger';
import type { PipelineStage, SyncContext } from '../SyncPipeline';
import type { CollectionConfig } from '@server/lib/settings';
import ConfigurationService from '../ConfigurationService';
import { collectionTypeRegistry } from '../CollectionTypeRegistry';

// Initialize registry (ensures it's ready)
import '../RegistryInitializer';

/**
 * Stage 4: Collection Processing
 * 
 * Responsibilities:
 * - Process collections by library for proper ordering
 * - Coordinate different collection sync services
 * - Track collection creation and updates
 * - Handle collection ordering and metadata
 */
export class CollectionProcessingStage implements PipelineStage {
  readonly name = 'collection-processing';
  readonly description = 'Process and sync collections by library';

  private configurationService = new ConfigurationService();

  shouldSkip(context: SyncContext): boolean {
    // Skip if no collection configurations
    if (context.collectionConfigs.length === 0) {
      logger.debug('Skipping collection processing - no configurations found', {
        label: 'Collection Processing Stage',
      });
      return true;
    }
    
    return false;
  }

  async execute(context: SyncContext): Promise<void> {
    if (!context.allCollections || !context.processedCollectionKeys) {
      throw new Error('Required context data missing for collection processing');
    }

    logger.info('Starting collection processing by library', {
      label: 'Collection Processing Stage',
      totalConfigs: context.collectionConfigs.length,
      libraries: this.getUniqueLibraries(context.collectionConfigs),
    });

    const processingResults = {
      totalCreated: 0,
      totalUpdated: 0,
      libraryResults: {} as Record<string, { created: number; updated: number }>,
      serviceResults: {} as Record<string, { created: number; updated: number }>,
    };

    try {
      // Expand and validate configurations
      const expandedConfigs = this.configurationService.expandConfigurations(
        context.collectionConfigs
      );

      // Group configurations by library for processing
      const configsByLibrary = this.groupConfigsByLibrary(expandedConfigs);

      // Process each library separately to maintain proper collection ordering
      for (const [libraryId, libraryConfigs] of Object.entries(configsByLibrary)) {
        if (context.cancelled) break;

        logger.info(`Processing collections for library: ${libraryId}`, {
          label: 'Collection Processing Stage',
          libraryId,
          configCount: libraryConfigs.length,
        });

        const libraryResult = await this.processLibraryCollections(
          libraryId,
          libraryConfigs,
          context,
          processingResults.serviceResults
        );

        processingResults.libraryResults[libraryId] = libraryResult;
        processingResults.totalCreated += libraryResult.created;
        processingResults.totalUpdated += libraryResult.updated;
      }

      // Update context stats
      context.stats.created += processingResults.totalCreated;
      context.stats.updated += processingResults.totalUpdated;

      logger.info('Collection processing completed', {
        label: 'Collection Processing Stage',
        totalCreated: processingResults.totalCreated,
        totalUpdated: processingResults.totalUpdated,
        librariesProcessed: Object.keys(processingResults.libraryResults).length,
        serviceBreakdown: processingResults.serviceResults,
      });

      // Store results for pipeline tracking
      context.stats.stageResults[this.name] = processingResults;

    } catch (error) {
      logger.error('Collection processing failed', {
        label: 'Collection Processing Stage',
        error: error instanceof Error ? error.message : String(error),
      });

      context.stats.errors++;
      throw error; // Re-throw to stop pipeline
    }
  }

  /**
   * Process collections for a specific library
   */
  private async processLibraryCollections(
    libraryId: string,
    configs: CollectionConfig[],
    context: SyncContext,
    serviceResults: Record<string, { created: number; updated: number }>
  ): Promise<{ created: number; updated: number }> {
    let libraryCreated = 0;
    let libraryUpdated = 0;

    // Process each collection service type
    const serviceTypes = [...new Set(configs.map(config => config.type))];
    
    for (const serviceType of serviceTypes) {
      if (context.cancelled) break;

      const serviceConfigs = configs.filter(config => config.type === serviceType);
      
      // Validate config before creating service
      const validationResult = collectionTypeRegistry.validateConfig(serviceConfigs[0]);
      if (!validationResult.valid) {
        logger.error(`Invalid configuration for service type: ${serviceType}`, {
          label: 'Collection Processing Stage',
          serviceType,
          libraryId,
          errors: validationResult.errors,
        });
        context.stats.errors++;
        continue;
      }

      // Log warnings if any
      if (validationResult.warnings.length > 0) {
        logger.warn(`Configuration warnings for service type: ${serviceType}`, {
          label: 'Collection Processing Stage',
          serviceType,
          libraryId,
          warnings: validationResult.warnings,
        });
      }

      let service;
      try {
        service = collectionTypeRegistry.createService(serviceType);
      } catch (error) {
        logger.error(`Failed to create service for type: ${serviceType}`, {
          label: 'Collection Processing Stage',
          serviceType,
          libraryId,
          error: error instanceof Error ? error.message : String(error),
        });
        context.stats.errors++;
        continue;
      }

      try {
        logger.debug(`Processing ${serviceType} collections for library ${libraryId}`, {
          label: 'Collection Processing Stage',
          serviceType,
          libraryId,
          configCount: serviceConfigs.length,
        });

        const result = await service.processCollections(
          serviceConfigs,
          context.plexClient,
          context.allCollections!,
          context.processedCollectionKeys
        );

        libraryCreated += result.created;
        libraryUpdated += result.updated;

        // Track service-level results
        if (!serviceResults[serviceType]) {
          serviceResults[serviceType] = { created: 0, updated: 0 };
        }
        serviceResults[serviceType].created += result.created;
        serviceResults[serviceType].updated += result.updated;

        if (result.error) {
          logger.warn(`${serviceType} service reported errors`, {
            label: 'Collection Processing Stage',
            serviceType,
            error: result.error,
            libraryId,
          });
        }

      } catch (error) {
        logger.error(`Failed to process ${serviceType} collections for library ${libraryId}`, {
          label: 'Collection Processing Stage',
          serviceType,
          libraryId,
          error: error instanceof Error ? error.message : String(error),
        });

        context.stats.errors++;
        // Continue with other services - don't fail entire library
      }
    }

    return { created: libraryCreated, updated: libraryUpdated };
  }

  /**
   * Group collection configurations by library ID
   */
  private groupConfigsByLibrary(configs: CollectionConfig[]): Record<string, CollectionConfig[]> {
    const grouped: Record<string, CollectionConfig[]> = {};

    for (const config of configs) {
      const libraryIds = Array.isArray(config.libraryId) 
        ? config.libraryId 
        : [config.libraryId];

      for (const libraryId of libraryIds) {
        if (libraryId) { // Only process if libraryId is defined
          if (!grouped[libraryId]) {
            grouped[libraryId] = [];
          }
          grouped[libraryId].push(config);
        }
      }
    }

    return grouped;
  }

  /**
   * Get unique library IDs from configurations
   */
  private getUniqueLibraries(configs: CollectionConfig[]): string[] {
    const libraries = new Set<string>();

    for (const config of configs) {
      const libraryIds = Array.isArray(config.libraryId) 
        ? config.libraryId 
        : [config.libraryId];
      
      for (const libraryId of libraryIds) {
        if (libraryId) { // Only add if libraryId is defined
          libraries.add(libraryId);
        }
      }
    }

    return Array.from(libraries);
  }
}