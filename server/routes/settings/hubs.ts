import { Router } from 'express';
import PlexAPI from '@server/api/plexapi';
import { getAdminUser } from '@server/lib/collectionsUtils';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';

const hubsRoutes = Router();

/**
 * Initialize Plex client with admin credentials
 */
async function getPlexClient(): Promise<PlexAPI> {
  const admin = await getAdminUser();
  if (!admin?.plexToken) {
    throw new Error('No admin Plex token found');
  }

  const settings = getSettings();
  return new PlexAPI({
    plexToken: admin.plexToken,
    plexSettings: settings.plex,
  });
}

/**
 * GET /api/v1/settings/hubs/libraries
 * Get all library hubs across all sections
 */
hubsRoutes.get('/libraries', isAuthenticated(), async (req, res) => {
  try {
    const plexClient = await getPlexClient();
    const allHubs = await plexClient.getAllLibraryHubs();
    
    res.status(200).json(allHubs);
  } catch (error) {
    logger.error('Failed to fetch all library hubs', {
      label: 'Hub Management API',
      error: error instanceof Error ? error.message : String(error),
    });
    
    res.status(500).json({
      error: 'Failed to fetch library hubs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/v1/settings/hubs/libraries/:sectionId
 * Get hubs for a specific library section
 */
hubsRoutes.get('/libraries/:sectionId', isAuthenticated(), async (req, res) => {
  try {
    const { sectionId } = req.params;
    const plexClient = await getPlexClient();
    
    const hubs = await plexClient.getLibraryHubs(sectionId);
    
    res.status(200).json(hubs);
  } catch (error) {
    logger.error(`Failed to fetch hubs for library section ${req.params.sectionId}`, {
      label: 'Hub Management API',
      error: error instanceof Error ? error.message : String(error),
      sectionId: req.params.sectionId,
    });
    
    res.status(500).json({
      error: 'Failed to fetch library hubs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/v1/settings/hubs/libraries/:sectionId/manage
 * Get hub management interface for a library section
 */
hubsRoutes.get('/libraries/:sectionId/manage', isAuthenticated(), async (req, res) => {
  try {
    const { sectionId } = req.params;
    const plexClient = await getPlexClient();
    
    const managementData = await plexClient.getHubManagement(sectionId);
    
    res.status(200).json(managementData);
  } catch (error) {
    logger.error(`Failed to fetch hub management for library section ${req.params.sectionId}`, {
      label: 'Hub Management API',
      error: error instanceof Error ? error.message : String(error),
      sectionId: req.params.sectionId,
    });
    
    res.status(500).json({
      error: 'Failed to fetch hub management data',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/v1/settings/hubs/libraries/:sectionId/move
 * Move a hub to a new position in the library
 */
hubsRoutes.put('/libraries/:sectionId/move', isAuthenticated(), async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { hubId, afterHubId } = req.body;
    
    if (!hubId) {
      return res.status(400).json({
        error: 'Missing required parameter: hubId',
      });
    }
    
    const plexClient = await getPlexClient();
    await plexClient.moveHub(sectionId, hubId, afterHubId);
    
    logger.info(`Successfully moved hub ${hubId} in library ${sectionId}`, {
      label: 'Hub Management API',
      sectionId,
      hubId,
      afterHubId,
    });
    
    res.status(200).json({
      success: true,
      message: 'Hub moved successfully',
    });
  } catch (error) {
    logger.error(`Failed to move hub in library section ${req.params.sectionId}`, {
      label: 'Hub Management API',
      error: error instanceof Error ? error.message : String(error),
      sectionId: req.params.sectionId,
      hubId: req.body.hubId,
      afterHubId: req.body.afterHubId,
    });
    
    res.status(500).json({
      error: 'Failed to move hub',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/v1/settings/hubs/libraries/:sectionId/reorder
 * Reorder multiple hubs in a library section
 */
hubsRoutes.put('/libraries/:sectionId/reorder', isAuthenticated(), async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { hubOrder } = req.body;
    
    if (!Array.isArray(hubOrder) || hubOrder.length === 0) {
      return res.status(400).json({
        error: 'Invalid hubOrder: must be a non-empty array of hub IDs',
      });
    }
    
    const plexClient = await getPlexClient();
    await plexClient.reorderHubs(sectionId, hubOrder);
    
    logger.info(`Successfully reordered ${hubOrder.length} hubs in library ${sectionId}`, {
      label: 'Hub Management API',
      sectionId,
      hubCount: hubOrder.length,
    });
    
    res.status(200).json({
      success: true,
      message: `Successfully reordered ${hubOrder.length} hubs`,
    });
  } catch (error) {
    logger.error(`Failed to reorder hubs in library section ${req.params.sectionId}`, {
      label: 'Hub Management API',
      error: error instanceof Error ? error.message : String(error),
      sectionId: req.params.sectionId,
      hubOrder: req.body.hubOrder,
    });
    
    res.status(500).json({
      error: 'Failed to reorder hubs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/v1/settings/hubs/libraries/:sectionId/visibility
 * Update hub visibility settings
 */
hubsRoutes.put('/libraries/:sectionId/visibility', isAuthenticated(), async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { hubId, visibility } = req.body;
    
    if (!hubId) {
      return res.status(400).json({
        error: 'Missing required parameter: hubId',
      });
    }
    
    if (!visibility || typeof visibility !== 'object') {
      return res.status(400).json({
        error: 'Missing or invalid visibility configuration',
      });
    }
    
    const plexClient = await getPlexClient();
    await plexClient.updateHubVisibility(sectionId, hubId, visibility);
    
    logger.info(`Successfully updated hub visibility for ${hubId} in library ${sectionId}`, {
      label: 'Hub Management API',
      sectionId,
      hubId,
      visibility,
    });
    
    res.status(200).json({
      success: true,
      message: 'Hub visibility updated successfully',
    });
  } catch (error) {
    logger.error(`Failed to update hub visibility in library section ${req.params.sectionId}`, {
      label: 'Hub Management API',
      error: error instanceof Error ? error.message : String(error),
      sectionId: req.params.sectionId,
      hubId: req.body.hubId,
      visibility: req.body.visibility,
    });
    
    res.status(500).json({
      error: 'Failed to update hub visibility',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/v1/settings/hubs/configs
 * Get current Plex hub configurations
 */
hubsRoutes.get('/configs', isAuthenticated(), async (req, res) => {
  try {
    const settings = getSettings();
    
    res.status(200).json({
      hubConfigs: settings.plex.hubConfigs || [],
    });
  } catch (error) {
    logger.error('Failed to get hub configurations', {
      label: 'Hub Management API',
      error: error instanceof Error ? error.message : String(error),
    });
    
    res.status(500).json({
      error: 'Failed to get hub configurations',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/v1/settings/hubs/configs
 * Save Plex hub configurations (replaces entire config array)
 */
hubsRoutes.post('/configs', isAuthenticated(), async (req, res) => {
  try {
    const { hubConfigs } = req.body;
    
    if (!Array.isArray(hubConfigs)) {
      return res.status(400).json({
        error: 'Invalid hubConfigs: must be an array',
      });
    }
    
    const settings = getSettings();
    
    // Replace entire hub configs array (used for updates and full saves)
    settings.plex.hubConfigs = hubConfigs;
    settings.save();
    
    logger.info(`Saved ${hubConfigs.length} hub configurations`, {
      label: 'Hub Management API',
    });
    
    res.status(200).json({
      hubConfigs: settings.plex.hubConfigs,
      message: 'Hub configurations saved successfully',
    });
  } catch (error) {
    logger.error('Failed to save hub configurations', {
      label: 'Hub Management API',
      error: error instanceof Error ? error.message : String(error),
    });
    
    res.status(500).json({
      error: 'Failed to save hub configurations',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/v1/settings/hubs/configs/append
 * Append new hub configurations to existing ones (for discovery)
 */
hubsRoutes.post('/configs/append', isAuthenticated(), async (req, res) => {
  try {
    const { hubConfigs } = req.body;
    
    if (!Array.isArray(hubConfigs)) {
      return res.status(400).json({
        error: 'Invalid hubConfigs: must be an array',
      });
    }
    
    const settings = getSettings();
    const existingHubConfigs = settings.plex.hubConfigs || [];
    
    // Append new hub configs to existing ones (for discovery)
    settings.plex.hubConfigs = [...existingHubConfigs, ...hubConfigs];
    settings.save();
    
    logger.info(`Appended ${hubConfigs.length} new hub configurations`, {
      label: 'Hub Management API',
      totalConfigs: settings.plex.hubConfigs.length,
    });
    
    res.status(200).json({
      hubConfigs: settings.plex.hubConfigs,
      message: 'Hub configurations appended successfully',
    });
  } catch (error) {
    logger.error('Failed to append hub configurations', {
      label: 'Hub Management API',
      error: error instanceof Error ? error.message : String(error),
    });
    
    res.status(500).json({
      error: 'Failed to append hub configurations',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/v1/settings/hubs/discover
 * Discover available Plex hubs and convert them to hub configurations
 */
hubsRoutes.get('/discover', isAuthenticated(), async (req, res) => {
  try {
    const plexClient = await getPlexClient();
    const libraries = await plexClient.getLibraries();
    const discoveredConfigs: any[] = [];
    
    // Get existing collection configs to check for overlaps with custom collection hubs
    const settings = getSettings();
    const collectionConfigs = settings.plex.collectionConfigs || [];
    
    // Built-in hub display names
    const HUB_DISPLAY_NAMES: Record<string, string> = {
      'movie.recentlyadded': 'Recently Added Movies',
      'movie.recentlyreleased': 'Recently Released Movies', 
      'movie.curated': 'Seasonal Movies',
      'movie.topunwatched': 'Top Unwatched Movies',
      'movie.recentlyviewed': 'Recently Watched Movies',
      'movie.genre': 'Top Movies in (Genre)',
      'movie.by.actor.or.director': 'Top Movies by (Actor or Director)',
      'tv.recentlyadded': 'Recently Added TV',
      'tv.recentlyaired': 'Recently Released Episodes',
      'tv.startwatching': 'Start Watching',
      'tv.rediscover': 'Rediscover',
      'tv.toprated': 'Top Rated TV',
      'tv.recentlyviewed': 'Recently Watched Episodes',
      'tv.morefromnetwork': 'More from (Network)',
      'tv.moreingenre': 'More in (Genre)',
      'recent.library.playlists': 'Library Playlists',
    };
    
    for (const library of libraries) {
      try {
        const hubsResponse = await plexClient.getHubManagement(library.key);
        const hubs = hubsResponse?.MediaContainer?.Hub || [];
        
        hubs.forEach((hub: any, index: number) => {
          const mediaType = hub.identifier.startsWith('movie.') ? 'movie' : 
                           hub.identifier.startsWith('tv.') ? 'tv' : 'both';
          
          const hubId = `${library.key}-${hub.identifier}`;
          const hubName = HUB_DISPLAY_NAMES[hub.identifier] || hub.title || hub.identifier;
          
          // Determine the categorization based on hub identifier
          const isDefaultPlexHub = !hub.identifier.startsWith('custom.collection.');
          const isCustomCollection = hub.identifier && hub.identifier.startsWith('custom.collection.');
          
          // For custom collections, determine if they're Agregarr-managed
          let isAgregarrManaged = false;
          if (isCustomCollection) {
            // Extract rating key from identifier: "custom.collection.1.35954" → "35954"
            const parts = hub.identifier.split('.');
            if (parts.length >= 4) {
              const ratingKey = parts[3];
              
              // Check if we have a collection config with this rating key - that means it's Agregarr-managed
              const existingCollection = collectionConfigs.find(config => {
                return config.collectionRatingKey === ratingKey ||
                       (config.collectionRatingKeys && config.collectionRatingKeys[library.key] === ratingKey);
              });
              
              if (existingCollection) {
                isAgregarrManaged = true;
                logger.info(`Found Agregarr-managed collection promoted to hub: ${hub.title}`, {
                  label: 'Hub Discovery',
                  identifier: hub.identifier,
                  ratingKey,
                  collectionId: existingCollection.id,
                  collectionName: existingCollection.name,
                });
              } else {
                logger.info(`Found pre-existing collection promoted to hub: ${hub.title}`, {
                  label: 'Hub Discovery',
                  identifier: hub.identifier,
                  ratingKey,
                  note: 'No matching Agregarr collection config found',
                });
              }
            }
          }

          const hubConfig = {
            id: hubId,
            hubIdentifier: hub.identifier,
            name: hubName,
            libraryId: library.key,
            libraryName: library.title,
            mediaType,
            sortOrderLibrary: index,
            sortOrderHome: index,
            // New cleaner categorization flags
            isDefaultPlexHub,
            isAgregarrManaged,
            isPromotedToHub: isCustomCollection, // Custom collections are promoted to hub by definition
            visibilityConfig: {
              usersHome: hub.promotedToSharedHome === true || hub.promotedToSharedHome === '1',
              serverOwnerHome: hub.promotedToOwnHome === true || hub.promotedToOwnHome === '1',
              libraryRecommended: hub.promotedToRecommended === true || hub.promotedToRecommended === '1',
              libraryTabOnly: false,
            },
          };
          
          discoveredConfigs.push(hubConfig);
        });
      } catch (error) {
        logger.warn(`Failed to discover hubs for library ${library.title}`, {
          label: 'Hub Management API',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    res.status(200).json({
      success: true,
      discoveredConfigs,
      totalHubsFound: discoveredConfigs.length,
    });
  } catch (error) {
    logger.error('Failed to discover Plex hubs', {
      label: 'Hub Management API',
      error: error instanceof Error ? error.message : String(error),
    });
    
    res.status(500).json({
      error: 'Failed to discover Plex hubs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/v1/settings/hubs/status
 * Get hub management system status and capabilities
 */
hubsRoutes.get('/status', isAuthenticated(), async (req, res) => {
  try {
    const settings = getSettings();
    const admin = await getAdminUser();
    
    const status = {
      enabled: !!(admin?.plexToken && settings.plex.ip && settings.plex.machineId),
      plexConnected: false,
      libraryCount: 0,
      capabilities: {
        hubReordering: true,
        visibilityControl: true,
        builtInHubManagement: true,
        collectionHubManagement: true,
      },
    };
    
    if (status.enabled) {
      try {
        const plexClient = await getPlexClient();
        const plexStatus = await plexClient.getStatus();
        status.plexConnected = !!plexStatus;
        
        if (status.plexConnected) {
          const libraries = await plexClient.getLibraries();
          status.libraryCount = libraries.length;
        }
      } catch (error) {
        logger.warn('Failed to connect to Plex for hub management status check', {
          label: 'Hub Management API',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    res.status(200).json(status);
  } catch (error) {
    logger.error('Failed to get hub management status', {
      label: 'Hub Management API',
      error: error instanceof Error ? error.message : String(error),
    });
    
    res.status(500).json({
      error: 'Failed to get hub management status',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default hubsRoutes;