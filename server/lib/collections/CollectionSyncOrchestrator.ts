import PlexAPI from '@server/api/plexapi';
import { getSettings } from '@server/lib/settings';
import { extractErrorMessage } from '@server/lib/utils/templateUtils';
import logger from '@server/logger';
import { createStandardSyncPipeline } from './stages';
import type { SyncPipeline, PipelineResult } from './stages';

// Import services for legacy methods that remain
import HubSyncService from './HubSyncService';
import CollectionCleanupService from './CollectionCleanupService';

/**
 * Main orchestrator for collection sync operations
 * Now uses the Pipeline pattern for improved modularity and testability
 */
export class CollectionSyncOrchestrator {
  private pipeline: SyncPipeline;
  private cancelled = false;

  // Legacy services for remaining methods
  private hubSyncService = new HubSyncService();
  private collectionCleanupService = new CollectionCleanupService();

  constructor() {
    // Create the standard sync pipeline with all stages
    this.pipeline = createStandardSyncPipeline();
  }

  public cancel(): void {
    this.cancelled = true;
    // Cancel the pipeline execution
    this.pipeline.cancel();
  }

  /**
   * Orchestrate the complete collection sync process using the pipeline pattern
   */
  public async syncCollections(plexClient: PlexAPI): Promise<void> {
    if (this.cancelled) return;

    try {
      const settings = getSettings();
      const collectionConfigs = settings.plex.collectionConfigs || [];

      logger.info('Starting configuration-driven collections sync with pipeline', {
        label: 'Collection Sync Orchestrator',
        totalConfigs: collectionConfigs.length,
        pipelineStages: this.pipeline.getInfo().stageNames,
      });

      // Execute the complete sync pipeline
      const result: PipelineResult = await this.pipeline.execute(plexClient, collectionConfigs);

      if (result.success) {
        logger.info('Collections sync completed successfully', {
          label: 'Collection Sync Orchestrator',
          duration: result.duration,
          stats: result.stats,
          completedStages: result.completedStages,
        });
      } else {
        // Pipeline failed or was cancelled
        const errorMessage = result.error?.message || 'Pipeline execution failed';
        
        logger.error('Collections sync failed during pipeline execution', {
          label: 'Collection Sync Orchestrator',
          error: errorMessage,
          duration: result.duration,
          completedStages: result.completedStages,
          failedStage: result.failedStage,
          stats: result.stats,
        });

        throw new Error(`Plex collections sync failed: ${errorMessage}`);
      }

    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      logger.error(`Collections sync orchestrator error: ${errorMessage}`, {
        label: 'Collection Sync Orchestrator',
      });
      throw new Error(`Plex collections sync failed: ${errorMessage}`);
    }
  }


  /**
   * Sync hub visibility and ordering
   */
  public async syncHubVisibility(plexClient: PlexAPI): Promise<void> {
    await this.hubSyncService.syncHubVisibility(plexClient);
  }

  /**
   * Sync unified ordering (collections + hubs)
   */
  public async syncUnifiedOrdering(plexClient: PlexAPI): Promise<void> {
    await this.hubSyncService.syncUnifiedOrdering(plexClient);
  }

  /**
   * Legacy cleanup operations
   */
  public async cleanupCollections(plexClient: PlexAPI): Promise<void> {
    await this.collectionCleanupService.cleanupCollections(plexClient);
  }

  /**
   * Purge all data operation
   */
  public async purgeAllData(plexClient: PlexAPI): Promise<{
    collectionsDeleted: number;
    usersProcessed: number;
    labelsSuccessful: number;
    labelsFailed: number;
  }> {
    return await this.collectionCleanupService.purgeAllData(plexClient);
  }
}

export default CollectionSyncOrchestrator;