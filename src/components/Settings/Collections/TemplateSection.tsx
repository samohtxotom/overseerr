import React, { useState, useEffect } from 'react';
import { Field, ErrorMessage } from 'formik';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  collectionTitle: 'Collection Title Template',
  collectionTitleDescription: 'Template for generating collection titles',
  customTemplate: 'Custom Template',
  separateTemplates: 'Use Separate Templates for Movies and TV',
  movieTemplate: 'Movie Template',
  tvTemplate: 'TV Template',
  preview: 'Preview:',
  templateRequired: 'Collection title template is required',
  availableVariables: 'Available Variables',
  variablesDescription: 'Click to insert into template',
});

interface TemplatePreset {
  value: string;
  label: string;
  movieTemplate?: string;
  tvTemplate?: string;
}

interface TemplateSectionProps {
  values: any;
  setFieldValue: (field: string, value: any) => void;
  errors: any;
  isVisible?: boolean;
  currentUser?: any;
  libraries?: any[];
}

const TemplateSection = ({
  values,
  setFieldValue,
  errors,
  isVisible = true,
  currentUser,
  libraries = []
}: TemplateSectionProps) => {
  const intl = useIntl();
  const [showSeparateTemplates, setShowSeparateTemplates] = useState(false);

  if (!isVisible) return null;

  // Template presets based on collection type
  const getTemplatePresets = (): TemplatePreset[] => {
    const basePresets: TemplatePreset[] = [
      { value: 'custom', label: intl.formatMessage(messages.customTemplate) }
    ];

    switch (values.type) {
      case 'overseerr':
        return [
          ...basePresets,
          { value: "{user}'s Requests", label: "User's Requests" },
          { value: "{user}'s Movies", label: "User's Movies", movieTemplate: "{user}'s Movies", tvTemplate: "{user}'s TV Shows" },
          { value: "Requested by {user}", label: "Requested by User" },
          { value: "All Requests", label: "All Requests" },
        ];
      case 'tautulli':
        return [
          ...basePresets,
          { value: "{user}'s Most Watched", label: "User's Most Watched" },
          { value: "Top {statType} - {timeRange}", label: "Top Statistics - Time Range" },
          { value: "Popular Movies", label: "Popular Movies", movieTemplate: "Popular Movies", tvTemplate: "Popular TV Shows" },
          { value: "Most Played", label: "Most Played" },
        ];
      case 'trakt':
        return [
          ...basePresets,
          { value: "Trakt {statType}", label: "Trakt Statistics" },
          { value: "Trending Now", label: "Trending Now" },
          { value: "Popular This Week", label: "Popular This Week" },
          { value: "{listName}", label: "List Name (for custom lists)" },
        ];
      case 'tmdb':
        return [
          ...basePresets,
          { value: "TMDb {statType}", label: "TMDb Statistics" },
          { value: "Trending Movies", label: "Trending Movies", movieTemplate: "Trending Movies", tvTemplate: "Trending TV Shows" },
          { value: "Top Rated", label: "Top Rated" },
        ];
      case 'imdb':
        return [
          ...basePresets,
          { value: "IMDb {statType}", label: "IMDb Statistics" },
          { value: "IMDb Top 250", label: "IMDb Top 250" },
          { value: "Popular on IMDb", label: "Popular on IMDb" },
        ];
      case 'letterboxd':
        return [
          ...basePresets,
          { value: "Letterboxd: {listName}", label: "Letterboxd List Name" },
          { value: "{listName}", label: "List Name Only" },
        ];
      case 'plex':
        return [
          ...basePresets,
          { value: "{hubName}", label: "Hub Name" },
          { value: "Recently Added", label: "Recently Added" },
          { value: "Popular Movies", label: "Popular Movies", movieTemplate: "Popular Movies", tvTemplate: "Popular TV Shows" },
        ];
      default:
        return basePresets;
    }
  };

  const templatePresets = getTemplatePresets();

  // Available template variables based on collection type
  const getAvailableVariables = (): string[] => {
    const commonVars = ['{mediaType}', '{libraryName}'];
    
    switch (values.type) {
      case 'overseerr':
        return ['{user}', '{displayName}', '{username}', ...commonVars];
      case 'tautulli':
        return ['{user}', '{displayName}', '{username}', '{statType}', '{timeRange}', '{days}', ...commonVars];
      case 'trakt':
        return ['{statType}', '{timeRange}', '{listName}', '{listOwner}', ...commonVars];
      case 'tmdb':
        return ['{statType}', '{collectionName}', ...commonVars];
      case 'imdb':
        return ['{statType}', '{listName}', ...commonVars];
      case 'letterboxd':
        return ['{listName}', '{listOwner}', ...commonVars];
      case 'plex':
        return ['{hubName}', '{hubType}', ...commonVars];
      default:
        return commonVars;
    }
  };

  const availableVariables = getAvailableVariables();

  // Handle preset selection
  const handlePresetChange = (presetValue: string) => {
    const preset = templatePresets.find(p => p.value === presetValue);
    if (!preset) return;

    if (preset.value === 'custom') {
      // Don't change template when custom is selected
      return;
    }

    if (preset.movieTemplate && preset.tvTemplate) {
      // Preset has separate templates
      setFieldValue('customMovieTemplate', preset.movieTemplate);
      setFieldValue('customTVTemplate', preset.tvTemplate);
      setShowSeparateTemplates(true);
      setFieldValue('template', ''); // Clear main template
    } else {
      // Single template
      setFieldValue('template', preset.value);
      setFieldValue('customMovieTemplate', '');
      setFieldValue('customTVTemplate', '');
      setShowSeparateTemplates(false);
    }
  };

  // Insert variable into template
  const insertVariable = (variable: string, fieldName = 'template') => {
    const currentTemplate = values[fieldName] || '';
    const newTemplate = currentTemplate + variable;
    setFieldValue(fieldName, newTemplate);
  };

  // Generate preview
  const generatePreview = (template: string, mediaType?: 'movie' | 'tv') => {
    if (!template) return '';

    let preview = template;
    
    // Replace common variables with example values
    const replacements: Record<string, string> = {
      '{user}': currentUser?.displayName || currentUser?.plexUsername || 'John Doe',
      '{displayName}': currentUser?.displayName || 'John Doe',
      '{username}': currentUser?.plexUsername || currentUser?.username || 'johndoe',
      '{mediaType}': mediaType || values.mediaType || 'movie',
      '{libraryName}': libraries?.[0]?.name || 'Movies',
      '{statType}': values.subtype?.replace(/_/g, ' ') || 'trending',
      '{timeRange}': '30 days',
      '{days}': values.customDays || '30',
      '{listName}': 'My Favorite Movies',
      '{listOwner}': 'username',
      '{collectionName}': 'Marvel Cinematic Universe',
      '{hubName}': 'Recently Added',
      '{hubType}': 'movies',
    };

    Object.entries(replacements).forEach(([key, value]) => {
      preview = preview.replace(new RegExp(key, 'g'), value);
    });

    return preview;
  };

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-gray-300 mb-2">
        {intl.formatMessage(messages.collectionTitle)} <span className="text-red-500">*</span>
      </label>

      {/* Template Presets Dropdown */}
      <div>
        <select
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          onChange={(e) => handlePresetChange(e.target.value)}
          value="custom"
        >
          {templatePresets.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>

      {/* Separate Templates Toggle */}
      {values.mediaType === 'both' && (
        <div className="flex items-center">
          <input
            type="checkbox"
            id="separateTemplates"
            checked={showSeparateTemplates}
            onChange={(e) => {
              setShowSeparateTemplates(e.target.checked);
              if (!e.target.checked) {
                setFieldValue('customMovieTemplate', '');
                setFieldValue('customTVTemplate', '');
              }
            }}
            className="form-checkbox"
          />
          <label htmlFor="separateTemplates" className="ml-2 text-sm text-gray-300">
            {intl.formatMessage(messages.separateTemplates)}
          </label>
        </div>
      )}

      {/* Template Input(s) */}
      {showSeparateTemplates && values.mediaType === 'both' ? (
        <div className="space-y-4">
          {/* Movie Template */}
          <div>
            <label htmlFor="customMovieTemplate" className="block text-sm font-medium text-gray-300 mb-2">
              {intl.formatMessage(messages.movieTemplate)}
            </label>
            <Field
              type="text"
              id="customMovieTemplate"
              name="customMovieTemplate"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <ErrorMessage name="customMovieTemplate" component="div" className="text-red-500 text-sm mt-1" />
            {values.customMovieTemplate && (
              <p className="mt-2 text-sm text-blue-300">
                {intl.formatMessage(messages.preview)} {generatePreview(values.customMovieTemplate, 'movie')}
              </p>
            )}
          </div>

          {/* TV Template */}
          <div>
            <label htmlFor="customTVTemplate" className="block text-sm font-medium text-gray-300 mb-2">
              {intl.formatMessage(messages.tvTemplate)}
            </label>
            <Field
              type="text"
              id="customTVTemplate"
              name="customTVTemplate"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <ErrorMessage name="customTVTemplate" component="div" className="text-red-500 text-sm mt-1" />
            {values.customTVTemplate && (
              <p className="mt-2 text-sm text-blue-300">
                {intl.formatMessage(messages.preview)} {generatePreview(values.customTVTemplate, 'tv')}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div>
          <Field
            type="text"
            id="template"
            name="template"
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <ErrorMessage name="template" component="div" className="text-red-500 text-sm mt-1" />
          
          {/* Template Preview */}
          {values.template && (
            <p className="mt-2 text-sm text-blue-300">
              {intl.formatMessage(messages.preview)} {generatePreview(values.template)}
            </p>
          )}
        </div>
      )}

      {/* Available Variables */}
      <div className="mt-4 p-3 bg-gray-800 border border-gray-600 rounded-md">
        <h4 className="text-sm font-medium text-gray-300 mb-2">
          {intl.formatMessage(messages.availableVariables)}
        </h4>
        <p className="text-xs text-gray-400 mb-2">
          {intl.formatMessage(messages.variablesDescription)}
        </p>
        <div className="flex flex-wrap gap-2">
          {availableVariables.map((variable) => (
            <button
              key={variable}
              type="button"
              onClick={() => {
                if (showSeparateTemplates) {
                  // Insert into both templates
                  insertVariable(variable, 'customMovieTemplate');
                  insertVariable(variable, 'customTVTemplate');
                } else {
                  insertVariable(variable);
                }
              }}
              className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              {variable}
            </button>
          ))}
        </div>
      </div>

      {/* Template validation error */}
      {errors.template && !values.template && !values.customMovieTemplate && !values.customTVTemplate && (
        <div className="text-red-500 text-sm">
          {intl.formatMessage(messages.templateRequired)}
        </div>
      )}
    </div>
  );
};

export default TemplateSection;