import { BaseCollectionSync } from './BaseCollectionSync';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Collection Service Factory Interface
 * Defines how collection services are created
 */
export interface CollectionServiceFactory {
  create(): BaseCollectionSync;
  getDisplayName(): string;
  getSupportedSubtypes(): string[];
  getConfigurationSchema?(): any; // Future: JSON schema for validation
}

/**
 * Collection Service Registration Interface
 * Contains all metadata and factory for a collection type
 */
export interface CollectionServiceRegistration {
  factory: CollectionServiceFactory;
  displayName: string;
  supportedSubtypes: string[];
  description?: string;
  deprecated?: boolean;
  minimumVersion?: string;
}

/**
 * Collection Naming Strategy Interface
 * Handles generating collection names for different types and contexts
 */
export interface CollectionNamingStrategy {
  generateName(config: CollectionConfig, context: CollectionNamingContext): Promise<string>;
  canHandle(type: string, subtype?: string): boolean;
  getDefaultTemplate(mediaType: 'movie' | 'tv' | 'both'): string;
}

/**
 * Context information for collection naming
 */
export interface CollectionNamingContext {
  mediaType: 'movie' | 'tv' | 'both';
  userInfo?: {
    id: number | string;
    name: string;
    nickname?: string;
    plexId?: number | string;
  };
  libraryInfo?: {
    id: string;
    name: string;
  };
  templateVariables?: Record<string, any>;
}

/**
 * Centralized registry for collection services and naming strategies
 * Eliminates switch statements and enables dynamic service registration
 */
export class CollectionTypeRegistry {
  private static instance: CollectionTypeRegistry;
  private services = new Map<string, CollectionServiceRegistration>();
  private namingStrategies = new Map<string, CollectionNamingStrategy>();
  private serviceCache = new Map<string, BaseCollectionSync>();

  private constructor() {
    // Private constructor for singleton pattern
  }

  public static getInstance(): CollectionTypeRegistry {
    if (!CollectionTypeRegistry.instance) {
      CollectionTypeRegistry.instance = new CollectionTypeRegistry();
    }
    return CollectionTypeRegistry.instance;
  }

  /**
   * Register a collection service type
   */
  public registerService(
    type: string, 
    registration: CollectionServiceRegistration
  ): void {
    if (this.services.has(type)) {
      logger.warn(`Collection service type '${type}' is already registered, overwriting`, {
        label: 'Collection Type Registry',
        type,
      });
    }

    this.services.set(type, registration);
    
    logger.info(`Registered collection service: ${type}`, {
      label: 'Collection Type Registry',
      type,
      displayName: registration.displayName,
      subtypes: registration.supportedSubtypes,
    });
  }

  /**
   * Register a naming strategy for a specific type/subtype combination
   */
  public registerNamingStrategy(
    key: string, 
    strategy: CollectionNamingStrategy
  ): void {
    this.namingStrategies.set(key, strategy);
    
    logger.debug(`Registered naming strategy: ${key}`, {
      label: 'Collection Type Registry',
      key,
    });
  }

  /**
   * Create a collection service instance by type
   * Uses caching to avoid recreating services unnecessarily
   */
  public createService(type: string): BaseCollectionSync {
    // Check cache first
    if (this.serviceCache.has(type)) {
      return this.serviceCache.get(type)!;
    }

    const registration = this.services.get(type);
    if (!registration) {
      throw new Error(`Unknown collection service type: ${type}. Available types: ${Array.from(this.services.keys()).join(', ')}`);
    }

    if (registration.deprecated) {
      logger.warn(`Collection service type '${type}' is deprecated`, {
        label: 'Collection Type Registry',
        type,
      });
    }

    try {
      const service = registration.factory.create();
      
      // Cache the service instance
      this.serviceCache.set(type, service);
      
      logger.debug(`Created collection service: ${type}`, {
        label: 'Collection Type Registry',
        type,
        displayName: registration.displayName,
      });

      return service;
    } catch (error) {
      logger.error(`Failed to create collection service: ${type}`, {
        label: 'Collection Type Registry',
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to create collection service '${type}': ${error}`);
    }
  }

  /**
   * Generate a collection name using registered naming strategies
   */
  public async generateCollectionName(
    config: CollectionConfig,
    context: CollectionNamingContext
  ): Promise<string> {
    // Try exact match first (type_subtype)
    const exactKey = `${config.type}_${config.subtype || 'default'}`;
    let strategy = this.namingStrategies.get(exactKey);
    
    // Fallback to type-only match
    if (!strategy) {
      strategy = this.namingStrategies.get(config.type);
    }
    
    // Fallback to default strategy
    if (!strategy) {
      strategy = this.namingStrategies.get('default');
    }

    if (!strategy) {
      throw new Error(`No naming strategy found for collection type: ${config.type}, subtype: ${config.subtype}`);
    }

    if (!strategy.canHandle(config.type, config.subtype)) {
      logger.warn(`Naming strategy cannot handle type/subtype combination`, {
        label: 'Collection Type Registry',
        type: config.type,
        subtype: config.subtype,
        strategyKey: exactKey,
      });
    }

    try {
      return await strategy.generateName(config, context);
    } catch (error) {
      logger.error(`Failed to generate collection name`, {
        label: 'Collection Type Registry',
        type: config.type,
        subtype: config.subtype,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to generate collection name: ${error}`);
    }
  }

  /**
   * Get all registered service types
   */
  public getRegisteredTypes(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get registration information for a service type
   */
  public getServiceInfo(type: string): CollectionServiceRegistration | undefined {
    return this.services.get(type);
  }

  /**
   * Get supported subtypes for a service type
   */
  public getSupportedSubtypes(type: string): string[] {
    const registration = this.services.get(type);
    return registration ? registration.supportedSubtypes : [];
  }

  /**
   * Check if a service type is registered
   */
  public isTypeSupported(type: string): boolean {
    return this.services.has(type);
  }

  /**
   * Validate a collection configuration against the registry
   */
  public validateConfig(config: CollectionConfig): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if type is supported
    if (!this.isTypeSupported(config.type)) {
      errors.push(`Unsupported collection type: ${config.type}`);
      return { valid: false, errors, warnings };
    }

    const registration = this.services.get(config.type)!;

    // Check if subtype is supported (if specified)
    if (config.subtype && !registration.supportedSubtypes.includes(config.subtype)) {
      errors.push(`Unsupported subtype '${config.subtype}' for type '${config.type}'. Supported subtypes: ${registration.supportedSubtypes.join(', ')}`);
    }

    // Check for deprecation warnings
    if (registration.deprecated) {
      warnings.push(`Collection type '${config.type}' is deprecated and may be removed in a future version`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Clear service cache (useful for testing or reconfiguration)
   */
  public clearCache(): void {
    this.serviceCache.clear();
    logger.debug('Cleared collection service cache', {
      label: 'Collection Type Registry',
    });
  }

  /**
   * Get registry statistics for monitoring
   */
  public getStats(): {
    registeredTypes: number;
    namingStrategies: number;
    cachedServices: number;
    serviceDetails: Array<{
      type: string;
      displayName: string;
      subtypes: number;
      deprecated: boolean;
    }>;
  } {
    const serviceDetails = Array.from(this.services.entries()).map(([type, registration]) => ({
      type,
      displayName: registration.displayName,
      subtypes: registration.supportedSubtypes.length,
      deprecated: registration.deprecated || false,
    }));

    return {
      registeredTypes: this.services.size,
      namingStrategies: this.namingStrategies.size,
      cachedServices: this.serviceCache.size,
      serviceDetails,
    };
  }

  /**
   * Reset the registry (primarily for testing)
   */
  public reset(): void {
    this.services.clear();
    this.namingStrategies.clear();
    this.serviceCache.clear();
    logger.debug('Reset collection type registry', {
      label: 'Collection Type Registry',
    });
  }
}

// Export singleton instance
export const collectionTypeRegistry = CollectionTypeRegistry.getInstance();