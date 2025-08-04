import { Permission } from '@server/lib/permissions';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import logger from '@server/logger';

/**
 * Configuration for creating service users
 */
export interface ServiceUserConfig {
  username: string;
  displayName: string;
  email: string;
  permissions: number;
  avatar?: string;
  description?: string;
}

/**
 * Pre-defined service user configurations
 */
export const SERVICE_USER_CONFIGS = {
  TRAKT_AUTO_APPROVE: {
    username: 'TraktCollectionsAutoApproval',
    displayName: 'TraktCollectionsAutoApproval',
    email: 'donotchangeme@auto.traktcollections',
    permissions: Permission.REQUEST + Permission.AUTO_APPROVE + Permission.AUTO_APPROVE_MOVIE + Permission.AUTO_APPROVE_TV, // 928
    avatar: '/trakt-logo.svg',
    description: 'Virtual service user for auto-approved Trakt collection requests',
  },

  TRAKT_MANUAL_APPROVAL: {
    username: 'TraktCollectionsManualApproval',
    displayName: 'TraktCollectionsManualApproval',
    email: 'donotchangeme@manual.traktcollections',
    permissions: Permission.REQUEST, // 32
    avatar: '/trakt-logo.svg',
    description: 'Virtual service user for manual approval Trakt collection requests',
  },

  TMDB_AUTO_APPROVE: {
    username: 'TMDbCollectionsAutoApproval',
    displayName: 'TMDbCollectionsAutoApproval',
    email: 'donotchangeme@auto.tmdbcollections',
    permissions: Permission.REQUEST + Permission.AUTO_APPROVE + Permission.AUTO_APPROVE_MOVIE + Permission.AUTO_APPROVE_TV, // 928
    avatar: '/tmdb-logo.svg',
    description: 'Virtual service user for auto-approved TMDb collection requests',
  },

  TMDB_MANUAL_APPROVAL: {
    username: 'TMDbCollectionsManualApproval',
    displayName: 'TMDbCollectionsManualApproval',
    email: 'donotchangeme@manual.tmdbcollections',
    permissions: Permission.REQUEST, // 32
    avatar: '/tmdb-logo.svg',
    description: 'Virtual service user for manual approval TMDb collection requests',
  },

  IMDB_AUTO_APPROVE: {
    username: 'IMDbCollectionsAutoApproval',
    displayName: 'IMDbCollectionsAutoApproval',
    email: 'donotchangeme@auto.imdbcollections',
    permissions: Permission.REQUEST + Permission.AUTO_APPROVE + Permission.AUTO_APPROVE_MOVIE + Permission.AUTO_APPROVE_TV, // 928
    avatar: '/imdb-logo.svg',
    description: 'Virtual service user for auto-approved IMDb collection requests',
  },

  IMDB_MANUAL_APPROVAL: {
    username: 'IMDbCollectionsManualApproval',
    displayName: 'IMDbCollectionsManualApproval',
    email: 'donotchangeme@manual.imdbcollections',
    permissions: Permission.REQUEST, // 32
    avatar: '/imdb-logo.svg',
    description: 'Virtual service user for manual approval IMDb collection requests',
  },

  LETTERBOXD_AUTO_APPROVE: {
    username: 'LetterboxdCollectionsAutoApproval',
    displayName: 'LetterboxdCollectionsAutoApproval',
    email: 'donotchangeme@auto.letterboxdcollections',
    permissions: Permission.REQUEST + Permission.AUTO_APPROVE + Permission.AUTO_APPROVE_MOVIE + Permission.AUTO_APPROVE_TV, // 928
    avatar: '/letterboxd-logo.svg',
    description: 'Virtual service user for auto-approved Letterboxd collection requests',
  },

  LETTERBOXD_MANUAL_APPROVAL: {
    username: 'LetterboxdCollectionsManualApproval',
    displayName: 'LetterboxdCollectionsManualApproval',
    email: 'donotchangeme@manual.letterboxdcollections',
    permissions: Permission.REQUEST, // 32
    avatar: '/letterboxd-logo.svg',
    description: 'Virtual service user for manual approval Letterboxd collection requests',
  },

  TAUTULLI_SERVICE: {
    username: 'TautulliCollectionsService',
    displayName: 'TautulliCollectionsService',
    email: 'donotchangeme@tautulli.collections',
    permissions: Permission.REQUEST,
    avatar: '/tautulli-logo.svg',
    description: 'Virtual service user for Tautulli collection operations',
  },

  OVERSEERR_SERVICE: {
    username: 'OverseerrCollectionsService',
    displayName: 'OverseerrCollectionsService',
    email: 'donotchangeme@overseerr.collections',
    permissions: Permission.REQUEST,
    avatar: '/logo_stacked.svg',
    description: 'Virtual service user for Overseerr collection operations',
  },
} as const;

/**
 * Service User Manager for creating and managing virtual users
 * 
 * Handles creation, retrieval, and management of service users used by
 * collection sync processes for auto-requests and other automated operations.
 */
export class ServiceUserManager {
  private userRepository = getRepository(User);

  /**
   * Get or create a service user based on configuration
   * 
   * @param config - Service user configuration
   * @returns Promise resolving to the service user
   */
  public async getOrCreateServiceUser(config: ServiceUserConfig): Promise<User> {
    // Try to find existing service user by email (unique identifier)
    let serviceUser = await this.userRepository.findOne({
      where: { email: config.email },
    });

    if (!serviceUser) {
      // Create new service user
      serviceUser = await this.createServiceUser(config);
      
      logger.info(`Created virtual service user: ${config.displayName}`, {
        label: 'Service User Manager',
        username: config.username,
        email: config.email,
        permissions: config.permissions,
      });
    } else {
      // Update existing service user if permissions have changed
      const hasPermissionChanges = serviceUser.permissions !== config.permissions;
      const hasDisplayNameChanges = serviceUser.displayName !== config.displayName;
      
      if (hasPermissionChanges || hasDisplayNameChanges) {
        serviceUser.permissions = config.permissions;
        serviceUser.displayName = config.displayName;
        serviceUser.updatedAt = new Date();
        
        await this.userRepository.save(serviceUser);
        
        logger.info(`Updated virtual service user: ${config.displayName}`, {
          label: 'Service User Manager',
          username: config.username,
          permissionsChanged: hasPermissionChanges,
          displayNameChanged: hasDisplayNameChanges,
        });
      }
    }

    return serviceUser;
  }

  /**
   * Get or create Trakt auto-approve service user
   */
  public async getTraktAutoApproveUser(): Promise<User> {
    return this.getOrCreateServiceUser(SERVICE_USER_CONFIGS.TRAKT_AUTO_APPROVE);
  }

  /**
   * Get or create Trakt manual approval service user
   */
  public async getTraktManualApprovalUser(): Promise<User> {
    return this.getOrCreateServiceUser(SERVICE_USER_CONFIGS.TRAKT_MANUAL_APPROVAL);
  }

  /**
   * Get or create Tautulli service user
   */
  public async getTautulliServiceUser(): Promise<User> {
    return this.getOrCreateServiceUser(SERVICE_USER_CONFIGS.TAUTULLI_SERVICE);
  }

  /**
   * Get or create Overseerr service user
   */
  public async getOverseerrServiceUser(): Promise<User> {
    return this.getOrCreateServiceUser(SERVICE_USER_CONFIGS.OVERSEERR_SERVICE);
  }

  // Note: Virtual user creation removed - not needed since collection functions
  // ignore user parameter when custom titles and global collection flags are used

  /**
   * Clean up orphaned service users
   * 
   * Removes service users that are no longer needed or have been replaced
   * by newer configurations.
   */
  public async cleanupOrphanedServiceUsers(): Promise<number> {
    const validEmails = Object.values(SERVICE_USER_CONFIGS).map(config => config.email);
    
    const orphanedUsers = await this.userRepository
      .createQueryBuilder('user')
      .where('user.email LIKE :pattern', { pattern: 'donotchangeme@%' })
      .andWhere('user.email NOT IN (:...validEmails)', { validEmails })
      .getMany();

    if (orphanedUsers.length > 0) {
      await this.userRepository.remove(orphanedUsers);
      
      logger.info(`Cleaned up ${orphanedUsers.length} orphaned service users`, {
        label: 'Service User Manager',
        removedUsers: orphanedUsers.map(u => u.email),
      });
    }

    return orphanedUsers.length;
  }

  /**
   * List all active service users
   */
  public async listServiceUsers(): Promise<User[]> {
    const validEmails = Object.values(SERVICE_USER_CONFIGS).map(config => config.email);
    
    return this.userRepository
      .createQueryBuilder('user')
      .where('user.email IN (:...validEmails)', { validEmails })
      .getMany();
  }

  /**
   * Create a new service user
   */
  private async createServiceUser(config: ServiceUserConfig): Promise<User> {
    const serviceUser = new User({
      email: config.email,
      username: config.username,
      displayName: config.displayName,
      plexUsername: config.username,
      plexTitle: config.displayName,
      permissions: config.permissions,
      userType: 1, // LOCAL user type
      avatar: config.avatar || '/logo_stacked.svg',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return await this.userRepository.save(serviceUser);
  }
}

// Export singleton instance
export const serviceUserManager = new ServiceUserManager();