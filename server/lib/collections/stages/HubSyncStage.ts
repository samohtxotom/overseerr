import logger from '@server/logger';
import type { PipelineStage, SyncContext } from '../SyncPipeline';
import HubSyncService from '../HubSyncService';

/**
 * Stage 6: Hub Synchronization
 * 
 * Responsibilities:
 * - Sync Plex hub ordering based on collection configurations
 * - Apply unified ordering to collections and hubs
 * - Maintain proper home screen organization
 */
export class HubSyncStage implements PipelineStage {
  readonly name = 'hub-sync';
  readonly description = 'Synchronize Plex hub ordering and organization';

  private hubSyncService = new HubSyncService();

  shouldSkip(context: SyncContext): boolean {
    // Skip if no collection configurations that might affect hub ordering
    const hasConfigs = context.collectionConfigs.length > 0;
    
    if (!hasConfigs) {
      logger.debug('Skipping hub sync stage - no configurations to process', {
        label: 'Hub Sync Stage',
      });
      return true;
    }
    
    return false;
  }

  async execute(context: SyncContext): Promise<void> {
    logger.info('Starting Plex hub synchronization', {
      label: 'Hub Sync Stage',
      totalConfigs: context.collectionConfigs.length,
    });

    try {
      // Hub sync doesn't return a result object, just call the sync method
      await this.hubSyncService.syncUnifiedOrdering(context.plexClient);
      
      // Create a mock result for consistency
      const hubResult = {
        hubsProcessed: 0,
        orderingItemsApplied: 0,
        librariesUpdated: 0,
      };

      logger.info('Hub synchronization completed', {
        label: 'Hub Sync Stage',
        hubsProcessed: hubResult.hubsProcessed || 0,
        orderingItemsApplied: hubResult.orderingItemsApplied || 0,
        librariesUpdated: hubResult.librariesUpdated || 0,
      });

      // Store results for pipeline tracking
      context.stats.stageResults[this.name] = {
        hubsProcessed: hubResult.hubsProcessed || 0,
        orderingItemsApplied: hubResult.orderingItemsApplied || 0,
        librariesUpdated: hubResult.librariesUpdated || 0,
      };

    } catch (error) {
      logger.error('Hub synchronization failed', {
        label: 'Hub Sync Stage',
        error: error instanceof Error ? error.message : String(error),
      });

      context.stats.errors++;
      context.stats.stageResults[this.name] = {
        error: error instanceof Error ? error.message : String(error),
        hubsProcessed: 0,
      };

      // Don't re-throw - hub sync failures shouldn't stop the pipeline
      // Collection sync can succeed even if hub ordering fails
    }
  }

  cleanup(): void {
    // Cancel any ongoing hub sync operations
    this.hubSyncService.cancel();
  }
}