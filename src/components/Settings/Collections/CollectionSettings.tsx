import { useState } from 'react';
import { useIntl, defineMessages } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import axios from 'axios';
import type { PlexSettings } from '@server/lib/settings';
import useSWR from 'swr';
import CollectionConfigForm from './CollectionConfigForm';
import LibraryCollectionGroup from './LibraryCollectionGroup';
import Button from '@app/components/Common/Button';
import { PlusIcon } from '@heroicons/react/24/solid';
import type { CollectionConfig, CollectionSettingsProps } from './types';
import {
  groupConfigsByLibrary,
  updateConfigsAfterReorder,
  normalizeConfigsForStorage
} from './collectionUtils';

const messages = defineMessages({
  collectionConfigSaved: 'Collection configuration saved successfully!',
  collectionConfigError: 'Failed to save collection configuration.',
  collectionConfigDeleted: 'Collection configuration deleted successfully!',
});

const CollectionSettings = ({
  collectionConfigs,
  libraries,
  onUpdateConfigs,
}: CollectionSettingsProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { mutate: revalidate } = useSWR('/api/v1/settings/plex');
  const { data } = useSWR<PlexSettings>('/api/v1/settings/plex');

  // Form state
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<CollectionConfig | null>(null);

  // Tab state for Home Screen vs Library Tab ordering
  const [activeTab, setActiveTab] = useState<'home' | 'library'>('home');

  // Badge click tracking (for easter eggs)
  const [badgeClickCount, setBadgeClickCount] = useState(0);

  const checkForUnlockSequence = () => {
    // Check if there's an Overseerr user collection with 69 items and user has clicked 10 times
    const overseerrUserCollectionWith69Items = collectionConfigs.find(
      (config) => config.type === 'overseerr' && config.subtype === 'users' && config.maxItems === 69
    );


    if (
      overseerrUserCollectionWith69Items &&
      badgeClickCount >= 10 &&
      !data?.usersHomeUnlocked
    ) {
      // Unlock Users Home collections - preserve all existing settings
      if (data) {
        const writableSettings = Object.fromEntries(
          Object.entries(data).filter(([key]) => !['name', 'machineId', 'libraries'].includes(key))
        );
        fetch('/api/v1/settings/plex', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...writableSettings,
            usersHomeUnlocked: true, // Only change this field
          }),
        })
        .then(() => {
          revalidate();
          addToast('Users Home collections unlocked! 🏠✨', {
            autoDismiss: true,
            appearance: 'success',
          });
          setBadgeClickCount(0);
        })
        .catch(() => {
          addToast('Failed to unlock Users Home collections', {
            autoDismiss: true,
            appearance: 'error',
          });
        });
      }
    }
  };

  // Collection configuration handlers
  const saveCollectionConfigs = async (
    configs: CollectionConfig[],
    suppressNotification = false
  ) => {
    try {
      await axios.post('/api/v1/settings/plex/collections', {
        collectionConfigs: configs,
      });

      onUpdateConfigs(configs);
      revalidate();

      if (!suppressNotification) {
        addToast(intl.formatMessage(messages.collectionConfigSaved), {
          autoDismiss: true,
          appearance: 'success',
        });
      }
    } catch (error) {
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
      type: undefined, // Start with no selection to show "Select Source..."
      subtype: '',
      template: '',
      customMovieTemplate: '', // Initialize empty custom movie template
      customTVTemplate: '', // Initialize empty custom TV template
      visibilityConfig: {
        usersHome: true,
        serverOwnerHome: true,
        libraryRecommended: false,
        libraryTabOnly: false
      }, // Default to Users and Server Owner Home
      maxItems: 20,
      mediaType: 'both',
      libraryId: '', // Start with no selection to show "Select Libraries..."
      libraryName: '',
      sortOrderHome: 0, // Default to top of home screen
      sortOrderLibrary: 0, // Default to top of library tab
      customDays: 30, // Default for Tautulli collections
      tautulliStatType: 'plays', // Default stat type
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
    // Check if this is an expanded config from a linked collection (libraryId: 'all')
    // If so, find and use the original parent config instead
    let configToEdit = config;
    
    const isExpandedFromLinkedCollection = collectionConfigs.some(orig => 
      orig.id === config.id && 
      orig.libraryId === 'all' && 
      config.libraryId !== 'all'
    );
    
    if (isExpandedFromLinkedCollection) {
      const originalConfig = collectionConfigs.find(c => c.id === config.id && c.libraryId === 'all');
      if (originalConfig) {
        // Found parent config for linked collection
        configToEdit = originalConfig;
      } else {
        // Could not find original "All Libraries" config
      }
    }
    
    // Editing config
    
    setEditingConfig({ ...configToEdit });
    setShowConfigForm(true);
  };

  const deleteCollectionConfig = async (configId: number) => {
    const updatedConfigs = collectionConfigs.filter((c) => c.id !== configId);
    const isLastCollection = updatedConfigs.length === 0;

    try {
      await saveCollectionConfigs(updatedConfigs, true); // Suppress the save notification

      // If this was the last collection, trigger final sync then disable collections
      if (isLastCollection && data) {
        try {
          // First trigger a final sync to clean up all collections and labels
          await axios.post('/api/v1/settings/plex/collections/sync');

          // Then disable collections feature
          await axios.post('/api/v1/settings/plex', {
            ip: data.ip,
            port: data.port,
            useSsl: data.useSsl,
            webAppUrl: data.webAppUrl,
            collectionsEnabled: false,
          });

          addToast(
            'Last collection deleted - final cleanup completed and collections disabled.',
            {
              autoDismiss: true,
              appearance: 'success',
            }
          );
        } catch (error) {
          // Failed to complete final cleanup after deleting last config
          addToast(
            'Collection deleted but failed to complete final cleanup. Manual cleanup may be required.',
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
    // saveCollectionConfig called

    const existingIndex = collectionConfigs.findIndex((c) => c.id === config.id);
    let updatedConfigs: CollectionConfig[];

    if (existingIndex >= 0) {
      // Update existing
      // Updating existing config
      updatedConfigs = [...collectionConfigs];
      updatedConfigs[existingIndex] = config;
    } else {
      // Add new - assign new ID
      const existingIds = new Set(collectionConfigs.map((c) => c.id));
      let newId = 1;
      while (existingIds.has(newId)) {
        newId++;
      }
      // Adding new config
      updatedConfigs = [...collectionConfigs, { ...config, id: newId }];
    }

    try {
      await saveCollectionConfigs(updatedConfigs);
      setShowConfigForm(false);
      setEditingConfig(null);
    } catch (error) {
      // Error already handled in saveCollectionConfigs
    }
  };

  const handleReorderConfigs = async (libraryId: string, reorderedConfigs: CollectionConfig[]) => {

    try {
      const updatedConfigs = updateConfigsAfterReorder(collectionConfigs, libraryId, reorderedConfigs);
      const normalizedConfigs = normalizeConfigsForStorage(updatedConfigs);

      await saveCollectionConfigs(normalizedConfigs, true); // Suppress notification for reorder
    } catch (error) {
      // Failed to reorder collections
      addToast('Failed to save collection order', {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  // Filter collections based on active tab
  const filteredConfigs = activeTab === 'home'
    ? collectionConfigs.filter(config => 
        !(config.visibilityConfig?.libraryTabOnly || (!config.visibilityConfig?.usersHome && !config.visibilityConfig?.serverOwnerHome && !config.visibilityConfig?.libraryRecommended)) && 
        !(config.type === 'overseerr' && config.subtype === 'users') // Exclude user collections from Home tab
      )
    : collectionConfigs; // Library tab: all collections

  // Group collections by library for display
  const libraryGroups = groupConfigsByLibrary(filteredConfigs, libraries, activeTab);
  const enabledLibraries = libraries.filter(lib => lib.enabled);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <Button
          buttonType="primary"
          onClick={addCollectionConfig}
          className="flex items-center space-x-2"
        >
          <PlusIcon className="h-4 w-4" />
          <span>Add Collection</span>
        </Button>
      </div>

      {/* Tabs for Home Screen vs Library Tab */}
      <div className="border-b border-gray-700">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('home')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'home'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300'
              }`}
          >
            Home Tab Ordering
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'library'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300'
              }`}
          >
            Library Tab Ordering
          </button>
        </nav>
      </div>

      {/* Library-Grouped Collections */}
      {enabledLibraries.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-400">No enabled Plex libraries found. Please enable libraries in your Plex settings.</p>
        </div>
      ) : libraryGroups.size === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-400">No collections configured. Click &quot;Add Collection&quot; to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {enabledLibraries.map((library) => {
            const libraryConfigs = libraryGroups.get(library.id) || [];
            return (
              <LibraryCollectionGroup
                key={library.id}
                library={library}
                configs={libraryConfigs}
                originalConfigs={collectionConfigs}
                onEdit={editCollectionConfig}
                onDelete={deleteCollectionConfig}
                onReorder={handleReorderConfigs}
                badgeClickCount={badgeClickCount}
                setBadgeClickCount={setBadgeClickCount}
                checkForUnlockSequence={checkForUnlockSequence}
                activeTab={activeTab}
              />
            );
          })}
        </div>
      )}

      {/* Collection Configuration Form Modal */}
      {showConfigForm && editingConfig && (
        <CollectionConfigForm
          config={editingConfig}
          libraries={libraries}
          onSave={saveCollectionConfig}
          onCancel={() => {
            setShowConfigForm(false);
            setEditingConfig(null);
          }}
        />
      )}
    </div>
  );
};

export default CollectionSettings;
