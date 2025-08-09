import { getSettings, type CollectionConfig } from '@server/lib/settings';
import { LibraryConfigExpander } from './LibraryConfigExpander';
import logger from '@server/logger';

/**
 * Service for handling collection configuration expansion, validation, and processing order
 */
export class ConfigurationService {
  /**
   * Expand and validate collection configurations
   */
  public expandConfigurations(collectionConfigs: CollectionConfig[]): CollectionConfig[] {
    const appSettings = getSettings();
    return LibraryConfigExpander.expandConfigurations(
      collectionConfigs,
      appSettings.plex.libraries
    );
  }

  /**
   * Group expanded configurations by library
   */
  public groupByLibrary(expandedConfigs: CollectionConfig[]): Map<string, CollectionConfig[]> {
    return LibraryConfigExpander.groupByLibrary(expandedConfigs);
  }

  /**
   * Get processing order for library groups
   */
  public getProcessingOrder(libraryGroups: Map<string, CollectionConfig[]>): Array<[string, CollectionConfig[]]> {
    return LibraryConfigExpander.getProcessingOrder(libraryGroups);
  }

  /**
   * Validate collection configuration requirements
   */
  public validateConfiguration(config: CollectionConfig): boolean {
    // Basic validation
    if (!config.type || !config.subtype) {
      logger.warn(`Invalid configuration: missing type or subtype`, {
        label: 'Configuration Service',
        configId: config.id,
        configName: config.name,
      });
      return false;
    }

    // Type-specific validation
    switch (config.type) {
      case 'tautulli':
        if (!config.customDays || config.customDays <= 0) {
          logger.warn(`Tautulli configuration missing or invalid customDays`, {
            label: 'Configuration Service',
            configId: config.id,
            customDays: config.customDays,
          });
          return false;
        }
        break;

      case 'trakt':
        if (config.subtype === 'custom' && !config.traktCustomListUrl) {
          logger.warn(`Trakt custom configuration missing URL`, {
            label: 'Configuration Service',
            configId: config.id,
          });
          return false;
        }
        break;

      case 'tmdb':
        if (config.subtype === 'custom' && !config.tmdbCustomCollectionUrl) {
          logger.warn(`TMDb custom configuration missing URL`, {
            label: 'Configuration Service',
            configId: config.id,
          });
          return false;
        }
        break;

      case 'imdb':
        if (config.subtype === 'custom' && !config.imdbCustomListUrl) {
          logger.warn(`IMDb custom configuration missing URL`, {
            label: 'Configuration Service',
            configId: config.id,
          });
          return false;
        }
        break;

      case 'letterboxd':
        if (config.subtype === 'custom' && !config.letterboxdCustomListUrl) {
          logger.warn(`Letterboxd custom configuration missing URL`, {
            label: 'Configuration Service',
            configId: config.id,
          });
          return false;
        }
        break;
    }

    return true;
  }

  /**
   * Get configurations by type
   */
  public getConfigurationsByType(configs: CollectionConfig[], type: string): CollectionConfig[] {
    return configs.filter(config => config.type === type);
  }

  /**
   * Check if configurations require specific features
   */
  public hasOverseerrCollections(configs: CollectionConfig[]): boolean {
    return configs.some(c => c.type === 'overseerr');
  }

  public hasUserCollections(configs: CollectionConfig[]): boolean {
    return configs.some(c => c.type === 'overseerr' && c.subtype === 'users');
  }

  public hasUserLabelCollections(configs: CollectionConfig[]): boolean {
    return configs.some(c => 
      c.type === 'overseerr' && 
      (c.subtype === 'users' || c.subtype === 'server_owner')
    );
  }

  public hasServerOwnerCollections(configs: CollectionConfig[]): boolean {
    return configs.some(c => c.type === 'overseerr' && c.subtype === 'server_owner');
  }

  /**
   * Generate collection labels for cleanup
   */
  public generateActiveConfigLabels(configs: CollectionConfig[]): Set<string> {
    return new Set(
      configs.map((c) => {
        switch (c.type) {
          case 'overseerr':
            return c.subtype === 'users' ? `AgregarrOverseerrUser` : `AgregarrOverseerrAll`;
          case 'tautulli':
            return `AgregarrTautulli${c.id}`;
          case 'trakt':
            return `AgregarrTrakt${c.id}`;
          case 'tmdb':
            return `AgregarrTmdb${c.id}`;
          case 'imdb':
            return `AgregarrImdb${c.id}`;
          case 'letterboxd':
            return `AgregarrLetterboxd${c.id}`;
          default:
            return `Agregarr${c.type}${c.id}`;
        }
      })
    );
  }

  /**
   * Filter configurations by library compatibility
   */
  public filterConfigsByLibrary(configs: CollectionConfig[], libraryId: string): CollectionConfig[] {
    return configs.filter(config => {
      const libraryIds = config.libraryIds || (config.libraryId ? [config.libraryId] : []);
      const normalizedLibraryIds = Array.isArray(libraryIds) ? libraryIds : [libraryIds];
      
      return normalizedLibraryIds.includes(libraryId) || normalizedLibraryIds.includes('all');
    });
  }

  /**
   * Add sorting metadata to configurations
   */
  public addSortingMetadata(configs: CollectionConfig[], totalCollectionsInLibrary: number): CollectionConfig[] {
    return configs.map(config => ({
      ...config,
      _totalCollectionsInLibrary: totalCollectionsInLibrary,
    }));
  }
}

export default ConfigurationService;