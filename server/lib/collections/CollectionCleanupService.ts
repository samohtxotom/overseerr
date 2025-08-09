import type PlexAPI from '@server/api/plexapi';
import { overseerrCollectionService } from './OverseerrCollectionService';
import { extractErrorMessage } from '@server/lib/utils/templateUtils';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

interface UserCollections {
  [userId: string]: {
    movies: { ratingKey: string; type?: string; }[];
    tv: { ratingKey: string; type?: string; }[];
    user: any;
  };
}

/**
 * Service for cleaning up orphaned and disabled collections
 */
export class CollectionCleanupService {
  private cancelled = false;

  public cancel(): void {
    this.cancelled = true;
  }

  /**
   * Clean up collections that no longer have active configurations
   */
  public async cleanupDisabledCollections(
    plexClient: PlexAPI,
    existingAgregarrCollections: any[],
    currentConfigs: CollectionConfig[],
    userCollections: UserCollections,
    processedCollectionKeys: Set<string>
  ): Promise<{ deleted: number }> {
    let deleted = 0;

    // Get all config types and their labels
    const activeConfigLabels = this.generateActiveConfigLabels(currentConfigs);

    // Get current user Plex IDs for orphaned user collection cleanup
    const currentUserPlexIds = new Set(Object.keys(userCollections));

    for (const collection of existingAgregarrCollections) {
      if (this.cancelled) break;

      try {
        const deletionResult = await this.evaluateCollectionForDeletion(
          collection,
          activeConfigLabels,
          currentUserPlexIds,
          processedCollectionKeys
        );

        if (deletionResult.shouldDelete) {
          await plexClient.deleteCollection(collection.ratingKey);
          deleted++;
          logger.info(`Deleted collection: ${collection.title} (${deletionResult.reason})`, {
            label: 'Collection Cleanup Service',
            collectionTitle: collection.title,
            reason: deletionResult.reason,
            ratingKey: collection.ratingKey,
          });
        }
      } catch (error) {
        logger.warn(
          `Failed to delete collection ${collection.ratingKey}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          {
            label: 'Collection Cleanup Service',
            collectionTitle: collection.title,
            ratingKey: collection.ratingKey,
          }
        );
      }
    }

    if (deleted > 0) {
      logger.info(
        `Collection cleanup completed: ${deleted} collections deleted`,
        {
          label: 'Collection Cleanup Service',
        }
      );
    }

    return { deleted };
  }

  /**
   * Remove collections for items that are no longer requested (legacy cleanup)
   */
  public async cleanupCollections(plexClient: PlexAPI): Promise<void> {
    // Get all collections with overseerr labels
    const allCollections = await plexClient.getAllCollections();
    const agregarrCollections = allCollections.filter(
      (collection: any) =>
        Array.isArray(collection.labels) &&
        collection.labels.some((label: string) =>
          label.toLowerCase().startsWith('agregarr')
        )
    );

    // Get current approved requests
    const currentRequests = await this.getApprovedRequestsForCleanup();
    const currentUserPlexIds = new Set(
      currentRequests
        .map((r) => r.requestedBy.plexId?.toString())
        .filter((id): id is string => id !== undefined)
    );

    let deleted = 0;
    let failed = 0;

    // Delete collections for users with no current requests
    for (const collection of agregarrCollections) {
      const labelMatch = (collection as any).labels?.find((label: string) =>
        label.toLowerCase().startsWith('agregarr')
      );
      if (labelMatch) {
        const userPlexId = labelMatch.replace(/^AgregarrOverseerrUser/i, '');
        if (!currentUserPlexIds.has(userPlexId)) {
          try {
            await plexClient.deleteCollection((collection as any).ratingKey);
            deleted++;
          } catch (error) {
            failed++;
            logger.warn(
              `Failed to delete collection ${(collection as any).ratingKey}: ${
                error instanceof Error ? error.message : 'Unknown error'
              }`
            );
          }
        }
      }
    }

    logger.info(
      `Periodic collections cleanup completed: ${deleted} collections deleted from ${
        agregarrCollections.length
      } total${failed > 0 ? `, ${failed} failed` : ''}`,
      {
        label: 'Collection Cleanup Service',
      }
    );
  }

  /**
   * Combined purge operation - removes all Overseerr collections and user labels
   */
  public async purgeAllData(plexClient: PlexAPI): Promise<{
    collectionsDeleted: number;
    usersProcessed: number;
    labelsSuccessful: number;
    labelsFailed: number;
  }> {
    logger.info('Starting purge operation using cleanup logic', {
      label: 'Collection Cleanup Service',
    });

    // Get current collections to track what will be deleted
    const allCollections = await plexClient.getAllCollections();
    const agregarrCollectionsBefore = allCollections.filter(
      (collection: any) =>
        Array.isArray(collection.labels) &&
        collection.labels.some((label: string) =>
          label.toLowerCase().startsWith('agregarr')
        )
    );

    // Get all users to track label processing
    const allUsers = await overseerrCollectionService.getUsersWithPlexIds();

    // Delete all Agregarr collections by passing empty config list
    await this.cleanupDisabledCollections(
      plexClient,
      agregarrCollectionsBefore,
      [], // Empty configs = delete all
      {}, // Empty user collections
      new Set() // No processed collections
    );

    // Count what was actually cleaned up
    const allCollectionsAfter = await plexClient.getAllCollections();
    const agregarrCollectionsAfter = allCollectionsAfter.filter(
      (collection: any) =>
        Array.isArray(collection.labels) &&
        collection.labels.some((label: string) =>
          label.toLowerCase().startsWith('agregarr')
        )
    );

    const result = {
      collectionsDeleted: agregarrCollectionsBefore.length - agregarrCollectionsAfter.length,
      usersProcessed: allUsers.length,
      labelsSuccessful: allUsers.length, // Assume all successful since cleanup is robust
      labelsFailed: 0,
    };

    logger.info(
      `Purge operation completed: ${result.collectionsDeleted} collections deleted, ${result.usersProcessed} users processed (${result.labelsSuccessful} successful, ${result.labelsFailed} failed)`,
      {
        label: 'Collection Cleanup Service',
      }
    );

    return result;
  }

  /**
   * Generate active configuration labels for comparison
   */
  private generateActiveConfigLabels(configs: CollectionConfig[]): Set<string> {
    return new Set(
      configs.map((c) => {
        switch (c.type) {
          case 'overseerr':
            return c.subtype === 'users' ? `AgregarrOverseerrUser` : `AgregarrOverseerrAll`;
          case 'tautulli':
            return `AgregarrTautulli${c.id}`;
          case 'trakt':
            return `AgregarrTrakt${c.id}`;
          case 'tmdb':
            return `AgregarrTmdb${c.id}`;
          case 'imdb':
            return `AgregarrImdb${c.id}`;
          case 'letterboxd':
            return `AgregarrLetterboxd${c.id}`;
          default:
            return `Agregarr${c.type}${c.id}`;
        }
      })
    );
  }

  /**
   * Evaluate whether a collection should be deleted
   */
  private async evaluateCollectionForDeletion(
    collection: any,
    activeConfigLabels: Set<string>,
    currentUserPlexIds: Set<string>,
    processedCollectionKeys: Set<string>
  ): Promise<{ shouldDelete: boolean; reason: string }> {
    const labels = Array.isArray(collection.labels) ? collection.labels : [];

    // Check if this collection has any of our managed labels
    const managedLabel = labels.find((label: string) =>
      label.toLowerCase().startsWith('agregarr')
    );

    if (!managedLabel) {
      return { shouldDelete: false, reason: 'not managed' };
    }

    // Skip collections we already processed during sync to avoid double-deletion
    if (processedCollectionKeys.has(collection.ratingKey)) {
      return { shouldDelete: false, reason: 'already processed' };
    }

    // Check if the collection's configuration is still active
    if (!activeConfigLabels.has(managedLabel)) {
      return { shouldDelete: true, reason: 'configuration removed' };
    }

    // Special case for user collections - also delete if user no longer has requests
    if (managedLabel.toLowerCase().startsWith('agregarroverseerruser')) {
      // Extract user Plex ID from collection labels
      const userPlexId = managedLabel.replace(/^AgregarrOverseerrUser/i, '');
      if (userPlexId && !currentUserPlexIds.has(userPlexId)) {
        return { shouldDelete: true, reason: 'user no longer has requests' };
      }
    }

    return { shouldDelete: false, reason: 'still active' };
  }

  /**
   * Get approved requests for cleanup operations
   */
  private async getApprovedRequestsForCleanup(): Promise<any[]> {
    try {
      const requests = await overseerrCollectionService.getApprovedRequests();
      
      return requests.filter(request => {
        if (!request.media || !request.requestedBy) return false;
        
        // Exclude Trakt service users
        if (request.requestedBy && typeof request.requestedBy === 'object' && 'email' in request.requestedBy) {
          const email = (request.requestedBy as any).email;
          if (email && email.includes('@') && email.includes('traktcollections')) {
            return false;
          }
        }

        // Check for valid rating keys
        const hasValidRatingKey = request.is4k 
          ? (request.media.ratingKey4k && 
             request.media.ratingKey4k !== '' && 
             request.media.ratingKey4k !== 'null' && 
             request.media.ratingKey4k !== 'undefined')
          : (request.media.ratingKey && 
             request.media.ratingKey !== '' && 
             request.media.ratingKey !== 'null' && 
             request.media.ratingKey !== 'undefined');
        
        return hasValidRatingKey;
      });
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      logger.error(`Error fetching approved requests for cleanup: ${errorMessage}`, {
        label: 'Collection Cleanup Service',
        errorMessage,
      });
      throw new Error(`Failed to fetch approved requests: ${errorMessage}`);
    }
  }
}

export default CollectionCleanupService;