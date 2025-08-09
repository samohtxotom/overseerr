/**
 * Collection configuration types for the Plex Collections UI
 * Extracted from SettingsPlex.tsx to improve maintainability
 */

export interface CollectionConfig {
  readonly id: number | string; // number for collections, string for hubs
  readonly name: string; // User-entered collection name
  readonly type?: 'overseerr' | 'tautulli' | 'trakt' | 'tmdb' | 'imdb' | 'letterboxd' | 'hub';
  readonly subtype: string; // Specific option like 'users', 'most_popular_plays', etc.
  readonly template: string; // Collection title template (for preset templates or single media type)
  readonly customMovieTemplate?: string; // Custom template for movie collections when mediaType is 'both'
  readonly customTVTemplate?: string; // Custom template for TV collections when mediaType is 'both'
  readonly visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
    libraryTabOnly: boolean;
  };
  readonly maxItems: number;
  readonly mediaType?: 'movie' | 'tv' | 'both';
  readonly libraryId?: string | string[]; // Selected library ID(s) - single string for backward compatibility, array for multiple selection
  readonly libraryIds?: string[]; // New: Array of selected library IDs (replaces single libraryId)
  readonly libraryName?: string; // Selected library name for display (for single library) 
  readonly libraryNames?: string[]; // New: Array of selected library names for display (for multiple libraries)
  readonly sortOrderHome?: number; // Order for Plex home screen (creation time based)
  readonly sortOrderLibrary?: number; // Order for Plex library tab (sortTitle based)
  readonly parentConfigId?: number; // Reference to original config when expanded from 'all' libraries
  readonly isExpandedConfig?: boolean; // True if this config was auto-generated from a parent 'all' config
  readonly collectionRatingKey?: string; // Plex collection rating key for reordering (e.g., "35955")
  readonly collectionRatingKeys?: Record<string, string>; // Multiple rating keys by library ID (e.g., {"1": "35954", "2": "35955"})
  // Library-specific sort orders (dynamic keys like "1_sortOrderHome", "1_sortOrderLibrary", etc.)
  readonly [key: string]: any; // Allows dynamic library-specific sort order keys
  readonly customDays?: number; // Number of days for Tautulli collections
  readonly tautulliStatType?: 'plays' | 'duration'; // Tautulli stat type
  readonly searchMissingMovies?: boolean; // Auto-request missing movies
  readonly searchMissingTV?: boolean; // Auto-request missing TV shows
  readonly autoApproveMovies?: boolean; // Auto-approve movie requests
  readonly autoApproveTV?: boolean; // Auto-approve TV show requests
  readonly maxSeasonsToRequest?: number; // Max seasons for auto-approval
  // Trakt custom list fields
  readonly traktCustomListUrl?: string; // Custom Trakt list URL
  // TMDb custom list fields
  readonly tmdbCustomListUrl?: string; // Custom TMDb list/collection URL
  // IMDb custom list fields
  readonly imdbCustomListUrl?: string; // Custom IMDb list URL
  // Letterboxd custom list fields
  readonly letterboxdCustomListUrl?: string; // Custom Letterboxd list URL
  // Generic ordering options (applicable to all collection types)
  readonly reverseOrder?: boolean; // Reverse the order of items from the source
  readonly randomizeOrder?: boolean; // Randomize the order of items (mutually exclusive with reverseOrder)
  // Poster settings
  readonly customPoster?: string; // Path to custom poster image file
  // Time restriction settings
  readonly timeRestriction?: {
    readonly alwaysActive: boolean; // If true, collection is always active (default)
    readonly removeFromPlexWhenInactive?: boolean; // If true, completely remove from Plex when inactive (old behavior)
    readonly inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
      libraryTabOnly: boolean;
    }; // Visibility settings to use when collection is inactive (only used if removeFromPlexWhenInactive is false)
    readonly dateRanges?: readonly {
      readonly startDate: string; // DD-MM format (e.g., "05-12" for 5th December)
      readonly endDate: string; // DD-MM format (e.g., "26-12" for 26th December)
    }[];
    readonly weeklySchedule?: {
      readonly monday: boolean;
      readonly tuesday: boolean;
      readonly wednesday: boolean;
      readonly thursday: boolean;
      readonly friday: boolean;
      readonly saturday: boolean;
      readonly sunday: boolean;
    };
  };
  // Clear categorization flags (same as PlexHubConfig for consistency)
  readonly isDefaultPlexHub?: boolean; // True for built-in algorithmic hubs (e.g., "Recently Added")  
  readonly isAgregarrManaged?: boolean; // True if this collection/hub was created by Agregarr
  readonly isPromotedToHub?: boolean; // True if this is a collection promoted to appear on home screen
}

export interface TemplatePreset {
  label: string;
  value: string;
}

export interface VisibilityCheckboxState {
  enabled: boolean;
  label: string;
  description?: string;
}

export interface SubtypeOption {
  label: string;
  value: string;
  description?: string;
}

export interface Library {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly type: 'movie' | 'show';
}

export interface CollectionConfigFormProps {
  config: CollectionConfig;
  onSave: (config: CollectionConfig) => void;
  onCancel: () => void;
  onUnlink?: (config: CollectionConfig) => void;
  onLink?: (config: CollectionConfig) => void;
  isEditing?: boolean;
  libraries: Library[];
  // Additional data needed for link/unlink detection
  allCollectionConfigs?: CollectionConfig[];
  allHubConfigs?: any[];
}

export interface CollectionConfigListProps {
  configs: CollectionConfig[];
  onEdit: (config: CollectionConfig) => void;
  onDelete: (configId: number | string) => void;
  onAdd: () => void;
}

export interface CollectionSettingsProps {
  collectionConfigs: CollectionConfig[];
  libraries?: Library[]; // Optional - component can fetch directly from Plex
  onUpdateConfigs: (configs: CollectionConfig[]) => void;
}

/**
 * Configuration for Plex hubs (built-in hubs + promoted collections)
 * Hubs are what actually appear on the Plex home screen
 */
export interface PlexHubConfig {
  readonly id: string; // Use hub identifier as ID (e.g., "1-movie.recentlyadded")  
  readonly hubIdentifier: string; // Plex hub identifier (e.g., "movie.recentlyadded" or "custom.collection.1.35954")
  readonly name: string; // Display name (e.g., "Recently Added Movies")
  readonly libraryId: string; // Library ID this hub belongs to
  readonly libraryName: string; // Library display name
  readonly mediaType: 'movie' | 'tv'; // Media type (hubs are always single type)
  readonly sortOrderLibrary: number; // Position in library
  readonly sourceCollectionId?: number; // ID of the source collection config if this is a promoted collection
  readonly visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
    libraryTabOnly: boolean;
  };
  // Clear categorization flags
  readonly isDefaultPlexHub: boolean; // True for built-in algorithmic hubs (e.g., "Recently Added")  
  readonly isAgregarrManaged: boolean; // True if this collection/hub was created by Agregarr
  readonly isPromotedToHub: boolean; // True if this is a collection promoted to appear on home screen
}

export type CollectionType = 'overseerr' | 'tautulli' | 'trakt' | 'tmdb' | 'imdb' | 'letterboxd' | 'hub';
export type MediaType = 'movie' | 'tv' | 'both';
