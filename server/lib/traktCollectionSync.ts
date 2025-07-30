import type PlexAPI from '@server/api/plexapi';
import type {
  TraktListResponse,
  TraktPopularResponse,
  TraktTrendingResponse,
  TraktWatchedResponse,
} from '@server/api/trakt';
import TraktAPI from '@server/api/trakt';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { createOrUpdateCollection } from '@server/lib/collectionsUtils';
import { getSettings, type CollectionConfig } from '@server/lib/settings';
import { extractErrorMessage } from '@server/lib/utils/templateUtils';
import logger from '@server/logger';

interface TraktCollectionItem {
  ratingKey: string;
  title: string;
  tmdbId: number;
  type: 'movie' | 'tv';
}

class TraktCollectionSync {
  private traktClients: Map<string, TraktAPI> = new Map();

  private getTraktClient(apiKey: string): TraktAPI {
    if (!this.traktClients.has(apiKey)) {
      this.traktClients.set(apiKey, new TraktAPI(apiKey));
    }
    return this.traktClients.get(apiKey)!;
  }

  public async processTraktCollections(
    collectionConfigs: CollectionConfig[],
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    const traktConfigs = collectionConfigs.filter(
      (config) => config.type === 'trakt'
    );

    // Get global Trakt API key
    const settings = getSettings();
    const traktApiKey = settings.trakt.apiKey;

    if (!traktApiKey || traktConfigs.length === 0) {
      return { created: 0, updated: 0 };
    }

    for (const config of traktConfigs) {
      try {
        const result = await this.processTraktCollection(
          config,
          traktApiKey,
          plexClient,
          allCollections,
          processedCollectionKeys
        );
        created += result.created;
        updated += result.updated;
      } catch (error) {
        logger.error(
          `Failed to process Trakt collection ${config.name}: ${error}`,
          {
            label: 'Trakt Collections',
            config: config.name,
          }
        );
      }
    }

    if (created > 0 || updated > 0) {
      logger.info(
        `Trakt collection processing: ${created} created, ${updated} updated`,
        {
          label: 'Trakt Collections',
        }
      );
    }

    return { created, updated };
  }

  private async processTraktCollection(
    config: CollectionConfig,
    traktApiKey: string,
    plexClient: PlexAPI,
    allCollections: any[],
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    const traktClient = this.getTraktClient(traktApiKey);

    try {
      const traktData: any[] = [];

      // Extract stat type from subtype (e.g., "trending_7_days" -> "trending")
      const statType = config.subtype.split('_')[0];

      // Fetch data based on collection type
      switch (statType) {
        case 'trending':
          if (config.mediaType === 'movie' || config.mediaType === 'both') {
            const movieData = await traktClient.getTrending(
              'movies',
              config.maxItems
            );
            traktData.push(...movieData);
          }
          if (config.mediaType === 'tv' || config.mediaType === 'both') {
            const showData = await traktClient.getTrending(
              'shows',
              config.maxItems
            );
            traktData.push(...showData);
          }
          break;

        case 'popular':
          if (config.mediaType === 'movie' || config.mediaType === 'both') {
            const movieData = await traktClient.getPopular(
              'movies',
              config.maxItems
            );
            traktData.push(...movieData);
          }
          if (config.mediaType === 'tv' || config.mediaType === 'both') {
            const showData = await traktClient.getPopular(
              'shows',
              config.maxItems
            );
            traktData.push(...showData);
          }
          break;

        case 'watched': {
          const period = config.period === 'month' ? 'monthly' : 'weekly';
          if (config.mediaType === 'movie' || config.mediaType === 'both') {
            const movieData = await traktClient.getWatched(
              'movies',
              period,
              config.maxItems
            );
            traktData.push(...movieData);
          }
          if (config.mediaType === 'tv' || config.mediaType === 'both') {
            const showData = await traktClient.getWatched(
              'shows',
              period,
              config.maxItems
            );
            traktData.push(...showData);
          }
          break;
        }

        case 'custom': {
          if (!config.traktCustomListUrl) {
            throw new Error(
              'Custom Trakt list URL is required for custom list collections'
            );
          }

          let customListData = await traktClient.getCustomList(
            config.traktCustomListUrl,
            config.maxItems
          );

          // Apply reverse order if specified
          if (config.traktReverseOrder) {
            customListData = customListData.reverse();
          }

          // Filter by media type if specified
          if (config.mediaType && config.mediaType !== 'both') {
            const targetType = config.mediaType === 'movie' ? 'movie' : 'show';
            customListData = customListData.filter(
              (item) =>
                (item.movie && targetType === 'movie') ||
                (item.show && targetType === 'show')
            );
          }

          traktData.push(...customListData);
          break;
        }

        default:
          throw new Error(
            `Unknown Trakt stat type: ${statType} (from subtype: ${config.subtype})`
          );
      }

      // Map Trakt data to Plex items
      const { plexItems, missingItems } = await this.mapTraktToPlexItems(
        traktData
      );

      // If auto-request is enabled for movies or TV, create requests for missing items
      if (
        (config.searchMissingMovies || config.searchMissingTV) &&
        missingItems.length > 0
      ) {
        try {
          await this.createRequestsForMissingItems(missingItems, config);
        } catch (error) {
          logger.error(
            `Failed to create requests for missing Trakt items in collection ${config.name}: ${error}`,
            {
              label: 'Trakt Collections',
            }
          );
        }
      }

      if (plexItems.length === 0) {
        logger.info(
          `No matching Plex content found for Trakt collection: ${config.name}`,
          {
            label: 'Trakt Collections',
          }
        );
        return { created: 0, updated: 0 };
      }

      // Split by media type for separate collections
      const movieItems = plexItems.filter(
        (item: TraktCollectionItem) => item.type === 'movie'
      );
      const tvItems = plexItems.filter(
        (item: TraktCollectionItem) => item.type === 'tv'
      );

      let created = 0;
      let updated = 0;

      if (
        movieItems.length > 0 &&
        (config.mediaType === 'movie' || config.mediaType === 'both')
      ) {
        const movieTemplate =
          config.mediaType === 'both' && config.customMovieTemplate
            ? config.customMovieTemplate
            : config.template || config.name;

        const movieResult = await this.createTraktCollection(
          movieItems,
          'movie',
          movieTemplate,
          plexClient,
          allCollections,
          config.id,
          processedCollectionKeys
        );
        created += movieResult.created;
        updated += movieResult.updated;
      }

      if (
        tvItems.length > 0 &&
        (config.mediaType === 'tv' || config.mediaType === 'both')
      ) {
        const tvTemplate =
          config.mediaType === 'both' && config.customTVTemplate
            ? config.customTVTemplate
            : config.template || config.name;

        const tvResult = await this.createTraktCollection(
          tvItems,
          'tv',
          tvTemplate,
          plexClient,
          allCollections,
          config.id,
          processedCollectionKeys
        );
        created += tvResult.created;
        updated += tvResult.updated;
      }

      return { created, updated };
    } catch (error) {
      logger.error(
        `Failed to process Trakt collection ${config.name}: ${error}`,
        {
          label: 'Trakt Collections',
        }
      );
      return { created: 0, updated: 0 };
    }
  }

  private async mapTraktToPlexItems(
    traktData: (
      | TraktTrendingResponse
      | TraktPopularResponse
      | TraktWatchedResponse
      | TraktListResponse
    )[]
  ): Promise<{
    plexItems: TraktCollectionItem[];
    missingItems: {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      title: string;
    }[];
  }> {
    const mediaRepository = getRepository(Media);
    const plexItems: TraktCollectionItem[] = [];
    const missingItems: {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      title: string;
    }[] = [];

    for (const item of traktData) {
      try {
        const mediaItem = item.movie || item.show;
        if (!mediaItem?.ids?.tmdb) continue;

        const tmdbId = mediaItem.ids.tmdb;
        const mediaType = item.movie ? 'movie' : 'tv';

        // Find corresponding media in Overseerr database
        const media = (await mediaRepository.findOne({
          where: {
            tmdbId,
            mediaType: mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
          },
        })) as Media | null;

        if (media?.ratingKey) {
          plexItems.push({
            ratingKey: media.ratingKey,
            title: mediaItem.title,
            tmdbId,
            type: mediaType,
          });
        } else {
          // Item exists in Trakt but not in Plex/Overseerr
          missingItems.push({
            tmdbId,
            mediaType,
            title: mediaItem.title,
          });
        }
      } catch (error) {
        logger.warn(`Failed to map Trakt item to Plex: ${error}`, {
          label: 'Trakt Collections',
        });
      }
    }

    return { plexItems, missingItems };
  }

  /**
   * Create or get virtual service user for auto-approved requests
   */
  private async getOrCreateAutoApproveServiceUser(): Promise<User> {
    const userRepository = getRepository(User);

    const serviceUsername = 'TraktCollectionsAutoApproval';
    const displayName = 'TraktCollectionsAutoApproval';
    const email = 'donotchangeme@auto.traktcollections';

    let serviceUser = await userRepository.findOne({
      where: { email },
    });

    if (!serviceUser) {
      serviceUser = new User({
        email,
        username: serviceUsername,
        displayName,
        plexUsername: serviceUsername,
        plexTitle: displayName,
        // Service user with auto-approve permissions
        permissions: 6, // REQUEST + AUTO_APPROVE permissions (2 + 4 = 6)
        userType: 1, // LOCAL user type
        avatar: '/trakt-logo.svg',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await userRepository.save(serviceUser);

      logger.info(`Created virtual auto-approve service user: ${displayName}`, {
        label: 'Trakt Collections',
        serviceUser: serviceUsername,
      });
    }

    return serviceUser;
  }

  /**
   * Create or get virtual service user for manual approval requests
   */
  private async getOrCreateManualApprovalServiceUser(): Promise<User> {
    const userRepository = getRepository(User);

    const serviceUsername = 'TraktCollectionsManualApproval';
    const displayName = 'TraktCollectionsManualApproval';
    const email = 'donotchangeme@manual.traktcollections';

    let serviceUser = await userRepository.findOne({
      where: { email },
    });

    if (!serviceUser) {
      serviceUser = new User({
        email,
        username: serviceUsername,
        displayName,
        plexUsername: serviceUsername,
        plexTitle: displayName,
        // Service user with only request permissions (no auto-approve)
        permissions: 2, // REQUEST permission only
        userType: 1, // LOCAL user type
        avatar: '/trakt-logo.svg',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await userRepository.save(serviceUser);

      logger.info(
        `Created virtual manual approval service user: ${displayName}`,
        {
          label: 'Trakt Collections',
          serviceUser: serviceUsername,
        }
      );
    }

    return serviceUser;
  }

  /**
   * Get TV show season count from TMDB
   */
  private async getTvSeasonCount(tmdbId: number): Promise<number> {
    try {
      const tmdb = new (await import('@server/api/themoviedb')).default();
      const tvShow = await tmdb.getTvShow({ tvId: tmdbId });
      // Filter out season 0 (specials) when counting
      return (
        tvShow.seasons?.filter((season) => season.season_number > 0).length || 1
      );
    } catch (error) {
      logger.warn(
        `Failed to get season count for TMDB ID ${tmdbId}, assuming 1 season`,
        {
          label: 'Trakt Collections',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return 1; // Default to 1 season if we can't determine
    }
  }

  /**
   * Check if a high-season TV show request was previously declined by admin
   * (checks for declined requests from any Trakt service user)
   */
  private async wasHighSeasonRequestDeclined(tmdbId: number): Promise<boolean> {
    try {
      const requestRepository = getRepository(MediaRequest);
      const manualApprovalUser =
        await this.getOrCreateManualApprovalServiceUser();

      const existingDeclinedRequest = await requestRepository
        .createQueryBuilder('request')
        .leftJoin('request.media', 'media')
        .leftJoin('request.requestedBy', 'user')
        .where('request.is4k = :is4k', { is4k: false })
        .andWhere('media.tmdbId = :tmdbId', { tmdbId })
        .andWhere('media.mediaType = :mediaType', { mediaType: MediaType.TV })
        .andWhere('user.id = :userId', { userId: manualApprovalUser.id })
        .andWhere('request.status = :declined', {
          declined: MediaRequestStatus.DECLINED,
        })
        .getOne();

      return !!existingDeclinedRequest;
    } catch (error) {
      logger.warn(`Failed to check declined status for TMDB ID ${tmdbId}`, {
        label: 'Trakt Collections',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false; // If we can't check, allow the request
    }
  }

  /**
   * Create requests for missing items using the virtual service user
   */
  private async createRequestsForMissingItems(
    missingItems: {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      title: string;
    }[],
    config: CollectionConfig
  ): Promise<void> {
    // Filter items based on config settings
    const movieItems = missingItems.filter(
      (item) => item.mediaType === 'movie' && config.searchMissingMovies
    );
    const tvItems = missingItems.filter(
      (item) => item.mediaType === 'tv' && config.searchMissingTV
    );

    const filteredItems = [...movieItems, ...tvItems];
    if (filteredItems.length === 0) {
      return; // Nothing to process
    }

    // Pre-check for existing requests to avoid duplicate attempts
    const { itemsToRequest, existingRequests } =
      await this.filterExistingRequests(filteredItems);

    if (itemsToRequest.length === 0) {
      if (existingRequests.length > 0) {
        logger.info(
          `Trakt collection auto-requests: ${existingRequests.length} already requested for ${config.name}`,
          {
            label: 'Trakt Collections',
          }
        );
      }
      return;
    }

    // Get service users
    const autoApproveServiceUser =
      await this.getOrCreateAutoApproveServiceUser();
    const manualApprovalServiceUser =
      await this.getOrCreateManualApprovalServiceUser();

    let autoApprovedRequests = 0;
    let manualApprovalRequests = 0;
    let skippedRequests = 0;
    const maxSeasons = config.maxSeasonsToRequest || 3;

    for (const item of itemsToRequest) {
      try {
        let serviceUserToUse = manualApprovalServiceUser; // Default to manual approval
        let requestType = 'manual-approval';

        // Determine service user based on media type and auto-approve settings
        if (item.mediaType === 'movie' && config.autoApproveMovies) {
          serviceUserToUse = autoApproveServiceUser;
          requestType = 'auto-approved';
        } else if (item.mediaType === 'tv' && config.autoApproveTV) {
          // For TV shows, check season count if auto-approve is enabled
          const seasonCount = await this.getTvSeasonCount(item.tmdbId);

          if (seasonCount > maxSeasons) {
            // Check if previously declined
            if (await this.wasHighSeasonRequestDeclined(item.tmdbId)) {
              logger.debug(
                `Skipping ${item.title}: Previously declined high-season TV show (${seasonCount} seasons)`,
                {
                  label: 'Trakt Collections',
                  collection: config.name,
                }
              );
              skippedRequests++;
              continue;
            }

            // Use manual approval for high-season shows
            serviceUserToUse = manualApprovalServiceUser;
            requestType = 'manual-approval (>max seasons)';
          } else {
            // Auto-approve TV shows within season limit
            serviceUserToUse = autoApproveServiceUser;
            requestType = 'auto-approved';
          }
        }

        // Create the request
        await MediaRequest.request(
          {
            mediaId: item.tmdbId,
            mediaType:
              item.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
            seasons: item.mediaType === 'tv' ? 'all' : undefined,
            is4k: false,
          },
          serviceUserToUse,
          { isAutoRequest: true }
        );

        if (requestType === 'auto-approved') {
          autoApprovedRequests++;
        } else {
          manualApprovalRequests++;
        }

        logger.debug(
          `Created ${requestType} request for ${item.mediaType}: ${item.title} (TMDB: ${item.tmdbId})`,
          {
            label: 'Trakt Collections',
            serviceUser: serviceUserToUse.displayName,
            collection: config.name,
          }
        );
      } catch (error) {
        logger.warn(`Failed to create request for ${item.title}: ${error}`, {
          label: 'Trakt Collections',
          tmdbId: item.tmdbId,
          mediaType: item.mediaType,
        });
      }
    }

    // Log summary of results
    const parts = [];
    if (autoApprovedRequests > 0) {
      parts.push(`${autoApprovedRequests} auto-approved`);
    }
    if (manualApprovalRequests > 0) {
      parts.push(`${manualApprovalRequests} pending admin approval`);
    }
    if (existingRequests.length > 0) {
      parts.push(`${existingRequests.length} already requested`);
    }
    if (skippedRequests > 0) {
      parts.push(`${skippedRequests} skipped (previously declined)`);
    }

    if (parts.length > 0) {
      logger.info(
        `Trakt collection auto-requests: ${parts.join(', ')} for ${
          config.name
        }`,
        {
          label: 'Trakt Collections',
        }
      );
    }
  }

  /**
   * Filter out items that already have requests to avoid duplicate attempts
   */
  private async filterExistingRequests(
    missingItems: { tmdbId: number; mediaType: 'movie' | 'tv'; title: string }[]
  ): Promise<{
    itemsToRequest: {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      title: string;
    }[];
    existingRequests: {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      title: string;
    }[];
  }> {
    const requestRepository = getRepository(MediaRequest);
    const itemsToRequest = [];
    const existingRequests = [];

    for (const item of missingItems) {
      // Check if a request already exists for this media
      const existing = await requestRepository
        .createQueryBuilder('request')
        .leftJoin('request.media', 'media')
        .where('request.is4k = :is4k', { is4k: false })
        .andWhere('media.tmdbId = :tmdbId', { tmdbId: item.tmdbId })
        .andWhere('media.mediaType = :mediaType', {
          mediaType:
            item.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
        })
        .andWhere('request.status != :declined', {
          declined: MediaRequestStatus.DECLINED,
        })
        .andWhere('request.status != :completed', {
          completed: MediaRequestStatus.COMPLETED,
        })
        .getOne();

      if (existing) {
        existingRequests.push(item);
      } else {
        itemsToRequest.push(item);
      }
    }

    return { itemsToRequest, existingRequests };
  }

  private async createTraktCollection(
    items: TraktCollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: any[],
    configId: number,
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    try {
      // Create a fake user object for Trakt collections
      const traktUser = {
        id: 0,
        plexId: null,
        displayName: 'Trakt',
        plexUsername: 'trakt',
        plexTitle: 'Trakt',
        username: 'trakt',
        email: 'trakt@overseerr',
      } as any;

      const finalCollectionName = await this.replaceTemplatePlaceholders(
        collectionName,
        mediaType,
        configId
      );

      const result = await createOrUpdateCollection(
        traktUser,
        items,
        mediaType,
        plexClient,
        allCollections,
        finalCollectionName,
        'shared', // Visible to all users
        true, // isTraktCollection
        `OverseerrTrakt${configId}`, // Custom label for this specific Trakt collection
        processedCollectionKeys // Now properly track Trakt collection deletions
      );

      return {
        created: result.isNew ? 1 : 0,
        updated: result.hasChanges && !result.isNew ? 1 : 0,
      };
    } catch (error) {
      logger.error(
        `Failed to create Trakt collection ${collectionName}: ${extractErrorMessage(
          error
        )}`,
        {
          label: 'Trakt Collections',
        }
      );
      return { created: 0, updated: 0 };
    }
  }

  /**
   * Replace template placeholders in collection names
   */
  private async replaceTemplatePlaceholders(
    template: string,
    mediaType: 'movie' | 'tv',
    configId: number
  ): Promise<string> {
    const settings = getSettings();
    const serverName = settings.plex.name || 'Plex Server';

    // Get the config to extract proper subtype label
    const config = settings.plex.collectionConfigs?.find(
      (c) => c.id === configId
    );
    const subtypeLabel = this.getSubtypeLabel(config?.subtype || '');

    return template
      .replace('{mediaType}', mediaType === 'movie' ? 'Movies' : 'TV Shows')
      .replace('{servername}', serverName)
      .replace('{subtype}', subtypeLabel)
      .replace('{customdays}', '30') // Default for Trakt
      .replace('{days}', '30'); // Fallback
  }

  /**
   * Get human-readable label for Trakt subtype
   */
  private getSubtypeLabel(subtype: string): string {
    switch (subtype) {
      case 'trending_7_days':
        return 'Trending Last 7 Days';
      case 'trending_30_days':
        return 'Trending Last 30 Days';
      case 'popular_week':
        return 'Popular This Week';
      case 'popular_month':
        return 'Popular This Month';
      case 'most_watched_week':
        return 'Most Watched This Week';
      case 'custom_list':
        return 'Custom List';
      default:
        return subtype
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
    }
  }
}

export default TraktCollectionSync;
