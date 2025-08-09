import logger from '@server/logger';
import type { PipelineStage, SyncContext } from '../SyncPipeline';
import { overseerrCollectionService } from '../OverseerrCollectionService';

/**
 * Stage 2: Overseerr Data Preparation
 * 
 * Responsibilities:
 * - Fetch Overseerr requests if any Overseerr collections are configured
 * - Organize requests by user for collection processing
 * - Prepare user collection data structures
 */
export class OverseerrDataStage implements PipelineStage {
  readonly name = 'overseerr-data';
  readonly description = 'Prepare Overseerr request data and user collections';

  shouldSkip(context: SyncContext): boolean {
    // Skip if no Overseerr collection configurations
    const hasOverseerrConfigs = context.collectionConfigs.some(config => config.type === 'overseerr');
    
    if (!hasOverseerrConfigs) {
      logger.debug('Skipping Overseerr data stage - no Overseerr collections configured', {
        label: 'Overseerr Data Stage',
      });
      return true;
    }
    
    return false;
  }

  async execute(context: SyncContext): Promise<void> {
    logger.info('Preparing Overseerr data for collection processing', {
      label: 'Overseerr Data Stage',
    });

    try {
      // Fetch approved requests from Overseerr
      context.requests = await overseerrCollectionService.getApprovedRequests();
      
      logger.info('Successfully fetched Overseerr requests', {
        label: 'Overseerr Data Stage',
        requestCount: context.requests.length,
      });

      // Organize requests by user for collection processing
      context.userCollections = this.organizeRequestsByUser(context.requests);
      context.userCount = Object.keys(context.userCollections).length;

      logger.info('Organized requests into user collections', {
        label: 'Overseerr Data Stage',
        userCount: context.userCount,
        totalRequests: context.requests.length,
      });

      // Store results for pipeline tracking
      context.stats.stageResults[this.name] = {
        requestCount: context.requests.length,
        userCount: context.userCount,
        usersWithRequests: Object.keys(context.userCollections),
      };

    } catch (error) {
      logger.error('Failed to prepare Overseerr data', {
        label: 'Overseerr Data Stage',
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Set empty defaults to continue pipeline
      context.requests = [];
      context.userCollections = {};
      context.userCount = 0;
      
      context.stats.stageResults[this.name] = {
        requestCount: 0,
        userCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Organize requests by user Plex ID for collection processing
   */
  private organizeRequestsByUser(requests: any[]): any {
    const userCollections: any = {};

    for (const request of requests) {
      // Skip admin requests (handled separately via server_owner collection type)
      if (request.requestedBy?.id === 1) {
        continue;
      }

      // Use the Plex ID from the user, not the Overseerr user ID
      const userPlexId = request.requestedBy?.plexId;
      if (!userPlexId) {
        continue;
      }

      const userPlexIdStr = userPlexId.toString();

      // Initialize user collection if not exists
      if (!userCollections[userPlexIdStr]) {
        userCollections[userPlexIdStr] = {
          movies: [],
          tv: [],
          user: request.requestedBy,
        };
      }

      // Get the correct rating key based on whether it's 4K or not
      const ratingKey = request.is4k
        ? request.media?.ratingKey4k
        : request.media?.ratingKey;

      if (!ratingKey || !request.requestedBy) {
        continue;
      }

      const collectionItem = {
        ratingKey: ratingKey,
        title: request.media?.title || 'Unknown Title',
        type: request.type,
      };

      // Add to appropriate media type collection
      if (request.type === 'movie') {
        userCollections[userPlexIdStr].movies.push(collectionItem);
      } else if (request.type === 'tv') {
        userCollections[userPlexIdStr].tv.push(collectionItem);
      }
    }

    return userCollections;
  }
}