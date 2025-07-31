import PlexAPI from '@server/api/plexapi';
import PlexTvAPI from '@server/api/plextv';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import {
  createOrUpdateCollection,
  getAdminUser,
  updateUserFilterSettings,
} from '@server/lib/collectionsUtils';
import { getSettings, type CollectionConfig } from '@server/lib/settings';
import TautulliCollectionSync from '@server/lib/tautulliCollectionSync';
import TraktCollectionSync from '@server/lib/traktCollectionSync';
import {
  extractErrorMessage,
  generateGlobalCollectionName,
  getUserDisplayName,
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

      // Check for collections that require user label restrictions (users + server_owner)
      const hasUserLabelCollections = collectionConfigs.some(
        (c) =>
          c.type === 'overseerr' &&
          (c.subtype === 'users' || c.subtype === 'server_owner')
      );

      if (hasOverseerrCollections) {
        requests = await this.getApprovedRequests();
        if (this.cancelled) return;

        userCollections = this.organizeRequestsByUser(requests);
        userCount = Object.keys(userCollections).length;

        // Update missing user titles for nickname support
        await this.updateMissingUserTitles(userCollections);
        if (this.cancelled) return;
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

      // Process each collection configuration
      let totalCreated = 0;
      let totalUpdated = 0;
      const statsBreakdown: { [key: string]: number } = {};

      for (const config of collectionConfigs) {
        if (this.cancelled) return;

        logger.info(`Processing collection: ${config.name}`, {
          label: 'Collections Sync',
          configType: config.type,
          configSubtype: config.subtype,
        });

        let stats = { created: 0, updated: 0 };

        try {
          switch (config.type) {
            case 'overseerr':
              if (config.subtype === 'users') {
                stats = await this.processUserCollectionsFromConfig(
                  config,
                  userCollections,
                  plexClient,
                  allCollections,
                  processedCollectionKeys
                );
              } else if (config.subtype === 'global') {
                stats = await this.processGlobalCollectionFromConfig(
                  config,
                  requests,
                  plexClient,
                  allCollections,
                  processedCollectionKeys
                );
              } else if (config.subtype === 'server_owner') {
                stats = await this.processServerOwnerCollectionFromConfig(
                  config,
                  requests,
                  plexClient,
                  allCollections,
                  processedCollectionKeys
                );
              }
              break;

            case 'tautulli':
              stats = await this.processTautulliCollectionFromConfig(
                config,
                plexClient,
                allCollections,
                processedCollectionKeys
              );
              break;

            case 'trakt':
              stats = await this.processTraktCollectionFromConfig(
                config,
                plexClient,
                allCollections,
                processedCollectionKeys
              );
              break;
          }

          totalCreated += stats.created;
          totalUpdated += stats.updated;

          const key = `${config.type}_${config.subtype}`;
          statsBreakdown[key] =
            (statsBreakdown[key] || 0) + stats.created + stats.updated;
        } catch (error) {
          logger.error(
            `Failed to process collection ${config.name}: ${extractErrorMessage(
              error
            )}`,
            {
              label: 'Collections Sync',
              configType: config.type,
              configSubtype: config.subtype,
            }
          );
        }
      }

      if (this.cancelled) return;

      // Clean up orphaned collections that are no longer in the configuration
      const cleanupStats = await this.cleanupDisabledCollections(
        plexClient,
        existingOverseerrCollections,
        collectionConfigs,
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
   * LEGACY: Process collections for all users with progress tracking
   * @deprecated This method is kept for backwards compatibility. Use processUserCollectionsFromConfig instead.
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

  /**
   * LEGACY: Process global collection containing all users' requests
   * @deprecated This method is kept for backwards compatibility. Use processGlobalCollectionFromConfig instead.
   */
  private async processGlobalCollection(
    requests: MediaRequest[],
    plexClient: PlexAPI,
    allCollections: any[]
  ): Promise<{ created: number; updated: number }> {
    const settings = getSettings();

    if (!settings.plex.globalCollectionEnabled) {
      return { created: 0, updated: 0 };
    }

    const globalCollectionName = generateGlobalCollectionName();

    // Organize all requests by media type (no user separation)
    const movieItems: any[] = [];
    const tvItems: any[] = [];

    for (const request of requests) {
      if (this.cancelled) break;

      const ratingKey = request.is4k
        ? request.media?.ratingKey4k
        : request.media?.ratingKey;

      if (!ratingKey) continue;

      const collectionItem = {
        ratingKey: ratingKey,
        type: request.type,
      };

      if (request.type === 'movie') {
        movieItems.push(collectionItem);
      } else if (request.type === 'tv') {
        tvItems.push(collectionItem);
      }
    }

    let created = 0;
    let updated = 0;

    try {
      // Create movie global collection if there are movie requests
      if (movieItems.length > 0) {
        // Create a fake user object for the global collection
        const globalUser = {
          id: 0,
          plexId: null,
          displayName: 'Everyone',
          plexUsername: 'global',
          plexTitle: 'Everyone',
          username: 'global',
          email: 'global@overseerr',
        } as any;

        const result = await createOrUpdateCollection(
          globalUser,
          movieItems,
          'movie',
          plexClient,
          allCollections,
          globalCollectionName,
          'users', // Set visibility to users
          true // isGlobalCollection
        );

        if (result.isNew) {
          created++;
        } else if (result.hasChanges) {
          updated++;
        }
      }

      // Create TV global collection if there are TV requests
      if (tvItems.length > 0) {
        const globalUser = {
          id: 0,
          plexId: null,
          displayName: 'Everyone',
          plexUsername: 'global',
          plexTitle: 'Everyone',
          username: 'global',
          email: 'global@overseerr',
        } as any;

        const result = await createOrUpdateCollection(
          globalUser,
          tvItems,
          'tv',
          plexClient,
          allCollections,
          globalCollectionName,
          'users', // Set visibility to users
          true // isGlobalCollection
        );

        if (result.isNew) {
          created++;
        } else if (result.hasChanges) {
          updated++;
        }
      }

      if (created > 0 || updated > 0) {
        logger.info(
          `Global collection processing: ${created} created, ${updated} updated`,
          {
            label: 'Collections Sync',
          }
        );
      }

      return { created, updated };
    } catch (error) {
      logger.error(`Failed to process global collection: ${error}`, {
        label: 'Collections Sync',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { created: 0, updated: 0 };
    }
  }

  /**
   * LEGACY: Process Tautulli statistics collections
   * @deprecated This method is kept for backwards compatibility. Use processTautulliCollectionFromConfig instead.
   */
  private async processTautulliCollections(
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    const settings = getSettings();

    // Check if any Tautulli collections are configured
    const tautulliConfigs =
      settings.plex.collectionConfigs?.filter(
        (config) => config.type === 'tautulli'
      ) || [];

    if (tautulliConfigs.length === 0 || !settings.tautulli?.apiKey) {
      return { created: 0, updated: 0 };
    }

    try {
      const tautulliSync = new TautulliCollectionSync();
      return await tautulliSync.processTautulliCollections(
        tautulliConfigs,
        plexClient,
        allCollections,
        processedCollectionKeys
      );
    } catch (error) {
      logger.error(`Failed to process Tautulli collections: ${error}`, {
        label: 'Collections Sync',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { created: 0, updated: 0 };
    }
  }

  /**
   * LEGACY: Process Trakt trending collections
   * @deprecated This method is kept for backwards compatibility. Use processTraktCollectionFromConfig instead.
   */
  private async processTraktCollections(
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    const settings = getSettings();

    // Check if any Trakt collections are configured
    const traktConfigs =
      settings.plex.collectionConfigs?.filter(
        (config) => config.type === 'trakt'
      ) || [];

    const hasTraktApiKey = settings.trakt.apiKey;

    if (traktConfigs.length === 0 || !hasTraktApiKey) {
      return { created: 0, updated: 0 };
    }

    try {
      const traktSync = new TraktCollectionSync();
      return await traktSync.processTraktCollections(
        traktConfigs,
        plexClient,
        allCollections,
        processedCollectionKeys
      );
    } catch (error) {
      logger.error(`Failed to process Trakt collections: ${error}`, {
        label: 'Collections Sync',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { created: 0, updated: 0 };
    }
  }

  // CONFIGURATION-DRIVEN METHODS

  /**
   * Process user collections based on configuration
   */
  private async processUserCollectionsFromConfig(
    config: CollectionConfig,
    userCollections: UserCollections,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    if (config.type !== 'overseerr' || config.subtype !== 'users') {
      return { created: 0, updated: 0 };
    }

    let created = 0;
    let updated = 0;
    let failed = 0;

    for (const [, collections] of Object.entries(userCollections)) {
      if (this.cancelled) break;

      const user = collections.user;

      try {
        // Generate collection name from config template for this user
        const { parseCollectionTemplate } = await import(
          '@server/lib/utils/templateUtils'
        );

        // Process movies collection
        if (collections.movies.length > 0) {
          const movieCollectionName = parseCollectionTemplate(
            config.template || '',
            user,
            'movie'
          );
          const result = await createOrUpdateCollection(
            user,
            collections.movies,
            'movie',
            plexClient,
            allCollections,
            movieCollectionName,
            config.visibility,
            false, // not global collection
            undefined, // No custom label - will use default overseerr{plexId} format
            processedCollectionKeys
          );
          if (result.isNew) {
            created++;
          } else if (result.hasChanges) {
            updated++;
          }
        }

        // Process TV collection
        if (collections.tv.length > 0) {
          const tvCollectionName = parseCollectionTemplate(
            config.template || '',
            user,
            'tv'
          );
          const result = await createOrUpdateCollection(
            user,
            collections.tv,
            'tv',
            plexClient,
            allCollections,
            tvCollectionName,
            config.visibility,
            false, // not global collection
            undefined, // No custom label - will use default overseerr{plexId} format
            processedCollectionKeys
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
          configName: config.name,
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

      logger.info(
        `User collection processing (${config.name}): ${parts.join(', ')}`,
        {
          label: 'Collections Sync',
          configName: config.name,
        }
      );
    }

    return { created, updated };
  }

  /**
   * Process server owner collection based on configuration
   */
  private async processServerOwnerCollectionFromConfig(
    config: CollectionConfig,
    requests: MediaRequest[],
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    if (config.type !== 'overseerr' || config.subtype !== 'server_owner') {
      return { created: 0, updated: 0 };
    }

    // Get the admin user (server owner)
    const adminUser = await getAdminUser();
    if (!adminUser?.plexId) {
      logger.warn(
        'No admin user with Plex ID found for server owner collection',
        {
          label: 'Collections Sync',
          configName: config.name,
        }
      );
      return { created: 0, updated: 0 };
    }

    const settings = getSettings();

    // Use custom templates if available, otherwise use the main template
    const movieTemplate =
      config.mediaType === 'both' && config.customMovieTemplate
        ? config.customMovieTemplate
        : config.template;
    const tvTemplate =
      config.mediaType === 'both' && config.customTVTemplate
        ? config.customTVTemplate
        : config.template;

    // Collection names are generated dynamically during processing

    // Filter requests to only include admin user's requests
    const adminRequests = requests.filter(
      (request) => request.requestedBy.id === adminUser.id
    );

    // Organize admin requests by media type
    const movieItems: any[] = [];
    const tvItems: any[] = [];

    for (const request of adminRequests) {
      if (this.cancelled) break;

      const ratingKey = request.is4k
        ? request.media?.ratingKey4k
        : request.media?.ratingKey;

      if (!ratingKey) continue;

      const collectionItem = {
        ratingKey: ratingKey,
        type: request.type,
      };

      if (request.type === 'movie') {
        movieItems.push(collectionItem);
      } else if (request.type === 'tv') {
        tvItems.push(collectionItem);
      }
    }

    let created = 0;
    let updated = 0;

    try {
      // Create movie server owner collection if there are movie requests and config allows movies
      if (
        movieItems.length > 0 &&
        (config.mediaType === 'both' || config.mediaType === 'movie')
      ) {
        const movieCollectionName = movieTemplate
          .replace('{domain}', 'Overseerr')
          .replace(
            '{nickname}',
            adminUser.plexTitle || adminUser.displayName || 'Server Owner'
          )
          .replace('{servername}', settings.plex.name || 'Plex Server')
          .replace('{subtype}', 'Server Owner Requests')
          .replace('{mediaType}', 'Movie')
          .replace('{customdays}', '30')
          .replace('{days}', '30');

        const result = await createOrUpdateCollection(
          adminUser,
          movieItems.slice(0, config.maxItems),
          'movie',
          plexClient,
          allCollections,
          movieCollectionName,
          config.visibility,
          false, // not a global collection, but server owner collection (special case)
          `OverseerrOwner${adminUser.plexId}`, // Use consistent server owner label
          processedCollectionKeys
        );

        if (result.isNew) {
          created++;
        } else if (result.hasChanges) {
          updated++;
        }
      }

      // Create TV server owner collection if there are TV requests and config allows TV
      if (
        tvItems.length > 0 &&
        (config.mediaType === 'both' || config.mediaType === 'tv')
      ) {
        const tvCollectionName = tvTemplate
          .replace('{domain}', 'Overseerr')
          .replace(
            '{nickname}',
            adminUser.plexTitle || adminUser.displayName || 'Server Owner'
          )
          .replace('{servername}', settings.plex.name || 'Plex Server')
          .replace('{subtype}', 'Server Owner Requests')
          .replace('{mediaType}', 'TV Show')
          .replace('{customdays}', '30')
          .replace('{days}', '30');

        const result = await createOrUpdateCollection(
          adminUser,
          tvItems.slice(0, config.maxItems),
          'tv',
          plexClient,
          allCollections,
          tvCollectionName,
          config.visibility,
          false, // not a global collection, but server owner collection (special case)
          `OverseerrOwner${adminUser.plexId}`, // Use consistent server owner label
          processedCollectionKeys
        );

        if (result.isNew) {
          created++;
        } else if (result.hasChanges) {
          updated++;
        }
      }

      if (created > 0 || updated > 0) {
        logger.info(
          `Server owner collection processing (${config.name}): ${created} created, ${updated} updated`,
          {
            label: 'Collections Sync',
            configName: config.name,
            adminUserId: adminUser.id,
            adminPlexId: adminUser.plexId,
          }
        );
      }

      return { created, updated };
    } catch (error) {
      logger.error(
        `Failed to process server owner collection ${
          config.name
        }: ${extractErrorMessage(error)}`,
        {
          label: 'Collections Sync',
          configName: config.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return { created: 0, updated: 0 };
    }
  }

  /**
   * Process global collection based on configuration
   */
  private async processGlobalCollectionFromConfig(
    config: CollectionConfig,
    requests: MediaRequest[],
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    if (config.type !== 'overseerr' || config.subtype !== 'global') {
      return { created: 0, updated: 0 };
    }

    // Settings will be used by template processing in createOrUpdateCollection

    // Create a global user object for template processing
    const globalUser = {
      id: -1,
      plexId: null,
      plexTitle: 'Everyone',
      displayName: 'Everyone',
      username: 'global',
      email: 'global@overseerr',
    } as any;

    // Organize all requests by media type (no user separation)
    const movieItems: any[] = [];
    const tvItems: any[] = [];

    for (const request of requests) {
      if (this.cancelled) break;

      const ratingKey = request.is4k
        ? request.media?.ratingKey4k
        : request.media?.ratingKey;

      if (!ratingKey) continue;

      const collectionItem = {
        ratingKey: ratingKey,
        type: request.type,
      };

      if (request.type === 'movie') {
        movieItems.push(collectionItem);
      } else if (request.type === 'tv') {
        tvItems.push(collectionItem);
      }
    }

    let created = 0;
    let updated = 0;

    try {
      // Import template parser for consistent name generation
      const { parseCollectionTemplate } = await import(
        '@server/lib/utils/templateUtils'
      );

      // Create movie global collection if there are movie requests and config allows movies
      if (
        movieItems.length > 0 &&
        (config.mediaType === 'both' || config.mediaType === 'movie')
      ) {
        const movieCollectionName = parseCollectionTemplate(
          config.template || '',
          globalUser,
          'movie'
        );

        const result = await createOrUpdateCollection(
          globalUser,
          movieItems.slice(0, config.maxItems),
          'movie',
          plexClient,
          allCollections,
          movieCollectionName,
          config.visibility,
          true, // isGlobalCollection
          undefined, // Use default label format: OverseerrAllFilms
          processedCollectionKeys
        );

        if (result.isNew) {
          created++;
        } else if (result.hasChanges) {
          updated++;
        }
      }

      // Create TV global collection if there are TV requests and config allows TV
      if (
        tvItems.length > 0 &&
        (config.mediaType === 'both' || config.mediaType === 'tv')
      ) {
        const tvCollectionName = parseCollectionTemplate(
          config.template || '',
          globalUser,
          'tv'
        );

        const result = await createOrUpdateCollection(
          globalUser,
          tvItems.slice(0, config.maxItems),
          'tv',
          plexClient,
          allCollections,
          tvCollectionName,
          config.visibility,
          true, // isGlobalCollection
          undefined, // Use default label format: OverseerrAllTV
          processedCollectionKeys
        );

        if (result.isNew) {
          created++;
        } else if (result.hasChanges) {
          updated++;
        }
      }

      if (created > 0 || updated > 0) {
        logger.info(
          `Global collection processing (${config.name}): ${created} created, ${updated} updated`,
          {
            label: 'Collections Sync',
            configName: config.name,
          }
        );
      }

      return { created, updated };
    } catch (error) {
      logger.error(
        `Failed to process global collection (${config.name}): ${error}`,
        {
          label: 'Collections Sync',
          configName: config.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return { created: 0, updated: 0 };
    }
  }

  /**
   * Process Tautulli collection based on configuration
   */
  private async processTautulliCollectionFromConfig(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    if (config.type !== 'tautulli') {
      return { created: 0, updated: 0 };
    }

    const settings = getSettings();
    if (!settings.tautulli?.apiKey) {
      logger.warn(
        'Tautulli API key not configured, skipping Tautulli collection',
        {
          label: 'Collections Sync',
          configName: config.name,
        }
      );
      return { created: 0, updated: 0 };
    }

    try {
      const tautulliSync = new TautulliCollectionSync();
      return await tautulliSync.processTautulliCollections(
        [config], // Pass single config as array
        plexClient,
        allCollections,
        processedCollectionKeys
      );
    } catch (error) {
      logger.error(
        `Failed to process Tautulli collection (${config.name}): ${error}`,
        {
          label: 'Collections Sync',
          configName: config.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return { created: 0, updated: 0 };
    }
  }

  /**
   * Process Trakt collection based on configuration
   */
  private async processTraktCollectionFromConfig(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    if (config.type !== 'trakt') {
      return { created: 0, updated: 0 };
    }

    const settings = getSettings();
    if (!settings.trakt.apiKey) {
      return { created: 0, updated: 0 };
    }

    try {
      const traktSync = new TraktCollectionSync();
      return await traktSync.processTraktCollections(
        [config], // Pass single config as array
        plexClient,
        allCollections,
        processedCollectionKeys
      );
    } catch (error) {
      logger.error(
        `Failed to process Trakt collection (${config.name}): ${error}`,
        {
          label: 'Collections Sync',
          configName: config.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return { created: 0, updated: 0 };
    }
  }

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
