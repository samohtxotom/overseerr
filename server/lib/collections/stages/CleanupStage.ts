import logger from '@server/logger';
import type { PipelineStage, SyncContext } from '../SyncPipeline';
import CollectionCleanupService from '../CollectionCleanupService';

/**
 * Stage 5: Collection Cleanup
 * 
 * Responsibilities:
 * - Remove orphaned collections that are no longer configured
 * - Clean up collections for users who no longer have requests
 * - Track cleanup statistics
 */
export class CleanupStage implements PipelineStage {
  readonly name = 'cleanup';
  readonly description = 'Clean up orphaned and unused collections';

  private cleanupService = new CollectionCleanupService();

  shouldSkip(context: SyncContext): boolean {
    // Skip if no existing Agregarr collections to potentially clean up
    const hasCollectionsToCleanup = context.existingAgregarrCollections && 
                                   context.existingAgregarrCollections.length > 0;
    
    if (!hasCollectionsToCleanup) {
      logger.debug('Skipping cleanup stage - no existing Agregarr collections found', {
        label: 'Cleanup Stage',
      });
      return true;
    }
    
    return false;
  }

  async execute(context: SyncContext): Promise<void> {
    if (!context.existingAgregarrCollections || !context.processedCollectionKeys) {
      logger.warn('Required cleanup data not available', {
        label: 'Cleanup Stage',
        hasExistingCollections: !!context.existingAgregarrCollections,
        hasProcessedKeys: !!context.processedCollectionKeys,
      });
      return;
    }

    logger.info('Starting collection cleanup process', {
      label: 'Cleanup Stage',
      existingCollections: context.existingAgregarrCollections.length,
      processedCollections: context.processedCollectionKeys.size,
    });

    try {
      const cleanupResult = await this.cleanupService.cleanupDisabledCollections(
        context.plexClient,
        context.existingAgregarrCollections,
        context.collectionConfigs,
        context.userCollections || {},
        context.processedCollectionKeys
      );

      const totalCleaned = cleanupResult.deleted;
      context.stats.cleaned += totalCleaned;

      logger.info('Collection cleanup completed', {
        label: 'Cleanup Stage',
        collectionsDeleted: cleanupResult.deleted,
        totalCleaned,
      });

      // Store results for pipeline tracking
      context.stats.stageResults[this.name] = {
        collectionsDeleted: cleanupResult.deleted,
        totalCleaned,
      };

    } catch (error) {
      logger.error('Collection cleanup failed', {
        label: 'Cleanup Stage',
        error: error instanceof Error ? error.message : String(error),
      });

      context.stats.errors++;
      context.stats.stageResults[this.name] = {
        error: error instanceof Error ? error.message : String(error),
        totalCleaned: 0,
      };

      // Don't re-throw - cleanup failures shouldn't stop the entire pipeline
      // The sync was successful even if cleanup had issues
    }
  }

  cleanup(): void {
    // Cancel any ongoing cleanup operations
    this.cleanupService.cancel();
  }
}