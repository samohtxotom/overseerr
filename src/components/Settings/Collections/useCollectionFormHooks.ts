import { useState, useCallback, useMemo } from 'react';
import { ValidationHelpers } from './CollectionFormValidation';
import type { CollectionConfig } from './types';

/**
 * Custom hooks for CollectionConfigForm
 */

// Types for hook parameters and returns
interface UseCollectionValidationOptions {
  libraries?: any[];
  realTimeValidation?: boolean;
}

interface UseCollectionValidationReturn {
  validateForm: (values: any) => Record<string, string>;
  validateField: (fieldName: string, value: any, allValues: any) => string | null;
  isFieldValid: (fieldName: string, value: any, allValues: any) => boolean;
  getFieldError: (fieldName: string, value: any, allValues: any) => string | null;
}

interface UseLibrarySelectionOptions {
  libraries: any[];
  mediaType?: 'movie' | 'tv' | 'both';
  detectedMediaType?: 'movie' | 'tv' | 'both' | null;
}

interface UseLibrarySelectionReturn {
  filteredLibraries: any[];
  availableLibraries: any[];
  isLibraryCompatible: (library: any) => boolean;
  validateLibrarySelection: (selectedIds: string[]) => string | null;
  getLibrarySelectionWarning: (selectedIds: string[]) => string | null;
}

interface UseTitleFetchingOptions {
  onSuccess?: (title: string, mediaType?: 'movie' | 'tv' | 'both') => void;
  onError?: (error: string) => void;
}

interface UseTitleFetchingReturn {
  fetchTraktTitle: (url: string, setFieldValue?: (field: string, value: any) => void) => Promise<void>;
  fetchTmdbTitle: (url: string, setFieldValue?: (field: string, value: any) => void) => Promise<void>;
  fetchImdbTitle: (url: string, setFieldValue?: (field: string, value: any) => void) => Promise<void>;
  fetchLetterboxdTitle: (url: string, setFieldValue?: (field: string, value: any) => void) => Promise<void>;
  isLoading: boolean;
  lastError: string | null;
}

/**
 * useCollectionValidation - Custom validation hook
 */
export const useCollectionValidation = ({
  libraries = [],
  realTimeValidation = true,
}: UseCollectionValidationOptions = {}): UseCollectionValidationReturn => {
  
  const validateForm = useCallback((values: any): Record<string, string> => {
    return ValidationHelpers.validateForm(values, libraries);
  }, [libraries]);

  const validateField = useCallback((fieldName: string, value: any, allValues: any): string | null => {
    switch (fieldName) {
      case 'template':
      case 'customMovieTemplate':
      case 'customTVTemplate':
        return ValidationHelpers.validateTemplates(allValues);
      
      case 'libraryIds':
        return ValidationHelpers.validateLibrarySelection(allValues, libraries);
      
      case 'traktCustomListUrl':
      case 'tmdbCustomCollectionUrl':
      case 'imdbCustomListUrl':
      case 'letterboxdCustomListUrl':
        return ValidationHelpers.validateCustomUrl(allValues);
      
      case 'visibilityConfig':
        return ValidationHelpers.validateVisibility(allValues);
      
      case 'searchMissingMovies':
      case 'autoApproveMovies':
      case 'searchMissingTV':
      case 'autoApproveTV':
      case 'maxSeasonsToRequest':
        return ValidationHelpers.validateAutoRequest(allValues);
      
      case 'timeRestriction':
        return ValidationHelpers.validateTimeRestrictions(allValues);
      
      default:
        return null;
    }
  }, [libraries]);

  const isFieldValid = useCallback((fieldName: string, value: any, allValues: any): boolean => {
    if (!realTimeValidation) return true;
    return validateField(fieldName, value, allValues) === null;
  }, [validateField, realTimeValidation]);

  const getFieldError = useCallback((fieldName: string, value: any, allValues: any): string | null => {
    if (!realTimeValidation) return null;
    return validateField(fieldName, value, allValues);
  }, [validateField, realTimeValidation]);

  return {
    validateForm,
    validateField,
    isFieldValid,
    getFieldError,
  };
};

/**
 * useLibrarySelection - Library filtering and validation hook
 */
export const useLibrarySelection = ({
  libraries,
  mediaType,
  detectedMediaType,
}: UseLibrarySelectionOptions): UseLibrarySelectionReturn => {

  // Filter libraries based on media type compatibility
  const filteredLibraries = useMemo(() => {
    const effectiveMediaType = detectedMediaType || mediaType;
    
    if (!effectiveMediaType || effectiveMediaType === 'both') {
      return libraries.filter(lib => lib.enabled);
    }
    
    return libraries.filter(lib => {
      if (!lib.enabled) return false;
      
      // Handle TV vs show type mapping
      const libraryType = lib.type === 'show' ? 'tv' : lib.type;
      return libraryType === effectiveMediaType;
    });
  }, [libraries, mediaType, detectedMediaType]);

  // Get all available libraries (enabled only)
  const availableLibraries = useMemo(() => {
    return libraries.filter(lib => lib.enabled);
  }, [libraries]);

  // Check if a library is compatible with current media type
  const isLibraryCompatible = useCallback((library: any): boolean => {
    const effectiveMediaType = detectedMediaType || mediaType;
    
    if (!effectiveMediaType || effectiveMediaType === 'both') {
      return true;
    }
    
    const libraryType = library.type === 'show' ? 'tv' : library.type;
    return libraryType === effectiveMediaType;
  }, [mediaType, detectedMediaType]);

  // Validate library selection
  const validateLibrarySelection = useCallback((selectedIds: string[]): string | null => {
    return ValidationHelpers.validateLibrarySelection({ libraryIds: selectedIds, mediaType }, libraries);
  }, [mediaType, libraries]);

  // Get warning message for library selection
  const getLibrarySelectionWarning = useCallback((selectedIds: string[]): string | null => {
    if (selectedIds.includes('all') && mediaType === 'both') {
      return 'When using "All Libraries" with "Both" media type, separate collections will be created for each media type.';
    }

    if (detectedMediaType && mediaType !== detectedMediaType) {
      return `Detected media type (${detectedMediaType}) differs from selected media type (${mediaType}). Some items may be filtered out.`;
    }

    const selectedLibraries = libraries.filter(lib => selectedIds.includes(lib.id));
    const incompatibleLibraries = selectedLibraries.filter(lib => !isLibraryCompatible(lib));
    
    if (incompatibleLibraries.length > 0) {
      return `Some selected libraries (${incompatibleLibraries.map(l => l.name).join(', ')}) may not be compatible with the selected media type.`;
    }

    return null;
  }, [mediaType, detectedMediaType, libraries, isLibraryCompatible]);

  return {
    filteredLibraries,
    availableLibraries,
    isLibraryCompatible,
    validateLibrarySelection,
    getLibrarySelectionWarning,
  };
};

/**
 * useTitleFetching - Custom URL title fetching hook
 */
export const useTitleFetching = ({
  onSuccess,
  onError,
}: UseTitleFetchingOptions = {}): UseTitleFetchingReturn => {
  const [isLoading, setIsLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const fetchTitle = useCallback(async (
    url: string,
    type: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd',
    setFieldValue?: (field: string, value: any) => void
  ) => {
    if (!url.trim()) {
      const error = `${type.toUpperCase()} URL is required`;
      setLastError(error);
      onError?.(error);
      return;
    }

    setIsLoading(true);
    setLastError(null);

    try {
      const response = await fetch('/api/v1/settings/plex/collections/fetch-title', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, type }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to fetch ${type} title`);
      }

      const data = await response.json();
      
      if (data.title) {
        // Update form field if setFieldValue is provided
        if (setFieldValue) {
          setFieldValue('template', data.title);
          
          // Set detected media type if available
          if (data.mediaType) {
            setFieldValue('mediaType', data.mediaType);
          }
        }

        onSuccess?.(data.title, data.mediaType);
      } else {
        throw new Error(`No title found for ${type} URL`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : `Failed to fetch ${type} title`;
      setLastError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [onSuccess, onError]);

  const fetchTraktTitle = useCallback((url: string, setFieldValue?: (field: string, value: any) => void) => {
    return fetchTitle(url, 'trakt', setFieldValue);
  }, [fetchTitle]);

  const fetchTmdbTitle = useCallback((url: string, setFieldValue?: (field: string, value: any) => void) => {
    return fetchTitle(url, 'tmdb', setFieldValue);
  }, [fetchTitle]);

  const fetchImdbTitle = useCallback((url: string, setFieldValue?: (field: string, value: any) => void) => {
    return fetchTitle(url, 'imdb', setFieldValue);
  }, [fetchTitle]);

  const fetchLetterboxdTitle = useCallback((url: string, setFieldValue?: (field: string, value: any) => void) => {
    return fetchTitle(url, 'letterboxd', setFieldValue);
  }, [fetchTitle]);

  return {
    fetchTraktTitle,
    fetchTmdbTitle,
    fetchImdbTitle,
    fetchLetterboxdTitle,
    isLoading,
    lastError,
  };
};

/**
 * useFormBehavior - Complex form behavior management
 */
interface UseFormBehaviorOptions {
  config?: CollectionConfig;
  libraries?: any[];
}

interface UseFormBehaviorReturn {
  // Form type detection
  isEnhancedForm: boolean;
  isRegularForm: boolean;
  isDefaultPlexHub: boolean;
  isPreExistingCollection: boolean;
  isLinkedHub: boolean;

  // Conditional field visibility
  shouldShowField: (fieldName: string, values: any) => boolean;
  shouldShowSection: (sectionName: string, values: any) => boolean;
  
  // Form state helpers
  getFormTitle: (values: any) => string;
  getFormDescription: (values: any) => string;
  
  // Field behavior
  isFieldReadOnly: (fieldName: string, values: any) => boolean;
  isFieldRequired: (fieldName: string, values: any) => boolean;
}

export const useFormBehavior = ({
  config,
  libraries = [],
}: UseFormBehaviorOptions = {}): UseFormBehaviorReturn => {

  // Form type detection
  const isEnhancedForm = useMemo(() => {
    const isPreExistingCollection = Boolean(config?.id && !(config as any)._isManaged);
    const isDefaultPlexHub = Boolean(config?.type === 'hub' && !(config as any)._isManaged);
    const isLinkedHub = Boolean(config?.type === 'hub' && (config as any)._isLinkedHub);
    
    return isPreExistingCollection || isDefaultPlexHub || isLinkedHub;
  }, [config]);

  const isRegularForm = !isEnhancedForm;
  const isDefaultPlexHub = Boolean(config?.type === 'hub' && !(config as any)._isManaged);
  const isPreExistingCollection = Boolean(config?.id && !(config as any)._isManaged && config?.type !== 'hub');
  const isLinkedHub = Boolean(config?.type === 'hub' && (config as any)._isLinkedHub);

  // Conditional field visibility
  const shouldShowField = useCallback((fieldName: string, values: any): boolean => {
    switch (fieldName) {
      case 'type':
      case 'subtype':
        return isRegularForm;
      
      case 'customDays':
        return values.type === 'tautulli';
      
      case 'traktCustomListUrl':
        return values.type === 'trakt' && values.subtype === 'custom';
      
      case 'tmdbCustomCollectionUrl':
        return values.type === 'tmdb' && values.subtype === 'custom';
      
      case 'imdbCustomListUrl':
        return values.type === 'imdb' && values.subtype === 'custom';
      
      case 'letterboxdCustomListUrl':
        return values.type === 'letterboxd' && values.subtype === 'custom';
      
      case 'template':
        return isRegularForm;
      
      case 'customMovieTemplate':
      case 'customTVTemplate':
        return isRegularForm && values.mediaType === 'both';
      
      case 'libraryIds':
        return true; // Always show library selection
      
      case 'maxItems':
        return isRegularForm;
      
      case 'customPoster':
        return !isDefaultPlexHub; // Hide for default Plex hubs
      
      case 'searchMissingMovies':
      case 'autoApproveMovies':
      case 'searchMissingTV':
      case 'autoApproveTV':
      case 'maxSeasonsToRequest':
        return isRegularForm && ['trakt', 'tmdb', 'imdb', 'letterboxd'].includes(values.type);
      
      default:
        return true;
    }
  }, [isRegularForm, isDefaultPlexHub]);

  const shouldShowSection = useCallback((sectionName: string, values: any): boolean => {
    switch (sectionName) {
      case 'collectionType':
        return isRegularForm;
      
      case 'customUrls':
        return isRegularForm && values.type && values.subtype === 'custom';
      
      case 'librarySelection':
        return values.type && values.subtype;
      
      case 'template':
        return isRegularForm && values.type && values.subtype;
      
      case 'visibility':
        return true; // Always show visibility
      
      case 'timeRestrictions':
        return true; // Always show time restrictions
      
      case 'autoRequest':
        return isRegularForm && ['trakt', 'tmdb', 'imdb', 'letterboxd'].includes(values.type);
      
      default:
        return true;
    }
  }, [isRegularForm]);

  const getFormTitle = useCallback((values: any): string => {
    if (config?.id) {
      return values.name || 'Edit Collection';
    }
    return 'Add New Collection';
  }, [config]);

  const getFormDescription = useCallback((values: any): string => {
    if (isPreExistingCollection) {
      return 'Pre-existing collection with limited configuration options';
    }
    if (isDefaultPlexHub) {
      return 'Built-in Plex hub with limited configuration options';
    }
    if (isLinkedHub) {
      return 'Linked hub - changes will apply to all linked libraries';
    }
    return 'Configure collection settings';
  }, [isPreExistingCollection, isDefaultPlexHub, isLinkedHub]);

  const isFieldReadOnly = useCallback((fieldName: string, values: any): boolean => {
    if (isEnhancedForm) {
      switch (fieldName) {
        case 'type':
        case 'subtype':
        case 'template':
        case 'libraryIds':
          return true;
        default:
          return false;
      }
    }
    return false;
  }, [isEnhancedForm]);

  const isFieldRequired = useCallback((fieldName: string, values: any): boolean => {
    switch (fieldName) {
      case 'type':
      case 'subtype':
      case 'template':
      case 'libraryIds':
      case 'mediaType':
        return !isEnhancedForm;
      
      case 'customDays':
        return values.type === 'tautulli';
      
      case 'traktCustomListUrl':
        return values.type === 'trakt' && values.subtype === 'custom';
      
      case 'tmdbCustomCollectionUrl':
        return values.type === 'tmdb' && values.subtype === 'custom';
      
      case 'imdbCustomListUrl':
        return values.type === 'imdb' && values.subtype === 'custom';
      
      case 'letterboxdCustomListUrl':
        return values.type === 'letterboxd' && values.subtype === 'custom';
      
      default:
        return false;
    }
  }, [isEnhancedForm]);

  return {
    isEnhancedForm,
    isRegularForm,
    isDefaultPlexHub,
    isPreExistingCollection,
    isLinkedHub,
    shouldShowField,
    shouldShowSection,
    getFormTitle,
    getFormDescription,
    isFieldReadOnly,
    isFieldRequired,
  };
};

