import PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import collectionsSync from '@server/lib/collectionsSync';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const collectionsRoutes = Router();

/**
 * GET /api/v1/settings/plex/collections
 * Get collection configurations
 */
collectionsRoutes.get('/', (_req, res) => {
  const settings = getSettings();
  return res.status(200).json({
    collectionsEnabled: settings.plex.collectionsEnabled,
    collectionConfigs: settings.plex.collectionConfigs || [],
  });
});

/**
 * POST /api/v1/settings/plex/collections
 * Save collection configurations
 */
collectionsRoutes.post(
  '/',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    try {
      logger.info('Collections API POST request received', {
        label: 'Collections API',
        body: req.body,
        hasCollectionConfigs: !!req.body.collectionConfigs,
        collectionsEnabled: req.body.collectionsEnabled,
      });

      const settings = getSettings();

      // Update collection configurations
      if (req.body.collectionConfigs) {
        settings.plex.collectionConfigs = req.body.collectionConfigs;
        logger.info('Updated collection configurations', {
          label: 'Collections API',
          configCount: req.body.collectionConfigs.length,
        });
      }

      // Update collections enabled status if provided
      if (typeof req.body.collectionsEnabled !== 'undefined') {
        const wasCollectionsEnabled = settings.plex.collectionsEnabled;
        settings.plex.collectionsEnabled = req.body.collectionsEnabled;

        logger.info('Updated collections enabled status', {
          label: 'Collections API',
          from: wasCollectionsEnabled,
          to: req.body.collectionsEnabled,
        });

        // Set collectionsEverEnabled if collections are being enabled for the first time
        if (
          !wasCollectionsEnabled &&
          req.body.collectionsEnabled &&
          !settings.plex.collectionsEverEnabled
        ) {
          settings.plex.collectionsEverEnabled = true;
          logger.info('Set collectionsEverEnabled to true', {
            label: 'Collections API',
          });
        }
      }

      settings.save();

      logger.info('Collection configurations saved successfully', {
        label: 'Collections API',
        configCount: settings.plex.collectionConfigs?.length || 0,
        collectionsEnabled: settings.plex.collectionsEnabled,
      });

      return res.status(200).json({
        collectionsEnabled: settings.plex.collectionsEnabled,
        collectionConfigs: settings.plex.collectionConfigs || [],
        message: 'Collection configurations saved successfully',
      });
    } catch (error) {
      logger.error('Error saving collection configurations:', {
        label: 'Collections API',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestBody: req.body,
      });
      return next({
        status: 500,
        message: 'Failed to save collection configurations',
      });
    }
  }
);

/**
 * GET /api/v1/settings/plex/collections/sync
 * Get collections sync status (simplified - no detailed progress)
 */
collectionsRoutes.get('/sync', (_req, res) => {
  return res.status(200).json({
    running: collectionsSync.running,
    message: collectionsSync.running
      ? 'Collections sync in progress'
      : 'Not running',
  });
});

/**
 * POST /api/v1/settings/plex/collections/sync
 * Start a collection sync in the background (fire-and-forget)
 */
collectionsRoutes.post(
  '/sync',
  isAuthenticated(Permission.ADMIN),
  async (req, res) => {
    try {
      const settings = getSettings();

      // Sync button should work regardless of collectionsEnabled flag
      // The sync job itself will check if there are collections to process

      if (!settings.plex.ip || !settings.plex.port) {
        return res.status(400).json({
          status: 'error',
          message: 'Plex server settings are not configured',
        });
      }

      // Get admin user for Plex token
      const userRepository = getRepository(User);
      const admin = await userRepository.findOne({
        where: { id: 1 },
        select: { id: true, plexToken: true },
      });

      if (!admin?.plexToken) {
        return res.status(400).json({
          status: 'error',
          message: 'Admin Plex token not found',
        });
      }

      // Initialize Plex client for quick connection test
      const plexClient = new PlexAPI({
        plexToken: admin.plexToken,
        plexSettings: settings.plex,
      });

      // Test connection
      const statusResult = await plexClient.getStatus();
      if (!statusResult) {
        return res.status(400).json({
          status: 'error',
          message: 'Could not connect to Plex server',
        });
      }

      // Start collection sync in background with proper error handling
      setImmediate(async () => {
        try {
          await collectionsSync.run();
        } catch (error) {
          logger.error('Background collections sync failed:', error);
        }
      });

      logger.info('Manual Plex collections sync started in background');

      return res.status(200).json({
        status: 'success',
        message: 'Collections sync started in background',
      });
    } catch (error) {
      logger.error('Error starting collections sync:', error);

      return res.status(500).json({
        status: 'error',
        message: 'An error occurred while starting collections sync',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

export default collectionsRoutes;
