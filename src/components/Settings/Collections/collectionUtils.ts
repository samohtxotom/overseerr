import type { CollectionConfig, Library } from './types';

/**
 * Frontend utility functions for collection configuration management
 */

/**
 * Group collection configurations by library for UI display
 * 
 * This function groups both regular configs and expanded configs by library,
 * ensuring proper display in the library-grouped UI.
 */
export function groupConfigsByLibrary(
  configs: CollectionConfig[],
  libraries: Library[],
  activeTab: 'home' | 'library' = 'home'
): Map<string, CollectionConfig[]> {
  const libraryGroups = new Map<string, CollectionConfig[]>();
  
  // First, handle configs with specific library IDs
  for (const config of configs) {
    if (config.libraryId && config.libraryId !== 'all') {
      // This is a config for a specific library
      if (!libraryGroups.has(config.libraryId)) {
        libraryGroups.set(config.libraryId, []);
      }
      libraryGroups.get(config.libraryId)!.push(config);
    } else if (config.libraryId === 'all' && !config.isExpandedConfig) {
      // This is a template config that applies to all libraries
      // For UI purposes, we show it under each compatible library
      const enabledLibraries = libraries.filter(lib => lib.enabled);
      
      for (const library of enabledLibraries) {
        // Check if library is compatible with config's media type
        if (isLibraryCompatible(library, config.mediaType)) {
          if (!libraryGroups.has(library.id)) {
            libraryGroups.set(library.id, []);
          }
          
          // Create a display version of the config for this library
          // For 'both' media types, we need to show the library-appropriate media type
          const librarySpecificMediaType = config.mediaType === 'both' 
            ? (library.type === 'movie' ? 'movie' : 'tv')
            : config.mediaType;
            
          // Create library-specific sort order keys
          const sortOrderHomeKey = `${library.id}_sortOrderHome` as keyof CollectionConfig;
          const sortOrderLibraryKey = `${library.id}_sortOrderLibrary` as keyof CollectionConfig;
          
          // Get library-specific sort orders
          const librarySpecificSortOrderHome = activeTab === 'home' 
            ? ((config as any)[sortOrderHomeKey] ?? config.sortOrderHome ?? 0)
            : (config.sortOrderHome ?? 0);
            
          const librarySpecificSortOrderLibrary = activeTab === 'library'
            ? ((config as any)[sortOrderLibraryKey] ?? config.sortOrderLibrary ?? 0)
            : ((config as any)[sortOrderLibraryKey] ?? config.sortOrderLibrary ?? 0);
            
          const displayConfig: CollectionConfig = {
            ...config,
            libraryId: library.id,
            libraryName: library.name,
            mediaType: librarySpecificMediaType, // Override with library-specific type
            sortOrderHome: librarySpecificSortOrderHome, // Use library-specific home sort order
            sortOrderLibrary: librarySpecificSortOrderLibrary, // Use library-specific library sort order
            // Mark as expanded for UI purposes but keep original ID
            isExpandedConfig: false, // We want to allow editing of the original
            name: processTemplateForLibrary(config, library, librarySpecificMediaType || 'both')
          };
          
          libraryGroups.get(library.id)!.push(displayConfig);
        }
      }
    }
  }
  
  // Sort configurations within each library by the appropriate sort order based on active tab
  for (const [libraryId, libraryConfigs] of Array.from(libraryGroups.entries())) {
    libraryConfigs.sort((a: CollectionConfig, b: CollectionConfig) => {
      let aSortOrder: number;
      let bSortOrder: number;
      
      if (activeTab === 'library') {
        aSortOrder = a.sortOrderLibrary ?? 0;
        bSortOrder = b.sortOrderLibrary ?? 0;
      } else {
        aSortOrder = a.sortOrderHome ?? 0;
        bSortOrder = b.sortOrderHome ?? 0;
      }
      
      return aSortOrder - bSortOrder;
    });
    libraryGroups.set(libraryId, libraryConfigs);
  }
  
  return libraryGroups;
}

/**
 * Update collection configurations after reordering within a library
 */
export function updateConfigsAfterReorder(
  originalConfigs: CollectionConfig[],
  libraryId: string,
  reorderedConfigs: CollectionConfig[]
): CollectionConfig[] {
  
  const updatedConfigs = [...originalConfigs];
  
  // Update the original configs with new sort orders
  for (const reorderedConfig of reorderedConfigs) {
    let originalIndex = -1;
    
    // Find the matching original config
    // The reorderedConfig might have a specific libraryId but the original might have 'all'
    originalIndex = updatedConfigs.findIndex(config => {
      // Exact match first (specific library configs)
      if (config.id === reorderedConfig.id && config.libraryId === reorderedConfig.libraryId) {
        return true;
      }
      
      // For display configs from 'all' library configs, match by original ID
      // The original config has libraryId: 'all', but the reordered config has a specific library ID
      if (config.id === reorderedConfig.id && config.libraryId === 'all') {
        return true;
      }
      
      return false;
    });
    
    
    if (originalIndex !== -1) {
      const originalConfig = updatedConfigs[originalIndex];
      
      if (originalConfig.libraryId === 'all') {
        // For 'all' configs, store library-specific sort orders
        const sortOrderHomeKey = `${libraryId}_sortOrderHome`;
        const sortOrderLibraryKey = `${libraryId}_sortOrderLibrary`;
        
        // Only update the sort order for the currently active tab
        const updatedConfig = { ...originalConfig };
        
        if (reorderedConfig.sortOrderHome !== undefined) {
          // Home tab reorder - update only home sort order
          updatedConfig[sortOrderHomeKey as keyof CollectionConfig] = reorderedConfig.sortOrderHome;
        }
        
        if (reorderedConfig.sortOrderLibrary !== undefined) {
          // Library tab reorder - update only library sort order  
          updatedConfig[sortOrderLibraryKey as keyof CollectionConfig] = reorderedConfig.sortOrderLibrary;
        }
        
        updatedConfigs[originalIndex] = updatedConfig;
      } else {
        // For specific library configs, update normally
        const updatedConfig = { ...originalConfig };
        
        // Only update the sort order for the currently active tab
        if (reorderedConfig.sortOrderHome !== undefined) {
          updatedConfig.sortOrderHome = reorderedConfig.sortOrderHome;
        }
        
        if (reorderedConfig.sortOrderLibrary !== undefined) {
          updatedConfig.sortOrderLibrary = reorderedConfig.sortOrderLibrary;
        }
        
        updatedConfigs[originalIndex] = updatedConfig;
      }
    }
  }
  
  
  return updatedConfigs;
}

/**
 * Convert between frontend display configs and backend storage configs
 */
export function normalizeConfigsForStorage(configs: CollectionConfig[]): CollectionConfig[] {
  
  // Remove any UI-specific properties and ensure proper structure
  const normalized = configs.map(config => {
    const cleanConfig = { ...config };
    delete cleanConfig.isExpandedConfig;
    return {
      ...cleanConfig,
      // Ensure sort orders are properly set
      sortOrderHome: config.sortOrderHome ?? 0,
      sortOrderLibrary: config.sortOrderLibrary ?? 0,
    };
  });
  
  
  return normalized;
}

/**
 * Generate IDs for expanded configurations
 */
export function generateExpandedId(parentId: number, libraryId: string): number {
  // Create a unique ID by combining parent ID with library ID hash
  const libraryHash = parseInt(libraryId) || libraryId.charCodeAt(0);
  return parentId * 1000 + libraryHash;
}

/**
 * Check if a library is compatible with the specified media type
 */
function isLibraryCompatible(library: Library, mediaType?: string): boolean {
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
 * Process template for library-specific display
 * Resolves template variables like {mediaType} based on the library type
 */
function processTemplateForLibrary(
  config: CollectionConfig,
  library: Library,
  librarySpecificMediaType: string
): string {
  let template = config.template;
  
  // Use custom templates if available for the specific media type
  if (librarySpecificMediaType === 'movie' && config.customMovieTemplate) {
    template = config.customMovieTemplate;
  } else if (librarySpecificMediaType === 'tv' && config.customTVTemplate) {
    template = config.customTVTemplate;
  }
  
  // Process template variables
  let processedName = template;
  
  // Replace {mediaType} with the proper form, handling the "s" suffix
  if (librarySpecificMediaType === 'movie') {
    // Handle both {mediaType} and {mediaType}s patterns
    processedName = processedName.replace('{mediaType}s', 'Movies');
    processedName = processedName.replace('{mediaType}', 'Movie');
  } else if (librarySpecificMediaType === 'tv') {
    // Handle both {mediaType} and {mediaType}s patterns  
    processedName = processedName.replace('{mediaType}s', 'TV Shows');
    processedName = processedName.replace('{mediaType}', 'TV Show');
  }
  
  // Replace other common template variables
  processedName = processedName.replace('{servername}', 'Tom-Server'); // Use the actual server name from settings
  processedName = processedName.replace('{customdays}', config.customDays?.toString() || '30');
  processedName = processedName.replace('{domain}', 'overseerr'); // This would come from settings in real implementation
  
  return processedName;
}


/**
 * Get enabled libraries that are compatible with a media type
 */
export function getCompatibleLibraries(libraries: Library[], mediaType?: string): Library[] {
  const enabledLibraries = libraries.filter(lib => lib.enabled);
  
  if (!mediaType || mediaType === 'both') {
    return enabledLibraries;
  }
  
  return enabledLibraries.filter(library => isLibraryCompatible(library, mediaType));
}

/**
 * Generate a consistent color for All Libraries badge based on collection ID
 */
export function getAllLibrariesBadgeColor(configId: number): string {
  // Generate consistent colors based on config ID
  const colors = [
    'bg-purple-500/40 text-purple-200',
    'bg-blue-500/40 text-blue-200', 
    'bg-green-500/40 text-green-200',
    'bg-yellow-500/40 text-yellow-200',
    'bg-pink-500/40 text-pink-200',
    'bg-indigo-500/40 text-indigo-200',
    'bg-red-500/40 text-red-200',
    'bg-teal-500/40 text-teal-200',
    'bg-orange-500/40 text-orange-200',
    'bg-cyan-500/40 text-cyan-200'
  ];
  
  return colors[configId % colors.length];
}

/**
 * Check if a config is an "All Libraries" config (expanded from a parent with libraryId: 'all')
 */
export function isAllLibrariesConfig(config: CollectionConfig, originalConfigs: CollectionConfig[]): boolean {
  // Check if there's an original config with the same ID but libraryId: 'all'
  return originalConfigs.some(orig => 
    orig.id === config.id && 
    orig.libraryId === 'all' && 
    config.libraryId !== 'all'
  );
}

/**
 * Validate that a configuration has all required fields for the new system
 */
export function validateCollectionConfig(config: CollectionConfig): string[] {
  const errors: string[] = [];
  
  if (!config.name?.trim()) {
    errors.push('Collection name is required');
  }
  
  if (!config.type) {
    errors.push('Collection type is required');
  }
  
  if (!config.subtype) {
    errors.push('Collection subtype is required');
  }
  
  if (!config.template?.trim()) {
    errors.push('Collection template is required');
  }
  
  if (config.maxItems <= 0) {
    errors.push('Max items must be greater than 0');
  }
  
  if (config.type === 'tautulli' && (!config.customDays || config.customDays <= 0)) {
    errors.push('Custom days is required for Tautulli collections');
  }
  
  if (config.type === 'trakt' && config.subtype === 'custom_list' && !config.traktCustomListUrl?.trim()) {
    errors.push('Trakt custom list URL is required for custom list collections');
  }
  
  if (config.type === 'letterboxd' && config.subtype === 'custom' && !config.letterboxdCustomListUrl?.trim()) {
    errors.push('Letterboxd custom list URL is required for custom list collections');
  }
  
  return errors;
}