import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Interface for data fetching strategies
 * Handles the common pattern of fetching data for movie, tv, or both media types
 */
export interface DataFetchingStrategy<TSourceData = any> {
  fetchData(config: CollectionConfig, options?: any): Promise<TSourceData[]>;
  canHandle(mediaType: 'movie' | 'tv' | 'both'): boolean;
}

/**
 * Context for data fetching operations
 */
export interface DataFetchingContext {
  subtype: string;
  timeWindow?: 'day' | 'week';
  sortBy?: string;
  page?: number;
  additionalOptions?: Record<string, any>;
}

/**
 * Abstract base class for API client-based data fetching
 */
export abstract class ApiDataFetchingStrategy<TClient, TSourceData> implements DataFetchingStrategy<TSourceData> {
  constructor(protected client: TClient) {}

  abstract canHandle(mediaType: 'movie' | 'tv' | 'both'): boolean;
  
  async fetchData(config: CollectionConfig, options: DataFetchingContext = { subtype: config.subtype || '' }): Promise<TSourceData[]> {
    const mediaType = config.mediaType as 'movie' | 'tv' | 'both';
    const data: TSourceData[] = [];

    try {
      // Fetch movie data if needed
      if (mediaType === 'movie' || mediaType === 'both') {
        const movieData = await this.fetchMovieData(config, options);
        if (movieData.length > 0) {
          data.push(...movieData);
        }
      }

      // Fetch TV data if needed
      if (mediaType === 'tv' || mediaType === 'both') {
        const tvData = await this.fetchTvData(config, options);
        if (tvData.length > 0) {
          data.push(...tvData);
        }
      }

      logger.debug(`Fetched data for ${mediaType} media type`, {
        label: 'API Data Fetching Strategy',
        mediaType,
        configName: config.name,
        dataCount: data.length,
        subtype: options.subtype,
      });

      return data;
    } catch (error) {
      logger.error(`Failed to fetch data for ${mediaType} media type`, {
        label: 'API Data Fetching Strategy',
        mediaType,
        configName: config.name,
        subtype: options.subtype,
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw error;
    }
  }

  protected abstract fetchMovieData(config: CollectionConfig, options: DataFetchingContext): Promise<TSourceData[]>;
  protected abstract fetchTvData(config: CollectionConfig, options: DataFetchingContext): Promise<TSourceData[]>;
}

/**
 * TMDB-specific data fetching strategy
 */
export class TmdbDataFetchingStrategy extends ApiDataFetchingStrategy<any, any> {
  canHandle(mediaType: 'movie' | 'tv' | 'both'): boolean {
    return true; // TMDB supports all media types
  }

  protected async fetchMovieData(config: CollectionConfig, options: DataFetchingContext): Promise<any[]> {
    const { subtype, timeWindow = 'day', sortBy, page = 1 } = options;

    switch (subtype) {
      case 'trending': {
        const data = await this.client.getMovieTrending({ page, timeWindow });
        return data.results.map((item: any) => ({ ...item, media_type: 'movie' as const }));
      }
      case 'popular': {
        const data = await this.client.getDiscoverMovies({ sortBy: 'popularity.desc', page });
        return data.results.map((item: any) => ({ ...item, media_type: 'movie' as const }));
      }
      case 'top_rated': {
        const data = await this.client.getDiscoverMovies({ sortBy: 'vote_average.desc', page });
        return data.results.map((item: any) => ({ ...item, media_type: 'movie' as const }));
      }
      case 'upcoming': {
        const data = await this.client.getUpcomingMovies({ page });
        return data.results.map((item: any) => ({ ...item, media_type: 'movie' as const }));
      }
      case 'now_playing': {
        const data = await this.client.getNowPlayingMovies({ page });
        return data.results.map((item: any) => ({ ...item, media_type: 'movie' as const }));
      }
      default:
        throw new Error(`Unsupported TMDB movie subtype: ${subtype}`);
    }
  }

  protected async fetchTvData(config: CollectionConfig, options: DataFetchingContext): Promise<any[]> {
    const { subtype, timeWindow = 'day', page = 1 } = options;

    switch (subtype) {
      case 'trending': {
        const data = await this.client.getTvTrending({ page, timeWindow });
        return data.results.map((item: any) => ({ ...item, media_type: 'tv' as const }));
      }
      case 'popular': {
        const data = await this.client.getDiscoverTv({ sortBy: 'popularity.desc', page });
        return data.results.map((item: any) => ({ ...item, media_type: 'tv' as const }));
      }
      case 'top_rated': {
        const data = await this.client.getDiscoverTv({ sortBy: 'vote_average.desc', page });
        return data.results.map((item: any) => ({ ...item, media_type: 'tv' as const }));
      }
      case 'airing_today': {
        const data = await this.client.getTvAiringToday({ page });
        return data.results.map((item: any) => ({ ...item, media_type: 'tv' as const }));
      }
      case 'on_the_air': {
        const data = await this.client.getTvOnTheAir({ page });
        return data.results.map((item: any) => ({ ...item, media_type: 'tv' as const }));
      }
      default:
        throw new Error(`Unsupported TMDB TV subtype: ${subtype}`);
    }
  }
}

/**
 * Trakt-specific data fetching strategy
 */
export class TraktDataFetchingStrategy extends ApiDataFetchingStrategy<any, any> {
  canHandle(mediaType: 'movie' | 'tv' | 'both'): boolean {
    return true; // Trakt supports all media types
  }

  protected async fetchMovieData(config: CollectionConfig, options: DataFetchingContext): Promise<any[]> {
    const { subtype, page = 1 } = options;
    const additionalOptions = options.additionalOptions || {};

    switch (subtype) {
      case 'trending': {
        const data = await this.client.getMoviesTrending({ ...additionalOptions, page });
        return data.map((item: any) => ({ ...item, media_type: 'movie' as const }));
      }
      case 'popular': {
        const data = await this.client.getMoviesPopular({ ...additionalOptions, page });
        return data.map((item: any) => ({ ...item, media_type: 'movie' as const }));
      }
      case 'most_watched': {
        const data = await this.client.getMoviesMostWatched({ ...additionalOptions, page });
        return data.map((item: any) => ({ ...item, media_type: 'movie' as const }));
      }
      case 'most_played': {
        const data = await this.client.getMoviesMostPlayed({ ...additionalOptions, page });
        return data.map((item: any) => ({ ...item, media_type: 'movie' as const }));
      }
      case 'most_anticipated': {
        const data = await this.client.getMoviesMostAnticipated({ ...additionalOptions, page });
        return data.map((item: any) => ({ ...item, media_type: 'movie' as const }));
      }
      case 'boxoffice': {
        const data = await this.client.getMoviesBoxOffice();
        return data.map((item: any) => ({ ...item, media_type: 'movie' as const }));
      }
      default:
        throw new Error(`Unsupported Trakt movie subtype: ${subtype}`);
    }
  }

  protected async fetchTvData(config: CollectionConfig, options: DataFetchingContext): Promise<any[]> {
    const { subtype, page = 1 } = options;
    const additionalOptions = options.additionalOptions || {};

    switch (subtype) {
      case 'trending': {
        const data = await this.client.getShowsTrending({ ...additionalOptions, page });
        return data.map((item: any) => ({ ...item, media_type: 'tv' as const }));
      }
      case 'popular': {
        const data = await this.client.getShowsPopular({ ...additionalOptions, page });
        return data.map((item: any) => ({ ...item, media_type: 'tv' as const }));
      }
      case 'most_watched': {
        const data = await this.client.getShowsMostWatched({ ...additionalOptions, page });
        return data.map((item: any) => ({ ...item, media_type: 'tv' as const }));
      }
      case 'most_played': {
        const data = await this.client.getShowsMostPlayed({ ...additionalOptions, page });
        return data.map((item: any) => ({ ...item, media_type: 'tv' as const }));
      }
      case 'most_anticipated': {
        const data = await this.client.getShowsMostAnticipated({ ...additionalOptions, page });
        return data.map((item: any) => ({ ...item, media_type: 'tv' as const }));
      }
      default:
        throw new Error(`Unsupported Trakt TV subtype: ${subtype}`);
    }
  }
}

/**
 * Factory for creating data fetching strategies
 */
export class DataFetchingStrategyFactory {
  private static strategies = new Map<string, (client: any) => DataFetchingStrategy>();

  static {
    // Register default strategies
    DataFetchingStrategyFactory.registerStrategy('tmdb', (client) => new TmdbDataFetchingStrategy(client));
    DataFetchingStrategyFactory.registerStrategy('trakt', (client) => new TraktDataFetchingStrategy(client));
  }

  /**
   * Register a custom data fetching strategy
   */
  public static registerStrategy(
    type: string, 
    factory: (client: any) => DataFetchingStrategy
  ): void {
    this.strategies.set(type, factory);
  }

  /**
   * Get a data fetching strategy for a given type
   */
  public static getStrategy(type: string, client: any): DataFetchingStrategy {
    const factory = this.strategies.get(type);
    if (!factory) {
      throw new Error(`Unknown data fetching strategy type: ${type}`);
    }
    
    return factory(client);
  }

  /**
   * Check if a strategy is registered
   */
  public static hasStrategy(type: string): boolean {
    return this.strategies.has(type);
  }

  /**
   * Get all registered strategy types
   */
  public static getRegisteredTypes(): string[] {
    return Array.from(this.strategies.keys());
  }
}

// Export singleton factory
export const dataFetchingStrategyFactory = DataFetchingStrategyFactory;