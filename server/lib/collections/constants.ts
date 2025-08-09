/**
 * Essential constants for Plex Collections feature
 * 
 * @deprecated Most values have been moved to ConfigurationConstants.ts
 * This file is maintained for backward compatibility
 */

import { 
  LABEL_CONFIG, 
  BATCH_CONFIG, 
  SORT_CONFIG, 
  CACHE_CONFIG 
} from './ConfigurationConstants';

// Label constants (now configurable)
export const LABELS = {
  PREFIX: LABEL_CONFIG.LEGACY_PREFIX,
} as const;

// Basic constants (now configurable where appropriate)
export const DEFAULTS = {
  ADMIN_USER_ID: 1, // This remains hardcoded as it's a system constant
  BATCH_SIZE: BATCH_CONFIG.COLLECTION_BATCH_SIZE,
  EMPTY_LENGTH: 0, // This remains hardcoded as it's a language constant
} as const;

// Character sanitization patterns (these remain static)
export const SANITIZATION = {
  UNSAFE_CHARS: /[<>"'&]/g,
  WHITESPACE: /\s+/g,
} as const;

// Sort title prefix for collections (now configurable)
export const SORT_CONSTANTS = {
  COLLECTION_SORT_PREFIX: SORT_CONFIG.SORT_PREFIXES.MEDIUM_PRIORITY,
} as const;

// Cache settings (now configurable)
export const CACHE_SETTINGS = {
  SHARED_SERVER_TTL: CACHE_CONFIG.SHARED_SERVER_TTL,
  TOKEN_CACHE_LENGTH: 8, // This remains hardcoded as it's a technical constant
} as const;
