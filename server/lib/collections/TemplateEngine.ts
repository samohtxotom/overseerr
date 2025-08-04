import { getSettings } from '@server/lib/settings';

/**
 * Template placeholders that can be used in collection names
 */
export interface TemplateContext {
  mediaType?: 'movie' | 'tv' | 'both';
  days?: number;
  customdays?: number;
  statType?: string;
  servername?: string;
  subtype?: string;
  domain?: string;
  nickname?: string;
  username?: string;
  displayName?: string;
  // Time-based placeholders
  currentDate?: string; // Current date in DD-MM format
  currentMonth?: string; // Current month name
  currentYear?: string; // Current year
  currentDay?: string; // Current day name
  isWeekend?: boolean; // Whether current day is weekend
}

/**
 * Template Engine for processing collection name templates
 * 
 * Handles placeholder replacement for collection names across all sync sources.
 * Supports template inheritance where custom templates can override base templates.
 */
export class TemplateEngine {
  private settings = getSettings();

  /**
   * Process a template with the given context
   * 
   * @param template - The template string with placeholders like {mediaType}
   * @param context - Context object containing values for placeholder replacement
   * @returns Processed template with placeholders replaced
   */
  public processTemplate(template: string, context: TemplateContext): string {
    if (!template) {
      return '';
    }

    let processed = template;

    // Replace all known placeholders
    if (context.mediaType !== undefined) {
      const mediaTypeLabel = this.getMediaTypeLabel(context.mediaType);
      processed = processed.replace(/{mediaType}/g, mediaTypeLabel);
    }

    if (context.days !== undefined) {
      processed = processed.replace(/{days}/g, context.days.toString());
    }

    if (context.customdays !== undefined) {
      processed = processed.replace(/{customdays}/g, context.customdays.toString());
    }

    if (context.statType !== undefined) {
      processed = processed.replace(/{statType}/g, context.statType);
    }

    if (context.servername !== undefined) {
      processed = processed.replace(/{servername}/g, context.servername);
    }

    if (context.subtype !== undefined) {
      processed = processed.replace(/{subtype}/g, context.subtype);
    }

    if (context.domain !== undefined) {
      processed = processed.replace(/{domain}/g, context.domain);
    }

    if (context.nickname !== undefined) {
      processed = processed.replace(/{nickname}/g, context.nickname);
    }

    if (context.username !== undefined) {
      processed = processed.replace(/{username}/g, context.username);
    }

    if (context.displayName !== undefined) {
      processed = processed.replace(/{displayName}/g, context.displayName);
    }

    // Time-based placeholders
    if (context.currentDate !== undefined) {
      processed = processed.replace(/{currentDate}/g, context.currentDate);
    }

    if (context.currentMonth !== undefined) {
      processed = processed.replace(/{currentMonth}/g, context.currentMonth);
    }

    if (context.currentYear !== undefined) {
      processed = processed.replace(/{currentYear}/g, context.currentYear);
    }

    if (context.currentDay !== undefined) {
      processed = processed.replace(/{currentDay}/g, context.currentDay);
    }

    if (context.isWeekend !== undefined) {
      processed = processed.replace(/{isWeekend}/g, context.isWeekend ? 'Weekend' : 'Weekday');
    }

    return processed;
  }

  /**
   * Process template with media type-specific custom templates
   * 
   * @param baseTemplate - Base template to use
   * @param customMovieTemplate - Custom template to use for movies (when mediaType is 'both')
   * @param customTVTemplate - Custom template to use for TV shows (when mediaType is 'both')  
   * @param context - Template context
   * @returns Processed template
   */
  public processTemplateWithCustom(
    baseTemplate: string,
    customMovieTemplate: string | undefined,
    customTVTemplate: string | undefined,
    context: TemplateContext
  ): string {
    let templateToUse = baseTemplate;

    // Use custom templates when processing 'both' media types
    if (context.mediaType === 'movie' && customMovieTemplate) {
      templateToUse = customMovieTemplate;
    } else if (context.mediaType === 'tv' && customTVTemplate) {
      templateToUse = customTVTemplate;
    }

    return this.processTemplate(templateToUse, context);
  }

  /**
   * Get default template context values from settings
   */
  public getDefaultContext(): Partial<TemplateContext> {
    return {
      servername: this.settings.plex.name || 'Plex Server',
      domain: this.extractDomainFromUrl(this.settings.main.applicationUrl || ''),
    };
  }

  /**
   * Create context for Tautulli collections
   */
  public createTautulliContext(
    mediaType: 'movie' | 'tv',
    timeRangeDays: number,
    statType: string,
    subtype: string
  ): TemplateContext {
    return {
      ...this.getDefaultContext(),
      mediaType,
      days: timeRangeDays,
      customdays: timeRangeDays,
      statType: this.getStatTypeLabel(statType),
      subtype: this.getTautulliSubtypeLabel(subtype),
    };
  }

  /**
   * Create context for Trakt collections
   */
  public createTraktContext(
    mediaType: 'movie' | 'tv',
    subtype: string
  ): TemplateContext {
    return {
      ...this.getDefaultContext(),
      mediaType,
      subtype: this.getTraktSubtypeLabel(subtype),
    };
  }

  /**
   * Create context for TMDb collections
   */
  public createTmdbContext(
    mediaType: 'movie' | 'tv',
    subtype: string
  ): TemplateContext {
    return {
      ...this.getDefaultContext(),
      mediaType,
      subtype: this.getTmdbSubtypeLabel(subtype),
    };
  }

  /**
   * Create context for IMDb collections
   */
  public createImdbContext(
    mediaType: 'movie' | 'tv',
    subtype: string
  ): TemplateContext {
    return {
      ...this.getDefaultContext(),
      mediaType,
      subtype: this.getImdbSubtypeLabel(subtype),
    };
  }

  /**
   * Create context for Letterboxd collections
   */
  public createLetterboxdContext(
    mediaType: 'movie' | 'tv',
    subtype: string
  ): TemplateContext {
    return {
      ...this.getDefaultContext(),
      mediaType,
      subtype: this.getLetterboxdSubtypeLabel(subtype),
    };
  }

  /**
   * Create context for Overseerr collections
   */
  public createOverseerrContext(
    mediaType: 'movie' | 'tv' | 'both',
    user: { displayName?: string; username?: string; plexUsername?: string; plexTitle?: string },
    customDays?: number
  ): TemplateContext {
    const context: TemplateContext = {
      ...this.getDefaultContext(),
      mediaType,
      nickname: user.plexTitle || user.displayName || user.username || user.plexUsername || 'User',
      username: user.username || user.plexUsername || 'User',
      displayName: user.displayName || user.username || user.plexUsername || 'User',
    };

    // Only add customDays if explicitly provided (for backwards compatibility)
    if (customDays !== undefined) {
      context.days = customDays;
      context.customdays = customDays;
    }

    return context;
  }

  /**
   * Convert media type to human-readable label
   */
  private getMediaTypeLabel(mediaType: 'movie' | 'tv' | 'both'): string {
    switch (mediaType) {
      case 'movie':
        return 'Movie';
      case 'tv':
        return 'TV Show';
      case 'both':
        return 'Movie & TV Show'; // Fallback, should be handled by caller
      default:
        return 'Media';
    }
  }

  /**
   * Convert stat type to human-readable label
   */
  private getStatTypeLabel(statType: string): string {
    switch (statType) {
      case 'plays':
        return 'Play Count';
      case 'duration':
        return 'Watch Duration';
      default:
        return statType;
    }
  }

  /**
   * Get human-readable label for Tautulli subtype
   */
  private getTautulliSubtypeLabel(subtype: string): string {
    switch (subtype) {
      case 'most_popular_plays':
      case 'most_popular_duration':
        return 'Most Popular';
      case 'most_watched_plays':
      case 'most_watched_duration':
        return 'Most Watched';
      default:
        return subtype;
    }
  }

  /**
   * Get human-readable label for Trakt subtype
   */
  private getTraktSubtypeLabel(subtype: string): string {
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

  /**
   * Get human-readable label for TMDb subtype
   */
  private getTmdbSubtypeLabel(subtype: string): string {
    switch (subtype) {
      case 'trending_day':
        return 'Trending Today';
      case 'trending_week':
        return 'Trending This Week';
      case 'popular':
        return 'Popular';
      case 'top_rated':
        return 'Top Rated';
      case 'custom':
        return 'Custom Collection';
      default:
        return subtype
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
    }
  }

  /**
   * Get human-readable label for IMDb subtype
   */
  private getImdbSubtypeLabel(subtype: string): string {
    switch (subtype) {
      case 'top_250':
        return 'Top 250';
      case 'popular':
        return 'Popular';
      case 'most_popular':
        return 'Most Popular';
      case 'custom':
        return 'Custom List';
      default:
        return subtype
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
    }
  }

  /**
   * Get human-readable label for Letterboxd subtype
   */
  private getLetterboxdSubtypeLabel(subtype: string): string {
    switch (subtype) {
      case 'custom':
        return 'Custom List';
      default:
        return subtype
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
    }
  }

  /**
   * Extract domain name from URL
   */
  private extractDomainFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname;
    } catch {
      // Fallback for invalid URLs
      return url.replace(/^https?:\/\//, '').split('/')[0];
    }
  }

  /**
   * Create time-based template context with current date/time information
   * 
   * @param currentDate - Optional date to use (defaults to current date)
   * @returns TemplateContext with time-based placeholders
   */
  public createTimeBasedContext(currentDate?: Date): Partial<TemplateContext> {
    const now = currentDate || new Date();
    
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear().toString();
    
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    
    const dayNames = [
      'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
    ];
    
    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
    
    return {
      currentDate: `${day}-${month}`,
      currentMonth: monthNames[now.getMonth()],
      currentYear: year,
      currentDay: dayNames[dayOfWeek],
      isWeekend,
    };
  }

  /**
   * Enhance any template context with time-based information
   * 
   * @param baseContext - Base template context
   * @param currentDate - Optional date to use (defaults to current date)
   * @returns Enhanced context with time-based placeholders
   */
  public enhanceContextWithTime(
    baseContext: TemplateContext, 
    currentDate?: Date
  ): TemplateContext {
    const timeContext = this.createTimeBasedContext(currentDate);
    return {
      ...baseContext,
      ...timeContext,
    };
  }
}

// Export singleton instance
export const templateEngine = new TemplateEngine();