import type { Library, PlexSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import NodePlexAPI from 'plex-api';

// Extended interface for type-safe Plex API HTTP methods
interface ExtendedPlexAPI extends NodePlexAPI {
  postQuery?: (url: string) => Promise<unknown>;
  putQuery?: (url: string) => Promise<void>;
  deleteQuery?: (url: string) => Promise<void>;
}

export interface PlexLibraryItem {
  ratingKey: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  title: string;
  guid: string;
  parentGuid?: string;
  grandparentGuid?: string;
  addedAt: number;
  updatedAt: number;
  Guid?: {
    id: string;
  }[];
  type: 'movie' | 'show' | 'season' | 'episode';
  Media: Media[];
}

interface PlexLibraryResponse {
  MediaContainer: {
    totalSize: number;
    Metadata: PlexLibraryItem[];
  };
}

export interface PlexLibrary {
  type: 'show' | 'movie';
  key: string;
  title: string;
  agent: string;
}

interface PlexLibrariesResponse {
  MediaContainer: {
    Directory: PlexLibrary[];
  };
}

export interface PlexMetadata {
  ratingKey: string;
  parentRatingKey?: string;
  guid: string;
  type: 'movie' | 'show' | 'season';
  title: string;
  Guid: {
    id: string;
  }[];
  Children?: {
    size: 12;
    Metadata: PlexMetadata[];
  };
  index: number;
  parentIndex?: number;
  leafCount: number;
  viewedLeafCount: number;
  addedAt: number;
  updatedAt: number;
  Media: Media[];
}

interface Media {
  id: number;
  duration: number;
  bitrate: number;
  width: number;
  height: number;
  aspectRatio: number;
  audioChannels: number;
  audioCodec: string;
  videoCodec: string;
  videoResolution: string;
  container: string;
  videoFrameRate: string;
  videoProfile: string;
}

interface PlexMetadataResponse {
  MediaContainer: {
    Metadata: PlexMetadata[];
  };
}

interface PlexCollectionItem {
  ratingKey: string;
  title: string;
  addedAt?: number;
  [key: string]: unknown;
}

interface PlexCollection {
  ratingKey: string;
  title: string;
  type: string;
  addedAt?: number;
  labels: string[];
  libraryKey?: string;
  libraryName?: string;
  Label?: { tag: string; id?: number }[];
  [key: string]: unknown;
}

interface PlexCollectionMetadata extends PlexCollection {
  summary?: string;
  childCount?: number;
  thumb?: string;
  art?: string;
  titleSort?: string;
}

interface PlexCollectionResponse {
  MediaContainer: {
    Metadata: PlexCollection[];
    size?: number;
    totalSize?: number;
  };
}

class PlexAPI {
  private plexClient: NodePlexAPI;

  private getExtendedClient(): ExtendedPlexAPI {
    return this.plexClient as ExtendedPlexAPI;
  }

  private async safePostQuery(url: string): Promise<unknown> {
    const client = this.getExtendedClient();
    if (typeof client.postQuery !== 'function') {
      throw new Error(
        'POST operations are not supported by this Plex API version'
      );
    }
    return client.postQuery(url);
  }

  private async safePutQuery(url: string): Promise<void> {
    const client = this.getExtendedClient();
    if (typeof client.putQuery !== 'function') {
      throw new Error(
        'PUT operations are not supported by this Plex API version'
      );
    }
    return client.putQuery(url);
  }

  private async safeDeleteQuery(url: string): Promise<void> {
    const client = this.getExtendedClient();
    if (typeof client.deleteQuery !== 'function') {
      throw new Error(
        'DELETE operations are not supported by this Plex API version'
      );
    }
    return client.deleteQuery(url);
  }

  constructor({
    plexToken,
    plexSettings,
    timeout,
  }: {
    plexToken?: string;
    plexSettings?: PlexSettings;
    timeout?: number;
  }) {
    const settings = getSettings();
    let settingsPlex: PlexSettings | undefined;
    plexSettings
      ? (settingsPlex = plexSettings)
      : (settingsPlex = getSettings().plex);

    this.plexClient = new NodePlexAPI({
      hostname: settingsPlex.ip,
      port: settingsPlex.port,
      https: settingsPlex.useSsl,
      timeout: timeout,
      token: plexToken,
      authenticator: {
        authenticate: (
          _plexApi,
          cb: (err?: string, token?: string) => void
        ) => {
          if (!plexToken) {
            return cb('Plex Token not found!');
          }
          cb(undefined, plexToken);
        },
      },
      options: {
        identifier: settings.clientId,
        product: 'Overseerr',
        deviceName: 'Overseerr',
        platform: 'Overseerr',
      },
    });
  }

  public async getStatus() {
    return await this.plexClient.query('/');
  }

  public async checkPlexPass(): Promise<boolean> {
    try {
      const response = await this.plexClient.query('/myplex/account');
      const account = response.MyPlex;

      logger.info('Parsed account data.', {
        label: 'Plex API',
        subscriptionActive: account?.subscriptionActive,
        subscriptionState: account?.subscriptionState,
      });

      const hasPlexPass =
        account?.subscriptionActive === true ||
        account?.subscriptionState === 'Active';

      logger.info(
        `Plex Pass check result: ${hasPlexPass ? 'Active' : 'Inactive'}`,
        {
          label: 'Plex API',
          subscriptionActive: account?.subscriptionActive,
          subscriptionState: account?.subscriptionState,
        }
      );

      return hasPlexPass;
    } catch (error) {
      logger.warn(
        'Could not check Plex Pass status. Assuming false for safety.',
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return false;
    }
  }

  public async getLibraries(): Promise<PlexLibrary[]> {
    const response = await this.plexClient.query<PlexLibrariesResponse>(
      '/library/sections'
    );

    return response.MediaContainer.Directory;
  }

  public async syncLibraries(): Promise<void> {
    const settings = getSettings();

    try {
      const libraries = await this.getLibraries();

      const newLibraries: Library[] = libraries
        .filter(
          (library) => library.type === 'movie' || library.type === 'show'
        )
        .filter((library) => library.agent !== 'com.plexapp.agents.none')
        .map((library) => {
          const existing = settings.plex.libraries.find(
            (l) => l.id === library.key && l.name === library.title
          );

          return {
            id: library.key,
            name: library.title,
            enabled: existing?.enabled ?? false,
            type: library.type,
            lastScan: existing?.lastScan,
          };
        });

      settings.plex.libraries = newLibraries;
    } catch (e) {
      logger.error('Failed to fetch Plex libraries.', {
        label: 'Plex API',
        message: e.message,
      });

      settings.plex.libraries = [];
    }

    settings.save();
  }

  public async getLibraryContents(
    id: string,
    { offset = 0, size = 50 }: { offset?: number; size?: number } = {}
  ): Promise<{ totalSize: number; items: PlexLibraryItem[] }> {
    const response = await this.plexClient.query<PlexLibraryResponse>({
      uri: `/library/sections/${id}/all?includeGuids=1`,
      extraHeaders: {
        'X-Plex-Container-Start': `${offset}`,
        'X-Plex-Container-Size': `${size}`,
      },
    });

    return {
      totalSize: response.MediaContainer.totalSize,
      items: response.MediaContainer.Metadata ?? [],
    };
  }

  public async getMetadata(
    key: string,
    options: { includeChildren?: boolean } = {}
  ): Promise<PlexMetadata> {
    const response = await this.plexClient.query<PlexMetadataResponse>(
      `/library/metadata/${key}${
        options.includeChildren ? '?includeChildren=1' : ''
      }`
    );

    return response.MediaContainer.Metadata[0];
  }

  public async getChildrenMetadata(key: string): Promise<PlexMetadata[]> {
    const response = await this.plexClient.query<PlexMetadataResponse>(
      `/library/metadata/${key}/children`
    );

    return response.MediaContainer.Metadata;
  }

  public async getRecentlyAdded(
    id: string,
    options: { addedAt: number } = {
      addedAt: Date.now() - 1000 * 60 * 60,
    },
    mediaType: 'movie' | 'show'
  ): Promise<PlexLibraryItem[]> {
    const response = await this.plexClient.query<PlexLibraryResponse>({
      uri: `/library/sections/${id}/all?type=${
        mediaType === 'show' ? '4' : '1'
      }&sort=addedAt%3Adesc&addedAt>>=${Math.floor(options.addedAt / 1000)}`,
      extraHeaders: {
        'X-Plex-Container-Start': `0`,
        'X-Plex-Container-Size': `500`,
      },
    });

    return response.MediaContainer.Metadata;
  }

  public async getAllCollections(): Promise<PlexCollection[]> {
    const allCollections: PlexCollection[] = [];

    try {
      const libraries = await this.getLibraries();

      for (const library of libraries) {
        try {
          const response = await this.plexClient.query<PlexCollectionResponse>(
            `/library/sections/${library.key}/collections`
          );

          const collections = response.MediaContainer?.Metadata || [];

          for (const collection of collections) {
            const detailedCollection = await this.getCollectionMetadata(
              collection.ratingKey
            );
            const labels = detailedCollection?.labels || [];

            const enhancedCollection: PlexCollection = {
              ...collection,
              libraryKey: library.key,
              libraryName: library.title,
              labels,
            };

            allCollections.push(enhancedCollection);
          }
        } catch (error) {
          logger.warn(
            `Failed to get collections for library ${library.title}`,
            {
              label: 'Plex API',
              error,
            }
          );
        }
      }
    } catch (error) {
      logger.error('Error getting all collections.', {
        label: 'Plex API',
        error,
      });
    }

    // DEBUG: Log collection order and properties to understand Plex ordering
    logger.debug('Plex collections order debug:', {
      label: 'Plex API',
      collections: allCollections.map((c, index) => ({
        index,
        title: c.title,
        ratingKey: c.ratingKey,
        addedAt: c.addedAt,
        updatedAt: c.updatedAt,
        titleSort: c.titleSort,
        labels: c.labels
      }))
    });
    
    // Return collections in Plex's natural order - don't force addedAt sorting
    return allCollections;
  }

  public async getCollectionMetadata(
    ratingKey: string
  ): Promise<PlexCollectionMetadata | null> {
    try {
      const response = await this.plexClient.query<{
        MediaContainer: { Metadata: PlexCollectionMetadata[] };
      }>(`/library/metadata/${ratingKey}`);

      const collection = response.MediaContainer?.Metadata?.[0];
      if (!collection) {
        // Collection not found - this is different from an API error
        logger.debug(`Collection ${ratingKey} not found`, {
          label: 'Plex API',
        });
        return null;
      }

      const labels = this.parseLabelsFromCollection(collection);

      return {
        ...collection,
        labels,
      };
    } catch (error) {
      logger.error(`Failed to get collection metadata for ${ratingKey}`, {
        label: 'Plex API',
        error,
      });
      // Throw error to distinguish from "collection not found"
      throw new Error(
        `API error getting collection metadata: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Safely get collection metadata with error handling
   * Returns null for both "not found" and "API error" cases, but logs appropriately
   */
  public async getCollectionMetadataSafe(
    ratingKey: string
  ): Promise<PlexCollectionMetadata | null> {
    try {
      return await this.getCollectionMetadata(ratingKey);
    } catch (error) {
      // API error already logged in getCollectionMetadata
      return null;
    }
  }

  private parseLabelsFromCollection(collection: PlexCollection): string[] {
    // Handle multiple possible label structures from Plex API
    if (Array.isArray(collection.Label)) {
      return collection.Label.map((label) => label.tag).filter(
        (tag): tag is string => typeof tag === 'string'
      );
    }

    // Fallback: check if labels are already processed and stored in the labels property
    if (Array.isArray(collection.labels)) {
      return collection.labels;
    }

    return [];
  }

  public async getItemsByRatingKeys(
    ratingKeys: string[]
  ): Promise<PlexCollectionItem[]> {
    if (ratingKeys.length === 0) {
      return [];
    }

    try {
      // Use bulk fetching with comma-separated rating keys (like Python PlexAPI)
      const ratingKeysParam = ratingKeys.join(',');
      const response = await this.plexClient.query(
        `/library/metadata/${ratingKeysParam}`
      );

      const items = response.MediaContainer?.Metadata || [];

      // CRITICAL: Preserve the original order from ratingKeys array
      // Plex returns items in alphabetical order, but we need chronological request order
      const orderedItems: PlexCollectionItem[] = [];
      const missingRatingKeys: string[] = [];

      for (const ratingKey of ratingKeys) {
        const item = items.find((item: any) => item.ratingKey === ratingKey);
        if (item) {
          orderedItems.push(item);
        } else {
          missingRatingKeys.push(ratingKey);
        }
      }

      if (missingRatingKeys.length > 0) {
        logger.warn(
          `${missingRatingKeys.length}/${ratingKeys.length} items could not be found in Plex library.`,
          {
            label: 'Plex API',
            totalRequested: ratingKeys.length,
            totalFound: items.length,
            missingRatingKeys: missingRatingKeys,
          }
        );
      }

      return orderedItems;
    } catch (error) {
      // If bulk fetch fails, fall back to individual requests
      logger.warn('Bulk fetch failed, falling back to individual requests.', {
        label: 'Plex API',
      });

      const items: PlexCollectionItem[] = [];
      const failedRatingKeys: string[] = [];

      for (const ratingKey of ratingKeys) {
        try {
          const response = await this.plexClient.query(
            `/library/metadata/${ratingKey}`
          );
          if (response.MediaContainer?.Metadata?.[0]) {
            items.push(response.MediaContainer.Metadata[0]);
          } else {
            failedRatingKeys.push(ratingKey);
          }
        } catch {
          failedRatingKeys.push(ratingKey);
        }
      }

      if (failedRatingKeys.length > 0) {
        logger.warn(
          `${failedRatingKeys.length}/${ratingKeys.length} items could not be found in Plex library.`,
          {
            label: 'Plex API',
            totalRequested: ratingKeys.length,
            totalFound: items.length,
            missingRatingKeys: failedRatingKeys,
          }
        );
      }

      return items;
    }
  }

  public async getCollectionByName(
    name: string,
    libraryKey: string
  ): Promise<PlexCollection | null> {
    try {
      const response = await this.plexClient.query<PlexCollectionResponse>(
        `/library/sections/${libraryKey}/collections`
      );
      const collections = response.MediaContainer?.Metadata || [];

      const foundCollection =
        collections.find(
          (collection: PlexCollection) => collection.title === name
        ) || null;

      if (foundCollection) {
        const detailedCollection = await this.getCollectionMetadata(
          foundCollection.ratingKey
        );
        const labels = detailedCollection?.labels || [];

        return {
          ...foundCollection,
          libraryKey,
          labels,
        };
      }

      return null;
    } catch (error) {
      logger.error(`Error getting collection by name "${name}"`, {
        label: 'Plex API',
        error,
      });
      return null;
    }
  }

  public async createEmptyCollection(
    title: string,
    libraryKey: string,
    mediaType: 'movie' | 'tv' = 'movie'
  ): Promise<string | null> {
    try {
      // Use correct type parameter: 1 for movies, 2 for TV shows
      const typeParam = mediaType === 'tv' ? 2 : 1;
      const createUrl = `/library/collections?type=${typeParam}&title=${encodeURIComponent(
        title
      )}&smart=0&sectionId=${libraryKey}`;

      const result = await this.safePostQuery(createUrl);

      let collectionRatingKey: string | null = null;
      if (result && typeof result === 'object' && 'MediaContainer' in result) {
        const resultObj = result as {
          MediaContainer?: { Metadata?: PlexCollection[] };
        };
        if (resultObj.MediaContainer?.Metadata?.[0]) {
          collectionRatingKey = resultObj.MediaContainer.Metadata[0].ratingKey;
        }
      }

      return collectionRatingKey;
    } catch (error) {
      logger.error(`Error creating collection "${title}"`, {
        label: 'Plex API',
        error,
      });
      return null;
    }
  }

  public async createCollectionWithItems(
    title: string,
    libraryKey: string,
    items: PlexCollectionItem[],
    mediaType: 'movie' | 'tv' = 'movie'
  ): Promise<string | null> {
    try {
      if (items.length === 0) {
        return this.createEmptyCollection(title, libraryKey, mediaType);
      }

      // Use Python PlexAPI approach: create collection with items in single call
      const typeParam = mediaType === 'tv' ? 2 : 1;
      const machineId = getSettings().plex.machineId;
      const ratingKeys = items.map((item) => item.ratingKey).join(',');
      const uri = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${ratingKeys}`;

      const createUrl = `/library/collections?type=${typeParam}&title=${encodeURIComponent(
        title
      )}&smart=0&sectionId=${libraryKey}&uri=${encodeURIComponent(uri)}`;

      const result = await this.safePostQuery(createUrl);

      let collectionRatingKey: string | null = null;
      if (result && typeof result === 'object' && 'MediaContainer' in result) {
        const resultObj = result as {
          MediaContainer?: { Metadata?: PlexCollection[] };
        };
        if (resultObj.MediaContainer?.Metadata?.[0]) {
          collectionRatingKey = resultObj.MediaContainer.Metadata[0].ratingKey;
        }
      }

      return collectionRatingKey;
    } catch (error) {
      logger.warn(
        'Bulk collection creation failed, falling back to empty collection.',
        {
          label: 'Plex API',
        }
      );

      // Fall back to empty collection + individual item addition
      const collectionRatingKey = await this.createEmptyCollection(
        title,
        libraryKey,
        mediaType
      );
      if (collectionRatingKey && items.length > 0) {
        await this.addItemsToCollection(collectionRatingKey, items);
      }
      return collectionRatingKey;
    }
  }

  public async addItemsToCollection(
    collectionRatingKey: string,
    items: PlexCollectionItem[]
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const machineId = getSettings().plex.machineId;

    try {
      // Use bulk addition with comma-separated rating keys
      const ratingKeys = items.map((item) => item.ratingKey).join(',');
      const uriParam = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${ratingKeys}`;
      const addUrl = `/library/collections/${collectionRatingKey}/items?uri=${encodeURIComponent(
        uriParam
      )}`;

      await this.safePutQuery(addUrl);
    } catch (error) {
      // If bulk addition fails, fall back to individual addition
      logger.warn(
        'Bulk item addition failed, falling back to individual addition.',
        {
          label: 'Plex API',
          collectionRatingKey,
        }
      );

      for (const item of items) {
        try {
          const uriParam = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${item.ratingKey}`;
          const addUrl = `/library/collections/${collectionRatingKey}/items?uri=${encodeURIComponent(
            uriParam
          )}`;

          await this.safePutQuery(addUrl);
        } catch (itemError) {
          const errorMessage =
            itemError instanceof Error ? itemError.message : 'Unknown error';
          logger.warn(
            `Failed to add item "${item.title || 'Unknown'}" to collection.`,
            {
              label: 'Plex API',
              itemRatingKey: item.ratingKey,
              collectionRatingKey,
              error: errorMessage,
            }
          );
        }
      }
    }
  }

  /**
   * Get items in a collection
   */
  public async getCollectionItems(
    collectionRatingKey: string
  ): Promise<string[]> {
    try {
      const response = await this.plexClient.query(
        `/library/collections/${collectionRatingKey}/children`
      );
      const items = response.MediaContainer?.Metadata || [];
      return items.map((item: PlexCollectionItem) => item.ratingKey);
    } catch (error) {
      logger.error(
        `Error getting items from collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error,
        }
      );
      return [];
    }
  }

  public async removeItemsFromCollection(
    collectionRatingKey: string
  ): Promise<void> {
    try {
      const response = await this.plexClient.query(
        `/library/collections/${collectionRatingKey}/children`
      );
      const items = response.MediaContainer?.Metadata || [];

      if (items.length === 0) {
        return;
      }

      for (const item of items) {
        const removeUrl = `/library/collections/${collectionRatingKey}/items/${item.ratingKey}`;

        try {
          await this.safeDeleteQuery(removeUrl);
        } catch (error) {
          const errorMessage = (error as Error).message;
          if (!errorMessage.includes('404')) {
            logger.warn(
              `Failed to remove item ${item.ratingKey} from collection`,
              {
                label: 'Plex API',
                error: errorMessage,
              }
            );
          }
        }
      }
    } catch (error) {
      logger.error(
        `Error removing items from collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error,
        }
      );
      throw error;
    }
  }

  public async addLabelToCollection(
    collectionRatingKey: string,
    label: string
  ): Promise<boolean> {
    return this.addLabelToCollectionWithRetry(collectionRatingKey, label, 3);
  }

  /**
   * Add label to collection with retry logic and verification
   */
  private async addLabelToCollectionWithRetry(
    collectionRatingKey: string,
    label: string,
    maxRetries: number
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Get current collection metadata to preserve existing labels
        // Use strict version to distinguish API errors from "not found"
        const collectionMeta = await this.getCollectionMetadata(
          collectionRatingKey
        );
        if (!collectionMeta) {
          throw new Error(`Collection ${collectionRatingKey} not found`);
        }

        // Clean existing Overseerr labels while preserving user's custom labels
        const { cleanOverseerrCollectionLabels } = await import(
          '@server/lib/collectionsUtils'
        );
        const existingLabels = collectionMeta.labels || [];
        const preservedLabels = cleanOverseerrCollectionLabels(existingLabels);

        // Check if label already exists (case-insensitive comparison since Plex auto-formats labels)
        const labelExistsIndex = existingLabels.findIndex(
          (existingLabel) => existingLabel.toLowerCase() === label.toLowerCase()
        );
        if (labelExistsIndex !== -1) {
          return true;
        }

        // Combine preserved labels with new Overseerr label
        const allLabels = [...preservedLabels, label];

        // Build params with all labels to preserve existing ones
        const params: Record<string, string | number> = {
          type: 18,
          id: collectionRatingKey,
          'label.locked': 1,
        };

        // Add each label as a separate parameter
        allLabels.forEach((labelTag, index) => {
          params[`label[${index}].tag.tag`] = labelTag;
        });

        const queryString = Object.entries(params)
          .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
          .join('&');

        const editUrl = `/library/metadata/${collectionRatingKey}?${queryString}`;

        await this.safePutQuery(editUrl);

        // Verify the label was actually added (with a small delay for Plex API)
        await new Promise((resolve) => setTimeout(resolve, 500)); // Allow Plex time to index the label
        const updatedMeta = await this.getCollectionMetadata(
          collectionRatingKey
        );

        if (
          !updatedMeta ||
          !updatedMeta.labels?.some(
            (existingLabel) =>
              existingLabel.toLowerCase() === label.toLowerCase()
          )
        ) {
          // Don't fail immediately - Plex might need more time to index labels
          logger.warn(
            `Label verification delayed for collection ${collectionRatingKey} - label "${label}" not immediately visible`,
            {
              label: 'Plex API',
              foundLabels: updatedMeta?.labels || [],
              expectedLabel: label,
            }
          );

          // Give Plex more time and try once more
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const finalMeta = await this.getCollectionMetadata(
            collectionRatingKey
          );

          if (
            !finalMeta ||
            !finalMeta.labels?.some(
              (existingLabel) =>
                existingLabel.toLowerCase() === label.toLowerCase()
            )
          ) {
            throw new Error(
              `Label verification failed - label "${label}" not found on collection after multiple attempts. Found labels: ${JSON.stringify(
                finalMeta?.labels || []
              )}`
            );
          }
        }

        return true;
      } catch (error) {
        logger.warn(
          `Attempt ${attempt}/${maxRetries} failed to add label "${label}" to collection ${collectionRatingKey}`,
          {
            label: 'Plex API',
            error: error instanceof Error ? error.message : 'Unknown error',
            attempt,
            maxRetries,
          }
        );

        if (attempt === maxRetries) {
          logger.error(
            `Failed to add label "${label}" to collection ${collectionRatingKey} after ${maxRetries} attempts`,
            {
              label: 'Plex API',
              error,
            }
          );
          return false;
        }

        // Wait before retrying (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
    return false;
  }

  public async updateCollectionTitle(
    collectionRatingKey: string,
    title: string
  ): Promise<void> {
    try {
      const params = {
        type: 18,
        id: collectionRatingKey,
        'title.value': title,
        'title.locked': 1,
      };

      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${collectionRatingKey}?${queryString}`;

      await this.safePutQuery(editUrl);
    } catch (error) {
      logger.error(
        `Error updating title for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error,
        }
      );
    }
  }

  public async updateCollectionSortTitle(
    collectionRatingKey: string,
    sortTitle: string
  ): Promise<void> {
    try {
      const params = {
        type: 18,
        id: collectionRatingKey,
        'titleSort.value': sortTitle,
        'titleSort.locked': 1,
      };

      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${collectionRatingKey}?${queryString}`;

      await this.safePutQuery(editUrl);
    } catch (error) {
      logger.error(
        `Error updating sort title for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error,
        }
      );
    }
  }

  public async updateCollectionContentSort(
    collectionRatingKey: string,
    sortType: 'release' | 'alpha' | 'custom' = 'custom'
  ): Promise<void> {
    try {
      // Map sort types to Plex integer values (from Python PlexAPI reverse engineering)
      const sortValues = {
        release: 0, // Order by release dates
        alpha: 1, // Order alphabetically
        custom: 2, // Custom collection order (preserves add order)
      };

      // Use the correct endpoint discovered from Python PlexAPI debug output:
      // PUT /library/collections/{ratingKey}/prefs?collectionSort=2
      const editUrl = `/library/collections/${collectionRatingKey}/prefs?collectionSort=${sortValues[sortType]}`;

      await this.safePutQuery(editUrl);
    } catch (error) {
      logger.error(
        `Error updating content sort for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error,
        }
      );
      throw error;
    }
  }

  public async moveItemInCollection(
    collectionRatingKey: string,
    itemRatingKey: string,
    afterItemRatingKey: string
  ): Promise<boolean> {
    try {
      // Use the exact API endpoint discovered from Python PlexAPI debug output:
      // PUT /library/collections/{collectionRatingKey}/items/{itemRatingKey}/move?after={afterItemRatingKey}
      const moveUrl = `/library/collections/${collectionRatingKey}/items/${itemRatingKey}/move?after=${afterItemRatingKey}`;

      await this.safePutQuery(moveUrl);
      return true;
    } catch (error) {
      // Silently fail - this is not critical for functionality
      return false;
    }
  }

  public async arrangeCollectionItemsInOrder(
    collectionRatingKey: string,
    orderedItems: PlexCollectionItem[]
  ): Promise<void> {
    if (orderedItems.length <= 1) {
      return; // No need to arrange single item or empty collections
    }

    let failCount = 0;

    // Move each item to its correct position (skip the first item as it's already in position)
    // Items are ordered newest first, so we position each subsequent item after the previous one
    for (let i = 1; i < orderedItems.length; i++) {
      const currentItem = orderedItems[i];
      const previousItem = orderedItems[i - 1];

      const success = await this.moveItemInCollection(
        collectionRatingKey,
        currentItem.ratingKey,
        previousItem.ratingKey
      );

      if (!success) {
        failCount++;
      }
    }

    if (failCount > 0) {
      logger.warn(
        `Failed to arrange ${failCount} items in collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
        }
      );
    }
  }

  public async updateCollectionVisibility(
    collectionRatingKey: string,
    recommended: boolean,
    home: boolean,
    shared: boolean
  ): Promise<void> {
    try {
      // Get collection metadata to determine library section
      const collectionMeta = await this.plexClient.query(
        `/library/metadata/${collectionRatingKey}`
      );
      const librarySectionID =
        collectionMeta.MediaContainer?.Metadata?.[0]?.librarySectionID;

      if (!librarySectionID) {
        throw new Error(
          `Could not determine library section ID for collection ${collectionRatingKey}`
        );
      }

      // Initialize hub for collection visibility management
      const hubInitUrl = `/hubs/sections/${librarySectionID}/manage?metadataItemId=${collectionRatingKey}`;
      await this.safePostQuery(hubInitUrl);

      // Update visibility settings
      const hubIdentifier = `custom.collection.${librarySectionID}.${collectionRatingKey}`;
      const params = new URLSearchParams({
        promotedToRecommended: recommended ? '1' : '0',
        promotedToOwnHome: home ? '1' : '0',
        promotedToSharedHome: shared ? '1' : '0',
      });

      const putUrl = `/hubs/sections/${librarySectionID}/manage/${hubIdentifier}?${params.toString()}`;
      await this.safePutQuery(putUrl);
    } catch (error) {
      logger.error(
        `Error updating visibility for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
          collectionRatingKey,
          recommended,
          home,
          shared,
        }
      );
    }
  }

  /**
   * Upload and set a custom poster for a collection
   */
  public async updateCollectionPoster(
    collectionRatingKey: string,
    posterPath: string
  ): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Read the poster file
      const posterBuffer = await fs.promises.readFile(posterPath);
      const fileExtension = path.extname(posterPath).toLowerCase();
      
      // First, we need to upload the image to Plex's photo library
      // This creates a photo key that we can then use to set as the poster
      const uploadEndpoint = '/photo/:/transcode';
      const uploadParams = new URLSearchParams({
        width: '500',
        height: '750',
        minSize: '1',
        url: `data:image/${fileExtension === '.png' ? 'png' : 'jpeg'};base64,${posterBuffer.toString('base64')}`
      });
      
      // Upload the image data
      const uploadResponse = await this.plexClient.query(
        `${uploadEndpoint}?${uploadParams.toString()}`
      );
      
      // Extract the photo key from the response
      const photoKey = uploadResponse?.MediaContainer?.Metadata?.[0]?.key;
      if (!photoKey) {
        throw new Error('Failed to upload poster to Plex - no photo key returned');
      }
      
      // Now set this photo as the collection's poster using the photo key
      const setPosterEndpoint = `/library/metadata/${collectionRatingKey}/poster`;
      const setPosterParams = new URLSearchParams({
        url: photoKey
      });
      
      await this.plexClient.query(`${setPosterEndpoint}?${setPosterParams.toString()}`);

      logger.info(`Successfully uploaded and set poster for collection ${collectionRatingKey}`, {
        label: 'Plex API',
        collectionRatingKey,
        posterPath,
        photoKey,
      });
    } catch (error) {
      logger.error(
        `Error updating poster for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
          collectionRatingKey,
          posterPath,
        }
      );
      throw error;
    }
  }

  /**
   * Remove specific items from a collection (incremental update)
   */
  public async removeSpecificItemsFromCollection(
    collectionRatingKey: string,
    itemsToRemove: string[]
  ): Promise<{ successful: number; failed: number }> {
    let successful = 0;
    let failed = 0;

    for (const ratingKey of itemsToRemove) {
      const removeUrl = `/library/collections/${collectionRatingKey}/items/${ratingKey}`;

      try {
        await this.safeDeleteQuery(removeUrl);
        successful++;
      } catch (error) {
        failed++;
        const errorMessage = (error as Error).message;
        if (!errorMessage.includes('404')) {
          logger.warn(
            `Failed to remove item ${ratingKey} from collection ${collectionRatingKey}`,
            {
              label: 'Plex API',
              error: errorMessage,
            }
          );
        }
      }
    }

    return { successful, failed };
  }

  /**
   * Add specific items to a collection (incremental update)
   */
  public async addSpecificItemsToCollection(
    collectionRatingKey: string,
    itemsToAdd: string[]
  ): Promise<{ successful: number; failed: number }> {
    let successful = 0;
    let failed = 0;

    // Add items in batches to avoid overwhelming the API
    const batchSize = 20;
    const machineId = getSettings().plex.machineId;

    for (let i = 0; i < itemsToAdd.length; i += batchSize) {
      const batch = itemsToAdd.slice(i, i + batchSize);
      const uri = batch
        .map(
          (key) =>
            `server://${machineId}/com.plexapp.plugins.library/library/metadata/${key}`
        )
        .join(',');

      try {
        await this.safePutQuery(
          `/library/collections/${collectionRatingKey}/items?uri=${encodeURIComponent(
            uri
          )}`
        );
        successful += batch.length;
      } catch (error) {
        failed += batch.length;
        logger.error(
          `Error adding batch of ${batch.length} items to collection ${collectionRatingKey}`,
          {
            label: 'Plex API',
            error,
          }
        );
      }
    }

    return { successful, failed };
  }

  public async deleteCollection(collectionRatingKey: string): Promise<void> {
    try {
      await this.safeDeleteQuery(`/library/collections/${collectionRatingKey}`);
    } catch (error) {
      logger.error(`Error deleting collection ${collectionRatingKey}.`, {
        label: 'Plex API',
        error,
      });
      throw error;
    }
  }
}

export default PlexAPI;
