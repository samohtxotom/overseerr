import type PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { DEFAULTS } from '@server/lib/collections/constants';
import { getSettings } from '@server/lib/settings';
import {
  createFormData,
  extractErrorMessage,
  getUserDisplayName,
  parseCollectionTemplate,
} from '@server/lib/utils/templateUtils';
import logger from '@server/logger';
import xml2js from 'xml2js';
import type { CollectionVisibilityConfig } from './collections/types';

// Removed: CollectionDiff interface, diffCollection functions, advanced batch processing

export function cleanOverseerrLabels(filterStr: string): string {
  if (!filterStr) return '';
  return filterStr
    .replace(/Agregarr[^,]*/gi, '')
    .replace(/,,+/g, ',')
    .replace(/^,|,$/g, '')
    .replace(/^label!=$/, '');
}

export function cleanOverseerrCollectionLabels(
  existingLabels: string[]
): string[] {
  if (!existingLabels || existingLabels.length === 0) return [];

  // Filter out any existing Agregarr labels, preserving user's custom labels
  return existingLabels.filter(
    (label: string) => !label.toLowerCase().startsWith('agregarr')
  );
}

// Utility functions restored: extractErrorMessage, createFormData

export function generateCollectionTitle(user: User): string {
  const settings = getSettings();
  if (settings.plex.collectionTemplate) {
    return parseCollectionTemplate(settings.plex.collectionTemplate, user);
  }
  return `${getUserDisplayName(user)}'s requests`;
}

export async function getAdminUser(): Promise<User | null> {
  const userRepository = getRepository(User);
  return await userRepository.findOne({
    where: { id: DEFAULTS.ADMIN_USER_ID },
    select: { id: true, plexToken: true, plexId: true },
  });
}

export async function getUsersWithPlexIds(): Promise<User[]> {
  const userRepository = getRepository(User);
  return await userRepository
    .createQueryBuilder('user')
    .select([
      'user.id',
      'user.plexId',
      'user.email',
      'user.plexUsername',
      'user.plexTitle',
      'user.username',
    ])
    .where('user.plexId IS NOT NULL')
    .getMany();
}

/*Shared server data interface
 */
export interface SharedServerData {
  $: {
    id: string;
    username: string;
    email: string;
    userID: string;
    accessToken: string;
    name: string;
    acceptedAt: string;
    invitedAt: string;
    allowSync: string;
    allowCameraUpload: string;
    allowChannels: string;
    allowTuners: string;
    allowSubtitleAdmin: string;
    owned: string;
    filterMovies?: string;
    filterTelevision?: string;
  };
}

// Simple cache for shared server responses
const sharedServerCache = new Map<string, SharedServerData[]>();

/*Get shared servers data with simple caching
 */
export async function getSharedServers(
  machineId: string,
  plexToken: string,
  forceRefresh = false
): Promise<SharedServerData[]> {
  const cacheKey = `${machineId}-${plexToken.substring(0, 8)}`;

  // Return cached data if not forcing refresh
  if (!forceRefresh && sharedServerCache.has(cacheKey)) {
    return sharedServerCache.get(cacheKey)!;
  }

  // Fetch fresh data
  const shareUrl = `https://plex.tv/api/servers/${machineId}/shared_servers`;
  const response = await fetch(shareUrl, {
    method: 'GET',
    headers: {
      'X-Plex-Token': plexToken,
      Accept: 'application/xml',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const shareXml = await response.text();
  const parsedXml = await xml2js.parseStringPromise(shareXml);
  const sharedServers: SharedServerData[] =
    parsedXml.MediaContainer?.SharedServer || [];

  // Cache the result
  sharedServerCache.set(cacheKey, sharedServers);
  return sharedServers;
}

/*Get a specific user's shared server data with simple caching
 */
export async function getUserSharedServer(
  machineId: string,
  plexToken: string,
  userPlexId: string,
  forceRefresh = false
): Promise<SharedServerData | undefined> {
  const sharedServers = await getSharedServers(
    machineId,
    plexToken,
    forceRefresh
  );
  return sharedServers.find((server) => server.$.userID === userPlexId);
}

// Removed: CollectionDiff interface - always recreate collections for consistent behavior

// Removed: diffCollection function - always recreate collections

// Removed: diffCollectionItems function

// Removed: arraysEqualUnsorted function

// Removed: getOptimalUpdateStrategy function - always recreate collections

// Removed: processPlexOperationsBatched function with advanced retry logic

// Helper functions

/**
 * Generate sort title for collection ordering
 * Uses exclamation marks to control sort order in Plex
 */
export function generateSortTitle(sortOrder: number, totalCollections: number): string {
  // Calculate prefix: base '!!' + extra '!' characters based on position
  // Position 1 of 8: '!!!!!!!!' (base + 6 extra), Position 8: '!!' (base only)
  const extraExclamations = Math.max(0, totalCollections - sortOrder - 1);
  return '!!' + '!'.repeat(extraExclamations);
}

// Simple collection management functions (extracted from CollectionsManager)

/**
 * Incrementally update collection contents while preserving collection metadata
 * This is the new approach that avoids delete/recreate to preserve Plex statistics
 */
export async function updateCollectionContents(
  user: User,
  items: any[],
  mediaType: 'movie' | 'tv',
  plexClient: PlexAPI,
  allCollections: any[],
  visibilityConfig: CollectionVisibilityConfig,
  customTitle?: string,
  isGlobalCollection?: boolean,
  customLabel?: string,
  processedCollectionKeys?: Set<string>,
  sortOrderLibrary?: number,
  totalCollectionsInLibrary?: number,
  customPoster?: string
): Promise<{ isNew: boolean; hasChanges: boolean; collectionRatingKey?: string; updateStats?: { added: number; removed: number; reordered: boolean } }> {
  const collectionTitle = customTitle || generateCollectionTitle(user);
  const labelName =
    customLabel ||
    (isGlobalCollection
      ? `AgregarrOverseerrAll${mediaType === 'movie' ? 'Films' : 'TV'}`
      : `AgregarrOverseerrUser${user.plexId}`);

  try {
    // Get library key
    const settings = getSettings();
    const enabledLibraries = settings.plex.libraries.filter(
      (lib) => lib.enabled
    );
    const targetType = mediaType === 'movie' ? 'movie' : 'show';

    const matchingLibrary = enabledLibraries.find(
      (lib) => lib.type === targetType
    );

    if (!matchingLibrary) {
      throw new Error(`No enabled ${mediaType} library found`);
    }

    const libraryKey = matchingLibrary.id;

    // Get actual Plex items using rating keys
    const ratingKeys = items.map((item) => item.ratingKey);
    const plexItems = await plexClient.getItemsByRatingKeys(ratingKeys);

    if (plexItems.length === 0) {
      logger.warn(`No valid Plex items found for collection ${collectionTitle}`, {
        label: 'Collections Utils',
        requestedItems: ratingKeys.length,
      });
      return { isNew: false, hasChanges: false, collectionRatingKey: undefined };
    }

    // Find existing collection for this user/label
    const existingCollection = allCollections.find((collection) => {
      const hasMatchingLabel =
        Array.isArray(collection.labels) &&
        collection.labels.some((label: string) =>
          label.toLowerCase().includes(labelName.toLowerCase())
        );
      const libraryMatches =
        String(collection.libraryKey) === String(libraryKey);

      return hasMatchingLabel && libraryMatches;
    });

    let isNew = false;
    let hasChanges = false;
    let newCollectionRatingKey: string | null = null;
    let updateStats = { added: 0, removed: 0, reordered: false };

    if (existingCollection) {
      // Collection exists - update contents incrementally
      logger.info(`Updating existing collection: ${collectionTitle}`, {
        label: 'Collections Utils',
        collectionRatingKey: existingCollection.ratingKey,
        newItemCount: plexItems.length,
      });

      // Use the new incremental update method
      const updateResult = await plexClient.updateCollectionContents(
        existingCollection.ratingKey,
        plexItems
      );

      updateStats = {
        added: updateResult.added,
        removed: updateResult.removed,
        reordered: updateResult.reordered,
      };

      hasChanges = updateResult.added > 0 || updateResult.removed > 0 || updateResult.reordered;

      if (updateResult.errors.length > 0) {
        logger.warn(`Collection update had errors: ${updateResult.errors.join(', ')}`, {
          label: 'Collections Utils',
          collectionRatingKey: existingCollection.ratingKey,
        });
      }

      // Update collection metadata if needed (title, poster, etc.)
      if (existingCollection.title !== collectionTitle) {
        await plexClient.updateCollectionTitle(existingCollection.ratingKey, collectionTitle);
        hasChanges = true;
      }

      if (customPoster && existingCollection.poster !== customPoster) {
        await plexClient.updateCollectionPoster(existingCollection.ratingKey, customPoster);
        hasChanges = true;
      }

      // Update visibility (always update since comparison is complex)
      await plexClient.updateCollectionVisibility(
        existingCollection.ratingKey,
        visibilityConfig.libraryRecommended || false,
        visibilityConfig.serverOwnerHome || false,
        visibilityConfig.usersHome || false
      );
      // Note: We always consider this a change since visibility comparison is complex

      // Update sort order if provided
      if (typeof sortOrderLibrary === 'number' && typeof totalCollectionsInLibrary === 'number') {
        await plexClient.updateCollectionSortTitle(
          existingCollection.ratingKey,
          generateSortTitle(sortOrderLibrary, totalCollectionsInLibrary)
        );
      }

      // Mark as processed
      if (processedCollectionKeys) {
        processedCollectionKeys.add(existingCollection.ratingKey);
      }

      logger.info(`Successfully updated collection: ${collectionTitle}`, {
        label: 'Collections Utils',
        collectionRatingKey: existingCollection.ratingKey,
        added: updateStats.added,
        removed: updateStats.removed,
        reordered: updateStats.reordered,
        hasChanges,
      });

    } else {
      // Collection doesn't exist - create new one (fall back to original creation logic)
      logger.info(`Creating new collection: ${collectionTitle}`, {
        label: 'Collections Utils',
        itemCount: plexItems.length,
      });

      newCollectionRatingKey = await plexClient.createEmptyCollection(
        collectionTitle,
        libraryKey,
        mediaType
      );

      if (!newCollectionRatingKey) {
        throw new Error('Failed to create collection');
      }

      // Add label
      const labelSuccess = await plexClient.addLabelToCollection(
        newCollectionRatingKey,
        labelName
      );
      if (!labelSuccess) {
        // Clean up failed collection
        await plexClient.deleteCollection(newCollectionRatingKey);
        throw new Error('Failed to add label to collection');
      }

      // Add items to new collection
      await plexClient.addItemsToCollection(newCollectionRatingKey, plexItems);

      // Set custom poster if provided
      if (customPoster) {
        await plexClient.updateCollectionPoster(newCollectionRatingKey, customPoster);
      }

      // Set visibility
      await plexClient.updateCollectionVisibility(
        newCollectionRatingKey,
        visibilityConfig.libraryRecommended || false,
        visibilityConfig.serverOwnerHome || false,
        visibilityConfig.usersHome || false
      );

      // Set sort order if provided
      if (typeof sortOrderLibrary === 'number' && typeof totalCollectionsInLibrary === 'number') {
        await plexClient.updateCollectionSortTitle(
          newCollectionRatingKey,
          generateSortTitle(sortOrderLibrary, totalCollectionsInLibrary)
        );
      }

      // Mark as processed
      if (processedCollectionKeys) {
        processedCollectionKeys.add(newCollectionRatingKey);
      }

      isNew = true;
      hasChanges = true;
      updateStats = { added: plexItems.length, removed: 0, reordered: false };

      logger.info(`Successfully created new collection: ${collectionTitle}`, {
        label: 'Collections Utils',
        collectionRatingKey: newCollectionRatingKey,
        itemCount: plexItems.length,
      });
    }

    return { isNew, hasChanges, collectionRatingKey: existingCollection?.ratingKey || newCollectionRatingKey, updateStats };

  } catch (error) {
    logger.error(`Failed to update collection ${collectionTitle}`, {
      label: 'Collections Utils',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/*Delete and recreate a collection with items (simple and fast)
 * @deprecated Use updateCollectionContents() instead to preserve Plex statistics
 */
export async function createOrUpdateCollection(
  user: User,
  items: any[],
  mediaType: 'movie' | 'tv',
  plexClient: PlexAPI,
  allCollections: any[],
  visibilityConfig: CollectionVisibilityConfig,
  customTitle?: string,
  isGlobalCollection?: boolean,
  customLabel?: string,
  processedCollectionKeys?: Set<string>,
  sortOrderLibrary?: number,
  totalCollectionsInLibrary?: number,
  customPoster?: string
): Promise<{ isNew: boolean; hasChanges: boolean }> {
  const collectionTitle = customTitle || generateCollectionTitle(user);
  const labelName =
    customLabel ||
    (isGlobalCollection
      ? `AgregarrOverseerrAll${mediaType === 'movie' ? 'Films' : 'TV'}`
      : `AgregarrOverseerrUser${user.plexId}`);

  try {
    // Get library key
    const settings = getSettings();
    const enabledLibraries = settings.plex.libraries.filter(
      (lib) => lib.enabled
    );
    const targetType = mediaType === 'movie' ? 'movie' : 'show';

    const matchingLibrary = enabledLibraries.find(
      (lib) => lib.type === targetType
    );

    if (!matchingLibrary) {
      throw new Error(`No enabled ${mediaType} library found`);
    }

    const libraryKey = matchingLibrary.id;

    // Get actual Plex items using rating keys
    const ratingKeys = items.map((item) => item.ratingKey);
    const plexItems = await plexClient.getItemsByRatingKeys(ratingKeys);

    // Find existing collections for this user
    const existingUserCollections = allCollections.filter((collection) => {
      const hasMatchingLabel =
        Array.isArray(collection.labels) &&
        collection.labels.some(
          (label: string) => label.toLowerCase() === labelName.toLowerCase()
        );

      // Convert both to strings for comparison to handle type mismatches
      const libraryMatches =
        String(collection.libraryKey) === String(libraryKey);

      return hasMatchingLabel && libraryMatches;
    });

    let isNew = false;
    let hasChanges = false;
    let newCollectionRatingKey: string | null = null;

    // Create new collection FIRST if we have items - don't delete existing ones until we succeed
    if (plexItems.length > 0) {
      try {
        newCollectionRatingKey = await plexClient.createEmptyCollection(
          collectionTitle,
          libraryKey,
          mediaType
        );

        if (newCollectionRatingKey) {
          // CRITICAL: Add label FIRST and verify success before proceeding
          const labelSuccess = await plexClient.addLabelToCollection(
            newCollectionRatingKey,
            labelName
          );
          if (!labelSuccess) {
            // Label addition failed for newly created collection - clean it up and preserve existing collections
            logger.error(
              `Label addition failed for newly created collection ${collectionTitle}. Deleting new collection and preserving existing ones.`,
              {
                label: 'Collections Utils',
                collectionRatingKey: newCollectionRatingKey,
                labelName,
                collectionTitle,
              }
            );
            try {
              await plexClient.deleteCollection(newCollectionRatingKey);
              logger.info(
                `Successfully cleaned up failed new collection ${newCollectionRatingKey}`,
                {
                  label: 'Collections Utils',
                }
              );
            } catch (deleteError) {
              logger.error(
                `Failed to cleanup failed new collection ${newCollectionRatingKey}`,
                {
                  label: 'Collections Utils',
                  deleteError,
                }
              );
            }
            throw new Error(
              `Failed to add required label "${labelName}" to new collection "${collectionTitle}". Existing collections preserved.`
            );
          }

          // NEW COLLECTION CREATED SUCCESSFULLY WITH LABEL - now safe to delete existing ones
          for (const collection of existingUserCollections) {
            try {
              await plexClient.deleteCollection(collection.ratingKey);
              hasChanges = true;

              logger.info(
                `Deleted existing collection after successful replacement: ${collection.title} (${collection.ratingKey})`,
                {
                  label: 'Collections Utils',
                  replacedWith: newCollectionRatingKey,
                }
              );

              // Track that we processed this collection to avoid double-deletion during cleanup
              if (processedCollectionKeys) {
                processedCollectionKeys.add(collection.ratingKey);
              }
            } catch (deleteError) {
              logger.warn(
                `Failed to delete existing collection ${
                  collection.title
                }: ${extractErrorMessage(deleteError)}`
              );
            }
          }

          // Set collection content sort to custom FIRST (before adding items)
          await plexClient.updateCollectionContentSort(
            newCollectionRatingKey,
            'custom'
          );

          // ATOMIC BLOCK: Complete all essential operations before any cancellation checks
          await plexClient.addItemsToCollection(
            newCollectionRatingKey,
            plexItems
          );
          await plexClient.arrangeCollectionItemsInOrder(
            newCollectionRatingKey,
            plexItems
          );
          await plexClient.updateCollectionTitle(
            newCollectionRatingKey,
            collectionTitle
          );
          // Calculate sortTitle prefix based on library tab position
          let sortTitle = collectionTitle;
          if (sortOrderLibrary !== undefined && totalCollectionsInLibrary !== undefined) {
            // Calculate prefix: base '!!' + extra '!' characters based on position
            // Position 1 of 8: '!!!!!!!!' (base + 6 extra), Position 8: '!!' (base only)
            const extraExclamations = Math.max(0, totalCollectionsInLibrary - sortOrderLibrary - 1);
            const sortPrefix = '!!' + '!'.repeat(extraExclamations);
            sortTitle = `${sortPrefix}${collectionTitle}`;
            
          } else {
            // Fallback to old logic if sorting info not provided
            const sortPrefix =
              isGlobalCollection || labelName.startsWith('AgregarrOverseerrAll')
                ? '!!'
                : '!!!';
            sortTitle = `${sortPrefix}${collectionTitle}`;
            
          }
          
          await plexClient.updateCollectionSortTitle(
            newCollectionRatingKey,
            sortTitle
          );

          // Set collection visibility based on configuration
          let home = false;
          let shared = false;
          let recommended = false;

          // If Library Tab Only is NOT selected, use the individual visibility settings
          if (!visibilityConfig.libraryTabOnly) {
            home = visibilityConfig.serverOwnerHome;
            shared = visibilityConfig.usersHome;
            recommended = visibilityConfig.libraryRecommended;
          }
          // If Library Tab Only IS selected, all remain false (default values above)

          await plexClient.updateCollectionVisibility(
            newCollectionRatingKey,
            recommended,
            home,
            shared
          );

          // Handle custom poster - set if provided, or reset to default if removed
          if (customPoster) {
            try {
              const { getPosterPath, posterExists } = await import('@server/lib/posterStorage');
              if (posterExists(customPoster)) {
                const posterPath = getPosterPath(customPoster);
                await plexClient.updateCollectionPoster(newCollectionRatingKey, posterPath);
                logger.info(`Set custom poster for collection: ${collectionTitle}`);
              } else {
                logger.warn(`Custom poster file not found: ${customPoster}`);
              }
            } catch (error) {
              logger.error(`Failed to set custom poster for collection ${collectionTitle}: ${extractErrorMessage(error)}`);
              // Don't fail the entire collection creation if poster update fails
            }
          } else {
            // Check if there were existing collections with custom posters that should be reset
            if (existingUserCollections.length > 0) {
              logger.info(`Reset to default poster for collection: ${collectionTitle} (custom poster removed)`);
            }
          }

          isNew = existingUserCollections.length === 0;
          hasChanges = true;
        }
      } catch (error) {
        logger.error(
          `Failed to create new collection ${collectionTitle}: ${extractErrorMessage(
            error
          )}`
        );
        throw error;
      }
    }

    return { isNew, hasChanges };
  } catch (error) {
    logger.error(
      `Collection operation failed for ${collectionTitle}: ${extractErrorMessage(
        error
      )}`
    );
    throw error;
  }
}

/*Delete orphaned Agregarr collections for users with no requests
 */
export async function cleanupOrphanedCollections(
  plexClient: PlexAPI,
  activeUserPlexIds: Set<string>
): Promise<{ deleted: number }> {
  try {
    const allCollections = await plexClient.getAllCollections();
    const agregarrCollections = allCollections.filter(
      (collection: any) =>
        Array.isArray(collection.labels) &&
        collection.labels.some((label: string) =>
          label.toLowerCase().startsWith('agregarr')
        )
    );

    let deleted = 0;
    for (const collection of agregarrCollections) {
      // Extract user Plex ID from agregarr label
      const agregarrLabel = collection.labels?.find((label: string) =>
        label.toLowerCase().startsWith('agregarr')
      );

      if (agregarrLabel) {
        // Handle different label formats
        let userPlexId = '';
        if (agregarrLabel.toLowerCase().startsWith('agregarroverseerruser')) {
          userPlexId = agregarrLabel.replace(/^AgregarrOverseerrUser/i, '');
        } else if (agregarrLabel.toLowerCase().startsWith('agregarroverseerr')) {
          // Skip special collections (global, tautulli, trakt)
          continue;
        }

        // Only delete if this user has NO active requests
        if (!activeUserPlexIds.has(userPlexId)) {
          try {
            await plexClient.deleteCollection(collection.ratingKey);
            deleted++;
          } catch (error) {
            logger.warn(
              `Failed to delete orphaned collection ${
                collection.title
              }: ${extractErrorMessage(error)}`
            );
          }
        }
      }
    }

    return { deleted };
  } catch (error) {
    logger.error(`Cleanup failed: ${extractErrorMessage(error)}`);
    return { deleted: 0 };
  }
}

// Removed: purgeAllCollections - use scheduled cleanup instead

// Simple user filter management functions (extracted from UserLabelManager)

/*Update user filter settings to restrict access to other users' collections
 */
export async function updateUserFilterSettings(
  targetUserPlexId: string,
  allUserPlexIds: string[]
): Promise<void> {
  try {
    const settings = getSettings();
    const admin = await getAdminUser();

    if (!admin?.plexToken) {
      throw new Error('No admin Plex token found');
    }

    if (!settings.plex.machineId) {
      throw new Error('Machine ID not configured');
    }

    // Get user's current filter settings with robust error handling
    let userServer: SharedServerData | undefined;
    try {
      userServer = await getUserSharedServer(
        settings.plex.machineId,
        admin.plexToken,
        targetUserPlexId
      );
    } catch (error) {
      logger.error(
        `Failed to get user shared server data for ${targetUserPlexId}`,
        {
          label: 'Collections Utils',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      throw new Error(
        `Cannot update user filter settings: Unable to retrieve current filter settings for user ${targetUserPlexId}. This prevents safe label updates that could overwrite existing restrictions.`
      );
    }

    let currentMovieFilter = '';
    let currentTvFilter = '';

    if (userServer) {
      currentMovieFilter = decodeURIComponent(userServer.$.filterMovies || '');
      currentTvFilter = decodeURIComponent(userServer.$.filterTelevision || '');
    }

    // Clean existing Agregarr labels
    const cleanedMovieFilter = cleanOverseerrLabels(currentMovieFilter);
    const cleanedTvFilter = cleanOverseerrLabels(currentTvFilter);

    // Generate new Agregarr label restrictions
    const otherUserPlexIds = allUserPlexIds.filter(
      (id) => id !== targetUserPlexId
    );
    const agregarrLabels = otherUserPlexIds.map((id) => `AgregarrOverseerrUser${id}`);
    
    // Also exclude server owner collections for non-admin users
    const adminUser = await getAdminUser();
    if (adminUser?.plexId && adminUser.plexId.toString() !== targetUserPlexId) {
      agregarrLabels.push(`AgregarrOverseerrOwner${adminUser.plexId}`);
    }

    // Combine filters
    let finalMovieFilter = cleanedMovieFilter;
    let finalTvFilter = cleanedTvFilter;

    if (agregarrLabels.length > 0) {
      const labelFilter = `label!=${agregarrLabels.join(',')}`;

      if (!finalMovieFilter) {
        finalMovieFilter = labelFilter;
      } else if (finalMovieFilter.startsWith('label!=')) {
        const existingLabels = finalMovieFilter.split('!=')[1];
        finalMovieFilter = `label!=${existingLabels},${agregarrLabels.join(
          ','
        )}`;
      } else {
        logger.warn(
          `Non-label filter detected for user ${targetUserPlexId}: "${finalMovieFilter}". Using only Agregarr labels.`
        );
        finalMovieFilter = labelFilter;
      }

      if (!finalTvFilter) {
        finalTvFilter = labelFilter;
      } else if (finalTvFilter.startsWith('label!=')) {
        const existingLabels = finalTvFilter.split('!=')[1];
        finalTvFilter = `label!=${existingLabels},${agregarrLabels.join(',')}`;
      } else {
        logger.warn(
          `Non-label filter detected for user ${targetUserPlexId}: "${finalTvFilter}". Using only Agregarr labels.`
        );
        finalTvFilter = labelFilter;
      }
    }

    // Update user restrictions
    const url = `https://plex.tv/api/friends/${targetUserPlexId}`;
    const headers = {
      'X-Plex-Token': admin.plexToken,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    const payload = {
      server_id: settings.plex.machineId,
      filterMovies: finalMovieFilter,
      filterTelevision: finalTvFilter,
    };

    const formData = createFormData(payload);
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`HTTP ${response.status}: ${responseText}`);
    }
  } catch (error) {
    logger.error(
      `Error updating filter settings for user ${targetUserPlexId}: ${extractErrorMessage(
        error
      )}`
    );
    throw error;
  }
}

/*Remove all Agregarr label filters from all users
 */
// Removed: purgeUserLabels - use scheduled cleanup instead

/*Clear Agregarr label filters for a specific user
 */
export async function clearUserFilters(
  userPlexId: string,
  plexToken: string
): Promise<void> {
  if (!userPlexId) return;

  const settings = getSettings();

  if (!settings.plex.machineId) {
    throw new Error('Machine ID not configured');
  }

  // Get current user filters to preserve non-Agregarr labels
  let currentMovieFilter = '';
  let currentTvFilter = '';

  try {
    const userServer = await getUserSharedServer(
      settings.plex.machineId,
      plexToken,
      userPlexId
    );

    if (userServer) {
      currentMovieFilter = decodeURIComponent(userServer.$.filterMovies || '');
      currentTvFilter = decodeURIComponent(userServer.$.filterTelevision || '');
    }
  } catch (error) {
    logger.warn(
      `Failed to get current filters for user ${userPlexId}, proceeding with empty filters`,
      {
        label: 'Collections Utils',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    );
  }

  // Clean only Agregarr labels, preserving all other user labels
  const cleanedMovieFilter = cleanOverseerrLabels(currentMovieFilter);
  const cleanedTvFilter = cleanOverseerrLabels(currentTvFilter);

  const url = `https://plex.tv/api/friends/${userPlexId}`;
  const headers = {
    'X-Plex-Token': plexToken,
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const payload = {
    server_id: settings.plex.machineId,
    filterMovies: cleanedMovieFilter,
    filterTelevision: cleanedTvFilter,
  };

  const formData = createFormData(payload);
  const response = await fetch(url, { method: 'PUT', headers, body: formData });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`HTTP ${response.status}: ${responseText}`);
  }
}
