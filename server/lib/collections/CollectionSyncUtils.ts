import type { CollectionSource } from './types';
import { COLLECTION_LIMITS, LABEL_CONFIG } from './ConfigurationConstants';

/**
 * Utility class for common collection sync operations
 */
export class CollectionSyncUtils {
  /**
   * Create standardized collection label for identification
   */
  static createCollectionLabel(source: CollectionSource, configId: number, userId?: number): string {
    const baseParts = [LABEL_CONFIG.COLLECTION_PREFIX, source, configId.toString()];
    
    if (userId !== undefined) {
      baseParts.push('user', userId.toString());
    }
    
    return baseParts.join('');
  }

  /**
   * Parse collection label to extract metadata
   */
  static parseCollectionLabel(label: string): {
    source: CollectionSource;
    configId: number;
    userId?: number;
  } | null {
    // Expect format: Agregarr{source}{configId}[user{userId}]
    const match = label.match(/^Agregarr([a-z]+)(\d+)(?:user(\d+))?$/i);
    
    if (!match) return null;
    
    const [, sourceStr, configIdStr, userIdStr] = match;
    const parts = [sourceStr, configIdStr, userIdStr].filter(Boolean);
    
    if (parts.length < 2) return null;

    const result: any = {
      source: parts[0] as CollectionSource,
      configId: parseInt(parts[1], 10),
    };

    if (parts.length >= 3) {
      result.userId = parseInt(parts[2], 10);
    }

    return result;
  }

  /**
   * Calculate progress percentage
   */
  static calculateProgress(current: number, total: number): number {
    if (total === 0) return 100;
    return Math.round((current / total) * 100);
  }

  /**
   * Create a delay for rate limiting
   */
  static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Sanitize collection name for Plex compatibility
   */
  static sanitizeCollectionName(name: string): string {
    // Remove or replace characters that could cause issues in Plex
    return name
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid file system characters
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, '') // Remove control characters
      .trim()
      .substring(0, COLLECTION_LIMITS.MAX_NAME_LENGTH); // Limit length to avoid Plex issues
  }

  /**
   * Validate collection configuration has required fields
   */
  static validateRequiredFields(config: any, requiredFields: string[]): string[] {
    const missingFields: string[] = [];
    
    for (const field of requiredFields) {
      const value = field.includes('.') 
        ? field.split('.').reduce((obj, key) => obj?.[key], config)
        : config[field];
        
      if (value === undefined || value === null || value === '') {
        missingFields.push(field);
      }
    }
    
    return missingFields;
  }

  /**
   * Create a standardized error message with context
   */
  static createErrorMessage(
    source: CollectionSource,
    operation: string,
    error: any,
    context?: Record<string, any>
  ): string {
    const errorStr = error instanceof Error ? error.message : String(error);
    const contextStr = context ? ` (${Object.entries(context).map(([k, v]) => `${k}: ${v}`).join(', ')})` : '';
    
    return `${source} ${operation} failed: ${errorStr}${contextStr}`;
  }

  /**
   * Check if items array contains valid collection items
   */
  static validateCollectionItems(items: any[]): {
    valid: any[];
    invalid: any[];
    errors: string[];
  } {
    const valid: any[] = [];
    const invalid: any[] = [];
    const errors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      if (!item) {
        invalid.push(item);
        errors.push(`Item ${i}: null or undefined`);
        continue;
      }

      if (!item.ratingKey || typeof item.ratingKey !== 'string') {
        invalid.push(item);
        errors.push(`Item ${i}: missing or invalid ratingKey`);
        continue;
      }

      if (!item.type || !['movie', 'tv'].includes(item.type)) {
        invalid.push(item);
        errors.push(`Item ${i}: missing or invalid type (${item.type})`);
        continue;
      }

      valid.push(item);
    }

    return { valid, invalid, errors };
  }

  /**
   * Group items by media type
   */
  static groupItemsByMediaType(items: any[]): {
    movies: any[];
    tv: any[];
  } {
    return items.reduce(
      (acc, item) => {
        if (item.type === 'movie') {
          acc.movies.push(item);
        } else if (item.type === 'tv') {
          acc.tv.push(item);
        }
        return acc;
      },
      { movies: [], tv: [] }
    );
  }

  /**
   * Create retry wrapper for unreliable operations
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000,
    backoffMultiplier: number = 2
  ): Promise<T> {
    let lastError: Error;
    let currentDelay = delayMs;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt === maxRetries) {
          throw lastError;
        }
        
        await this.delay(currentDelay);
        currentDelay *= backoffMultiplier;
      }
    }

    throw lastError!;
  }

  /**
   * Check if a value is a valid Plex rating key
   */
  static isValidPlexRatingKey(value: any): value is string {
    return typeof value === 'string' && 
           value.length > 0 && 
           /^\d+$/.test(value) && 
           parseInt(value, 10) > 0;
  }

  /**
   * Extract numeric ID from various ID formats
   */
  static extractNumericId(id: any): number | null {
    if (typeof id === 'number') return id > 0 ? id : null;
    if (typeof id === 'string') {
      const parsed = parseInt(id, 10);
      return !isNaN(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
  }
}

export default CollectionSyncUtils;