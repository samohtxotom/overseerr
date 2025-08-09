import { getSettings } from '@server/lib/settings';
import {
  createFormData,
  extractErrorMessage,
} from '@server/lib/utils/templateUtils';
import logger from '@server/logger';
import xml2js from 'xml2js';
import { cleanOverseerrLabels, getAdminUser } from './CollectionUtilities';

/**
 * Shared server data interface for Plex API responses
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

/**
 * Get shared servers data with simple caching
 * Fetches user sharing data from Plex.tv API
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

/**
 * Get a specific user's shared server data with simple caching
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

/**
 * Update user filter settings to hide other users' collections
 * This implements the core user isolation functionality for Plex Pass users
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
      'X-Plex-Client-Identifier': settings.clientId,
    };

    const formData = createFormData({
      'server[machineIdentifier]': settings.plex.machineId,
      'server[filterMovies]': finalMovieFilter,
      'server[filterTelevision]': finalTvFilter,
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to update user filter settings: HTTP ${response.status} - ${errorText}`
      );
    }

    logger.info(
      `Updated filter settings for user ${targetUserPlexId}. Movie filter: "${finalMovieFilter}", TV filter: "${finalTvFilter}"`
    );
  } catch (error) {
    const errorMessage = extractErrorMessage(error);
    logger.error(
      `Failed to update user filter settings for user ${targetUserPlexId}: ${errorMessage}`
    );
    throw error;
  }
}

/**
 * Remove all Agregarr-generated filters for a specific user
 * Used when cleaning up or resetting user permissions
 */
export async function clearUserFilters(targetUserPlexId: string): Promise<void> {
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

    // Clean all Agregarr labels, keeping user's custom filters
    const cleanedMovieFilter = cleanOverseerrLabels(currentMovieFilter);
    const cleanedTvFilter = cleanOverseerrLabels(currentTvFilter);

    // Update user restrictions with cleaned filters
    const url = `https://plex.tv/api/friends/${targetUserPlexId}`;
    const headers = {
      'X-Plex-Token': admin.plexToken,
      Accept: 'application/json',
      'X-Plex-Client-Identifier': settings.clientId,
    };

    const formData = createFormData({
      'server[machineIdentifier]': settings.plex.machineId,
      'server[filterMovies]': cleanedMovieFilter,
      'server[filterTelevision]': cleanedTvFilter,
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to clear user filters: HTTP ${response.status} - ${errorText}`
      );
    }

    logger.info(
      `Cleared Agregarr filters for user ${targetUserPlexId}. Remaining filters - Movies: "${cleanedMovieFilter}", TV: "${cleanedTvFilter}"`
    );
  } catch (error) {
    const errorMessage = extractErrorMessage(error);
    logger.error(
      `Failed to clear user filters for user ${targetUserPlexId}: ${errorMessage}`
    );
    throw error;
  }
}