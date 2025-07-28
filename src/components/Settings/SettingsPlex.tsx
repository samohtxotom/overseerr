import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
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
  XMarkIcon,
} from '@heroicons/react/24/solid';
import type { PlexDevice } from '@server/interfaces/api/plexInterfaces';
import type { PlexSettings, TautulliSettings } from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { orderBy } from 'lodash';
import type React from 'react';
import { useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';
import * as Yup from 'yup';

interface FormikFieldProps {
  field: {
    name: string;
    value: string;
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
    ) => void;
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => void;
  };
  form: {
    setFieldValue: (field: string, value: string) => void;
    errors: Record<string, string>;
    touched: Record<string, boolean>;
  };
}

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
  collectionsEnabled: 'Enable Collections',
  collectionsPlexPassRequired: 'Plex Pass required for full functionality',
  collectionsPlexPassWarning:
    'Collections require Plex Pass for labels and user filtering, without Plex Pass, all collections will be visible to all users.',
  collectionsPlexPassCheckFailed: 'Unable to verify Plex Pass status',
  collectionsEnabledDescription:
    'Create Plex collections in the Library tab for each user with their available requests, only visible to the user. Note: Uses label restrictions, all collections will be visible to admin',
  plexcollections: 'Plex Collections',
  plexcollectionsDescription:
    'Creates collections for each user in Plex under the Library tab with their available requests. Uses unique user labels with the overseerr prefix to restrict visibility to only that user and to ensure other collections and labels are unaffected. All collections will always be visible to the server owner. Runs as a job every 15 minutes.',
  enableCollections: 'Enable Collections',
  disableCollections: 'Disable Collections',
  verifyingPlexPass: 'Checking Plex Pass…',
  plexPassVerified: 'Plex Pass verified successfully!',
  overrideAndEnable: 'Override and Enable Collections',
  collectionsManagement: 'Collections Management',
  collectionsManagementDescription:
    'Purges all collections and labels created by Overseerr',
  plexPassRequired: 'Plex Pass Required',
  plexPassRequiredDescription:
    'Plex requires Plex Pass for labels to work. Without Plex Pass, all collections will be visible to all users. As collection titles contain usernames, this could be a privacy concern.',
  collectionTemplate: 'Collection Name Template',
  collectionTemplateDescription:
    'Customize how collection names are generated. At least one variable is required to ensure each collection can be identified.',
  collectionTemplateHelp:
    'Available variables: {username} (Plex username), {nickname} (display name), {domain} (your domain), {appTitle} (application title)',
  collectionTemplatePreview: 'Preview',
  collectionTemplatePresets: 'Presets',
  collectionTemplateCustom: 'Custom',
  collectionTemplateUserRequired:
    'At least one unique variable ({username} or {nickname}) is required for collection names',
  collectionTemplateError:
    'Collection template must include at least one unique variable ({username} or {nickname}) to ensure proper collection naming',
  // Status and progress messages
  collectionsActive: '✓ Active',
  collectionsOverrideWarning: '(Override - visible to all users)',
  enablingCollections: 'Enabling Collections',
  disablingCollections: 'Disabling Collections',
  // Progress step messages
  progressEnablingCollections: 'Enabling collections…',
  progressStartingSync: 'Starting collections sync job…',
  progressCollectionsEnabled: 'Collections enabled successfully!',
  progressDisablingCollections: 'Disabling collections…',
  progressPurgingCollections: 'Purging existing collections…',
  progressRemovingLabels: 'Removing user label restrictions…',
  progressCollectionsDisabled: 'Collections disabled and purged!',
  removingCollectionsAndLabels: 'Removing all overseerr collections and labels',
  progressSavingSettings: 'Saving collection settings…',
  progressSettingsSaved: 'Settings saved and sync started!',
  // Toast messages
  toastCollectionsEnabled: 'Collections enabled successfully!',
  toastPlexPassVerified: 'Plex Pass verified successfully!',
  toastPlexPassNotDetected: 'Plex Pass not detected',
  toastCollectionsSyncStarted: 'Collections sync started successfully!',
  toastCollectionsDisabledSuccess:
    'Collections disabled and purged successfully!',
  toastCollectionsSyncSkipped:
    'Plex collections sync skipped - collections are disabled. Enable collections in Plex settings to run this job.',
  // Progress ETA messages
  calculatingTimeRemaining: 'Calculating time remaining…',
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

interface PlexPassStatus {
  hasPlexPass: boolean;
  message?: string;
  error?: string;
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
  const { data: currentUser } = useSWR('/api/v1/auth/me');
  const { data: mainSettings } = useSWR('/api/v1/settings/main');

  // Plex Pass check with persistence
  const [isCheckingPlexPass, setIsCheckingPlexPass] = useState(false);
  const [plexPassStatus, setPlexPassStatus] = useState<PlexPassStatus | null>(
    null
  );
  const [isOverridden, setIsOverridden] = useState(false);
  const [hasBeenChecked, setHasBeenChecked] = useState(false);
  const [showEnablingState, setShowEnablingState] = useState(false);

  // Progress states for enable/disable operations (just for tick animations)
  const [isEnablingCollections, setIsEnablingCollections] = useState(false);
  const [isDisablingCollections, setIsDisablingCollections] = useState(false);

  const { data: dataSync, mutate: revalidateSync } = useSWR<SyncStatus>(
    '/api/v1/settings/plex/sync',
    {
      refreshInterval: 1000,
    }
  );

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
  const updateCollectionTitles = async () => {
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

  // Plex Pass check function
  const checkPlexPassAndAutoEnable = async (
    setFieldValue?: (field: string, value: unknown) => void
  ) => {
    setIsCheckingPlexPass(true);

    // Ensure minimum display duration for UX
    const startTime = Date.now();
    let shouldEnableCollections = false;

    try {
      // Use stored Plex Pass status from user data instead of API call
      const hasPlexPass = currentUser?.hasPlexPass || false;

      setPlexPassStatus({
        hasPlexPass,
        message: hasPlexPass
          ? 'Plex Pass verified from user data'
          : 'No Plex Pass found',
      });
      setHasBeenChecked(true);

      if (hasPlexPass && isOverridden) {
        setIsOverridden(false);
      }

      if (hasPlexPass) {
        // Store that we'll need to enable collections after the UI flow
        if (setFieldValue && !data?.collectionsEnabled) {
          shouldEnableCollections = true;
        } else {
          addToast(intl.formatMessage(messages.toastPlexPassVerified), {
            autoDismiss: true,
            appearance: 'success',
          });
        }
      } else {
        addToast(intl.formatMessage(messages.toastPlexPassNotDetected), {
          autoDismiss: true,
          appearance: 'warning',
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      setPlexPassStatus({
        hasPlexPass: false,
        message: 'Plex Pass check failed',
      });
      setHasBeenChecked(true);

      addToast(`Failed to verify Plex Pass: ${errorMessage}`, {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      // Ensure minimum 750ms display duration for "Checking Plex Pass..." state
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, 750 - elapsedTime);

      setTimeout(() => {
        setIsCheckingPlexPass(false);

        // If Plex Pass was verified and we need to enable collections, show the enabling state
        if (shouldEnableCollections) {
          setShowEnablingState(true);

          // Show "Enable Collections" with tick for 750ms
          setTimeout(async () => {
            setShowEnablingState(false);
            setIsEnablingCollections(true);

            try {
              if (setFieldValue && data) {
                setFieldValue('collectionsEnabled', true);
                await axios.post('/api/v1/settings/plex', {
                  ip: data.ip,
                  port: data.port,
                  useSsl: data.useSsl,
                  webAppUrl: data.webAppUrl,
                  collectionsEnabled: true,
                } as PlexSettings);
              }

              addToast(intl.formatMessage(messages.toastCollectionsEnabled), {
                autoDismiss: true,
                appearance: 'success',
              });
              revalidate();
            } catch (e) {
              if (setFieldValue) {
                setFieldValue('collectionsEnabled', false);
                addToast(
                  'Failed to enable collections after Plex Pass verification.',
                  {
                    autoDismiss: true,
                    appearance: 'error',
                  }
                );
              }
            } finally {
              setIsEnablingCollections(false);
            }
          }, 750);
        }
      }, remainingTime);
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

  if ((!data || !dataTautulli) && !error) {
    return <LoadingSpinner />;
  }
  return (
    <>
      <style>
        {`
          @keyframes drawTick {
            from {
              stroke-dashoffset: 20;
            }
            to {
              stroke-dashoffset: 0;
            }
          }
        `}
      </style>
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
          <Formik
            initialValues={{
              collectionsEnabled: data?.collectionsEnabled ?? false,
              collectionTemplate:
                data?.collectionTemplate ?? "{nickname}'s requests",
            }}
            onSubmit={async (values) => {
              try {
                // Validate that at least one unique field is present in custom templates
                const hasUniqueVariable =
                  values.collectionTemplate &&
                  (values.collectionTemplate.includes('{username}') ||
                    values.collectionTemplate.includes('{nickname}'));
                if (values.collectionTemplate && !hasUniqueVariable) {
                  addToast(
                    intl.formatMessage(messages.collectionTemplateError),
                    {
                      autoDismiss: true,
                      appearance: 'error',
                    }
                  );
                  return;
                }

                // Save settings
                await axios.post('/api/v1/settings/plex', {
                  ip: data?.ip,
                  port: data?.port,
                  useSsl: data?.useSsl,
                  webAppUrl: data?.webAppUrl,
                  collectionsEnabled: values.collectionsEnabled,
                  collectionTemplate: values.collectionTemplate,
                } as PlexSettings);

                // If collections are enabled, just update titles in background
                if (values.collectionsEnabled) {
                  try {
                    await updateCollectionTitles();
                  } catch (error) {
                    // Continue even if title update fails
                  }
                  addToast('Settings saved successfully!', {
                    autoDismiss: true,
                    appearance: 'success',
                  });
                } else {
                  addToast('Settings saved successfully!', {
                    autoDismiss: true,
                    appearance: 'success',
                  });
                }

                revalidate();
              } catch (e) {
                addToast('Failed to save collections settings.', {
                  autoDismiss: true,
                  appearance: 'error',
                });
              }
            }}
          >
            {({ values, setFieldValue, submitForm }) => {
              const handleCollectionsAction = async () => {
                if (values.collectionsEnabled) {
                  // Disable collections and start purge in background
                  const newValue = false;
                  setFieldValue('collectionsEnabled', newValue);

                  try {
                    await axios.post('/api/v1/settings/plex', {
                      ip: data?.ip,
                      port: data?.port,
                      useSsl: data?.useSsl,
                      webAppUrl: data?.webAppUrl,
                      collectionsEnabled: newValue,
                    } as PlexSettings);

                    // Start background purge sync
                    try {
                      await startCollectionsSync();
                    } catch (error) {
                      // Continue even if sync fails
                    }

                    addToast(
                      'Collections disabled and cleanup started in background!',
                      {
                        autoDismiss: true,
                        appearance: 'success',
                      }
                    );
                    revalidate();
                    // Reset states when disabling
                    setPlexPassStatus(null);
                    setIsOverridden(false);
                    setHasBeenChecked(false);
                    setShowEnablingState(false);
                  } catch (e) {
                    setFieldValue('collectionsEnabled', true);
                    addToast('Failed to disable collections.', {
                      autoDismiss: true,
                      appearance: 'error',
                    });
                  }
                  return;
                }

                if (!hasBeenChecked) {
                  await checkPlexPassAndAutoEnable(setFieldValue);
                } else if (
                  plexPassStatus &&
                  !plexPassStatus.hasPlexPass &&
                  !isOverridden
                ) {
                  setIsOverridden(true);
                  addToast(
                    'Collections override activated. All collections will be visible to all users.',
                    {
                      autoDismiss: true,
                      appearance: 'warning',
                    }
                  );

                  // Auto-enable collections after override
                  setShowEnablingState(true);

                  // Show "Enable Collections" with tick for 750ms
                  setTimeout(async () => {
                    setShowEnablingState(false);
                    setIsEnablingCollections(true);

                    try {
                      const newValue = true;
                      setFieldValue('collectionsEnabled', newValue);
                      await axios.post('/api/v1/settings/plex', {
                        ip: data?.ip,
                        port: data?.port,
                        useSsl: data?.useSsl,
                        webAppUrl: data?.webAppUrl,
                        collectionsEnabled: newValue,
                      } as PlexSettings);

                      // Only enable setting, do not auto-start sync (matches Plex Pass verification behavior)
                      addToast(
                        intl.formatMessage(messages.toastCollectionsEnabled),
                        {
                          autoDismiss: true,
                          appearance: 'success',
                        }
                      );
                      revalidate();
                    } catch (e) {
                      setFieldValue('collectionsEnabled', false);
                      addToast('Failed to enable collections.', {
                        autoDismiss: true,
                        appearance: 'error',
                      });
                    } finally {
                      setIsEnablingCollections(false);
                    }
                  }, 750);
                } else if (
                  (plexPassStatus?.hasPlexPass || isOverridden) &&
                  !values.collectionsEnabled
                ) {
                  const newValue = true;
                  setIsEnablingCollections(true);

                  try {
                    setFieldValue('collectionsEnabled', newValue);
                    await axios.post('/api/v1/settings/plex', {
                      ip: data?.ip,
                      port: data?.port,
                      useSsl: data?.useSsl,
                      webAppUrl: data?.webAppUrl,
                      collectionsEnabled: newValue,
                    } as PlexSettings);

                    // Start initial collections sync in background
                    try {
                      await startCollectionsSync();
                    } catch (error) {
                      // Continue even if sync fails
                    }

                    addToast(
                      'Collections enabled and initial sync started in background!',
                      {
                        autoDismiss: true,
                        appearance: 'success',
                      }
                    );
                    revalidate();
                  } catch (e) {
                    setFieldValue('collectionsEnabled', false);
                    addToast('Failed to enable collections.', {
                      autoDismiss: true,
                      appearance: 'error',
                    });
                  } finally {
                    setIsEnablingCollections(false);
                  }
                }
              };

              const toggleCollections = async () => {
                if (values.collectionsEnabled) {
                  const newValue = false;
                  setIsDisablingCollections(true);

                  try {
                    setFieldValue('collectionsEnabled', newValue);

                    // Disable collections and trigger purge operations
                    await axios.post('/api/v1/settings/plex', {
                      ip: data?.ip,
                      port: data?.port,
                      useSsl: data?.useSsl,
                      webAppUrl: data?.webAppUrl,
                      collectionsEnabled: newValue,
                      purgeCollections: true,
                      purgeUserLabels: true,
                    });

                    addToast(
                      intl.formatMessage(
                        messages.toastCollectionsDisabledSuccess
                      ),
                      {
                        autoDismiss: true,
                        appearance: 'success',
                      }
                    );
                    revalidate();
                  } catch (e) {
                    setFieldValue('collectionsEnabled', true);
                    addToast('Failed to disable collections.', {
                      autoDismiss: true,
                      appearance: 'error',
                    });
                  } finally {
                    setIsDisablingCollections(false);
                  }
                } else {
                  const newValue = true;
                  setIsEnablingCollections(true);

                  try {
                    setFieldValue('collectionsEnabled', newValue);
                    await axios.post('/api/v1/settings/plex', {
                      ip: data?.ip,
                      port: data?.port,
                      useSsl: data?.useSsl,
                      webAppUrl: data?.webAppUrl,
                      collectionsEnabled: newValue,
                    } as PlexSettings);

                    addToast(
                      intl.formatMessage(messages.toastCollectionsEnabled),
                      {
                        autoDismiss: true,
                        appearance: 'success',
                      }
                    );
                    revalidate();
                  } catch (e) {
                    setFieldValue('collectionsEnabled', false);
                    addToast('Failed to enable collections.', {
                      autoDismiss: true,
                      appearance: 'error',
                    });
                  } finally {
                    setIsEnablingCollections(false);
                  }
                }
              };

              const getButtonText = () => {
                if (isDisablingCollections) {
                  return intl.formatMessage(
                    messages.removingCollectionsAndLabels
                  );
                }
                if (values.collectionsEnabled) {
                  return intl.formatMessage(messages.disableCollections);
                }
                if (isCheckingPlexPass) {
                  return intl.formatMessage(messages.verifyingPlexPass);
                }
                if (showEnablingState) {
                  return intl.formatMessage(messages.enableCollections);
                }
                if (!hasBeenChecked) {
                  return intl.formatMessage(messages.enableCollections);
                }
                if (
                  plexPassStatus &&
                  !plexPassStatus.hasPlexPass &&
                  !isOverridden
                ) {
                  return intl.formatMessage(messages.overrideAndEnable);
                }
                return intl.formatMessage(messages.enableCollections);
              };

              const getButtonType = () => {
                if (isCheckingPlexPass || showEnablingState) {
                  return 'default';
                }
                if (
                  plexPassStatus &&
                  !plexPassStatus.hasPlexPass &&
                  !isOverridden &&
                  hasBeenChecked
                ) {
                  return 'warning';
                }
                return 'default';
              };

              const isButtonDisabled = () => {
                return (
                  isCheckingPlexPass ||
                  showEnablingState ||
                  isEnablingCollections ||
                  isDisablingCollections ||
                  !data?.ip ||
                  !data?.port
                );
              };

              const showToggleSwitch =
                values.collectionsEnabled ||
                (hasBeenChecked &&
                  (plexPassStatus?.hasPlexPass || isOverridden));

              return (
                <>
                  <div className="space-y-6" data-testid="settings-plex-form">
                    {/* Collections Status */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <Button
                          buttonType={getButtonType()}
                          onClick={
                            showToggleSwitch
                              ? toggleCollections
                              : handleCollectionsAction
                          }
                          disabled={isButtonDisabled()}
                          data-testid="collections-sync-toggle"
                        >
                          {(isCheckingPlexPass || isDisablingCollections) && (
                            <ArrowPathIcon
                              className="animate-spin"
                              style={{ animationDirection: 'reverse' }}
                            />
                          )}
                          {showEnablingState && (
                            <svg
                              className="h-4 w-4 text-green-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                                style={{
                                  strokeDasharray: '20',
                                  strokeDashoffset: '20',
                                  animation:
                                    'drawTick 0.5s ease-in-out forwards',
                                }}
                              />
                            </svg>
                          )}
                          <span>{getButtonText()}</span>
                        </Button>

                        {values.collectionsEnabled && (
                          <span
                            className="text-sm font-medium text-green-400"
                            data-testid="collections-status-active"
                          >
                            {intl.formatMessage(messages.collectionsActive)}
                            {isOverridden &&
                              plexPassStatus &&
                              !plexPassStatus.hasPlexPass && (
                                <span
                                  className="ml-2 text-orange-400"
                                  data-testid="plex-pass-warning"
                                >
                                  {intl.formatMessage(
                                    messages.collectionsOverrideWarning
                                  )}
                                </span>
                              )}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Plex Pass Warning - moved to immediately below the override button */}
                    {!values.collectionsEnabled &&
                      hasBeenChecked &&
                      plexPassStatus &&
                      !plexPassStatus.hasPlexPass &&
                      !isOverridden && (
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
                                {intl.formatMessage(messages.plexPassRequired)}
                              </h3>
                              <p className="mt-2 text-sm text-orange-300">
                                {intl.formatMessage(
                                  messages.plexPassRequiredDescription
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                    <>
                      {/* Collection Template Configuration */}
                      <div
                        className={`space-y-4 ${
                          !values.collectionsEnabled
                            ? 'pointer-events-none opacity-50'
                            : ''
                        }`}
                      >
                        <div>
                          <label
                            htmlFor="collectionTemplate"
                            className="text-label mb-2 block"
                          >
                            {intl.formatMessage(messages.collectionTemplate)}
                          </label>
                          <div>
                            <Field name="collectionTemplate">
                              {({ field, form }: FormikFieldProps) => {
                                const presets = [
                                  {
                                    label: "{nickname}'s requests",
                                    value: "{nickname}'s requests",
                                  },
                                  {
                                    label: 'Requested by {username}',
                                    value: 'Requested by {username}',
                                  },
                                  {
                                    label: "{domain} - {nickname}'s requests",
                                    value: "{domain} - {nickname}'s requests",
                                  },
                                  {
                                    label: '{domain} requests by {username}',
                                    value: '{domain} requests by {username}',
                                  },
                                  {
                                    label: '{appTitle} - {username} requests',
                                    value: '{appTitle} - {username} requests',
                                  },
                                  { label: 'Custom', value: 'custom' },
                                ];

                                // Determine dropdown state
                                const foundPreset = presets.find(
                                  (p) =>
                                    p.value === field.value &&
                                    p.value !== 'custom'
                                );
                                const dropdownValue = foundPreset
                                  ? field.value
                                  : 'custom';

                                const isCustom = dropdownValue === 'custom';
                                const hasUniqueVariable =
                                  field.value &&
                                  (field.value.includes('{username}') ||
                                    field.value.includes('{nickname}'));
                                const showError =
                                  isCustom && field.value && !hasUniqueVariable;

                                return (
                                  <div className="space-y-3">
                                    <div className="form-input-field">
                                      <select
                                        value={dropdownValue}
                                        onChange={(e) => {
                                          if (e.target.value !== 'custom') {
                                            form.setFieldValue(
                                              'collectionTemplate',
                                              e.target.value
                                            );
                                          } else {
                                            // When custom is selected, clear the field to trigger custom input
                                            form.setFieldValue(
                                              'collectionTemplate',
                                              ''
                                            );
                                          }
                                        }}
                                        className="rounded-md"
                                      >
                                        {presets.map((preset) => (
                                          <option
                                            key={preset.value}
                                            value={preset.value}
                                          >
                                            {preset.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    {isCustom && (
                                      <div className="form-input-field">
                                        <input
                                          type="text"
                                          value={field.value}
                                          onChange={(e) =>
                                            form.setFieldValue(
                                              'collectionTemplate',
                                              e.target.value
                                            )
                                          }
                                          placeholder="Enter custom template..."
                                          className={`rounded-md ${
                                            showError ? 'border-red-500' : ''
                                          }`}
                                        />
                                      </div>
                                    )}

                                    {/* Error message for missing {user} */}
                                    {showError && (
                                      <div className="text-sm text-red-400">
                                        {intl.formatMessage(
                                          messages.collectionTemplateError
                                        )}
                                      </div>
                                    )}

                                    {/* Variables help - only show for custom - moved above preview */}
                                    {isCustom && (
                                      <div className="form-input-description">
                                        <p className="text-xs text-gray-400">
                                          {intl.formatMessage(
                                            messages.collectionTemplateHelp
                                          )}
                                        </p>
                                        <p className="mt-1 text-xs text-orange-400">
                                          {intl.formatMessage(
                                            messages.collectionTemplateUserRequired
                                          )}
                                        </p>
                                      </div>
                                    )}

                                    {/* Live Preview - compact size */}
                                    <div className="rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm">
                                      <div className="mb-1 text-xs text-gray-400">
                                        Preview:
                                      </div>
                                      <div className="text-sm text-gray-200">
                                        {(() => {
                                          try {
                                            // Use real data for preview
                                            const extractDomain = (
                                              url?: string
                                            ) => {
                                              if (!url) return '';
                                              try {
                                                const urlWithProtocol =
                                                  url.startsWith('http')
                                                    ? url
                                                    : `https://${url}`;
                                                return new URL(urlWithProtocol)
                                                  .hostname;
                                              } catch {
                                                return (
                                                  url
                                                    .replace(/^https?:\/\//, '')
                                                    .split('/')[0]
                                                    .split(':')[0] || ''
                                                );
                                              }
                                            };

                                            const previewVars = {
                                              username:
                                                currentUser?.plexUsername ||
                                                currentUser?.username ||
                                                'username',
                                              nickname:
                                                currentUser?.plexTitle ||
                                                currentUser?.displayName ||
                                                'Nickname',
                                              domain:
                                                extractDomain(
                                                  mainSettings?.applicationUrl ||
                                                    data?.webAppUrl
                                                ) || 'yourdomain.com',
                                              appTitle:
                                                mainSettings?.applicationTitle ||
                                                'Overseerr',
                                            };

                                            let preview =
                                              field.value ||
                                              "{nickname}'s requests";
                                            Object.entries(previewVars).forEach(
                                              ([key, value]) => {
                                                preview = preview.replace(
                                                  new RegExp(
                                                    `\\{${key}\\}`,
                                                    'g'
                                                  ),
                                                  value
                                                );
                                              }
                                            );
                                            return preview;
                                          } catch {
                                            return `Requested by ${
                                              currentUser?.displayName ||
                                              'Server Owner'
                                            }`;
                                          }
                                        })()}
                                      </div>
                                    </div>
                                  </div>
                                );
                              }}
                            </Field>

                            {/* Save button for template */}
                            <div className="mt-3">
                              <Button
                                buttonType="primary"
                                buttonSize="sm"
                                onClick={() => submitForm()}
                                disabled={
                                  !values.collectionsEnabled ||
                                  Boolean(
                                    values.collectionTemplate &&
                                      !(
                                        values.collectionTemplate.includes(
                                          '{username}'
                                        ) ||
                                        values.collectionTemplate.includes(
                                          '{nickname}'
                                        )
                                      )
                                  )
                                }
                                data-testid="manual-collections-sync-button"
                              >
                                <span>Save</span>
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  </div>
                </>
              );
            }}
          </Formik>
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
        </>
      )}
    </>
  );
};

export default SettingsPlex;
