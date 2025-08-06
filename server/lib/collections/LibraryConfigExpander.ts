import type { CollectionConfig } from '@server/lib/settings';
import type { Library } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Utility class to expand collection configurations with libraryId: "all"
 * into individual configurations for each enabled library
 */
export class LibraryConfigExpander {
  
  /**
   * Expand collection configurations to individual library configs
   * 
   * This transforms configs with libraryId: "all" into separate configs for each
   * enabled library, preserving the original config for UI display.
   * 
   * @param configs - Array of collection configurations
   * @param libraries - Array of available Plex libraries
   * @returns Expanded array of collection configurations
   */
  public static expandConfigurations(
    configs: CollectionConfig[], 
    libraries: Library[]
  ): CollectionConfig[] {
    const expandedConfigs: CollectionConfig[] = [];
    const enabledLibraries = libraries.filter(lib => lib.enabled);
    
    for (const config of configs) {
      // Handle both old libraryId format and new libraryIds array format
      const libraryIds = config.libraryIds || (config.libraryId ? (Array.isArray(config.libraryId) ? config.libraryId : [config.libraryId]) : []);
      const hasAllLibraries = libraryIds.includes('all') || config.libraryId === 'all';
      const hasSpecificLibraries = libraryIds.some(id => id !== 'all');
      
      if (hasAllLibraries && !config.isExpandedConfig) {
        // This is a template config that should create collections for all libraries
        // Keep the original config for UI purposes but mark it as a parent
        const parentConfig = { 
          ...config,
          // Don't process this config directly in sync
          isExpandedConfig: false 
        };
        expandedConfigs.push(parentConfig);
        
        // Create individual configs for each enabled library
        for (const library of enabledLibraries) {
          // Filter by media type compatibility
          if (!this.isLibraryCompatible(library, config.mediaType)) {
            continue;
          }
          
          const expandedConfig: CollectionConfig = {
            ...config,
            id: this.generateExpandedId(config.id, library.id),
            libraryId: library.id,
            libraryIds: [library.id], // Set single library in array format
            libraryName: library.name,
            libraryNames: [library.name], // Set single library name in array format
            parentConfigId: config.id,
            isExpandedConfig: true,
            // Set library sort orders based on library-specific sort orders
            sortOrderHome: (config as any)[`${library.id}_sortOrderHome`] ?? config.sortOrderHome ?? 0,
            sortOrderLibrary: (config as any)[`${library.id}_sortOrderLibrary`] ?? config.sortOrderLibrary ?? 0,
            // Update collection name to include library if needed
            name: this.generateLibrarySpecificName(config.name, library.name, config.mediaType),
            // Set specific media type based on library type when expanding 'both'
            mediaType: config.mediaType === 'both' 
              ? (library.type === 'show' ? 'tv' : 'movie')
              : config.mediaType,
            // Inherit rating keys from parent config
            collectionRatingKey: config.collectionRatingKeys?.[library.id] || config.collectionRatingKey,
            collectionRatingKeys: config.collectionRatingKeys,
          };
          
          expandedConfigs.push(expandedConfig);
        }
      } else if (hasSpecificLibraries) {
        // Config targets specific libraries - handle multiple libraries per config
        const specificLibraryIds = libraryIds.filter(id => id !== 'all');
        
        if (specificLibraryIds.length === 1) {
          // Single library - add as-is (backward compatibility)
          const targetLibrary = enabledLibraries.find(lib => lib.id === specificLibraryIds[0]);
          expandedConfigs.push({
            ...config,
            libraryId: specificLibraryIds[0], // Keep backward compatibility
            libraryIds: specificLibraryIds,
            libraryName: targetLibrary?.name || config.libraryName,
            libraryNames: targetLibrary ? [targetLibrary.name] : (config.libraryNames || []),
            // Ensure sort orders are set with defaults
            sortOrderHome: config.sortOrderHome ?? 0,
            sortOrderLibrary: config.sortOrderLibrary ?? 0
          });
        } else {
          // Multiple specific libraries - create separate config for each
          for (const libraryId of specificLibraryIds) {
            const targetLibrary = enabledLibraries.find(lib => lib.id === libraryId);
            if (!targetLibrary || !this.isLibraryCompatible(targetLibrary, config.mediaType)) {
              continue;
            }
            
            const expandedConfig: CollectionConfig = {
              ...config,
              id: this.generateExpandedId(config.id, libraryId),
              libraryId: libraryId, // Set for backward compatibility
              libraryIds: [libraryId], // Set single library in array
              libraryName: targetLibrary.name,
              libraryNames: [targetLibrary.name],
              parentConfigId: config.id,
              isExpandedConfig: true,
              // Set library sort orders based on library-specific sort orders
              sortOrderHome: (config as any)[`${libraryId}_sortOrderHome`] ?? config.sortOrderHome ?? 0,
              sortOrderLibrary: (config as any)[`${libraryId}_sortOrderLibrary`] ?? config.sortOrderLibrary ?? 0,
              // Update collection name to include library if needed for multi-library configs
              name: specificLibraryIds.length > 1 
                ? this.generateLibrarySpecificName(config.name, targetLibrary.name, config.mediaType)
                : config.name,
              // Set specific media type based on library type when expanding 'both'
              mediaType: config.mediaType === 'both' 
                ? (targetLibrary.type === 'show' ? 'tv' : 'movie')
                : config.mediaType,
              // Inherit rating keys from parent config
              collectionRatingKey: config.collectionRatingKeys?.[libraryId] || config.collectionRatingKey,
              collectionRatingKeys: config.collectionRatingKeys,
            };
            
            expandedConfigs.push(expandedConfig);
          }
        }
      } else {
        // Config has no library selection - this shouldn't happen with proper validation, but handle gracefully
        logger.warn(`Config ${config.id} has no library selection, skipping`, {
          label: 'Library Config Expander',
          configId: config.id,
          configName: config.name
        });
      }
    }
    
    logger.debug(`Expanded ${configs.length} configs to ${expandedConfigs.length} configs`, {
      label: 'Library Config Expander',
      originalCount: configs.length,
      expandedCount: expandedConfigs.length,
      enabledLibraries: enabledLibraries.length
    });
    
    return expandedConfigs;
  }
  
  /**
   * Group expanded configurations by library for processing
   * 
   * @param configs - Array of expanded collection configurations
   * @returns Map of libraryId to sorted configurations
   */
  public static groupByLibrary(configs: CollectionConfig[]): Map<string, CollectionConfig[]> {
    const libraryGroups = new Map<string, CollectionConfig[]>();
    
    // Process both expanded configs and regular library-specific configs
    const processableConfigs = configs.filter(config => {
      const libraryIds = config.libraryIds || (config.libraryId ? (Array.isArray(config.libraryId) ? config.libraryId : [config.libraryId]) : []);
      const hasSpecificLibraries = libraryIds.some(id => id !== 'all');
      const hasAllLibraries = libraryIds.includes('all') || config.libraryId === 'all';
      
      // Include configs that have specific libraries OR are expanded from 'all' configs
      return (hasSpecificLibraries || config.isExpandedConfig) && !(!config.isExpandedConfig && hasAllLibraries);
    });
    
    for (const config of processableConfigs) {
      // Handle both old and new library ID formats
      const libraryIds = config.libraryIds || (config.libraryId ? (Array.isArray(config.libraryId) ? config.libraryId : [config.libraryId]) : []);
      const specificLibraryIds = libraryIds.filter(id => id !== 'all');
      
      // Use the primary library ID (should be single after expansion)
      const primaryLibraryId = (typeof config.libraryId === 'string' && config.libraryId !== 'all') 
        ? config.libraryId 
        : specificLibraryIds[0];
      
      if (!primaryLibraryId) continue;
      
      if (!libraryGroups.has(primaryLibraryId)) {
        libraryGroups.set(primaryLibraryId, []);
      }
      
      const libraryConfigs = libraryGroups.get(primaryLibraryId);
      if (libraryConfigs) {
        libraryConfigs.push(config);
      }
    }
    
    // Sort configurations within each library by sortOrderHome
    for (const [libraryId, libraryConfigs] of libraryGroups.entries()) {
      libraryConfigs.sort((a, b) => (a.sortOrderHome ?? 0) - (b.sortOrderHome ?? 0));
      libraryGroups.set(libraryId, libraryConfigs);
    }
    
    return libraryGroups;
  }
  
  /**
   * Get processing order for libraries and their configurations
   * 
   * Since Plex displays collections newest-first, we need to reverse the order
   * within each library to achieve the desired home screen ordering.
   * 
   * @param libraryGroups - Map of library configurations
   * @returns Array of [libraryId, sortedConfigs] in processing order
   */
  public static getProcessingOrder(
    libraryGroups: Map<string, CollectionConfig[]>
  ): [string, CollectionConfig[]][] {
    const processingOrder: [string, CollectionConfig[]][] = [];
    
    for (const [libraryId, configs] of libraryGroups.entries()) {
      // Sort by sortOrderHome in ASCENDING order to match UI order
      // This way, if user wants order A(0) → B(1) → C(2) on home screen,
      // we create them in order A(0) → B(1) → C(2)
      const sortedConfigs = [...configs].sort((a, b) => (a.sortOrderHome ?? 0) - (b.sortOrderHome ?? 0));
      
      // DEBUG: Log processing order
      logger.debug(`Library ${libraryId} processing order:`, {
        label: 'Library Config Expander',
        libraryId,
        configs: sortedConfigs.map(c => ({
          id: c.id,
          name: c.name,
          sortOrderHome: c.sortOrderHome,
          sortOrderLibrary: c.sortOrderLibrary,
          type: c.type
        }))
      });
      processingOrder.push([libraryId, sortedConfigs]);
    }
    
    return processingOrder;
  }
  
  /**
   * Check if a library is compatible with the specified media type
   */
  private static isLibraryCompatible(library: Library, mediaType?: string): boolean {
    if (!mediaType || mediaType === 'both') {
      return true; // Compatible with all libraries
    }
    
    if (mediaType === 'movie' && library.type === 'movie') {
      return true;
    }
    
    if (mediaType === 'tv' && library.type === 'show') {
      return true;
    }
    
    return false;
  }
  
  /**
   * Generate a unique ID for expanded configurations
   */
  private static generateExpandedId(parentId: number, libraryId: string): number {
    // Create a unique ID by combining parent ID with library ID hash
    const libraryHash = parseInt(libraryId) || libraryId.charCodeAt(0);
    return parentId * 1000 + libraryHash;
  }
  
  /**
   * Generate library-specific collection names
   */
  private static generateLibrarySpecificName(
    baseName: string, 
    libraryName: string, 
    mediaType?: string
  ): string {
    // For single media type configs, append library name
    if (mediaType !== 'both') {
      return `${baseName} (${libraryName})`;
    }
    
    // For 'both' media types, the template engine will handle naming
    return baseName;
  }
}