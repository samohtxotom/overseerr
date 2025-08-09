// Export all pipeline stages
export { InitializationStage } from './InitializationStage';
export { OverseerrDataStage } from './OverseerrDataStage';
export { UserFilterStage } from './UserFilterStage';
export { CollectionProcessingStage } from './CollectionProcessingStage';
export { CleanupStage } from './CleanupStage';
export { HubSyncStage } from './HubSyncStage';

// Export pipeline infrastructure
export { SyncPipeline, createSyncPipeline } from '../SyncPipeline';
export type { 
  PipelineStage, 
  SyncContext, 
  PipelineResult 
} from '../SyncPipeline';

import { SyncPipeline } from '../SyncPipeline';
import { InitializationStage } from './InitializationStage';
import { OverseerrDataStage } from './OverseerrDataStage';
import { UserFilterStage } from './UserFilterStage';
import { CollectionProcessingStage } from './CollectionProcessingStage';
import { CleanupStage } from './CleanupStage';
import { HubSyncStage } from './HubSyncStage';

/**
 * Factory function to create a complete sync pipeline with all standard stages
 * 
 * The stages are executed in this order:
 * 1. Initialization - Fetch collections and prepare state
 * 2. Overseerr Data - Fetch and organize request data
 * 3. User Filters - Update Plex user filtering
 * 4. Collection Processing - Create/update collections
 * 5. Cleanup - Remove orphaned collections
 * 6. Hub Sync - Organize home screen ordering
 */
export function createStandardSyncPipeline(): SyncPipeline {
  return new SyncPipeline()
    .addStages([
      new InitializationStage(),
      new OverseerrDataStage(),
      new UserFilterStage(),
      new CollectionProcessingStage(),
      new CleanupStage(),
      new HubSyncStage(),
    ]);
}

/**
 * Factory function to create a minimal sync pipeline (collections only)
 * Useful for testing or when you only need basic collection sync
 */
export function createMinimalSyncPipeline(): SyncPipeline {
  return new SyncPipeline()
    .addStages([
      new InitializationStage(),
      new CollectionProcessingStage(),
      new CleanupStage(),
    ]);
}

/**
 * Factory function to create a custom pipeline with specified stages
 */
export function createCustomSyncPipeline(stages: string[]): SyncPipeline {
  const stageMap = {
    'initialization': () => new InitializationStage(),
    'overseerr-data': () => new OverseerrDataStage(),
    'user-filters': () => new UserFilterStage(),
    'collection-processing': () => new CollectionProcessingStage(),
    'cleanup': () => new CleanupStage(),
    'hub-sync': () => new HubSyncStage(),
  };

  const pipeline = new SyncPipeline();
  
  for (const stageName of stages) {
    const stageFactory = stageMap[stageName as keyof typeof stageMap];
    if (stageFactory) {
      pipeline.addStage(stageFactory());
    } else {
      throw new Error(`Unknown stage: ${stageName}`);
    }
  }

  return pipeline;
}