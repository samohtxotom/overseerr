/**
 * Example showing how to use the new Collection Type Registry and Media Type Strategies
 * 
 * This file demonstrates the replacement of switch statements with registry patterns
 * and shows how to use the media type processing strategies to eliminate code duplication.
 */

import { collectionTypeRegistry } from './CollectionTypeRegistry';
import { mediaTypeProcessorFactory } from './MediaTypeStrategies';
import { dataFetchingStrategyFactory } from './DataFetchingStrategies';
import type { CollectionConfig } from '@server/lib/settings';
import type { CollectionItem } from './types';
import type PlexAPI from '@server/api/plexapi';
import logger from '@server/logger';

/**
 * OLD WAY: Switch statement for service creation (BEFORE registry)
 */
function createServiceOldWay(type: string) {
  switch (type) {
    case 'tautulli':
      return new (require('./TautulliCollectionSync').TautulliCollectionSync)();
    case 'overseerr':
      return new (require('./OverseerrCollectionSync').OverseerrCollectionSync)();
    case 'trakt':
      return new (require('./TraktCollectionSync').TraktCollectionSync)();
    case 'tmdb':
      return new (require('./TmdbCollectionSync').TmdbCollectionSync)();
    case 'imdb':
      return new (require('./ImdbCollectionSync').ImdbCollectionSync)();
    case 'letterboxd':
      return new (require('./LetterboxdCollectionSync').LetterboxdCollectionSync)();
    default:
      throw new Error(`Unknown collection type: ${type}`);
  }
}

/**
 * NEW WAY: Registry-based service creation (AFTER registry)
 */
function createServiceNewWay(type: string) {
  // Simple, extensible, and type-safe
  return collectionTypeRegistry.createService(type);
}

/**
 * Example: Processing collections with validation
 */
async function processCollectionWithValidation(config: CollectionConfig, plexClient: PlexAPI) {
  try {
    // Validate configuration before processing
    const validation = collectionTypeRegistry.validateConfig(config);
    
    if (!validation.valid) {
      logger.error('Invalid collection configuration', {
        configId: config.id,
        configName: config.name,
        errors: validation.errors,
      });
      return { created: 0, updated: 0, error: validation.errors.join(', ') };
    }

    // Log warnings
    if (validation.warnings.length > 0) {
      logger.warn('Configuration warnings detected', {
        configId: config.id,
        configName: config.name,
        warnings: validation.warnings,
      });
    }

    // Create service dynamically
    const service = collectionTypeRegistry.createService(config.type);
    
    // Process collections
    return await service.processCollections([config], plexClient, [], new Set());
    
  } catch (error) {
    logger.error('Failed to process collection', {
      configId: config.id,
      configName: config.name,
      error: error instanceof Error ? error.message : String(error),
    });
    
    return { 
      created: 0, 
      updated: 0, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * OLD WAY: Handling media types with duplicate logic (BEFORE strategies)
 */
async function processMediaTypesOldWay(
  items: CollectionItem[], 
  config: CollectionConfig,
  collectionSync: any,
  plexClient: PlexAPI,
  allCollections: any[]
) {
  let totalCreated = 0;
  let totalUpdated = 0;

  if (config.mediaType === 'both') {
    // Duplicate logic for splitting items
    const movieItems = items.filter(item => item.type === 'movie');
    const tvItems = items.filter(item => item.type === 'tv');

    // Duplicate logic for processing movies
    if (movieItems.length > 0) {
      const movieResult = await collectionSync.createOrUpdateCollectionStandardized(
        movieItems,
        `${config.name} Movies`,
        'movie',
        config,
        plexClient,
        allCollections,
        new Set()
      );
      totalCreated += movieResult.created || 0;
      totalUpdated += movieResult.updated || 0;
    }

    // Duplicate logic for processing TV
    if (tvItems.length > 0) {
      const tvResult = await collectionSync.createOrUpdateCollectionStandardized(
        tvItems,
        `${config.name} TV Shows`,
        'tv',
        config,
        plexClient,
        allCollections,
        new Set()
      );
      totalCreated += tvResult.created || 0;
      totalUpdated += tvResult.updated || 0;
    }
  } else {
    // Single media type processing
    const filteredItems = items.filter(item => item.type === config.mediaType);
    const result = await collectionSync.createOrUpdateCollectionStandardized(
      filteredItems,
      config.name,
      config.mediaType as 'movie' | 'tv',
      config,
      plexClient,
      allCollections,
      new Set()
    );
    totalCreated += result.created || 0;
    totalUpdated += result.updated || 0;
  }

  return { created: totalCreated, updated: totalUpdated };
}

/**
 * NEW WAY: Using media type processing strategies (AFTER strategies)
 */
async function processMediaTypesNewWay(
  items: CollectionItem[], 
  config: CollectionConfig,
  collectionSync: any,
  plexClient: PlexAPI,
  allCollections: any[]
) {
  // Get appropriate processor for the media type
  const processor = mediaTypeProcessorFactory.getProcessor(config.mediaType as any, collectionSync);
  
  // Create processing context
  const context = {
    plexClient,
    allCollections,
    processedCollectionKeys: new Set<string>(),
  };

  // Process using the strategy - no duplicate logic!
  return await processor.process(items, config, context);
}

/**
 * Example: Using data fetching strategies
 */
async function fetchDataWithStrategy(config: CollectionConfig, apiClient: any) {
  try {
    // Get appropriate data fetching strategy
    if (dataFetchingStrategyFactory.hasStrategy(config.type)) {
      const strategy = dataFetchingStrategyFactory.getStrategy(config.type, apiClient);
      
      // Fetch data using the strategy
      const data = await strategy.fetchData(config, {
        subtype: config.subtype || 'trending',
        timeWindow: 'week',
        page: 1,
      });
      
      logger.info(`Fetched ${data.length} items using ${config.type} strategy`, {
        configName: config.name,
        mediaType: config.mediaType,
        subtype: config.subtype,
      });
      
      return data;
    } else {
      throw new Error(`No data fetching strategy available for type: ${config.type}`);
    }
  } catch (error) {
    logger.error(`Data fetching failed for ${config.type}`, {
      configName: config.name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Example: Registry statistics and monitoring
 */
function logRegistryStats() {
  const stats = collectionTypeRegistry.getStats();
  
  logger.info('Collection Registry Statistics', {
    label: 'Registry Stats',
    registeredTypes: stats.registeredTypes,
    namingStrategies: stats.namingStrategies,
    cachedServices: stats.cachedServices,
    serviceDetails: stats.serviceDetails,
  });

  // Log available service types
  const availableTypes = collectionTypeRegistry.getRegisteredTypes();
  logger.info(`Available collection types: ${availableTypes.join(', ')}`, {
    label: 'Registry Stats',
  });

  // Log supported subtypes for each service
  for (const type of availableTypes) {
    const subtypes = collectionTypeRegistry.getSupportedSubtypes(type);
    const serviceInfo = collectionTypeRegistry.getServiceInfo(type);
    
    logger.info(`${type}: ${subtypes.join(', ')}`, {
      label: 'Registry Stats',
      displayName: serviceInfo?.displayName,
      deprecated: serviceInfo?.deprecated || false,
    });
  }
}

/**
 * Example: Dynamic collection name generation
 */
async function generateCollectionNameDynamically(config: CollectionConfig) {
  try {
    const context = {
      mediaType: config.mediaType as 'movie' | 'tv' | 'both',
      userInfo: {
        id: 1,
        name: 'admin',
        nickname: 'Admin',
      },
      libraryInfo: {
        id: '1',
        name: 'Movies',
      },
      templateVariables: {
        period: '7 days',
        count: '50',
      },
    };

    const name = await collectionTypeRegistry.generateCollectionName(config, context);
    
    logger.info(`Generated collection name: "${name}"`, {
      configName: config.name,
      configType: config.type,
      configSubtype: config.subtype,
    });
    
    return name;
  } catch (error) {
    logger.error('Failed to generate collection name', {
      configName: config.name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * BEFORE vs AFTER comparison summary:
 * 
 * BEFORE (Switch Statements + Duplicate Logic):
 * ✗ 15+ switch statements across different files
 * ✗ 200+ lines of duplicate media type processing logic
 * ✗ Hard to add new collection types
 * ✗ Difficult to test individual components
 * ✗ No validation or metadata support
 * ✗ Tight coupling between components
 * 
 * AFTER (Registry + Strategy Patterns):
 * ✓ Zero switch statements - fully registry-driven
 * ✓ Single implementation of media type processing
 * ✓ Easy to add new collection types without code changes
 * ✓ Individual strategies can be tested in isolation
 * ✓ Built-in validation and metadata support
 * ✓ Loose coupling with dependency injection
 * ✓ Runtime configuration and monitoring
 * ✓ Type safety and comprehensive error handling
 */

// Example configurations for testing
const exampleConfigs: CollectionConfig[] = [
  {
    id: 1,
    name: 'Trending Movies',
    type: 'tmdb',
    subtype: 'trending',
    mediaType: 'movie',
    libraryId: '1',
    template: 'Trending {period} Movies',
    visibilityConfig: {
      usersHome: true,
      serverOwnerHome: true,
      libraryRecommended: true,
      libraryTabOnly: false,
    },
    maxItems: 50,
    enabled: true,
  },
  {
    id: 2,
    name: 'User Collections',
    type: 'overseerr',
    subtype: 'users',
    mediaType: 'both',
    libraryId: 'all',
    template: "{nickname}'s Requests",
    visibilityConfig: {
      usersHome: true,
      serverOwnerHome: true,
      libraryRecommended: false,
      libraryTabOnly: false,
    },
    maxItems: 100,
    enabled: true,
  },
  {
    id: 3,
    name: 'Most Watched',
    type: 'tautulli',
    subtype: 'most_played_by_duration',
    mediaType: 'both',
    libraryId: '1',
    template: 'Most Watched {period}',
    customDays: 30,
    visibilityConfig: {
      usersHome: true,
      serverOwnerHome: true,
      libraryRecommended: true,
      libraryTabOnly: false,
    },
    maxItems: 25,
    enabled: true,
  },
];

export {
  createServiceNewWay,
  processCollectionWithValidation,
  processMediaTypesNewWay,
  fetchDataWithStrategy,
  logRegistryStats,
  generateCollectionNameDynamically,
  exampleConfigs,
};