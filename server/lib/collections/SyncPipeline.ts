import logger from '@server/logger';
import type PlexAPI from '@server/api/plexapi';
import type { CollectionConfig } from '@server/lib/settings';

/**
 * Context object that flows through the pipeline, accumulating data and state
 */
export interface SyncContext {
  // Input data
  plexClient: PlexAPI;
  collectionConfigs: CollectionConfig[];
  
  // Pipeline state
  cancelled: boolean;
  startTime: number;
  currentStage: string;
  
  // Accumulated data from stages
  allCollections?: any[];
  existingAgregarrCollections?: any[];
  requests?: any[];
  userCollections?: any;
  userCount?: number;
  processedCollectionKeys?: Set<string>;
  
  // Results tracking
  stats: {
    created: number;
    updated: number;
    cleaned: number;
    errors: number;
    stageResults: Record<string, any>;
  };
}

/**
 * Base interface for all pipeline stages
 */
export interface PipelineStage {
  readonly name: string;
  readonly description: string;
  
  /**
   * Execute this stage of the pipeline
   * @param context - The sync context containing all necessary data
   * @returns Promise that resolves when stage is complete
   */
  execute(context: SyncContext): Promise<void>;
  
  /**
   * Check if this stage should be skipped based on context
   * @param context - The sync context
   * @returns true if stage should be skipped
   */
  shouldSkip?(context: SyncContext): boolean;
  
  /**
   * Clean up any resources used by this stage
   */
  cleanup?(): void;
}

/**
 * Result of pipeline execution
 */
export interface PipelineResult {
  success: boolean;
  duration: number;
  stats: SyncContext['stats'];
  error?: Error;
  completedStages: string[];
  failedStage?: string;
}

/**
 * Pipeline execution engine that orchestrates the sync process
 * 
 * This implements the Pipeline pattern, where each stage:
 * 1. Receives a context object with all current data
 * 2. Performs its specific operation
 * 3. Updates the context for the next stage
 * 4. Passes control to the next stage
 */
export class SyncPipeline {
  private stages: PipelineStage[] = [];
  private cancelled = false;

  /**
   * Add a stage to the pipeline
   */
  addStage(stage: PipelineStage): SyncPipeline {
    this.stages.push(stage);
    return this;
  }

  /**
   * Add multiple stages to the pipeline
   */
  addStages(stages: PipelineStage[]): SyncPipeline {
    this.stages.push(...stages);
    return this;
  }

  /**
   * Cancel the pipeline execution
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Execute the complete pipeline
   */
  async execute(
    plexClient: PlexAPI, 
    collectionConfigs: CollectionConfig[]
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    const completedStages: string[] = [];
    
    // Initialize context
    const context: SyncContext = {
      plexClient,
      collectionConfigs,
      cancelled: false,
      startTime,
      currentStage: '',
      stats: {
        created: 0,
        updated: 0,
        cleaned: 0,
        errors: 0,
        stageResults: {},
      },
      processedCollectionKeys: new Set<string>(),
    };

    logger.info('Starting collection sync pipeline', {
      label: 'Sync Pipeline',
      totalStages: this.stages.length,
      totalConfigs: collectionConfigs.length,
      stages: this.stages.map(s => s.name),
    });

    try {
      // Execute each stage in sequence
      for (const stage of this.stages) {
        // Check for cancellation
        if (this.cancelled || context.cancelled) {
          context.cancelled = true;
          logger.info('Pipeline execution cancelled', {
            label: 'Sync Pipeline',
            completedStages,
            currentStage: stage.name,
          });
          break;
        }

        context.currentStage = stage.name;

        // Check if stage should be skipped
        if (stage.shouldSkip?.(context)) {
          logger.debug(`Skipping stage: ${stage.name}`, {
            label: 'Sync Pipeline',
            reason: 'Stage conditions not met',
          });
          continue;
        }

        logger.info(`Executing pipeline stage: ${stage.name}`, {
          label: 'Sync Pipeline',
          description: stage.description,
          stageIndex: completedStages.length + 1,
          totalStages: this.stages.length,
        });

        const stageStartTime = Date.now();

        try {
          // Execute the stage
          await stage.execute(context);
          
          const stageDuration = Date.now() - stageStartTime;
          completedStages.push(stage.name);
          
          logger.info(`Completed pipeline stage: ${stage.name}`, {
            label: 'Sync Pipeline',
            duration: stageDuration,
            stats: context.stats,
          });

        } catch (error) {
          context.stats.errors++;
          const stageDuration = Date.now() - stageStartTime;
          
          logger.error(`Pipeline stage failed: ${stage.name}`, {
            label: 'Sync Pipeline',
            error: error instanceof Error ? error.message : String(error),
            duration: stageDuration,
            completedStages,
          });

          // Re-throw to stop pipeline execution
          throw error;
        }
      }

      const totalDuration = Date.now() - startTime;
      
      logger.info('Collection sync pipeline completed successfully', {
        label: 'Sync Pipeline',
        duration: totalDuration,
        completedStages,
        stats: context.stats,
        cancelled: context.cancelled,
      });

      return {
        success: !context.cancelled,
        duration: totalDuration,
        stats: context.stats,
        completedStages,
      };

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      const pipelineError = error instanceof Error ? error : new Error(String(error));
      
      logger.error('Collection sync pipeline failed', {
        label: 'Sync Pipeline',
        error: pipelineError.message,
        duration: totalDuration,
        completedStages,
        failedStage: context.currentStage,
        stats: context.stats,
      });

      return {
        success: false,
        duration: totalDuration,
        stats: context.stats,
        error: pipelineError,
        completedStages,
        failedStage: context.currentStage,
      };

    } finally {
      // Clean up all stages
      for (const stage of this.stages) {
        try {
          stage.cleanup?.();
        } catch (cleanupError) {
          logger.warn(`Stage cleanup failed: ${stage.name}`, {
            label: 'Sync Pipeline',
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
      }
    }
  }

  /**
   * Get information about the current pipeline configuration
   */
  getInfo(): { totalStages: number; stageNames: string[] } {
    return {
      totalStages: this.stages.length,
      stageNames: this.stages.map(s => s.name),
    };
  }

  /**
   * Clear all stages from the pipeline
   */
  clear(): void {
    this.stages = [];
  }
}

/**
 * Factory function to create a pipeline with common error handling
 */
export function createSyncPipeline(): SyncPipeline {
  return new SyncPipeline();
}

export default SyncPipeline;