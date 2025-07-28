import PlexAPI from '@server/api/plexapi';
import PlexTvAPI from '@server/api/plextv';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import {
  cleanupOrphanedCollections,
  createOrUpdateCollection,
  getAdminUser,
  purgeAllCollections,
  purgeUserLabels,
  updateUserFilterSettings,
} from '@server/lib/collectionsUtils';
import { getSettings } from '@server/lib/settings';
import {
  extractErrorMessage,
  getUserDisplayName,
} from '@server/lib/utils/templateUtils';
import logger from '@server/logger';

// UTILITY FUNCTIONS - import from collectionsUtils

// TYPE DEFINITIONS

interface CollectionItem {
  ratingKey: string;
  type?: string;
}

interface UserCollections {
  [userId: string]: {
    movies: CollectionItem[];
    tv: CollectionItem[];
    user: User;
  };
}

// MAIN COLLECTIONS SYNC SERVICE

class CollectionsSync {
  public running = false;
  private cancelled = false;

  public get status() {
    return {
      running: this.running,
      cancelled: this.cancelled,
    };
  }

  public cancel(): void {
    this.cancelled = true;
  }

  /**
   * Initialize a Plex client with admin token and current settings
   * @returns PlexAPI instance configured with admin token
   * @throws Error if admin user or token not found
   */
  private async getPlexClient(): Promise<PlexAPI> {
    const admin = await getAdminUser();
    if (!admin?.plexToken) {
      throw new Error('No admin Plex token found');
    }

    const settings = getSettings();
    return new PlexAPI({
      plexToken: admin.plexToken,
      plexSettings: settings.plex,
    });
  }

  public async run(): Promise<void> {
    const settings = getSettings();

    if (!settings.plex.collectionsEnabled) {
      logger.warn(
        'Plex collections sync skipped - collections are disabled. Enable collections in Plex settings to run this job.',
        {
          label: 'Collections Sync',
        }
      );
      return;
    }

    if (this.running) {
      logger.info(
        'Collections sync already running - cancelling current sync and starting fresh',
        {
          label: 'Collections Sync',
        }
      );

      // Cancel current sync and wait a moment for it to finish current user
      this.cancel();

      // Wait up to 5 seconds for current sync to finish current user
      let waitCount = 0;
      while (this.running && waitCount < 50) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        waitCount++;
      }

      if (this.running) {
        logger.warn('Previous sync did not stop gracefully, forcing restart', {
          label: 'Collections Sync',
        });
        this.running = false;
        this.cancelled = false;
      }
    }

    // Validate Plex configuration
    if (!settings.plex.ip || !settings.plex.machineId) {
      logger.error(
        'Plex server configuration incomplete. Please check Plex settings.',
        { label: 'Collections Sync' }
      );
      return;
    }

    // Get admin user for Plex token
    const admin = await getAdminUser();

    if (!admin?.plexToken) {
      logger.warn('Collections sync skipped. No admin Plex token found.', {
        label: 'Collections Sync',
      });
      return;
    }

    this.running = true;
    this.cancelled = false;

    const startTime = Date.now();

    try {
      // Initialize Plex client
      const plexClient = await this.getPlexClient();

      // Test connection
      const isConnected = await plexClient.getStatus();
      if (!isConnected) {
        throw new Error('Could not connect to Plex server');
      }

      // Perform the sync operations
      await this.syncCollections(plexClient);

      const duration = Date.now() - startTime;
      logger.info(`Collections sync completed in ${duration}ms.`, {
        label: 'Collections Sync',
      });
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      logger.error(`Collections sync failed: ${errorMessage}.`, {
        label: 'Collections Sync',
      });
    } finally {
      this.running = false;
      this.cancelled = false;
    }
  }

  // CORE SYNC OPERATIONS

  private async syncCollections(plexClient: PlexAPI): Promise<void> {
    if (this.cancelled) return;

    try {
      // Get all approved media requests with Plex rating keys
      const requests = await this.getApprovedRequests();
      if (this.cancelled) return;

      // Organize by user and media type
      const userCollections = this.organizeRequestsByUser(requests);
      const userCount = Object.keys(userCollections).length;

      if (this.cancelled) return;

      // Update missing user titles for nickname support
      await this.updateMissingUserTitles(userCollections);
      if (this.cancelled) return;

      // Apply user privacy filters FIRST (before creating collections)
      await this.updateUserFiltersForActiveUsers(userCollections);
      if (this.cancelled) return;

      // Get all collections once for the entire sync (performance optimization)
      const allCollections = await plexClient.getAllCollections();

      // Create/update collections for each user (privacy filters already in place)
      const collectionStats = await this.processUserCollections(
        userCollections,
        plexClient,
        allCollections
      );

      if (this.cancelled) return;

      // Clean up orphaned collections for users who no longer have requests
      const activeUserPlexIds = new Set(Object.keys(userCollections));
      const cleanupStats = await cleanupOrphanedCollections(
        plexClient,
        activeUserPlexIds
      );
      if (this.cancelled) return;

      logger.info(
        `Collections sync completed: ${userCount} users processed, ${collectionStats.created} created, ${collectionStats.updated} updated, ${cleanupStats.deleted} orphaned deleted`,
        {
          label: 'Collections Sync',
        }
      );
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      logger.error(`Collections sync error: ${errorMessage}.`, {
        label: 'Collections Sync',
      });
      throw new Error(`Plex collections sync failed: ${errorMessage}`);
    }
  }

  // USER MANAGEMENT

  /**
   * Update plexTitle for users who have null values (needed for nickname support)
   */
  private async updateMissingUserTitles(
    userCollections: UserCollections
  ): Promise<void> {
    if (this.cancelled) return;

    const userRepository = getRepository(User);
    const usersNeedingUpdate: User[] = [];

    // Find users missing plexTitle
    for (const userPlexId of Object.keys(userCollections)) {
      const user = userCollections[userPlexId].user;
      if (!user.plexTitle) {
        usersNeedingUpdate.push(user);
      }
    }

    if (usersNeedingUpdate.length === 0) {
      return;
    }

    try {
      // Get admin user for Plex API access
      const mainUser = await getAdminUser();
      if (!mainUser?.plexToken) {
        throw new Error('Admin user with Plex token not found');
      }

      const plexTv = new PlexTvAPI(mainUser.plexToken ?? '');
      const plexUsersResponse = await plexTv.getUsers();

      const usersToUpdate: User[] = [];

      for (const user of usersNeedingUpdate) {
        if (this.cancelled) break;

        try {
          // Find the user in Plex API response
          const plexAccount = plexUsersResponse.MediaContainer.User.find(
            (rawUser) => rawUser.$.id === user.plexId?.toString()
          )?.$;

          if (plexAccount?.title) {
            user.plexTitle = plexAccount.title;
            usersToUpdate.push(user);
          }
        } catch (error) {
          logger.warn(
            `Failed to update plexTitle for user ${user.plexId} (${user.plexUsername}): ${error}`,
            {
              label: 'Collections Sync',
            }
          );
        }
      }

      // Batch save all user updates
      let updatedCount = 0;
      if (usersToUpdate.length > 0) {
        try {
          await userRepository.save(usersToUpdate);
          updatedCount = usersToUpdate.length;
        } catch (error) {
          const errorMessage = extractErrorMessage(error);
          logger.error('Failed to update user titles', {
            label: 'Collections Sync',
            errorMessage,
          });
        }
      }

      if (updatedCount < usersNeedingUpdate.length) {
        logger.warn(
          `Failed to update plexTitle for ${
            usersNeedingUpdate.length - updatedCount
          } users`,
          {
            label: 'Collections Sync',
          }
        );
      }
    } catch (error) {
      logger.error(`Error updating user titles: ${error}`, {
        label: 'Collections Sync',
      });
    }
  }

  /**
   * Update user filters BEFORE creating collections (privacy-first approach)
   */
  private async updateUserFiltersForActiveUsers(
    userCollections: UserCollections
  ): Promise<void> {
    if (this.cancelled) return;

    const userPlexIds = Object.keys(userCollections);

    let failureCount = 0;

    for (const userPlexId of userPlexIds) {
      if (this.cancelled) break;

      try {
        await updateUserFilterSettings(userPlexId, userPlexIds);
      } catch (error) {
        failureCount++;
        logger.warn(`Failed to update filter for user ${userPlexId}`, {
          label: 'Collections Sync',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    if (failureCount > 0) {
      logger.warn(`Failed to update filters for ${failureCount} users`, {
        label: 'Collections Sync',
      });
    }
  }

  /**
   * Get all requests that have Plex rating keys (matching Python script behavior)
   */
  private async getApprovedRequests(): Promise<MediaRequest[]> {
    const requestRepository = getRepository(MediaRequest);

    try {
      // Optimized query: filter at database level instead of in JavaScript
      const requestsWithRatingKeys = await requestRepository
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.requestedBy', 'user')
        .leftJoinAndSelect('request.media', 'media')
        .where('request.media IS NOT NULL')
        .andWhere('request.requestedBy IS NOT NULL')
        .andWhere('user.plexId IS NOT NULL') // Only users with Plex IDs
        .andWhere(
          '((request.is4k = 0 AND media.ratingKey IS NOT NULL AND media.ratingKey != "" AND media.ratingKey != "null" AND media.ratingKey != "undefined") OR ' +
            '(request.is4k = 1 AND media.ratingKey4k IS NOT NULL AND media.ratingKey4k != "" AND media.ratingKey4k != "null" AND media.ratingKey4k != "undefined"))'
        )
        .orderBy('request.createdAt', 'DESC') // Reverse chronological order - newest requests first
        .getMany();

      // Database-level filtering eliminates need for JavaScript filtering
      return requestsWithRatingKeys;
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      logger.error(`Error fetching approved requests: ${errorMessage}`, {
        label: 'Collections Sync',
        errorMessage,
      });
      throw new Error(`Failed to fetch approved requests: ${errorMessage}`);
    }
  }

  /**
   * Organize requests by user and media type using Plex user IDs
   */
  private organizeRequestsByUser(requests: MediaRequest[]): UserCollections {
    const userCollections: UserCollections = {};

    for (const request of requests) {
      if (this.cancelled) break;

      // Use the Plex ID from the user, not the Overseerr user ID
      const userPlexId = request.requestedBy.plexId;

      if (!userPlexId) {
        continue;
      }

      // Convert to string for consistent usage
      const userPlexIdStr = userPlexId.toString();

      // Get the correct rating key based on whether it's 4K or not
      const ratingKey = request.is4k
        ? request.media?.ratingKey4k
        : request.media?.ratingKey;

      if (!ratingKey || !request.requestedBy) {
        continue;
      }

      // Initialize user collection if not exists (using Plex ID string as key)
      if (!userCollections[userPlexIdStr]) {
        userCollections[userPlexIdStr] = {
          movies: [],
          tv: [],
          user: request.requestedBy,
        };
      }

      const collectionItem: CollectionItem = {
        ratingKey: ratingKey,
        type: request.type,
      };

      if (request.type === 'movie') {
        userCollections[userPlexIdStr].movies.push(collectionItem);
      } else if (request.type === 'tv') {
        userCollections[userPlexIdStr].tv.push(collectionItem);
      }
    }

    return userCollections;
  }

  /**
   * Process collections for all users with progress tracking
   */
  private async processUserCollections(
    userCollections: UserCollections,
    plexClient: PlexAPI,
    allCollections: any[]
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    let failed = 0;

    for (const [, collections] of Object.entries(userCollections)) {
      if (this.cancelled) break;

      const user = collections.user;

      try {
        // Process movies collection
        if (collections.movies.length > 0) {
          const result = await createOrUpdateCollection(
            user,
            collections.movies,
            'movie',
            plexClient,
            allCollections
          );
          if (result.isNew) {
            created++;
          } else if (result.hasChanges) {
            updated++;
          }
        }

        // Process TV collection
        if (collections.tv.length > 0) {
          const result = await createOrUpdateCollection(
            user,
            collections.tv,
            'tv',
            plexClient,
            allCollections
          );
          if (result.isNew) {
            created++;
          } else if (result.hasChanges) {
            updated++;
          }
        }
      } catch (error) {
        failed++;
        const username = getUserDisplayName(user);
        logger.error(`Failed to process collections for user ${username}`, {
          label: 'Collections Sync',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue with other users even if one fails
      }
    }

    if (created > 0 || updated > 0 || failed > 0) {
      const parts = [];
      if (created > 0) parts.push(`${created} created`);
      if (updated > 0) parts.push(`${updated} updated`);
      if (failed > 0) parts.push(`${failed} failed`);

      logger.info(`Collection processing completed: ${parts.join(', ')}`, {
        label: 'Collections Sync',
      });
    } else {
      logger.info('All collections are up to date', {
        label: 'Collections Sync',
      });
    }

    return { created, updated };
  }

  // COLLECTION MANAGEMENT (now handled by CollectionsManager)

  // CLEANUP OPERATIONS

  /**
   * Remove collections for items that are no longer requested
   * This method can be called periodically to clean up old collections
   */
  async cleanupCollections(): Promise<void> {
    const plexClient = await this.getPlexClient();

    // Get all collections with overseerr labels
    const allCollections = await plexClient.getAllCollections();
    const overseerrCollections = allCollections.filter(
      (collection: any) =>
        Array.isArray(collection.labels) &&
        collection.labels.some((label: string) =>
          label.toLowerCase().startsWith('overseerr')
        )
    );

    // Get current approved requests
    const currentRequests = await this.getApprovedRequests();
    const currentUserPlexIds = new Set(
      currentRequests
        .map((r) => r.requestedBy.plexId?.toString())
        .filter((id): id is string => id !== undefined)
    );

    let deleted = 0;
    let failed = 0;

    // Delete collections for users with no current requests
    for (const collection of overseerrCollections) {
      const labelMatch = (collection as any).labels?.find((label: string) =>
        label.toLowerCase().startsWith('overseerr')
      );
      if (labelMatch) {
        const userPlexId = labelMatch.replace(/^overseerr/i, ''); // Case-insensitive replace
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
        overseerrCollections.length
      } total${failed > 0 ? `, ${failed} failed` : ''}`,
      {
        label: 'Collections Sync',
      }
    );

    return Promise.resolve();
  }

  /**
   * Combined purge operation - removes all Overseerr collections and user labels
   */
  async purgeAllData(): Promise<{
    collectionsDeleted: number;
    usersProcessed: number;
    labelsSuccessful: number;
    labelsFailed: number;
  }> {
    // Set running state
    this.running = true;

    try {
      // Initialize Plex client
      const plexClient = await this.getPlexClient();

      // Test connection
      const isConnected = await plexClient.getStatus();
      if (!isConnected) {
        throw new Error('Could not connect to Plex server');
      }

      // PHASE 1: Delete Collections
      const collectionsResult = await purgeAllCollections(plexClient);

      // PHASE 2: Clean User Labels
      const admin = await getAdminUser();
      if (!admin?.plexToken) {
        throw new Error('No admin Plex token found for user labels cleanup');
      }
      const labelsResult = await purgeUserLabels(admin.plexToken);

      const result = {
        collectionsDeleted: collectionsResult.deleted,
        usersProcessed: labelsResult.processed,
        labelsSuccessful: labelsResult.successful,
        labelsFailed: labelsResult.failed,
      };

      logger.info(
        `Combined purge completed: ${result.collectionsDeleted} collections deleted, ${result.usersProcessed} users processed (${result.labelsSuccessful} successful, ${result.labelsFailed} failed)`,
        {
          label: 'Collections Sync',
        }
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Error during combined purge: ${errorMessage}`, {
        label: 'Collections Sync',
        errorMessage,
      });
      throw new Error(`Combined purge failed: ${errorMessage}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Get current filter settings for a user from Plex shared server data
   */
  // Removed: duplicate user filter methods - now using userLabelManager instead
}

// Create single instance and export it
const collectionsSync = new CollectionsSync();
export default collectionsSync;
