import type PlexAPI from '@server/api/plexapi';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import {
  extractErrorMessage,
} from '@server/lib/utils/templateUtils';
import logger from '@server/logger';
import type { CollectionVisibilityConfig } from './types';
import { generateCollectionTitle, cleanOverseerrCollectionLabels } from './CollectionUtilities';
import { SORT_CONFIG, getRuntimeConfig } from './ConfigurationConstants';

/**
 * Generate sort title for Plex collection ordering using exclamation mark prefixes
 * Position 1 gets the most exclamation marks, making it appear first in Plex
 * 
 * @param sortOrder - Position in the sort order (0-based)
 * @param totalCollections - Total number of collections to calculate exclamation marks
 * @returns Sort title with appropriate exclamation mark prefix
 */
export function generateSortTitle(sortOrder: number, totalCollections: number): string {
  const runtimeConfig = getRuntimeConfig();
  
  // Calculate how many exclamation marks to use (reversed so position 0 gets the most)
  const exclamationCount = Math.max(1, totalCollections - sortOrder);
  const exclamationPrefix = '!'.repeat(Math.min(exclamationCount, runtimeConfig.sortConfig.maxPrefixLength));
  
  // Add a numeric suffix to ensure stable sorting even with same exclamation count
  const numericSuffix = String(sortOrder + 1).padStart(3, '0');
  
  return `${exclamationPrefix}${numericSuffix}`;
}

/**
 * @deprecated Use BaseCollectionSync.createOrUpdateCollectionStandardized() instead
 * 
 * Legacy collection update method - ALL collection sync services now use the standardized approach
 * via BaseCollectionSync including OverseerrCollectionSync.
 * 
 * This method can be safely removed as it is no longer used by any collection sync service.
 * 
 * @param user - User object for template generation (if customTitle not provided)
 * @param items - Array of items with ratingKey property
 * @param mediaType - 'movie' or 'tv'
 * @param plexClient - PlexAPI instance
 * @param allCollections - Array of all existing collections for finding matches
 * @param visibilityConfig - Visibility settings for the collection
 * @param customTitle - Optional custom title, otherwise generated from user template
 * @param isGlobalCollection - Whether this is a global collection or user-specific
 * @param customLabel - Optional custom label for identifying collection
 * @param processedCollectionKeys - Set to track processed collections (for cleanup)
 * @param sortOrderLibrary - Sort position within library (0-based)
 * @param totalCollectionsInLibrary - Total collections in library for sort calculation
 * @param customPoster - Optional custom poster URL
 * @returns Object with isNew, hasChanges flags and optional collection rating key
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

      logger.info(`Successfully created collection: ${collectionTitle}`, {
        label: 'Collections Utils',
        collectionRatingKey: newCollectionRatingKey,
        itemCount: plexItems.length,
      });
    }

    return {
      isNew,
      hasChanges,
      collectionRatingKey: existingCollection?.ratingKey || newCollectionRatingKey || undefined,
      updateStats,
    };
  } catch (error) {
    logger.error(`Error in updateCollectionContents for ${collectionTitle}`, {
      label: 'Collections Utils',
      error: extractErrorMessage(error),
      mediaType,
      itemCount: items.length,
    });
    throw error;
  }
}

/**
 * Legacy collection creation/update method 
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
): Promise<{ created: number; updated: number }> {
  const result = await updateCollectionContents(
    user,
    items,
    mediaType,
    plexClient,
    allCollections,
    visibilityConfig,
    customTitle,
    isGlobalCollection,
    customLabel,
    processedCollectionKeys,
    sortOrderLibrary,
    totalCollectionsInLibrary,
    customPoster
  );
  
  return {
    created: result.isNew ? 1 : 0,
    updated: result.hasChanges && !result.isNew ? 1 : 0,
  };
}