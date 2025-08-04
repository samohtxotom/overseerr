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
  onEdit: (config: CollectionConfig) => void;
  onDelete: (configId: number) => void;
  onReorder: (libraryId: string, newOrder: CollectionConfig[]) => void;
  badgeClickCount: number;
  setBadgeClickCount: (value: number | ((prev: number) => number)) => void;
  checkForUnlockSequence: () => void;
  activeTab: 'home' | 'library';
}

// SortableItem component for individual collection items
interface SortableItemProps {
  config: CollectionConfig;
  originalConfigs: CollectionConfig[];
  onEdit: (config: CollectionConfig) => void;
  onDelete: (configId: number) => void;
  setBadgeClickCount: (value: number | ((prev: number) => number)) => void;
  checkForUnlockSequence: () => void;
  getCombinedTypeLabel: (type: string, subtype: string) => string;
  getVisibilityLabel: (visibilityConfig?: { usersHome: boolean; serverOwnerHome: boolean; libraryRecommended: boolean; libraryTabOnly: boolean; }) => string;
}

const SortableItem = ({
  config,
  originalConfigs,
  onEdit,
  onDelete,
  setBadgeClickCount,
  checkForUnlockSequence,
  getCombinedTypeLabel,
  getVisibilityLabel,
}: SortableItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `${config.id}-${config.libraryId || 'all'}`,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
  };

  const isLinkedCollection = isAllLibrariesConfig(config, originalConfigs);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between rounded-lg border border-gray-600 bg-gray-700/50 p-4 transition-colors ${
        isDragging ? 'border-indigo-500 bg-gray-600/50' : 'hover:bg-gray-700/70'
      }`}
    >
      <div className="flex flex-1 items-center space-x-3">
        {/* Drag Handle */}
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab text-gray-400 hover:text-gray-300 active:cursor-grabbing"
        >
          <Bars3Icon className="h-5 w-5" />
        </div>

        {/* Collection Info */}
        <div className="flex-1">
          <div className="mb-2 flex items-center space-x-3">
            <h5 className="text-base font-medium text-white">
              {config.name || 'Unnamed Collection'}
            </h5>
            {config.isExpandedConfig && (
              <Badge badgeType="warning" className="!bg-opacity-40">
                Auto-generated
              </Badge>
            )}
          </div>
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
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center space-x-2">
        {isLinkedCollection && (
          <div className="mr-1">
            <LinkIcon className="h-4 w-4 text-gray-400" title="Linked Collection - applies to all compatible libraries" />
          </div>
        )}
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
      </div>
    </div>
  );
};

const LibraryCollectionGroup = ({
  library,
  configs,
  originalConfigs,
  onEdit,
  onDelete,
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
      const oldIndex = configs.findIndex(
        (config) => `${config.id}-${config.libraryId || 'all'}` === active.id
      );
      const newIndex = configs.findIndex(
        (config) => `${config.id}-${config.libraryId || 'all'}` === over?.id
      );

      const newConfigs = arrayMove(configs, oldIndex, newIndex);

      // Update the appropriate sort order based on active tab while preserving the other
      const updatedConfigs = newConfigs.map((config, index) => {
        if (activeTab === 'home') {
          return {
            ...config,
            sortOrderHome: index,
            // Preserve existing sortOrderLibrary
            sortOrderLibrary: config.sortOrderLibrary,
          };
        } else {
          return {
            ...config,
            sortOrderLibrary: index,
            // Preserve existing sortOrderHome
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
            items={configs.map((config) => `${config.id}-${config.libraryId || 'all'}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {configs.map((config) => (
                <SortableItem
                  key={`${config.id}-${config.libraryId || 'all'}`}
                  config={config}
                  originalConfigs={originalConfigs}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  setBadgeClickCount={setBadgeClickCount}
                  checkForUnlockSequence={checkForUnlockSequence}
                  getCombinedTypeLabel={getCombinedTypeLabel}
                  getVisibilityLabel={getVisibilityLabel}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
};

export default LibraryCollectionGroup;