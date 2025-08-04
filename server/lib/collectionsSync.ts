import PlexAPI from '@server/api/plexapi';
import PlexTvAPI from '@server/api/plextv';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import {
  getAdminUser,
  updateUserFilterSettings,
} from '@server/lib/collectionsUtils';
import { getSettings, type CollectionConfig } from '@server/lib/settings';
import { TautulliCollectionSync } from '@server/lib/collections/TautulliCollectionSync';
import { OverseerrCollectionSync } from '@server/lib/collections/OverseerrCollectionSync';
import { TraktCollectionSync } from '@server/lib/collections/TraktCollectionSync';
import { TmdbCollectionSync } from '@server/lib/collections/TmdbCollectionSync';
import { ImdbCollectionSync } from '@server/lib/collections/ImdbCollectionSync';
import { LetterboxdCollectionSync } from '@server/lib/collections/LetterboxdCollectionSync';
import {
  extractErrorMessage,
} from '@server/lib/utils/templateUtils';
import logger from '@server/logger';
import { IsNull, Not } from 'typeorm';

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

    // Run sync regardless of collectionsEnabled flag - check collection configs instead

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
      const settings = getSettings();
      const collectionConfigs = settings.plex.collectionConfigs || [];

      // Track collections we modify during sync to avoid double-deletion during cleanup
      const processedCollectionKeys = new Set<string>();

      logger.info('Starting configuration-driven collections sync', {
        label: 'Collections Sync',
        totalConfigs: collectionConfigs.length,
      });

      // Get all collections once for the entire sync (performance optimization)
      const allCollections = await plexClient.getAllCollections();

      // Get existing Overseerr collections to know what needs cleanup
      const existingOverseerrCollections = allCollections.filter(
        (collection: any) =>
          Array.isArray(collection.labels) &&
          collection.labels.some((label: string) =>
            label.toLowerCase().startsWith('overseerr')
          )
      );

      // Get all approved media requests (needed for Overseerr collections)
      let requests: MediaRequest[] = [];
      let userCollections: UserCollections = {};
      let userCount = 0;

      // Check if we have Overseerr collections
      const hasOverseerrCollections = collectionConfigs.some(
        (c) => c.type === 'overseerr'
      );

      // Check if we have USER collections specifically (not global or server_owner) 
      const hasUserCollections = collectionConfigs.some(
        (c) => c.type === 'overseerr' && c.subtype === 'users'
      );

      // Check for collections that require user label restrictions (users + server_owner)
      const hasUserLabelCollections = collectionConfigs.some(
        (c) =>
          c.type === 'overseerr' &&
          (c.subtype === 'users' || c.subtype === 'server_owner')
      );

      if (hasOverseerrCollections) {
        requests = await this.getApprovedRequests();
        if (this.cancelled) return;

        // Only organize requests by user if we have actual USER collections
        // Global and server_owner collections don't need user-specific organization
        if (hasUserCollections) {
          userCollections = this.organizeRequestsByUser(requests);
          userCount = Object.keys(userCollections).length;

          // Update missing user titles for nickname support
          await this.updateMissingUserTitles(userCollections);
          if (this.cancelled) return;
        }
      }

      // ALWAYS update user filters (for cleanup when no user label collections exist)
      if (hasUserLabelCollections) {
        // Apply user privacy filters for active users
        await this.updateUserFiltersForActiveUsers(userCollections);
      } else {
        // Clean up all Overseerr user labels when no user/server_owner collections are configured
        await this.cleanupAllUserFilters();
      }
      if (this.cancelled) return;

      // Process collections by library for proper Plex home screen ordering
      let totalCreated = 0;
      let totalUpdated = 0;
      const statsBreakdown: { [key: string]: number } = {};

      // Expand configurations for individual libraries and group by library
      const { LibraryConfigExpander } = await import('./collections/LibraryConfigExpander');
      const appSettings = getSettings();
      const expandedConfigs = LibraryConfigExpander.expandConfigurations(
        collectionConfigs,
        appSettings.plex.libraries
      );
      const libraryGroups = LibraryConfigExpander.groupByLibrary(expandedConfigs);
      const processingOrder = LibraryConfigExpander.getProcessingOrder(libraryGroups);

      // Process collections by library and order within each library
      for (const [libraryId, libraryConfigs] of processingOrder) {
        if (this.cancelled) return;
        
        const libraryName = appSettings.plex.libraries.find((lib: any) => lib.id === libraryId)?.name || libraryId;
        logger.info(`Processing library: ${libraryName} (${libraryConfigs.length} collections)`, {
          label: 'Collections Sync',
          libraryId,
          libraryName,
          configCount: libraryConfigs.length
        });

        // Process collections in the correct order from UI (respecting sortOrderHome)
        const totalCollectionsInLibrary = libraryConfigs.length;
        let previousConfigWasTrakt = false;
        
        for (const config of libraryConfigs) {
          if (this.cancelled) return;

          // Add small delay between API-heavy collections to avoid rate limiting
          if (config.type === 'trakt' && previousConfigWasTrakt) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          // Reduced verbosity - only log in debug mode
          logger.debug(`Processing collection: ${config.name}`, {
            label: 'Collections Sync',
            configType: config.type,
            configSubtype: config.subtype,
            libraryId,
            libraryName,
            sortOrderHome: config.sortOrderHome,
            sortOrderLibrary: config.sortOrderLibrary
          });

          try {
            let stats = { created: 0, updated: 0 };

            switch (config.type) {
              case 'overseerr':
                {
                  const configWithSorting = { ...config, _totalCollectionsInLibrary: totalCollectionsInLibrary };
                  const overseerrSync = new OverseerrCollectionSync();
                  
                  // Use shared data approach for server owner collections to avoid re-fetching
                  if (config.subtype === 'server_owner') {
                    stats = await overseerrSync.processServerOwnerCollectionsFromConfig(
                      configWithSorting,
                      requests, // Use shared request data
                      plexClient,
                      allCollections,
                      processedCollectionKeys
                    );
                  } else if (config.subtype === 'users') {
                    stats = await overseerrSync.processUserCollectionsFromConfig(
                      configWithSorting,
                      userCollections, // Use shared user collections data
                      plexClient,
                      allCollections,
                      processedCollectionKeys
                    );
                  } else {
                    // For global collections, use the standard processConfiguration method
                    stats = await overseerrSync.processConfiguration(
                      configWithSorting,
                      plexClient,
                      allCollections,
                      processedCollectionKeys
                    );
                  }
                }
                break;

              case 'tautulli':
                {
                  const configWithSorting = { ...config, _totalCollectionsInLibrary: totalCollectionsInLibrary };
                  const tautulliSync = new TautulliCollectionSync();
                  stats = await tautulliSync.processCollections(
                    [configWithSorting],
                    plexClient,
                    allCollections,
                    processedCollectionKeys
                  );
                }
                break;

              case 'trakt':
                {
                  const configWithSorting = { ...config, _totalCollectionsInLibrary: totalCollectionsInLibrary };
                  const traktSync = new TraktCollectionSync();
                  stats = await traktSync.processCollections(
                    [configWithSorting],
                    plexClient,
                    allCollections,
                    processedCollectionKeys
                  );
                }
                break;

              case 'tmdb':
                {
                  const configWithSorting = { ...config, _totalCollectionsInLibrary: totalCollectionsInLibrary };
                  const tmdbSync = new TmdbCollectionSync();
                  stats = await tmdbSync.processCollections(
                    [configWithSorting],
                    plexClient,
                    allCollections,
                    processedCollectionKeys
                  );
                }
                break;

              case 'imdb':
                {
                  const configWithSorting = { ...config, _totalCollectionsInLibrary: totalCollectionsInLibrary };
                  const imdbSync = new ImdbCollectionSync();
                  stats = await imdbSync.processCollections(
                    [configWithSorting],
                    plexClient,
                    allCollections,
                    processedCollectionKeys
                  );
                }
                break;

              case 'letterboxd':
                {
                  const configWithSorting = { ...config, _totalCollectionsInLibrary: totalCollectionsInLibrary };
                  const letterboxdSync = new LetterboxdCollectionSync();
                  stats = await letterboxdSync.processCollections(
                    [configWithSorting],
                    plexClient,
                    allCollections,
                    processedCollectionKeys
                  );
                }
                break;

              default:
                logger.warn(`Unknown collection type: ${config.type}`, {
                  label: 'Collections Sync',
                  configName: config.name,
                  configType: config.type
                });
                break;
            }

            totalCreated += stats.created;
            totalUpdated += stats.updated;

            const key = `${config.type}_${config.subtype}`;
            statsBreakdown[key] = (statsBreakdown[key] || 0) + stats.created + stats.updated;
          } catch (error) {
            logger.error(
              `Failed to process collection ${config.name}: ${extractErrorMessage(error)}`,
              {
                label: 'Collections Sync',
                configType: config.type,
                configSubtype: config.subtype,
                libraryId,
                libraryName
              }
            );
          }
          
          // Track for rate limiting
          previousConfigWasTrakt = config.type === 'trakt';
        }
      }

      if (this.cancelled) return;

      // Clean up orphaned collections that are no longer in the configuration
      // Use expanded configs for cleanup to ensure proper collection removal
      const cleanupStats = await this.cleanupDisabledCollections(
        plexClient,
        existingOverseerrCollections,
        expandedConfigs,
        userCollections,
        processedCollectionKeys
      );

      const specialStats = Object.entries(statsBreakdown)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => `${count} ${type.replace('_', ' ')}`);

      logger.info(
        `Collections sync completed: ${totalCreated} created, ${totalUpdated} updated, ${
          cleanupStats.deleted
        } orphaned deleted${
          hasOverseerrCollections ? ` (${userCount} users processed)` : ''
        }${specialStats.length > 0 ? ` - ${specialStats.join(', ')}` : ''}`,
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
    
    // Check if server owner collections are configured
    const settings = getSettings();
    const hasServerOwnerCollections = settings.plex.collectionConfigs?.some(
      (config: CollectionConfig) => config.type === 'overseerr' && config.subtype === 'server_owner'
    );
    
    // If server owner collections exist, we need to update ALL users' filters, not just active users
    let usersToUpdate: string[] = userPlexIds;
    
    if (hasServerOwnerCollections) {
      // Get all users with Plex IDs to ensure server owner collections are hidden from everyone
      const { getUsersWithPlexIds } = await import('@server/lib/collectionsUtils');
      const allUsers = await getUsersWithPlexIds();
      const allUserPlexIds = allUsers.map(user => user.plexId!.toString()).filter(Boolean);
      
      // Use all users when server owner collections exist
      usersToUpdate = allUserPlexIds;
      
      logger.debug(`Server owner collections detected - updating filters for all ${allUserPlexIds.length} users (not just ${userPlexIds.length} active users)`, {
        label: 'Collections Sync',
        allUsersCount: allUserPlexIds.length,
        activeUsersCount: userPlexIds.length
      });
    }

    let failureCount = 0;

    // activeUserPlexIds should only contain users who have USER collections (not server owner)
    // The server owner collection restriction is handled separately in updateUserFilterSettings
    const activeUserPlexIds = userPlexIds;
    
    if (hasServerOwnerCollections) {
      logger.debug(`Server owner collections exist - user filters will restrict OverseerrOwner collections automatically`, {
        label: 'Collections Sync',
        activeUserCount: activeUserPlexIds.length
      });
    }

    for (const userPlexId of usersToUpdate) {
      if (this.cancelled) break;

      try {
        await updateUserFilterSettings(userPlexId, activeUserPlexIds);
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
   * Clean up all Overseerr user labels when no user/server_owner collections are configured
   */
  private async cleanupAllUserFilters(): Promise<void> {
    if (this.cancelled) return;

    logger.info(
      'No user/server_owner collections configured - cleaning up all Overseerr user filter labels',
      {
        label: 'Collections Sync',
      }
    );

    try {
      // Get all users with Plex IDs to clean up their filters
      const userRepository = getRepository(User);
      const usersWithPlexIds = await userRepository.find({
        where: { plexId: Not(IsNull()) },
        select: {
          id: true,
          plexId: true,
          plexTitle: true,
          plexUsername: true,
          username: true,
          email: true,
        },
      });

      let cleanedCount = 0;
      let failureCount = 0;

      for (const user of usersWithPlexIds) {
        if (this.cancelled) break;

        try {
          // Clean up this user's filters by passing empty array (no active users)
          await updateUserFilterSettings(user.plexId!.toString(), []);
          cleanedCount++;
        } catch (error) {
          failureCount++;
          logger.warn(
            `Failed to cleanup filter settings for user ${user.displayName} (${user.plexId})`,
            {
              label: 'Collections Sync',
              userId: user.id,
              userPlexId: user.plexId,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          );
        }
      }

      logger.info(
        `User filter cleanup completed: ${cleanedCount} users cleaned, ${failureCount} failures`,
        {
          label: 'Collections Sync',
          cleanedCount,
          failureCount,
          totalUsers: usersWithPlexIds.length,
        }
      );
    } catch (error) {
      logger.error(`Failed to cleanup user filters: ${error}`, {
        label: 'Collections Sync',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get all requests that have Plex rating keys for Overseerr collections
   * Excludes Trakt service user requests to avoid circular collections
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
        // Explicitly exclude Trakt service users from Overseerr collections
        .andWhere('user.email NOT LIKE :traktServiceUser', {
          traktServiceUser: 'donotchangeme@%.traktcollections',
        })
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
   * Note: Admin requests (user ID = 1) are excluded from regular user collections
   * but are still available in the main requests array for server owner collections
   */
  private organizeRequestsByUser(requests: MediaRequest[]): UserCollections {
    const userCollections: UserCollections = {};

    for (const request of requests) {
      if (this.cancelled) break;

      // Always skip admin user (server owner) requests in regular user collections
      // Admin requests are handled separately via server_owner collection type
      if (request.requestedBy.id === 1) {
        continue;
      }

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


  // COLLECTION CLEANUP METHODS

  /**
   * Clean up collections that no longer have active configurations
   */
  private async cleanupDisabledCollections(
    plexClient: PlexAPI,
    existingOverseerrCollections: any[],
    currentConfigs: CollectionConfig[],
    userCollections: UserCollections,
    processedCollectionKeys: Set<string>
  ): Promise<{ deleted: number }> {
    let deleted = 0;

    // Get all config types and their labels
    const activeConfigLabels = new Set(
      currentConfigs.map((c) => {
        switch (c.type) {
          case 'overseerr':
            return c.subtype === 'users' ? `OverseerrUser` : `OverseerrAll`;
          case 'tautulli':
            return `overseerrtautulli${c.id}`;
          case 'trakt':
            return `overseerrtrakt${c.id}`;
          case 'tmdb':
            return `overseerrtmdb${c.id}`;
          case 'imdb':
            return `overseerrimdb${c.id}`;
          case 'letterboxd':
            return `overseerrletterboxd${c.id}`;
          default:
            return `overseerr${c.type}${c.id}`;
        }
      })
    );

    // Get current user Plex IDs for orphaned user collection cleanup
    const currentUserPlexIds = new Set(Object.keys(userCollections));

    for (const collection of existingOverseerrCollections) {
      if (this.cancelled) break;

      try {
        const labels = Array.isArray(collection.labels)
          ? collection.labels
          : [];

        // Check if this collection has any of our managed labels
        const managedLabel = labels.find((label: string) =>
          label.toLowerCase().startsWith('overseerr')
        );

        if (!managedLabel) {
          continue; // Not our collection, skip
        }

        // Skip collections we already processed during sync to avoid double-deletion
        if (processedCollectionKeys.has(collection.ratingKey)) {
          continue;
        }

        let shouldDelete = false;
        let reason = '';

        // Check if the collection's configuration is still active
        if (!activeConfigLabels.has(managedLabel)) {
          shouldDelete = true;
          reason = 'configuration removed';
        }

        // Special case for user collections - also delete if user no longer has requests
        if (
          !shouldDelete &&
          managedLabel.toLowerCase().startsWith('overseerruser')
        ) {
          // Extract user Plex ID from collection labels
          // Labels follow format: OverseerrUser{plexId}
          const userPlexId = managedLabel.replace(/^OverseerrUser/i, '');
          if (userPlexId && !currentUserPlexIds.has(userPlexId)) {
            shouldDelete = true;
            reason = 'user no longer has requests';
          }
        }

        if (shouldDelete) {
          await plexClient.deleteCollection(collection.ratingKey);
          deleted++;
          logger.info(`Deleted collection: ${collection.title} (${reason})`, {
            label: 'Collections Sync',
            collectionTitle: collection.title,
            reason,
            ratingKey: collection.ratingKey,
          });
        }
      } catch (error) {
        logger.warn(
          `Failed to delete collection ${collection.ratingKey}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          {
            label: 'Collections Sync',
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
          label: 'Collections Sync',
        }
      );
    }

    return { deleted };
  }

  // LEGACY CLEANUP OPERATIONS

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
        const userPlexId = labelMatch.replace(/^OverseerrUser/i, ''); // Case-insensitive replace
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
   * Uses the scheduled cleanup logic with empty collection configs
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
      logger.info('Starting purge operation using scheduled cleanup logic', {
        label: 'Collections Sync',
      });

      // Get current collections to track what will be deleted
      const plexClient = await this.getPlexClient();
      const isConnected = await plexClient.getStatus();
      if (!isConnected) {
        throw new Error('Could not connect to Plex server');
      }

      const allCollections = await plexClient.getAllCollections();
      const overseerrCollectionsBefore = allCollections.filter(
        (collection: any) =>
          Array.isArray(collection.labels) &&
          collection.labels.some((label: string) =>
            label.toLowerCase().startsWith('overseerr')
          )
      );

      // Get all users to track label processing
      const userRepository = getRepository(User);
      const allUsers = await userRepository.find({
        where: { plexId: Not(IsNull()) },
        select: ['id', 'plexId', 'plexUsername', 'plexTitle', 'username'],
      });

      // Trigger sync with empty collection configs - this will cause cleanup logic to run
      const settings = getSettings();
      const originalConfigs = settings.plex.collectionConfigs;

      // Temporarily set empty configs to trigger cleanup
      settings.plex.collectionConfigs = [];

      try {
        // Run the sync - with no configs, all collections will be cleaned up
        await this.syncCollections(plexClient);

        // Restore original configs
        settings.plex.collectionConfigs = originalConfigs;
      } catch (syncError) {
        // Restore original configs even if sync fails
        settings.plex.collectionConfigs = originalConfigs;
        throw syncError;
      }

      // Count what was actually cleaned up
      const allCollectionsAfter = await plexClient.getAllCollections();
      const overseerrCollectionsAfter = allCollectionsAfter.filter(
        (collection: any) =>
          Array.isArray(collection.labels) &&
          collection.labels.some((label: string) =>
            label.toLowerCase().startsWith('overseerr')
          )
      );

      const result = {
        collectionsDeleted:
          overseerrCollectionsBefore.length - overseerrCollectionsAfter.length,
        usersProcessed: allUsers.length,
        labelsSuccessful: allUsers.length, // Assume all successful since cleanup is robust
        labelsFailed: 0,
      };

      logger.info(
        `Purge operation completed using scheduled cleanup: ${result.collectionsDeleted} collections deleted, ${result.usersProcessed} users processed (${result.labelsSuccessful} successful, ${result.labelsFailed} failed)`,
        {
          label: 'Collections Sync',
        }
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Error during purge operation: ${errorMessage}`, {
        label: 'Collections Sync',
        errorMessage,
      });
      throw new Error(`Purge operation failed: ${errorMessage}`);
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
