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

      logger.info('Parsed account data:', {
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
        'Could not check Plex Pass status - assuming false for safety',
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
      logger.error('Failed to fetch Plex libraries', {
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
      logger.error('Error getting all collections', {
        label: 'Plex API',
        error,
      });
    }

    return allCollections.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
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
      return null;
    }
  }

  private parseLabelsFromCollection(collection: PlexCollection): string[] {
    if (Array.isArray(collection.Label)) {
      return collection.Label.map((label) => label.tag).filter(
        (tag): tag is string => typeof tag === 'string'
      );
    }

    return [];
  }

  public async getItemsByRatingKeys(
    ratingKeys: string[]
  ): Promise<PlexCollectionItem[]> {
    const items: PlexCollectionItem[] = [];

    for (const ratingKey of ratingKeys) {
      try {
        const response = await this.plexClient.query(
          `/library/metadata/${ratingKey}`
        );
        if (response.MediaContainer?.Metadata?.[0]) {
          items.push(response.MediaContainer.Metadata[0]);
        }
      } catch (error) {
        logger.warn(`Failed to get item with rating key ${ratingKey}`, {
          label: 'Plex API',
          error,
        });
      }
    }

    return items;
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
    libraryKey: string
  ): Promise<string | null> {
    try {
      const createUrl = `/library/collections?type=1&title=${encodeURIComponent(
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

  public async addItemsToCollection(
    collectionRatingKey: string,
    items: PlexCollectionItem[]
  ): Promise<void> {
    const machineId = getSettings().plex.machineId;

    for (const item of items) {
      try {
        const uriParam = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${item.ratingKey}`;
        const addUrl = `/library/collections/${collectionRatingKey}/items?uri=${uriParam}`;

        await this.safePutQuery(addUrl);
      } catch (error) {
        logger.warn(`Failed to add item ${item.ratingKey} to collection`, {
          label: 'Plex API',
          error,
        });
      }
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
    try {
      const params = {
        type: 18,
        id: collectionRatingKey,
        'label[].tag.tag': label,
        'label.locked': 1,
      };

      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${collectionRatingKey}?${queryString}`;

      await this.safePutQuery(editUrl);

      return true;
    } catch (error) {
      logger.error(
        `Error adding label "${label}" to collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error,
        }
      );
      return false;
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

      logger.info(
        `Updated collection ${collectionRatingKey} visibility: recommended=${recommended}, home=${home}, shared=${shared}`,
        {
          label: 'Plex API',
        }
      );
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

  public async deleteCollection(collectionRatingKey: string): Promise<void> {
    try {
      await this.safeDeleteQuery(`/library/collections/${collectionRatingKey}`);
    } catch (error) {
      logger.error(`Error deleting collection ${collectionRatingKey}`, {
        label: 'Plex API',
        error,
      });
      throw error;
    }
  }
}

export default PlexAPI;
