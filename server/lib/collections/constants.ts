/**
 * Essential constants for Plex Collections feature
 */

// Label constants
export const LABELS = {
  PREFIX: 'overseerr',
} as const;

// Basic constants
export const DEFAULTS = {
  ADMIN_USER_ID: 1,
  BATCH_SIZE: 5,
  EMPTY_LENGTH: 0,
} as const;

// Character sanitization patterns
export const SANITIZATION = {
  UNSAFE_CHARS: /[<>"'&]/g,
  WHITESPACE: /\s+/g,
} as const;

// Removed: COLLECTION_THRESHOLDS - always recreate collections

// Sort title prefix for collections
export const SORT_CONSTANTS = {
  COLLECTION_SORT_PREFIX: '!!',
} as const;

// Simple cache settings
export const CACHE_SETTINGS = {
  SHARED_SERVER_TTL: 5 * 60 * 1000, // 5 minutes
  TOKEN_CACHE_LENGTH: 8,
} as const;
