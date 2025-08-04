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
    .replace(/Overseerr[^,]*/gi, '')
    .replace(/,,+/g, ',')
    .replace(/^,|,$/g, '')
    .replace(/^label!=$/, '');
}

export function cleanOverseerrCollectionLabels(
  existingLabels: string[]
): string[] {
  if (!existingLabels || existingLabels.length === 0) return [];

  // Filter out any existing Overseerr labels, preserving user's custom labels
  return existingLabels.filter(
    (label: string) => !label.toLowerCase().startsWith('overseerr')
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

// Simple collection management functions (extracted from CollectionsManager)

/*Delete and recreate a collection with items (simple and fast)
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
      ? `OverseerrAll${mediaType === 'movie' ? 'Films' : 'TV'}`
      : `OverseerrUser${user.plexId}`);

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
              isGlobalCollection || labelName.startsWith('OverseerrAll')
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

/*Delete orphaned Overseerr collections for users with no requests
 */
export async function cleanupOrphanedCollections(
  plexClient: PlexAPI,
  activeUserPlexIds: Set<string>
): Promise<{ deleted: number }> {
  try {
    const allCollections = await plexClient.getAllCollections();
    const overseerrCollections = allCollections.filter(
      (collection: any) =>
        Array.isArray(collection.labels) &&
        collection.labels.some((label: string) =>
          label.toLowerCase().startsWith('overseerr')
        )
    );

    let deleted = 0;
    for (const collection of overseerrCollections) {
      // Extract user Plex ID from overseerr label
      const overseerrLabel = collection.labels?.find((label: string) =>
        label.toLowerCase().startsWith('overseerr')
      );

      if (overseerrLabel) {
        // Handle different label formats
        let userPlexId = '';
        if (overseerrLabel.toLowerCase().startsWith('overseerruser')) {
          userPlexId = overseerrLabel.replace(/^OverseerrUser/i, '');
        } else if (overseerrLabel.toLowerCase().startsWith('overseerr')) {
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

    // Clean existing Overseerr labels
    const cleanedMovieFilter = cleanOverseerrLabels(currentMovieFilter);
    const cleanedTvFilter = cleanOverseerrLabels(currentTvFilter);

    // Generate new Overseerr label restrictions
    const otherUserPlexIds = allUserPlexIds.filter(
      (id) => id !== targetUserPlexId
    );
    const overseerrLabels = otherUserPlexIds.map((id) => `OverseerrUser${id}`);
    
    // Also exclude server owner collections for non-admin users
    const adminUser = await getAdminUser();
    if (adminUser?.plexId && adminUser.plexId.toString() !== targetUserPlexId) {
      overseerrLabels.push(`OverseerrOwner${adminUser.plexId}`);
    }

    // Combine filters
    let finalMovieFilter = cleanedMovieFilter;
    let finalTvFilter = cleanedTvFilter;

    if (overseerrLabels.length > 0) {
      const labelFilter = `label!=${overseerrLabels.join(',')}`;

      if (!finalMovieFilter) {
        finalMovieFilter = labelFilter;
      } else if (finalMovieFilter.startsWith('label!=')) {
        const existingLabels = finalMovieFilter.split('!=')[1];
        finalMovieFilter = `label!=${existingLabels},${overseerrLabels.join(
          ','
        )}`;
      } else {
        logger.warn(
          `Non-label filter detected for user ${targetUserPlexId}: "${finalMovieFilter}". Using only Overseerr labels.`
        );
        finalMovieFilter = labelFilter;
      }

      if (!finalTvFilter) {
        finalTvFilter = labelFilter;
      } else if (finalTvFilter.startsWith('label!=')) {
        const existingLabels = finalTvFilter.split('!=')[1];
        finalTvFilter = `label!=${existingLabels},${overseerrLabels.join(',')}`;
      } else {
        logger.warn(
          `Non-label filter detected for user ${targetUserPlexId}: "${finalTvFilter}". Using only Overseerr labels.`
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

/*Remove all Overseerr label filters from all users
 */
// Removed: purgeUserLabels - use scheduled cleanup instead

/*Clear Overseerr label filters for a specific user
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

  // Get current user filters to preserve non-Overseerr labels
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

  // Clean only Overseerr labels, preserving all other user labels
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
