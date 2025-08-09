import PlexAPI from '@server/api/plexapi';
import { getSettings } from '@server/lib/settings';
import { extractErrorMessage } from '@server/lib/utils/templateUtils';
import { applyUnifiedOrderingToPlex, type OrderingItem } from './UnifiedOrderingService';
import logger from '@server/logger';

/**
 * Service for managing Plex hub visibility and ordering
 */
export class HubSyncService {
  private cancelled = false;

  public cancel(): void {
    this.cancelled = true;
  }

  /**
   * Sync Plex hub visibility settings to match our configuration
   */
  public async syncHubVisibility(plexClient: PlexAPI): Promise<void> {
    if (this.cancelled) return;

    try {
      const settings = getSettings();
      const hubConfigs = settings.plex.hubConfigs || [];

      if (hubConfigs.length === 0) {
        logger.info('No hub configurations found, skipping hub sync', {
          label: 'Hub Sync Service',
        });
        return;
      }

      logger.info(`Starting hub visibility sync for ${hubConfigs.length} hub configurations`, {
        label: 'Hub Sync Service',
        hubConfigCount: hubConfigs.length,
      });

      // Group hub configs by library for efficient processing
      const hubConfigsByLibrary = this.groupHubConfigsByLibrary(hubConfigs);

      // Process each library
      for (const [libraryId, libraryHubConfigs] of hubConfigsByLibrary) {
        if (this.cancelled) return;

        try {
          logger.info(`Syncing ${libraryHubConfigs.length} hubs for library ${libraryId}`, {
            label: 'Hub Sync Service',
            libraryId,
            hubCount: libraryHubConfigs.length,
          });

          await this.syncLibraryHubs(plexClient, libraryId, libraryHubConfigs);
        } catch (error) {
          logger.error(`Failed to process hubs for library ${libraryId}: ${extractErrorMessage(error)}`, {
            label: 'Hub Sync Service',
            libraryId,
            error: extractErrorMessage(error),
          });
        }
      }

      logger.info('Hub visibility sync completed', {
        label: 'Hub Sync Service',
        processedLibraries: hubConfigsByLibrary.size,
        totalHubConfigs: hubConfigs.length,
      });
    } catch (error) {
      logger.error(`Hub visibility sync failed: ${extractErrorMessage(error)}`, {
        label: 'Hub Sync Service',
        error: extractErrorMessage(error),
      });
      // Don't throw - we don't want hub sync failures to break collection sync
    }
  }

  /**
   * Sync unified ordering for collections and hubs together
   */
  public async syncUnifiedOrdering(plexClient: PlexAPI): Promise<void> {
    if (this.cancelled) return;

    try {
      const settings = getSettings();
      const collectionConfigs = settings.plex.collectionConfigs || [];
      const hubConfigs = settings.plex.hubConfigs || [];

      // Build unified ordering items for each library
      const orderingItemsByLibrary = new Map<string, OrderingItem[]>();

      // Add collection configs to ordering
      this.addCollectionOrderingItems(collectionConfigs, orderingItemsByLibrary);

      // Add hub configs to ordering
      this.addHubOrderingItems(hubConfigs, orderingItemsByLibrary);

      // Apply unified ordering to each library
      await this.applyOrderingToLibraries(plexClient, orderingItemsByLibrary);

      logger.info('Unified ordering sync completed', {
        label: 'Hub Sync Service',
        processedLibraries: orderingItemsByLibrary.size,
        totalItems: Array.from(orderingItemsByLibrary.values()).reduce((sum, items) => sum + items.length, 0),
      });
    } catch (error) {
      logger.error(`Unified ordering sync failed: ${extractErrorMessage(error)}`, {
        label: 'Hub Sync Service',
        error: extractErrorMessage(error),
      });
      // Don't throw - we don't want ordering sync failures to break collection sync
    }
  }

  /**
   * Group hub configurations by library
   */
  private groupHubConfigsByLibrary(hubConfigs: any[]): Map<string, any[]> {
    const hubConfigsByLibrary = new Map<string, any[]>();
    
    for (const hubConfig of hubConfigs) {
      if (!hubConfigsByLibrary.has(hubConfig.libraryId)) {
        hubConfigsByLibrary.set(hubConfig.libraryId, []);
      }
      hubConfigsByLibrary.get(hubConfig.libraryId)!.push(hubConfig);
    }

    return hubConfigsByLibrary;
  }

  /**
   * Sync hubs for a specific library
   */
  private async syncLibraryHubs(plexClient: PlexAPI, libraryId: string, libraryHubConfigs: any[]): Promise<void> {
    // Update visibility for each hub in this library
    for (const hubConfig of libraryHubConfigs) {
      if (this.cancelled) return;

      try {
        // Convert our visibility config to Plex format
        const plexVisibility = this.convertToPlexVisibility(hubConfig);

        await plexClient.updateHubVisibility(libraryId, hubConfig.hubIdentifier, plexVisibility);

        logger.info(`Successfully updated hub visibility: ${hubConfig.name}`, {
          label: 'Hub Sync Service',
          hubName: hubConfig.name,
          hubIdentifier: hubConfig.hubIdentifier,
          libraryId,
        });
      } catch (error) {
        logger.error(`Failed to update visibility for hub ${hubConfig.hubIdentifier}: ${extractErrorMessage(error)}`, {
          label: 'Hub Sync Service',
          hubIdentifier: hubConfig.hubIdentifier,
          libraryId,
          error: extractErrorMessage(error),
        });
      }
    }
  }

  /**
   * Convert our visibility config to Plex format
   */
  private convertToPlexVisibility(hubConfig: any) {
    return {
      promotedToOwnHome: hubConfig.visibilityConfig?.serverOwnerHome || false,
      promotedToSharedHome: hubConfig.visibilityConfig?.usersHome || false,
      promotedToRecommended: hubConfig.visibilityConfig?.libraryRecommended || false,
      homeVisibility: (hubConfig.visibilityConfig?.usersHome || hubConfig.visibilityConfig?.serverOwnerHome) ? 'all' : 'none',
      recommendationsVisibility: hubConfig.visibilityConfig?.libraryRecommended ? 'all' : 'none',
    };
  }

  /**
   * Add collection configurations to ordering items
   */
  private addCollectionOrderingItems(collectionConfigs: any[], orderingItemsByLibrary: Map<string, OrderingItem[]>): void {
    for (const config of collectionConfigs) {
      let librariesToProcess: string[] = [];
      
      // If config has collectionRatingKeys (multi-library rating keys), process all those libraries
      if (config.collectionRatingKeys && Object.keys(config.collectionRatingKeys).length > 0) {
        librariesToProcess = Object.keys(config.collectionRatingKeys);
      } else {
        // Fallback to the old logic for configs without collectionRatingKeys
        const libraryIds = config.libraryIds || (config.libraryId ? [config.libraryId] : []);
        const normalizedLibraryIds = Array.isArray(libraryIds) ? libraryIds : [libraryIds];
        librariesToProcess = normalizedLibraryIds.filter((id): id is string => typeof id === 'string' && id !== 'all');
      }
      
      for (const libraryId of librariesToProcess) {
        if (!orderingItemsByLibrary.has(libraryId)) {
          orderingItemsByLibrary.set(libraryId, []);
        }

        // For collections, we need the collectionRatingKey to create proper Plex identifiers
        let ratingKeyForLibrary = config.collectionRatingKey; // Fallback to single rating key
        
        if (config.collectionRatingKeys && config.collectionRatingKeys[libraryId]) {
          ratingKeyForLibrary = config.collectionRatingKeys[libraryId];
        }
        
        // If we have a rating key for this library, include it in ordering
        if (ratingKeyForLibrary) {
          orderingItemsByLibrary.get(libraryId)!.push({
            id: config.id,
            type: 'collection',
            libraryId,
            collectionRatingKey: ratingKeyForLibrary,
            sortOrder: config.sortOrderLibrary || 0,
          });
        }
      }
    }
  }

  /**
   * Add hub configurations to ordering items
   */
  private addHubOrderingItems(hubConfigs: any[], orderingItemsByLibrary: Map<string, OrderingItem[]>): void {
    // Group hub configs by library and use UI order
    const hubConfigsByLibrary = this.groupHubConfigsByLibrary(hubConfigs);

    // Process hubs by library using the same logic as hub ordering
    for (const [libraryId, libraryHubConfigs] of hubConfigsByLibrary) {
      // Sort hub configs by their sortOrderLibrary (this is our UI order)
      const sortedHubConfigs = [...libraryHubConfigs].sort((a, b) => 
        (a.sortOrderLibrary || 0) - (b.sortOrderLibrary || 0)
      );

      // Add hubs to ordering in UI order
      if (!orderingItemsByLibrary.has(libraryId)) {
        orderingItemsByLibrary.set(libraryId, []);
      }

      sortedHubConfigs.forEach((hubConfig) => {
        orderingItemsByLibrary.get(libraryId)!.push({
          id: hubConfig.id,
          type: 'hub',
          libraryId: hubConfig.libraryId,
          hubIdentifier: hubConfig.hubIdentifier,
          sortOrder: hubConfig.sortOrderLibrary || 0,
        });
      });
    }
  }

  /**
   * Apply unified ordering to each library
   */
  private async applyOrderingToLibraries(plexClient: PlexAPI, orderingItemsByLibrary: Map<string, OrderingItem[]>): Promise<void> {
    for (const [libraryId, orderingItems] of orderingItemsByLibrary) {
      if (orderingItems.length === 0) continue;

      try {
        // Get all available hubs from Plex for this library to include inactive ones
        const allPlexHubs = await plexClient.getHubManagement(libraryId);
        const availableHubs = allPlexHubs?.MediaContainer?.Hub || [];

        // Get current hub identifiers that are already managed
        const managedHubIdentifiers = orderingItems
          .filter(item => item.type === 'hub')
          .map(item => item.hubIdentifier);

        // Find ALL unmanaged hubs (both visible and invisible) to add at the end
        const unmanagedHubs = availableHubs.filter((hub: any) => {
          const isNotManaged = !managedHubIdentifiers.includes(hub.identifier);
          const isBuiltIn = !hub.identifier?.startsWith('custom.collection.');
          return isNotManaged && isBuiltIn;
        });

        // Add unmanaged hubs to ordering items (at the bottom)
        const unmanagedHubOrderingItems = unmanagedHubs.map((hub: any, index: number) => ({
          id: `unmanaged-${hub.identifier}`,
          type: 'hub' as const,
          libraryId,
          hubIdentifier: hub.identifier,
          sortOrder: orderingItems.length + index,
        }));

        // Combine managed items with unmanaged hubs
        const completeOrderingItems = [...orderingItems, ...unmanagedHubOrderingItems];

        logger.info(`Applying unified ordering for library ${libraryId}`, {
          label: 'Hub Sync Service',
          libraryId,
          itemCount: completeOrderingItems.length,
          collections: completeOrderingItems.filter(item => item.type === 'collection').length,
          hubs: completeOrderingItems.filter(item => item.type === 'hub').length,
          unmanagedHubsAdded: unmanagedHubOrderingItems.length,
          hubDetails: completeOrderingItems.filter(item => item.type === 'hub').map(item => ({
            hubIdentifier: item.hubIdentifier,
            sortOrder: item.sortOrder
          })),
        });

        await applyUnifiedOrderingToPlex(plexClient, completeOrderingItems);
      } catch (error) {
        logger.error(`Failed to apply ordering for library ${libraryId}: ${extractErrorMessage(error)}`, {
          label: 'Hub Sync Service',
          libraryId,
          error: extractErrorMessage(error),
        });
      }
    }
  }
}

export default HubSyncService;