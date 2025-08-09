import { updateUserFilterSettings } from '@server/lib/collectionsUtils';
import { overseerrCollectionService } from './OverseerrCollectionService';
import PlexTvAPI from '@server/api/plextv';
import { extractErrorMessage } from '@server/lib/utils/templateUtils';
import { getSettings, type CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

interface UserCollections {
  [userId: string]: {
    movies: { ratingKey: string; type?: string; }[];
    tv: { ratingKey: string; type?: string; }[];
    user: any;
  };
}

/**
 * Service for managing user filters and privacy settings for collections
 */
export class UserFilterManager {
  private cancelled = false;

  public cancel(): void {
    this.cancelled = true;
  }

  /**
   * Update plexTitle for users who have null values (needed for nickname support)
   */
  public async updateMissingUserTitles(userCollections: UserCollections): Promise<void> {
    if (this.cancelled) return;

    const usersNeedingUpdate: any[] = [];

    // Find users missing plexTitle
    for (const userPlexId of Object.keys(userCollections)) {
      const user = userCollections[userPlexId].user;
      if (!user.plexTitle) {
        usersNeedingUpdate.push(user);
      }
    }

    if (usersNeedingUpdate.length === 0) {
      return;
    }

    try {
      // Get admin user for Plex API access
      const mainUser = await overseerrCollectionService.getAdminUser();
      if (!mainUser || !(mainUser as any).plexToken) {
        throw new Error('Admin user with Plex token not found');
      }

      const plexTv = new PlexTvAPI((mainUser as any).plexToken ?? '');
      const plexUsersResponse = await plexTv.getUsers();

      const usersToUpdate: any[] = [];

      for (const user of usersNeedingUpdate) {
        if (this.cancelled) break;

        try {
          // Find the user in Plex API response
          const plexAccount = plexUsersResponse.MediaContainer.User.find(
            (rawUser) => rawUser.$.id === user.plexId?.toString()
          )?.$;

          if (plexAccount?.title) {
            user.plexTitle = plexAccount.title;
            usersToUpdate.push(user);
          }
        } catch (error) {
          logger.warn(
            `Failed to update plexTitle for user ${user.plexId} (${user.plexUsername}): ${error}`,
            {
              label: 'User Filter Manager',
            }
          );
        }
      }

      // Batch save all user updates using service layer
      let updatedCount = 0;
      if (usersToUpdate.length > 0) {
        try {
          updatedCount = await overseerrCollectionService.updateSpecificUsers(usersToUpdate);
          if (updatedCount === 0) {
            logger.warn('User updates skipped (external mode is read-only)', {
              label: 'User Filter Manager',
              userCount: usersToUpdate.length,
            });
          }
        } catch (error) {
          const errorMessage = extractErrorMessage(error);
          logger.error('Failed to update user titles', {
            label: 'User Filter Manager',
            errorMessage,
          });
        }
      }

      if (updatedCount < usersNeedingUpdate.length) {
        logger.warn(
          `Failed to update plexTitle for ${usersNeedingUpdate.length - updatedCount} users`,
          {
            label: 'User Filter Manager',
          }
        );
      }
    } catch (error) {
      logger.error(`Error updating user titles: ${error}`, {
        label: 'User Filter Manager',
      });
    }
  }

  /**
   * Update user filters BEFORE creating collections (privacy-first approach)
   */
  public async updateUserFiltersForActiveUsers(userCollections: UserCollections): Promise<void> {
    if (this.cancelled) return;

    const userPlexIds = Object.keys(userCollections);
    
    // Check if server owner collections are configured
    const settings = getSettings();
    const hasServerOwnerCollections = settings.plex.collectionConfigs?.some(
      (config: CollectionConfig) => config.type === 'overseerr' && config.subtype === 'server_owner'
    );
    
    // If server owner collections exist, we need to update ALL users' filters, not just active users
    let usersToUpdate: string[] = userPlexIds;
    
    if (hasServerOwnerCollections) {
      // Get all users with Plex IDs to ensure server owner collections are hidden from everyone
      const { getUsersWithPlexIds } = await import('@server/lib/collectionsUtils');
      const allUsers = await getUsersWithPlexIds();
      const allUserPlexIds = allUsers.map(user => user.plexId!.toString()).filter(Boolean);
      
      // Use all users when server owner collections exist
      usersToUpdate = allUserPlexIds;
      
      logger.debug(`Server owner collections detected - updating filters for all ${allUserPlexIds.length} users (not just ${userPlexIds.length} active users)`, {
        label: 'User Filter Manager',
        allUsersCount: allUserPlexIds.length,
        activeUsersCount: userPlexIds.length
      });
    }

    let failureCount = 0;

    // activeUserPlexIds should only contain users who have USER collections (not server owner)
    const activeUserPlexIds = userPlexIds;
    
    if (hasServerOwnerCollections) {
      logger.debug(`Server owner collections exist - user filters will restrict OverseerrOwner collections automatically`, {
        label: 'User Filter Manager',
        activeUserCount: activeUserPlexIds.length
      });
    }

    for (const userPlexId of usersToUpdate) {
      if (this.cancelled) break;

      try {
        await updateUserFilterSettings(userPlexId, activeUserPlexIds);
      } catch (error) {
        failureCount++;
        logger.warn(`Failed to update filter for user ${userPlexId}`, {
          label: 'User Filter Manager',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    if (failureCount > 0) {
      logger.warn(`Failed to update filters for ${failureCount} users`, {
        label: 'User Filter Manager',
      });
    }
  }

  /**
   * Clean up all Overseerr user labels when no user/server_owner collections are configured
   */
  public async cleanupAllUserFilters(): Promise<void> {
    if (this.cancelled) return;

    logger.info(
      'No user/server_owner collections configured - cleaning up all Overseerr user filter labels',
      {
        label: 'User Filter Manager',
      }
    );

    try {
      // Get all users with Plex IDs to clean up their filters
      const usersWithPlexIds = await overseerrCollectionService.getUsersWithPlexIds();

      let cleanedCount = 0;
      let failureCount = 0;

      for (const user of usersWithPlexIds) {
        if (this.cancelled) break;

        try {
          // Clean up this user's filters by passing empty array (no active users)
          await updateUserFilterSettings(user.plexId!.toString(), []);
          cleanedCount++;
        } catch (error) {
          failureCount++;
          logger.warn(
            `Failed to cleanup filter settings for user ${user.displayName} (${user.plexId})`,
            {
              label: 'User Filter Manager',
              userId: user.id,
              userPlexId: user.plexId,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          );
        }
      }

      logger.info(
        `User filter cleanup completed: ${cleanedCount} users cleaned, ${failureCount} failures`,
        {
          label: 'User Filter Manager',
          cleanedCount,
          failureCount,
          totalUsers: usersWithPlexIds.length,
        }
      );
    } catch (error) {
      logger.error(`Failed to cleanup user filters: ${error}`, {
        label: 'User Filter Manager',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

export default UserFilterManager;