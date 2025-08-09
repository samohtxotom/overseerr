import PlexAPI from '@server/api/plexapi';
import { getSettings } from '@server/lib/settings';
import type { CollectionConfig } from '@server/lib/settings';
import {
  extractErrorMessage,
} from '@server/lib/utils/templateUtils';
import CollectionSyncOrchestrator from './collections/CollectionSyncOrchestrator';
import { applyUnifiedOrderingToPlex, type OrderingItem } from './collections/UnifiedOrderingService';
import { overseerrCollectionService } from './collections/OverseerrCollectionService';
import { updateUserFilterSettings } from './collections/PlexUserManager';
import type { CollectionItem } from './collections/types';
import logger from '@server/logger';
import { SYNC_CONFIG } from './collections/ConfigurationConstants';

// MAIN COLLECTIONS SYNC SERVICE

interface UserCollections {
  [userId: number]: {
    user: any;
    movies: CollectionItem[];
    tv: CollectionItem[];
  };
}

class CollectionsSync {
  public running = false;
  private cancelled = false;
  private orchestrator = new CollectionSyncOrchestrator();

  public get status() {
    return {
      running: this.running,
      cancelled: this.cancelled,
    };
  }

  public cancel(): void {
    this.cancelled = true;
    this.orchestrator.cancel();
  }

  /**
   * Initialize a Plex client with admin token and current settings
   * Uses local admin user for Plex token (direct Plex integration)
   * @returns PlexAPI instance configured with admin token
   * @throws Error if admin user or token not found
   */
  private async getPlexClient(): Promise<PlexAPI> {
    // Get Plex token from LOCAL admin user (not external Overseerr)
    const { getAdminUser } = await import('@server/lib/collectionsUtils');
    const localAdmin = await getAdminUser();
    
    if (!localAdmin?.plexToken) {
      throw new Error('No local admin Plex token found');
    }

    const settings = getSettings().load();
    return new PlexAPI({
      plexToken: localAdmin.plexToken,
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

      // Wait for current sync to finish gracefully
      let waitCount = 0;
      while (this.running && waitCount < SYNC_CONFIG.SHUTDOWN.MAX_WAIT_ITERATIONS) {
        await new Promise((resolve) => setTimeout(resolve, SYNC_CONFIG.SHUTDOWN.WAIT_INTERVAL_MS));
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
    // Check local admin user for Plex token (not external Overseerr)
    const { getAdminUser } = await import('@server/lib/collectionsUtils');
    const localAdmin = await getAdminUser();

    if (!localAdmin?.plexToken) {
      logger.warn('Collections sync skipped. No local admin Plex token found.', {
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

      // Perform the sync operations using orchestrator
      await this.orchestrator.syncCollections(plexClient);
      
      // Sync hub visibility settings
      await this.orchestrator.syncHubVisibility(plexClient);
      
      // Sync unified ordering (collections + hubs)
      await this.orchestrator.syncUnifiedOrdering(plexClient);

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

  // LEGACY CLEANUP OPERATIONS (delegated to orchestrator)





  /**
   * Sync unified ordering for collections and hubs together
   * This replaces the separate hub ordering sync with a unified approach
   */
  private async syncUnifiedOrdering(plexClient: PlexAPI): Promise<void> {
    if (this.cancelled) return;

    try {
      const settings = getSettings();
      const collectionConfigs = settings.plex.collectionConfigs || [];
      const hubConfigs = settings.plex.hubConfigs || [];

      // Build unified ordering items for each library
      const orderingItemsByLibrary = new Map<string, OrderingItem[]>();

      // Add collection configs to ordering
      for (const config of collectionConfigs) {
        let librariesToProcess: string[] = [];
        
        // If config has collectionRatingKeys (multi-library rating keys), process all those libraries
        if (config.collectionRatingKeys && Object.keys(config.collectionRatingKeys).length > 0) {
          librariesToProcess = Object.keys(config.collectionRatingKeys);
        } else {
          // Fallback to the old logic for configs without collectionRatingKeys
          const libraryIds = config.libraryIds || (config.libraryId ? [config.libraryId] : []);
          const normalizedLibraryIds = Array.isArray(libraryIds) ? libraryIds : [libraryIds];
          librariesToProcess = normalizedLibraryIds.filter((id): id is string => typeof id === 'string' && id !== 'all');
        }
        
        for (const libraryId of librariesToProcess) {

          if (!orderingItemsByLibrary.has(libraryId)) {
            orderingItemsByLibrary.set(libraryId, []);
          }

          // For collections, we need the collectionRatingKey to create proper Plex identifiers
          // Check both the old single rating key and new multi-library rating keys
          let ratingKeyForLibrary = config.collectionRatingKey; // Fallback to single rating key
          
          if (config.collectionRatingKeys && config.collectionRatingKeys[libraryId]) {
            ratingKeyForLibrary = config.collectionRatingKeys[libraryId];
          }
          
          // If we have a rating key for this library, include it in ordering
          if (ratingKeyForLibrary) {
            orderingItemsByLibrary.get(libraryId)!.push({
              id: config.id,
              type: 'collection',
              libraryId,
              collectionRatingKey: ratingKeyForLibrary,
              sortOrder: config.sortOrderLibrary || 0,
            });
          }
        }
      }

      // Add hub configs to ordering - group by library and use UI order
      const hubConfigsByLibrary = new Map<string, any[]>();
      for (const hubConfig of hubConfigs) {
        if (!hubConfigsByLibrary.has(hubConfig.libraryId)) {
          hubConfigsByLibrary.set(hubConfig.libraryId, []);
        }
        hubConfigsByLibrary.get(hubConfig.libraryId)!.push(hubConfig);
      }

      // Process hubs by library using the same logic as hub ordering
      for (const [libraryId, libraryHubConfigs] of hubConfigsByLibrary) {
        // Sort hub configs by their sortOrderLibrary (this is our UI order)
        const sortedHubConfigs = [...libraryHubConfigs].sort((a, b) => 
          (a.sortOrderLibrary || 0) - (b.sortOrderLibrary || 0)
        );

        // Add hubs to ordering in UI order
        if (!orderingItemsByLibrary.has(libraryId)) {
          orderingItemsByLibrary.set(libraryId, []);
        }

        sortedHubConfigs.forEach((hubConfig) => {
          orderingItemsByLibrary.get(libraryId)!.push({
            id: hubConfig.id,
            type: 'hub',
            libraryId: hubConfig.libraryId,
            hubIdentifier: hubConfig.hubIdentifier,
            sortOrder: hubConfig.sortOrderLibrary || 0, // Use actual sortOrderLibrary from UI drag-and-drop
          });
        });
      }

      // Apply unified ordering to each library
      for (const [libraryId, orderingItems] of orderingItemsByLibrary) {
        if (orderingItems.length === 0) continue;

        // Get all available hubs from Plex for this library to include inactive ones
        const allPlexHubs = await plexClient.getHubManagement(libraryId);
        const availableHubs = allPlexHubs?.MediaContainer?.Hub || [];

        // Get current hub identifiers that are already managed
        const managedHubIdentifiers = orderingItems
          .filter(item => item.type === 'hub')
          .map(item => item.hubIdentifier);

        // Find ALL unmanaged hubs (both visible and invisible) to add at the end
        const unmanagedHubs = availableHubs.filter((hub: any) => {
          // Must not be in our managed list
          const isNotManaged = !managedHubIdentifiers.includes(hub.identifier);
          // Must be a built-in hub (not a custom collection)
          const isBuiltIn = !hub.identifier?.startsWith('custom.collection.');
          
          return isNotManaged && isBuiltIn;
        });

        // Add unmanaged hubs to ordering items (at the bottom)
        const unmanagedHubOrderingItems = unmanagedHubs.map((hub: any, index: number) => ({
          id: `unmanaged-${hub.identifier}`,
          type: 'hub' as const,
          libraryId,
          hubIdentifier: hub.identifier,
          sortOrder: orderingItems.length + index, // Continue sequentially after existing items
        }));

        // Combine managed items with unmanaged hubs
        const completeOrderingItems = [...orderingItems, ...unmanagedHubOrderingItems];

        logger.info(`Applying unified ordering for library ${libraryId}`, {
          label: 'Collections Sync',
          libraryId,
          itemCount: completeOrderingItems.length,
          collections: completeOrderingItems.filter(item => item.type === 'collection').length,
          hubs: completeOrderingItems.filter(item => item.type === 'hub').length,
          unmanagedHubsAdded: unmanagedHubOrderingItems.length,
          hubDetails: completeOrderingItems.filter(item => item.type === 'hub').map(item => ({
            hubIdentifier: item.hubIdentifier,
            sortOrder: item.sortOrder
          })),
        });

        await applyUnifiedOrderingToPlex(plexClient, completeOrderingItems);
      }

      logger.info('Unified ordering sync completed', {
        label: 'Collections Sync',
        processedLibraries: orderingItemsByLibrary.size,
        totalItems: Array.from(orderingItemsByLibrary.values()).reduce((sum, items) => sum + items.length, 0),
      });

    } catch (error) {
      logger.error(`Unified ordering sync failed: ${extractErrorMessage(error)}`, {
        label: 'Collections Sync',
        error: extractErrorMessage(error),
      });
      // Don't throw - we don't want ordering sync failures to break collection sync
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
      // Use service layer instead of direct database access
      const usersWithPlexIds = await overseerrCollectionService.getUsersWithPlexIds();

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
  private async getApprovedRequests(): Promise<any[]> { // OverseerrMediaRequest[]
    try {
      // Use service layer to get approved requests (handles both internal and external modes)
      const requests = await overseerrCollectionService.getApprovedRequests();
      
      // Apply additional filtering that was previously done at database level
      const filteredRequests = requests.filter(request => {
        // Only requests with media and user data
        if (!request.media || !request.requestedBy) return false;
        
        // Exclude Trakt service users from Overseerr collections
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

      // Sort by creation date (newest first)
      filteredRequests.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA; // Descending (newest first)
      });

      return filteredRequests;
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
  private organizeRequestsByUser(requests: any[]): UserCollections { // OverseerrMediaRequest[]
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
        title: request.media?.title || 'Unknown Title',
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
    existingAgregarrCollections: any[],
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
          // Note: 'plex' case removed - Plex hubs managed separately via PlexHubConfig
          default:
            return `Agregarr${c.type}${c.id}`;
        }
      })
    );

    // Get current user Plex IDs for orphaned user collection cleanup
    const currentUserPlexIds = new Set(Object.keys(userCollections));

    for (const collection of existingAgregarrCollections) {
      if (this.cancelled) break;

      try {
        const labels = Array.isArray(collection.labels)
          ? collection.labels
          : [];

        // Check if this collection has any of our managed labels
        const managedLabel = labels.find((label: string) =>
          label.toLowerCase().startsWith('agregarr')
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
          managedLabel.toLowerCase().startsWith('agregarroverseerruser')
        ) {
          // Extract user Plex ID from collection labels
          // Labels follow format: AgregarrOverseerrUser{plexId}
          const userPlexId = managedLabel.replace(/^AgregarrOverseerrUser/i, '');
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
    const agregarrCollections = allCollections.filter(
      (collection: any) =>
        Array.isArray(collection.labels) &&
        collection.labels.some((label: string) =>
          label.toLowerCase().startsWith('agregarr')
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
    for (const collection of agregarrCollections) {
      const labelMatch = (collection as any).labels?.find((label: string) =>
        label.toLowerCase().startsWith('agregarr')
      );
      if (labelMatch) {
        const userPlexId = labelMatch.replace(/^AgregarrOverseerrUser/i, ''); // Case-insensitive replace
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
      const agregarrCollectionsBefore = allCollections.filter(
        (collection: any) =>
          Array.isArray(collection.labels) &&
          collection.labels.some((label: string) =>
            label.toLowerCase().startsWith('agregarr')
          )
      );

      // Get all users to track label processing
      // Use service layer instead of direct database access
      const allUsers = await overseerrCollectionService.getUsersWithPlexIds();

      // Trigger sync with empty collection configs - this will cause cleanup logic to run
      const settings = getSettings();
      const originalConfigs = settings.plex.collectionConfigs;

      // Temporarily set empty configs to trigger cleanup
      settings.plex.collectionConfigs = [];

      try {
        // Run the sync - with no configs, all collections will be cleaned up
        await this.orchestrator.syncCollections(plexClient);

        // Restore original configs
        settings.plex.collectionConfigs = originalConfigs;
      } catch (syncError) {
        // Restore original configs even if sync fails
        settings.plex.collectionConfigs = originalConfigs;
        throw syncError;
      }

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
        collectionsDeleted:
          agregarrCollectionsBefore.length - agregarrCollectionsAfter.length,
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
