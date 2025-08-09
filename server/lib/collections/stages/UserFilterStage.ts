import logger from '@server/logger';
import type { PipelineStage, SyncContext } from '../SyncPipeline';
import UserFilterManager from '../UserFilterManager';

/**
 * Stage 3: User Filter Management
 * 
 * Responsibilities:
 * - Update Plex user filtering settings (privacy-first approach)
 * - Clear filters for users without collections
 * - Apply appropriate filtering for users with collections
 */
export class UserFilterStage implements PipelineStage {
  readonly name = 'user-filters';
  readonly description = 'Update Plex user filtering settings';
  
  private userFilterManager = new UserFilterManager();

  shouldSkip(context: SyncContext): boolean {
    // Skip if no user collections data (no Overseerr configs or no requests)
    const hasUserCollections = context.userCollections && Object.keys(context.userCollections).length > 0;
    
    if (!hasUserCollections) {
      logger.debug('Skipping user filter stage - no user collections to process', {
        label: 'User Filter Stage',
      });
      return true;
    }
    
    return false;
  }

  async execute(context: SyncContext): Promise<void> {
    if (!context.userCollections) {
      logger.warn('User collections not available for filter processing', {
        label: 'User Filter Stage',
      });
      return;
    }

    logger.info('Updating Plex user filtering settings', {
      label: 'User Filter Stage',
      userCount: Object.keys(context.userCollections).length,
    });

    try {
      // Check if we have user label collections to determine action
      const hasUserLabelCollections = context.collectionConfigs.some(
        config => config.subtype === 'users' || config.subtype === 'server_owner'
      );

      let processedUsers = 0;
      
      if (hasUserLabelCollections && Object.keys(context.userCollections).length > 0) {
        // Apply user privacy filters for active users
        await this.userFilterManager.updateUserFiltersForActiveUsers(context.userCollections);
        processedUsers = Object.keys(context.userCollections).length;
        
        logger.info('User filter processing completed - filters applied', {
          label: 'User Filter Stage',
          processedUsers,
        });
      } else {
        // Clean up all Overseerr user labels when no user/server_owner collections are configured
        await this.userFilterManager.cleanupAllUserFilters();
        
        logger.info('User filter processing completed - filters cleaned up', {
          label: 'User Filter Stage',
          processedUsers: 0,
        });
      }

      // Store results for pipeline tracking
      context.stats.stageResults[this.name] = {
        processedUsers,
        hasUserLabelCollections,
        action: hasUserLabelCollections ? 'applied' : 'cleaned_up',
      };

    } catch (error) {
      logger.error('Failed to update user filters', {
        label: 'User Filter Stage',
        error: error instanceof Error ? error.message : String(error),
      });

      context.stats.errors++;
      context.stats.stageResults[this.name] = {
        error: error instanceof Error ? error.message : String(error),
      };

      // Continue pipeline - filter failures shouldn't stop collection sync
    }
  }

  cleanup(): void {
    // Cancel any ongoing operations in the user filter manager
    this.userFilterManager.cancel();
  }
}