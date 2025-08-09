import logger from '@server/logger';
import OverseerrAPI from '@server/api/overseerr';
import { getSettings } from '@server/lib/settings';
import type { 
  OverseerrUser, 
  OverseerrMediaRequest, 
  OverseerrMedia 
} from '@server/api/overseerr';
import { BATCH_CONFIG } from './ConfigurationConstants';

/**
 * Service class to handle all Overseerr API operations needed by the collections system
 * This replaces direct database access when working with external Overseerr instances
 */
export class OverseerrCollectionService {
  private overseerrClient: OverseerrAPI | null = null;
  private isExternalMode = false;

  constructor() {
    this.initializeClient();
  }

  /**
   * Initialize the Overseerr API client based on current settings
   */
  private initializeClient(): void {
    const settings = getSettings().load(); // Explicitly load settings from file
    
    // Debug: Log what we actually get from settings
    logger.debug('OverseerrCollectionService: Raw settings debug', {
      label: 'Collections',
      hasOverseerr: !!settings.overseerr,
      overseerrKeys: settings.overseerr ? Object.keys(settings.overseerr) : [],
      overseerrValues: settings.overseerr || 'undefined',
    });
    
    // Always use external Overseerr mode (decoupled architecture)
    if (settings.overseerr && settings.overseerr.hostname && settings.overseerr.apiKey) {
      this.overseerrClient = new OverseerrAPI(settings.overseerr);
      this.isExternalMode = true;
      const hostWithPort = settings.overseerr.port 
        ? `${settings.overseerr.hostname}:${settings.overseerr.port}` 
        : settings.overseerr.hostname;
      logger.info('OverseerrCollectionService: Using external Overseerr instance', {
        label: 'Collections',
        hostname: hostWithPort,
      });
    } else {
      logger.error('OverseerrCollectionService: External Overseerr not configured! Please configure hostname and API key.', {
        label: 'Collections',
        currentConfig: {
          hostname: settings.overseerr?.hostname || 'Missing',
          port: settings.overseerr?.port || 'Not specified',
          apiKey: settings.overseerr?.apiKey ? 'Present' : 'Missing',
        },
      });
      // Still set to external mode but without client - will cause errors that remind user to configure
      this.isExternalMode = true;
      this.overseerrClient = null;
    }
  }

  /**
   * Get admin user from external Overseerr
   */
  async getAdminUser(): Promise<OverseerrUser | null> {
    if (!this.overseerrClient) {
      logger.error('External Overseerr client not configured', {
        label: 'OverseerrCollectionService',
      });
      return null;
    }

    try {
      return await this.overseerrClient.getAdminUser();
    } catch (error) {
      logger.error('Failed to get admin user from external Overseerr', {
        label: 'OverseerrCollectionService',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get all users with Plex IDs from external Overseerr
   */
  async getUsersWithPlexIds(): Promise<OverseerrUser[]> {
    if (!this.overseerrClient) {
      logger.error('External Overseerr client not configured', {
        label: 'OverseerrCollectionService',
      });
      return [];
    }

    try {
      // Get all users and filter those with Plex IDs
      const response = await this.overseerrClient.getUsers({ take: BATCH_CONFIG.USER_FETCH_LIMIT });
      return response.results.filter(user => user.plexId);
    } catch (error) {
      logger.error('Failed to get users from external Overseerr', {
        label: 'OverseerrCollectionService',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get approved media requests from external Overseerr
   */
  async getApprovedRequests(): Promise<OverseerrMediaRequest[]> {
    if (!this.overseerrClient) {
      logger.error('External Overseerr client not configured', {
        label: 'OverseerrCollectionService',
      });
      return [];
    }

    try {
      // Get approved requests from external Overseerr
      const response = await this.overseerrClient.getRequests({ 
        filter: 'approved',
        take: BATCH_CONFIG.REQUEST_FETCH_LIMIT
      });
      return response.results;
    } catch (error) {
      logger.error('Failed to get approved requests from external Overseerr', {
        label: 'OverseerrCollectionService',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Update user data - External mode is read-only
   */
  async updateUsers(users: OverseerrUser[]): Promise<void> {
    logger.warn('Cannot update users in external Overseerr mode - read-only access', {
      label: 'OverseerrCollectionService',
    });
    return;
  }

  /**
   * Test connection to external Overseerr
   */
  async testConnection(): Promise<{ success: boolean; version?: string }> {
    if (!this.overseerrClient) {
      return { success: false };
    }

    return await this.overseerrClient.testConnection();
  }

  /**
   * Get service mode information
   */
  getServiceInfo(): { mode: 'external'; hostname?: string } {
    const settings = getSettings();
    return {
      mode: 'external',
      hostname: settings.overseerr?.hostname,
    };
  }

  /**
   * Update specific users - External mode is read-only
   */
  async updateSpecificUsers(users: OverseerrUser[]): Promise<number> {
    logger.warn('Cannot update specific users in external Overseerr mode - read-only access', {
      label: 'OverseerrCollectionService',
      userCount: users.length,
    });
    return 0;
  }

  /**
   * Get service-specific data needed for collections operations
   */
  async getCollectionServiceData(): Promise<{
    mode: 'external';
    canUpdateUsers: false;
    canAccessFullDatabase: false;
  }> {
    return {
      mode: 'external',
      canUpdateUsers: false,
      canAccessFullDatabase: false,
    };
  }

  /**
   * Reinitialize the client when settings change
   */
  reinitialize(): void {
    this.initializeClient();
  }
}

// Export singleton instance
export const overseerrCollectionService = new OverseerrCollectionService();