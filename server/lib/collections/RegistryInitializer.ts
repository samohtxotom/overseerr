import { collectionTypeRegistry } from './CollectionTypeRegistry';
import { SERVICE_FACTORIES, NAMING_STRATEGIES } from './ServiceFactories';
import logger from '@server/logger';

/**
 * Initialize the collection type registry with all available services and naming strategies
 * This replaces hardcoded switch statements with dynamic registration
 */
export function initializeCollectionRegistry(): void {
  try {
    logger.info('Initializing collection type registry...', {
      label: 'Registry Initializer',
    });

    // Register all collection services
    for (const [type, factory] of Object.entries(SERVICE_FACTORIES)) {
      collectionTypeRegistry.registerService(type, {
        factory,
        displayName: factory.getDisplayName(),
        supportedSubtypes: factory.getSupportedSubtypes(),
        description: `${factory.getDisplayName()} collection synchronization service`,
      });
    }

    // Register naming strategies
    
    // Default strategy (fallback for all types)
    collectionTypeRegistry.registerNamingStrategy('default', NAMING_STRATEGIES.default);
    
    // User-specific naming for Overseerr user collections
    collectionTypeRegistry.registerNamingStrategy('overseerr_users', NAMING_STRATEGIES.user);
    collectionTypeRegistry.registerNamingStrategy('overseerr_server_owner', NAMING_STRATEGIES.user);
    
    // Subtype-aware naming for services with descriptive subtypes
    collectionTypeRegistry.registerNamingStrategy('tautulli', NAMING_STRATEGIES.subtype);
    collectionTypeRegistry.registerNamingStrategy('trakt', NAMING_STRATEGIES.subtype);
    collectionTypeRegistry.registerNamingStrategy('tmdb', NAMING_STRATEGIES.subtype);
    collectionTypeRegistry.registerNamingStrategy('imdb', NAMING_STRATEGIES.subtype);
    
    // Standard naming for simpler services
    collectionTypeRegistry.registerNamingStrategy('letterboxd', NAMING_STRATEGIES.default);

    // Log initialization results
    const stats = collectionTypeRegistry.getStats();
    logger.info('Collection type registry initialization complete', {
      label: 'Registry Initializer',
      registeredTypes: stats.registeredTypes,
      namingStrategies: stats.namingStrategies,
      serviceDetails: stats.serviceDetails,
    });

    // Validate all registered services
    validateRegisteredServices();
    
  } catch (error) {
    logger.error('Failed to initialize collection type registry', {
      label: 'Registry Initializer',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Validate that all registered services can be created successfully
 */
function validateRegisteredServices(): void {
  const registeredTypes = collectionTypeRegistry.getRegisteredTypes();
  const validationResults: Array<{ type: string; success: boolean; error?: string }> = [];

  for (const type of registeredTypes) {
    try {
      // Attempt to create service to validate factory
      const service = collectionTypeRegistry.createService(type);
      
      // Validate service has required methods
      if (typeof service.processCollections !== 'function') {
        throw new Error('Service missing required processCollections method');
      }

      validationResults.push({ type, success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      validationResults.push({ 
        type, 
        success: false, 
        error: errorMessage 
      });
      
      logger.error(`Service validation failed for type: ${type}`, {
        label: 'Registry Initializer',
        type,
        error: errorMessage,
      });
    }
  }

  const failedServices = validationResults.filter(result => !result.success);
  
  if (failedServices.length > 0) {
    logger.warn(`${failedServices.length} collection services failed validation`, {
      label: 'Registry Initializer',
      failedServices: failedServices.map(s => ({ type: s.type, error: s.error })),
    });
  } else {
    logger.info('All collection services passed validation', {
      label: 'Registry Initializer',
      validatedServices: validationResults.length,
    });
  }

  // Clear cache after validation to avoid keeping test instances
  collectionTypeRegistry.clearCache();
}

/**
 * Get comprehensive registry information for debugging
 */
export function getRegistryInfo(): {
  stats: ReturnType<typeof collectionTypeRegistry.getStats>;
  supportedTypes: Array<{
    type: string;
    displayName: string;
    subtypes: string[];
    hasNamingStrategy: boolean;
  }>;
} {
  const stats = collectionTypeRegistry.getStats();
  const registeredTypes = collectionTypeRegistry.getRegisteredTypes();
  
  const supportedTypes = registeredTypes.map(type => {
    const info = collectionTypeRegistry.getServiceInfo(type);
    return {
      type,
      displayName: info?.displayName || 'Unknown',
      subtypes: info?.supportedSubtypes || [],
      hasNamingStrategy: !!collectionTypeRegistry['namingStrategies']?.has(type), // Access private member for debugging
    };
  });

  return {
    stats,
    supportedTypes,
  };
}

/**
 * Reset and reinitialize the registry (useful for testing or hot reloading)
 */
export function reinitializeRegistry(): void {
  logger.info('Reinitializing collection type registry...', {
    label: 'Registry Initializer',
  });

  collectionTypeRegistry.reset();
  initializeCollectionRegistry();
}

// Auto-initialize on module load
try {
  initializeCollectionRegistry();
} catch (error) {
  logger.error('Failed to auto-initialize collection registry', {
    label: 'Registry Initializer',
    error: error instanceof Error ? error.message : String(error),
  });
  
  // Don't throw here as it would prevent the module from loading
  // The error has been logged and individual operations will fail gracefully
}