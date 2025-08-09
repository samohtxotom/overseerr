import React, { useMemo } from 'react';
import { useIntl, defineMessages } from 'react-intl';
import useSWR from 'swr';
import type { PlexSettings } from '@server/lib/settings';
import type { CollectionConfig, Library } from './types';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Button from '@app/components/Common/Button';
import CollectionConfigForm from './CollectionConfigForm';
import { useCollectionEdit } from './useCollectionEdit';
import { PencilIcon } from '@heroicons/react/24/outline';

const messages = defineMessages({
  allCollectionsTitle: 'All Collections',
  allCollectionsDescription: 'Complete list of all collections, hubs, and media groups managed by Agregarr',
  loading: 'Loading collections...',
  noCollections: 'No collections found.',
  agregarrCollections: 'Agregarr Collections',
  plexHubs: 'Plex Hubs',
  preExistingCollections: 'Pre-existing Collections',
  totalCollections: '{count} total collections',
});

interface UnifiedCollection {
  id: string;
  name: string;
  type: 'agregarr' | 'hub' | 'preexisting';
  libraryName?: string;
  mediaType?: string;
  status?: string;
  itemCount?: number;
  originalConfig?: any;
}

const AllCollectionsView: React.FC = () => {
  const intl = useIntl();
  
  // Use the shared collection edit hook
  const { showConfigForm, editingConfig, openEditModal, closeEditModal, saveCollectionConfig } = useCollectionEdit();
  
  // Fetch all data sources
  const { data: plexSettings, error: plexError } = useSWR<PlexSettings>('/api/v1/settings/plex');
  const { data: libraries = [], error: librariesError } = useSWR('/api/v1/settings/plex/libraries');
  const { data: hubData, error: hubError } = useSWR('/api/v1/settings/hubs/configs');
  const { data: preExistingData, error: preExistingError } = useSWR('/api/v1/settings/plex/collections/preexisting');
  
  const isLoading = !plexSettings || !libraries || !hubData || !preExistingData;
  const hasError = plexError || librariesError || hubError || preExistingError;
  
  // Combine and transform all collection types
  const allCollections = useMemo((): UnifiedCollection[] => {
    if (!plexSettings || !libraries || !hubData || !preExistingData) return [];
    
    const collections: UnifiedCollection[] = [];
    
    // 1. Agregarr Collections (from collection configs)
    const collectionConfigs = plexSettings.collectionConfigs || [];
    collectionConfigs.forEach((config: CollectionConfig) => {
      // Handle multiple libraries
      if (config.libraryIds && Array.isArray(config.libraryIds)) {
        config.libraryIds.forEach((libraryId: string) => {
          const library = libraries.find((lib: Library) => lib.id === libraryId);
          collections.push({
            id: `agregarr-${config.id}-${libraryId}`,
            name: config.name,
            type: 'agregarr',
            libraryName: library?.name || 'Unknown Library',
            mediaType: config.mediaType || 'mixed',
            status: 'active',
            originalConfig: config,
          });
        });
      } else if (config.libraryId) {
        // Single library (backward compatibility)
        const library = libraries.find((lib: Library) => lib.id === config.libraryId);
        collections.push({
          id: `agregarr-${config.id}`,
          name: config.name,
          type: 'agregarr',
          libraryName: config.libraryName || library?.name || 'Unknown Library',
          mediaType: config.mediaType || 'mixed',
          status: 'active',
          originalConfig: config,
        });
      }
    });
    
    // 2. Plex Hubs (from hub configs)
    const hubConfigs = hubData.hubConfigs || [];
    hubConfigs.forEach((hub: any) => {
      const library = libraries.find((lib: Library) => lib.id === hub.libraryId);
      collections.push({
        id: `hub-${hub.id}`,
        name: hub.name || hub.hubIdentifier,
        type: 'hub',
        libraryName: hub.libraryName || library?.name || 'Unknown Library',
        mediaType: hub.mediaType || library?.type || 'mixed',
        status: hub.visibilityConfig?.usersHome || hub.visibilityConfig?.serverOwnerHome ? 'visible' : 'hidden',
        originalConfig: hub,
      });
    });
    
    // 3. Pre-existing Plex Collections (not managed by Agregarr)
    const preExistingCollections = preExistingData.collections || [];
    preExistingCollections.forEach((collection: any) => {
      const library = libraries.find((lib: Library) => lib.id === collection.libraryId);
      collections.push({
        id: `preexisting-${collection.id}`,
        name: collection.name,
        type: 'preexisting',
        libraryName: collection.libraryTitle || library?.name || 'Unknown Library',
        mediaType: library?.type || 'mixed',
        status: 'existing',
        itemCount: collection.itemCount,
        originalConfig: collection,
      });
    });
    
    // Sort alphabetically by name
    return collections.sort((a, b) => a.name.localeCompare(b.name));
  }, [plexSettings, libraries, hubData, preExistingData]);
  
  if (hasError) {
    return (
      <div className="text-center">
        <h3 className="text-lg font-medium text-red-400">Error Loading Collections</h3>
        <p className="text-gray-500 mt-2">Failed to load collection data. Please try refreshing the page.</p>
      </div>
    );
  }
  
  if (isLoading) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.allCollectionsTitle)} />
        <div className="mb-8">
          <h3 className="heading text-white">
            {intl.formatMessage(messages.allCollectionsTitle)}
          </h3>
          <p className="description">
            {intl.formatMessage(messages.allCollectionsDescription)}
          </p>
        </div>
        <LoadingSpinner />
      </>
    );
  }
  
  const getTypeDisplayName = (type: UnifiedCollection['type']) => {
    switch (type) {
      case 'agregarr': return intl.formatMessage(messages.agregarrCollections);
      case 'hub': return intl.formatMessage(messages.plexHubs);
      case 'preexisting': return intl.formatMessage(messages.preExistingCollections);
      default: return type;
    }
  };
  
  const getTypeColor = (type: UnifiedCollection['type']) => {
    switch (type) {
      case 'agregarr': return 'bg-indigo-600 text-white';
      case 'hub': return 'bg-blue-600 text-white';
      case 'preexisting': return 'bg-green-600 text-white';
      default: return 'bg-gray-600 text-white';
    }
  };
  
  const getStatusColor = (status: string | undefined) => {
    switch (status) {
      case 'active': return 'text-green-400';
      case 'visible': return 'text-green-400';
      case 'existing': return 'text-blue-400';
      case 'hidden': return 'text-orange-400';
      case 'inactive': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  // Convert UnifiedCollection back to CollectionConfig for editing
  const convertToEditableConfig = (collection: UnifiedCollection): CollectionConfig | null => {
    console.log('Converting collection to editable config:', collection);
    
    if (!collection.originalConfig) {
      console.error('No originalConfig found for collection:', collection);
      return null;
    }

    // For Agregarr collections
    if (collection.type === 'agregarr') {
      return collection.originalConfig as CollectionConfig;
    }

    // For hub items (both default Plex hubs and pre-existing collections)
    if (collection.type === 'hub') {
      const hubConfig = collection.originalConfig;
      return {
        id: hubConfig.id,
        name: hubConfig.name,
        type: 'hub' as any,
        subtype: hubConfig.hubIdentifier,
        template: hubConfig.name,
        customMovieTemplate: '',
        customTVTemplate: '',
        customPoster: undefined,
        visibilityConfig: hubConfig.visibilityConfig,
        maxItems: 0,
        mediaType: hubConfig.mediaType === 'movie' ? 'movie' : hubConfig.mediaType === 'tv' ? 'tv' : 'both',
        libraryId: hubConfig.libraryId,
        libraryName: hubConfig.libraryName,
        sortOrderHome: hubConfig.sortOrderHome || 0,
        sortOrderLibrary: hubConfig.sortOrderLibrary,
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
        isDefaultPlexHub: hubConfig.isDefaultPlexHub,
        isAgregarrManaged: hubConfig.isAgregarrManaged,
        isPromotedToHub: hubConfig.isPromotedToHub,
      } as CollectionConfig;
    }

    // Pre-existing collections can be edited with limited options
    if (collection.type === 'preexisting') {
      // Create a hub-like config for pre-existing collections
      return {
        id: collection.originalConfig.id || collection.id.replace('preexisting-', ''),
        name: collection.originalConfig.name,
        type: 'hub' as any,
        subtype: 'custom.collection',
        template: collection.originalConfig.name,
        customMovieTemplate: '',
        customTVTemplate: '',
        customPoster: undefined,
        visibilityConfig: {
          usersHome: false,
          serverOwnerHome: false,
          libraryRecommended: false,
          libraryTabOnly: true,
        },
        maxItems: 0,
        mediaType: 'both',
        libraryId: collection.originalConfig.libraryId,
        libraryName: collection.libraryName || 'Unknown Library',
        sortOrderHome: 0,
        sortOrderLibrary: 0,
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
        // Mark as pre-existing for limited editing
        isDefaultPlexHub: false,
        isAgregarrManaged: false,
        isPromotedToHub: false, // Pre-existing collections in library tab only
      } as CollectionConfig;
    }

    return null;
  };

  const handleEdit = (collection: UnifiedCollection) => {
    const editableConfig = convertToEditableConfig(collection);
    if (editableConfig && editableConfig.type) {
      console.log('Opening edit modal with config:', editableConfig);
      openEditModal(editableConfig);
    } else {
      console.error('Failed to convert collection to editable config:', collection);
    }
  };
  
  return (
    <>
      <PageTitle title={intl.formatMessage(messages.allCollectionsTitle)} />
      <div className="mb-8">
        <h3 className="heading text-white">
          {intl.formatMessage(messages.allCollectionsTitle)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.allCollectionsDescription)}
        </p>
        <p className="text-sm text-gray-400 mt-2">
          {intl.formatMessage(messages.totalCollections, { count: allCollections.length })}
        </p>
      </div>
      
      {allCollections.length === 0 ? (
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-gray-400">
            {intl.formatMessage(messages.noCollections)}
          </h3>
        </div>
      ) : (
        <div className="bg-gray-800 shadow rounded-lg overflow-hidden">
          <div className="divide-y divide-gray-700">
            {allCollections.map((collection) => (
              <div
                key={collection.id}
                className="px-6 py-4 hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getTypeColor(collection.type)}`}>
                        {getTypeDisplayName(collection.type)}
                      </span>
                      <h4 className="text-lg font-medium text-white truncate">
                        {collection.name}
                      </h4>
                      {collection.status && (
                        <span className={`text-sm font-medium ${getStatusColor(collection.status)}`}>
                          {collection.status}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center space-x-4 text-sm text-gray-400">
                      <span>
                        <strong>Library:</strong> {collection.libraryName}
                      </span>
                      {collection.mediaType && (
                        <span>
                          <strong>Type:</strong> {collection.mediaType}
                        </span>
                      )}
                      {collection.itemCount !== undefined && (
                        <span>
                          <strong>Items:</strong> {collection.itemCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      buttonType="ghost"
                      onClick={() => handleEdit(collection)}
                      className="p-2"
                      title="Edit Collection"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Collection Configuration Modal */}
      {showConfigForm && editingConfig && (
        <CollectionConfigForm
          config={editingConfig}
          onSave={saveCollectionConfig}
          onCancel={closeEditModal}
          libraries={libraries}
        />
      )}
    </>
  );
};

export default AllCollectionsView;