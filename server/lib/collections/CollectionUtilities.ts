import type PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { DEFAULTS } from '@server/lib/collections/constants';
import { getSettings } from '@server/lib/settings';
import {
  getUserDisplayName,
  parseCollectionTemplate,
} from '@server/lib/utils/templateUtils';
import logger from '@server/logger';

/**
 * Clean Agregarr-specific labels from filter strings
 * Used to remove auto-generated labels when updating user filters
 */
export function cleanOverseerrLabels(filterStr: string): string {
  if (!filterStr) return '';
  return filterStr
    .replace(/Agregarr[^,]*/gi, '')
    .replace(/,,+/g, ',')
    .replace(/^,|,$/g, '')
    .replace(/^label!=$/, '');
}

/**
 * Clean Agregarr-specific labels from collection label arrays
 * Preserves user's custom labels while removing auto-generated ones
 */
export function cleanOverseerrCollectionLabels(
  existingLabels: string[]
): string[] {
  if (!existingLabels || existingLabels.length === 0) return [];

  // Filter out any existing Agregarr labels, preserving user's custom labels
  return existingLabels.filter(
    (label: string) => !label.toLowerCase().startsWith('agregarr')
  );
}

/**
 * Generate collection title from user template or default format
 */
export function generateCollectionTitle(user: User): string {
  const settings = getSettings();
  if (settings.plex.collectionTemplate) {
    return parseCollectionTemplate(settings.plex.collectionTemplate, user);
  }
  return `${getUserDisplayName(user)}'s requests`;
}

/**
 * Fetch admin user from database
 * Returns the server owner user (ID = 1) with minimal required fields
 */
export async function getAdminUser(): Promise<User | null> {
  const userRepository = getRepository(User);
  return await userRepository.findOne({
    where: { id: DEFAULTS.ADMIN_USER_ID },
    select: { id: true, plexToken: true, plexId: true },
  });
}

/**
 * Get all users that have Plex IDs (are connected to Plex)
 * Used for user-specific collection generation
 */
export async function getUsersWithPlexIds(): Promise<User[]> {
  const userRepository = getRepository(User);
  return await userRepository
    .createQueryBuilder('user')
    .select([
      'user.id',
      'user.plexId',
      'user.email',
      'user.plexUsername',
      'user.plexTitle',
      'user.username',
    ])
    .where('user.plexId IS NOT NULL')
    .getMany();
}

/**
 * Clean up collections for users who are no longer active/connected
 * Removes orphaned collections that belong to deleted or inactive users
 */
export async function cleanupOrphanedCollections(
  plexClient: PlexAPI,
  activeUserPlexIds: Set<number>
): Promise<{ deletedCount: number }> {
  logger.info('Starting cleanup of orphaned collections...');
  
  let deletedCount = 0;
  
  try {
    // Get all libraries
    const libraries = await plexClient.getLibraries();
    
    for (const library of libraries) {
      // Get all collections - they're filtered by library key internally
      const collections = await plexClient.getAllCollections();
      
      // Filter collections to this library key
      const libraryCollections = collections.filter(c => c.libraryKey === library.key);
      
      for (const collection of libraryCollections) {
        // Check if collection has user-specific labels
        if (collection.labels && collection.labels.length > 0) {
          // Look for Agregarr user-specific labels
          const agregarrUserLabels = collection.labels.filter((label: string) => 
            label.toLowerCase().startsWith('agregarr') && 
            label.includes('user-')
          );
          
          if (agregarrUserLabels.length > 0) {
            // Extract user ID from label format: "agregarr-user-{plexId}"
            const userIdMatches = agregarrUserLabels[0].match(/user-(\d+)/);
            if (userIdMatches) {
              const userPlexId = parseInt(userIdMatches[1]);
              
              // If user is no longer active, delete the collection
              if (!activeUserPlexIds.has(userPlexId)) {
                logger.info(
                  `Deleting orphaned collection "${collection.title}" for inactive user ${userPlexId}`
                );
                
                try {
                  await plexClient.deleteCollection(collection.ratingKey);
                  deletedCount++;
                } catch (deleteError) {
                  logger.error(
                    `Failed to delete orphaned collection "${collection.title}":`,
                    deleteError
                  );
                }
              }
            }
          }
        }
      }
    }
    
    logger.info(`Cleanup completed. Deleted ${deletedCount} orphaned collections.`);
    return { deletedCount };
    
  } catch (error) {
    logger.error('Error during orphaned collection cleanup:', error);
    return { deletedCount };
  }
}