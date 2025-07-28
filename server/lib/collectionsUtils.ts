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

// Removed: CollectionDiff interface, diffCollection functions, advanced batch processing

export function cleanOverseerrLabels(filterStr: string): string {
  if (!filterStr) return '';
  return filterStr
    .replace(/overseerr[^,]*/gi, '')
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
    select: { id: true, plexToken: true },
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
  allCollections: any[]
): Promise<{ isNew: boolean; hasChanges: boolean }> {
  const collectionTitle = generateCollectionTitle(user);
  const labelName = `overseerr${user.plexId}`;

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
    const existingUserCollections = allCollections.filter(
      (collection) =>
        Array.isArray(collection.labels) &&
        collection.labels.some(
          (label: string) => label.toLowerCase() === labelName.toLowerCase()
        ) &&
        collection.libraryKey === libraryKey
    );

    let isNew = false;
    let hasChanges = false;

    // Delete existing collections for this user/library
    for (const collection of existingUserCollections) {
      try {
        await plexClient.deleteCollection(collection.ratingKey);
        hasChanges = true;
      } catch (deleteError) {
        logger.warn(
          `Failed to delete existing collection ${
            collection.title
          }: ${extractErrorMessage(deleteError)}`
        );
      }
    }

    // Create new collection if we have items
    if (plexItems.length > 0) {
      try {
        const collectionRatingKey = await plexClient.createEmptyCollection(
          collectionTitle,
          libraryKey,
          mediaType
        );

        if (collectionRatingKey) {
          // CRITICAL: Add label FIRST so collection can always be found and cleaned up
          await plexClient.addLabelToCollection(collectionRatingKey, labelName);

          // Set collection content sort to custom FIRST (before adding items)
          await plexClient.updateCollectionContentSort(
            collectionRatingKey,
            'custom'
          );

          // ATOMIC BLOCK: Complete all essential operations before any cancellation checks
          await plexClient.addItemsToCollection(collectionRatingKey, plexItems);
          await plexClient.arrangeCollectionItemsInOrder(
            collectionRatingKey,
            plexItems
          );
          await plexClient.updateCollectionTitle(
            collectionRatingKey,
            collectionTitle
          );
          await plexClient.updateCollectionSortTitle(
            collectionRatingKey,
            `!!${collectionTitle}`
          );

          // Set collection visibility: admin collections visible on home, others hidden
          const isAdminUser = user.id === 1;
          await plexClient.updateCollectionVisibility(
            collectionRatingKey,
            false, // recommended
            isAdminUser, // home - only visible for admin
            false // shared
          );

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
        const userPlexId = overseerrLabel.replace(/^overseerr/i, '');

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

/*Delete all Overseerr collections
 */
export async function purgeAllCollections(
  plexClient: PlexAPI
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
      try {
        await plexClient.deleteCollection(collection.ratingKey);
        deleted++;
      } catch (error) {
        logger.warn(
          `Failed to delete collection ${
            collection.title
          }: ${extractErrorMessage(error)}`
        );
      }
    }

    return { deleted };
  } catch (error) {
    logger.error(`Purge failed: ${extractErrorMessage(error)}`);
    return { deleted: 0 };
  }
}

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

    // Get user's current filter settings
    const userServer = await getUserSharedServer(
      settings.plex.machineId,
      admin.plexToken,
      targetUserPlexId
    );

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
    const overseerrLabels = otherUserPlexIds.map((id) => `overseerr${id}`);

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
export async function purgeUserLabels(
  plexToken: string
): Promise<{ processed: number; successful: number; failed: number }> {
  try {
    const users = await getUsersWithPlexIds();
    const results = [];

    // Simple Promise.all processing instead of complex batching
    for (const user of users) {
      try {
        await clearUserFilters(user.plexId?.toString() || '', plexToken);
        results.push({ success: true });
      } catch (error) {
        logger.warn(
          `Failed to clear filters for user ${
            user.plexId
          }: ${extractErrorMessage(error)}`
        );
        results.push({ success: false });
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;

    return { processed: users.length, successful, failed };
  } catch (error) {
    logger.error(`Purge user labels failed: ${extractErrorMessage(error)}`);
    return { processed: 0, successful: 0, failed: 0 };
  }
}

/*Clear Overseerr label filters for a specific user
 */
async function clearUserFilters(
  userPlexId: string,
  plexToken: string
): Promise<void> {
  if (!userPlexId) return;

  const url = `https://plex.tv/api/friends/${userPlexId}`;
  const settings = getSettings();

  if (!settings.plex.machineId) {
    throw new Error('Machine ID not configured');
  }

  const headers = {
    'X-Plex-Token': plexToken,
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const payload = {
    server_id: settings.plex.machineId,
    filterMovies: '',
    filterTelevision: '',
  };

  const formData = createFormData(payload);
  const response = await fetch(url, { method: 'PUT', headers, body: formData });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`HTTP ${response.status}: ${responseText}`);
  }
}
