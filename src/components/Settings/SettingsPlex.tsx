import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import LibraryItem from '@app/components/Settings/LibraryItem';
import SettingsBadge from '@app/components/Settings/SettingsBadge';
import globalMessages from '@app/i18n/globalMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import type { PlexDevice } from '@server/interfaces/api/plexInterfaces';
import type {
  PlexSettings,
  TautulliSettings,
  TraktSettings,
} from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { orderBy } from 'lodash';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';
import * as Yup from 'yup';

const messages = defineMessages({
  plex: 'Plex',
  plexsettings: 'Plex Settings',
  plexsettingsDescription:
    'Configure the settings for your Plex server. Overseerr scans your Plex libraries to determine content availability.',
  serverpreset: 'Server',
  serverLocal: 'local',
  serverRemote: 'remote',
  serverSecure: 'secure',
  serverpresetManualMessage: 'Manual configuration',
  serverpresetRefreshing: 'Retrieving servers…',
  serverpresetLoad: 'Press the button to load available servers',
  toastPlexRefresh: 'Retrieving server list from Plex…',
  toastPlexRefreshSuccess: 'Plex server list retrieved successfully!',
  toastPlexRefreshFailure: 'Failed to retrieve Plex server list.',
  toastPlexConnecting: 'Attempting to connect to Plex…',
  toastPlexConnectingSuccess: 'Plex connection established successfully!',
  toastPlexConnectingFailure: 'Failed to connect to Plex.',
  settingUpPlexDescription:
    'To set up Plex, you can either enter the details manually or select a server retrieved from <RegisterPlexTVLink>plex.tv</RegisterPlexTVLink>. Press the button to the right of the dropdown to fetch the list of available servers.',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  enablessl: 'Use SSL',
  plexlibraries: 'Plex Libraries',
  plexlibrariesDescription:
    'The libraries Overseerr scans for titles. Set up and save your Plex connection settings, then click the button below if no libraries are listed.',
  scanning: 'Syncing…',
  scan: 'Sync Libraries',
  manualscan: 'Manual Library Scan',
  manualscanDescription:
    "Normally, this will only be run once every 24 hours. Overseerr will check your Plex server's recently added more aggressively. If this is your first time configuring Plex, a one-time full manual library scan is recommended!",
  notrunning: 'Not Running',
  currentlibrary: 'Current Library: {name}',
  librariesRemaining: 'Libraries Remaining: {count}',
  startscan: 'Start Scan',
  cancelscan: 'Cancel Scan',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  webAppUrl: '<WebAppLink>Web App</WebAppLink> URL',
  webAppUrlTip:
    'Optionally direct users to the web app on your server instead of the "hosted" web app',
  tautulliSettings: 'Tautulli Settings',
  tautulliSettingsDescription:
    'Optionally configure the settings for your Tautulli server. Overseerr fetches watch history data for your Plex media from Tautulli.',
  urlBase: 'URL Base',
  tautulliApiKey: 'API Key',
  externalUrl: 'External URL',
  validationApiKey: 'You must provide an API key',
  validationUrl: 'You must provide a valid URL',
  validationUrlTrailingSlash: 'URL must not end in a trailing slash',
  validationUrlBaseLeadingSlash: 'URL base must have a leading slash',
  validationUrlBaseTrailingSlash: 'URL base must not end in a trailing slash',
  toastTautulliSettingsSuccess: 'Tautulli settings saved successfully!',
  toastTautulliSettingsFailure:
    'Something went wrong while saving Tautulli settings.',
  traktSettings: 'Trakt Settings',
  traktSettingsDescription:
    'Configure your Trakt API key to enable Trakt-based collections from trending and popular lists.',
  traktApiKey: 'Trakt API Key',
  traktApiKeyTip: 'Get your API key from your Trakt API settings',
  toastTraktSettingsSuccess: 'Trakt settings saved successfully!',
  toastTraktSettingsFailure:
    'Something went wrong while saving Trakt settings.',
  collectionsEnabled: 'Enable Collections',
  collectionsPlexPassRequired: 'Plex Pass required for full functionality',
  collectionsPlexPassWarning:
    'Collections require Plex Pass for labels and user filtering, without Plex Pass, all collections will be visible to all users.',
  collectionsPlexPassCheckFailed: 'Unable to verify Plex Pass status',
  collectionsEnabledDescription:
    'Create Plex collections in the Library tab for each user with their available requests, only visible to the user. Note: Uses label restrictions, all collections will be visible to admin',
  plexcollections: 'Plex Collections',
  plexcollectionsDescription:
    'Create Collections in Plex from various sources including Overseerr Requests, Tautulli Statistics and Trakt lists. Runs as a job every 12 hours',
  enableCollections: 'Enable Collections',
  disableCollections: 'Disable Collections',
  removingCollectionsAndLabels: 'Removing Collections & Labels...',
  verifyingPlexPass: 'Checking Plex Pass…',
  plexPassVerified: 'Plex Pass verified successfully!',
  overrideAndEnable: 'Override and Enable Collections',
  plexPassRequired: 'WARNING: Your users privacy is at risk',
  plexPassRequiredDescription:
    'Collections titles can contain Usernames or Full Names, without Plex Pass, visibility cannot be restricted to only the applicable user.',
  collectionTemplate: 'Collection Name Template',
  collectionTemplateHelp:
    'Available variables: {nickname} - Full Name, {username} - Plex Username, {domain} - Application URL, {appTitle} - Application Title',
  collectionTemplateUserRequired:
    'Template must include {user}, {username}, or {nickname} variable',
  collectionTemplatePreview: 'Preview',
  collectionTemplatePresets: 'Presets',
  collectionTemplateCustom: 'Custom',
  collectionsActive: '✓ Active',
  collectionsOverrideWarning: '(Override - visible to all users)',
  toastCollectionsEnabled: 'Collections enabled successfully!',
  toastPlexPassVerified: 'Plex Pass verified successfully!',
  toastPlexPassNotDetected: 'Plex Pass not detected',
  toastCollectionsSyncStarted: 'Collections sync started successfully!',
  toastCollectionsDisabledSuccess:
    'Collections disabled and purged successfully!',
  toastCollectionsSyncSkipped:
    'Collections disabled -  enable Collections in Plex Settings to run.',
  globalCollectionEnabled: 'Create Global Collection',
  globalCollectionEnabledDescription:
    'Creates a single collection visible to all users containing all approved requests from everyone, sorted by request date.',
  collectionConfigurations: 'Collection Configurations',
  collectionConfigurationsDescription:
    'Configure automated collections from external sources like Tautulli statistics and Trakt trending lists. Each configuration creates a separate collection in Plex.',
  addCollectionConfig: 'Add Collection Configuration',
  editCollectionConfig: 'Edit Collection Configuration',
  deleteCollectionConfig: 'Delete Collection Configuration',
  collectionConfigName: 'Collection Name',
  collectionConfigType: 'Collection Type',
  collectionConfigEnabled: 'Enabled',
  collectionConfigTemplate: 'Collection Title Template',
  collectionConfigMaxItems: 'Maximum Items',
  collectionConfigMediaType: 'Library',
  collectionConfigPeriod: 'Time Period',
  collectionConfigTraktApiKey: 'Trakt API Key',
  collectionConfigTraktStatType: 'Trakt List Type',
  collectionConfigSearchMissingMovies: 'Auto-request Missing Movies',
  collectionConfigSearchMissingTV: 'Auto-request Missing TV Shows',
  collectionConfigAutoApproveMovies: 'Auto-approve Movies',
  collectionConfigAutoApproveTV: 'Auto-approve TV Shows',
  collectionConfigMaxSeasons:
    'Require manual approval for more than this many seasons',
  collectionConfigSearchMoviesDescription:
    'Automatically create requests for missing movies',
  collectionConfigSearchTVDescription:
    'Automatically create requests for missing TV shows',
  collectionConfigAutoApproveMoviesDescription:
    'Automatically approve movie requests (no admin review required)',
  collectionConfigAutoApproveTVDescription:
    'Automatically approve TV show requests (no admin review required)',
  collectionConfigMaxSeasonsDescription:
    'TV shows with more seasons will require manual admin approval',
  collectionConfigSortOrder: 'Sort Order',
  collectionTypeUser: 'User Collections',
  collectionTypeGlobal: 'Global Collection',
  collectionTypeTautulli: 'Tautulli Statistics',
  collectionTypeTrakt: 'Trakt Lists',
  traktStatTypeTrending: 'Trending',
  traktStatTypePopular: 'Popular',
  traktStatTypeWatched: 'Most Watched',
  mediaTypeMovie: 'Movies Only',
  mediaTypeTv: 'TV Shows Only',
  mediaTypeBoth: 'Movies & TV Shows',
  periodWeek: 'This Week',
  periodMonth: 'This Month',
  saveCollectionConfig: 'Save Configuration',
  cancelCollectionConfig: 'Cancel',
  deleteCollectionConfigConfirm:
    'Are you sure you want to delete this collection configuration?',
  noCollectionConfigs:
    'No collection configurations found. Add one to get started.',
  collectionConfigSaved: 'Collection configuration saved successfully!',
  collectionConfigDeleted: 'Collection configuration deleted successfully!',
  collectionConfigError: 'Failed to save collection configuration.',
});

interface Library {
  id: string;
  name: string;
  enabled: boolean;
}

interface SyncStatus {
  running: boolean;
  progress: number;
  total: number;
  currentLibrary?: Library;
  libraries: Library[];
}

interface PresetServerDisplay {
  name: string;
  ssl: boolean;
  uri: string;
  address: string;
  port: number;
  local: boolean;
  status?: boolean;
  message?: string;
}
interface SettingsPlexProps {
  onComplete?: () => void;
}

interface CollectionConfig {
  id: number;
  name: string; // User-entered collection name
  type: 'overseerr' | 'tautulli' | 'trakt';
  subtype: string; // Specific option like 'users', 'most_popular_plays', etc.
  template: string; // Collection title template (for preset templates or single media type)
  customMovieTemplate?: string; // Custom template for movie collections when mediaType is 'both'
  customTVTemplate?: string; // Custom template for TV collections when mediaType is 'both'
  visibility: 'users' | 'users_admin' | 'admin' | 'none';
  maxItems: number;
  mediaType?: 'movie' | 'tv' | 'both';
  libraryId?: string; // Selected library ID
  libraryName?: string; // Selected library name for display
  customDays?: number; // Number of days for Tautulli collections
  tautulliStatType?: 'plays' | 'duration'; // Tautulli stat type
  searchMissingMovies?: boolean; // Auto-request missing movies
  searchMissingTV?: boolean; // Auto-request missing TV shows
  autoApproveMovies?: boolean; // Auto-approve movie requests
  autoApproveTV?: boolean; // Auto-approve TV show requests
  maxSeasonsToRequest?: number; // Max seasons for auto-approval
  // Trakt custom list fields
  traktCustomListUrl?: string; // Custom Trakt list URL
  traktReverseOrder?: boolean; // Reverse the order of items from the list
  // Type-specific fields
  sortOrder?: number;
}

// Collection Configuration Form Component
const CollectionConfigForm = ({
  config,
  onSave,
  onCancel,
  data,
  intl,
  mainSettings,
}: {
  config: CollectionConfig;
  onSave: (config: CollectionConfig) => void;
  onCancel: () => void;
  data: PlexSettings | undefined;
  intl: any;
  mainSettings: any;
}) => {
  const [formData, setFormData] = useState<CollectionConfig>(config);
  const [showValidation, setShowValidation] = useState(false);

  // Get current user data which includes Plex Pass status
  const { data: currentUser } = useSWR('/api/v1/auth/me');

  // Update form data when config prop changes (for editing existing configs)
  useEffect(() => {
    // Handle backward compatibility - if no libraryId but has mediaType, preserve existing behavior
    const updatedConfig = {
      ...config,
      libraryId: config.libraryId || undefined,
      libraryName: config.libraryName || undefined,
    };
    setFormData(updatedConfig);
  }, [config]);

  // Auto-select first template preset when type/subtype changes
  useEffect(() => {
    const presets = getTemplatePresets();
    if (
      formData.type &&
      formData.subtype &&
      presets.length > 0 &&
      presets[0].value !== 'custom'
    ) {
      // Always reset to first preset when type/subtype changes
      setFormData((prev) => ({ ...prev, template: presets[0].value }));
    }
  }, [formData.type, formData.subtype]);

  // Auto-adjust visibility when type/subtype changes to ensure valid selection
  useEffect(() => {
    const visibilityOptions = getVisibilityOptions();
    const currentOption = visibilityOptions.find(
      (opt) => opt.value === formData.visibility
    );

    // If current visibility is not enabled for this collection type, select the first enabled option
    if (currentOption && !currentOption.enabled) {
      const firstEnabledOption = visibilityOptions.find((opt) => opt.enabled);
      if (firstEnabledOption) {
        setFormData((prev) => ({
          ...prev,
          visibility: firstEnabledOption.value as any,
        }));
      }
    }
  }, [formData.type, formData.subtype]);

  const collectionTypes = [
    { value: 'overseerr', label: 'Overseerr Requests' },
    { value: 'tautulli', label: 'Tautulli Statistics' },
    { value: 'trakt', label: 'Trakt Lists' },
  ];

  const getSubtypeOptions = (type: string) => {
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
          { value: 'custom_list', label: 'Custom List' },
        ];
      default:
        return [];
    }
  };

  const getTemplatePresets = () => {
    if (!formData.subtype) return [{ label: 'Custom', value: 'custom' }];

    // Overseerr collection presets
    if (formData.type === 'overseerr') {
      switch (formData.subtype) {
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
    if (formData.type === 'tautulli') {
      switch (formData.subtype) {
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
    if (formData.type === 'trakt') {
      switch (formData.subtype) {
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

  const templatePresets = getTemplatePresets();

  const getVisibilityOptions = () => {
    const allOptions = [
      { value: 'users', label: 'Users Home', enabled: true },
      {
        value: 'users_admin',
        label: 'Users and Server Owner Home',
        enabled: true,
      },
      { value: 'admin', label: 'Server Owner Home', enabled: true },
      { value: 'none', label: 'Library tab only', enabled: true },
    ];

    // For User Requests (overseerr + users), check if Users Home is unlocked
    if (formData.type === 'overseerr' && formData.subtype === 'users') {
      const isUsersHomeUnlocked = data?.usersHomeUnlocked || false;
      return allOptions.map((option) => ({
        ...option,
        enabled:
          option.value === 'none' ||
          (isUsersHomeUnlocked && option.value === 'users'),
      }));
    }

    // For Server Owner requests (overseerr + server_owner), only "Server Owner Home" and "Library tab only" should be available
    if (formData.type === 'overseerr' && formData.subtype === 'server_owner') {
      return allOptions.map((option) => ({
        ...option,
        enabled: option.value === 'admin' || option.value === 'none',
      }));
    }

    // For Global/Tautulli/Trakt collections, all options should be available
    return allOptions;
  };

  const generatePreview = (
    template: string,
    forceMediaType?: 'movie' | 'tv'
  ) => {
    if (!formData.subtype) return 'Preview will appear here...';

    let preview = template || 'Collection';

    // Backwards compatibility for removed variables
    const subtypeLabel =
      getSubtypeOptions(formData.type).find(
        (opt) => opt.value === formData.subtype
      )?.label || formData.subtype;
    const cleanSubtype = subtypeLabel.split(' (')[0]; // Remove " (Play Count)" etc.
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
      } else if (formData.mediaType === 'movie') {
        mediaTypeText = 'Movie';
      } else if (formData.mediaType === 'tv') {
        mediaTypeText = 'TV Show';
      } else if (formData.type === 'overseerr' && formData.subtype) {
        // For Overseerr collections, try to infer from subtype or collection context
        if (formData.subtype.includes('movie')) {
          mediaTypeText = 'Movie';
        } else if (formData.subtype.includes('tv')) {
          mediaTypeText = 'TV Show';
        }
      }
      preview = preview.replace(/{mediaType}/g, mediaTypeText);
    }

    // Type-specific variables with restrictions
    if (formData.type === 'tautulli') {
      // Only {days} and {customdays} for Tautulli
      preview = preview.replace(
        /{days}/g,
        (formData.customDays || 30).toString()
      );
      preview = preview.replace(
        /{customdays}/g,
        (formData.customDays || 30).toString()
      );
      preview = preview.replace(
        /{statType}/g,
        formData.tautulliStatType === 'duration'
          ? 'Watch Duration'
          : 'Play Count'
      );
    } else if (formData.type === 'overseerr') {
      // Common Overseerr variables - use real settings data
      const domain = mainSettings?.applicationUrl
        ? new URL(mainSettings.applicationUrl).hostname
        : 'overseerr.example.com';
      const appTitle = mainSettings?.applicationTitle || 'Overseerr';
      preview = preview.replace(/{domain}/g, domain);
      preview = preview.replace(/{appTitle}/g, appTitle);

      // User-specific variables only for users subtype and server_owner
      if (formData.subtype === 'users' || formData.subtype === 'server_owner') {
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

  // Individual validation functions
  const isTypeValid = () => !!formData.type;
  const isSubtypeValid = () => !!formData.subtype;
  const isCustomDaysValid = () =>
    formData.type !== 'tautulli' ||
    !!(formData.customDays && formData.customDays > 0);

  const isTemplateValid = () => {
    // If using a preset template, check the main template field
    if (
      formData.template &&
      templatePresets.find((p) => p.value === formData.template)
    ) {
      return true;
    }

    // If using custom templates
    if (
      !formData.template ||
      !templatePresets.find((p) => p.value === formData.template)
    ) {
      if (formData.mediaType === 'both') {
        // For "both" media types, require either main template OR both custom templates
        return !!(
          formData.template ||
          (formData.customMovieTemplate && formData.customTVTemplate)
        );
      } else {
        // For single media type, require main template
        return !!formData.template;
      }
    }

    return false;
  };

  // Specific validation for custom templates when using "both" media type
  const isCustomMovieTemplateValid = () => {
    // Only required when using custom templates for "both" media type and no main template
    if (
      formData.mediaType === 'both' &&
      (!formData.template ||
        !templatePresets.find((p) => p.value === formData.template))
    ) {
      return !!formData.customMovieTemplate;
    }
    return true;
  };

  const isCustomTVTemplateValid = () => {
    // Only required when using custom templates for "both" media type and no main template
    if (
      formData.mediaType === 'both' &&
      (!formData.template ||
        !templatePresets.find((p) => p.value === formData.template))
    ) {
      return !!formData.customTVTemplate;
    }
    return true;
  };

  const isTraktCustomListUrlValid = () => {
    // Only required for Trakt custom list collections
    if (formData.type === 'trakt' && formData.subtype === 'custom_list') {
      // Check if URL exists and matches the expected Trakt list format
      return !!(
        formData.traktCustomListUrl &&
        formData.traktCustomListUrl.match(
          /trakt\.tv\/users\/[^/]+\/lists\/[^/?]+/
        )
      );
    }
    return true;
  };

  const isFormValid =
    isTypeValid() &&
    isSubtypeValid() &&
    isTemplateValid() &&
    isCustomDaysValid() &&
    isTraktCustomListUrlValid();

  // Error message helper
  const getFieldError = (fieldValidation: () => boolean, message: string) => {
    return showValidation && !fieldValidation() ? message : '';
  };

  const handleSave = () => {
    // eslint-disable-next-line no-console
    console.log('handleSave called');
    // eslint-disable-next-line no-console
    console.log('Form data:', formData);
    // eslint-disable-next-line no-console
    console.log('Form validation status:');
    // eslint-disable-next-line no-console
    console.log('- isTypeValid:', isTypeValid());
    // eslint-disable-next-line no-console
    console.log('- isSubtypeValid:', isSubtypeValid());
    // eslint-disable-next-line no-console
    console.log('- isTemplateValid:', isTemplateValid());
    // eslint-disable-next-line no-console
    console.log('- isCustomDaysValid:', isCustomDaysValid());
    // eslint-disable-next-line no-console
    console.log('- isTraktCustomListUrlValid:', isTraktCustomListUrlValid());
    // eslint-disable-next-line no-console
    console.log('- isFormValid:', isFormValid);

    if (isFormValid) {
      // For users and server_owner, don't set a static name - let backend generate per-user names from template
      // For other collection types, generate a static name from the template
      let configToSave: CollectionConfig;

      if (
        formData.type === 'overseerr' &&
        (formData.subtype === 'users' || formData.subtype === 'server_owner')
      ) {
        // Don't set a static name for user/server_owner collections - use template dynamically
        configToSave = {
          ...formData,
          // Keep existing name if editing, or use a placeholder for new collections
          name: formData.name || 'User Collection',
        };
      } else {
        // For global collections and others, generate a static name from the template
        let generatedName: string;

        if (
          formData.mediaType === 'both' &&
          (!formData.template ||
            !templatePresets.find((p) => p.value === formData.template))
        ) {
          // For "both" media type using custom templates, use the movie template for the base name
          generatedName = generatePreview(
            formData.customMovieTemplate || formData.template
          );
        } else {
          // For single media type or preset templates, use the main template
          generatedName = generatePreview(formData.template);
        }

        configToSave = {
          ...formData,
          name: generatedName,
        };
      }
      // eslint-disable-next-line no-console
      console.log('Config to save:', configToSave);
      onSave(configToSave);
    } else {
      // Show validation errors
      // eslint-disable-next-line no-console
      console.log('Form validation failed, showing validation errors');
      setShowValidation(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4 sm:p-6">
      <div
        className="hide-scrollbar w-full max-w-3xl overflow-y-auto rounded-lg bg-gray-800 p-6 shadow-xl ring-1 ring-gray-700"
        style={{ maxHeight: 'calc(100vh - 4rem)' }}
      >
        <h3 className="mb-6 text-xl font-medium text-white">
          {config.id ? 'Edit Collection Configuration' : 'Add New Collection'}
        </h3>

        <div className="space-y-6">
          {/* Collection Type */}
          <div className="form-row">
            <label htmlFor="collectionType" className="text-label">
              Collection Type
              <span className="label-required">*</span>
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <select
                  id="collectionType"
                  value={formData.type || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      type: e.target.value as any,
                      subtype: '',
                    })
                  }
                >
                  <option value="">Select Collection Type...</option>
                  {collectionTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              {getFieldError(isTypeValid, 'Collection type is required') && (
                <div className="error">
                  {getFieldError(isTypeValid, 'Collection type is required')}
                </div>
              )}
            </div>
          </div>

          {/* Sub-type (appears when type is selected) */}
          {formData.type && (
            <div className="form-row">
              <label htmlFor="collectionSubtype" className="text-label">
                Collection Sub-type
                <span className="label-required">*</span>
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <select
                    id="collectionSubtype"
                    value={formData.subtype || ''}
                    onChange={(e) => {
                      const newSubtype = e.target.value;
                      const updates: any = { subtype: newSubtype };

                      // Auto-set tautulliStatType based on subtype
                      if (formData.type === 'tautulli') {
                        if (
                          newSubtype === 'most_popular_plays' ||
                          newSubtype === 'most_watched_plays'
                        ) {
                          updates.tautulliStatType = 'plays';
                        } else if (
                          newSubtype === 'most_popular_duration' ||
                          newSubtype === 'most_watched_duration'
                        ) {
                          updates.tautulliStatType = 'duration';
                        }

                        // Set default customDays if not set
                        if (!formData.customDays) {
                          updates.customDays = 30;
                        }
                      }

                      setFormData({ ...formData, ...updates });
                    }}
                  >
                    <option value="">Select Sub-type...</option>
                    {getSubtypeOptions(formData.type).map((subtype) => (
                      <option key={subtype.value} value={subtype.value}>
                        {subtype.label}
                      </option>
                    ))}
                  </select>
                </div>
                {getFieldError(
                  isSubtypeValid,
                  'Collection sub-type is required'
                ) && (
                  <div className="error">
                    {getFieldError(
                      isSubtypeValid,
                      'Collection sub-type is required'
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Privacy Warnings for Overseerr Users Collections */}
          {formData.type === 'overseerr' && formData.subtype === 'users' && (
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
                      All collections are always visible to the Plex server
                      owner, regardless of privacy settings.
                    </p>
                  </div>
                </div>
              </div>

              {/* Plex Pass privacy warning - only show if no Plex Pass */}
              {formData.type === 'overseerr' &&
                formData.subtype === 'users' &&
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
          {formData.type === 'trakt' && formData.subtype === 'custom_list' && (
            <div className="form-row">
              <label htmlFor="traktCustomListUrl" className="text-label">
                Trakt List URL
                <span className="label-required">*</span>
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <input
                    type="url"
                    id="traktCustomListUrl"
                    placeholder="https://trakt.tv/users/username/lists/list-name"
                    value={formData.traktCustomListUrl || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        traktCustomListUrl: e.target.value,
                      })
                    }
                  />
                </div>
                {getFieldError(
                  isTraktCustomListUrlValid,
                  'Please enter a valid Trakt list URL'
                ) && (
                  <div className="error">
                    {getFieldError(
                      isTraktCustomListUrlValid,
                      'Please enter a valid Trakt list URL'
                    )}
                  </div>
                )}
                <div className="label-tip">
                  Enter the URL of a public Trakt list (e.g.,
                  https://trakt.tv/users/username/lists/list-name)
                </div>
              </div>
            </div>
          )}

          {/* Reverse Order (for Trakt custom list collections) */}
          {formData.type === 'trakt' && formData.subtype === 'custom_list' && (
            <div className="form-row">
              <label htmlFor="traktReverseOrder" className="text-label">
                Order
              </label>
              <div className="form-input-area">
                <label className="inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    id="traktReverseOrder"
                    checked={formData.traktReverseOrder || false}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        traktReverseOrder: e.target.checked,
                      })
                    }
                    className="form-checkbox"
                  />
                  <span className="ml-2 text-white">
                    Reverse order (newest first)
                  </span>
                </label>
                <div className="label-tip">
                  Check to reverse the order of items from the list
                </div>
              </div>
            </div>
          )}

          {/* Library Selection - always visible when type and subtype are selected */}
          {formData.type && formData.subtype && (
            <div className="form-row">
              <label htmlFor="collectionLibrary" className="text-label">
                Library
                <span className="label-required">*</span>
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <select
                    id="collectionLibrary"
                    value={formData.libraryId || ''}
                    onChange={(e) => {
                      const selectedValue = e.target.value;
                      if (selectedValue === 'all') {
                        setFormData({
                          ...formData,
                          libraryId: 'all',
                          libraryName: 'All Libraries',
                          mediaType: 'both',
                        });
                      } else if (selectedValue === '') {
                        setFormData({
                          ...formData,
                          libraryId: undefined,
                          libraryName: undefined,
                          mediaType: 'both',
                        });
                      } else {
                        const selectedLibrary = data?.libraries.find(
                          (lib) => lib.id === selectedValue
                        );
                        setFormData({
                          ...formData,
                          libraryId: selectedValue,
                          libraryName: selectedLibrary?.name,
                          mediaType:
                            selectedLibrary?.type === 'show'
                              ? 'tv'
                              : selectedLibrary?.type === 'movie'
                              ? 'movie'
                              : 'both',
                        });
                      }
                    }}
                  >
                    <option value="">Select Libraries...</option>
                    <option value="all">All Libraries</option>
                    {data?.libraries
                      .filter((lib) => lib.enabled)
                      .map((library) => (
                        <option key={library.id} value={library.id}>
                          {library.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Form unlocks when required fields are selected */}
          {formData.type &&
            formData.subtype &&
            formData.libraryId &&
            (formData.type !== 'tautulli' || formData.customDays) &&
            (formData.type !== 'trakt' ||
              formData.subtype !== 'custom_list' ||
              formData.traktCustomListUrl) && (
              <>
                {/* Custom Days (for Tautulli collections) - moved here from above */}
                {formData.type === 'tautulli' && (
                  <div className="form-row">
                    <label htmlFor="customDays" className="text-label">
                      No. of Days
                      <span className="label-required">*</span>
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <input
                          type="text"
                          inputMode="numeric"
                          id="customDays"
                          value={formData.customDays || 30}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 30;
                            if (value >= 1 && value <= 365) {
                              setFormData({ ...formData, customDays: value });
                            }
                          }}
                          className="short"
                          min="1"
                          max="365"
                        />
                      </div>
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
                      <select
                        id="collectionTemplate"
                        value={
                          templatePresets.find(
                            (p) => p.value === formData.template
                          )?.value ||
                          templatePresets[0]?.value ||
                          'custom'
                        }
                        onChange={(e) => {
                          if (e.target.value !== 'custom') {
                            setFormData({
                              ...formData,
                              template: e.target.value,
                            });
                          } else {
                            setFormData({ ...formData, template: '' });
                          }
                        }}
                      >
                        {templatePresets.map((preset) => (
                          <option key={preset.value} value={preset.value}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {(() => {
                      const currentDropdownValue =
                        templatePresets.find(
                          (p) => p.value === formData.template
                        )?.value ||
                        templatePresets[0]?.value ||
                        'custom';
                      return currentDropdownValue === 'custom';
                    })() && (
                      <div className="mt-2">
                        {formData.mediaType === 'both' ? (
                          <div className="space-y-4">
                            {/* Movie Template and Preview */}
                            <div className="space-y-3">
                              <div>
                                <label
                                  htmlFor="customMovieTemplate"
                                  className="mb-2 block text-xs font-medium text-gray-300"
                                >
                                  Custom Movie Template:
                                  <span className="label-required">*</span>
                                </label>
                                <div className="form-input-field">
                                  <input
                                    type="text"
                                    id="customMovieTemplate"
                                    value={formData.customMovieTemplate || ''}
                                    onChange={(e) =>
                                      setFormData({
                                        ...formData,
                                        customMovieTemplate: e.target.value,
                                      })
                                    }
                                    placeholder="Enter custom template for movies..."
                                  />
                                </div>
                                {getFieldError(
                                  isCustomMovieTemplateValid,
                                  'Custom movie template is required'
                                ) && (
                                  <div className="error">
                                    {getFieldError(
                                      isCustomMovieTemplateValid,
                                      'Custom movie template is required'
                                    )}
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="mb-2 text-xs font-medium text-gray-300">
                                  Movie Collection Preview:
                                </div>
                                <div className="rounded border border-gray-600 bg-gray-900 px-3 py-2">
                                  <div className="text-sm text-gray-200">
                                    {generatePreview(
                                      formData.customMovieTemplate ||
                                        formData.template,
                                      'movie'
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* TV Template and Preview */}
                            <div className="space-y-3">
                              <div>
                                <label
                                  htmlFor="customTVTemplate"
                                  className="mb-2 block text-xs font-medium text-gray-300"
                                >
                                  Custom TV Template:
                                  <span className="label-required">*</span>
                                </label>
                                <div className="form-input-field">
                                  <input
                                    type="text"
                                    id="customTVTemplate"
                                    value={formData.customTVTemplate || ''}
                                    onChange={(e) =>
                                      setFormData({
                                        ...formData,
                                        customTVTemplate: e.target.value,
                                      })
                                    }
                                    placeholder="Enter custom template for TV shows..."
                                  />
                                </div>
                                {getFieldError(
                                  isCustomTVTemplateValid,
                                  'Custom TV template is required'
                                ) && (
                                  <div className="error">
                                    {getFieldError(
                                      isCustomTVTemplateValid,
                                      'Custom TV template is required'
                                    )}
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="mb-2 text-xs font-medium text-gray-300">
                                  TV Collection Preview:
                                </div>
                                <div className="rounded border border-gray-600 bg-gray-900 px-3 py-2">
                                  <div className="text-sm text-gray-200">
                                    {generatePreview(
                                      formData.customTVTemplate ||
                                        formData.template,
                                      'tv'
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="form-input-field">
                            <input
                              type="text"
                              value={formData.template}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  template: e.target.value,
                                })
                              }
                              placeholder="Enter custom template..."
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Enhanced Live Preview Section - Only for preset templates */}
                    {(() => {
                      const currentDropdownValue =
                        templatePresets.find(
                          (p) => p.value === formData.template
                        )?.value ||
                        templatePresets[0]?.value ||
                        'custom';
                      return currentDropdownValue !== 'custom';
                    })() && (
                      <div className="mt-4">
                        {formData.mediaType === 'both' ? (
                          <div className="space-y-3">
                            <div>
                              <div className="mb-2 text-xs font-medium text-gray-300">
                                Movie Collection Preview:
                              </div>
                              <div className="rounded border border-gray-600 bg-gray-900 px-3 py-2">
                                <div className="text-sm text-gray-200">
                                  {generatePreview(
                                    formData.customMovieTemplate ||
                                      formData.template,
                                    'movie'
                                  )}
                                </div>
                              </div>
                            </div>
                            <div>
                              <div className="mb-2 text-xs font-medium text-gray-300">
                                TV Collection Preview:
                              </div>
                              <div className="rounded border border-gray-600 bg-gray-900 px-3 py-2">
                                <div className="text-sm text-gray-200">
                                  {generatePreview(
                                    formData.customTVTemplate ||
                                      formData.template,
                                    'tv'
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="mb-2 text-xs font-medium text-gray-300">
                              Collection Preview:
                            </div>
                            <div className="rounded border border-gray-600 bg-gray-900 px-3 py-2">
                              <div className="text-sm text-gray-200">
                                {generatePreview(
                                  formData.mediaType === 'movie'
                                    ? formData.template.replace(
                                        /Movies & TV Shows|TV Shows/,
                                        'Movies'
                                      )
                                    : formData.mediaType === 'tv'
                                    ? formData.template.replace(
                                        /Movies & TV Shows|Movies/,
                                        'TV Shows'
                                      )
                                    : formData.template
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {getFieldError(
                      isTemplateValid,
                      'Collection template is required'
                    ) && (
                      <div className="error">
                        {getFieldError(
                          isTemplateValid,
                          'Collection template is required'
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Visibility */}
                <div className="form-row">
                  <label htmlFor="collectionVisibility" className="text-label">
                    Visibility
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <select
                        id="collectionVisibility"
                        value={formData.visibility}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            visibility: e.target.value as
                              | 'users'
                              | 'users_admin'
                              | 'admin'
                              | 'none',
                          })
                        }
                      >
                        {getVisibilityOptions().map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            disabled={!option.enabled}
                            className={!option.enabled ? 'text-gray-400' : ''}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Max Items */}
                <div className="form-row">
                  <label htmlFor="collectionMaxItems" className="text-label">
                    Maximum Items
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <input
                        type="text"
                        inputMode="numeric"
                        id="collectionMaxItems"
                        value={formData.maxItems}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            maxItems: parseInt(e.target.value) || 20,
                          })
                        }
                        className="short"
                      />
                    </div>
                  </div>
                </div>

                {/* Trakt-specific fields */}
                {formData.type === 'trakt' && (
                  <>
                    {/* Auto-Request Configuration Section */}
                    <div className="mb-6">
                      <h4 className="mb-4 text-lg font-medium text-white">
                        Auto-Request Settings
                      </h4>

                      {/* Movies Auto-Request */}
                      <div className="form-row">
                        <label
                          htmlFor="searchMissingMovies"
                          className="checkbox-label"
                        >
                          {intl.formatMessage(
                            messages.collectionConfigSearchMissingMovies
                          )}
                        </label>
                        <div className="form-input-area">
                          <input
                            type="checkbox"
                            id="searchMissingMovies"
                            checked={formData.searchMissingMovies || false}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                searchMissingMovies: e.target.checked,
                              })
                            }
                          />
                        </div>
                      </div>

                      {formData.searchMissingMovies && (
                        <div className="form-row ml-6">
                          <label
                            htmlFor="autoApproveMovies"
                            className="checkbox-label"
                          >
                            {intl.formatMessage(
                              messages.collectionConfigAutoApproveMovies
                            )}
                          </label>
                          <div className="form-input-area">
                            <input
                              type="checkbox"
                              id="autoApproveMovies"
                              checked={formData.autoApproveMovies || false}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  autoApproveMovies: e.target.checked,
                                })
                              }
                            />
                          </div>
                        </div>
                      )}

                      {/* TV Shows Auto-Request */}
                      <div className="form-row">
                        <label
                          htmlFor="searchMissingTV"
                          className="checkbox-label"
                        >
                          {intl.formatMessage(
                            messages.collectionConfigSearchMissingTV
                          )}
                        </label>
                        <div className="form-input-area">
                          <input
                            type="checkbox"
                            id="searchMissingTV"
                            checked={formData.searchMissingTV || false}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                searchMissingTV: e.target.checked,
                              })
                            }
                          />
                        </div>
                      </div>

                      {formData.searchMissingTV && (
                        <>
                          <div className="form-row ml-6">
                            <label
                              htmlFor="autoApproveTV"
                              className="checkbox-label"
                            >
                              {intl.formatMessage(
                                messages.collectionConfigAutoApproveTV
                              )}
                            </label>
                            <div className="form-input-area">
                              <input
                                type="checkbox"
                                id="autoApproveTV"
                                checked={formData.autoApproveTV || false}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    autoApproveTV: e.target.checked,
                                  })
                                }
                              />
                            </div>
                          </div>

                          {formData.autoApproveTV && (
                            <div className="form-row ml-12">
                              <label
                                htmlFor="maxSeasonsToRequest"
                                className="text-label"
                              >
                                {intl.formatMessage(
                                  messages.collectionConfigMaxSeasons
                                )}
                              </label>
                              <div className="form-input-area">
                                <div className="form-input-field">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    id="maxSeasonsToRequest"
                                    min="1"
                                    max="99"
                                    value={formData.maxSeasonsToRequest || 3}
                                    onChange={(e) =>
                                      setFormData({
                                        ...formData,
                                        maxSeasonsToRequest:
                                          parseInt(e.target.value) || 3,
                                      })
                                    }
                                    className="short"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex justify-end space-x-3 border-t border-gray-700 pt-6">
          <Button buttonType="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            buttonType="primary"
            onClick={handleSave}
            disabled={!isFormValid}
          >
            {config.id ? 'Update Collection' : 'Create Collection'}
          </Button>
        </div>
      </div>
    </div>
  );
};

const SettingsPlex = ({ onComplete }: SettingsPlexProps) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshingPresets, setIsRefreshingPresets] = useState(false);
  const [availableServers, setAvailableServers] = useState<PlexDevice[] | null>(
    null
  );
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<PlexSettings>('/api/v1/settings/plex');
  const { data: dataTautulli, mutate: revalidateTautulli } =
    useSWR<TautulliSettings>('/api/v1/settings/tautulli');
  const { data: dataTrakt, mutate: revalidateTrakt } = useSWR<TraktSettings>(
    '/api/v1/settings/trakt'
  );
  const { data: mainSettings } = useSWR('/api/v1/settings/main');

  // Progress states for enable/disable operations (just for tick animations)

  // Collection configuration states
  const [collectionConfigs, setCollectionConfigs] = useState<
    CollectionConfig[]
  >([]);
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<CollectionConfig | null>(
    null
  );
  const [badgeClickCount, setBadgeClickCount] = useState(0);

  // Secret unlock logic
  const checkForUnlockSequence = () => {
    // Check if there's a Tautulli collection with 69 days and user has clicked 10 times
    const tautulliCollectionWith69Days = collectionConfigs.find(
      (config) => config.type === 'tautulli' && config.customDays === 69
    );

    if (
      tautulliCollectionWith69Days &&
      badgeClickCount >= 10 &&
      !data?.usersHomeUnlocked
    ) {
      // Unlock Users Home collections
      fetch('/api/v1/settings/plex', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...data,
          usersHomeUnlocked: true,
        }),
      })
        .then(() => {
          addToast('Users Home Collections Unlocked!', {
            autoDismiss: true,
            appearance: 'success',
          });
          revalidate(); // Refresh settings data
          setBadgeClickCount(0); // Reset counter
        })
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error('Failed to unlock Users Home collections:', error);
        });
    }
  };

  const { data: dataSync, mutate: revalidateSync } = useSWR<SyncStatus>(
    '/api/v1/settings/plex/sync',
    {
      refreshInterval: 1000,
    }
  );

  // Initialize collection configs from data
  useEffect(() => {
    if (data?.collectionConfigs) {
      setCollectionConfigs(data.collectionConfigs);
    }
  }, [data?.collectionConfigs]);

  // No need for collections status polling anymore
  const intl = useIntl();
  const { addToast, removeToast } = useToasts();

  // Helper function to start collections sync in background
  const startCollectionsSync = async () => {
    try {
      const response = await axios.post(
        '/api/v1/settings/plex/collections/sync'
      );
      addToast(
        response.data.message || 'Collections sync started in background',
        {
          autoDismiss: true,
          appearance: 'success',
        }
      );
    } catch (error) {
      addToast('Failed to start collections sync', {
        autoDismiss: true,
        appearance: 'error',
      });
      throw error;
    }
  };

  // Helper function to run full collections sync in background
  // const updateCollectionTitles = async () => {
  //   try {
  //     const response = await axios.post(
  //       '/api/v1/settings/plex/collections/sync'
  //     );
  //     addToast(
  //       response.data.message || 'Collections sync started in background',
  //       {
  //         autoDismiss: true,
  //         appearance: 'success',
  //       }
  //     );
  //   } catch (error) {
  //     addToast('Failed to start collections sync', {
  //       autoDismiss: true,
  //       appearance: 'error',
  //     });
  //     throw error;
  //   }
  // };

  // Collection configuration helper functions
  const saveCollectionConfigs = async (
    configs: CollectionConfig[],
    suppressNotification = false
  ) => {
    try {
      // eslint-disable-next-line no-console
      console.log('Saving collection configs:', configs);

      const response = await axios.post('/api/v1/settings/plex/collections', {
        collectionConfigs: configs,
      });

      // eslint-disable-next-line no-console
      console.log('Save response:', response.data);

      setCollectionConfigs(configs);
      revalidate();

      if (!suppressNotification) {
        addToast(intl.formatMessage(messages.collectionConfigSaved), {
          autoDismiss: true,
          appearance: 'success',
        });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Collection save error:', error);
      // eslint-disable-next-line no-console
      console.error('Error response:', error.response?.data);
      // eslint-disable-next-line no-console
      console.error('Error status:', error.response?.status);

      addToast(intl.formatMessage(messages.collectionConfigError), {
        autoDismiss: true,
        appearance: 'error',
      });
      throw error;
    }
  };

  const addCollectionConfig = () => {
    const newConfig: CollectionConfig = {
      id: 0, // Will be assigned on save
      name: '', // Will be generated from template
      type: '' as any, // Start with empty selection
      subtype: '',
      template: '',
      customMovieTemplate: '', // Initialize empty custom movie template
      customTVTemplate: '', // Initialize empty custom TV template
      visibility: 'users' as const,
      maxItems: 20,
      mediaType: 'both',
      libraryId: undefined, // Default to all libraries
      libraryName: undefined,
      customDays: 30, // Default for Tautulli collections
      tautulliStatType: 'plays', // Default stat type
      sortOrder: collectionConfigs.length,
      searchMissingMovies: false,
      searchMissingTV: false,
      autoApproveMovies: false,
      autoApproveTV: false,
      maxSeasonsToRequest: 3, // Default season limit
    };
    setEditingConfig(newConfig);
    setShowConfigForm(true);
  };

  const editCollectionConfig = (config: CollectionConfig) => {
    setEditingConfig({ ...config });
    setShowConfigForm(true);
  };

  const deleteCollectionConfig = async (configId: number) => {
    const updatedConfigs = collectionConfigs.filter((c) => c.id !== configId);
    const isLastCollection = updatedConfigs.length === 0;

    try {
      await saveCollectionConfigs(updatedConfigs, true); // Suppress the save notification

      // If this was the last collection, run purge operations
      if (isLastCollection && data) {
        try {
          await axios.post('/api/v1/settings/plex', {
            ip: data.ip,
            port: data.port,
            useSsl: data.useSsl,
            webAppUrl: data.webAppUrl,
            collectionsEnabled: false,
            purgeCollections: true,
            purgeUserLabels: true,
          });

          addToast(
            'Last collection deleted - all Plex collections and labels have been purged.',
            {
              autoDismiss: true,
              appearance: 'success',
            }
          );
        } catch (purgeError) {
          // eslint-disable-next-line no-console
          console.error(
            'Failed to purge collections after deleting last config:',
            purgeError
          );
          addToast(
            'Collection deleted but failed to purge Plex collections. Manual cleanup may be required.',
            {
              autoDismiss: true,
              appearance: 'warning',
            }
          );
        }
      } else {
        addToast(intl.formatMessage(messages.collectionConfigDeleted), {
          autoDismiss: true,
          appearance: 'success',
        });
      }
    } catch (error) {
      // Error already handled in saveCollectionConfigs
    }
  };

  const saveCollectionConfig = async (config: CollectionConfig) => {
    // eslint-disable-next-line no-console
    console.log('saveCollectionConfig called with:', config);

    const existingIndex = collectionConfigs.findIndex(
      (c) => c.id === config.id
    );
    let updatedConfigs: CollectionConfig[];

    if (existingIndex >= 0) {
      // Update existing
      // eslint-disable-next-line no-console
      console.log('Updating existing config at index:', existingIndex);
      updatedConfigs = [...collectionConfigs];
      updatedConfigs[existingIndex] = config;
    } else {
      // Add new - assign random 5-digit ID
      // eslint-disable-next-line no-console
      console.log('Adding new config');
      const existingIds = new Set(collectionConfigs.map((c) => c.id));
      let newId;
      do {
        newId = Math.floor(10000 + Math.random() * 90000); // Random 5-digit number (10000-99999)
      } while (existingIds.has(newId));
      // eslint-disable-next-line no-console
      console.log('Assigning new ID:', newId);
      const newConfig = { ...config, id: newId };
      updatedConfigs = [...collectionConfigs, newConfig];
    }

    // eslint-disable-next-line no-console
    console.log('Updated configs to save:', updatedConfigs);

    try {
      await saveCollectionConfigs(updatedConfigs);
      setShowConfigForm(false);
      setEditingConfig(null);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('Error in saveCollectionConfig:', error);
      // Error already handled in saveCollectionConfigs
    }
  };

  const PlexSettingsSchema = Yup.object().shape({
    hostname: Yup.string()
      .nullable()
      .required(intl.formatMessage(messages.validationHostnameRequired))
      .matches(
        /^(((([a-z]|\d|_|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*)?([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])):((([a-z]|\d|_|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*)?([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))@)?(([a-z]|\d|_|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*)?([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])$/i,
        intl.formatMessage(messages.validationHostnameRequired)
      ),
    port: Yup.number()
      .nullable()
      .required(intl.formatMessage(messages.validationPortRequired)),
    webAppUrl: Yup.string()
      .nullable()
      .url(intl.formatMessage(messages.validationUrl)),
  });

  const TautulliSettingsSchema = Yup.object().shape(
    {
      tautulliHostname: Yup.string()
        .when(['tautulliPort', 'tautulliApiKey'], {
          is: (value: unknown) => !!value,
          then: Yup.string()
            .nullable()
            .required(intl.formatMessage(messages.validationHostnameRequired)),
          otherwise: Yup.string().nullable(),
        })
        .matches(
          /^(([a-z]|\d|_|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*)?([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])$/i,
          intl.formatMessage(messages.validationHostnameRequired)
        ),
      tautulliPort: Yup.number().when(['tautulliHostname', 'tautulliApiKey'], {
        is: (value: unknown) => !!value,
        then: Yup.number()
          .typeError(intl.formatMessage(messages.validationPortRequired))
          .nullable()
          .required(intl.formatMessage(messages.validationPortRequired)),
        otherwise: Yup.number()
          .typeError(intl.formatMessage(messages.validationPortRequired))
          .nullable(),
      }),
      tautulliUrlBase: Yup.string()
        .test(
          'leading-slash',
          intl.formatMessage(messages.validationUrlBaseLeadingSlash),
          (value) => !value || value.startsWith('/')
        )
        .test(
          'no-trailing-slash',
          intl.formatMessage(messages.validationUrlBaseTrailingSlash),
          (value) => !value || !value.endsWith('/')
        ),
      tautulliApiKey: Yup.string().when(['tautulliHostname', 'tautulliPort'], {
        is: (value: unknown) => !!value,
        then: Yup.string()
          .nullable()
          .required(intl.formatMessage(messages.validationApiKey)),
        otherwise: Yup.string().nullable(),
      }),
      tautulliExternalUrl: Yup.string()
        .url(intl.formatMessage(messages.validationUrl))
        .test(
          'no-trailing-slash',
          intl.formatMessage(messages.validationUrlTrailingSlash),
          (value) => !value || !value.endsWith('/')
        ),
    },
    [
      ['tautulliHostname', 'tautulliPort'],
      ['tautulliHostname', 'tautulliApiKey'],
      ['tautulliPort', 'tautulliApiKey'],
    ]
  );

  const TraktSettingsSchema = Yup.object().shape({
    traktApiKey: Yup.string().nullable(),
  });

  const activeLibraries =
    data?.libraries
      .filter((library) => library.enabled)
      .map((library) => library.id) ?? [];

  const availablePresets = useMemo(() => {
    const finalPresets: PresetServerDisplay[] = [];
    availableServers?.forEach((dev) => {
      dev.connection.forEach((conn) =>
        finalPresets.push({
          name: dev.name,
          ssl: conn.protocol === 'https',
          uri: conn.uri,
          address: conn.address,
          port: conn.port,
          local: conn.local,
          status: conn.status === 200,
          message: conn.message,
        })
      );
    });

    return orderBy(finalPresets, ['status', 'ssl'], ['desc', 'desc']);
  }, [availableServers]);

  const syncLibraries = async () => {
    setIsSyncing(true);

    const params: { sync: boolean; enable?: string } = {
      sync: true,
    };

    if (activeLibraries.length > 0) {
      params.enable = activeLibraries.join(',');
    }

    await axios.get('/api/v1/settings/plex/library', {
      params,
    });
    setIsSyncing(false);
    revalidate();
  };

  const refreshPresetServers = async () => {
    setIsRefreshingPresets(true);
    let toastId: string | undefined;
    try {
      addToast(
        intl.formatMessage(messages.toastPlexRefresh),
        {
          autoDismiss: false,
          appearance: 'info',
        },
        (id) => {
          toastId = id;
        }
      );
      const response = await axios.get<PlexDevice[]>(
        '/api/v1/settings/plex/devices/servers'
      );
      if (response.data) {
        setAvailableServers(response.data);
      }
      if (toastId) {
        removeToast(toastId);
      }
      addToast(intl.formatMessage(messages.toastPlexRefreshSuccess), {
        autoDismiss: true,
        appearance: 'success',
      });
    } catch (e) {
      if (toastId) {
        removeToast(toastId);
      }
      addToast(intl.formatMessage(messages.toastPlexRefreshFailure), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setIsRefreshingPresets(false);
    }
  };

  const startScan = async () => {
    await axios.post('/api/v1/settings/plex/sync', {
      start: true,
    });
    revalidateSync();
  };

  const cancelScan = async () => {
    await axios.post('/api/v1/settings/plex/sync', {
      cancel: true,
    });
    revalidateSync();
  };

  const toggleLibrary = async (libraryId: string) => {
    setIsSyncing(true);
    if (activeLibraries.includes(libraryId)) {
      const params: { enable?: string } = {};

      if (activeLibraries.length > 1) {
        params.enable = activeLibraries
          .filter((id) => id !== libraryId)
          .join(',');
      }

      await axios.get('/api/v1/settings/plex/library', {
        params,
      });
    } else {
      await axios.get('/api/v1/settings/plex/library', {
        params: {
          enable: [...activeLibraries, libraryId].join(','),
        },
      });
    }
    setIsSyncing(false);
    revalidate();
  };

  // Main component loading check
  if ((!data || !dataTautulli || !dataTrakt) && !error) {
    return <LoadingSpinner />;
  }

  // Main component return
  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.plex),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">{intl.formatMessage(messages.plexsettings)}</h3>
        <p className="description">
          {intl.formatMessage(messages.plexsettingsDescription)}
        </p>
        {!!onComplete && (
          <div className="section">
            <Alert
              title={intl.formatMessage(messages.settingUpPlexDescription, {
                RegisterPlexTVLink: (msg: React.ReactNode) => (
                  <a
                    href="https://plex.tv"
                    className="text-white transition duration-300 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {msg}
                  </a>
                ),
              })}
              type="info"
            />
          </div>
        )}
      </div>
      <Formik
        initialValues={{
          hostname: data?.ip,
          port: data?.port ?? 32400,
          useSsl: data?.useSsl,
          selectedPreset: undefined,
          webAppUrl: data?.webAppUrl,
        }}
        validationSchema={PlexSettingsSchema}
        onSubmit={async (values) => {
          let toastId: string | null = null;
          try {
            addToast(
              intl.formatMessage(messages.toastPlexConnecting),
              {
                autoDismiss: false,
                appearance: 'info',
              },
              (id) => {
                toastId = id;
              }
            );
            await axios.post('/api/v1/settings/plex', {
              ip: values.hostname,
              port: Number(values.port),
              useSsl: values.useSsl,
              webAppUrl: values.webAppUrl,
            } as PlexSettings);

            syncLibraries();

            if (toastId) {
              removeToast(toastId);
            }
            addToast(intl.formatMessage(messages.toastPlexConnectingSuccess), {
              autoDismiss: true,
              appearance: 'success',
            });

            if (onComplete) {
              onComplete();
            }
          } catch (e) {
            if (toastId) {
              removeToast(toastId);
            }
            addToast(intl.formatMessage(messages.toastPlexConnectingFailure), {
              autoDismiss: true,
              appearance: 'error',
            });
          }
        }}
      >
        {({
          errors,
          touched,
          values,
          handleSubmit,
          setFieldValue,
          isSubmitting,
          isValid,
        }) => {
          return (
            <form className="section" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="preset" className="text-label">
                  {intl.formatMessage(messages.serverpreset)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <select
                      id="preset"
                      name="preset"
                      value={values.selectedPreset}
                      disabled={!availableServers || isRefreshingPresets}
                      className="rounded-l-only"
                      onChange={async (e) => {
                        const targPreset =
                          availablePresets[Number(e.target.value)];

                        if (targPreset) {
                          setFieldValue('hostname', targPreset.address);
                          setFieldValue('port', targPreset.port);
                          setFieldValue('useSsl', targPreset.ssl);
                        }
                      }}
                    >
                      <option value="manual">
                        {availableServers || isRefreshingPresets
                          ? isRefreshingPresets
                            ? intl.formatMessage(
                                messages.serverpresetRefreshing
                              )
                            : intl.formatMessage(
                                messages.serverpresetManualMessage
                              )
                          : intl.formatMessage(messages.serverpresetLoad)}
                      </option>
                      {availablePresets.map((server, index) => (
                        <option
                          key={`preset-server-${index}`}
                          value={index}
                          disabled={!server.status}
                        >
                          {`
                            ${server.name} (${server.address})
                            [${
                              server.local
                                ? intl.formatMessage(messages.serverLocal)
                                : intl.formatMessage(messages.serverRemote)
                            }]${
                            server.ssl
                              ? ` [${intl.formatMessage(
                                  messages.serverSecure
                                )}]`
                              : ''
                          }
                            ${server.status ? '' : '(' + server.message + ')'}
                          `}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        refreshPresetServers();
                      }}
                      className="input-action"
                    >
                      <ArrowPathIcon
                        className={isRefreshingPresets ? 'animate-spin' : ''}
                        style={{ animationDirection: 'reverse' }}
                      />
                    </button>
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="hostname" className="text-label">
                  {intl.formatMessage(messages.hostname)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
                      {values.useSsl ? 'https://' : 'http://'}
                    </span>
                    <Field
                      type="text"
                      inputMode="url"
                      id="hostname"
                      name="hostname"
                      className="rounded-r-only"
                    />
                  </div>
                  {errors.hostname &&
                    touched.hostname &&
                    typeof errors.hostname === 'string' && (
                      <div className="error">{errors.hostname}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="port" className="text-label">
                  {intl.formatMessage(messages.port)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <Field
                    type="text"
                    inputMode="numeric"
                    id="port"
                    name="port"
                    className="short"
                  />
                  {errors.port &&
                    touched.port &&
                    typeof errors.port === 'string' && (
                      <div className="error">{errors.port}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="ssl" className="checkbox-label">
                  {intl.formatMessage(messages.enablessl)}
                </label>
                <div className="form-input-area">
                  <Field
                    type="checkbox"
                    id="useSsl"
                    name="useSsl"
                    onChange={() => {
                      setFieldValue('useSsl', !values.useSsl);
                    }}
                  />
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="webAppUrl" className="text-label">
                  {intl.formatMessage(messages.webAppUrl, {
                    WebAppLink: (msg: React.ReactNode) => (
                      <a
                        href="https://support.plex.tv/articles/200288666-opening-plex-web-app/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {msg}
                      </a>
                    ),
                  })}
                  <SettingsBadge badgeType="advanced" className="ml-2" />
                  <span className="label-tip">
                    {intl.formatMessage(messages.webAppUrlTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      type="text"
                      inputMode="url"
                      id="webAppUrl"
                      name="webAppUrl"
                      placeholder="https://app.plex.tv/desktop"
                    />
                  </div>
                  {errors.webAppUrl &&
                    touched.webAppUrl &&
                    typeof errors.webAppUrl === 'string' && (
                      <div className="error">{errors.webAppUrl}</div>
                    )}
                </div>
              </div>
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={isSubmitting || !isValid}
                    >
                      <ArrowDownOnSquareIcon />
                      <span>
                        {isSubmitting
                          ? intl.formatMessage(globalMessages.saving)
                          : intl.formatMessage(globalMessages.save)}
                      </span>
                    </Button>
                  </span>
                </div>
              </div>
            </form>
          );
        }}
      </Formik>
      <div className="mt-10 mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.plexlibraries)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.plexlibrariesDescription)}
        </p>
      </div>
      <div className="section">
        <Button
          onClick={() => syncLibraries()}
          disabled={isSyncing || !data?.ip || !data?.port}
        >
          <ArrowPathIcon
            className={isSyncing ? 'animate-spin' : ''}
            style={{ animationDirection: 'reverse' }}
          />
          <span>
            {isSyncing
              ? intl.formatMessage(messages.scanning)
              : intl.formatMessage(messages.scan)}
          </span>
        </Button>
        <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
          {data?.libraries.map((library) => (
            <LibraryItem
              name={library.name}
              isEnabled={library.enabled}
              key={`setting-library-${library.id}`}
              onToggle={() => toggleLibrary(library.id)}
            />
          ))}
        </ul>

        <div className="mt-10 mb-6">
          <h3 className="heading">{intl.formatMessage(messages.manualscan)}</h3>
          <p className="description">
            {intl.formatMessage(messages.manualscanDescription)}
          </p>
        </div>
        <div className="section">
          <div className="rounded-md bg-gray-800 p-4">
            <div className="relative mb-6 h-8 w-full overflow-hidden rounded-full bg-gray-600">
              {dataSync?.running && (
                <div
                  className="h-8 bg-indigo-600 transition-all duration-200 ease-in-out"
                  style={{
                    width: `${Math.round(
                      (dataSync.progress / dataSync.total) * 100
                    )}%`,
                  }}
                />
              )}
              <div className="absolute inset-0 flex h-8 w-full items-center justify-center text-sm">
                <span>
                  {dataSync?.running
                    ? `${dataSync.progress} of ${dataSync.total}`
                    : 'Not running'}
                </span>
              </div>
            </div>
            <div className="flex w-full flex-col sm:flex-row">
              {dataSync?.running && (
                <>
                  {dataSync.currentLibrary && (
                    <div className="mb-2 mr-0 flex items-center sm:mb-0 sm:mr-2">
                      <Badge>
                        {intl.formatMessage(messages.currentlibrary, {
                          name: dataSync.currentLibrary.name,
                        })}
                      </Badge>
                    </div>
                  )}
                  <div className="flex items-center">
                    <Badge badgeType="warning">
                      {intl.formatMessage(messages.librariesRemaining, {
                        count: dataSync.currentLibrary
                          ? dataSync.libraries.slice(
                              dataSync.libraries.findIndex(
                                (library) =>
                                  library.id === dataSync.currentLibrary?.id
                              ) + 1
                            ).length
                          : 0,
                      })}
                    </Badge>
                  </div>
                </>
              )}
              <div className="flex-1 text-right">
                {!dataSync?.running ? (
                  <Button
                    buttonType="warning"
                    onClick={() => startScan()}
                    disabled={isSyncing || !activeLibraries.length}
                  >
                    <MagnifyingGlassIcon />
                    <span>{intl.formatMessage(messages.startscan)}</span>
                  </Button>
                ) : (
                  <Button buttonType="danger" onClick={() => cancelScan()}>
                    <XMarkIcon />
                    <span>{intl.formatMessage(messages.cancelscan)}</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 mb-6">
          <h3 className="heading">
            {intl.formatMessage(messages.plexcollections)}
          </h3>
          <p className="description" data-testid="collections-sync-description">
            {intl.formatMessage(messages.plexcollectionsDescription)}
          </p>
        </div>
        <div className="section" data-testid="collections-sync-section">
          <div className="space-y-6">
            {/* Collections Management */}
            <div className="mb-6">
              <div className="space-y-3">
                {/* Existing Collections */}
                {collectionConfigs.map((config) => (
                  <div
                    key={config.id}
                    className="flex items-center justify-between rounded-lg border border-gray-600 bg-gray-700/50 p-4"
                  >
                    <div className="flex-1">
                      <div className="mb-2 flex items-center space-x-3">
                        <h5 className="text-base font-medium text-white">
                          {config.name || 'Unnamed Collection'}
                        </h5>
                      </div>
                      <div className="flex flex-wrap items-center space-x-3">
                        <Badge badgeType="primary" className="!bg-opacity-40">
                          {config.type === 'overseerr'
                            ? 'Overseerr Requests'
                            : config.type === 'tautulli'
                            ? 'Tautulli Statistics'
                            : 'Trakt Lists'}
                        </Badge>
                        <Badge badgeType="default" className="!bg-opacity-30">
                          {(() => {
                            const getSubtypeLabel = (
                              type: string,
                              subtype: string
                            ) => {
                              switch (type) {
                                case 'overseerr':
                                  switch (subtype) {
                                    case 'users':
                                      return 'Individual Users Requests (excl. server owner)';
                                    case 'server_owner':
                                      return 'Server Owner requests';
                                    case 'global':
                                      return 'All Requests';
                                    default:
                                      return subtype;
                                  }
                                case 'tautulli':
                                  switch (subtype) {
                                    case 'most_popular_plays':
                                      return 'Most Popular (Play Count)';
                                    case 'most_popular_duration':
                                      return 'Most Popular (Watch Duration)';
                                    case 'most_watched_plays':
                                      return 'Most Watched (Play Count)';
                                    case 'most_watched_duration':
                                      return 'Most Watched (Watch Duration)';
                                    default:
                                      return subtype;
                                  }
                                case 'trakt':
                                  switch (subtype) {
                                    case 'trending_7_days':
                                      return 'Trending Last 7 Days';
                                    case 'trending_30_days':
                                      return 'Trending Last 30 Days';
                                    case 'popular_week':
                                      return 'Popular This Week';
                                    case 'popular_month':
                                      return 'Popular This Month';
                                    case 'most_watched_week':
                                      return 'Most Watched This Week';
                                    case 'most_watched_month':
                                      return 'Most Watched This Month';
                                    case 'custom_list':
                                      return 'Custom List';
                                    default:
                                      return subtype;
                                  }
                                default:
                                  return subtype;
                              }
                            };
                            return getSubtypeLabel(config.type, config.subtype);
                          })()}
                        </Badge>
                        {config.maxItems === 69 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setBadgeClickCount((prev) => {
                                const newCount = prev + 1;
                                if (newCount >= 10) {
                                  // Use setTimeout to allow state to update before checking
                                  setTimeout(() => checkForUnlockSequence(), 0);
                                }
                                return newCount;
                              });
                            }}
                            className="cursor-pointer border-none bg-transparent p-0"
                          >
                            <Badge
                              badgeType="default"
                              className="!bg-opacity-30"
                            >
                              {config.maxItems} items
                            </Badge>
                          </button>
                        ) : (
                          <Badge badgeType="default" className="!bg-opacity-30">
                            {config.maxItems} items
                          </Badge>
                        )}
                        <Badge badgeType="default" className="!bg-opacity-30">
                          {config.visibility === 'admin'
                            ? 'Server Owner Only'
                            : config.visibility === 'users_admin'
                            ? 'Users & Server Owner'
                            : config.visibility === 'users'
                            ? 'Users Only'
                            : 'Library Only'}
                        </Badge>
                        <Badge badgeType="default" className="!bg-opacity-30">
                          {config.libraryName ||
                            (config.mediaType === 'both'
                              ? 'All Libraries'
                              : config.mediaType === 'movie'
                              ? 'Movies'
                              : 'TV Shows')}
                        </Badge>
                        {config.searchMissingMovies && (
                          <Badge
                            badgeType={
                              config.autoApproveMovies ? 'success' : 'warning'
                            }
                          >
                            {config.autoApproveMovies
                              ? 'Auto-Approve Movies'
                              : 'Auto-Request Movies'}
                          </Badge>
                        )}
                        {config.searchMissingTV && (
                          <Badge
                            badgeType={
                              config.autoApproveTV ? 'success' : 'warning'
                            }
                          >
                            {config.autoApproveTV
                              ? `Auto-Approve TV (≤${
                                  config.maxSeasonsToRequest || 3
                                } seasons)`
                              : 'Auto-Request TV'}
                          </Badge>
                        )}
                        {config.type === 'tautulli' &&
                          config.customDays &&
                          (config.customDays === 69 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setBadgeClickCount((prev) => {
                                  const newCount = prev + 1;
                                  if (newCount >= 10) {
                                    // Use setTimeout to allow state to update before checking
                                    setTimeout(checkForUnlockSequence, 100);
                                  }
                                  return newCount;
                                });
                              }}
                              className="cursor-pointer border-none bg-transparent p-0"
                            >
                              <Badge
                                badgeType="default"
                                className="!bg-opacity-30"
                              >
                                {config.customDays} days
                              </Badge>
                            </button>
                          ) : (
                            <Badge
                              badgeType="default"
                              className="!bg-opacity-30"
                            >
                              {config.customDays} days
                            </Badge>
                          ))}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        buttonType="primary"
                        onClick={() => editCollectionConfig(config)}
                        className="min-w-fit"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </Button>
                      <ConfirmButton
                        onClick={() => {
                          deleteCollectionConfig(config.id).catch((error) => {
                            // eslint-disable-next-line no-console
                            console.error(
                              'Failed to delete collection config:',
                              error
                            );
                          });
                        }}
                        confirmText={
                          <span className="whitespace-nowrap text-xs font-medium">
                            Delete?
                          </span>
                        }
                        className="min-w-fit"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </ConfirmButton>
                    </div>
                  </div>
                ))}

                {/* Add New Collection Card */}
                <div
                  onClick={addCollectionConfig}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      addCollectionConfig();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-gray-600 bg-gray-800/20 p-4 transition-all duration-200 hover:border-gray-500 hover:bg-gray-800/30"
                >
                  <div className="flex-1 text-center">
                    <div className="text-lg font-medium text-gray-300">
                      + Add New Collection
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Manual Sync Button */}
            <div className="mt-6 border-t border-gray-700 pt-4">
              <div className="flex items-center justify-between">
                <div></div>
                <Button
                  buttonType="primary"
                  onClick={startCollectionsSync}
                  data-testid="manual-collections-sync-button"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  <span>Sync Collections</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!onComplete && (
        <>
          <div className="mt-10 mb-6">
            <h3 className="heading">
              {intl.formatMessage(messages.tautulliSettings)}
            </h3>
            <p className="description">
              {intl.formatMessage(messages.tautulliSettingsDescription)}
            </p>
          </div>
          <Formik
            initialValues={{
              tautulliHostname: dataTautulli?.hostname,
              tautulliPort: dataTautulli?.port ?? 8181,
              tautulliUseSsl: dataTautulli?.useSsl,
              tautulliUrlBase: dataTautulli?.urlBase,
              tautulliApiKey: dataTautulli?.apiKey,
              tautulliExternalUrl: dataTautulli?.externalUrl,
            }}
            validationSchema={TautulliSettingsSchema}
            onSubmit={async (values) => {
              try {
                await axios.post('/api/v1/settings/tautulli', {
                  hostname: values.tautulliHostname,
                  port: Number(values.tautulliPort),
                  useSsl: values.tautulliUseSsl,
                  urlBase: values.tautulliUrlBase,
                  apiKey: values.tautulliApiKey,
                  externalUrl: values.tautulliExternalUrl,
                } as TautulliSettings);

                addToast(
                  intl.formatMessage(messages.toastTautulliSettingsSuccess),
                  {
                    autoDismiss: true,
                    appearance: 'success',
                  }
                );
              } catch (e) {
                addToast(
                  intl.formatMessage(messages.toastTautulliSettingsFailure),
                  {
                    autoDismiss: true,
                    appearance: 'error',
                  }
                );
              } finally {
                revalidateTautulli();
              }
            }}
          >
            {({
              errors,
              touched,
              values,
              handleSubmit,
              setFieldValue,
              isSubmitting,
              isValid,
            }) => {
              return (
                <form className="section" onSubmit={handleSubmit}>
                  <div className="form-row">
                    <label htmlFor="tautulliHostname" className="text-label">
                      {intl.formatMessage(messages.hostname)}
                      <span className="label-required">*</span>
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
                          {values.tautulliUseSsl ? 'https://' : 'http://'}
                        </span>
                        <Field
                          type="text"
                          inputMode="url"
                          id="tautulliHostname"
                          name="tautulliHostname"
                          className="rounded-r-only"
                        />
                      </div>
                      {errors.tautulliHostname &&
                        touched.tautulliHostname &&
                        typeof errors.tautulliHostname === 'string' && (
                          <div className="error">{errors.tautulliHostname}</div>
                        )}
                    </div>
                  </div>
                  <div className="form-row">
                    <label htmlFor="tautulliPort" className="text-label">
                      {intl.formatMessage(messages.port)}
                      <span className="label-required">*</span>
                    </label>
                    <div className="form-input-area">
                      <Field
                        type="text"
                        inputMode="numeric"
                        id="tautulliPort"
                        name="tautulliPort"
                        className="short"
                        autoComplete="off"
                        data-1pignore="true"
                        data-lpignore="true"
                        data-bwignore="true"
                      />
                      {errors.tautulliPort &&
                        touched.tautulliPort &&
                        typeof errors.tautulliPort === 'string' && (
                          <div className="error">{errors.tautulliPort}</div>
                        )}
                    </div>
                  </div>
                  <div className="form-row">
                    <label htmlFor="tautulliUseSsl" className="checkbox-label">
                      {intl.formatMessage(messages.enablessl)}
                    </label>
                    <div className="form-input-area">
                      <Field
                        type="checkbox"
                        id="tautulliUseSsl"
                        name="tautulliUseSsl"
                        onChange={() => {
                          setFieldValue(
                            'tautulliUseSsl',
                            !values.tautulliUseSsl
                          );
                        }}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <label htmlFor="tautulliUrlBase" className="text-label">
                      {intl.formatMessage(messages.urlBase)}
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <Field
                          type="text"
                          inputMode="url"
                          id="tautulliUrlBase"
                          name="tautulliUrlBase"
                          autoComplete="off"
                          data-1pignore="true"
                          data-lpignore="true"
                          data-bwignore="true"
                        />
                      </div>
                      {errors.tautulliUrlBase &&
                        touched.tautulliUrlBase &&
                        typeof errors.tautulliUrlBase === 'string' && (
                          <div className="error">{errors.tautulliUrlBase}</div>
                        )}
                    </div>
                  </div>
                  <div className="form-row">
                    <label htmlFor="tautulliApiKey" className="text-label">
                      {intl.formatMessage(messages.tautulliApiKey)}
                      <span className="label-required">*</span>
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <SensitiveInput
                          as="field"
                          id="tautulliApiKey"
                          name="tautulliApiKey"
                        />
                      </div>
                      {errors.tautulliApiKey &&
                        touched.tautulliApiKey &&
                        typeof errors.tautulliApiKey === 'string' && (
                          <div className="error">{errors.tautulliApiKey}</div>
                        )}
                    </div>
                  </div>
                  <div className="form-row">
                    <label htmlFor="tautulliExternalUrl" className="text-label">
                      {intl.formatMessage(messages.externalUrl)}
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <Field
                          type="text"
                          inputMode="url"
                          id="tautulliExternalUrl"
                          name="tautulliExternalUrl"
                          autoComplete="off"
                          data-1pignore="true"
                          data-lpignore="true"
                          data-bwignore="true"
                        />
                      </div>
                      {errors.tautulliExternalUrl &&
                        touched.tautulliExternalUrl && (
                          <div className="error">
                            {errors.tautulliExternalUrl}
                          </div>
                        )}
                    </div>
                  </div>
                  <div className="actions">
                    <div className="flex justify-end">
                      <span className="ml-3 inline-flex rounded-md shadow-sm">
                        <Button
                          buttonType="primary"
                          type="submit"
                          disabled={isSubmitting || !isValid}
                        >
                          <ArrowDownOnSquareIcon />
                          <span>
                            {isSubmitting
                              ? intl.formatMessage(globalMessages.saving)
                              : intl.formatMessage(globalMessages.save)}
                          </span>
                        </Button>
                      </span>
                    </div>
                  </div>
                </form>
              );
            }}
          </Formik>

          <div className="mt-10 mb-6">
            <h3 className="heading">
              {intl.formatMessage(messages.traktSettings)}
            </h3>
            <p className="description">
              {intl.formatMessage(messages.traktSettingsDescription)}
            </p>
          </div>
          <Formik
            initialValues={{
              traktApiKey: dataTrakt?.apiKey,
            }}
            validationSchema={TraktSettingsSchema}
            onSubmit={async (values) => {
              try {
                await axios.post('/api/v1/settings/trakt', {
                  apiKey: values.traktApiKey,
                } as TraktSettings);

                addToast(
                  intl.formatMessage(messages.toastTraktSettingsSuccess),
                  {
                    appearance: 'success',
                    autoDismiss: true,
                  }
                );
              } catch (e) {
                addToast(
                  intl.formatMessage(messages.toastTraktSettingsFailure),
                  {
                    appearance: 'error',
                    autoDismiss: true,
                  }
                );
              } finally {
                revalidateTrakt();
              }
            }}
          >
            {({ errors, touched, isSubmitting, isValid }) => {
              return (
                <form>
                  <div className="form-row">
                    <label htmlFor="traktApiKey" className="text-label">
                      {intl.formatMessage(messages.traktApiKey)}
                      <span className="label-tip">
                        {intl.formatMessage(messages.traktApiKeyTip)}
                      </span>
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <SensitiveInput
                          as="field"
                          id="traktApiKey"
                          name="traktApiKey"
                        />
                      </div>
                      {errors.traktApiKey &&
                        touched.traktApiKey &&
                        typeof errors.traktApiKey === 'string' && (
                          <div className="error">{errors.traktApiKey}</div>
                        )}
                    </div>
                  </div>
                  <div className="actions">
                    <div className="flex justify-end">
                      <span className="ml-3 inline-flex rounded-md shadow-sm">
                        <Button
                          buttonType="primary"
                          type="submit"
                          disabled={isSubmitting || !isValid}
                        >
                          <ArrowDownOnSquareIcon />
                          <span>
                            {isSubmitting
                              ? intl.formatMessage(globalMessages.saving)
                              : intl.formatMessage(globalMessages.save)}
                          </span>
                        </Button>
                      </span>
                    </div>
                  </div>
                </form>
              );
            }}
          </Formik>
        </>
      )}

      {/* Collection Configuration Form Modal */}
      {showConfigForm && editingConfig && (
        <CollectionConfigForm
          config={editingConfig}
          data={data}
          intl={intl}
          mainSettings={mainSettings}
          onSave={saveCollectionConfig}
          onCancel={() => {
            setShowConfigForm(false);
            setEditingConfig(null);
          }}
        />
      )}
    </>
  );
};

export default SettingsPlex;
