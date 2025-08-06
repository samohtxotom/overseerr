import React, { useState } from 'react';
import { useIntl, defineMessages } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import axios from 'axios';
import type { PlexSettings } from '@server/lib/settings';
import useSWR from 'swr';
import CollectionConfigForm from './CollectionConfigForm';
import HubConfigForm from './HubConfigForm';
import LibraryCollectionGroup from './LibraryCollectionGroup';
import Button from '@app/components/Common/Button';
import { PlusIcon, MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import type { CollectionConfig, CollectionSettingsProps, Library } from './types';
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
  libraries: librariesProp,
  onUpdateConfigs,
}: CollectionSettingsProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { mutate: revalidate } = useSWR('/api/v1/settings/plex');
  const { data } = useSWR<PlexSettings>('/api/v1/settings/plex');

  // Load libraries: use prop if provided, otherwise fetch directly from Plex
  const { data: plexLibraries = [], error: librariesError } = useSWR(
    librariesProp ? null : '/api/v1/settings/plex/libraries'
  );
  
  const libraries = librariesProp || plexLibraries;

  // Load hub configurations
  const { data: hubData, mutate: revalidateHubs } = useSWR('/api/v1/settings/hubs/configs');
  const hubConfigs = hubData?.hubConfigs || [];
  

  // Form state
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<CollectionConfig | null>(null);

  // Tab state for Home, Recommended, Library, Inactive, and Unmanaged tab ordering
  const [activeTab, setActiveTab] = useState<'home' | 'recommended' | 'library' | 'inactive' | 'unmanaged'>('home');
  const [activeLibraryId, setActiveLibraryId] = useState<string>('');  // For sub-tabs

  // Badge click tracking (for easter eggs)
  const [badgeClickCount, setBadgeClickCount] = useState(0);

  // Hub discovery state
  const [discoveringHubs, setDiscoveringHubs] = useState(false);

  // Local state for immediate UI updates during drag operations
  const [localCollectionConfigs, setLocalCollectionConfigs] = useState(collectionConfigs);
  const [localHubConfigs, setLocalHubConfigs] = useState(hubConfigs);

  // Update local state when props change (from SWR)
  React.useEffect(() => {
    setLocalCollectionConfigs(collectionConfigs);
  }, [collectionConfigs]);

  React.useEffect(() => {
    setLocalHubConfigs(hubConfigs);
  }, [hubConfigs]);

  // Convert hub configs to collection config format for display
  const convertHubConfigsToCollectionConfigs = (hubs: any[]): CollectionConfig[] => {
    return hubs.map((hub: any) => ({
      id: hub.id, // Keep string ID for hubs (will be handled by drag system)
      name: hub.name,
      type: 'hub' as any, // Special type to distinguish from regular collections
      subtype: hub.hubIdentifier,
      template: hub.name, // Use name as template
      customMovieTemplate: '',
      customTVTemplate: '',
      customPoster: undefined,
      visibilityConfig: hub.visibilityConfig,
      maxItems: 50, // Default for hubs
      mediaType: hub.mediaType === 'movie' ? 'movie' : hub.mediaType === 'tv' ? 'tv' : 'both',
      libraryId: hub.libraryId,
      libraryName: hub.libraryName,
      sortOrderHome: 0, // Hubs don't use home ordering
      sortOrderLibrary: hub.sortOrderLibrary,
      parentConfigId: undefined,
      isExpandedConfig: false,
      customDays: 30,
      tautulliStatType: 'plays',
      searchMissingMovies: false,
      searchMissingTV: false,
      autoApproveMovies: false,
      autoApproveTV: false,
      maxSeasonsToRequest: 3,
      traktCustomListUrl: undefined,
      tmdbCustomListUrl: undefined,
      imdbCustomListUrl: undefined,
      reverseOrder: false,
      randomizeOrder: false,
      timeRestriction: undefined,
    }));
  };

  // Merge collection configs and hub configs for display (using local state for immediate updates)
  const allConfigs = [
    ...localCollectionConfigs,
    ...convertHubConfigsToCollectionConfigs(localHubConfigs)
  ];

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

  const discoverPlexHubs = async () => {
    setDiscoveringHubs(true);
    try {
      const response = await axios.get('/api/v1/settings/hubs/discover');
      const { discoveredConfigs } = response.data;

      if (discoveredConfigs.length === 0) {
        addToast('No Plex hubs found to import.', {
          autoDismiss: true,
          appearance: 'info',
        });
        return;
      }

      // Get existing hub configurations from the hub API (not collections)
      const existingHubsResponse = await axios.get('/api/v1/settings/hubs/configs');
      const existingHubConfigs = existingHubsResponse.data.hubConfigs || [];
      
      // Filter out hubs that are already configured using the proper hub ID format
      const existingHubIds = new Set(existingHubConfigs.map((hub: any) => hub.id));

      const newHubs = discoveredConfigs.filter((hub: any) => 
        !existingHubIds.has(hub.id)
      );

      if (newHubs.length === 0) {
        addToast('All available Plex hubs are already configured.', {
          autoDismiss: true,
          appearance: 'info',
        });
        return;
      }


      // Append new hub configurations using the append endpoint (for discovery)
      await axios.post('/api/v1/settings/hubs/configs/append', {
        hubConfigs: newHubs,
      });

      // Revalidate hub configs to refresh the UI
      revalidateHubs();

      addToast(
        `Successfully imported ${newHubs.length} Plex hub${newHubs.length !== 1 ? 's' : ''}.`,
        {
          autoDismiss: true,
          appearance: 'success',
        }
      );
    } catch (error) {
      addToast('Failed to discover Plex hubs. Please check your Plex connection.', {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setDiscoveringHubs(false);
    }
  };

  const editCollectionConfig = (config: CollectionConfig) => {
    // Check if this is a hub config
    if (config.type === 'hub') {
      // For hubs, we edit the config directly (no linked collection logic)
      setEditingConfig({ ...config });
      setShowConfigForm(true);
      return;
    }

    // Check if this is an expanded config from a linked collection (libraryId: 'all')
    // If so, find and use the original parent config instead
    let configToEdit = config;
    
    const isExpandedFromLinkedCollection = localCollectionConfigs.some(orig => 
      orig.id === config.id && 
      orig.libraryId === 'all' && 
      config.libraryId !== 'all'
    );
    
    if (isExpandedFromLinkedCollection) {
      const originalConfig = localCollectionConfigs.find(c => c.id === config.id && c.libraryId === 'all');
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

  const deleteCollectionConfig = async (configId: number | string) => {
    // Handle both collection deletion and hub deletion
    if (typeof configId === 'string') {
      // This is a hub config - remove it from hub configs
      const updatedHubConfigs = localHubConfigs.filter((h: any) => h.id !== configId);
      try {
        // Update local state immediately
        setLocalHubConfigs(updatedHubConfigs);
        
        await axios.post('/api/v1/settings/hubs/configs', {
          hubConfigs: updatedHubConfigs,
        });
        revalidateHubs();
        addToast('Hub deleted successfully', {
          autoDismiss: true,
          appearance: 'success',
        });
      } catch (error) {
        addToast('Failed to delete hub', {
          autoDismiss: true,
          appearance: 'error',
        });
      }
      return;
    }
    
    // This is a regular collection config
    const updatedConfigs = localCollectionConfigs.filter((c) => c.id !== configId);
    const isLastCollection = updatedConfigs.length === 0;
    
    // Update local state immediately
    setLocalCollectionConfigs(updatedConfigs);

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
    // Handle hub configs separately
    if (config.type === 'hub') {
      try {
        // Update hub config in the hub configs array
        const existingHubIndex = localHubConfigs.findIndex((h: any) => h.id === config.id);
        if (existingHubIndex >= 0) {
          const updatedHubConfigs = [...localHubConfigs];
          // Convert back to hub config format
          updatedHubConfigs[existingHubIndex] = {
            id: config.id,
            hubIdentifier: config.subtype,
            name: config.name,
            libraryId: config.libraryId,
            libraryName: config.libraryName,
            mediaType: config.mediaType,
            sortOrderLibrary: config.sortOrderLibrary,
            visibilityConfig: config.visibilityConfig,
          };
          
          // Update local state immediately
          setLocalHubConfigs(updatedHubConfigs);
          
          // Save hub configs using hub API
          await axios.post('/api/v1/settings/hubs/configs', {
            hubConfigs: updatedHubConfigs,
          });
          
          revalidateHubs();
          addToast('Hub configuration saved successfully!', {
            autoDismiss: true,
            appearance: 'success',
          });
        }
      } catch (error) {
        addToast('Failed to save hub configuration.', {
          autoDismiss: true,
          appearance: 'error',
        });
      }
      
      setShowConfigForm(false);
      setEditingConfig(null);
      return;
    }

    // Handle regular collection configs
    const existingIndex = localCollectionConfigs.findIndex((c) => c.id === config.id);
    let updatedConfigs: CollectionConfig[];

    if (existingIndex >= 0) {
      // Update existing
      // Updating existing config
      updatedConfigs = [...localCollectionConfigs];
      updatedConfigs[existingIndex] = config;
    } else {
      // Add new - assign new ID
      const existingIds = new Set(localCollectionConfigs.map((c) => c.id));
      let newId = 1;
      while (existingIds.has(newId)) {
        newId++;
      }
      // Adding new config
      updatedConfigs = [...localCollectionConfigs, { ...config, id: newId }];
    }

    // Update local state immediately
    setLocalCollectionConfigs(updatedConfigs);

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
      // Separate collections and hubs from the reordered list
      const reorderedCollections = reorderedConfigs.filter(config => config.type !== 'hub');
      const reorderedHubs = reorderedConfigs.filter(config => config.type === 'hub');

      // Find all unmanaged built-in hubs for this library that aren't in the reordered list
      // These should be automatically placed at the bottom
      const allLibraryHubs = localHubConfigs.filter((h: any) => h.libraryId === libraryId);
      const unmanagedBuiltInHubs = allLibraryHubs.filter((hub: any) => {
        // Must be built-in (not promoted collection)
        const isBuiltIn = !hub.isPromotedCollection;
        // Must not be in the reordered list (meaning it's not being actively managed in UI)
        const notInReorderedList = !reorderedHubs.some(reorderedHub => reorderedHub.id === hub.id);
        
        return isBuiltIn && notInReorderedList;
      });

      // Create the complete hub order: active hubs first, then unmanaged built-in hubs at bottom
      const completeHubOrder = [
        ...reorderedHubs,
        ...unmanagedBuiltInHubs.map(hub => convertHubConfigsToCollectionConfigs([hub])[0])
      ];

      // Immediately update local state for UI responsiveness
      if (completeHubOrder.length > 0) {
        const updatedLocalHubConfigs = [...localHubConfigs];
        completeHubOrder.forEach((config, index) => {
          if (config.type === 'hub') {
            const hubConfigIndex = updatedLocalHubConfigs.findIndex((h: any) => h.id === config.id);
            if (hubConfigIndex >= 0) {
              updatedLocalHubConfigs[hubConfigIndex] = {
                ...updatedLocalHubConfigs[hubConfigIndex],
                sortOrderLibrary: index, // Update sort order immediately
              };
            }
          }
        });
        setLocalHubConfigs(updatedLocalHubConfigs);
      }

      // Handle collection reordering (update collections with their position in the mixed list)
      if (reorderedCollections.length > 0) {
        // Create a version of reorderedCollections with updated sort orders based on mixed list positions
        const collectionsWithUpdatedOrder = reorderedCollections.map(collectionConfig => {
          // Find the position of this collection in the full mixed list
          const positionInMixedList = reorderedConfigs.findIndex(config => 
            config.id === collectionConfig.id && config.type === collectionConfig.type
          );
          
          // Update the appropriate sort order based on active tab
          if (activeTab === 'home' || activeTab === 'recommended') {
            // For Home/Recommended tabs, update the hub ordering (shared between both)
            return {
              ...collectionConfig,
              sortOrderHome: positionInMixedList >= 0 ? positionInMixedList : collectionConfig.sortOrderHome,
              // Keep existing library sort order unchanged
              sortOrderLibrary: collectionConfig.sortOrderLibrary
            };
          } else {
            // For Library tab, update the sort title ordering
            return {
              ...collectionConfig,
              sortOrderLibrary: positionInMixedList >= 0 ? positionInMixedList : collectionConfig.sortOrderLibrary,
              // Keep existing home sort order unchanged
              sortOrderHome: collectionConfig.sortOrderHome
            };
          }
        });
        
        const updatedCollectionConfigs = updateConfigsAfterReorder(localCollectionConfigs, libraryId, collectionsWithUpdatedOrder);
        const normalizedCollectionConfigs = normalizeConfigsForStorage(updatedCollectionConfigs);
        
        // Update local state immediately for UI responsiveness
        setLocalCollectionConfigs(updatedCollectionConfigs);
        
        await saveCollectionConfigs(normalizedCollectionConfigs, true); // Suppress notification for reorder
      }

      // Handle hub reordering (update hub configs with new sort order)
      // Use completeHubOrder instead of just reorderedHubs to include inactive hubs at bottom
      if (completeHubOrder.length > 0) {
        const updatedHubConfigs = [...localHubConfigs];
        
        // Update sort order for each hub based on its position in the complete hub order
        // This includes both active hubs (from reordering) and inactive built-in hubs (at bottom)
        completeHubOrder.forEach((config, index) => {
          if (config.type === 'hub') {
            const hubConfigIndex = updatedHubConfigs.findIndex((h: any) => h.id === config.id);
            if (hubConfigIndex >= 0) {
              if (activeTab === 'home' || activeTab === 'recommended') {
                // For Home/Recommended tabs, hubs use the hub ordering API (applied during sync)
                // We'll store this as sortOrderLibrary since hubs don't have a separate home ordering
                updatedHubConfigs[hubConfigIndex] = {
                  ...updatedHubConfigs[hubConfigIndex],
                  sortOrderLibrary: index, // This will be used for Plex hub reordering API
                };
              } else {
                // For Library tab, hubs would use sort title (but hubs can't change their titles)
                // So we still update sortOrderLibrary as it's the only ordering mechanism for hubs
                updatedHubConfigs[hubConfigIndex] = {
                  ...updatedHubConfigs[hubConfigIndex],
                  sortOrderLibrary: index,
                };
              }
            }
          }
        });

        // Save updated hub configs
        await axios.post('/api/v1/settings/hubs/configs', {
          hubConfigs: updatedHubConfigs,
        });
        
        // Hub reordering in Plex will happen during the next collections sync
        // The updated sortOrderLibrary values will be used by the sync process
        
        // Show notification if unmanaged hubs were moved to bottom
        if (unmanagedBuiltInHubs.length > 0) {
          addToast(`Moved ${unmanagedBuiltInHubs.length} unmanaged hub${unmanagedBuiltInHubs.length !== 1 ? 's' : ''} to bottom of list`, {
            autoDismiss: true,
            appearance: 'info',
          });
        }
        
        revalidateHubs(); // Refresh hub data
      }
    } catch (error) {
      // Failed to reorder collections/hubs
      addToast('Failed to save item order', {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  // Filter collections based on active tab
  const filteredConfigs = activeTab === 'home'
    ? allConfigs.filter(config => {
        // For hub configs, show them if they have any home visibility enabled
        if (config.type === 'hub') {
          return config.visibilityConfig?.usersHome || 
                 config.visibilityConfig?.serverOwnerHome;
        }
        // For regular collections, use existing logic
        return !(config.visibilityConfig?.libraryTabOnly || 
                (!config.visibilityConfig?.usersHome && !config.visibilityConfig?.serverOwnerHome && !config.visibilityConfig?.libraryRecommended)) && 
               !(config.type === 'overseerr' && config.subtype === 'users'); // Exclude user collections from Home tab
      })
    : activeTab === 'recommended'
    ? allConfigs.filter(config => {
        // For recommended tab, show items with libraryRecommended visibility
        if (config.type === 'hub') {
          return config.visibilityConfig?.libraryRecommended;
        }
        return config.visibilityConfig?.libraryRecommended;
      })
    : activeTab === 'library'
    ? allConfigs.filter(config => config.type !== 'hub') // Library tab: all collections but NO hubs
    : activeTab === 'unmanaged'
    ? allConfigs.filter(config => {
        // Unmanaged tab: custom collection hubs that don't have matching collections
        return config.type === 'hub' && config.isUnmanagedCollection;
      })
    : allConfigs.filter(config => {
        // Inactive tab: ONLY built-in Plex hubs with no visibility anywhere
        // Custom collections are never truly "inactive" - they always appear in Library tab
        if (config.type === 'hub') {
          // Custom collections (promoted collections) are never inactive
          if (config.isPromotedCollection) {
            return false;
          }
          // Only built-in Plex hubs can be inactive
          return !config.visibilityConfig?.usersHome && 
                 !config.visibilityConfig?.serverOwnerHome && 
                 !config.visibilityConfig?.libraryRecommended;
        }
        // For regular collections, show items with no visibility or library-only items
        return config.visibilityConfig?.libraryTabOnly || 
               (!config.visibilityConfig?.usersHome && !config.visibilityConfig?.serverOwnerHome && !config.visibilityConfig?.libraryRecommended);
      });
  

  // Get all Plex libraries for hub management (not just Overseerr-enabled ones)
  const allLibraries = libraries;

  // Group collections by library for display
  const libraryGroups = groupConfigsByLibrary(filteredConfigs, libraries, activeTab);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex space-x-3">
          <Button
            buttonType="primary"
            onClick={addCollectionConfig}
            className="flex items-center space-x-2"
          >
            <PlusIcon className="h-4 w-4" />
            <span>Add Collection</span>
          </Button>
          <Button
            buttonType="default"
            onClick={discoverPlexHubs}
            disabled={discoveringHubs}
            className="flex items-center space-x-2"
          >
            <MagnifyingGlassIcon className="h-4 w-4" />
            <span>{discoveringHubs ? 'Discovering...' : 'Discover Hubs'}</span>
          </Button>
        </div>
      </div>

      {/* Main Tabs for Home, Recommended, and Library */}
      <div className="border-b border-gray-700">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => {
              setActiveTab('home');
              setActiveLibraryId('');
            }}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'home'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300'
            }`}
          >
            Home
          </button>
          <button
            onClick={() => {
              setActiveTab('recommended');
              setActiveLibraryId(allLibraries[0]?.id || '');
            }}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'recommended'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300'
            }`}
          >
            Recommended
          </button>
          <button
            onClick={() => {
              setActiveTab('library');
              setActiveLibraryId(allLibraries[0]?.id || '');
            }}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'library'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300'
            }`}
          >
            Library
          </button>
          <button
            onClick={() => {
              setActiveTab('inactive');
              setActiveLibraryId('');
            }}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'inactive'
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300'
            }`}
          >
            Inactive
          </button>
          <button
            onClick={() => {
              setActiveTab('unmanaged');
              setActiveLibraryId('');
            }}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'unmanaged'
                ? 'border-red-500 text-red-400'
                : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300'
            }`}
          >
            Not Managed by Overseerr
          </button>
        </nav>
      </div>

      {/* Library Sub-tabs for Recommended and Library tabs (not Inactive or Unmanaged) */}
      {(activeTab === 'recommended' || activeTab === 'library') && (
        <div className="border-b border-gray-600 bg-gray-800/30">
          <nav className="-mb-px flex space-x-6 px-4 py-2">
            {allLibraries.map((library: Library) => {
              const libraryConfigs = libraryGroups.get(library.id) || [];
              const hasConfigs = libraryConfigs.length > 0;
              
              return (
                <button
                  key={library.id}
                  onClick={() => setActiveLibraryId(library.id)}
                  disabled={!hasConfigs}
                  className={`py-1 px-2 border-b-2 font-medium text-xs rounded-t-md ${
                    activeLibraryId === library.id
                      ? 'border-indigo-400 text-indigo-300 bg-gray-700/50'
                      : hasConfigs
                      ? 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-400 hover:bg-gray-700/30'
                      : 'border-transparent text-gray-600 cursor-not-allowed'
                  }`}
                >
                  {library.name}
                  {hasConfigs && (
                    <span className="ml-1 text-xs text-gray-500">({libraryConfigs.length})</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {/* Content based on active tab */}
      {librariesError ? (
        <div className="text-center py-8">
          <p className="text-red-400">Failed to load Plex libraries. Please check your Plex connection.</p>
        </div>
      ) : libraries.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-400">Loading Plex libraries...</p>
        </div>
      ) : libraryGroups.size === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-400">No collections configured. Click &quot;Add Collection&quot; to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {(activeTab === 'home' || activeTab === 'inactive') ? (
            // Home/Inactive tabs: Show all libraries with relevant configs
            allLibraries.map((library: Library) => {
              const libraryConfigs = libraryGroups.get(library.id) || [];
              if (libraryConfigs.length === 0) return null;
              
              return (
                <LibraryCollectionGroup
                  key={library.id}
                  library={library}
                  configs={libraryConfigs}
                  originalConfigs={localCollectionConfigs}
                  onEdit={editCollectionConfig}
                  onDelete={deleteCollectionConfig}
                  onReorder={handleReorderConfigs}
                  badgeClickCount={badgeClickCount}
                  setBadgeClickCount={setBadgeClickCount}
                  checkForUnlockSequence={checkForUnlockSequence}
                  activeTab={activeTab}
                />
              );
            })
          ) : (
            // Recommended/Library tabs: Show only the selected library
            activeLibraryId && libraryGroups.has(activeLibraryId) ? (
              <LibraryCollectionGroup
                key={activeLibraryId}
                library={allLibraries.find((lib: Library) => lib.id === activeLibraryId)!}
                configs={libraryGroups.get(activeLibraryId) || []}
                originalConfigs={localCollectionConfigs}
                onEdit={editCollectionConfig}
                onDelete={deleteCollectionConfig}
                onReorder={handleReorderConfigs}
                badgeClickCount={badgeClickCount}
                setBadgeClickCount={setBadgeClickCount}
                checkForUnlockSequence={checkForUnlockSequence}
                activeTab={activeTab}
              />
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-400">
                  {activeTab === 'recommended' 
                    ? 'No recommended collections found for this library.'
                    : 'No collections found for this library.'}
                </p>
              </div>
            )
          )}
        </div>
      )}

      {/* Collection/Hub Configuration Form Modal */}
      {showConfigForm && editingConfig && (
        editingConfig.type === 'hub' ? (
          <HubConfigForm
            config={editingConfig}
            onSave={saveCollectionConfig}
            onCancel={() => {
              setShowConfigForm(false);
              setEditingConfig(null);
            }}
          />
        ) : (
          <CollectionConfigForm
            config={editingConfig}
            libraries={libraries}
            onSave={saveCollectionConfig}
            onCancel={() => {
              setShowConfigForm(false);
              setEditingConfig(null);
            }}
          />
        )
      )}
    </div>
  );
};

export default CollectionSettings;
