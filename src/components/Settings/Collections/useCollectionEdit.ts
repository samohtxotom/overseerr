import { useState } from 'react';
import { useToasts } from 'react-toast-notifications';
import axios from 'axios';
import useSWR from 'swr';
import type { PlexSettings } from '@server/lib/settings';
import type { CollectionConfig } from './types';

/**
 * Shared hook for collection editing functionality
 * Used by both CollectionSettings and AllCollectionsView
 */
export const useCollectionEdit = () => {
  const { addToast } = useToasts();
  const { data, mutate: revalidate } = useSWR<PlexSettings>('/api/v1/settings/plex');
  const { mutate: revalidateHubs } = useSWR('/api/v1/settings/hubs/configs');

  // Form state
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<CollectionConfig | null>(null);

  // Get hub configs for cross-library hub detection
  const { data: hubData } = useSWR('/api/v1/settings/hubs/configs');
  const hubConfigs = hubData?.hubConfigs || [];

  const openEditModal = (config: CollectionConfig) => {
    console.log('useCollectionEdit: Opening edit modal with config:', config);
    
    if (!config) {
      console.error('useCollectionEdit: Received undefined config');
      return;
    }
    
    // Check if this is a hub config
    if (config.type === 'hub') {
      // Check if this is a hub that appears across multiple libraries (cross-library hub)
      const allHubsWithSameIdentifier = hubConfigs.filter((h: any) => 
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
          libraryNames: allLibraryNames,
          // Add flag to indicate this is a linked hub edit
          _isLinkedHub: true,
        } as any;
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

    // Regular collection editing
    setEditingConfig(config);
    setShowConfigForm(true);
  };

  const saveCollectionConfig = async (config: CollectionConfig) => {
    // Handle hub configs separately
    if (config.type === 'hub') {
      try {
        // Check if this is a linked hub (affects multiple libraries)
        const isLinkedHub = (config as any)._isLinkedHub || false;
        
        if (isLinkedHub) {
          // Update all hubs with the same hubIdentifier across multiple libraries
          const updatedHubConfigs = [...hubConfigs];
          
          // Find and update all hubs with the same hubIdentifier
          config.libraryIds?.forEach((libraryId) => {
            const hubIndex = updatedHubConfigs.findIndex((h: any) => 
              h.hubIdentifier === config.subtype && h.libraryId === libraryId
            );
            
            if (hubIndex >= 0) {
              // Convert back to individual hub config format
              updatedHubConfigs[hubIndex] = {
                ...updatedHubConfigs[hubIndex],
                name: config.name,
                visibilityConfig: config.visibilityConfig,
                // Keep individual library info
                libraryId: libraryId,
                libraryName: config.libraryNames?.[config.libraryIds?.indexOf(libraryId) || 0] || 'Unknown Library',
              };
            }
          });
          
          // Save all updated hub configs
          await axios.post('/api/v1/settings/hubs/configs', {
            hubConfigs: updatedHubConfigs,
          });
          
          addToast(`Linked hub configuration saved successfully across ${config.libraryIds?.length || 0} libraries!`, {
            appearance: 'success',
            autoDismiss: true,
          });
        } else {
          // Single hub update
          const updatedHubConfigs = hubConfigs.map((h: any) => 
            h.id === config.id 
              ? {
                  ...h,
                  name: config.name,
                  visibilityConfig: config.visibilityConfig,
                }
              : h
          );
          
          // Find existing hub config
          const existingHubIndex = updatedHubConfigs.findIndex((h: any) => h.id === config.id);
          if (existingHubIndex >= 0) {
            // Convert back to hub config format
            updatedHubConfigs[existingHubIndex] = {
              id: config.id,
              hubIdentifier: config.subtype,
              name: config.name,
              libraryId: config.libraryId,
              libraryName: config.libraryName,
              mediaType: config.mediaType === 'movie' ? 'movie' : config.mediaType === 'tv' ? 'tv' : 'both',
              sortOrderHome: config.sortOrderHome || 0,
              sortOrderLibrary: config.sortOrderLibrary,
              visibilityConfig: config.visibilityConfig,
              isDefaultPlexHub: config.isDefaultPlexHub,
              isAgregarrManaged: config.isAgregarrManaged,
              isPromotedToHub: config.isPromotedToHub,
            };
            
            // Save hub configs using hub API
            await axios.post('/api/v1/settings/hubs/configs', {
              hubConfigs: updatedHubConfigs,
            });
            
            addToast('Hub configuration saved successfully!', {
              appearance: 'success',
              autoDismiss: true,
            });
          }
        }
        
        await revalidateHubs();
      } catch (error) {
        console.error('Failed to save hub configuration:', error);
        addToast('Failed to save hub configuration', {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } else {
      // Handle regular collection configs
      try {
        const currentSettings = data!;
        const currentConfigs = currentSettings.collectionConfigs || [];
        
        let updatedConfigs: CollectionConfig[];
        if (config.id && typeof config.id === 'number' && currentConfigs.find(c => c.id === config.id)) {
          // Update existing config
          updatedConfigs = currentConfigs.map((existingConfig) =>
            existingConfig.id === config.id ? config : existingConfig
          );
        } else {
          // Add new config
          const maxId = currentConfigs.length > 0 
            ? Math.max(...currentConfigs.map(c => typeof c.id === 'number' ? c.id : 0))
            : 0;
          const newConfig = { ...config, id: maxId + 1 };
          updatedConfigs = [...currentConfigs, newConfig];
        }

        await axios.post('/api/v1/settings/plex/collections', {
          collectionConfigs: updatedConfigs,
        });

        await revalidate();
        addToast('Collection configuration saved successfully!', {
          appearance: 'success',
          autoDismiss: true,
        });
      } catch (error) {
        console.error('Failed to save collection configuration:', error);
        addToast('Failed to save collection configuration', {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    }

    // Close the form
    closeEditModal();
  };

  const closeEditModal = () => {
    setShowConfigForm(false);
    setEditingConfig(null);
  };

  return {
    // State
    showConfigForm,
    editingConfig,
    
    // Actions
    openEditModal,
    closeEditModal,
    saveCollectionConfig,
  };
};