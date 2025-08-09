import type PlexAPI from '@server/api/plexapi';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { CollectionItem, CollectionVisibilityConfig, CollectionOperationResult } from './types';
import { generateSortTitle } from './CollectionOperations';
import { CollectionSyncUtils } from './CollectionSyncUtils';

interface CollectionUpdateOptions {
  collectionName: string;
  mediaType: 'movie' | 'tv';
  visibilityConfig: CollectionVisibilityConfig;
  customLabel: string;
  sortOrderLibrary?: number;
  totalCollectionsInLibrary?: number;
  customPoster?: string;
  processedCollectionKeys?: Set<string>;
}

interface CollectionUpdateResult {
  created: number;
  updated: number;
  collectionRatingKey?: string;
  itemCount: number;
  updateStats?: {
    added: number;
    removed: number;
    reordered: boolean;
  };
}

/**
 * Standardized collection update strategy using incremental updates only
 * This replaces all legacy delete/recreate approaches with a consistent method
 * that preserves Plex statistics and provides better performance.
 */
export class CollectionUpdateStrategy {
  private plexClient: PlexAPI;
  private allCollections: any[];

  constructor(plexClient: PlexAPI, allCollections: any[]) {
    this.plexClient = plexClient;
    this.allCollections = allCollections;
  }

  /**
   * Create or update a collection using the standardized incremental approach
   */
  public async createOrUpdateCollection(
    items: CollectionItem[],
    options: CollectionUpdateOptions
  ): Promise<CollectionUpdateResult> {
    const { collectionName, mediaType, customLabel } = options;

    // Validate items first
    const validation = CollectionSyncUtils.validateCollectionItems(items);
    if (validation.valid.length === 0) {
      logger.warn(`No valid items for collection ${collectionName}`, {
        label: 'Collection Update Strategy',
        totalItems: items.length,
        errors: validation.errors.slice(0, 5),
      });
      return {
        created: 0,
        updated: 0,
        itemCount: 0,
      };
    }

    const validItems = validation.valid;
    
    // Find target library
    const libraryKey = await this.findTargetLibrary(mediaType);
    
    // Check for existing collection
    const existingCollection = await this.findExistingCollection(customLabel, libraryKey);

    if (existingCollection) {
      return await this.updateExistingCollection(existingCollection, validItems, options);
    } else {
      return await this.createNewCollection(validItems, libraryKey, options);
    }
  }

  /**
   * Update an existing collection using incremental approach
   */
  private async updateExistingCollection(
    existingCollection: any,
    items: CollectionItem[],
    options: CollectionUpdateOptions
  ): Promise<CollectionUpdateResult> {
    const { collectionName } = options;

    logger.info(`Updating existing collection: ${collectionName}`, {
      label: 'Collection Update Strategy',
      collectionRatingKey: existingCollection.ratingKey,
      newItemCount: items.length,
    });

    // Track this collection as processed
    if (options.processedCollectionKeys) {
      options.processedCollectionKeys.add(existingCollection.ratingKey);
    }

    // Get actual Plex items using rating keys
    const plexItems = await this.getValidPlexItems(items);
    
    if (plexItems.length === 0) {
      logger.warn(`No valid Plex items found for collection ${collectionName}`, {
        label: 'Collection Update Strategy',
        requestedItems: items.length,
      });
      return {
        created: 0,
        updated: 0,
        collectionRatingKey: existingCollection.ratingKey,
        itemCount: 0,
      };
    }

    // Use incremental update approach
    const updateResult = await this.plexClient.updateCollectionContents(
      existingCollection.ratingKey,
      plexItems
    );

    const hasContentChanges = updateResult.added > 0 || updateResult.removed > 0 || updateResult.reordered;

    // Update collection metadata if needed
    await this.updateCollectionMetadata(existingCollection, options);

    if (updateResult.errors.length > 0) {
      logger.warn(`Collection update had errors: ${updateResult.errors.join(', ')}`, {
        label: 'Collection Update Strategy',
        collectionRatingKey: existingCollection.ratingKey,
      });
    }

    return {
      created: 0,
      updated: hasContentChanges ? 1 : 0,
      collectionRatingKey: existingCollection.ratingKey,
      itemCount: plexItems.length,
      updateStats: {
        added: updateResult.added,
        removed: updateResult.removed,
        reordered: updateResult.reordered,
      },
    };
  }

  /**
   * Create a new collection
   */
  private async createNewCollection(
    items: CollectionItem[],
    libraryKey: string,
    options: CollectionUpdateOptions
  ): Promise<CollectionUpdateResult> {
    const { collectionName } = options;

    logger.info(`Creating new collection: ${collectionName}`, {
      label: 'Collection Update Strategy',
      itemCount: items.length,
      libraryKey,
    });

    // Get actual Plex items using rating keys
    const plexItems = await this.getValidPlexItems(items);
    
    if (plexItems.length === 0) {
      logger.warn(`No valid Plex items found for new collection ${collectionName}`, {
        label: 'Collection Update Strategy',
        requestedItems: items.length,
      });
      return {
        created: 0,
        updated: 0,
        itemCount: 0,
      };
    }

    // Create collection with items
    const collectionRatingKey = await this.plexClient.createCollectionWithItems(
      collectionName,
      libraryKey,
      plexItems,
      options.mediaType
    );

    if (!collectionRatingKey) {
      throw new Error(`Failed to create collection ${collectionName}`);
    }

    // Track this collection as processed
    if (options.processedCollectionKeys) {
      options.processedCollectionKeys.add(collectionRatingKey);
    }

    // Apply collection metadata
    await this.applyCollectionMetadata(collectionRatingKey, options);

    return {
      created: 1,
      updated: 0,
      collectionRatingKey,
      itemCount: plexItems.length,
    };
  }

  /**
   * Find the target library for the given media type
   */
  private async findTargetLibrary(mediaType: 'movie' | 'tv'): Promise<string> {
    const settings = getSettings();
    const enabledLibraries = settings.plex.libraries.filter(lib => lib.enabled);
    const targetType = mediaType === 'movie' ? 'movie' : 'show';

    const matchingLibrary = enabledLibraries.find(lib => lib.type === targetType);

    if (!matchingLibrary) {
      throw new Error(`No enabled ${mediaType} library found`);
    }

    return matchingLibrary.id;
  }

  /**
   * Find existing collection by label and library
   */
  private async findExistingCollection(customLabel: string, libraryKey: string): Promise<any | null> {
    return this.allCollections.find(collection => {
      const hasMatchingLabel = Array.isArray(collection.labels) &&
        collection.labels.some((label: string) =>
          label.toLowerCase().includes(customLabel.toLowerCase())
        );
      const libraryMatches = String(collection.libraryKey) === String(libraryKey);

      return hasMatchingLabel && libraryMatches;
    }) || null;
  }

  /**
   * Get valid Plex items from collection items
   */
  private async getValidPlexItems(items: CollectionItem[]): Promise<any[]> {
    const ratingKeys = items.map(item => item.ratingKey);
    return await this.plexClient.getItemsByRatingKeys(ratingKeys);
  }

  /**
   * Update metadata for an existing collection
   */
  private async updateCollectionMetadata(
    existingCollection: any,
    options: CollectionUpdateOptions
  ): Promise<void> {
    const { collectionName, customPoster } = options;

    // Update title if it changed
    if (existingCollection.title !== collectionName) {
      await this.plexClient.updateCollectionTitle(existingCollection.ratingKey, collectionName);
    }

    // Update sort title for proper ordering
    await this.updateSortTitle(existingCollection.ratingKey, options);

    // Update visibility settings
    await this.updateVisibilitySettings(existingCollection.ratingKey, options.visibilityConfig);

    // Update poster if provided
    if (customPoster) {
      await this.updateCollectionPoster(existingCollection.ratingKey, customPoster);
    }
  }

  /**
   * Apply metadata to a newly created collection
   */
  private async applyCollectionMetadata(
    collectionRatingKey: string,
    options: CollectionUpdateOptions
  ): Promise<void> {
    // Set sort title for proper ordering
    await this.updateSortTitle(collectionRatingKey, options);

    // Apply visibility settings
    await this.updateVisibilitySettings(collectionRatingKey, options.visibilityConfig);

    // Set custom poster if provided
    if (options.customPoster) {
      await this.updateCollectionPoster(collectionRatingKey, options.customPoster);
    }

    // Add collection label for identification
    await this.addCollectionLabel(collectionRatingKey, options.customLabel);
  }

  /**
   * Update collection sort title for proper ordering
   */
  private async updateSortTitle(
    collectionRatingKey: string,
    options: CollectionUpdateOptions
  ): Promise<void> {
    if (options.sortOrderLibrary !== undefined && options.totalCollectionsInLibrary) {
      const sortTitle = generateSortTitle(options.sortOrderLibrary, options.totalCollectionsInLibrary);
      await this.plexClient.updateCollectionSortTitle(collectionRatingKey, sortTitle);
    }
  }

  /**
   * Update collection visibility settings
   */
  private async updateVisibilitySettings(
    collectionRatingKey: string,
    visibilityConfig: CollectionVisibilityConfig
  ): Promise<void> {
    const recommended = visibilityConfig.libraryRecommended ?? true;
    const home = visibilityConfig.usersHome || visibilityConfig.serverOwnerHome || false;
    const shared = visibilityConfig.usersHome ?? false;

    await this.plexClient.updateCollectionVisibility(
      collectionRatingKey,
      recommended,
      home,
      shared
    );
  }

  /**
   * Update collection poster
   */
  private async updateCollectionPoster(
    collectionRatingKey: string,
    posterPath: string
  ): Promise<void> {
    try {
      await this.plexClient.updateCollectionPoster(collectionRatingKey, posterPath);
    } catch (error) {
      logger.warn(`Failed to update collection poster: ${error}`, {
        label: 'Collection Update Strategy',
        collectionRatingKey,
        posterPath,
      });
    }
  }

  /**
   * Add identification label to collection
   */
  private async addCollectionLabel(
    collectionRatingKey: string,
    customLabel: string
  ): Promise<void> {
    try {
      // Add the label for collection identification
      const success = await this.plexClient.addLabelToCollection(collectionRatingKey, customLabel);
      if (!success) {
        throw new Error('Label addition returned false');
      }
    } catch (error) {
      logger.warn(`Failed to add collection label: ${error}`, {
        label: 'Collection Update Strategy',
        collectionRatingKey,
        customLabel,
      });
      throw error; // Re-throw to allow caller to handle cleanup
    }
  }

  /**
   * Static factory method to create strategy instance
   */
  static create(plexClient: PlexAPI, allCollections: any[]): CollectionUpdateStrategy {
    return new CollectionUpdateStrategy(plexClient, allCollections);
  }
}

export default CollectionUpdateStrategy;