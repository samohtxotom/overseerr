import type { 
  CollectionServiceFactory, 
  CollectionNamingStrategy, 
  CollectionNamingContext 
} from './CollectionTypeRegistry';
import { BaseCollectionSync } from './BaseCollectionSync';
import { TautulliCollectionSync } from './TautulliCollectionSync';
import { OverseerrCollectionSync } from './OverseerrCollectionSync';
import { TraktCollectionSync } from './TraktCollectionSync';
import { TmdbCollectionSync } from './TmdbCollectionSync';
import { ImdbCollectionSync } from './ImdbCollectionSync';
import { LetterboxdCollectionSync } from './LetterboxdCollectionSync';
import type { CollectionConfig } from '@server/lib/settings';

/**
 * Factory for Tautulli collection services
 */
export class TautulliServiceFactory implements CollectionServiceFactory {
  create(): BaseCollectionSync {
    return new TautulliCollectionSync();
  }

  getDisplayName(): string {
    return 'Tautulli Statistics';
  }

  getSupportedSubtypes(): string[] {
    return [
      'most_popular',
      'most_played_by_duration', 
      'most_played_by_plays',
      'most_concurrent',
      'top_movies',
      'top_tv'
    ];
  }
}

/**
 * Factory for Overseerr collection services
 */
export class OverseerrServiceFactory implements CollectionServiceFactory {
  create(): BaseCollectionSync {
    return new OverseerrCollectionSync();
  }

  getDisplayName(): string {
    return 'Overseerr Requests';
  }

  getSupportedSubtypes(): string[] {
    return [
      'global',
      'users', 
      'server_owner'
    ];
  }
}

/**
 * Factory for Trakt collection services
 */
export class TraktServiceFactory implements CollectionServiceFactory {
  create(): BaseCollectionSync {
    return new TraktCollectionSync();
  }

  getDisplayName(): string {
    return 'Trakt Lists';
  }

  getSupportedSubtypes(): string[] {
    return [
      'trending',
      'popular',
      'most_watched',
      'most_played',
      'most_anticipated',
      'boxoffice'
    ];
  }
}

/**
 * Factory for TMDB collection services
 */
export class TmdbServiceFactory implements CollectionServiceFactory {
  create(): BaseCollectionSync {
    return new TmdbCollectionSync();
  }

  getDisplayName(): string {
    return 'TMDB Lists';
  }

  getSupportedSubtypes(): string[] {
    return [
      'trending',
      'popular',
      'top_rated',
      'upcoming',
      'now_playing'
    ];
  }
}

/**
 * Factory for IMDB collection services
 */
export class ImdbServiceFactory implements CollectionServiceFactory {
  create(): BaseCollectionSync {
    return new ImdbCollectionSync();
  }

  getDisplayName(): string {
    return 'IMDB Lists';
  }

  getSupportedSubtypes(): string[] {
    return [
      'top250_movies',
      'top250_tv',
      'popular_movies',
      'popular_tv',
      'custom_list'
    ];
  }
}

/**
 * Factory for Letterboxd collection services
 */
export class LetterboxdServiceFactory implements CollectionServiceFactory {
  create(): BaseCollectionSync {
    return new LetterboxdCollectionSync();
  }

  getDisplayName(): string {
    return 'Letterboxd Lists';
  }

  getSupportedSubtypes(): string[] {
    return [
      'custom_list'
    ];
  }
}

// Naming Strategies

/**
 * Standard naming strategy for most collection types
 */
export class StandardNamingStrategy implements CollectionNamingStrategy {
  async generateName(config: CollectionConfig, context: CollectionNamingContext): Promise<string> {
    // Use custom templates if available
    const template = context.mediaType === 'movie' 
      ? (config.customMovieTemplate || config.template || config.name)
      : context.mediaType === 'tv'
      ? (config.customTVTemplate || config.template || config.name) 
      : (config.template || config.name);
    
    // Basic variable substitution
    let name = template;
    
    if (context.userInfo) {
      name = name.replace(/\{nickname\}/g, context.userInfo.nickname || context.userInfo.name);
      name = name.replace(/\{username\}/g, context.userInfo.name);
      name = name.replace(/\{userId\}/g, String(context.userInfo.id));
    }
    
    if (context.libraryInfo) {
      name = name.replace(/\{libraryName\}/g, context.libraryInfo.name);
    }

    // Additional template variables
    if (context.templateVariables) {
      for (const [key, value] of Object.entries(context.templateVariables)) {
        name = name.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
      }
    }

    return name;
  }

  canHandle(type: string, subtype?: string): boolean {
    // Default strategy can handle any type
    return true;
  }

  getDefaultTemplate(mediaType: 'movie' | 'tv' | 'both'): string {
    switch (mediaType) {
      case 'movie':
        return 'Movies';
      case 'tv':
        return 'TV Shows';
      case 'both':
        return 'Collection';
      default:
        return 'Collection';
    }
  }
}

/**
 * User-specific naming strategy for collections that include user information
 */
export class UserNamingStrategy implements CollectionNamingStrategy {
  async generateName(config: CollectionConfig, context: CollectionNamingContext): Promise<string> {
    if (!context.userInfo) {
      throw new Error('UserNamingStrategy requires userInfo in context');
    }

    const userName = context.userInfo.nickname || context.userInfo.name;
    const mediaTypeSuffix = this.getMediaTypeSuffix(context.mediaType);
    
    // Use custom templates if available
    let template = config.template || config.name;
    
    if (context.mediaType === 'movie' && config.customMovieTemplate) {
      template = config.customMovieTemplate;
    } else if (context.mediaType === 'tv' && config.customTVTemplate) {
      template = config.customTVTemplate;
    }

    // If template doesn't contain user variables, add user name
    if (!template.includes('{nickname}') && !template.includes('{username}')) {
      template = `${userName}'s ${template}${mediaTypeSuffix}`;
    } else {
      template = template
        .replace(/\{nickname\}/g, context.userInfo.nickname || context.userInfo.name)
        .replace(/\{username\}/g, context.userInfo.name)
        .replace(/\{userId\}/g, String(context.userInfo.id));
      
      if (!template.includes(mediaTypeSuffix)) {
        template += mediaTypeSuffix;
      }
    }

    return template;
  }

  canHandle(type: string, subtype?: string): boolean {
    return subtype === 'users' || subtype === 'server_owner';
  }

  getDefaultTemplate(mediaType: 'movie' | 'tv' | 'both'): string {
    const suffix = this.getMediaTypeSuffix(mediaType);
    return `{nickname}'s Collection${suffix}`;
  }

  private getMediaTypeSuffix(mediaType: 'movie' | 'tv' | 'both'): string {
    switch (mediaType) {
      case 'movie':
        return ' Movies';
      case 'tv':
        return ' TV Shows';
      case 'both':
        return '';
      default:
        return '';
    }
  }
}

/**
 * Subtype-aware naming strategy that includes subtype information in names
 */
export class SubtypeNamingStrategy implements CollectionNamingStrategy {
  private subtypeDisplayNames: Record<string, string> = {
    // Tautulli subtypes
    'most_popular': 'Most Popular',
    'most_played_by_duration': 'Most Watched by Duration',
    'most_played_by_plays': 'Most Watched by Plays',
    'most_concurrent': 'Most Concurrent',
    'top_movies': 'Top Movies',
    'top_tv': 'Top TV Shows',
    
    // Trakt subtypes
    'trending': 'Trending',
    'popular': 'Popular',
    'most_watched': 'Most Watched',
    'most_played': 'Most Played',
    'most_anticipated': 'Most Anticipated',
    'boxoffice': 'Box Office',
    
    // TMDB subtypes
    'top_rated': 'Top Rated',
    'upcoming': 'Upcoming',
    'now_playing': 'Now Playing',
    
    // IMDB subtypes
    'top250_movies': 'Top 250 Movies',
    'top250_tv': 'Top 250 TV Shows',
    'popular_movies': 'Popular Movies',
    'popular_tv': 'Popular TV Shows',
    'custom_list': 'Custom List',
    
    // Overseerr subtypes
    'global': 'All Requests',
    'users': 'User Requests',
    'server_owner': 'Owner Requests',
  };

  async generateName(config: CollectionConfig, context: CollectionNamingContext): Promise<string> {
    // Start with template or name
    let template = config.template || config.name;
    
    if (context.mediaType === 'movie' && config.customMovieTemplate) {
      template = config.customMovieTemplate;
    } else if (context.mediaType === 'tv' && config.customTVTemplate) {
      template = config.customTVTemplate;
    }

    // Add subtype information if not already present
    if (config.subtype && !template.includes('{subtype}')) {
      const subtypeDisplay = this.subtypeDisplayNames[config.subtype] || config.subtype;
      if (!template.toLowerCase().includes(subtypeDisplay.toLowerCase())) {
        template = `${subtypeDisplay} ${template}`;
      }
    }

    // Perform variable substitution
    let name = template
      .replace(/\{subtype\}/g, this.subtypeDisplayNames[config.subtype || ''] || config.subtype || '')
      .replace(/\{type\}/g, config.type);

    // Handle user info if present
    if (context.userInfo) {
      name = name
        .replace(/\{nickname\}/g, context.userInfo.nickname || context.userInfo.name)
        .replace(/\{username\}/g, context.userInfo.name)
        .replace(/\{userId\}/g, String(context.userInfo.id));
    }

    // Handle library info if present
    if (context.libraryInfo) {
      name = name.replace(/\{libraryName\}/g, context.libraryInfo.name);
    }

    // Additional template variables
    if (context.templateVariables) {
      for (const [key, value] of Object.entries(context.templateVariables)) {
        name = name.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
      }
    }

    return name;
  }

  canHandle(type: string, subtype?: string): boolean {
    return !!subtype; // Can handle any type with a subtype
  }

  getDefaultTemplate(mediaType: 'movie' | 'tv' | 'both'): string {
    const suffix = mediaType === 'movie' ? ' Movies' : mediaType === 'tv' ? ' TV Shows' : '';
    return `{subtype}${suffix}`;
  }
}

// Export all factories and strategies
export const SERVICE_FACTORIES = {
  tautulli: new TautulliServiceFactory(),
  overseerr: new OverseerrServiceFactory(),
  trakt: new TraktServiceFactory(),
  tmdb: new TmdbServiceFactory(),
  imdb: new ImdbServiceFactory(),
  letterboxd: new LetterboxdServiceFactory(),
};

export const NAMING_STRATEGIES = {
  default: new StandardNamingStrategy(),
  user: new UserNamingStrategy(),
  subtype: new SubtypeNamingStrategy(),
};