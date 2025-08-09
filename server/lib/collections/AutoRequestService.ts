import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { MediaType, MediaRequestStatus } from '@server/constants/media';
import logger from '@server/logger';
import type { CollectionConfig } from '@server/lib/settings';
import type { MissingItem, AutoRequestResult } from './types';
import type { ServiceUserConfig } from './ServiceUserManager';
import { ServiceUserManager, SERVICE_USER_CONFIGS } from './ServiceUserManager';
import { COLLECTION_LIMITS } from './ConfigurationConstants';

/**
 * Shared auto-request service for all collection sync implementations
 * 
 * Handles the common auto-request functionality that can be reused across
 * different collection sources (Trakt, TMDb, IMDb, etc.)
 */
export class AutoRequestService {
  private serviceUserManager: ServiceUserManager;

  constructor() {
    this.serviceUserManager = new ServiceUserManager();
  }

  /**
   * Process auto-requests for missing items from any collection source
   * 
   * @param missingItems - Items that are missing from Plex
   * @param config - Collection configuration with auto-request settings
   * @param source - Source type for logging and service user selection
   * @returns Promise with auto-request results
   */
  public async processAutoRequests(
    missingItems: MissingItem[],
    config: CollectionConfig,
    source: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd'
  ): Promise<AutoRequestResult> {
    // Only proceed if auto-request is enabled
    if (!config.searchMissingMovies && !config.searchMissingTV) {
      return {
        autoApproved: 0,
        manualApproval: 0,
        alreadyRequested: 0,
        skipped: 0,
        total: 0,
      };
    }

    // Filter items based on config settings
    const filteredMissingItems = missingItems.filter(item => {
      if (item.mediaType === 'movie' && config.searchMissingMovies) return true;
      if (item.mediaType === 'tv' && config.searchMissingTV) return true;
      return false;
    });

    if (filteredMissingItems.length === 0) {
      return {
        autoApproved: 0,
        manualApproval: 0,
        alreadyRequested: 0,
        skipped: 0,
        total: 0,
      };
    }

    try {
      // Get service users based on source
      const serviceUserConfigs = this.getServiceUserConfigs(source);
      if (!serviceUserConfigs) {
        logger.error(`No service user configs found for source: ${source}`, {
          label: 'Auto Request Service',
          source,
        });
        return {
          autoApproved: 0,
          manualApproval: 0,
          alreadyRequested: 0,
          skipped: 0,
          total: 0,
        };
      }
      
      const autoApproveServiceUser = await this.serviceUserManager.getOrCreateServiceUser(
        serviceUserConfigs.autoApprove
      );
      const manualApprovalServiceUser = await this.serviceUserManager.getOrCreateServiceUser(
        serviceUserConfigs.manualApproval
      );

      let autoApprovedRequests = 0;
      let manualApprovalRequests = 0;
      let alreadyRequestedCount = 0;
      let skippedRequests = 0;
      const maxSeasons = config.maxSeasonsToRequest || COLLECTION_LIMITS.AUTO_REQUEST.MAX_SEASONS;

      for (const item of filteredMissingItems) {
        try {
          // Check if request already exists
          const existingRequest = await this.checkExistingRequest(item.tmdbId, item.mediaType);
          if (existingRequest) {
            alreadyRequestedCount++;
            continue;
          }

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
              if (await this.wasHighSeasonRequestDeclined(item.tmdbId, serviceUserConfigs.manualApproval)) {
                logger.debug(
                  `Skipping ${item.title}: Previously declined high-season TV show (${seasonCount} seasons)`,
                  {
                    label: `${source.charAt(0).toUpperCase() + source.slice(1)} Collections`,
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

          // Create the actual request
          await MediaRequest.request(
            {
              mediaId: item.tmdbId,
              mediaType: item.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
              seasons: item.mediaType === 'tv' ? 'all' : undefined,
              is4k: false,
            },
            serviceUserToUse,
            { isAutoRequest: true }
          );

          if (requestType.includes('auto-approved')) {
            autoApprovedRequests++;
          } else {
            manualApprovalRequests++;
          }

          logger.debug(
            `Created ${requestType} request for ${item.mediaType}: ${item.title} (TMDB: ${item.tmdbId})`,
            { 
              label: `${source.charAt(0).toUpperCase() + source.slice(1)} Collections`, 
              config: config.name 
            }
          );
        } catch (error) {
          logger.warn(
            `Failed to create auto-request for ${item.title}: ${error}`,
            { label: `${source.charAt(0).toUpperCase() + source.slice(1)} Collections` }
          );
        }
      }

      const totalRequests = autoApprovedRequests + manualApprovalRequests;
      if (totalRequests > 0) {
        logger.info(
          `${source.charAt(0).toUpperCase() + source.slice(1)} collection auto-requests created for ${config.name}: ${autoApprovedRequests} auto-approved, ${manualApprovalRequests} manual approval${skippedRequests > 0 ? `, ${skippedRequests} skipped` : ''}`,
          { label: `${source.charAt(0).toUpperCase() + source.slice(1)} Collections` }
        );
      }

      return {
        autoApproved: autoApprovedRequests,
        manualApproval: manualApprovalRequests,
        alreadyRequested: alreadyRequestedCount,
        skipped: skippedRequests,
        total: filteredMissingItems.length,
      };
    } catch (error) {
      logger.error(
        `Failed to handle auto-requests for ${source} collection ${config.name}: ${error}`,
        { label: `${source.charAt(0).toUpperCase() + source.slice(1)} Collections` }
      );
      throw error;
    }
  }

  /**
   * Get service user configurations for a specific source
   */
  private getServiceUserConfigs(source: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd') {
    switch (source) {
      case 'trakt':
        return {
          autoApprove: SERVICE_USER_CONFIGS.TRAKT_AUTO_APPROVE,
          manualApproval: SERVICE_USER_CONFIGS.TRAKT_MANUAL_APPROVAL,
        };
      case 'tmdb':
        return {
          autoApprove: SERVICE_USER_CONFIGS.TMDB_AUTO_APPROVE,
          manualApproval: SERVICE_USER_CONFIGS.TMDB_MANUAL_APPROVAL,
        };
      case 'imdb':
        return {
          autoApprove: SERVICE_USER_CONFIGS.IMDB_AUTO_APPROVE,
          manualApproval: SERVICE_USER_CONFIGS.IMDB_MANUAL_APPROVAL,
        };
      case 'letterboxd':
        return {
          autoApprove: SERVICE_USER_CONFIGS.LETTERBOXD_AUTO_APPROVE,
          manualApproval: SERVICE_USER_CONFIGS.LETTERBOXD_MANUAL_APPROVAL,
        };
      default:
        logger.error(`Unknown collection source: ${source}`, {
          label: 'Auto Request Service',
          source,
        });
        return;
    }
  }

  /**
   * Check if a request already exists for the given media
   */
  private async checkExistingRequest(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<boolean> {
    try {
      const requestRepository = getRepository(MediaRequest);
      const existingRequest = await requestRepository
        .createQueryBuilder('request')
        .leftJoin('request.media', 'media')
        .where('media.tmdbId = :tmdbId', { tmdbId })
        .andWhere('media.mediaType = :mediaType', { 
          mediaType: mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV 
        })
        .andWhere('request.status != :declined', { declined: MediaRequestStatus.DECLINED })
        .getOne();

      return !!existingRequest;
    } catch (error) {
      logger.warn(`Failed to check existing request for TMDB ID ${tmdbId}`, {
        label: 'Auto Request Service',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Get the number of seasons for a TV show
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
          label: 'Auto Request Service',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return 1; // Default to 1 season if we can't determine
    }
  }

  /**
   * Check if a high-season request was previously declined by the service user
   */
  private async wasHighSeasonRequestDeclined(
    tmdbId: number, 
    serviceUserConfig: ServiceUserConfig
  ): Promise<boolean> {
    try {
      const requestRepository = getRepository(MediaRequest);
      const serviceUser = await this.serviceUserManager.getOrCreateServiceUser(serviceUserConfig);

      const existingDeclinedRequest = await requestRepository
        .createQueryBuilder('request')
        .leftJoin('request.media', 'media')
        .leftJoin('request.requestedBy', 'user')
        .where('request.is4k = :is4k', { is4k: false })
        .andWhere('media.tmdbId = :tmdbId', { tmdbId })
        .andWhere('media.mediaType = :mediaType', { mediaType: MediaType.TV })
        .andWhere('user.id = :userId', { userId: serviceUser.id })
        .andWhere('request.status = :declined', {
          declined: MediaRequestStatus.DECLINED,
        })
        .getOne();

      return !!existingDeclinedRequest;
    } catch (error) {
      logger.warn(`Failed to check declined status for TMDB ID ${tmdbId}`, {
        label: 'Auto Request Service',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false; // If we can't check, allow the request
    }
  }
}

// Export singleton instance
export const autoRequestService = new AutoRequestService();