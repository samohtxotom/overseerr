import axios, { AxiosInstance } from 'axios';
import logger from '@server/logger';
import type { OverseerrSettings } from '@server/lib/settings';

export interface OverseerrUser {
  id: number;
  plexId?: number;
  plexTitle?: string;
  plexUsername?: string;
  username?: string;
  email: string;
  displayName?: string;
  avatar?: string;
  permissions: number;
  createdAt: string;
  updatedAt: string;
}

export interface OverseerrMediaRequest {
  id: number;
  type: 'movie' | 'tv';
  status: number;
  is4k: boolean;
  requestedBy: {
    id: number;
    displayName: string;
    plexUsername?: string;
  };
  media: {
    id: number;
    tmdbId: number;
    title: string;
    ratingKey?: string;
    ratingKey4k?: string;
    mediaType: 'movie' | 'tv';
    status: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface OverseerrMedia {
  id: number;
  tmdbId: number;
  title: string;
  mediaType: 'movie' | 'tv';
  status: number;
  ratingKey?: string;
  ratingKey4k?: string;
  seasonCount?: number;
}

export interface CreateUserRequest {
  username: string;
  displayName: string;
  email: string;
  permissions: number;
  avatar?: string;
}

export interface CreateMediaRequestParams {
  mediaId: number;
  mediaType: 'movie' | 'tv';
  seasons?: 'all' | number[];
  is4k?: boolean;
  userId: number;
}

/**
 * API client for communicating with external Overseerr instances
 * Used by our standalone collections app to interact with users' Overseerr installations
 */
class OverseerrAPI {
  private axios: AxiosInstance;
  private baseUrl: string;

  constructor(settings: OverseerrSettings) {
    // Build URL from individual settings components
    const protocol = settings.useSsl ? 'https' : 'http';
    const port = settings.port ? `:${settings.port}` : '';
    const urlBase = settings.urlBase || '';
    this.baseUrl = `${protocol}://${settings.hostname}${port}${urlBase}`;
    
    this.axios = axios.create({
      baseURL: `${this.baseUrl}/api/v1`,
      headers: {
        'X-API-Key': settings.apiKey || '',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Add request logging
    this.axios.interceptors.request.use((config) => {
      logger.debug(`Overseerr API Request: ${config.method?.toUpperCase()} ${config.url}`, {
        label: 'OverseerrAPI',
      });
      return config;
    });

    // Add response/error logging
    this.axios.interceptors.response.use(
      (response) => {
        logger.debug(`Overseerr API Response: ${response.status} ${response.config.url}`, {
          label: 'OverseerrAPI',
        });
        return response;
      },
      (error) => {
        logger.error(`Overseerr API Error: ${error.message}`, {
          label: 'OverseerrAPI',
          url: error.config?.url,
          status: error.response?.status,
        });
        throw error;
      }
    );
  }

  /**
   * Test connection to Overseerr instance
   */
  async testConnection(): Promise<{ success: boolean; version?: string }> {
    try {
      const response = await this.axios.get('/status');
      return {
        success: true,
        version: response.data.version,
      };
    } catch (error) {
      return {
        success: false,
      };
    }
  }

  /**
   * Get all users from Overseerr
   */
  async getUsers(params?: { take?: number; skip?: number }): Promise<{
    results: OverseerrUser[];
    total: number;
  }> {
    const response = await this.axios.get('/user', { params });
    return response.data;
  }

  /**
   * Get specific user by ID
   */
  async getUser(userId: number): Promise<OverseerrUser> {
    const response = await this.axios.get(`/user/${userId}`);
    return response.data;
  }

  /**
   * Create or update a service user
   */
  async createUser(userData: CreateUserRequest): Promise<OverseerrUser> {
    const response = await this.axios.post('/user', userData);
    return response.data;
  }

  /**
   * Get current authenticated user (admin check)
   */
  async getCurrentUser(): Promise<OverseerrUser> {
    const response = await this.axios.get('/auth/me');
    return response.data;
  }

  /**
   * Get all media requests
   */
  async getRequests(params?: {
    take?: number;
    skip?: number;
    requestedBy?: number;
    filter?: 'all' | 'approved' | 'pending' | 'processing' | 'unavailable';
  }): Promise<{
    results: OverseerrMediaRequest[];
    total: number;
  }> {
    const response = await this.axios.get('/request', { params });
    return response.data;
  }

  /**
   * Create a new media request
   */
  async createRequest(requestData: CreateMediaRequestParams): Promise<OverseerrMediaRequest> {
    const payload = {
      mediaId: requestData.mediaId,
      mediaType: requestData.mediaType,
      seasons: requestData.seasons,
      is4k: requestData.is4k || false,
    };

    // Set user context for the request
    const response = await this.axios.post('/request', payload, {
      headers: {
        'X-API-User': requestData.userId.toString(),
      },
    });
    return response.data;
  }

  /**
   * Check if media exists in Plex by TMDB ID
   */
  async getMediaByTmdbId(tmdbId: number): Promise<OverseerrMedia | null> {
    try {
      const response = await this.axios.get(`/media/${tmdbId}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null; // Media not found
      }
      throw error;
    }
  }

  /**
   * Search for existing requests to avoid duplicates
   */
  async checkRequestExists(tmdbId: number, userId: number): Promise<OverseerrMediaRequest | null> {
    try {
      // Get user's requests and check for this TMDB ID
      const requests = await this.getRequests({ 
        requestedBy: userId,
        take: 1000 // Get all user requests
      });
      
      return requests.results.find(req => req.media.tmdbId === tmdbId) || null;
    } catch (error) {
      logger.warn(`Failed to check existing request: ${error.message}`, {
        label: 'OverseerrAPI',
        tmdbId,
        userId,
      });
      return null;
    }
  }

  /**
   * Get request count (for admin operations)
   */
  async getRequestCount(): Promise<number> {
    const response = await this.axios.get('/request/count');
    return response.data;
  }

  /**
   * Get media season count for TV shows
   */
  async getMediaSeasonCount(tmdbId: number): Promise<number> {
    const media = await this.getMediaByTmdbId(tmdbId);
    return media?.seasonCount || 0;
  }

  /**
   * Batch get users by IDs
   */
  async getUsersByIds(userIds: number[]): Promise<OverseerrUser[]> {
    // Overseerr doesn't have batch user endpoint, so fetch individually
    const users: OverseerrUser[] = [];
    
    for (const userId of userIds) {
      try {
        const user = await this.getUser(userId);
        users.push(user);
      } catch (error) {
        logger.warn(`Failed to fetch user ${userId}: ${error.message}`, {
          label: 'OverseerrAPI',
        });
      }
    }
    
    return users;
  }

  /**
   * Get admin user (typically user ID 1)
   */
  async getAdminUser(): Promise<OverseerrUser | null> {
    try {
      return await this.getUser(1);
    } catch (error) {
      logger.error(`Failed to get admin user: ${error.message}`, {
        label: 'OverseerrAPI',
      });
      return null;
    }
  }
}

export default OverseerrAPI;