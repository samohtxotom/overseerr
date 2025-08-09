import logger from '@server/logger';
import type { PipelineStage, SyncContext } from '../SyncPipeline';

/**
 * Stage 1: Initialization
 * 
 * Responsibilities:
 * - Fetch all collections from Plex (performance optimization)
 * - Filter existing Agregarr collections for cleanup tracking
 * - Initialize processing state
 */
export class InitializationStage implements PipelineStage {
  readonly name = 'initialization';
  readonly description = 'Initialize sync process and fetch Plex collections';

  async execute(context: SyncContext): Promise<void> {
    logger.info('Fetching all collections from Plex for sync optimization', {
      label: 'Initialization Stage',
    });

    // Get all collections once for the entire sync (performance optimization)
    context.allCollections = await context.plexClient.getAllCollections();
    
    // Filter existing Agregarr collections for cleanup tracking
    context.existingAgregarrCollections = this.filterAgregarrCollections(context.allCollections);

    logger.info('Initialization complete', {
      label: 'Initialization Stage',
      totalCollections: context.allCollections.length,
      existingAgregarrCollections: context.existingAgregarrCollections.length,
    });

    // Store results for pipeline tracking
    context.stats.stageResults[this.name] = {
      totalCollections: context.allCollections.length,
      existingAgregarrCollections: context.existingAgregarrCollections.length,
    };
  }

  /**
   * Filter collections to find existing Agregarr-managed collections
   */
  private filterAgregarrCollections(allCollections: any[]): any[] {
    return allCollections.filter(collection => {
      if (!collection.labels || !Array.isArray(collection.labels)) {
        return false;
      }

      // Check if any label indicates this is an Agregarr collection
      return collection.labels.some((label: any) => {
        const labelText = typeof label === 'string' ? label : label.tag || '';
        return labelText.toLowerCase().includes('agregarr');
      });
    });
  }
}