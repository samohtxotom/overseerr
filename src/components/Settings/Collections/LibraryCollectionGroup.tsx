import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import { PencilIcon, TrashIcon, Bars3Icon, LinkIcon } from '@heroicons/react/24/solid';
import type { CollectionConfig, Library } from './types';
import { isAllLibrariesConfig } from './collectionUtils';

interface LibraryCollectionGroupProps {
  library: Library;
  configs: CollectionConfig[];
  originalConfigs: CollectionConfig[];
  allHubConfigs?: any[]; // All hub configs for detecting linked hubs
  onEdit: (config: CollectionConfig) => void;
  onDelete: (configId: number | string) => void;
  onHide: (config: CollectionConfig) => void;
  onReorder: (libraryId: string, newOrder: CollectionConfig[]) => void;
  badgeClickCount: number;
  setBadgeClickCount: (value: number | ((prev: number) => number)) => void;
  checkForUnlockSequence: () => void;
  activeTab: 'home' | 'recommended' | 'library' | 'inactive' | 'unmanaged';
}

// SortableItem component for individual collection items
interface SortableItemProps {
  config: CollectionConfig;
  originalConfigs: CollectionConfig[];
  allHubConfigs?: any[]; // All hub configs for detecting linked hubs
  onEdit: (config: CollectionConfig) => void;
  onDelete: (configId: number | string) => void;
  onHide: (config: CollectionConfig) => void;
  setBadgeClickCount: (value: number | ((prev: number) => number)) => void;
  checkForUnlockSequence: () => void;
  getCombinedTypeLabel: (type: string, subtype: string) => string;
  getVisibilityLabel: (visibilityConfig?: { usersHome: boolean; serverOwnerHome: boolean; libraryRecommended: boolean; libraryTabOnly: boolean; }) => string;
  activeTab: 'home' | 'recommended' | 'library' | 'inactive' | 'unmanaged';
}

const SortableItem = ({
  config,
  originalConfigs,
  allHubConfigs,
  onEdit,
  onDelete,
  onHide,
  setBadgeClickCount,
  checkForUnlockSequence,
  getCombinedTypeLabel,
  getVisibilityLabel,
  activeTab,
}: SortableItemProps) => {
  const isLinkedCollection = isAllLibrariesConfig(config, originalConfigs);
  const isHub = config.type === 'hub';
  
  // Use the new cleaner categorization flags
  const isDefaultPlexHub = config.isDefaultPlexHub || false;
  const isAgregarrManaged = config.isAgregarrManaged || false;  
  const isPromotedToHub = config.isPromotedToHub || false;
  
  // Derive display categories from the flags
  const isPreExistingCollection = !isDefaultPlexHub && !isAgregarrManaged;
  
  // Check if this is a linked hub (appears across multiple libraries)
  const isLinkedHub = isHub && allHubConfigs ? 
    allHubConfigs.filter((h: any) => h.hubIdentifier === config.subtype).length > 1 : 
    false;
  
  // Check if this item can be linked (has unlinked siblings of same type)
  const canBeLinked = isHub && allHubConfigs ? 
    allHubConfigs.filter((h: any) => h.hubIdentifier === config.subtype).length > 1 && !isLinkedHub :
    !isLinkedCollection && originalConfigs.filter(c => c.type === config.type && c.subtype === config.subtype).length > 1;
  
  // Check if this item should be greyed out in Recommended tab
  // Items are greyed out if they're visible in Home tab (ordering controlled there)
  const isGreyedInRecommended = activeTab === 'recommended' && 
    (config.visibilityConfig?.usersHome || config.visibilityConfig?.serverOwnerHome);
  
  // Disable dragging for greyed out items
  const isDraggingDisabled = isGreyedInRecommended;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: (() => {
      if (isHub) {
        return config.id.toString();
      } else {
        const libraryId = Array.isArray(config.libraryId) ? config.libraryId[0] : (config.libraryId || 'all');
        return `${config.id}-${libraryId}`;
      }
    })(),
    disabled: isDraggingDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
  };
  // Different styling for hubs vs collections, with greyed out state
  const getContainerClasses = () => {
    const baseClasses = isHub
      ? 'flex items-center justify-between rounded-lg border px-4 py-2 transition-all'
      : 'flex items-center justify-between rounded-lg border p-4 transition-all';
    
    if (isGreyedInRecommended) {
      // Greyed out state for items controlled in Home tab
      return `${baseClasses} border-gray-700 bg-gray-800/30 opacity-60`;
    }
    
    if (isHub) {
      return `${baseClasses} border-gray-800 bg-gray-900/60 ${
        isDragging ? 'border-orange-500 bg-gray-800/60' : 'hover:bg-gray-900/80'
      }`;
    }
    
    return `${baseClasses} border-gray-600 bg-gray-700/50 ${
      isDragging ? 'border-indigo-500 bg-gray-600/50' : 'hover:bg-gray-700/70'
    }`;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={getContainerClasses()}
    >
      <div className="flex flex-1 items-center space-x-3">
        {/* Drag Handle */}
        <div
          {...(isDraggingDisabled ? {} : attributes)}
          {...(isDraggingDisabled ? {} : listeners)}
          className={`text-gray-400 h-5 w-5 flex items-center justify-center ${
            isDraggingDisabled 
              ? 'cursor-not-allowed opacity-50' 
              : 'cursor-grab hover:text-gray-300 active:cursor-grabbing'
          }`}
        >
          {isDraggingDisabled ? (
            <div className="h-5 w-5 rounded border border-gray-600 bg-gray-700/50" />
          ) : (
            <Bars3Icon className="h-5 w-5" />
          )}
        </div>

        {/* Collection/Hub Info */}
        <div className="flex-1">
          <div className={`flex items-center space-x-3 ${isHub ? 'mb-1' : 'mb-2'}`}>
            <h5 className={`text-white ${isHub ? 'text-base font-medium' : 'text-base font-medium'}`}>
              {config.name || 'Unnamed Collection'}
            </h5>
            {isHub && (
              <>
                {isDefaultPlexHub && (
                  <Badge badgeType="default" className="!bg-orange-500/20 !text-orange-300 text-xs">
                    Plex Default
                  </Badge>
                )}
                {isPreExistingCollection && !isPromotedToHub && (
                  <Badge badgeType="default" className="!bg-green-500/20 !text-green-300 text-xs">
                    Pre-Existing Collection
                  </Badge>
                )}
                {isPreExistingCollection && isPromotedToHub && (
                  <Badge badgeType="default" className="!bg-blue-500/20 !text-blue-300 text-xs">
                    Pre-Existing Collection (Promoted)
                  </Badge>
                )}
                {isAgregarrManaged && !isPromotedToHub && (
                  <Badge badgeType="default" className="!bg-indigo-500/20 !text-indigo-300 text-xs">
                    Agregarr Collection
                  </Badge>
                )}
                {isAgregarrManaged && isPromotedToHub && (
                  <Badge badgeType="default" className="!bg-purple-500/20 !text-purple-300 text-xs">
                    Agregarr Collection (Promoted)
                  </Badge>
                )}
                <Badge badgeType="default" className="!bg-gray-800/50 !text-gray-300 text-xs">
                  {getVisibilityLabel(config.visibilityConfig)}
                </Badge>
              </>
            )}
            {config.isExpandedConfig && (
              <Badge badgeType="warning" className="!bg-opacity-40">
                Auto-generated
              </Badge>
            )}
          </div>
          {!isHub && (
            <div className="flex flex-wrap items-center space-x-3">
              <Badge badgeType="primary" className="!bg-opacity-40">
                {getCombinedTypeLabel(config.type || '', config.subtype)}
              </Badge>
              {config.maxItems === 69 ? (
                <button
                  type="button"
                  onClick={() => {
                    setBadgeClickCount((prev) => {
                      const newCount = prev + 1;
                      if (newCount >= 10) {
                        checkForUnlockSequence();
                      }
                      return newCount;
                    });
                  }}
                  className="cursor-pointer"
                >
                  <Badge badgeType="success" className="!bg-opacity-40">
                    {config.maxItems} items
                  </Badge>
                </button>
              ) : (
                <Badge badgeType="default" className="!bg-opacity-30">
                  {config.maxItems} items
                </Badge>
              )}
              <Badge badgeType="default" className="!bg-opacity-30">
                {getVisibilityLabel(config.visibilityConfig)}
              </Badge>
              
              {/* Auto-Request Badges */}
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
              
              {/* Tautulli Days Badge */}
              {config.type === 'tautulli' &&
                config.customDays !== undefined &&
                config.customDays > 0 && (
                <Badge
                  badgeType="default"
                  className="!bg-opacity-30"
                >
                  {config.customDays} days
                </Badge>
              )}
            </div>
          )}
          
          {/* Greyed out message for Recommended tab */}
          {isGreyedInRecommended && (
            <div className="mt-1 flex items-center space-x-1 text-xs text-yellow-400">
              <div className="h-1 w-1 bg-yellow-400 rounded-full" />
              <span>Ordering controlled in Home tab</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center space-x-2">
        {(isLinkedCollection || isLinkedHub) && (
          <div className="mr-1">
            <LinkIcon 
              className="h-4 w-4 text-gray-400" 
              title={
                isLinkedHub 
                  ? "Linked Hub - applies to all compatible libraries" 
                  : "Linked Collection - applies to all compatible libraries"
              } 
            />
          </div>
        )}
        {isHub ? (
          // Limited actions for hubs - edit, link/unlink, and hide
          <>
            <Button
              buttonType="ghost"
              buttonSize="sm"
              onClick={() => onEdit(config)}
              className="text-orange-400 hover:text-orange-300"
            >
              <PencilIcon className={isHub ? 'h-3 w-3' : 'h-4 w-4'} />
            </Button>
            {activeTab !== 'inactive' && (
              <ConfirmButton
                confirmText="Hide"
                buttonSize="sm"
                buttonType="primary"
                onClick={() => onHide(config)}
              >
                <TrashIcon className="h-4 w-4" />
              </ConfirmButton>
            )}
          </>
        ) : (
          // Full actions for collections
          <>
            <Button
              buttonType="ghost"
              buttonSize="sm"
              onClick={() => onEdit(config)}
              disabled={config.isExpandedConfig} // Don't allow editing auto-generated configs
            >
              <PencilIcon className="h-4 w-4" />
            </Button>
            <ConfirmButton
              confirmText="Delete"
              buttonSize="sm"
              className="text-red-500 hover:bg-red-600 hover:text-white"
              onClick={() => onDelete(config.id)}
            >
              <TrashIcon className="h-4 w-4" />
            </ConfirmButton>
          </>
        )}
      </div>
    </div>
  );
};

const LibraryCollectionGroup = ({
  library,
  configs,
  originalConfigs,
  allHubConfigs,
  onEdit,
  onDelete,
  onHide,
  onReorder,
  badgeClickCount,
  setBadgeClickCount,
  checkForUnlockSequence,
  activeTab,
}: LibraryCollectionGroupProps) => {
  // Ensure badgeClickCount is "used" to satisfy linter - this is part of easter egg state management
  void badgeClickCount;
  
  const [isCollapsed, setIsCollapsed] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const getCombinedTypeLabel = (type: string, subtype: string) => {
    switch (type) {
      case 'overseerr':
        switch (subtype) {
          case 'users':
            return 'Overseerr - Individual Users';
          case 'server_owner':
            return 'Overseerr - Server Owner';
          case 'global':
            return 'Overseerr - All Requests';
          default:
            return `Overseerr - ${subtype}`;
        }
      case 'tautulli':
        switch (subtype) {
          case 'most_popular_plays':
            return 'Tautulli - Most Popular';
          case 'most_popular_duration':
            return 'Tautulli - Most Popular';
          case 'most_watched_plays':
            return 'Tautulli - Most Watched';
          case 'most_watched_duration':
            return 'Tautulli - Most Watched';
          default:
            return `Tautulli - ${subtype}`;
        }
      case 'trakt':
        switch (subtype) {
          case 'trending_7_days':
            return 'Trakt - Trending 7 days';
          case 'trending_30_days':
            return 'Trakt - Trending 30 days';
          case 'popular_week':
            return 'Trakt - Popular Week';
          case 'popular_month':
            return 'Trakt - Popular Month';
          case 'most_watched_week':
            return 'Trakt - Most Watched Week';
          case 'most_watched_month':
            return 'Trakt - Most Watched Month';
          case 'custom_list':
            return 'Trakt - Custom List';
          default:
            return `Trakt - ${subtype}`;
        }
      case 'imdb':
        switch (subtype) {
          case 'top_250':
            return 'IMDb - Top 250';
          case 'popular':
            return 'IMDb - Popular';
          case 'most_popular':
            return 'IMDb - Most Popular';
          case 'custom':
            return 'IMDb - Custom List';
          default:
            return `IMDb - ${subtype}`;
        }
      case 'tmdb':
        switch (subtype) {
          case 'custom':
            return 'TMDb - Custom Collection';
          case 'trending':
            return 'TMDb - Trending';
          case 'popular':
            return 'TMDb - Popular';
          default:
            return `TMDb - ${subtype}`;
        }
      case 'hub': {
        // For hub types, show a more user-friendly label
        const hubDisplayNames: Record<string, string> = {
          'movie.recentlyadded': 'Recently Added Movies',
          'movie.recentlyreleased': 'Recently Released Movies',
          'movie.curated': 'Seasonal Movies',
          'movie.topunwatched': 'Top Unwatched Movies',
          'movie.recentlyviewed': 'Recently Watched Movies',
          'tv.recentlyadded': 'Recently Added TV',
          'tv.recentlyaired': 'Recently Released Episodes',
          'tv.startwatching': 'Start Watching',
          'tv.rediscover': 'Rediscover',
          'tv.toprated': 'Top Rated TV',
          'tv.recentlyviewed': 'Recently Watched Episodes',
        };
        return hubDisplayNames[subtype] || `Plex Hub - ${subtype}`;
      }
      default:
        return `${type} - ${subtype}`;
    }
  };

  const getVisibilityLabel = (visibilityConfig?: { usersHome: boolean; serverOwnerHome: boolean; libraryRecommended: boolean; libraryTabOnly: boolean; }) => {
    if (!visibilityConfig) return 'Unknown';
    
    if (visibilityConfig.libraryTabOnly) {
      return 'Library Tab Only';
    }
    
    const visibilities = [];
    if (visibilityConfig.usersHome) visibilities.push('Users Home');
    if (visibilityConfig.serverOwnerHome) visibilities.push('Server Owner Home');
    if (visibilityConfig.libraryRecommended) visibilities.push('Library Recommended');
    
    if (visibilities.length === 0) {
      return 'Library Tab Only';
    }
    
    return visibilities.join(' + ');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = configs.findIndex((config) => {
        const isHub = config.type === 'hub';
        const dragId = isHub 
          ? config.id.toString()
          : `${config.id}-${Array.isArray(config.libraryId) ? config.libraryId[0] : (config.libraryId || 'all')}`;
        return dragId === active.id;
      });
      const newIndex = configs.findIndex((config) => {
        const isHub = config.type === 'hub';
        const dragId = isHub 
          ? config.id.toString()
          : `${config.id}-${Array.isArray(config.libraryId) ? config.libraryId[0] : (config.libraryId || 'all')}`;
        return dragId === over?.id;
      });


      const newConfigs = arrayMove(configs, oldIndex, newIndex);

      const updatedConfigs = newConfigs.map((config, index) => {
        if (activeTab === 'home' || activeTab === 'recommended') {
          return {
            ...config,
            sortOrderHome: index,
            sortOrderLibrary: config.sortOrderLibrary,
          };
        } else {
          return {
            ...config,
            sortOrderLibrary: index,
            sortOrderHome: config.sortOrderHome,
          };
        }
      });

      onReorder(library.id, updatedConfigs);
    }
  };

  if (configs.length === 0) {
    return null;
  }

  return (
    <div className="mb-6">
      {/* Library Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h4 className="text-lg font-medium text-white">{library.name}</h4>
          <Badge badgeType="default" className="!bg-opacity-30">
            {library.type === 'movie' ? 'Movies' : 'TV Shows'}
          </Badge>
          <Badge badgeType="default" className="!bg-opacity-20">
            {configs.length} collection{configs.length !== 1 ? 's' : ''}
          </Badge>
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-sm text-gray-400 hover:text-gray-300"
        >
          {isCollapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {/* Collections List */}
      {!isCollapsed && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={configs.map((config) => {
              const isHub = config.type === 'hub';
              return isHub 
                ? config.id.toString()
                : `${config.id}-${Array.isArray(config.libraryId) ? config.libraryId[0] : (config.libraryId || 'all')}`;
            })}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {configs.map((config) => {
                const isHub = config.type === 'hub';
                const keyId = isHub 
                  ? config.id.toString()
                  : `${config.id}-${Array.isArray(config.libraryId) ? config.libraryId[0] : (config.libraryId || 'all')}`;
                return (
                  <SortableItem
                    key={keyId}
                  config={config}
                  originalConfigs={originalConfigs}
                  allHubConfigs={allHubConfigs}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onHide={onHide}
                  setBadgeClickCount={setBadgeClickCount}
                  checkForUnlockSequence={checkForUnlockSequence}
                  getCombinedTypeLabel={getCombinedTypeLabel}
                  getVisibilityLabel={getVisibilityLabel}
                    activeTab={activeTab}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
};

export default LibraryCollectionGroup;