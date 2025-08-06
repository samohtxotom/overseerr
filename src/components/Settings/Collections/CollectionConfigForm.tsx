import Modal from '@app/components/Common/Modal';
import globalMessages from '@app/i18n/globalMessages';
import { Transition } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import { Field, Formik } from 'formik';
import { defineMessages, useIntl } from 'react-intl';
import { useState, useRef } from 'react';
import useClickOutside from '@app/hooks/useClickOutside';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';
import * as Yup from 'yup';
import type { PlexSettings } from '@server/lib/settings';
import type {
  CollectionConfig,
  CollectionConfigFormProps,
  TemplatePreset,
  SubtypeOption,
} from './types';

const messages = defineMessages({
  editCollection: 'Edit Collection Configuration',
  addCollection: 'Add New Collection',
  collectionType: 'Collection Type',
  collectionSubtype: 'Collection Sub-Type',
  selectSource: 'Select Source...',
  selectSubtype: 'Select sub-type...',
  visibility: 'Visibility',
  maxItems: 'Max Items',
  customPoster: 'Custom Poster',
  autoRequestSettings: 'Auto-Request Settings',
  timeRestrictions: 'Time Restrictions',
  createCollection: 'Create Collection',
  updateCollection: 'Update Collection',
  cancel: 'Cancel',
  preview: 'Preview:',
  alwaysActive: 'Always Active (no time restrictions)',
});

// Library Checkbox Dropdown Component
interface LibraryCheckboxDropdownProps {
  selectedLibraries: string[];
  allLibraries: { id: string; name: string; type: string; enabled: boolean }[];
  onSelectionChange: (selectedIds: string[]) => void;
  disabled?: boolean;
  error?: string;
  showAllLibrariesOption?: boolean; // Control whether to show "All Libraries" option
}

const LibraryCheckboxDropdown = ({
  selectedLibraries,
  allLibraries,
  onSelectionChange,
  disabled = false,
  error,
  showAllLibrariesOption = true
}: LibraryCheckboxDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  useClickOutside(dropdownRef, () => setIsOpen(false));

  const allLibrariesSelected = selectedLibraries.includes('all');
  const enabledLibraries = allLibraries.filter(lib => lib.enabled);

  const handleAllLibrariesChange = (checked: boolean) => {
    if (checked) {
      onSelectionChange(['all']);
    } else {
      onSelectionChange([]);
    }
  };

  const handleLibraryChange = (libraryId: string, checked: boolean) => {
    if (allLibrariesSelected) return; // Don't allow individual changes when "All Libraries" is selected

    if (checked) {
      onSelectionChange([...selectedLibraries.filter(id => id !== 'all'), libraryId]);
    } else {
      onSelectionChange(selectedLibraries.filter(id => id !== libraryId));
    }
  };

  const getDisplayText = () => {
    if (selectedLibraries.length === 0) {
      return 'Select Libraries...';
    }
    if (allLibrariesSelected) {
      return 'All Libraries';
    }
    if (selectedLibraries.length === 1) {
      const library = enabledLibraries.find(lib => lib.id === selectedLibraries[0]);
      return library ? library.name : '1 library selected';
    }
    return `${selectedLibraries.length} libraries selected`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`form-input flex w-full items-center justify-between text-left ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        } ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
      >
        <span className={selectedLibraries.length === 0 ? 'text-gray-400' : 'text-white'}>
          {getDisplayText()}
        </span>
        <ChevronDownIcon className={`ml-2 h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <Transition
        show={isOpen}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-600 bg-gray-700 shadow-lg ring-1 ring-black ring-opacity-5">
          <div className="py-1">
            {/* All Libraries Option - conditionally shown */}
            {showAllLibrariesOption && (
              <label className="flex items-center px-4 py-2 text-sm hover:bg-gray-600 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={allLibrariesSelected}
                  onChange={(e) => handleAllLibrariesChange(e.target.checked)}
                  className="form-checkbox mr-3"
                />
                <span className="text-white font-medium">All Libraries</span>
              </label>
            )}

            {/* Individual Library Options */}
            {enabledLibraries.map((library) => (
              <label
                key={library.id}
                className={`flex items-center px-4 py-2 text-sm hover:bg-gray-600 cursor-pointer transition-colors ${
                  allLibrariesSelected ? 'opacity-50' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedLibraries.includes(library.id)}
                  onChange={(e) => handleLibraryChange(library.id, e.target.checked)}
                  disabled={allLibrariesSelected}
                  className={`form-checkbox mr-3 ${allLibrariesSelected ? 'opacity-50' : ''}`}
                />
                <span className="text-white">{library.name}</span>
              </label>
            ))}
          </div>
        </div>
      </Transition>
    </div>
  );
};

const CollectionConfigForm = ({
  config,
  onSave,
  onCancel,
  libraries,
}: CollectionConfigFormProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();

  // Get current user data which includes Plex Pass status
  const { data: currentUser } = useSWR('/api/v1/auth/me');
  // Get main settings for domain/app name
  const { data: mainSettings } = useSWR('/api/v1/settings/main');
  // Get Plex settings
  const { data } = useSWR<PlexSettings>('/api/v1/settings/plex');

  // State for storing fetched titles and detected media types
  const [posterUploading, setPosterUploading] = useState(false);
  const [fetchedTitles, setFetchedTitles] = useState<{
    trakt?: string;
    tmdb?: string;
    imdb?: string;
    letterboxd?: string;
  }>({});
  const [detectedMediaTypes, setDetectedMediaTypes] = useState<{
    trakt?: 'movie' | 'tv' | 'both';
    tmdb?: 'movie' | 'tv' | 'both';
    imdb?: 'movie' | 'tv' | 'both';
    letterboxd?: 'movie' | 'tv' | 'both';
  }>({});
  const [fetchingTitle, setFetchingTitle] = useState<{
    trakt?: boolean;
    tmdb?: boolean;
    imdb?: boolean;
    letterboxd?: boolean;
  }>({});

  // Title fetching functions
  const fetchTraktTitle = async (url: string, setFieldValue?: (field: string, value: any) => void) => {
    try {
      setFetchingTitle(prev => ({ ...prev, trakt: true }));
      const response = await fetch(`/api/v1/settings/plex/collections/fetch-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'trakt' }),
      });
      const data = await response.json();
      if (data.title) {
        setFetchedTitles(prev => ({ ...prev, trakt: data.title }));
        if (data.mediaType) {
          setDetectedMediaTypes(prev => ({ ...prev, trakt: data.mediaType }));
        }

        // Auto-select first template option when title is fetched
        if (setFieldValue) {
          setTimeout(() => {
            // If media type is 'both', select the first option which includes {mediaType}s
            if (data.mediaType === 'both') {
              setFieldValue('template', `${data.title} - {mediaType}s`);
            } else {
              setFieldValue('template', data.title);
            }
          }, 100); // Small delay to ensure state is updated
        }
      }
    } catch (error) {
      // Failed to fetch Trakt title - silently continue
    } finally {
      setFetchingTitle(prev => ({ ...prev, trakt: false }));
    }
  };

  const fetchTmdbTitle = async (url: string) => {
    try {
      setFetchingTitle(prev => ({ ...prev, tmdb: true }));
      const response = await fetch(`/api/v1/settings/plex/collections/fetch-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'tmdb' }),
      });
      const data = await response.json();
      if (data.title) {
        setFetchedTitles(prev => ({ ...prev, tmdb: data.title }));
        if (data.mediaType) {
          setDetectedMediaTypes(prev => ({ ...prev, tmdb: data.mediaType }));
        }
      }
    } catch (error) {
      // Failed to fetch TMDb title - silently continue
    } finally {
      setFetchingTitle(prev => ({ ...prev, tmdb: false }));
    }
  };

  const fetchImdbTitle = async (url: string) => {
    try {
      setFetchingTitle(prev => ({ ...prev, imdb: true }));
      const response = await fetch(`/api/v1/settings/plex/collections/fetch-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'imdb' }),
      });
      const data = await response.json();
      if (data.title) {
        setFetchedTitles(prev => ({ ...prev, imdb: data.title }));
        if (data.mediaType) {
          setDetectedMediaTypes(prev => ({ ...prev, imdb: data.mediaType }));
        }
      }
    } catch (error) {
      // Failed to fetch IMDb title - silently continue
    } finally {
      setFetchingTitle(prev => ({ ...prev, imdb: false }));
    }
  };

  const fetchLetterboxdTitle = async (url: string) => {
    try {
      setFetchingTitle(prev => ({ ...prev, letterboxd: true }));
      const response = await fetch(`/api/v1/settings/plex/collections/fetch-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'letterboxd' }),
      });
      const data = await response.json();
      if (data.title) {
        setFetchedTitles(prev => ({ ...prev, letterboxd: data.title }));
        if (data.mediaType) {
          setDetectedMediaTypes(prev => ({ ...prev, letterboxd: data.mediaType }));
        }
      }
    } catch (error) {
      // Failed to fetch Letterboxd title - silently continue
    } finally {
      setFetchingTitle(prev => ({ ...prev, letterboxd: false }));
    }
  };


  // Simplified validation schema
  const CollectionConfigSchema = Yup.object().shape({
    type: Yup.string().required('Collection type is required'),
    subtype: Yup.string().required('Collection sub-type is required'),
    libraryIds: Yup.array().of(Yup.string()).min(1, 'Please select at least one library').required('Please select at least one library'),
    // Template validation - only check when it exists
    template: Yup.string()
      .test('not-fetch-title', 'Please fetch the title from the URL first', value => !value || value !== 'fetch-title'),

    // Custom template validations - simplified
    customMovieTemplate: Yup.string().when('template', {
      is: 'custom',
      then: (schema) => schema.required('Movie template is required'),
      otherwise: (schema) => schema,
    }),

    customTVTemplate: Yup.string().when('template', {
      is: 'custom',
      then: (schema) => schema.required('TV template is required'),
      otherwise: (schema) => schema,
    }),

    customDays: Yup.number().when('type', {
      is: 'tautulli',
      then: (schema) => schema.required('Number of days is required').min(1, 'Must be at least 1 day').max(365, 'Cannot exceed 365 days'),
      otherwise: (schema) => schema,
    }),

    traktCustomListUrl: Yup.string().when(['type', 'subtype'], {
      is: (type: string, subtype: string) => type === 'trakt' && subtype === 'custom',
      then: (schema) => schema
        .required('Trakt list URL is required')
        .matches(
          /trakt\.tv\/users\/[^/]+\/lists\/[^/?]+/,
          'Please enter a valid Trakt list URL (e.g., https://trakt.tv/users/username/lists/list-name)'
        ),
      otherwise: (schema) => schema,
    }),

    tmdbCustomListUrl: Yup.string().when(['type', 'subtype'], {
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

    maxItems: Yup.number().min(1, 'Must be at least 1 item').max(1000, 'Cannot exceed 1000 items'),

    maxSeasonsToRequest: Yup.number().when(['searchMissingTV', 'autoApproveTV'], {
      is: (searchMissingTV: boolean, autoApproveTV: boolean) => searchMissingTV && autoApproveTV,
      then: (schema) => schema.min(1, 'Must be at least 1 season').max(50, 'Cannot exceed 50 seasons'),
      otherwise: (schema) => schema,
    }),
  });

  // Template presets will be handled within the Formik form
  // Auto-adjustments will be handled via onChange handlers

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
          { value: 'movie.recentlyviewed', label: 'Recently Watched Movies', description: 'Built-in Recently Watched Movies hub' },
          { value: 'tv.recentlyadded', label: 'Recently Added TV', description: 'Built-in Recently Added TV Shows hub' },
          { value: 'tv.recentlyaired', label: 'Recently Released Episodes', description: 'Built-in Recently Released Episodes hub' },
          { value: 'tv.startwatching', label: 'Start Watching', description: 'Built-in Continue Watching TV Shows hub' },
          { value: 'tv.rediscover', label: 'Rediscover', description: 'Built-in Rediscover TV Shows hub' },
          { value: 'tv.toprated', label: 'Top Rated TV', description: 'Built-in Top Rated TV Shows hub' },
          { value: 'tv.recentlyviewed', label: 'Recently Watched Episodes', description: 'Built-in Recently Watched Episodes hub' },
        ];
      default:
        return [];
    }
  };

  const getTemplatePresets = (values?: CollectionConfig, fetchedTitles?: { trakt?: string; tmdb?: string; imdb?: string }, detectedMediaTypes?: { trakt?: 'movie' | 'tv' | 'both'; tmdb?: 'movie' | 'tv' | 'both'; imdb?: 'movie' | 'tv' | 'both' }): TemplatePreset[] => {
    if (!values?.subtype) return [{ label: 'Custom', value: 'custom' }];

    // Helper function to generate preset options for custom URLs
    const getCustomUrlPresets = (title: string, serviceType: 'trakt' | 'tmdb' | 'imdb'): TemplatePreset[] => {
      if (!title) {
        return [
          {
            label: 'Fetch title from URL',
            value: 'fetch-title',
          },
          { label: 'Custom', value: 'custom' },
        ];
      }

      const detectedType = detectedMediaTypes?.[serviceType];

      if (detectedType === 'both') {
        // For mixed content, offer template with {mediaType}s placeholder
        return [
          {
            label: `${title} - {mediaType}s`,
            value: `${title} - {mediaType}s`,
          },
          {
            label: title, // Original title without suffix
            value: title,
          },
          { label: 'Custom', value: 'custom' },
        ];
      } else {
        // For single media type, just use the original title
        return [
          {
            label: title,
            value: title,
          },
          { label: 'Custom', value: 'custom' },
        ];
      }
    };

    // Overseerr collection presets
    if (values.type === 'overseerr') {
      switch (values.subtype) {
        case 'users':
          return [
            {
              label: "{nickname}'s {domain} {mediaType} requests",
              value: "{nickname}'s {domain} {mediaType} requests",
            },
            {
              label: '{domain} requests by {nickname}',
              value: '{domain} requests by {nickname}',
            },
            {
              label: "{nickname}'s {mediaType} requests",
              value: "{nickname}'s {mediaType} requests",
            },
            {
              label: '{appTitle} requests by {nickname}',
              value: '{appTitle} requests by {nickname}',
            },
            {
              label: 'Requested by {username}',
              value: 'Requested by {username}',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'global':
          return [
            {
              label: '{domain} requests by Everyone - {mediaType}s',
              value: '{domain} requests by Everyone - {mediaType}s',
            },
            {
              label: '{domain} - All {mediaType} Requests',
              value: '{domain} - All {mediaType} Requests',
            },
            {
              label: '{appTitle} requests by Everyone',
              value: '{appTitle} requests by Everyone',
            },
            {
              label: '{appTitle} - All Requests',
              value: '{appTitle} - All Requests',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'server_owner':
          return [
            {
              label: 'My Requests',
              value: 'My Requests',
            },
            {
              label: "{nickname}'s {domain} requests",
              value: "{nickname}'s {domain} requests",
            },
            {
              label: '{domain} requests by {nickname}',
              value: '{domain} requests by {nickname}',
            },
            {
              label: "{nickname}'s requests",
              value: "{nickname}'s requests",
            },
            {
              label: '{appTitle} requests by {nickname}',
              value: '{appTitle} requests by {nickname}',
            },
            {
              label: 'Requested by {username}',
              value: 'Requested by {username}',
            },
            { label: 'Custom', value: 'custom' },
          ];
        default:
          return [
            {
              label: 'Overseerr Collection',
              value: 'Overseerr Collection',
            },
            { label: 'Custom', value: 'custom' },
          ];
      }
    }

    // Tautulli collection presets
    if (values.type === 'tautulli') {
      switch (values.subtype) {
        case 'most_popular_plays':
          return [
            {
              label:
                'Most Popular {mediaType}s on {servername} in the last {customdays} Days',
              value:
                'Most Popular {mediaType}s on {servername} in the last {customdays} Days',
            },
            {
              label: 'Top Played {mediaType}s on {servername}',
              value: 'Top Played {mediaType}s on {servername}',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'most_popular_duration':
          return [
            {
              label:
                'Most Popular {mediaType}s on {servername} in the last {customdays} Days',
              value:
                'Most Popular {mediaType}s on {servername} in the last {customdays} Days',
            },
            {
              label: 'Top Played {mediaType}s on {servername}',
              value: 'Top Played {mediaType}s on {servername}',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'most_watched_plays':
          return [
            {
              label:
                'Most Watched {mediaType}s on {servername} in the last {customdays} Days',
              value:
                'Most Watched {mediaType}s on {servername} in the last {customdays} Days',
            },
            {
              label: 'Frequently Watched {mediaType}s on {servername}',
              value: 'Frequently Watched {mediaType}s on {servername}',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'most_watched_duration':
          return [
            {
              label:
                'Most Watched {mediaType}s on {servername} in the last {customdays} Days',
              value:
                'Most Watched {mediaType}s on {servername} in the last {customdays} Days',
            },
            {
              label: 'Frequently Watched {mediaType}s on {servername}',
              value: 'Frequently Watched {mediaType}s on {servername}',
            },
            { label: 'Custom', value: 'custom' },
          ];
        default:
          return [
            {
              label: 'Overseerr Collection',
              value: 'Overseerr Collection',
            },
            { label: 'Custom', value: 'custom' },
          ];
      }
    }

    // Trakt collection presets
    if (values.type === 'trakt') {
      switch (values.subtype) {
        case 'trending_7_days':
          return [
            {
              label: 'Trending {mediaType}s Last 7 Days',
              value: 'Trending {mediaType}s Last 7 Days',
            },
            {
              label: 'Trending {mediaType}s This Week',
              value: 'Trending {mediaType}s This Week',
            },
            {
              label: '🔥 Weekly Trending {mediaType}s',
              value: '🔥 Weekly Trending {mediaType}s',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'trending_30_days':
          return [
            {
              label: 'Trending {mediaType}s Last 30 Days',
              value: 'Trending {mediaType}s Last 30 Days',
            },
            {
              label: 'Trending {mediaType}s This Month',
              value: 'Trending {mediaType}s This Month',
            },
            {
              label: '🔥 Monthly Trending',
              value: '🔥 Monthly Trending',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'popular_week':
          return [
            {
              label: 'Popular {mediaType}s Last 7 Days',
              value: 'Popular {mediaType}s Last 7 Days',
            },
            {
              label: 'Popular {mediaType}s This Week',
              value: 'Popular {mediaType}s This Week',
            },
            {
              label: '⭐ Weekly Popular {mediaType}s',
              value: '⭐ Weekly Popular {mediaType}s',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'popular_month':
          return [
            {
              label: 'Popular {mediaType}s Last 30 Days',
              value: 'Popular {mediaType}s Last 30 Days',
            },
            {
              label: 'Popular {mediaType}s Last This Month',
              value: 'Popular {mediaType}s Last This Month',
            },
            {
              label: '⭐ Monthly Popular {mediaType}s',
              value: '⭐ Monthly Popular {mediaType}s',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'most_watched_week':
          return [
            {
              label: 'Most Watched {mediaType}s This Week (Trakt)',
              value: 'Most Watched {mediaType}s This Week (Trakt)',
            },
            {
              label: '📺 Weekly Most Watched {mediaType}s',
              value: '📺 Weekly Most Watched {mediaType}s',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'most_watched_month':
          return [
            {
              label: 'Most Watched {mediaType}s This Month (Trakt)',
              value: 'Most Watched {mediaType}s This Month (Trakt)',
            },
            {
              label: '📺 Monthly Most Watched {mediaType}s',
              value: '📺 Monthly Most Watched {mediaType}s',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'custom':
          return getCustomUrlPresets(fetchedTitles?.trakt || '', 'trakt');
        default:
          return [
            {
              label: 'Trakt Collection',
              value: 'Trakt Collection',
            },
            { label: 'Custom', value: 'custom' },
          ];
      }
    }

    // TMDb collection presets
    if (values.type === 'tmdb') {
      switch (values.subtype) {
        case 'trending_day':
          return [
            {
              label: 'Trending {mediaType}s Today',
              value: 'Trending {mediaType}s Today',
            },
            {
              label: 'Daily Trending {mediaType}s',
              value: 'Daily Trending {mediaType}s',
            },
            {
              label: 'Hot {mediaType}s Today',
              value: 'Hot {mediaType}s Today',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'trending_week':
          return [
            {
              label: 'Trending {mediaType}s This Week',
              value: 'Trending {mediaType}s This Week',
            },
            {
              label: 'Weekly Trending {mediaType}s',
              value: 'Weekly Trending {mediaType}s',
            },
            {
              label: 'Trending {mediaType}s Last 7 Days',
              value: 'Trending {mediaType}s Last 7 Days',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'popular':
          return [
            {
              label: 'Popular {mediaType}s',
              value: 'Popular {mediaType}s',
            },
            {
              label: 'Most Popular {mediaType}s',
              value: 'Most Popular {mediaType}s',
            },
            {
              label: 'Popular {mediaType}s Right Now',
              value: 'Popular {mediaType}s Right Now',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'top_rated':
          return [
            {
              label: 'Top Rated {mediaType}s',
              value: 'Top Rated {mediaType}s',
            },
            {
              label: 'Highest Rated {mediaType}s',
              value: 'Highest Rated {mediaType}s',
            },
            {
              label: 'Best {mediaType}s',
              value: 'Best {mediaType}s',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'custom':
          return getCustomUrlPresets(fetchedTitles?.tmdb || '', 'tmdb');
        default:
          return [
            {
              label: 'TMDb Collection',
              value: 'TMDb Collection',
            },
            { label: 'Custom', value: 'custom' },
          ];
      }
    }

    // IMDb collection presets
    if (values.type === 'imdb') {
      switch (values.subtype) {
        case 'top_250':
          return [
            {
              label: 'IMDb Top 250 {mediaType}s',
              value: 'IMDb Top 250 {mediaType}s',
            },
            {
              label: 'Best {mediaType}s of All Time',
              value: 'Best {mediaType}s of All Time',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'popular':
          return [
            {
              label: 'Popular {mediaType}s',
              value: 'Popular {mediaType}s',
            },
            {
              label: 'IMDb Popular {mediaType}s',
              value: 'IMDb Popular {mediaType}s',
            },
            {
              label: 'Currently Popular {mediaType}s',
              value: 'Currently Popular {mediaType}s',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'most_popular':
          return [
            {
              label: 'Most Popular {mediaType}s',
              value: 'Most Popular {mediaType}s',
            },
            {
              label: 'IMDb Most Popular {mediaType}s',
              value: 'IMDb Most Popular {mediaType}s',
            },
            {
              label: 'Hottest {mediaType}s Right Now',
              value: 'Hottest {mediaType}s Right Now',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'custom':
          return getCustomUrlPresets(fetchedTitles?.imdb || '', 'imdb');
        default:
          return [
            {
              label: 'IMDb Collection',
              value: 'IMDb Collection',
            },
            { label: 'Custom', value: 'custom' },
          ];
      }
    }

    // Fallback for unknown types
    return [
      {
        label: 'Collection',
        value: 'Collection',
      },
      {
        label: 'Overseerr Collection',
        value: 'Overseerr Collection',
      },
      { label: 'Custom', value: 'custom' },
    ];
  };

  // templatePresets will be calculated inside Formik render function

  // getVisibilityOptions will be defined inside the Formik render function

  const generatePreview = (
    template: string,
    forceMediaType?: 'movie' | 'tv',
    formValues?: CollectionConfig
  ) => {
    // Use formValues if provided, otherwise try to get from closure (for backward compatibility)
    const valuesRef = formValues || { type: '', subtype: '', mediaType: 'both' };

    if (!valuesRef.subtype) return 'Preview will appear here...';

    let preview = template || 'Collection';

    // Backwards compatibility for removed variables
    const subtypeLabel =
      valuesRef.type ? getSubtypeOptions(valuesRef.type).find(
        (opt) => opt.value === valuesRef.subtype
      )?.label || valuesRef.subtype : valuesRef.subtype;
    const cleanSubtype = (subtypeLabel || '').split(' (')[0]; // Remove " (Play Count)" etc.
    preview = preview.replace(/{name}/g, cleanSubtype);
    preview = preview.replace(/{subtype}/g, cleanSubtype);

    // Replace common template placeholders
    preview = preview.replace(/{servername}/g, data?.name || 'Plex Server');

    // Smart {mediaType} replacement based on context
    if (preview.includes('{mediaType}')) {
      // Determine media type from form data or context
      let mediaTypeText = 'Movies & TV Shows'; // default

      // Use forced media type if provided (for specific previews)
      if (forceMediaType === 'movie') {
        mediaTypeText = 'Movie';
      } else if (forceMediaType === 'tv') {
        mediaTypeText = 'TV Show';
      } else if (valuesRef.mediaType === 'movie') {
        mediaTypeText = 'Movie';
      } else if (valuesRef.mediaType === 'tv') {
        mediaTypeText = 'TV Show';
      } else if (valuesRef.type === 'overseerr' && valuesRef.subtype) {
        // For Overseerr collections, try to infer from subtype or collection context
        if (valuesRef.subtype.includes('movie')) {
          mediaTypeText = 'Movie';
        } else if (valuesRef.subtype.includes('tv')) {
          mediaTypeText = 'TV Show';
        }
      }
      preview = preview.replace(/{mediaType}/g, mediaTypeText);
    }

    // Type-specific variables with restrictions
    if (valuesRef.type === 'tautulli') {
      // Only {days} and {customdays} for Tautulli
      preview = preview.replace(
        /{days}/g,
        (valuesRef.customDays || 30).toString()
      );
      preview = preview.replace(
        /{customdays}/g,
        (valuesRef.customDays || 30).toString()
      );
      preview = preview.replace(
        /{statType}/g,
        valuesRef.tautulliStatType === 'duration'
          ? 'Watch Duration'
          : 'Play Count'
      );
    } else if (valuesRef.type === 'overseerr') {
      // Common Overseerr variables - use real settings data
      const domain = mainSettings?.applicationUrl
        ? new URL(mainSettings.applicationUrl).hostname
        : 'overseerr.example.com';
      const appTitle = mainSettings?.applicationTitle || 'Overseerr';
      preview = preview.replace(/{domain}/g, domain);
      preview = preview.replace(/{appTitle}/g, appTitle);

      // User-specific variables only for users subtype and server_owner
      if (valuesRef.subtype === 'users' || valuesRef.subtype === 'server_owner') {
        const nickname =
          currentUser?.plexTitle || currentUser?.displayName || 'User';
        const username =
          currentUser?.plexUsername || currentUser?.username || 'user';
        preview = preview.replace(/{nickname}/g, nickname);
        preview = preview.replace(/{username}/g, username);
      }
    }

    return preview;
  };

  // Validation is now handled by Yup schema

  // handleSave is now handled by Formik onSubmit

  return (
    <Transition
      as="div"
      appear
      show
      enter="transition-opacity ease-in-out duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity ease-in-out duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <Formik
        initialValues={{
          ...config,
          // Set clean defaults for new collections
          type: config.type || undefined,
          subtype: config.subtype || '',
          template: config.template || '',
          libraryId: config.libraryId || undefined,
          libraryIds: config.libraryIds || (config.libraryId && typeof config.libraryId === 'string' ? [config.libraryId] : Array.isArray(config.libraryId) ? config.libraryId : []),
          libraryName: config.libraryName || undefined,
          libraryNames: config.libraryNames || (config.libraryName ? [config.libraryName] : []),
          maxItems: config.maxItems || 50,
          customDays: config.customDays || 30,
          visibilityConfig: {
            usersHome: config.visibilityConfig?.usersHome ?? false,
            serverOwnerHome: config.visibilityConfig?.serverOwnerHome ?? true,
            libraryRecommended: config.visibilityConfig?.libraryRecommended ?? false,
            libraryTabOnly: config.visibilityConfig?.libraryTabOnly ?? false,
          },
          customPoster: config.customPoster || '',
          timeRestriction: config.timeRestriction || { 
            alwaysActive: true,
            removeFromPlexWhenInactive: false,
            inactiveVisibilityConfig: {
              usersHome: false,
              serverOwnerHome: false,
              libraryRecommended: true,
              libraryTabOnly: false,
            }
          },
        }}
        validationSchema={CollectionConfigSchema}
        enableReinitialize={true}
        validateOnChange={true}
        validateOnBlur={true}
        onSubmit={async (values, { setFieldError }) => {
          // Final validation before submission
          if (!values.template) {
            setFieldError('template', 'Collection title template is required');
            return;
          }
          if (values.template === 'fetch-title') {
            setFieldError('template', 'Please fetch the title from the URL first');
            return;
          }

          const configToSave = {
            ...values,
            name: values.name || generateCollectionName(values),
            // Convert string numbers to integers
            customDays: values.customDays ? parseInt(values.customDays.toString(), 10) : undefined,
            maxItems: values.maxItems ? parseInt(values.maxItems.toString(), 10) : 50,
            maxSeasonsToRequest: values.maxSeasonsToRequest ? parseInt(values.maxSeasonsToRequest.toString(), 10) : undefined,
          } as CollectionConfig;
          onSave(configToSave);
        }}
      >
        {({ values, handleSubmit, handleChange, setFieldValue, isSubmitting, isValid, errors, touched }) => {


          return (
            <Modal
              onCancel={onCancel}
              okButtonType="primary"
              okText={
                isSubmitting
                  ? intl.formatMessage(globalMessages.saving)
                  : config.id
                    ? intl.formatMessage(messages.updateCollection)
                    : intl.formatMessage(messages.createCollection)
              }
              okDisabled={!isValid || isSubmitting}
              onOk={() => handleSubmit()}
              title={
                config.id
                  ? intl.formatMessage(messages.editCollection)
                  : intl.formatMessage(messages.addCollection)
              }
            >
              {/* Helper functions that need access to values */}
              {(() => {
                // Get detected media type based on current collection type
                const getDetectedMediaType = (): 'movie' | 'tv' | 'both' | null => {
                  const result = (() => {
                    if (values.type === 'trakt' && values.subtype === 'custom' && detectedMediaTypes.trakt) {
                      return detectedMediaTypes.trakt;
                    }
                    if (values.type === 'tmdb' && values.subtype === 'custom' && detectedMediaTypes.tmdb) {
                      return detectedMediaTypes.tmdb;
                    }
                    if (values.type === 'imdb' && values.subtype === 'custom' && detectedMediaTypes.imdb) {
                      return detectedMediaTypes.imdb;
                    }
                    return null;
                  })();

                  return result;
                };

                // Filter libraries based on detected media type
                const getFilteredLibraries = () => {
                  const detectedType = getDetectedMediaType();
                  if (!detectedType || detectedType === 'both') {
                    return libraries.filter((lib) => lib.enabled);
                  }

                  // Filter libraries by media type
                  return libraries.filter((lib) => {
                    if (!lib.enabled) return false;

                    // Map library types to our media types
                    const isMovieLibrary = lib.type === 'movie';
                    const isTvLibrary = lib.type === 'show';

                    if (detectedType === 'movie') {
                      return isMovieLibrary;
                    } else if (detectedType === 'tv') {
                      return isTvLibrary;
                    }

                    return true;
                  });
                };

                const getVisibilityCheckboxStates = () => {
                  if (!values.type) return {
                    usersHome: { enabled: false, label: 'Users Home' },
                    serverOwnerHome: { enabled: false, label: 'Server Owner Home' },
                    libraryRecommended: { enabled: false, label: 'Library Recommended' },
                    libraryTabOnly: { enabled: false, label: 'Library Tab Only' }
                  };

                  // For User Requests (overseerr + users), check if Users Home is unlocked  
                  if (values.type === 'overseerr' && values.subtype === 'users') {
                    const isUsersHomeUnlocked = data?.usersHomeUnlocked || false;
                    return {
                      usersHome: { enabled: isUsersHomeUnlocked, label: 'Users Home' },
                      serverOwnerHome: { enabled: false, label: 'Server Owner Home' }, // Users collections shouldn't be on server owner home
                      libraryRecommended: { enabled: true, label: 'Library Recommended' },
                      libraryTabOnly: { enabled: true, label: 'Library Tab Only' },
                    };
                  }

                  // For Server Owner requests (overseerr + server_owner), only "Server Owner Home" should be available
                  if (values.type === 'overseerr' && values.subtype === 'server_owner') {
                    return {
                      usersHome: { enabled: false, label: 'Users Home' }, // Server owner collections shouldn't be on users' home
                      serverOwnerHome: { enabled: true, label: 'Server Owner Home' },
                      libraryRecommended: { enabled: true, label: 'Library Recommended' },
                      libraryTabOnly: { enabled: true, label: 'Library Tab Only' },
                    };
                  }

                  // For Source collections (Tautulli/Trakt/etc), all options should be available
                  if (values.type === 'tautulli' || values.type === 'trakt' || values.type === 'tmdb' || values.type === 'imdb' || values.type === 'letterboxd' || values.type === 'hub') {
                    return {
                      usersHome: { enabled: true, label: 'Users Home' },
                      serverOwnerHome: { enabled: true, label: 'Server Owner Home' },
                      libraryRecommended: { enabled: true, label: 'Library Recommended' },
                      libraryTabOnly: { enabled: true, label: 'Library Tab Only' },
                    };
                  }

                  // For overseerr global collections, all options should be available
                  return {
                    usersHome: { enabled: true, label: 'Users Home' },
                    serverOwnerHome: { enabled: true, label: 'Server Owner Home' },
                    libraryRecommended: { enabled: true, label: 'Library Recommended' },
                    libraryTabOnly: { enabled: true, label: 'Library Tab Only' },
                  };
                };

                return (
                  <div className="space-y-6">
                    {/* Collection Type */}
                    <div className="form-row">
                      <label htmlFor="collectionType" className="text-label">
                        Collection Type
                        <span className="label-required">*</span>
                      </label>
                      <div className="form-input-area">
                        <div className="form-input-field">
                          <Field
                            as="select"
                            id="collectionType"
                            name="type"
                            value={values.type}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                              handleChange(e);
                              setFieldValue('subtype', '');
                            }}
                          >
                            <option value="">Select Source...</option>
                            {collectionTypes.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </Field>
                        </div>
                        {errors.type && touched.type && (
                          <div className="error">
                            {errors.type}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Collection Sub-Type */}
                    {values.type && (
                      <div className="form-row">
                        <label htmlFor="collectionSubtype" className="text-label">
                          {intl.formatMessage(messages.collectionSubtype)}
                          <span className="label-required">*</span>
                        </label>
                        <div className="form-input-area">
                          <div className="form-input-field">
                            <Field
                              as="select"
                              id="collectionSubtype"
                              name="subtype"
                              value={values.subtype}
                            >
                              <option value="">{intl.formatMessage(messages.selectSubtype)}</option>
                              {getSubtypeOptions(values.type).map((subtype) => (
                                <option key={subtype.value} value={subtype.value}>
                                  {subtype.label}
                                </option>
                              ))}
                            </Field>
                          </div>
                          {errors.subtype && touched.subtype && (
                            <div className="error">
                              {errors.subtype}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Privacy Warnings for Overseerr Users Collections */}
                    {values.type === 'overseerr' && values.subtype === 'users' && (
                      <div className="space-y-3">
                        {/* General visibility warning */}
                        <div className="rounded-md border border-blue-500/20 bg-blue-500/10 p-4">
                          <div className="flex">
                            <svg
                              className="mt-0.5 mr-3 h-5 w-5 flex-shrink-0 text-blue-400"
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
                              <h4 className="mb-1 text-sm font-medium text-blue-300">
                                Server Owner Visibility
                              </h4>
                              <p className="text-sm text-blue-200">
                                All User Collections are always visible to the server owner, labels and restrictions are used to hide users collections from each other, which cannot be applied to the owner.
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Plex Pass privacy warning - only show if no Plex Pass */}
                        {values.type === 'overseerr' &&
                          values.subtype === 'users' &&
                          currentUser &&
                          !currentUser.hasPlexPass && (
                            <div className="rounded-md border border-orange-500/20 bg-orange-500/10 p-4">
                              <div className="flex">
                                <div className="flex-shrink-0">
                                  <svg
                                    className="h-5 w-5 text-orange-400"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                </div>
                                <div className="ml-3">
                                  <h3 className="text-sm font-medium text-orange-400">
                                    Plex Pass Required
                                  </h3>
                                  <p className="mt-2 text-sm text-orange-300">
                                    User collections require Plex Pass to function
                                    properly. Without it, collections will be visible to
                                    all users instead of just the individual user.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                      </div>
                    )}

                    {/* Custom Trakt List URL (for Trakt custom list collections) */}
                    {values.type === 'trakt' && values.subtype === 'custom' && (
                      <div className="form-row">
                        <label htmlFor="traktCustomListUrl" className="text-label">
                          Trakt List URL
                          <span className="label-required">*</span>
                        </label>
                        <div className="form-input-area">
                          <div className="form-input-field flex">
                            <Field
                              type="text"
                              id="traktCustomListUrl"
                              name="traktCustomListUrl"
                              placeholder="https://trakt.tv/users/username/lists/list-name"
                              className="flex-1"
                            />
                            <button
                              type="button"
                              className="ml-2 px-3 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
                              disabled={!values.traktCustomListUrl || fetchingTitle.trakt}
                              onClick={() => values.traktCustomListUrl && fetchTraktTitle(values.traktCustomListUrl, setFieldValue)}
                            >
                              {fetchingTitle.trakt ? 'Fetching...' : 'Fetch Title'}
                            </button>
                          </div>
                          {errors.traktCustomListUrl && touched.traktCustomListUrl && (
                            <div className="error">
                              {errors.traktCustomListUrl}
                            </div>
                          )}
                          {fetchedTitles.trakt && (
                            <div className="mt-2 text-sm text-green-400">
                              ✓ Found list: &quot;{fetchedTitles.trakt}&quot;
                            </div>
                          )}
                          <div className="label-tip">
                            Enter the URL of a public Trakt list (e.g., https://trakt.tv/users/username/lists/list-name)
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Custom TMDb Collection URL (for TMDb custom collections) */}
                    {values.type === 'tmdb' && values.subtype === 'custom' && (
                      <div className="form-row">
                        <label htmlFor="tmdbCustomListUrl" className="text-label">
                          TMDb Collection URL
                          <span className="label-required">*</span>
                        </label>
                        <div className="form-input-area">
                          <div className="form-input-field flex">
                            <Field
                              type="text"
                              id="tmdbCustomListUrl"
                              name="tmdbCustomListUrl"
                              placeholder="https://www.themoviedb.org/collection/12345"
                              className="flex-1"
                            />
                            <button
                              type="button"
                              className="ml-2 px-3 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
                              disabled={!values.tmdbCustomListUrl || fetchingTitle.tmdb}
                              onClick={() => values.tmdbCustomListUrl && fetchTmdbTitle(values.tmdbCustomListUrl)}
                            >
                              {fetchingTitle.tmdb ? 'Fetching...' : 'Fetch Title'}
                            </button>
                          </div>
                          {errors.tmdbCustomListUrl && touched.tmdbCustomListUrl && (
                            <div className="error">
                              {errors.tmdbCustomListUrl}
                            </div>
                          )}
                          {fetchedTitles.tmdb && (
                            <div className="mt-2 text-sm text-green-400">
                              ✓ Found collection: &quot;{fetchedTitles.tmdb}&quot;
                            </div>
                          )}
                          <div className="label-tip">
                            Enter the URL of a TMDb collection (e.g., https://www.themoviedb.org/collection/12345)
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Custom IMDb List URL (for IMDb custom collections) */}
                    {values.type === 'imdb' && values.subtype === 'custom' && (
                      <div className="form-row">
                        <label htmlFor="imdbCustomListUrl" className="text-label">
                          IMDb List URL
                          <span className="label-required">*</span>
                        </label>
                        <div className="form-input-area">
                          <div className="form-input-field flex">
                            <Field
                              type="text"
                              id="imdbCustomListUrl"
                              name="imdbCustomListUrl"
                              placeholder="https://www.imdb.com/list/ls123456789/"
                              className="flex-1"
                            />
                            <button
                              type="button"
                              className="ml-2 px-3 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
                              disabled={!values.imdbCustomListUrl || fetchingTitle.imdb}
                              onClick={() => values.imdbCustomListUrl && fetchImdbTitle(values.imdbCustomListUrl)}
                            >
                              {fetchingTitle.imdb ? 'Fetching...' : 'Fetch Title'}
                            </button>
                          </div>
                          {errors.imdbCustomListUrl && touched.imdbCustomListUrl && (
                            <div className="error">
                              {errors.imdbCustomListUrl}
                            </div>
                          )}
                          {fetchedTitles.imdb && (
                            <div className="mt-2 text-sm text-green-400">
                              ✓ Found list: &quot;{fetchedTitles.imdb}&quot;
                            </div>
                          )}
                          <div className="label-tip">
                            Enter the URL of a public IMDb list (e.g., https://www.imdb.com/list/ls123456789/)
                          </div>
                        </div>
                      </div>
                    )}

                    {values.type === 'letterboxd' && values.subtype === 'custom' && (
                      <div className="form-row">
                        <div className="form-input">
                          <div className="form-input-field">
                            <label htmlFor="letterboxdCustomListUrl" className="text-label">
                              Letterboxd List URL
                              <span className="label-required">*</span>
                            </label>
                            <div className="flex">
                              <Field
                                type="text"
                                id="letterboxdCustomListUrl"
                                name="letterboxdCustomListUrl"
                                placeholder="https://letterboxd.com/username/list/list-name/"
                                className="flex-1"
                              />
                              <button
                                type="button"
                                className="ml-2 px-3 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
                                disabled={!values.letterboxdCustomListUrl || fetchingTitle.letterboxd}
                                onClick={() => values.letterboxdCustomListUrl && fetchLetterboxdTitle(values.letterboxdCustomListUrl)}
                              >
                                {fetchingTitle.letterboxd ? 'Fetching...' : 'Fetch Title'}
                              </button>
                            </div>
                            {errors.letterboxdCustomListUrl && touched.letterboxdCustomListUrl && (
                              <div className="error">
                                {errors.letterboxdCustomListUrl}
                              </div>
                            )}
                            {fetchedTitles.letterboxd && (
                              <div className="mt-2 text-sm text-green-400">
                                ✓ Found list: &quot;{fetchedTitles.letterboxd}&quot;
                              </div>
                            )}
                            <div className="label-tip">
                              Enter the URL of a public Letterboxd list (e.g., https://letterboxd.com/username/list/list-name/)
                            </div>
                          </div>
                        </div>
                      </div>
                    )}


                    {/* Library Selection - visible when type/subtype selected AND (not custom OR title fetched OR editing existing config) */}
                    {values.type && values.subtype && (
                      // For custom types, show after title is fetched OR when editing existing config with a name
                      (values.subtype !== 'custom') ||
                      (values.type === 'trakt' && values.subtype === 'custom' && (fetchedTitles.trakt || config?.name)) ||
                      (values.type === 'tmdb' && values.subtype === 'custom' && (fetchedTitles.tmdb || config?.name)) ||
                      (values.type === 'imdb' && values.subtype === 'custom' && (fetchedTitles.imdb || config?.name))
                    ) && (
                        <div className="form-row">
                          <label htmlFor="collectionLibrary" className="text-label">
                            Library
                            <span className="label-required">*</span>
                          </label>
                          <div className="form-input-area">
                            <div className="form-input-field">
                              <LibraryCheckboxDropdown
                                selectedLibraries={(() => {
                                  // Convert current libraryId/libraryIds to selectedLibraries array for the dropdown
                                  if (values.libraryIds && Array.isArray(values.libraryIds)) {
                                    return values.libraryIds;
                                  }
                                  if (values.libraryId) {
                                    return Array.isArray(values.libraryId) ? values.libraryId : [values.libraryId];
                                  }
                                  return [];
                                })()}
                                allLibraries={getFilteredLibraries()}
                                showAllLibrariesOption={!getDetectedMediaType() || getDetectedMediaType() === 'both'}
                                onSelectionChange={(selectedIds: string[]) => {
                                  // Handle multiple library selection changes
                                  setFieldValue('libraryIds', selectedIds);
                                  
                                  const detectedType = (() => {
                                    if (values.type === 'trakt' && values.subtype === 'custom' && detectedMediaTypes.trakt) {
                                      return detectedMediaTypes.trakt;
                                    }
                                    if (values.type === 'tmdb' && values.subtype === 'custom' && detectedMediaTypes.tmdb) {
                                      return detectedMediaTypes.tmdb;
                                    }
                                    if (values.type === 'imdb' && values.subtype === 'custom' && detectedMediaTypes.imdb) {
                                      return detectedMediaTypes.imdb;
                                    }
                                    return null;
                                  })();
                                  
                                  if (selectedIds.includes('all')) {
                                    // All libraries selected
                                    setFieldValue('libraryName', 'All Libraries');
                                    setFieldValue('libraryNames', ['All Libraries']);
                                    setFieldValue('mediaType', detectedType || 'both');
                                  } else if (selectedIds.length === 1) {
                                    // Single library selected
                                    const selectedLibrary = libraries.find((lib) => lib.id === selectedIds[0]);
                                    setFieldValue('libraryName', selectedLibrary?.name || '');
                                    setFieldValue('libraryNames', selectedLibrary ? [selectedLibrary.name] : []);
                                    
                                    if (detectedType && detectedType !== 'both') {
                                      setFieldValue('mediaType', detectedType);
                                    } else if (selectedLibrary) {
                                      if (selectedLibrary.type === 'movie') {
                                        setFieldValue('mediaType', 'movie');
                                      } else if (selectedLibrary.type === 'show') {
                                        setFieldValue('mediaType', 'tv');
                                      } else {
                                        setFieldValue('mediaType', 'both');
                                      }
                                    } else {
                                      setFieldValue('mediaType', 'both');
                                    }
                                  } else if (selectedIds.length > 1) {
                                    // Multiple libraries selected
                                    const selectedLibraries = libraries.filter(lib => selectedIds.includes(lib.id));
                                    const libraryNames = selectedLibraries.map(lib => lib.name);
                                    setFieldValue('libraryName', `${selectedIds.length} libraries selected`);
                                    setFieldValue('libraryNames', libraryNames);
                                    setFieldValue('mediaType', detectedType || 'both');
                                  } else {
                                    // No libraries selected
                                    setFieldValue('libraryName', '');
                                    setFieldValue('libraryNames', []);
                                  }
                                  
                                  // Auto-select first template
                                  if (!values.template) {
                                    const templatePresets = getTemplatePresets(values, fetchedTitles, detectedMediaTypes);
                                    if (templatePresets.length > 0 && templatePresets[0].value &&
                                      templatePresets[0].value !== 'custom' && templatePresets[0].value !== 'fetch-title') {
                                      setFieldValue('template', templatePresets[0].value);
                                    }
                                  }
                                }}
                                error={errors.libraryId && touched.libraryId ? errors.libraryId : ''}
                              />
                            </div>
                            {errors.libraryId && touched.libraryId && (
                              <div className="error">
                                {errors.libraryId}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                    {/* Form unlocks when required fields are selected */}
                    {values.type &&
                      values.subtype &&
                      values.libraryId &&
                      (values.type !== 'tautulli' || values.customDays) &&
                      (values.type !== 'trakt' ||
                        values.subtype !== 'custom' ||
                        values.traktCustomListUrl) &&
                      (values.type !== 'tmdb' ||
                        values.subtype !== 'custom' ||
                        values.tmdbCustomListUrl) &&
                      (values.type !== 'imdb' ||
                        values.subtype !== 'custom' ||
                        values.imdbCustomListUrl) && (
                        <>
                          {/* Custom Days (for Tautulli collections) - moved here from above */}
                          {values.type === 'tautulli' && (
                            <div className="form-row">
                              <label htmlFor="customDays" className="text-label">
                                No. of Days
                                <span className="label-required">*</span>
                              </label>
                              <div className="form-input-area">
                                <div className="form-input-field">
                                  <Field
                                    type="text"
                                    inputMode="numeric"
                                    id="customDays"
                                    name="customDays"
                                    className="short"
                                  />
                                </div>
                                {errors.customDays && touched.customDays && (
                                  <div className="error">
                                    {errors.customDays}
                                  </div>
                                )}
                                <div className="label-tip">
                                  Number of days to look back for statistics (1-365)
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Collection Title Template */}
                          <div className="form-row">
                            <label htmlFor="collectionTemplate" className="text-label">
                              Collection Title Template
                              <span className="label-required">*</span>
                            </label>
                            <div className="form-input-area">
                              <div className="form-input-field">
                                <Field
                                  as="select"
                                  id="collectionTemplate"
                                  name="template"
                                  value={values.template}
                                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                                    handleChange(e);
                                    if (e.target.value !== 'custom') {
                                      // Clear custom templates when selecting a preset
                                      setFieldValue('customMovieTemplate', '');
                                      setFieldValue('customTVTemplate', '');
                                    }
                                  }}
                                >
                                  {(() => {
                                    const templatePresets = getTemplatePresets(values, fetchedTitles, detectedMediaTypes);
                                    return templatePresets.map((preset) => (
                                      <option key={preset.value} value={preset.value}>
                                        {preset.label}
                                      </option>
                                    ));
                                  })()}
                                </Field>
                              </div>

                              {/* Custom template input */}
                              {values.template === 'custom' && (
                                <div className="mt-2 space-y-3">
                                  {values.mediaType === 'both' ? (
                                    <>
                                      {/* Separate movie template */}
                                      <div className="form-input-field">
                                        <Field
                                          type="text"
                                          name="customMovieTemplate"
                                          placeholder="Movie collection template"
                                          onChange={handleChange}
                                        />
                                        {errors.customMovieTemplate && touched.customMovieTemplate && (
                                          <div className="error">
                                            {errors.customMovieTemplate}
                                          </div>
                                        )}
                                      </div>
                                      {/* Separate TV template */}
                                      <div className="form-input-field">
                                        <Field
                                          type="text"
                                          name="customTVTemplate"
                                          placeholder="TV show collection template"
                                          onChange={handleChange}
                                        />
                                        {errors.customTVTemplate && touched.customTVTemplate && (
                                          <div className="error">
                                            {errors.customTVTemplate}
                                          </div>
                                        )}
                                      </div>
                                    </>
                                  ) : values.mediaType === 'movie' ? (
                                    // Movie library - show only movie template
                                    <div className="form-input-field">
                                      <Field
                                        type="text"
                                        name="customMovieTemplate"
                                        placeholder="Movie collection template"
                                        onChange={handleChange}
                                      />
                                      {errors.customMovieTemplate && touched.customMovieTemplate && (
                                        <div className="error">
                                          {errors.customMovieTemplate}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    // TV library - show only TV template
                                    <div className="form-input-field">
                                      <Field
                                        type="text"
                                        name="customTVTemplate"
                                        placeholder="TV show collection template"
                                        onChange={handleChange}
                                      />
                                      {errors.customTVTemplate && touched.customTVTemplate && (
                                        <div className="error">
                                          {errors.customTVTemplate}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Template validation error */}
                                  {errors.template && touched.template && (
                                    <div className="error">
                                      {errors.template}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Template preview */}
                              <div className="mt-3 rounded-md bg-gray-700 p-3">
                                <h5 className="mb-2 text-sm font-medium text-white">
                                  Preview:
                                </h5>
                                <div className="text-sm text-gray-300">
                                  {(() => {
                                    // Get the actual template being used (same logic as dropdown)
                                    const templatePresets = getTemplatePresets(values, fetchedTitles, detectedMediaTypes);
                                    const currentTemplate = values.template || templatePresets[0]?.value || '';

                                    const selectedLibraryIds = values.libraryIds || (values.libraryId ? (Array.isArray(values.libraryId) ? values.libraryId : [values.libraryId]) : []);
                                    const hasAllLibraries = selectedLibraryIds.includes('all') || values.libraryId === 'all';
                                    const specificLibraryIds = selectedLibraryIds.filter(id => id !== 'all');
                                    const hasMultipleSpecificLibraries = specificLibraryIds.length > 1;
                                    const hasSingleSpecificLibrary = specificLibraryIds.length === 1;
                                    
                                    if (hasAllLibraries) {
                                      return (
                                        // Show preview for each library when "All Libraries" is selected
                                        <div className="space-y-2">
                                          {libraries
                                            .filter((lib) => lib.enabled)
                                            .map((library) => {
                                              const libraryMediaType = library.type === 'show' ? 'tv' : 'movie';
                                              const templateToUse = (() => {
                                                if (values.template === 'custom') {
                                                  if (libraryMediaType === 'movie') {
                                                    return values.customMovieTemplate || '';
                                                  } else {
                                                    return values.customTVTemplate || '';
                                                  }
                                                }
                                                return currentTemplate;
                                              })();

                                              return (
                                                <div key={library.id} className="flex items-start space-x-2">
                                                  <span className={`font-medium flex-shrink-0 ${library.type === 'movie' ? 'text-blue-400' : 'text-green-400'
                                                    }`}>
                                                    {library.name}:
                                                  </span>
                                                  <span className="text-gray-300">
                                                    {templateToUse ? generatePreview(templateToUse, libraryMediaType, values) : ''}
                                                  </span>
                                                </div>
                                              );
                                            })}
                                        </div>
                                      );
                                    } else if (hasMultipleSpecificLibraries) {
                                      return (
                                        // Show preview for each selected specific library
                                        <div className="space-y-2">
                                          {selectedLibraryIds
                                            .filter(id => id !== 'all')
                                            .map((libraryId) => {
                                              const library = libraries.find(lib => lib.id === libraryId);
                                              if (!library) return null;
                                              
                                              const libraryMediaType = library.type === 'show' ? 'tv' : 'movie';
                                              const templateToUse = (() => {
                                                if (values.template === 'custom') {
                                                  if (libraryMediaType === 'movie') {
                                                    return values.customMovieTemplate || '';
                                                  } else {
                                                    return values.customTVTemplate || '';
                                                  }
                                                }
                                                return currentTemplate;
                                              })();

                                              return (
                                                <div key={library.id} className="flex items-start space-x-2">
                                                  <span className={`font-medium flex-shrink-0 ${library.type === 'movie' ? 'text-blue-400' : 'text-green-400'
                                                    }`}>
                                                    {library.name}:
                                                  </span>
                                                  <span className="text-gray-300">
                                                    {templateToUse ? generatePreview(templateToUse, libraryMediaType, values) : ''}
                                                  </span>
                                                </div>
                                              );
                                            })}
                                        </div>
                                      );
                                    } else if (hasSingleSpecificLibrary) {
                                      return (
                                        // Show preview for single selected specific library
                                        (() => {
                                          const libraryId = specificLibraryIds[0];
                                          const library = libraries.find(lib => lib.id === libraryId);
                                          if (!library) return 'No library found';
                                          
                                          const libraryMediaType = library.type === 'show' ? 'tv' : 'movie';
                                          const templateToUse = (() => {
                                            if (values.template === 'custom') {
                                              if (libraryMediaType === 'movie') {
                                                return values.customMovieTemplate || '';
                                              } else {
                                                return values.customTVTemplate || '';
                                              }
                                            }
                                            return currentTemplate;
                                          })();

                                          return (
                                            <div className="flex items-start space-x-2">
                                              <span className={`font-medium flex-shrink-0 ${library.type === 'movie' ? 'text-blue-400' : 'text-green-400'
                                                }`}>
                                                {library.name}:
                                              </span>
                                              <span className="text-gray-300">
                                                {templateToUse ? generatePreview(templateToUse, libraryMediaType, values) : ''}
                                              </span>
                                            </div>
                                          );
                                        })()
                                      );
                                    } else if (values.mediaType === 'both' && values.template === 'custom') {
                                      return (
                                        // Show separate movie/TV preview for single library with both media types
                                        <div className="space-y-1">
                                          <div>
                                            <span className="text-blue-400">Movies:</span>{' '}
                                            {values.customMovieTemplate ? generatePreview(
                                              values.customMovieTemplate,
                                              'movie',
                                              values
                                            ) : ''}
                                          </div>
                                          <div>
                                            <span className="text-green-400">TV Shows:</span>{' '}
                                            {values.customTVTemplate ? generatePreview(
                                              values.customTVTemplate,
                                              'tv',
                                              values
                                            ) : ''}
                                          </div>
                                        </div>
                                      );
                                    } else {
                                      // Single library or main template
                                      if (values.template === 'custom') {
                                        // For custom templates, show preview only if custom template exists
                                        if (values.mediaType === 'movie' && values.customMovieTemplate) {
                                          return generatePreview(values.customMovieTemplate, 'movie', values);
                                        } else if (values.mediaType === 'tv' && values.customTVTemplate) {
                                          return generatePreview(values.customTVTemplate, 'tv', values);
                                        } else {
                                          return ''; // Show blank if no custom template entered yet
                                        }
                                      } else {
                                        return generatePreview(currentTemplate, undefined, values);
                                      }
                                    }
                                  })()}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Item Order - only for external sources that support ordering */}
                          {values.type === 'trakt' && (
                            <div className="form-row">
                              <label htmlFor="itemOrder" className="text-label">
                                Item Order
                              </label>
                              <div className="form-input-area">
                                <div className="form-input-field">
                                  <Field
                                    as="select"
                                    id="itemOrder"
                                    name="itemOrder"
                                    value={(() => {
                                      if (values.randomizeOrder) return 'random';
                                      if (values.reverseOrder) return 'reverse';
                                      return 'default';
                                    })()}
                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                                      const selectedValue = e.target.value;
                                      if (selectedValue === 'random') {
                                        setFieldValue('randomizeOrder', true);
                                        setFieldValue('reverseOrder', false);
                                      } else if (selectedValue === 'reverse') {
                                        setFieldValue('randomizeOrder', false);
                                        setFieldValue('reverseOrder', true);
                                      } else {
                                        setFieldValue('randomizeOrder', false);
                                        setFieldValue('reverseOrder', false);
                                      }
                                    }}
                                  >
                                    <option value="default">Default order (as provided by source)</option>
                                    <option value="reverse">Reverse order</option>
                                    <option value="random">Random order (shuffled each sync)</option>
                                  </Field>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Collection Visibility */}
                          <div className="form-row">
                            <div className="text-label">
                              Visibility
                            </div>
                            <div className="form-input-area">
                              <div className="space-y-2">
                                {(() => {
                                  const checkboxStates = getVisibilityCheckboxStates();
                                  return (
                                    <>
                                      <div className="flex items-center">
                                        <Field
                                          type="checkbox"
                                          id="visibilityUsersHome"
                                          name="visibilityConfig.usersHome"
                                          disabled={!checkboxStates.usersHome.enabled || values.visibilityConfig?.libraryTabOnly}
                                          className={`form-checkbox ${!checkboxStates.usersHome.enabled || values.visibilityConfig?.libraryTabOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        />
                                        <label 
                                          htmlFor="visibilityUsersHome" 
                                          className={`ml-2 text-sm ${!checkboxStates.usersHome.enabled || values.visibilityConfig?.libraryTabOnly ? 'text-gray-500' : ''}`}
                                        >
                                          {checkboxStates.usersHome.label}
                                        </label>
                                      </div>
                                      <div className="flex items-center">
                                        <Field
                                          type="checkbox"
                                          id="visibilityServerOwnerHome"
                                          name="visibilityConfig.serverOwnerHome"
                                          disabled={!checkboxStates.serverOwnerHome.enabled || values.visibilityConfig?.libraryTabOnly}
                                          className={`form-checkbox ${!checkboxStates.serverOwnerHome.enabled || values.visibilityConfig?.libraryTabOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        />
                                        <label 
                                          htmlFor="visibilityServerOwnerHome" 
                                          className={`ml-2 text-sm ${!checkboxStates.serverOwnerHome.enabled || values.visibilityConfig?.libraryTabOnly ? 'text-gray-500' : ''}`}
                                        >
                                          {checkboxStates.serverOwnerHome.label}
                                        </label>
                                      </div>
                                      <div className="flex items-center">
                                        <Field
                                          type="checkbox"
                                          id="visibilityLibraryRecommended"
                                          name="visibilityConfig.libraryRecommended"
                                          disabled={!checkboxStates.libraryRecommended.enabled || values.visibilityConfig?.libraryTabOnly}
                                          className={`form-checkbox ${!checkboxStates.libraryRecommended.enabled || values.visibilityConfig?.libraryTabOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        />
                                        <label 
                                          htmlFor="visibilityLibraryRecommended" 
                                          className={`ml-2 text-sm ${!checkboxStates.libraryRecommended.enabled || values.visibilityConfig?.libraryTabOnly ? 'text-gray-500' : ''}`}
                                        >
                                          {checkboxStates.libraryRecommended.label}
                                        </label>
                                      </div>
                                      <div className="flex items-center">
                                        <Field
                                          type="checkbox"
                                          id="visibilityLibraryTabOnly"
                                          name="visibilityConfig.libraryTabOnly"
                                          disabled={!checkboxStates.libraryTabOnly.enabled}
                                          className={`form-checkbox ${!checkboxStates.libraryTabOnly.enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                            setFieldValue('visibilityConfig.libraryTabOnly', e.target.checked);
                                            // When Library Tab Only is checked, uncheck all other options
                                            if (e.target.checked) {
                                              setFieldValue('visibilityConfig.usersHome', false);
                                              setFieldValue('visibilityConfig.serverOwnerHome', false);
                                              setFieldValue('visibilityConfig.libraryRecommended', false);
                                            }
                                          }}
                                        />
                                        <label 
                                          htmlFor="visibilityLibraryTabOnly" 
                                          className={`ml-2 text-sm ${!checkboxStates.libraryTabOnly.enabled ? 'text-gray-500' : ''}`}
                                        >
                                          {checkboxStates.libraryTabOnly.label}
                                        </label>
                                      </div>
                                    </>
                                  );
                                })()}
                                <div className="text-xs text-gray-400 mt-2">
                                  {values.visibilityConfig?.libraryTabOnly 
                                    ? 'Collection will only appear in Library tab (overrides other options)'
                                    : 'If no visibility options are selected, collection will only appear in Library tab'
                                  }
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Max Items */}
                          <div className="form-row">
                            <label htmlFor="collectionMaxItems" className="text-label">
                              Max Items
                            </label>
                            <div className="form-input-area">
                              <div className="form-input-field">
                                <Field
                                  type="text"
                                  inputMode="numeric"
                                  id="collectionMaxItems"
                                  name="maxItems"
                                  className="short"
                                />
                              </div>
                              {errors.maxItems && touched.maxItems && (
                                <div className="error">
                                  {errors.maxItems}
                                </div>
                              )}
                              <div className="label-tip">
                                Maximum number of items to include in collection (1-1000)
                              </div>
                            </div>
                          </div>

                          {/* Custom Poster */}
                          <div className="form-row">
                            <label htmlFor="customPoster" className="text-label">Custom Poster</label>
                            <div className="form-input-area">
                              <div className="form-input-field">
                                <input
                                  type="file"
                                  id="customPoster"
                                  accept="image/jpeg,image/png,image/webp"
                                  disabled={posterUploading}
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      // Validate file size on client side
                                      if (file.size > 10 * 1024 * 1024) {
                                        addToast('File size must be less than 10MB', { appearance: 'error' });
                                        e.target.value = ''; // Reset file input
                                        return;
                                      }
                                      
                                      // Validate file type
                                      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
                                      if (!allowedTypes.includes(file.type)) {
                                        addToast('Only JPEG, PNG, and WebP files are allowed', { appearance: 'error' });
                                        e.target.value = ''; // Reset file input
                                        return;
                                      }
                                      
                                      setPosterUploading(true);
                                      try {
                                        const formData = new FormData();
                                        formData.append('poster', file);
                                        
                                        const response = await fetch('/api/v1/settings/collections/poster', {
                                          method: 'POST',
                                          body: formData,
                                        });
                                        
                                        if (response.ok) {
                                          const result = await response.json();
                                          setFieldValue('customPoster', result.filename);
                                          addToast('Poster uploaded successfully. Will be applied on next collection sync.', { appearance: 'success' });
                                        } else {
                                          const error = await response.json();
                                          addToast(`Upload failed: ${error.error}`, { appearance: 'error' });
                                          e.target.value = ''; // Reset file input on error
                                        }
                                      } catch (error) {
                                        const message = error instanceof Error ? error.message : 'Network error occurred';
                                        addToast(`Upload failed: ${message}`, { appearance: 'error' });
                                        e.target.value = ''; // Reset file input on error
                                      } finally {
                                        setPosterUploading(false);
                                      }
                                    }
                                  }}
                                  className={`form-input ${posterUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                />
                              </div>
                              {posterUploading && (
                                <div className="mt-2 flex items-center space-x-2">
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                                  <span className="text-sm text-gray-600">Uploading poster...</span>
                                </div>
                              )}
                              {values.customPoster && !posterUploading && (
                                <div className="mt-2 flex items-center space-x-2">
                                  <img
                                    src={`/api/v1/settings/collections/poster/${values.customPoster}`}
                                    alt="Custom poster preview"
                                    className="h-20 w-14 object-cover rounded shadow-sm border"
                                    onError={(e) => {
                                      // Handle broken image URLs
                                      const target = e.target as HTMLImageElement;
                                      target.src = '/images/overseerr_poster_not_found.png';
                                    }}
                                  />
                                  <div className="flex flex-col space-y-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setFieldValue('customPoster', '');
                                        addToast('Poster will be removed on next collection sync', { appearance: 'info' });
                                      }}
                                      className="text-red-600 hover:text-red-800 text-sm px-2 py-1 border border-red-300 rounded hover:bg-red-50 transition-colors"
                                    >
                                      Remove
                                    </button>
                                    <span className="text-xs text-gray-500">500x750px</span>
                                  </div>
                                </div>
                              )}
                              <div className="label-tip">
                                Upload a custom poster image for this collection (JPEG, PNG, or WebP, max 10MB). Poster will be applied to Plex during the next collection sync.
                              </div>
                            </div>
                          </div>

                          {/* Time Restrictions */}
                          <div className="form-row">
                            <label htmlFor="timeRestrictions" className="text-label">Time Restrictions</label>
                            <div className="form-input-area">
                              <div className="form-input-field">
                                <label className="inline-flex items-center">
                                  <input
                                    id="timeRestrictions"
                                    type="checkbox"
                                    checked={values.timeRestriction?.alwaysActive ?? true}
                                    onChange={(e) => {
                                      setFieldValue('timeRestriction', {
                                        ...values.timeRestriction,
                                        alwaysActive: e.target.checked,
                                      });
                                    }}
                                    className="form-checkbox"
                                  />
                                  <span className="ml-2 text-sm text-gray-300">
                                    Always Active (no time restrictions)
                                  </span>
                                </label>
                              </div>

                              {/* Remove from Plex option - only show when not always active */}
                              {!values.timeRestriction?.alwaysActive && (
                                <div className="form-input-field mt-2">
                                  <label className="inline-flex items-center">
                                    <input
                                      type="checkbox"
                                      checked={values.timeRestriction?.removeFromPlexWhenInactive ?? false}
                                      onChange={(e) => {
                                        setFieldValue('timeRestriction', {
                                          ...values.timeRestriction,
                                          alwaysActive: false,
                                          removeFromPlexWhenInactive: e.target.checked,
                                        });
                                      }}
                                      className="form-checkbox"
                                    />
                                    <span className="ml-2 text-sm text-gray-400">
                                      Remove from Plex when inactive
                                    </span>
                                  </label>
                                </div>
                              )}

                              {/* Inactive Visibility Settings - only show when not always active AND not removing from Plex */}
                              {!values.timeRestriction?.alwaysActive && !values.timeRestriction?.removeFromPlexWhenInactive && (
                                <div className="mt-4 p-4 bg-gray-800 rounded-md">
                                  <div className="text-sm font-medium text-gray-300 mb-3">
                                    Visibility When Inactive
                                  </div>
                                  <div className="space-y-2">
                                    {(() => {
                                      const checkboxStates = getVisibilityCheckboxStates();
                                      return (
                                        <>
                                          <div className="flex items-center">
                                            <input
                                              type="checkbox"
                                              id="inactiveVisibilityUsersHome"
                                              checked={values.timeRestriction?.inactiveVisibilityConfig?.usersHome ?? false}
                                              disabled={!checkboxStates.usersHome.enabled || values.timeRestriction?.inactiveVisibilityConfig?.libraryTabOnly}
                                              onChange={(e) => {
                                                setFieldValue('timeRestriction.inactiveVisibilityConfig.usersHome', e.target.checked);
                                              }}
                                              className={`form-checkbox ${!checkboxStates.usersHome.enabled || values.timeRestriction?.inactiveVisibilityConfig?.libraryTabOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            />
                                            <label 
                                              htmlFor="inactiveVisibilityUsersHome" 
                                              className={`ml-2 text-sm ${!checkboxStates.usersHome.enabled || values.timeRestriction?.inactiveVisibilityConfig?.libraryTabOnly ? 'text-gray-500' : 'text-gray-300'}`}
                                            >
                                              Users Home
                                            </label>
                                          </div>
                                          <div className="flex items-center">
                                            <input
                                              type="checkbox"
                                              id="inactiveVisibilityServerOwnerHome"
                                              checked={values.timeRestriction?.inactiveVisibilityConfig?.serverOwnerHome ?? false}
                                              disabled={!checkboxStates.serverOwnerHome.enabled || values.timeRestriction?.inactiveVisibilityConfig?.libraryTabOnly}
                                              onChange={(e) => {
                                                setFieldValue('timeRestriction.inactiveVisibilityConfig.serverOwnerHome', e.target.checked);
                                              }}
                                              className={`form-checkbox ${!checkboxStates.serverOwnerHome.enabled || values.timeRestriction?.inactiveVisibilityConfig?.libraryTabOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            />
                                            <label 
                                              htmlFor="inactiveVisibilityServerOwnerHome" 
                                              className={`ml-2 text-sm ${!checkboxStates.serverOwnerHome.enabled || values.timeRestriction?.inactiveVisibilityConfig?.libraryTabOnly ? 'text-gray-500' : 'text-gray-300'}`}
                                            >
                                              Server Owner Home
                                            </label>
                                          </div>
                                          <div className="flex items-center">
                                            <input
                                              type="checkbox"
                                              id="inactiveVisibilityLibraryRecommended"
                                              checked={values.timeRestriction?.inactiveVisibilityConfig?.libraryRecommended ?? false}
                                              disabled={!checkboxStates.libraryRecommended.enabled || values.timeRestriction?.inactiveVisibilityConfig?.libraryTabOnly}
                                              onChange={(e) => {
                                                setFieldValue('timeRestriction.inactiveVisibilityConfig.libraryRecommended', e.target.checked);
                                              }}
                                              className={`form-checkbox ${!checkboxStates.libraryRecommended.enabled || values.timeRestriction?.inactiveVisibilityConfig?.libraryTabOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            />
                                            <label 
                                              htmlFor="inactiveVisibilityLibraryRecommended" 
                                              className={`ml-2 text-sm ${!checkboxStates.libraryRecommended.enabled || values.timeRestriction?.inactiveVisibilityConfig?.libraryTabOnly ? 'text-gray-500' : 'text-gray-300'}`}
                                            >
                                              Library Recommended
                                            </label>
                                          </div>
                                          <div className="flex items-center">
                                            <input
                                              type="checkbox"
                                              id="inactiveVisibilityLibraryTabOnly"
                                              checked={values.timeRestriction?.inactiveVisibilityConfig?.libraryTabOnly ?? false}
                                              disabled={!checkboxStates.libraryTabOnly.enabled}
                                              onChange={(e) => {
                                                setFieldValue('timeRestriction.inactiveVisibilityConfig.libraryTabOnly', e.target.checked);
                                                // When Library Tab Only is checked, uncheck all other options
                                                if (e.target.checked) {
                                                  setFieldValue('timeRestriction.inactiveVisibilityConfig.usersHome', false);
                                                  setFieldValue('timeRestriction.inactiveVisibilityConfig.serverOwnerHome', false);
                                                  setFieldValue('timeRestriction.inactiveVisibilityConfig.libraryRecommended', false);
                                                }
                                              }}
                                              className={`form-checkbox ${!checkboxStates.libraryTabOnly.enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            />
                                            <label 
                                              htmlFor="inactiveVisibilityLibraryTabOnly" 
                                              className={`ml-2 text-sm ${!checkboxStates.libraryTabOnly.enabled ? 'text-gray-500' : 'text-gray-300'}`}
                                            >
                                              Library Tab Only
                                            </label>
                                          </div>
                                        </>
                                      );
                                    })()}
                                    <div className="text-xs text-gray-400 mt-2">
                                      {values.timeRestriction?.inactiveVisibilityConfig?.libraryTabOnly 
                                        ? 'Collection will only appear in Library tab when inactive'
                                        : 'Choose where the collection should appear when inactive'
                                      }
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Time restriction options - only show when not always active */}
                              {!values.timeRestriction?.alwaysActive && (
                                <div className="mt-4 space-y-4">
                                  {/* Date Ranges */}
                                  <div>
                                    <div className="block text-sm font-medium text-gray-300 mb-2">
                                      Date Ranges for Collection to be active
                                    </div>

                                    {values.timeRestriction?.dateRanges?.map((range, index) => (
                                      <div key={index} className="flex items-center space-x-2 mb-2">
                                        <input
                                          type="text"
                                          placeholder="DD-MM"
                                          value={range.startDate}
                                          onChange={(e) => {
                                            const newRanges = [...(values.timeRestriction?.dateRanges || [])];
                                            newRanges[index] = { ...range, startDate: e.target.value };
                                            setFieldValue('timeRestriction', {
                                              ...values.timeRestriction,
                                              alwaysActive: false,
                                              dateRanges: newRanges,
                                            });
                                          }}
                                          className="w-20 text-sm"
                                          maxLength={5}
                                        />
                                        <span className="text-gray-400">to</span>
                                        <input
                                          type="text"
                                          placeholder="DD-MM"
                                          value={range.endDate}
                                          onChange={(e) => {
                                            const newRanges = [...(values.timeRestriction?.dateRanges || [])];
                                            newRanges[index] = { ...range, endDate: e.target.value };
                                            setFieldValue('timeRestriction', {
                                              ...values.timeRestriction,
                                              alwaysActive: false,
                                              dateRanges: newRanges,
                                            });
                                          }}
                                          className="w-20 text-sm"
                                          maxLength={5}
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const newRanges = values.timeRestriction?.dateRanges?.filter((_, i) => i !== index) || [];
                                            setFieldValue('timeRestriction', {
                                              ...values.timeRestriction,
                                              alwaysActive: false,
                                              dateRanges: newRanges,
                                            });
                                          }}
                                          className="text-red-400 hover:text-red-300"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}

                                    <button
                                      type="button"
                                      onClick={() => {
                                        const currentRanges = values.timeRestriction?.dateRanges || [];
                                        setFieldValue('timeRestriction', {
                                          ...values.timeRestriction,
                                          alwaysActive: false,
                                          dateRanges: [...currentRanges, { startDate: '', endDate: '' }],
                                        });
                                      }}
                                      className="text-indigo-400 hover:text-indigo-300 text-sm"
                                    >
                                      + Add Date Range
                                    </button>
                                  </div>

                                  {/* Weekly Schedule */}
                                  <div>
                                    <div className="block text-sm font-medium text-gray-300 mb-2">
                                      Days of the Week for Collection to be active
                                    </div>

                                    <div className="grid grid-cols-4 gap-2">
                                      {[
                                        { key: 'monday', label: 'Mon' },
                                        { key: 'tuesday', label: 'Tue' },
                                        { key: 'wednesday', label: 'Wed' },
                                        { key: 'thursday', label: 'Thu' },
                                        { key: 'friday', label: 'Fri' },
                                        { key: 'saturday', label: 'Sat' },
                                        { key: 'sunday', label: 'Sun' },
                                      ].map((day) => (
                                        <label key={day.key} className="inline-flex items-center">
                                          <input
                                            type="checkbox"
                                            checked={values.timeRestriction?.weeklySchedule?.[day.key as keyof typeof values.timeRestriction.weeklySchedule] ?? false}
                                            onChange={(e) => {
                                              const currentSchedule = values.timeRestriction?.weeklySchedule || {
                                                monday: false,
                                                tuesday: false,
                                                wednesday: false,
                                                thursday: false,
                                                friday: false,
                                                saturday: false,
                                                sunday: false,
                                              };
                                              setFieldValue('timeRestriction', {
                                                ...values.timeRestriction,
                                                alwaysActive: false,
                                                weeklySchedule: {
                                                  ...currentSchedule,
                                                  [day.key]: e.target.checked,
                                                },
                                              });
                                            }}
                                            className="form-checkbox"
                                          />
                                          <span className="ml-1 text-sm text-gray-300">
                                            {day.label}
                                          </span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div className="label-tip">
                                Time restrictions allow you to control when and how collections appear in Plex based on date ranges and weekly schedules.
                                You can choose to either remove collections completely when inactive, or change their visibility settings.
                              </div>
                            </div>
                          </div>

                          {/* Auto-Request Section - only for external sources (not Overseerr or Tautulli) */}
                          {values.type && values.type !== 'overseerr' && values.type !== 'tautulli' && (
                            <div className="space-y-4">
                              <div className="text-lg font-medium text-white" id="auto-request-settings">
                                Auto-Request Settings
                              </div>

                              {/* Movie Auto-Request - only show for movie libraries or all libraries */}
                              {(() => {
                                const selectedLibraryIds = values.libraryIds || (values.libraryId ? (Array.isArray(values.libraryId) ? values.libraryId : [values.libraryId]) : []);
                                const hasAllLibraries = selectedLibraryIds.includes('all') || values.libraryId === 'all';
                                const hasMovieLibrary = selectedLibraryIds.some(id => id !== 'all' && libraries.find(lib => lib.id === id)?.type === 'movie');
                                return hasAllLibraries || hasMovieLibrary || values.mediaType === 'movie' || values.mediaType === 'both';
                              })() && (
                                  <div className="form-row">
                                    <label className="text-label" htmlFor="movie-auto-request">Movie Auto-Request</label>
                                    <div className="form-input-area" id="movie-auto-request">
                                      <div className="space-y-2">
                                        <label className="inline-flex cursor-pointer items-center" htmlFor="searchMissingMovies">
                                          <Field
                                            type="checkbox"
                                            name="searchMissingMovies"
                                            className="form-checkbox"
                                            id="searchMissingMovies"
                                          />
                                          <span className="ml-2 text-white">
                                            Auto-request missing movies
                                          </span>
                                        </label>
                                        {values.searchMissingMovies && (
                                          <label className="inline-flex cursor-pointer items-center ml-6" htmlFor="autoApproveMovies">
                                            <Field
                                              type="checkbox"
                                              name="autoApproveMovies"
                                              className="form-checkbox"
                                              id="autoApproveMovies"
                                            />
                                            <span className="ml-2 text-white">
                                              Auto-approve movie requests
                                            </span>
                                          </label>
                                        )}
                                      </div>
                                      <div className="label-tip">
                                        Automatically request and optionally approve movies that are in the collection but not available in Plex
                                      </div>
                                    </div>
                                  </div>
                                )}

                              {/* TV Auto-Request - only show for TV libraries or all libraries */}
                              {(() => {
                                const selectedLibraryIds = values.libraryIds || (values.libraryId ? (Array.isArray(values.libraryId) ? values.libraryId : [values.libraryId]) : []);
                                const hasAllLibraries = selectedLibraryIds.includes('all') || values.libraryId === 'all';
                                const hasTvLibrary = selectedLibraryIds.some(id => id !== 'all' && libraries.find(lib => lib.id === id)?.type === 'show');
                                return hasAllLibraries || hasTvLibrary || values.mediaType === 'tv' || values.mediaType === 'both';
                              })() && (
                                  <div className="form-row">
                                    <label className="text-label" htmlFor="tv-auto-request">TV Auto-Request</label>
                                    <div className="form-input-area" id="tv-auto-request">
                                      <div className="space-y-2">
                                        <label className="inline-flex cursor-pointer items-center" htmlFor="searchMissingTV">
                                          <Field
                                            type="checkbox"
                                            name="searchMissingTV"
                                            className="form-checkbox"
                                            id="searchMissingTV"
                                          />
                                          <span className="ml-2 text-white">
                                            Auto-request missing TV shows
                                          </span>
                                        </label>
                                        {values.searchMissingTV && (
                                          <label className="inline-flex cursor-pointer items-center ml-6" htmlFor="autoApproveTV">
                                            <Field
                                              type="checkbox"
                                              name="autoApproveTV"
                                              className="form-checkbox"
                                              id="autoApproveTV"
                                            />
                                            <span className="ml-2 text-white">
                                              Auto-approve TV show requests
                                            </span>
                                          </label>
                                        )}
                                      </div>
                                      <div className="label-tip">
                                        Automatically request and optionally approve TV shows that are in the collection but not available in Plex
                                      </div>
                                    </div>
                                  </div>
                                )}

                              {/* TV Season Limit */}
                              {values.searchMissingTV && values.autoApproveTV && (
                                <div className="form-row">
                                  <label
                                    htmlFor="maxSeasonsToRequest"
                                    className="text-label"
                                  >
                                    TV Season Limit
                                  </label>
                                  <div className="form-input-area">
                                    <div className="form-input-field">
                                      <Field
                                        type="text"
                                        inputMode="numeric"
                                        id="maxSeasonsToRequest"
                                        name="maxSeasonsToRequest"
                                        className="short"
                                      />
                                    </div>
                                    {errors.maxSeasonsToRequest && touched.maxSeasonsToRequest && (
                                      <div className="error">
                                        {errors.maxSeasonsToRequest}
                                      </div>
                                    )}
                                    <div className="label-tip">
                                      Maximum number of seasons to auto-approve for TV shows (1-50)
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}

                  </div>
                );
              })()}
            </Modal>
          );
        }}
      </Formik>
    </Transition>
  );

  function generateCollectionName(values: CollectionConfig): string {
    if (
      values.type === 'overseerr' &&
      (values.subtype === 'users' || values.subtype === 'server_owner')
    ) {
      return values.name || 'User Collection';
    }

    let generatedName: string;
    const templatePresets = getTemplatePresets(values, fetchedTitles, detectedMediaTypes);
    if (
      values.mediaType === 'both' &&
      (!values.template || !templatePresets.find((p) => p.value === values.template))
    ) {
      generatedName = generatePreview(
        values.customMovieTemplate || values.template,
        undefined,
        values
      );
    } else {
      generatedName = generatePreview(values.template, undefined, values);
    }

    return generatedName;
  }
};

export default CollectionConfigForm;
