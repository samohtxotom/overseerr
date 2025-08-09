import { useState, useCallback } from 'react';
import type { CollectionConfig } from './types';

export interface FormState {
  // Loading states
  isLoadingTitle: {
    trakt: boolean;
    tmdb: boolean;
    imdb: boolean;
    letterboxd: boolean;
  };
  
  // Poster upload state
  posterUploading: boolean;
  
  // Detected media types from custom URLs
  detectedMediaTypes: {
    trakt: 'movie' | 'tv' | 'both' | null;
    tmdb: 'movie' | 'tv' | 'both' | null;
    imdb: 'movie' | 'tv' | 'both' | null;
    letterboxd: 'movie' | 'tv' | 'both' | null;
  };
  
  // Form state flags
  showSeparateTemplates: boolean;
  
  // Collection linking states
  isLinked: boolean;
  isLinkedHub: boolean;
  canBeLinked: boolean;
}

export interface FormStateActions {
  // Loading state management
  setTitleLoading: (type: keyof FormState['isLoadingTitle'], loading: boolean) => void;
  setPosterUploading: (loading: boolean) => void;
  
  // Media type detection
  setDetectedMediaType: (type: keyof FormState['detectedMediaTypes'], mediaType: 'movie' | 'tv' | 'both' | null) => void;
  
  // Template management
  setShowSeparateTemplates: (show: boolean) => void;
  
  // Collection linking
  setLinkedState: (linked: boolean, linkedHub: boolean, canLink: boolean) => void;
  
  // Reset functions
  resetLoadingStates: () => void;
  resetDetectedMediaTypes: () => void;
  resetAllState: () => void;
}

export interface FormStateManager extends FormState, FormStateActions {}

const initialFormState: FormState = {
  isLoadingTitle: {
    trakt: false,
    tmdb: false,
    imdb: false,
    letterboxd: false,
  },
  posterUploading: false,
  detectedMediaTypes: {
    trakt: null,
    tmdb: null,
    imdb: null,
    letterboxd: null,
  },
  showSeparateTemplates: false,
  isLinked: false,
  isLinkedHub: false,
  canBeLinked: false,
};

/**
 * FormStateManager - Centralized state management for CollectionConfigForm
 * 
 * Manages complex form state that isn't directly related to the form values
 * but affects form behavior, UI state, and user interactions.
 */
export const useFormStateManager = (config?: CollectionConfig): FormStateManager => {
  const [state, setState] = useState<FormState>(() => ({
    ...initialFormState,
    // Initialize state based on config
    isLinked: Boolean(config?.id && (config as any)._isLinked),
    isLinkedHub: Boolean(config?.id && (config as any)._isLinkedHub),
    canBeLinked: Boolean(!config?.id || !(config as any)._isLinked),
    showSeparateTemplates: Boolean(config?.customMovieTemplate && config?.customTVTemplate),
  }));

  // Loading state management
  const setTitleLoading = useCallback((type: keyof FormState['isLoadingTitle'], loading: boolean) => {
    setState(prev => ({
      ...prev,
      isLoadingTitle: {
        ...prev.isLoadingTitle,
        [type]: loading,
      },
    }));
  }, []);

  const setPosterUploading = useCallback((loading: boolean) => {
    setState(prev => ({
      ...prev,
      posterUploading: loading,
    }));
  }, []);

  // Media type detection
  const setDetectedMediaType = useCallback((
    type: keyof FormState['detectedMediaTypes'], 
    mediaType: 'movie' | 'tv' | 'both' | null
  ) => {
    setState(prev => ({
      ...prev,
      detectedMediaTypes: {
        ...prev.detectedMediaTypes,
        [type]: mediaType,
      },
    }));
  }, []);

  // Template management
  const setShowSeparateTemplates = useCallback((show: boolean) => {
    setState(prev => ({
      ...prev,
      showSeparateTemplates: show,
    }));
  }, []);

  // Collection linking
  const setLinkedState = useCallback((linked: boolean, linkedHub: boolean, canLink: boolean) => {
    setState(prev => ({
      ...prev,
      isLinked: linked,
      isLinkedHub: linkedHub,
      canBeLinked: canLink,
    }));
  }, []);

  // Reset functions
  const resetLoadingStates = useCallback(() => {
    setState(prev => ({
      ...prev,
      isLoadingTitle: {
        trakt: false,
        tmdb: false,
        imdb: false,
        letterboxd: false,
      },
      posterUploading: false,
    }));
  }, []);

  const resetDetectedMediaTypes = useCallback(() => {
    setState(prev => ({
      ...prev,
      detectedMediaTypes: {
        trakt: null,
        tmdb: null,
        imdb: null,
        letterboxd: null,
      },
    }));
  }, []);

  const resetAllState = useCallback(() => {
    setState(initialFormState);
  }, []);

  return {
    ...state,
    setTitleLoading,
    setPosterUploading,
    setDetectedMediaType,
    setShowSeparateTemplates,
    setLinkedState,
    resetLoadingStates,
    resetDetectedMediaTypes,
    resetAllState,
  };
};

/**
 * Helper functions for working with form state
 */
export const FormStateHelpers = {
  /**
   * Check if any title is currently being loaded
   */
  isAnyTitleLoading: (state: FormState): boolean => {
    return Object.values(state.isLoadingTitle).some(loading => loading);
  },

  /**
   * Check if any media type has been detected
   */
  hasDetectedMediaTypes: (state: FormState): boolean => {
    return Object.values(state.detectedMediaTypes).some(type => type !== null);
  },

  /**
   * Get the detected media type for a specific collection type
   */
  getDetectedMediaType: (state: FormState, collectionType: string): 'movie' | 'tv' | 'both' | null => {
    switch (collectionType) {
      case 'trakt':
        return state.detectedMediaTypes.trakt;
      case 'tmdb':
        return state.detectedMediaTypes.tmdb;
      case 'imdb':
        return state.detectedMediaTypes.imdb;
      case 'letterboxd':
        return state.detectedMediaTypes.letterboxd;
      default:
        return null;
    }
  },

  /**
   * Check if form is in a loading state that should disable submission
   */
  isFormBusy: (state: FormState): boolean => {
    return FormStateHelpers.isAnyTitleLoading(state) || state.posterUploading;
  },

  /**
   * Get appropriate loading message for current state
   */
  getLoadingMessage: (state: FormState): string | null => {
    if (state.posterUploading) return 'Uploading poster...';
    if (state.isLoadingTitle.trakt) return 'Fetching Trakt list...';
    if (state.isLoadingTitle.tmdb) return 'Fetching TMDb collection...';
    if (state.isLoadingTitle.imdb) return 'Fetching IMDb list...';
    if (state.isLoadingTitle.letterboxd) return 'Fetching Letterboxd list...';
    return null;
  },

  /**
   * Determine if enhanced form should be shown
   */
  isEnhancedForm: (config: CollectionConfig): boolean => {
    const isPreExistingCollection = Boolean(config.id && !(config as any)._isManaged);
    const isDefaultPlexHub = Boolean(config.type === 'hub' && !(config as any)._isManaged);
    const isLinkedHub = Boolean(config.type === 'hub' && (config as any)._isLinkedHub);
    
    return isPreExistingCollection || isDefaultPlexHub || isLinkedHub;
  },

  /**
   * Check if collection can be linked to other libraries
   */
  canLinkCollection: (config: CollectionConfig, state: FormState): boolean => {
    if (state.isLinked) return false;
    if (config.type !== 'hub') return false;
    return Boolean(config.id && !(config as any)._isLinked);
  },
};

export default useFormStateManager;