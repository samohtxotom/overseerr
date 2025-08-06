import { getSettings, type CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Service for updating collection configurations with Plex rating keys
 */
export class CollectionConfigUpdater {
  
  /**
   * Update a collection config with its Plex rating key for a specific library
   * Handles both direct configs and expanded configs from LibraryConfigExpander
   */
  static updateConfigWithRatingKey(configId: number, collectionRatingKey: string, libraryId?: string): void {
    try {
      const settings = getSettings();
      const collectionConfigs = settings.plex.collectionConfigs || [];
      
      // Try to find the config directly first
      let configIndex = collectionConfigs.findIndex(config => config.id === configId);
      let targetConfigId = configId;
      let extractedLibraryId = libraryId;
      
      // If not found, this might be an expanded config - find the parent config and extract library ID
      if (configIndex < 0) {
        // Expanded config IDs are generated as: parentId * 1000 + libraryHash
        // Extract the parent ID by dividing by 1000 and taking the floor
        const potentialParentId = Math.floor(configId / 1000);
        const libraryHash = configId - (potentialParentId * 1000);
        
        if (potentialParentId > 0) {
          configIndex = collectionConfigs.findIndex(config => config.id === potentialParentId);
          targetConfigId = potentialParentId;
          
          // If libraryId wasn't provided, try to extract it from the hash
          if (!extractedLibraryId) {
            extractedLibraryId = libraryHash.toString();
          }
          
          logger.debug(`Mapped expanded config ${configId} to parent config ${potentialParentId}`, {
            label: 'Collection Config Updater',
          });
        }
      }
      
      if (configIndex >= 0) {
        const existingConfig = collectionConfigs[configIndex];
        
        // Create updated config with rating key(s)
        const updatedConfig = {
          ...existingConfig,
          collectionRatingKey, // Keep backward compatibility
          collectionRatingKeys: {
            ...(existingConfig.collectionRatingKeys || {}),
            ...(extractedLibraryId ? { [extractedLibraryId]: collectionRatingKey } : {}),
          },
        };
        
        // Update the config in the array
        collectionConfigs[configIndex] = updatedConfig;
        
        // Save the updated settings
        settings.plex.collectionConfigs = collectionConfigs;
        settings.save();
        
        logger.debug(`Updated config ${targetConfigId} with rating key for library ${extractedLibraryId}`, {
          label: 'Collection Config Updater',
        });
      } else {
        logger.warn(`Could not find config ${configId} or parent config to update with rating key`, {
          label: 'Collection Config Updater',
          configId,
          collectionRatingKey,
        });
      }
    } catch (error) {
      logger.error(`Failed to update config ${configId} with rating key: ${error}`, {
        label: 'Collection Config Updater',
        configId,
        collectionRatingKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Update multiple configs with their rating keys in a batch
   */
  static updateConfigsWithRatingKeys(updates: Array<{ configId: number; collectionRatingKey: string }>): void {
    if (updates.length === 0) return;

    try {
      const settings = getSettings();
      const collectionConfigs = settings.plex.collectionConfigs || [];
      let updatedCount = 0;
      
      // Apply all updates
      for (const { configId, collectionRatingKey } of updates) {
        const configIndex = collectionConfigs.findIndex(config => config.id === configId);
        if (configIndex >= 0) {
          collectionConfigs[configIndex] = {
            ...collectionConfigs[configIndex],
            collectionRatingKey,
          };
          updatedCount++;
        }
      }
      
      if (updatedCount > 0) {
        // Save the updated settings
        settings.plex.collectionConfigs = collectionConfigs;
        settings.save();
        
        logger.info(`Updated ${updatedCount} collection configs with rating keys`, {
          label: 'Collection Config Updater',
          updatedCount,
          totalUpdates: updates.length,
        });
      }
    } catch (error) {
      logger.error(`Failed to batch update configs with rating keys: ${error}`, {
        label: 'Collection Config Updater',
        updateCount: updates.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}