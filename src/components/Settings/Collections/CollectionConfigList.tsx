import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import { PencilIcon, TrashIcon, PlusIcon, LinkIcon } from '@heroicons/react/24/solid';
import type { CollectionConfigListProps } from './types';
import { getAllLibrariesBadgeColor } from './collectionUtils';

const CollectionConfigList = ({
  configs,
  onEdit,
  onDelete,
  onAdd,
  badgeClickCount, // Used by parent for easter egg tracking, not read directly in this component
  setBadgeClickCount,
  checkForUnlockSequence,
}: CollectionConfigListProps & {
  badgeClickCount: number;
  setBadgeClickCount: (value: number | ((prev: number) => number)) => void;
  checkForUnlockSequence: () => void;
}) => {
  // Ensure badgeClickCount is "used" to satisfy linter - this is part of easter egg state management
  void badgeClickCount;
  
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

  const isLinkedCollection = (config: any) => {
    return config.libraryId === 'all' && !config.isExpandedConfig;
  };

  return (
    <div className="mb-6">
      <div className="space-y-3">
        {/* Existing Collections */}
        {configs.map((config) => (
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
                  {getCombinedTypeLabel(config.type || '', config.subtype)}
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
                  {getVisibilityLabel(config.visibilityConfig)}
                </Badge>
                {(() => {
                  const libraryDisplayName = config.libraryName ||
                    (config.mediaType === 'both'
                      ? 'All Libraries'
                      : config.mediaType === 'movie'
                      ? 'Movies'
                      : 'TV Shows');
                  
                  const isAllLibraries = libraryDisplayName === 'All Libraries';
                  
                  return (
                    <Badge 
                      badgeType="default" 
                      className={isAllLibraries 
                        ? getAllLibrariesBadgeColor(config.id)
                        : "!bg-opacity-30"
                      }
                    >
                      {libraryDisplayName}
                    </Badge>
                  );
                })()}
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
            <div className="flex items-center space-x-2">
              {isLinkedCollection(config) && (
                <div className="mr-1">
                  <LinkIcon className="h-4 w-4 text-gray-400" title="Linked Collection - applies to all compatible libraries" />
                </div>
              )}
              <Button
                buttonType="primary"
                onClick={() => onEdit(config)}
                className="min-w-fit"
                buttonSize="sm"
              >
                <PencilIcon className="h-4 w-4" />
              </Button>
              <ConfirmButton
                onClick={() => {
                  onDelete(config.id);
                }}
                confirmText={
                  <span className="whitespace-nowrap text-xs font-medium">
                    Delete
                  </span>
                }
                className="min-w-fit"
                buttonSize="sm"
              >
                <TrashIcon className="h-4 w-4" />
              </ConfirmButton>
            </div>
          </div>
        ))}

        {/* Add New Collection Card */}
        <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-gray-600 bg-gray-800/30 p-8 transition-colors hover:border-gray-500">
          <Button
            buttonType="ghost"
            onClick={onAdd}
            className="flex items-center space-x-2 text-gray-400 hover:text-white"
          >
            <PlusIcon className="h-5 w-5" />
            <span>Add Collection Configuration</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CollectionConfigList;