import React, { useState } from 'react';
import { useIntl, defineMessages } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import axios from 'axios';
import type { PlexSettings } from '@server/lib/settings';
import useSWR from 'swr';
import CollectionConfigForm from './CollectionConfigForm';
import LibraryCollectionGroup from './LibraryCollectionGroup';
import Button from '@app/components/Common/Button';
import { PlusIcon, MagnifyingGlassIcon, ArrowPathIcon } from '@heroicons/react/24/solid';
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

  // Tab state for Home, Recommended, Library, and Inactive tab ordering
  const [activeTab, setActiveTab] = useState<'home' | 'recommended' | 'library' | 'inactive'>('home');
  const [activeLibraryId, setActiveLibraryId] = useState<string>('');  // For sub-tabs

  // Badge click tracking (for easter eggs)
  const [badgeClickCount, setBadgeClickCount] = useState(0);

  // Hub discovery state
  const [discoveringHubs, setDiscoveringHubs] = useState(false);
  
  // Sync state
  const [syncing, setSyncing] = useState(false);

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
      id: hub.id,
      name: hub.name,
      type: 'hub' as any,
      subtype: hub.hubIdentifier,
      template: hub.name,
      customMovieTemplate: '',
      customTVTemplate: '',
      customPoster: undefined,
      visibilityConfig: hub.visibilityConfig,
      maxItems: 0,
      mediaType: hub.mediaType === 'movie' ? 'movie' : hub.mediaType === 'tv' ? 'tv' : 'both',
      libraryId: hub.libraryId,
      libraryName: hub.libraryName,
      sortOrderHome: hub.sortOrderHome || 0,
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
      // Use new cleaner categorization flags
      isDefaultPlexHub: hub.isDefaultPlexHub,
      isAgregarrManaged: hub.isAgregarrManaged,
      isPromotedToHub: hub.isPromotedToHub,
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

  const syncCollections = async () => {
    setSyncing(true);
    try {
      await axios.post('/api/v1/settings/plex/collections/sync');
      addToast('Collections sync started successfully!', {
        autoDismiss: true,
        appearance: 'success',
      });
    } catch (error) {
      addToast('Failed to start collections sync. Please try again.', {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setSyncing(false);
    }
  };

  const editCollectionConfig = (config: CollectionConfig) => {
    // Check if this is a hub config
    if (config.type === 'hub') {
      // Check if this is a hub that appears across multiple libraries (cross-library hub)
      // Find if there are other hubs with the same hubIdentifier (subtype) but different libraries
      const allHubsWithSameIdentifier = localHubConfigs.filter((h: any) => 
        h.hubIdentifier === config.subtype && h.id !== config.id
      );
      
      let configToEdit = config;
      
      // If this is part of a cross-library hub group, we need to edit them as a linked set
      if (allHubsWithSameIdentifier.length > 0) {
        // Create a parent config representing all libraries for this hub type
        const allLibraryIds = [config.libraryId, ...allHubsWithSameIdentifier.map((h: any) => h.libraryId)];
        const allLibraryNames = [config.libraryName, ...allHubsWithSameIdentifier.map((h: any) => h.libraryName)];
        
        configToEdit = {
          ...config,
          libraryId: 'all', // Special marker for cross-library editing
          libraryIds: allLibraryIds,
          libraryName: 'All Libraries',
          libraryNames: allLibraryNames,
          _isLinkedHub: true, // Flag to indicate this affects multiple libraries
        };
      }
      
      // Mark the config with its type for the form to render appropriately
      const hubConfig = {
        ...configToEdit,
        _isPreExistingCollection: !config.isDefaultPlexHub && !config.isAgregarrManaged,
        _isDefaultPlexHub: config.isDefaultPlexHub || false,
        _isAgregarrManaged: config.isAgregarrManaged || false
      };
      setEditingConfig(hubConfig);
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

  const hideHubConfig = async (config: CollectionConfig) => {
    if (config.type !== 'hub') {
      return;
    }

    // Check for linked hubs (same hubIdentifier across multiple libraries)
    const allHubsWithSameIdentifier = localHubConfigs.filter((h: any) => 
      h.hubIdentifier === config.subtype && h.id !== config.id
    );
    
    const isLinkedHub = allHubsWithSameIdentifier.length > 0;

    // Update all hubs with the same identifier (linked hubs) or just this one
    const hubsToUpdate = isLinkedHub 
      ? localHubConfigs.filter((h: any) => h.hubIdentifier === config.subtype)
      : localHubConfigs.filter((h: any) => h.id === config.id);

    const updatedHubConfigs = localHubConfigs.map((h: any) => {
      const shouldUpdate = hubsToUpdate.some((hub: any) => hub.id === h.id);
      return shouldUpdate
        ? {
            ...h,
            visibilityConfig: {
              usersHome: false,
              serverOwnerHome: false,
              libraryRecommended: false,
              libraryTabOnly: false,
            }
          }
        : h;
    });

    try {
      // Update local state immediately
      setLocalHubConfigs(updatedHubConfigs);
      
      await axios.post('/api/v1/settings/hubs/configs', {
        hubConfigs: updatedHubConfigs,
      });
      revalidateHubs();
      
      const message = isLinkedHub 
        ? `Linked hub hidden across ${hubsToUpdate.length} libraries successfully`
        : 'Hub hidden successfully';
        
      addToast(message, {
        autoDismiss: true,
        appearance: 'success',
      });
    } catch (error) {
      // Rollback on error
      setLocalHubConfigs(localHubConfigs);
      const errorMessage = isLinkedHub 
        ? 'Failed to hide linked hubs'
        : 'Failed to hide hub';
        
      addToast(errorMessage, {
        autoDismiss: true,
        appearance: 'error',
      });
    }
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
        // Check if this is a linked hub (affects multiple libraries)
        const isLinkedHub = (config as any)._isLinkedHub || false;
        
        if (isLinkedHub && config.libraryIds && Array.isArray(config.libraryIds)) {
          // This is a linked hub - update all related hubs across different libraries
          const updatedHubConfigs = [...localHubConfigs];
          
          // Find and update all hubs with the same hubIdentifier
          config.libraryIds.forEach((libraryId) => {
            const hubIndex = updatedHubConfigs.findIndex((h: any) => 
              h.hubIdentifier === config.subtype && h.libraryId === libraryId
            );
            
            if (hubIndex >= 0) {
              // Update the existing hub config
              updatedHubConfigs[hubIndex] = {
                ...updatedHubConfigs[hubIndex],
                visibilityConfig: config.visibilityConfig,
                customPoster: config.customPoster,
                timeRestriction: config.timeRestriction,
              };
            }
          });
          
          // Update local state immediately
          setLocalHubConfigs(updatedHubConfigs);
          
          // Save all updated hub configs
          await axios.post('/api/v1/settings/hubs/configs', {
            hubConfigs: updatedHubConfigs,
          });
          
          addToast(`Linked hub configuration saved successfully across ${config.libraryIds.length} libraries!`, {
            autoDismiss: true,
            appearance: 'success',
          });
        } else {
          // This is a single hub - update just this one
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
              customPoster: config.customPoster,
              timeRestriction: config.timeRestriction,
            };
            
            // Update local state immediately
            setLocalHubConfigs(updatedHubConfigs);
            
            // Save hub configs using hub API
            await axios.post('/api/v1/settings/hubs/configs', {
              hubConfigs: updatedHubConfigs,
            });
            
            addToast('Hub configuration saved successfully!', {
              autoDismiss: true,
              appearance: 'success',
            });
          }
        }
        
        revalidateHubs();
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
      // Find unmanaged hubs and add to bottom
      const reorderedHubIds = reorderedConfigs.filter(config => config.type === 'hub').map(h => h.id);
      const allLibraryHubs = localHubConfigs.filter((h: any) => h.libraryId === libraryId);
      const unmanagedBuiltInHubs = allLibraryHubs.filter((hub: any) => {
        const isBuiltIn = hub.isDefaultPlexHub;
        const notInReorderedList = !reorderedHubIds.includes(hub.id);
        return isBuiltIn && notInReorderedList;
      });

      const completeReorderedConfigs = [
        ...reorderedConfigs,
        ...unmanagedBuiltInHubs.map((hub: any) => convertHubConfigsToCollectionConfigs([hub])[0])
      ];

      // Update collections
      const reorderedCollections = reorderedConfigs.filter(config => config.type !== 'hub');
      if (reorderedCollections.length > 0) {
        const collectionsWithUpdatedOrder = reorderedCollections.map(collectionConfig => {
          const positionInMixedList = completeReorderedConfigs.findIndex(config => 
            config.id === collectionConfig.id && config.type === collectionConfig.type
          );
          
          if (activeTab === 'home' || activeTab === 'recommended') {
            return {
              ...collectionConfig,
              sortOrderHome: positionInMixedList >= 0 ? positionInMixedList : collectionConfig.sortOrderHome,
              sortOrderLibrary: collectionConfig.sortOrderLibrary
            };
          } else {
            return {
              ...collectionConfig,
              sortOrderLibrary: positionInMixedList >= 0 ? positionInMixedList : collectionConfig.sortOrderLibrary,
              sortOrderHome: collectionConfig.sortOrderHome
            };
          }
        });
        
        const updatedCollectionConfigs = updateConfigsAfterReorder(localCollectionConfigs, libraryId, collectionsWithUpdatedOrder);
        const normalizedCollectionConfigs = normalizeConfigsForStorage(updatedCollectionConfigs);
        
        setLocalCollectionConfigs(updatedCollectionConfigs);
        await saveCollectionConfigs(normalizedCollectionConfigs, true);
      }

      // Update hubs
      const reorderedHubs = reorderedConfigs.filter(config => config.type === 'hub');
      if (reorderedHubs.length > 0 || unmanagedBuiltInHubs.length > 0) {
        const updatedHubConfigs = [...localHubConfigs];
        
        completeReorderedConfigs.filter(config => config.type === 'hub').forEach((config) => {
          const positionInMixedList = completeReorderedConfigs.findIndex(c => 
            c.id === config.id && c.type === config.type
          );
          
          const hubConfigIndex = updatedHubConfigs.findIndex((h: any) => h.id === config.id);
          if (hubConfigIndex >= 0 && positionInMixedList >= 0) {
            if (activeTab === 'home' || activeTab === 'recommended') {
              updatedHubConfigs[hubConfigIndex] = {
                ...updatedHubConfigs[hubConfigIndex],
                sortOrderHome: positionInMixedList,
              };
            } else {
              updatedHubConfigs[hubConfigIndex] = {
                ...updatedHubConfigs[hubConfigIndex],
                sortOrderLibrary: positionInMixedList,
              };
            }
          }
        });

        setLocalHubConfigs(updatedHubConfigs);
        await axios.post('/api/v1/settings/hubs/configs', { hubConfigs: updatedHubConfigs });
        
        if (unmanagedBuiltInHubs.length > 0) {
          addToast(`Moved ${unmanagedBuiltInHubs.length} unmanaged hub${unmanagedBuiltInHubs.length !== 1 ? 's' : ''} to bottom of list`, {
            autoDismiss: true,
            appearance: 'info',
          });
        }
        
        revalidateHubs();
      }
    } catch (error) {
      addToast('Failed to save item order', {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  const unlinkCollectionConfig = async (config: CollectionConfig) => {
    try {
      if (config.type === 'hub') {
        // Handle hub unlinking
        const allHubsWithSameIdentifier = localHubConfigs.filter((h: any) => 
          h.hubIdentifier === config.subtype
        );
        
        if (allHubsWithSameIdentifier.length <= 1) {
          addToast('This hub is not linked to any other hubs.', {
            autoDismiss: true,
            appearance: 'info',
          });
          return;
        }

        // Show confirmation with list of affected hubs
        const affectedLibraries = allHubsWithSameIdentifier.map((h: any) => h.libraryName).join(', ');
        const confirmed = window.confirm(
          `Warning: Each hub's settings will need to be set individually after unlinking.\n\nThis will unlink hubs in the following libraries:\n${affectedLibraries}\n\nDo you want to continue?`
        );

        if (!confirmed) return;

        // Create separate configs for each linked hub
        const updatedHubConfigs = [...localHubConfigs];
        
        allHubsWithSameIdentifier.forEach((hub: any, index: number) => {
          // Keep the first one as is, modify the rest to be unlinked
          if (index > 0) {
            const hubIndex = updatedHubConfigs.findIndex((h: any) => h.id === hub.id);
            if (hubIndex >= 0) {
              updatedHubConfigs[hubIndex] = {
                ...hub,
                // Reset to default settings for unlinked hubs
                visibilityConfig: {
                  usersHome: false,
                  serverOwnerHome: false,
                  libraryRecommended: false,
                  libraryTabOnly: false,
                }
              };
            }
          }
        });

        setLocalHubConfigs(updatedHubConfigs);
        await axios.post('/api/v1/settings/hubs/configs', {
          hubConfigs: updatedHubConfigs,
        });
        revalidateHubs();

        addToast(`Successfully unlinked ${allHubsWithSameIdentifier.length} hubs. Each can now be configured individually.`, {
          autoDismiss: true,
          appearance: 'success',
        });
      } else {
        // Handle collection unlinking
        const linkedConfigs = localCollectionConfigs.filter(c => 
          c.id === config.id || (c.type === config.type && c.subtype === config.subtype && c.libraryId === 'all')
        );
        
        if (linkedConfigs.length <= 1) {
          addToast('This collection is not linked to any other collections.', {
            autoDismiss: true,
            appearance: 'info',
          });
          return;
        }

        const confirmed = window.confirm(
          'Warning: Each collection\'s settings will need to be set individually after unlinking.\n\nDo you want to continue?'
        );

        if (!confirmed) return;

        // Find the 'all' config and create separate configs for each library
        const allConfig = linkedConfigs.find(c => c.libraryId === 'all');
        if (!allConfig) {
          addToast('Could not find parent configuration to unlink.', {
            autoDismiss: true,
            appearance: 'error',
          });
          return;
        }

        // Remove the 'all' config and create individual configs for each compatible library
        const updatedConfigs = localCollectionConfigs.filter(c => c.id !== allConfig.id);
        
        const compatibleLibraries = libraries.filter((lib: any) => {
          if (!allConfig.mediaType || allConfig.mediaType === 'both') return true;
          if (allConfig.mediaType === 'movie' && lib.type === 'movie') return true;
          if (allConfig.mediaType === 'tv' && lib.type === 'show') return true;
          return false;
        });

        let newId = Math.max(...localCollectionConfigs.map(c => typeof c.id === 'number' ? c.id : 0)) + 1;
        
        compatibleLibraries.forEach((library: any) => {
          const newConfig: CollectionConfig = {
            ...allConfig,
            id: newId++,
            libraryId: library.id,
            libraryName: library.name,
            mediaType: allConfig.mediaType === 'both' ? 
              (library.type === 'movie' ? 'movie' : 'tv') : 
              allConfig.mediaType,
            // Reset visibility to default for unlinked collections
            visibilityConfig: {
              usersHome: true,
              serverOwnerHome: true,
              libraryRecommended: false,
              libraryTabOnly: false
            }
          };
          updatedConfigs.push(newConfig);
        });

        setLocalCollectionConfigs(updatedConfigs);
        await saveCollectionConfigs(updatedConfigs, true);

        addToast(`Successfully unlinked collection into ${compatibleLibraries.length} separate collections. Each can now be configured individually.`, {
          autoDismiss: true,
          appearance: 'success',
        });
      }
    } catch (error) {
      addToast('Failed to unlink collection/hub.', {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  const linkCollectionConfig = async (config: CollectionConfig) => {
    try {
      if (config.type === 'hub') {
        // Handle hub linking
        const allHubsWithSameIdentifier = localHubConfigs.filter((h: any) => 
          h.hubIdentifier === config.subtype
        );
        
        if (allHubsWithSameIdentifier.length <= 1) {
          addToast('No other hubs found with the same type to link to.', {
            autoDismiss: true,
            appearance: 'info',
          });
          return;
        }

        // Show confirmation with list of hubs to be linked
        const affectedLibraries = allHubsWithSameIdentifier.map((h: any) => h.libraryName).join(', ');
        const confirmed = window.confirm(
          `Warning: Settings on this page will be applied to all linked hubs.\n\nThis will link hubs in the following libraries:\n${affectedLibraries}\n\nDo you want to continue?`
        );

        if (!confirmed) return;

        // Apply the current hub's settings to all hubs with the same identifier
        const updatedHubConfigs = [...localHubConfigs];
        
        allHubsWithSameIdentifier.forEach((hub: any) => {
          const hubIndex = updatedHubConfigs.findIndex((h: any) => h.id === hub.id);
          if (hubIndex >= 0) {
            updatedHubConfigs[hubIndex] = {
              ...hub,
              visibilityConfig: config.visibilityConfig,
              customPoster: config.customPoster,
              timeRestriction: config.timeRestriction,
            };
          }
        });

        setLocalHubConfigs(updatedHubConfigs);
        await axios.post('/api/v1/settings/hubs/configs', {
          hubConfigs: updatedHubConfigs,
        });
        revalidateHubs();

        addToast(`Successfully linked ${allHubsWithSameIdentifier.length} hubs. Changes will now apply to all linked hubs.`, {
          autoDismiss: true,
          appearance: 'success',
        });
      } else {
        // Handle collection linking
        const similarConfigs = localCollectionConfigs.filter(c => 
          c.type === config.type && c.subtype === config.subtype && c.id !== config.id
        );
        
        if (similarConfigs.length === 0) {
          addToast('No other collections found with the same type to link to.', {
            autoDismiss: true,
            appearance: 'info',
          });
          return;
        }

        const affectedLibraries = similarConfigs.map(c => c.libraryName).join(', ');
        const confirmed = window.confirm(
          `Warning: Settings on this page will be applied to all linked collections.\n\nThis will link collections in the following libraries:\n${affectedLibraries}\n\nDo you want to continue?`
        );

        if (!confirmed) return;

        // Create a new 'all' config and remove the individual ones
        const allLibraries = [config, ...similarConfigs];
        const newAllConfig: CollectionConfig = {
          ...config,
          id: Math.max(...localCollectionConfigs.map(c => typeof c.id === 'number' ? c.id : 0)) + 1,
          libraryId: 'all',
          libraryName: 'All Libraries',
          mediaType: 'both', // Make it apply to both types when linked
        };

        const updatedConfigs = localCollectionConfigs.filter(c => 
          !allLibraries.some(linked => linked.id === c.id)
        );
        updatedConfigs.push(newAllConfig);

        setLocalCollectionConfigs(updatedConfigs);
        await saveCollectionConfigs(updatedConfigs, true);

        addToast(`Successfully linked ${allLibraries.length} collections. Changes will now apply to all linked collections.`, {
          autoDismiss: true,
          appearance: 'success',
        });
      }
    } catch (error) {
      addToast('Failed to link collection/hub.', {
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
    : allConfigs.filter(config => {
        // Inactive tab: ONLY built-in Plex hubs with no visibility anywhere
        // Custom collections are never truly "inactive" - they always appear in Library tab
        if (config.type === 'hub') {
          // Custom collections (promoted collections) are never inactive
          if (config.isAgregarrManaged || config.isPromotedToHub) {
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
        {(localCollectionConfigs.length > 0 || localHubConfigs.length > 0) && (
          <div>
            <Button
              buttonType="primary"
              onClick={syncCollections}
              disabled={syncing}
              className="flex items-center space-x-2"
            >
              <ArrowPathIcon className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : 'Sync Collections'}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Main Tabs for Home, Recommended, Library, and Inactive */}
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
        </nav>
        
        {/* Ordering Explanation */}
        <div className="px-4 py-2 text-xs text-gray-500 bg-gray-800/30 text-center">
          Collections in <strong>Home & Recommended</strong> share the same ordering (controls Plex home screen position), while <strong>Library</strong> has independent ordering for library tabs.
        </div>
      </div>

      {/* Library Sub-tabs for Recommended and Library tabs (not Inactive) */}
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
                  allHubConfigs={localHubConfigs}
                  onEdit={editCollectionConfig}
                  onDelete={deleteCollectionConfig}
                  onHide={hideHubConfig}
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
                allHubConfigs={localHubConfigs}
                onEdit={editCollectionConfig}
                onDelete={deleteCollectionConfig}
                onHide={hideHubConfig}
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

      {/* Bottom Sync Button */}
      {(localCollectionConfigs.length > 0 || localHubConfigs.length > 0) && (
        <div className="mt-8 flex justify-end">
          <Button
            buttonType="primary"
            onClick={syncCollections}
            disabled={syncing}
            className="flex items-center space-x-2 px-6 py-3"
          >
            <ArrowPathIcon className={`h-5 w-5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync Collections'}</span>
          </Button>
        </div>
      )}

      {/* Collection/Hub Configuration Form Modal */}
      {showConfigForm && editingConfig && (
        <CollectionConfigForm
          config={editingConfig}
          libraries={libraries}
          onSave={saveCollectionConfig}
          onCancel={() => {
            setShowConfigForm(false);
            setEditingConfig(null);
          }}
          onUnlink={unlinkCollectionConfig}
          onLink={linkCollectionConfig}
          allCollectionConfigs={localCollectionConfigs}
          allHubConfigs={localHubConfigs}
        />
      )}
    </div>
  );
};

export default CollectionSettings;
