import React from 'react';
import { Field, ErrorMessage } from 'formik';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  collectionType: 'Collection Type',
  collectionSubtype: 'Collection Sub-Type',
  selectSource: 'Select Source...',
  selectSubtype: 'Select sub-type...',
});

interface SubtypeOption {
  value: string;
  label: string;
  description?: string;
}

interface CollectionTypeSectionProps {
  values: any;
  setFieldValue: (field: string, value: any) => void;
  errors: any;
  touched: any;
  isVisible?: boolean;
}

const CollectionTypeSection = ({
  values,
  setFieldValue,
  errors,
  touched,
  isVisible = true
}: CollectionTypeSectionProps) => {
  const intl = useIntl();
  
  if (!isVisible) return null;

  const collectionTypes = [
    { value: 'overseerr', label: 'Overseerr Requests' },
    { value: 'tautulli', label: 'Tautulli Statistics' },
    { value: 'trakt', label: 'Trakt Lists' },
    { value: 'letterboxd', label: 'Letterboxd Lists' },
    { value: 'tmdb', label: 'TMDb Lists' },
    { value: 'imdb', label: 'IMDb Lists' },
    { value: 'plex', label: 'Plex Built-in Hubs' },
  ];

  const getSubtypeOptions = (type: string): SubtypeOption[] => {
    switch (type) {
      case 'overseerr':
        return [
          {
            value: 'users',
            label: 'Individual Users Requests (excl. server owner)',
          },
          { value: 'server_owner', label: 'Server Owner requests' },
          { value: 'global', label: 'All Requests' },
        ];
      case 'tautulli':
        return [
          { value: 'most_popular_plays', label: 'Most Popular (Play Count)' },
          {
            value: 'most_popular_duration',
            label: 'Most Popular (Watch Duration)',
          },
          { value: 'most_watched_plays', label: 'Most Watched (Play Count)' },
          {
            value: 'most_watched_duration',
            label: 'Most Watched (Watch Duration)',
          },
        ];
      case 'trakt':
        return [
          { value: 'trending_7_days', label: 'Trending Last 7 Days' },
          { value: 'trending_30_days', label: 'Trending Last 30 Days' },
          { value: 'popular_week', label: 'Popular This Week' },
          { value: 'popular_month', label: 'Popular This Month' },
          { value: 'most_watched_week', label: 'Most Watched This Week' },
          { value: 'most_watched_month', label: 'Most Watched This Month' },
          { value: 'custom', label: 'Custom List' },
        ];
      case 'tmdb':
        return [
          { value: 'trending_day', label: 'Trending Today' },
          { value: 'trending_week', label: 'Trending This Week' },
          { value: 'popular', label: 'Popular' },
          { value: 'top_rated', label: 'Top Rated' },
          { value: 'custom', label: 'Custom Collection' },
        ];
      case 'imdb':
        return [
          { value: 'top_250', label: 'Top 250' },
          { value: 'popular', label: 'Popular' },
          { value: 'most_popular', label: 'Most Popular' },
          { value: 'custom', label: 'Custom List' },
        ];
      case 'letterboxd':
        return [
          { value: 'custom', label: 'Custom List' },
        ];
      case 'plex':
        return [
          { value: 'movie.recentlyadded', label: 'Recently Added Movies', description: 'Built-in Recently Added Movies hub' },
          { value: 'movie.recentlyreleased', label: 'Recently Released Movies', description: 'Built-in Recently Released Movies hub' },
          { value: 'movie.curated', label: 'Seasonal Movies', description: 'Built-in Seasonal Movies hub' },
          { value: 'movie.topunwatched', label: 'Top Unwatched Movies', description: 'Built-in Top Unwatched Movies hub' },
          { value: 'tv.recentlyadded', label: 'Recently Added TV', description: 'Built-in Recently Added TV hub' },
          { value: 'tv.recentlyaired', label: 'Recently Aired TV', description: 'Built-in Recently Aired TV hub' },
          { value: 'tv.curated', label: 'Seasonal TV', description: 'Built-in Seasonal TV hub' },
          { value: 'tv.topunwatched', label: 'Top Unwatched TV', description: 'Built-in Top Unwatched TV hub' },
        ];
      default:
        return [];
    }
  };

  const subtypeOptions = getSubtypeOptions(values.type);

  return (
    <div className="space-y-4">
      {/* Collection Type */}
      <div>
        <label htmlFor="type" className="block text-sm font-medium text-gray-300 mb-2">
          {intl.formatMessage(messages.collectionType)} <span className="text-red-500">*</span>
        </label>
        <Field
          as="select"
          id="type"
          name="type"
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const newType = e.target.value;
            setFieldValue('type', newType);
            setFieldValue('subtype', ''); // Reset subtype when type changes
            
            // Auto-set media type based on collection type
            if (newType === 'letterboxd') {
              setFieldValue('mediaType', 'movie');
            }
          }}
        >
          <option value="">{intl.formatMessage(messages.selectSource)}</option>
          {collectionTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </Field>
        <ErrorMessage name="type" component="div" className="text-red-500 text-sm mt-1" />
      </div>

      {/* Collection Sub-Type */}
      {values.type && subtypeOptions.length > 0 && (
        <div>
          <label htmlFor="subtype" className="block text-sm font-medium text-gray-300 mb-2">
            {intl.formatMessage(messages.collectionSubtype)} <span className="text-red-500">*</span>
          </label>
          <Field
            as="select"
            id="subtype"
            name="subtype"
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">{intl.formatMessage(messages.selectSubtype)}</option>
            {subtypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Field>
          <ErrorMessage name="subtype" component="div" className="text-red-500 text-sm mt-1" />
          
          {/* Show description if available */}
          {values.subtype && (
            (() => {
              const selectedOption = subtypeOptions.find(opt => opt.value === values.subtype);
              return selectedOption?.description ? (
                <p className="mt-1 text-xs text-gray-400">
                  {selectedOption.description}
                </p>
              ) : null;
            })()
          )}
        </div>
      )}

      {/* Privacy Warning for Overseerr Users Collections */}
      {values.type === 'overseerr' && values.subtype === 'users' && (
        <div className="mt-4 space-y-3">
          {/* General visibility warning */}
          <div className="rounded-md border border-yellow-500/20 bg-yellow-500/10 p-3">
            <div className="flex">
              <svg
                className="mt-0.5 mr-2 h-4 w-4 flex-shrink-0 text-yellow-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <h4 className="mb-1 text-sm font-medium text-yellow-300">
                  Privacy Notice
                </h4>
                <p className="text-sm text-yellow-200">
                  Individual user collections will create separate collections for each user's requests. 
                  This may reveal user preferences and viewing habits to other Plex users depending on your visibility settings.
                </p>
              </div>
            </div>
          </div>

          {/* Plex Pass privacy warning */}
          <div className="rounded-md border border-orange-500/20 bg-orange-500/10 p-3">
            <div className="flex">
              <svg
                className="mt-0.5 mr-2 h-4 w-4 flex-shrink-0 text-orange-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <h4 className="mb-1 text-sm font-medium text-orange-300">
                  Plex Pass Required for Privacy Controls
                </h4>
                <p className="text-sm text-orange-200">
                  Without Plex Pass, individual collections will be visible to all users. 
                  Plex Pass enables advanced privacy controls using labels to restrict collection visibility to specific users.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollectionTypeSection;