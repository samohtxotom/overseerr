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

      if (!settings.plex.collectionsEnabled) {
        return res.status(400).json({
          status: 'error',
          message: 'Plex collections are not enabled',
        });
      }

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

      // Check Plex Pass before allowing sync
      const hasPlexPass = await plexClient.checkPlexPass();
      if (!hasPlexPass) {
        logger.warn(
          'Collections sync requested but Plex Pass not detected - privacy features may not work'
        );
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
        hasPlexPass, // Include Plex Pass status in response
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
