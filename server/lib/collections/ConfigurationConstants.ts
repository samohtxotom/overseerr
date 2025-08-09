import { getSettings } from '@server/lib/settings';

/**
 * Centralized configuration constants for the collections system
 * 
 * This file replaces hardcoded values throughout the collections system
 * with configurable settings that can be customized via environment variables
 * or application settings.
 */

// Environment variable helpers
const getEnvNumber = (key: string, defaultValue: number): number => {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
};

const getEnvString = (key: string, defaultValue: string): string => {
  return process.env[key] || defaultValue;
};

const getEnvBoolean = (key: string, defaultValue: boolean): boolean => {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
};

/**
 * API and Network Configuration
 */
export const API_CONFIG = {
  // HTTP request timeouts (milliseconds)
  HTTP_TIMEOUT: getEnvNumber('COLLECTIONS_HTTP_TIMEOUT', 10000),
  
  // Rate limiting configuration
  RATE_LIMIT: {
    MAX_ATTEMPTS: getEnvNumber('COLLECTIONS_RATE_LIMIT_MAX_ATTEMPTS', 3),
    MAX_DELAY_MS: getEnvNumber('COLLECTIONS_RATE_LIMIT_MAX_DELAY', 30000),
    BASE_DELAY_MS: getEnvNumber('COLLECTIONS_RATE_LIMIT_BASE_DELAY', 1000),
    BACKOFF_MULTIPLIER: getEnvNumber('COLLECTIONS_RATE_LIMIT_BACKOFF', 2),
  },
  
  // Retry configuration for failed operations
  RETRY: {
    MAX_ATTEMPTS: getEnvNumber('COLLECTIONS_RETRY_MAX_ATTEMPTS', 3),
    INITIAL_DELAY_MS: getEnvNumber('COLLECTIONS_RETRY_INITIAL_DELAY', 1000),
    BACKOFF_MULTIPLIER: getEnvNumber('COLLECTIONS_RETRY_BACKOFF_MULTIPLIER', 2),
  },
  
  // User agent for web scraping
  USER_AGENT: getEnvString(
    'COLLECTIONS_USER_AGENT',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ),
};

/**
 * Collection Processing Limits
 */
export const COLLECTION_LIMITS = {
  // Default maximum items in a collection
  DEFAULT_MAX_ITEMS: getEnvNumber('COLLECTIONS_DEFAULT_MAX_ITEMS', 1000),
  
  // Maximum collection name length
  MAX_NAME_LENGTH: getEnvNumber('COLLECTIONS_MAX_NAME_LENGTH', 100),
  
  // Minimum activity thresholds
  MINIMUM_PLAYS: getEnvNumber('COLLECTIONS_MINIMUM_PLAYS', 3),
  
  // Default time periods (days)
  DEFAULT_TIME_PERIOD_DAYS: getEnvNumber('COLLECTIONS_DEFAULT_TIME_PERIOD', 30),
  
  // Auto-request limits
  AUTO_REQUEST: {
    MAX_SEASONS: getEnvNumber('COLLECTIONS_AUTO_REQUEST_MAX_SEASONS', 3),
  },
};

/**
 * Batch Processing Configuration
 */
export const BATCH_CONFIG = {
  // Collection processing batch size
  COLLECTION_BATCH_SIZE: getEnvNumber('COLLECTIONS_BATCH_SIZE', 5),
  
  // User fetch limits
  USER_FETCH_LIMIT: getEnvNumber('COLLECTIONS_USER_FETCH_LIMIT', 1000),
  
  // Request fetch limits
  REQUEST_FETCH_LIMIT: getEnvNumber('COLLECTIONS_REQUEST_FETCH_LIMIT', 5000),
  
  // Progress reporting intervals
  PROGRESS_LOG_INTERVAL_LARGE: getEnvNumber('COLLECTIONS_PROGRESS_INTERVAL_LARGE', 10),
  PROGRESS_LOG_INTERVAL_SMALL: getEnvNumber('COLLECTIONS_PROGRESS_INTERVAL_SMALL', 5),
  PROGRESS_LOG_THRESHOLD: getEnvNumber('COLLECTIONS_PROGRESS_THRESHOLD', 50),
};

/**
 * Cache Configuration
 */
export const CACHE_CONFIG = {
  // Shared server cache TTL (milliseconds)
  SHARED_SERVER_TTL: getEnvNumber('COLLECTIONS_CACHE_SHARED_SERVER_TTL', 5 * 60 * 1000),
  
  // Collection metadata cache TTL
  COLLECTION_METADATA_TTL: getEnvNumber('COLLECTIONS_CACHE_METADATA_TTL', 10 * 60 * 1000),
};

/**
 * Sort Order Configuration
 */
export const SORT_CONFIG = {
  // Maximum exclamation marks for sort prefixes
  MAX_SORT_PREFIX_LENGTH: getEnvNumber('COLLECTIONS_MAX_SORT_PREFIX_LENGTH', 20),
  
  // Sort prefix patterns
  SORT_PREFIXES: {
    HIGH_PRIORITY: getEnvString('COLLECTIONS_SORT_PREFIX_HIGH', '!!!'),
    MEDIUM_PRIORITY: getEnvString('COLLECTIONS_SORT_PREFIX_MEDIUM', '!!'),
    LOW_PRIORITY: getEnvString('COLLECTIONS_SORT_PREFIX_LOW', '!'),
  },
  
  // ID multiplier for expanded configs (to avoid conflicts)
  CONFIG_ID_MULTIPLIER: getEnvNumber('COLLECTIONS_CONFIG_ID_MULTIPLIER', 1000),
};

/**
 * Sync Operation Configuration
 */
export const SYNC_CONFIG = {
  // Graceful shutdown timeout configuration
  SHUTDOWN: {
    MAX_WAIT_ITERATIONS: getEnvNumber('COLLECTIONS_SHUTDOWN_MAX_WAIT', 50),
    WAIT_INTERVAL_MS: getEnvNumber('COLLECTIONS_SHUTDOWN_WAIT_INTERVAL', 100),
    TOTAL_TIMEOUT_MS: function() {
      return this.MAX_WAIT_ITERATIONS * this.WAIT_INTERVAL_MS;
    },
  },
  
  // Rate limiting between API-heavy operations
  API_DELAY_MS: getEnvNumber('COLLECTIONS_API_DELAY', 1000),
};

/**
 * Label and Branding Configuration
 */
export const LABEL_CONFIG = {
  // Collection label prefix for identification
  COLLECTION_PREFIX: getEnvString('COLLECTIONS_LABEL_PREFIX', 'Agregarr'),
  
  // Legacy prefix (for cleanup operations)
  LEGACY_PREFIX: getEnvString('COLLECTIONS_LEGACY_PREFIX', 'overseerr'),
  
  // Enable custom branding
  ENABLE_CUSTOM_BRANDING: getEnvBoolean('COLLECTIONS_ENABLE_CUSTOM_BRANDING', false),
};

/**
 * Debug and Logging Configuration
 */
export const DEBUG_CONFIG = {
  // Enable verbose logging
  VERBOSE_LOGGING: getEnvBoolean('COLLECTIONS_VERBOSE_LOGGING', false),
  
  // Log performance metrics
  LOG_PERFORMANCE: getEnvBoolean('COLLECTIONS_LOG_PERFORMANCE', false),
  
  // Enable debug mode
  DEBUG_MODE: getEnvBoolean('COLLECTIONS_DEBUG_MODE', false),
};

/**
 * Get runtime configuration that can be modified via application settings
 * This allows certain values to be overridden by user preferences
 */
export function getRuntimeConfig() {
  const settings = getSettings();
  const plexSettings = settings.plex || {};
  const collectionSettings = (plexSettings as any).collections || {};
  
  return {
    // Allow users to override default max items via settings
    defaultMaxItems: collectionSettings.defaultMaxItems || COLLECTION_LIMITS.DEFAULT_MAX_ITEMS,
    
    // Allow users to configure timeouts
    httpTimeout: collectionSettings.httpTimeout || API_CONFIG.HTTP_TIMEOUT,
    
    // Allow users to configure batch sizes
    batchSize: collectionSettings.batchSize || BATCH_CONFIG.COLLECTION_BATCH_SIZE,
    
    // Allow users to configure retry behavior
    maxRetries: collectionSettings.maxRetries || API_CONFIG.RETRY.MAX_ATTEMPTS,
    
    // Allow users to configure cache TTL
    cacheTtl: collectionSettings.cacheTtl || CACHE_CONFIG.SHARED_SERVER_TTL,
    
    // Allow users to configure sort behavior
    sortConfig: {
      maxPrefixLength: collectionSettings.maxSortPrefixLength || SORT_CONFIG.MAX_SORT_PREFIX_LENGTH,
      highPriorityPrefix: collectionSettings.highPriorityPrefix || SORT_CONFIG.SORT_PREFIXES.HIGH_PRIORITY,
      mediumPriorityPrefix: collectionSettings.mediumPriorityPrefix || SORT_CONFIG.SORT_PREFIXES.MEDIUM_PRIORITY,
      lowPriorityPrefix: collectionSettings.lowPriorityPrefix || SORT_CONFIG.SORT_PREFIXES.LOW_PRIORITY,
    },
    
    // Allow users to configure branding
    labelPrefix: collectionSettings.labelPrefix || LABEL_CONFIG.COLLECTION_PREFIX,
    
    // Allow users to configure debug settings
    debug: {
      verboseLogging: collectionSettings.verboseLogging || DEBUG_CONFIG.VERBOSE_LOGGING,
      logPerformance: collectionSettings.logPerformance || DEBUG_CONFIG.LOG_PERFORMANCE,
    },
  };
}

/**
 * Validation functions to ensure configuration values are reasonable
 */
export const VALIDATION = {
  isValidTimeout: (timeout: number): boolean => timeout > 0 && timeout <= 300000, // Max 5 minutes
  isValidMaxItems: (maxItems: number): boolean => maxItems > 0 && maxItems <= 10000,
  isValidBatchSize: (batchSize: number): boolean => batchSize > 0 && batchSize <= 100,
  isValidRetries: (retries: number): boolean => retries >= 0 && retries <= 10,
  isValidNameLength: (length: number): boolean => length > 0 && length <= 255,
  isValidTtl: (ttl: number): boolean => ttl > 0 && ttl <= 24 * 60 * 60 * 1000, // Max 24 hours
};

/**
 * Get validated configuration value with fallback
 */
export function getValidatedConfig<T>(
  value: T,
  validator: (val: T) => boolean,
  fallback: T,
  configName: string
): T {
  if (validator(value)) {
    return value;
  }
  
  console.warn(
    `Invalid configuration value for ${configName}: ${value}. Using fallback: ${fallback}`
  );
  return fallback;
}

export default {
  API_CONFIG,
  COLLECTION_LIMITS,
  BATCH_CONFIG,
  CACHE_CONFIG,
  SORT_CONFIG,
  SYNC_CONFIG,
  LABEL_CONFIG,
  DEBUG_CONFIG,
  getRuntimeConfig,
  VALIDATION,
  getValidatedConfig,
};