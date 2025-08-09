import type PlexAPI from '@server/api/plexapi';
// Now using standardized approach via BaseCollectionSync - no longer needs legacy method
import { overseerrCollectionService } from './OverseerrCollectionService';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';
import { COLLECTION_LIMITS, getRuntimeConfig } from './ConfigurationConstants';
import { BaseCollectionSync } from './BaseCollectionSync';
import type {
  CollectionItem,
  SyncResult,
  CollectionOperationResult,
  CollectionSyncOptions,
  MissingItem,
  FilteringStats,
  CollectionSyncError,
  OverseerrTemplateContext,
} from './types';
import { CollectionSyncErrorType } from './types';

interface OverseerrCollectionItem extends CollectionItem {
  requestId: number;
  userId: number;
}

interface UserCollections {
  user: any; // OverseerrUser from service layer
  movies: OverseerrCollectionItem[];
  tv: OverseerrCollectionItem[];
}

interface UserCollectionsMap {
  [userId: number]: UserCollections;
}

/**
 * New Overseerr Collection Sync implementation using the base class
 * 
 * Handles three types of Overseerr collections:
 * - 'users': Individual collections per user based on their requests
 * - 'global': Single collection with all requests  
 * - 'server_owner': Collection for server owner's requests only
 */
export class OverseerrCollectionSync extends BaseCollectionSync {
  constructor() {
    super('overseerr');
  }

  /**
   * Get the maximum items limit for a collection config
   */
  private getMaxItems(config: CollectionConfig): number {
    if (config.maxItems && config.maxItems > 0) {
      return config.maxItems;
    }
    
    const runtimeConfig = getRuntimeConfig();
    return runtimeConfig.defaultMaxItems;
  }

  /**
   * Process server owner collections using shared requests data
   */
  public async processServerOwnerCollectionsFromConfig(
    config: CollectionConfig,
    requests: any[], // MediaRequest[]
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<SyncResult> {
    if (config.type !== 'overseerr' || config.subtype !== 'server_owner') {
      return { created: 0, updated: 0 };
    }

    // Filter requests to only admin user (server owner)
    const adminRequests = requests.filter(request => request.requestedBy.id === 1);
    
    if (adminRequests.length === 0) {
      logger.warn('No admin requests found for server owner collection', {
        label: 'Overseerr Collections',
        configName: config.name,
      });
      return { created: 0, updated: 0 };
    }

    // Organize admin requests by media type
    const movieItems: any[] = [];
    const tvItems: any[] = [];

    for (const request of adminRequests) {
      const ratingKey = request.is4k ? request.media?.ratingKey4k : request.media?.ratingKey;
      if (!ratingKey) continue;

      const item = {
        ratingKey: ratingKey.toString(),
        title: request.media?.title || 'Unknown',
        type: request.type,
        tmdbId: request.media?.tmdbId,
      };

      if (request.type === 'movie') {
        movieItems.push(item);
      } else if (request.type === 'tv') {
        tvItems.push(item);
      }
    }

    let created = 0;
    let updated = 0;

    // Get admin user for context using service layer
    const adminUser = await overseerrCollectionService.getAdminUser();
    if (!adminUser) {
      logger.error('Admin user not found for server owner collection', {
        label: 'Overseerr Collections',
        configName: config.name,
      });
      return { created: 0, updated: 0 };
    }

    // Admin user from service layer already has all necessary fields
    const fullAdminUser = adminUser;

    if (!fullAdminUser) {
      logger.error('Full admin user details not found', {
        label: 'Overseerr Collections',
        configName: config.name,
      });
      return { created: 0, updated: 0 };
    }

    try {
      // Process movies if we have any and config allows movies
      if (movieItems.length > 0 && (config.mediaType === 'both' || config.mediaType === 'movie')) {
        const movieCollectionName = this.createServerOwnerCollectionName(fullAdminUser, config, 'movie');
        
        const result = await this.createOrUpdateCollectionStandardized(
          movieItems.slice(0, this.getMaxItems(config)),
          movieCollectionName,
          'movie',
          config,
          plexClient,
          allCollections,
          processedCollectionKeys,
          {
            userId: fullAdminUser.plexId || fullAdminUser.id,
            customLabel: `AgregarrOverseerrOwner${fullAdminUser.plexId || fullAdminUser.id}`
          }
        );
        
        created += result.created;
        updated += result.updated;
      }

      // Process TV if we have any and config allows TV
      if (tvItems.length > 0 && (config.mediaType === 'both' || config.mediaType === 'tv')) {
        const tvCollectionName = this.createServerOwnerCollectionName(fullAdminUser, config, 'tv');
        
        const result = await this.createOrUpdateCollectionStandardized(
          tvItems.slice(0, this.getMaxItems(config)),
          tvCollectionName,
          'tv',
          config,
          plexClient,
          allCollections,
          processedCollectionKeys,
          {
            userId: fullAdminUser.plexId || fullAdminUser.id,
            customLabel: `AgregarrOverseerrOwner${fullAdminUser.plexId || fullAdminUser.id}`
          }
        );
        
        created += result.created;
        updated += result.updated;
      }
    } catch (error) {
      logger.error(`Failed to process server owner collection for ${config.name}`, {
        label: 'Overseerr Collections',
        configName: config.name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { created: 0, updated: 0 };
    }

    if (created > 0 || updated > 0) {
      logger.info(
        `Server owner collection processing (${config.name}): ${created} created, ${updated} updated`,
        {
          label: 'Overseerr Collections',
          configName: config.name,
        }
      );
    }

    return { created, updated };
  }

  /**
   * Process user collections using pre-built userCollections data
   */
  public async processUserCollectionsFromConfig(
    config: CollectionConfig,
    userCollections: any, // UserCollections type
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<SyncResult> {
    if (config.type !== 'overseerr' || config.subtype !== 'users') {
      return { created: 0, updated: 0 };
    }

    let created = 0;
    let updated = 0;
    let failed = 0;

    for (const [, collections] of Object.entries(userCollections)) {
      if (!collections || typeof collections !== 'object') continue;
      
      const user = (collections as any).user;
      const movieItems = (collections as any).movies || [];
      const tvItems = (collections as any).tv || [];

      try {
        // Process movies collection only if config allows movies
        if (movieItems.length > 0 && (config.mediaType === 'both' || config.mediaType === 'movie')) {
          const movieCollectionName = this.createUserCollectionName(
            user,
            config,
            'movie'
          );
          
          const result = await this.createOrUpdateCollectionStandardized(
            movieItems,
            movieCollectionName,
            'movie',
            config,
            plexClient,
            allCollections,
            processedCollectionKeys,
            {
              userId: user.plexId || user.id
              // customLabel omitted - will use default AgregarrOverseerrUser{userId} format
            }
          );
          
          created += result.created;
          updated += result.updated;
        }

        // Process TV collection only if config allows TV
        if (tvItems.length > 0 && (config.mediaType === 'both' || config.mediaType === 'tv')) {
          const tvCollectionName = this.createUserCollectionName(
            user,
            config,
            'tv'
          );
          
          const result = await this.createOrUpdateCollectionStandardized(
            tvItems,
            tvCollectionName,
            'tv',
            config,
            plexClient,
            allCollections,
            processedCollectionKeys,
            {
              userId: user.plexId || user.id
              // customLabel omitted - will use default AgregarrOverseerrUser{userId} format
            }
          );
          
          created += result.created;
          updated += result.updated;
        }
      } catch (error) {
        failed++;
        const username = user?.displayName || user?.plexUsername || user?.username || 'Unknown';
        logger.error(`Failed to process collections for user ${username}`, {
          label: 'Overseerr Collections',
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
          label: 'Overseerr Collections',
          configName: config.name,
        }
      );
    }

    return { created, updated };
  }

  /**
   * Process collections with shared requests data for performance optimization
   * Fetches requests once and shares across all Overseerr collections
   */
  public async processCollectionsWithSharedData(
    collectionConfigs: CollectionConfig[],
    sharedRequests: any[], // OverseerrMediaRequest[]
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>,
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    const startTime = Date.now();
    let created = 0;
    let updated = 0;
    const errors: CollectionSyncError[] = [];

    // Filter configs for this source
    const sourceConfigs = this.filterConfigsForSource(collectionConfigs);
    
    if (sourceConfigs.length === 0) {
      return { created: 0, updated: 0 };
    }

    try {
      // Validate source is properly configured
      await this.validateConfiguration();

      // Process each configuration using shared data
      for (let i = 0; i < sourceConfigs.length; i++) {
        const config = sourceConfigs[i];
        
        try {
          // Process individual configuration
          const requests = await this.fetchSourceData(config, options);
          await this.mapSourceDataToItems(requests, config);

          let result: SyncResult;
          switch (config.subtype) {
            case 'users':
              result = await this.processUserCollections(
                config,
                plexClient,
                allCollections,
                processedCollectionKeys,
                options
              );
              break;

            case 'global':
              result = await this.processGlobalCollection(
                config,
                plexClient,
                allCollections,
                processedCollectionKeys
              );
              break;

            case 'server_owner':
              result = await this.processServerOwnerCollection(
                config,
                plexClient,
                allCollections,
                processedCollectionKeys
              );
              break;

            default:
              throw this.createSyncError(
                CollectionSyncErrorType.CONFIGURATION_ERROR,
                `Unsupported Overseerr subtype: ${config.subtype}`
              );
          }

          created += result.created;
          updated += result.updated;
        } catch (error) {
          const syncError = this.createSyncError(
            CollectionSyncErrorType.COLLECTION_ERROR,
            `Failed to process configuration ${config.name}`,
            { configId: config.id, configName: config.name },
            error instanceof Error ? error : new Error(String(error))
          );
          
          errors.push(syncError);
          
          if (options?.onError) {
            options.onError(syncError);
          }

          logger.error(syncError.message, {
            label: `${this.source} Collections`,
            ...syncError.details,
          });
        }
      }

      // Log summary if any changes were made
      if (created > 0 || updated > 0) {
        logger.info(
          `${this.source} collection processing: ${created} created, ${updated} updated`,
          {
            label: `${this.source} Collections`,
            processingTime: Date.now() - startTime,
          }
        );
      }

      return { 
        created, 
        updated, 
        details: { 
          processingTime: Date.now() - startTime,
          errors: errors.length,
        }
      };
    } catch (error) {
      const syncError = this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        `Failed to process ${this.source} collections`,
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      
      logger.error(syncError.message, {
        label: `${this.source} Collections`,
        error: syncError.details,
      });

      return { created: 0, updated: 0, error: syncError.message };
    }
  }

  /**
   * Validate that Overseerr collections can be processed
   */
  protected async validateConfiguration(): Promise<void> {
    // Test if we can get basic data from the service layer
    try {
      await overseerrCollectionService.getAdminUser();
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.DATABASE_ERROR,
        'Cannot access Overseerr data for collections (check connection if using external mode)'
      );
    }
  }

  /**
   * Process a single Overseerr collection configuration
   */
  public async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>,
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    try {
      // Validate configuration
      if (!this.isValidOverseerrConfig(config)) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Invalid Overseerr configuration: ${config.name}`
        );
      }

      // Process based on subtype
      switch (config.subtype) {
        case 'users':
          return await this.processUserCollections(
            config,
            plexClient,
            allCollections,
            processedCollectionKeys,
            options
          );

        case 'global':
          return await this.processGlobalCollection(
            config,
            plexClient,
            allCollections,
            processedCollectionKeys
          );

        case 'server_owner':
          return await this.processServerOwnerCollection(
            config,
            plexClient,
            allCollections,
            processedCollectionKeys
          );

        default:
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            `Unsupported Overseerr subtype: ${config.subtype}`
          );
      }
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process Overseerr collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create template context for Overseerr collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<OverseerrTemplateContext> {
    // For server_owner collections, get the actual server owner user data
    if (config.subtype === 'server_owner') {
      const serverOwner = await this.getServerOwnerUser();
      if (serverOwner) {
        return this.templateEngine.createOverseerrContext(mediaType, serverOwner) as OverseerrTemplateContext;
      }
    }
    
    return this.templateEngine.createOverseerrContext(
      mediaType,
      { displayName: 'User', username: 'user' } // Default user context
    ) as OverseerrTemplateContext;
  }

  /**
   * Fetch data from service layer (approved requests)
   * For performance, this should be called once and shared across all Overseerr collections
   */
  protected async fetchSourceData(
    config: CollectionConfig,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: CollectionSyncOptions
  ): Promise<any[]> { // Return OverseerrMediaRequest[] from service layer
    // Get all approved requests from service layer
    let requests = await overseerrCollectionService.getApprovedRequests();

    // Apply filtering similar to the old database query
    requests = requests.filter(request => {
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
      
      if (!hasValidRatingKey) return false;

      // Apply media type filter if specified
      if (config.mediaType && config.mediaType !== 'both') {
        if (request.type !== config.mediaType) return false;
      }

      return true;
    });

    // Apply user filter for server_owner subtype
    if (config.subtype === 'server_owner') {
      const adminUser = await this.getServerOwnerUser();
      
      if (adminUser) {
        requests = requests.filter(request => 
          request.requestedBy && request.requestedBy.id === adminUser.id
        );
      } else {
        logger.warn('No server owner found for server_owner collection', {
          label: 'Overseerr Collections',
          configName: config.name,
        });
        return [];
      }
    }

    // Sort by creation date (newest first)
    // Note: API data has createdAt as string, convert for comparison
    requests.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA; // Descending (newest first)
    });

    return requests;
  }

  /**
   * Map OverseerrMediaRequest data to standardized collection items
   */
  protected async mapSourceDataToItems(
    sourceData: any[], // OverseerrMediaRequest[] from service layer
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    config: CollectionConfig
  ): Promise<{
    items: OverseerrCollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    const mappedItems: OverseerrCollectionItem[] = [];

    for (const request of sourceData) {
      const ratingKey = request.is4k
        ? request.media?.ratingKey4k
        : request.media?.ratingKey;

      if (!ratingKey || !request.requestedBy) continue;

      mappedItems.push({
        ratingKey: ratingKey.toString(),
        title: request.media?.title || 'Unknown',
        type: request.type as 'movie' | 'tv',
        requestId: request.id,
        userId: request.requestedBy.id,
        tmdbId: request.media?.tmdbId,
      });
    }

    // Don't limit here - apply limits later during collection creation
    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'missing rating key or user': sourceData.length - mappedItems.length,
      }
    );

    return {
      items: mappedItems,
      stats,
      // Overseerr doesn't have missing items (all items are already available)
      missingItems: [],
    };
  }

  /**
   * Create collection in Plex
   */
  protected async createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: any[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>,
    userOverride?: any // Optional user override for user collections (OverseerrUser)
  ): Promise<CollectionOperationResult> {
    try {
      // Use userOverride for user collections, otherwise create context based on subtype
      const userContext = userOverride || await this.createUserContextForSubtype(config);
      const customLabel = this.createLabelForSubtype(config, userContext);


      const result = await this.createOrUpdateCollectionStandardized(
        items,
        collectionName,
        mediaType,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys,
        {
          userId: userContext?.plexId || userContext?.id,
          customLabel
        }
      );

      return {
        created: result.created,
        updated: result.updated,
        collectionRatingKey: result.collectionRatingKey,
        itemCount: result.itemCount || items.length,
        stats: result.stats
      };
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to create Overseerr collection ${collectionName}`,
        { collectionName, itemCount: items.length },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Private methods for handling different subtypes

  private async processUserCollections(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    // Fetch all requests
    const requests = await this.fetchSourceData(config);
    const { items } = await this.mapSourceDataToItems(requests, config);

    // Group by user
    const userCollectionsMap = await this.groupItemsByUser(items as OverseerrCollectionItem[]);

    let totalCreated = 0;
    let totalUpdated = 0;

    // Process each user's collections
    for (const [, userCollections] of Object.entries(userCollectionsMap)) {
      try {
        const result = await this.processUserCollection(
          userCollections,
          config,
          plexClient,
          allCollections,
          processedCollectionKeys
        );

        totalCreated += result.created;
        totalUpdated += result.updated;
      } catch (error) {
        logger.error(
          `Failed to process collection for user ${userCollections.user.displayName}: ${error}`,
          {
            label: 'Overseerr Collections',
            userId: userCollections.user.id,
            userName: userCollections.user.displayName,
          }
        );
      }
    }

    return { created: totalCreated, updated: totalUpdated };
  }

  private async processGlobalCollection(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<SyncResult> {
    // Fetch all requests
    const requests = await this.fetchSourceData(config);
    const { items } = await this.mapSourceDataToItems(requests, config);

    if (items.length === 0) {
      logger.warn('No items for global collection', {
        label: 'Overseerr Collections',
        configName: config.name,
      });
      return { created: 0, updated: 0 };
    }

    // Use the new media type processing strategy
    return await this.processWithMediaTypeStrategy(items, config, plexClient, allCollections, processedCollectionKeys);
  }

  private async processServerOwnerCollection(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<SyncResult> {
    // Just like global collection but filtered to admin user's requests
    const requests = await this.fetchSourceData(config);
    const { items } = await this.mapSourceDataToItems(requests, config);

    if (items.length === 0) {
      logger.warn('No items for server owner collection', {
        label: 'Overseerr Collections',
        configName: config.name,
      });
      return { created: 0, updated: 0 };
    }

    // Use the new media type processing strategy
    return await this.processWithMediaTypeStrategy(items, config, plexClient, allCollections, processedCollectionKeys);
  }

  private async processUserCollection(
    userCollections: UserCollections,
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<SyncResult> {
    let totalCreated = 0;
    let totalUpdated = 0;

    // Split items by media type for user collection processing
    const allItems = [...userCollections.movies, ...userCollections.tv];
    const movieItems = allItems.filter(item => item.type === 'movie');
    const tvItems = allItems.filter(item => item.type === 'tv');

    // Process movies if we have any
    if (movieItems.length > 0) {
      const movieCollectionName = this.createUserCollectionName(
        userCollections.user,
        config,
        'movie'
      );
      const movieResult = await this.createCollection(
        movieItems.slice(0, this.getMaxItems(config)), // Apply item limit
        'movie',
        movieCollectionName,
        plexClient,
        allCollections,
        config,
        processedCollectionKeys,
        userCollections.user // Pass the real user for user collections
      );

      totalCreated += movieResult.created;
      totalUpdated += movieResult.updated;
    }

    // Process TV shows if we have any
    if (tvItems.length > 0) {
      const tvCollectionName = this.createUserCollectionName(
        userCollections.user,
        config,
        'tv'
      );
      const tvResult = await this.createCollection(
        tvItems.slice(0, this.getMaxItems(config)), // Apply item limit
        'tv',
        tvCollectionName,
        plexClient,
        allCollections,
        config,
        processedCollectionKeys,
        userCollections.user // Pass the real user for user collections
      );

      totalCreated += tvResult.created;
      totalUpdated += tvResult.updated;
    }

    return { created: totalCreated, updated: totalUpdated };
  }


  // Helper methods

  private isValidOverseerrConfig(config: CollectionConfig): boolean {
    return (
      config.type === 'overseerr' &&
      ['users', 'global', 'server_owner'].includes(config.subtype || '')
    );
  }

  private async groupItemsByUser(items: OverseerrCollectionItem[]): Promise<UserCollectionsMap> {
    const userCollectionsMap: UserCollectionsMap = {};

    // Get unique user IDs
    const userIds = [...new Set(items.map(item => item.userId))];
    
    // Get users from service layer (will handle both internal and external modes)
    const allUsers = await overseerrCollectionService.getUsersWithPlexIds();
    
    // Create map for efficient lookup
    const usersById = new Map(allUsers.map(user => [user.id, user]));

    for (const item of items) {
      if (!userCollectionsMap[item.userId]) {
        const user = usersById.get(item.userId);
        if (!user) {
          // Skip items for users that don't exist
          continue;
        }
        
        userCollectionsMap[item.userId] = {
          user: user as any, // Convert OverseerrUser to User interface
          movies: [],
          tv: [],
        };
      }

      const userCollections = userCollectionsMap[item.userId];
      if (item.type === 'movie') {
        userCollections.movies.push(item);
      } else {
        userCollections.tv.push(item);
      }
    }

    return userCollectionsMap;
  }

  private createUserCollectionName(
    user: any, // OverseerrUser from service layer
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): string {
    const context = this.templateEngine.createOverseerrContext(
      mediaType,
      user
    );

    // Use custom templates if available, similar to other collection sync types
    const template = mediaType === 'movie' 
      ? (config.customMovieTemplate || config.template || config.name)
      : (config.customTVTemplate || config.template || config.name);

    return this.templateEngine.processTemplate(template, context);
  }

  private createServerOwnerCollectionName(
    user: any, // OverseerrUser from service layer
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): string {
    // Same logic as user collections - server owner is just a special user
    return this.createUserCollectionName(user, config, mediaType);
  }

  private async createUserContextForSubtype(config: CollectionConfig): Promise<any> {
    switch (config.subtype) {
      case 'global':
        return {
          id: -1,
          plexId: null,
          plexTitle: 'Everyone',
          displayName: 'Everyone',
          username: 'global',
          email: 'global@overseerr',
        };

      case 'server_owner':
        // For server owner, get the actual admin user with real plexId
        const serverOwner = await this.getServerOwnerUser();
        if (serverOwner) {
          return serverOwner;
        }
        // Fallback if admin user not found
        return {
          id: 1,
          plexId: null,
          displayName: 'Server Owner',
          username: 'admin',
          email: 'admin@overseerr',
        };

      case 'users':
      default:
        // For user collections, this will be overridden with actual user data
        return {
          id: 0,
          displayName: 'User',
          username: 'user',
          email: 'user@overseerr',
        };
    }
  }

  private createLabelForSubtype(config: CollectionConfig, user: any): string {
    switch (config.subtype) {
      case 'global':
        return `AgregarrOverseerrAll${config.id}`;
      case 'server_owner':
        return `AgregarrOverseerrOwner${user.plexId || user.id}`;
      case 'users':
        return `AgregarrOverseerrUser${user.plexId || user.id}`;
      default:
        return `AgregarrOverseerrAll${config.id}`;
    }
  }

  private async getServerOwnerUser(): Promise<any | null> { // Returns OverseerrUser from service layer
    // Get admin user from service layer (already has all necessary fields)
    return await overseerrCollectionService.getAdminUser();
  }
}

// Export the new implementation
export default OverseerrCollectionSync;