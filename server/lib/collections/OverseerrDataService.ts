import { overseerrCollectionService } from './OverseerrCollectionService';
import { extractErrorMessage } from '@server/lib/utils/templateUtils';
import logger from '@server/logger';

interface CollectionItem {
  ratingKey: string;
  type?: string;
}

interface UserCollections {
  [userId: string]: {
    movies: CollectionItem[];
    tv: CollectionItem[];
    user: any;
  };
}

/**
 * Service for fetching and organizing Overseerr data for collections
 */
export class OverseerrDataService {
  private cancelled = false;

  public cancel(): void {
    this.cancelled = true;
  }

  /**
   * Get all requests that have Plex rating keys for Overseerr collections
   * Excludes Trakt service user requests to avoid circular collections
   */
  public async getApprovedRequests(): Promise<any[]> {
    try {
      const requests = await overseerrCollectionService.getApprovedRequests();
      
      // Apply additional filtering that was previously done at database level
      const filteredRequests = requests.filter(request => {
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
        
        return hasValidRatingKey;
      });

      // Sort by creation date (newest first)
      filteredRequests.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA; // Descending (newest first)
      });

      return filteredRequests;
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      logger.error(`Error fetching approved requests: ${errorMessage}`, {
        label: 'Overseerr Data Service',
        errorMessage,
      });
      throw new Error(`Failed to fetch approved requests: ${errorMessage}`);
    }
  }

  /**
   * Organize requests by user and media type using Plex user IDs
   * Note: Admin requests (user ID = 1) are excluded from regular user collections
   * but are still available in the main requests array for server owner collections
   */
  public organizeRequestsByUser(requests: any[]): UserCollections {
    const userCollections: UserCollections = {};

    for (const request of requests) {
      if (this.cancelled) break;

      // Always skip admin user (server owner) requests in regular user collections
      // Admin requests are handled separately via server_owner collection type
      if (request.requestedBy.id === 1) {
        continue;
      }

      // Use the Plex ID from the user, not the Overseerr user ID
      const userPlexId = request.requestedBy.plexId;

      if (!userPlexId) {
        continue;
      }

      // Convert to string for consistent usage
      const userPlexIdStr = userPlexId.toString();

      // Get the correct rating key based on whether it's 4K or not
      const ratingKey = request.is4k
        ? request.media?.ratingKey4k
        : request.media?.ratingKey;

      if (!ratingKey || !request.requestedBy) {
        continue;
      }

      // Initialize user collection if not exists (using Plex ID string as key)
      if (!userCollections[userPlexIdStr]) {
        userCollections[userPlexIdStr] = {
          movies: [],
          tv: [],
          user: request.requestedBy,
        };
      }

      const collectionItem: CollectionItem = {
        ratingKey: ratingKey,
        type: request.type,
      };

      if (request.type === 'movie') {
        userCollections[userPlexIdStr].movies.push(collectionItem);
      } else if (request.type === 'tv') {
        userCollections[userPlexIdStr].tv.push(collectionItem);
      }
    }

    return userCollections;
  }

  /**
   * Get server owner requests (admin user requests)
   */
  public getServerOwnerRequests(requests: any[]): any[] {
    return requests.filter(request => request.requestedBy.id === 1);
  }

  /**
   * Get requests by media type
   */
  public getRequestsByMediaType(requests: any[], mediaType: 'movie' | 'tv'): any[] {
    return requests.filter(request => request.type === mediaType);
  }

  /**
   * Get unique user count from user collections
   */
  public getUserCount(userCollections: UserCollections): number {
    return Object.keys(userCollections).length;
  }

  /**
   * Check if user collections are empty
   */
  public hasUserCollections(userCollections: UserCollections): boolean {
    return Object.keys(userCollections).length > 0;
  }

  /**
   * Get all user Plex IDs from user collections
   */
  public getUserPlexIds(userCollections: UserCollections): string[] {
    return Object.keys(userCollections);
  }

  /**
   * Filter requests by rating key validity
   */
  public filterValidRequests(requests: any[]): any[] {
    return requests.filter(request => {
      if (!request.media) return false;

      const hasValidRatingKey = request.is4k 
        ? (request.media.ratingKey4k && 
           request.media.ratingKey4k !== '' && 
           request.media.ratingKey4k !== 'null' && 
           request.media.ratingKey4k !== 'undefined')
        : (request.media.ratingKey && 
           request.media.ratingKey !== '' && 
           request.media.ratingKey !== 'null' && 
           request.media.ratingKey !== 'undefined');
      
      return hasValidRatingKey;
    });
  }

  /**
   * Get request statistics
   */
  public getRequestStats(requests: any[]): {
    total: number;
    movies: number;
    tv: number;
    users: Set<number>;
  } {
    const movieRequests = requests.filter(r => r.type === 'movie');
    const tvRequests = requests.filter(r => r.type === 'tv');
    const uniqueUsers = new Set(requests.map(r => r.requestedBy.id));

    return {
      total: requests.length,
      movies: movieRequests.length,
      tv: tvRequests.length,
      users: uniqueUsers,
    };
  }
}

export default OverseerrDataService;