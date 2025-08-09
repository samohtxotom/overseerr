import * as Yup from 'yup';
import type { CollectionConfig } from './types';

/**
 * Collection form validation schemas and utilities
 */

// Base validation schema for all collection types
const baseCollectionSchema = {
  type: Yup.string().required('Collection type is required'),
  subtype: Yup.string().required('Collection sub-type is required'),
  
  template: Yup.string().when(['customMovieTemplate', 'customTVTemplate'], {
    is: (movieTemplate: string, tvTemplate: string) => !movieTemplate && !tvTemplate,
    then: (schema) => schema.required('Collection title template is required'),
    otherwise: (schema) => schema,
  }),

  customMovieTemplate: Yup.string(),
  customTVTemplate: Yup.string(),

  libraryIds: Yup.array()
    .of(Yup.string())
    .min(1, 'At least one library must be selected')
    .required('Library selection is required'),

  mediaType: Yup.string()
    .oneOf(['movie', 'tv', 'both'], 'Invalid media type')
    .required('Media type is required'),

  visibilityConfig: Yup.object().shape({
    usersHome: Yup.boolean(),
    serverOwnerHome: Yup.boolean(),
    libraryRecommended: Yup.boolean(),
    libraryTabOnly: Yup.boolean(),
  }),

  maxItems: Yup.number()
    .min(1, 'Must be at least 1 item')
    .max(1000, 'Cannot exceed 1000 items')
    .required('Max items is required'),

  customPoster: Yup.string().url('Must be a valid URL'),
};

// Tautulli-specific validation
const tautulliValidation = {
  customDays: Yup.number().when('type', {
    is: 'tautulli',
    then: (schema) => schema
      .min(1, 'Must be at least 1 day')
      .max(365, 'Cannot exceed 365 days')
      .required('Custom days is required for Tautulli collections'),
    otherwise: (schema) => schema,
  }),

  tautulliStatType: Yup.string().when('type', {
    is: 'tautulli',
    then: (schema) => schema.oneOf(['plays', 'duration'], 'Invalid Tautulli stat type'),
    otherwise: (schema) => schema,
  }),
};

// Custom URL validations for different services
const customUrlValidations = {
  traktCustomListUrl: Yup.string().when(['type', 'subtype'], {
    is: (type: string, subtype: string) => type === 'trakt' && subtype === 'custom',
    then: (schema) => schema
      .required('Trakt list URL is required')
      .matches(
        /trakt\.tv\/users\/[^/]+\/lists\/[^/?]+/,
        'Please enter a valid Trakt list URL (e.g., https://trakt.tv/users/username/lists/listname)'
      ),
    otherwise: (schema) => schema,
  }),

  tmdbCustomCollectionUrl: Yup.string().when(['type', 'subtype'], {
    is: (type: string, subtype: string) => type === 'tmdb' && subtype === 'custom',
    then: (schema) => schema
      .required('TMDb collection URL is required')
      .matches(
        /themoviedb\.org\/collection\/\d+/,
        'Please enter a valid TMDb collection URL (e.g., https://www.themoviedb.org/collection/12345)'
      ),
    otherwise: (schema) => schema,
  }),

  imdbCustomListUrl: Yup.string().when(['type', 'subtype'], {
    is: (type: string, subtype: string) => type === 'imdb' && subtype === 'custom',
    then: (schema) => schema
      .required('IMDb list URL is required')
      .matches(
        /imdb\.com\/list\/ls\d+/,
        'Please enter a valid IMDb list URL (e.g., https://www.imdb.com/list/ls123456789/)'
      ),
    otherwise: (schema) => schema,
  }),

  letterboxdCustomListUrl: Yup.string().when(['type', 'subtype'], {
    is: (type: string, subtype: string) => type === 'letterboxd' && subtype === 'custom',
    then: (schema) => schema
      .required('Letterboxd list URL is required')
      .matches(
        /letterboxd\.com\/[^/]+\/list\/[^/?]+/,
        'Please enter a valid Letterboxd list URL (e.g., https://letterboxd.com/username/list/list-name/)'
      ),
    otherwise: (schema) => schema,
  }),
};

// Auto-request validation
const autoRequestValidations = {
  searchMissingMovies: Yup.boolean(),
  autoApproveMovies: Yup.boolean(),
  searchMissingTV: Yup.boolean(),
  autoApproveTV: Yup.boolean(),

  maxSeasonsToRequest: Yup.number().when(['searchMissingTV', 'autoApproveTV'], {
    is: (searchMissingTV: boolean, autoApproveTV: boolean) => searchMissingTV && autoApproveTV,
    then: (schema) => schema
      .min(1, 'Must be at least 1 season')
      .max(50, 'Cannot exceed 50 seasons')
      .required('Max seasons is required when auto-requesting TV shows'),
    otherwise: (schema) => schema,
  }),
};

// Time restriction validation
const timeRestrictionValidations = {
  timeRestriction: Yup.object().shape({
    alwaysActive: Yup.boolean(),
    removeFromPlexWhenInactive: Yup.boolean(),
    
    dateRanges: Yup.array().of(
      Yup.object().shape({
        startDate: Yup.date().required('Start date is required'),
        endDate: Yup.date()
          .required('End date is required')
          .min(Yup.ref('startDate'), 'End date must be after start date'),
      })
    ),

    weeklySchedule: Yup.object().shape({
      monday: Yup.boolean(),
      tuesday: Yup.boolean(),
      wednesday: Yup.boolean(),
      thursday: Yup.boolean(),
      friday: Yup.boolean(),
      saturday: Yup.boolean(),
      sunday: Yup.boolean(),
    }),

    inactiveVisibilityConfig: Yup.object().shape({
      usersHome: Yup.boolean(),
      serverOwnerHome: Yup.boolean(),
      libraryRecommended: Yup.boolean(),
      libraryTabOnly: Yup.boolean(),
    }),
  }),
};

// Combined validation schema
export const CollectionConfigSchema = Yup.object().shape({
  ...baseCollectionSchema,
  ...tautulliValidation,
  ...customUrlValidations,
  ...autoRequestValidations,
  ...timeRestrictionValidations,
});

/**
 * Validation utilities
 */
export const ValidationHelpers = {
  /**
   * Validate template requirements based on media type and separate templates
   */
  validateTemplates: (values: any): string | null => {
    const hasMainTemplate = Boolean(values.template);
    const hasMovieTemplate = Boolean(values.customMovieTemplate);
    const hasTvTemplate = Boolean(values.customTVTemplate);
    const isBothMediaType = values.mediaType === 'both';

    if (isBothMediaType && hasMovieTemplate && hasTvTemplate) {
      return null; // Valid: separate templates for both media types
    }

    if (hasMainTemplate && !hasMovieTemplate && !hasTvTemplate) {
      return null; // Valid: main template only
    }

    if (isBothMediaType && (hasMovieTemplate || hasTvTemplate) && !(hasMovieTemplate && hasTvTemplate)) {
      return 'Both movie and TV templates are required when using separate templates for mixed media types';
    }

    if (!hasMainTemplate && !hasMovieTemplate && !hasTvTemplate) {
      return 'Collection title template is required';
    }

    return null;
  },

  /**
   * Validate library selection based on collection type and detected media types
   */
  validateLibrarySelection: (values: any, libraries: any[] = []): string | null => {
    if (!values.libraryIds || values.libraryIds.length === 0) {
      return 'At least one library must be selected';
    }

    // Check if "All Libraries" is selected with other libraries
    if (values.libraryIds.includes('all') && values.libraryIds.length > 1) {
      return 'Cannot select "All Libraries" with specific libraries';
    }

    // Validate library compatibility with media type
    if (!values.libraryIds.includes('all')) {
      const selectedLibraries = libraries.filter(lib => 
        values.libraryIds.includes(lib.id) && lib.enabled
      );

      if (selectedLibraries.length === 0) {
        return 'Selected libraries are not available or disabled';
      }

      // Check media type compatibility
      if (values.mediaType && values.mediaType !== 'both') {
        const compatibleLibraries = selectedLibraries.filter(lib => 
          lib.type === values.mediaType || 
          (lib.type === 'show' && values.mediaType === 'tv')
        );

        if (compatibleLibraries.length === 0) {
          return `No selected libraries support ${values.mediaType} content`;
        }
      }
    }

    return null;
  },

  /**
   * Validate custom URL based on collection type and subtype
   */
  validateCustomUrl: (values: any): string | null => {
    if (!values.type || values.subtype !== 'custom') {
      return null; // No custom URL required
    }

    const urlFieldMap: Record<string, string> = {
      trakt: 'traktCustomListUrl',
      tmdb: 'tmdbCustomCollectionUrl',
      imdb: 'imdbCustomListUrl',
      letterboxd: 'letterboxdCustomListUrl',
    };

    const urlField = urlFieldMap[values.type];
    if (!urlField) {
      return null; // No URL field for this type
    }

    if (!values[urlField]) {
      return `${values.type.toUpperCase()} URL is required for custom collections`;
    }

    return null;
  },

  /**
   * Validate visibility configuration
   */
  validateVisibility: (values: any): string | null => {
    const config = values.visibilityConfig;
    if (!config) {
      return 'Visibility configuration is required';
    }

    const hasAnyVisibility = config.usersHome || 
                            config.serverOwnerHome || 
                            config.libraryRecommended || 
                            config.libraryTabOnly;

    if (!hasAnyVisibility) {
      return 'At least one visibility option must be selected';
    }

    // If library tab only is selected, home options should be disabled
    if (config.libraryTabOnly && (config.usersHome || config.serverOwnerHome)) {
      return 'Library Tab Only cannot be combined with home screen visibility';
    }

    return null;
  },

  /**
   * Validate auto-request configuration
   */
  validateAutoRequest: (values: any): string | null => {
    // If auto-approve is enabled, search must also be enabled
    if (values.autoApproveMovies && !values.searchMissingMovies) {
      return 'Search for missing movies must be enabled when auto-approving movies';
    }

    if (values.autoApproveTV && !values.searchMissingTV) {
      return 'Search for missing TV shows must be enabled when auto-approving TV shows';
    }

    // Validate max seasons when auto-requesting TV
    if (values.searchMissingTV && values.autoApproveTV) {
      if (!values.maxSeasonsToRequest || values.maxSeasonsToRequest < 1) {
        return 'Max seasons to request must be at least 1 when auto-approving TV shows';
      }
    }

    return null;
  },

  /**
   * Validate time restrictions
   */
  validateTimeRestrictions: (values: any): string | null => {
    const timeRestriction = values.timeRestriction;
    if (!timeRestriction || timeRestriction.alwaysActive) {
      return null; // No restrictions to validate
    }

    // Validate date ranges
    if (timeRestriction.dateRanges && timeRestriction.dateRanges.length > 0) {
      for (const range of timeRestriction.dateRanges) {
        if (!range.startDate || !range.endDate) {
          return 'All date ranges must have both start and end dates';
        }

        if (new Date(range.startDate) >= new Date(range.endDate)) {
          return 'End date must be after start date in all date ranges';
        }
      }
    }

    // Validate weekly schedule
    if (timeRestriction.weeklySchedule) {
      const hasAnyDay = Object.values(timeRestriction.weeklySchedule).some(Boolean);
      if (!hasAnyDay && (!timeRestriction.dateRanges || timeRestriction.dateRanges.length === 0)) {
        return 'At least one day or date range must be selected for time restrictions';
      }
    }

    return null;
  },

  /**
   * Perform comprehensive validation of the entire form
   */
  validateForm: (values: any, libraries: any[] = []): Record<string, string> => {
    const errors: Record<string, string> = {};

    // Template validation
    const templateError = ValidationHelpers.validateTemplates(values);
    if (templateError) {
      errors.template = templateError;
    }

    // Library selection validation
    const libraryError = ValidationHelpers.validateLibrarySelection(values, libraries);
    if (libraryError) {
      errors.libraryIds = libraryError;
    }

    // Custom URL validation
    const urlError = ValidationHelpers.validateCustomUrl(values);
    if (urlError) {
      const urlFieldMap: Record<string, string> = {
        trakt: 'traktCustomListUrl',
        tmdb: 'tmdbCustomCollectionUrl',
        imdb: 'imdbCustomListUrl',
        letterboxd: 'letterboxdCustomListUrl',
      };
      const field = urlFieldMap[values.type];
      if (field) {
        errors[field] = urlError;
      }
    }

    // Visibility validation
    const visibilityError = ValidationHelpers.validateVisibility(values);
    if (visibilityError) {
      errors.visibilityConfig = visibilityError;
    }

    // Auto-request validation
    const autoRequestError = ValidationHelpers.validateAutoRequest(values);
    if (autoRequestError) {
      errors.autoRequest = autoRequestError;
    }

    // Time restrictions validation
    const timeRestrictionsError = ValidationHelpers.validateTimeRestrictions(values);
    if (timeRestrictionsError) {
      errors.timeRestriction = timeRestrictionsError;
    }

    return errors;
  },
};

export default CollectionConfigSchema;