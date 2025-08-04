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
      if (config.libraryId === 'all' && !config.isExpandedConfig) {
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
            libraryName: library.name,
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
              : config.mediaType
          };
          
          expandedConfigs.push(expandedConfig);
        }
      } else {
        // Regular config or already expanded config - add as-is
        expandedConfigs.push({
          ...config,
          // Ensure sort orders are set with defaults
          sortOrderHome: config.sortOrderHome ?? 0,
          sortOrderLibrary: config.sortOrderLibrary ?? 0
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
    const processableConfigs = configs.filter(config => 
      config.libraryId && config.libraryId !== 'all' && 
      (config.isExpandedConfig || !Object.prototype.hasOwnProperty.call(config, 'isExpandedConfig'))
    );
    
    for (const config of processableConfigs) {
      const libraryId = config.libraryId;
      if (!libraryId) continue;
      
      if (!libraryGroups.has(libraryId)) {
        libraryGroups.set(libraryId, []);
      }
      
      const libraryConfigs = libraryGroups.get(libraryId);
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