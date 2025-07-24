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
 * Get collections sync status (for progress polling)
 */
collectionsRoutes.get('/sync', (_req, res) => {
  return res.status(200).json(collectionsSync.status);
});

/**
 * POST /api/v1/settings/plex/collections/sync
 * Manually trigger a collection sync
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

      // Initialize Plex client
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

      // Initialize collection service and sync (manual operation)
      collectionsSync.run(true);

      logger.info('Manual Plex collections sync completed successfully');

      return res.status(200).json({
        status: 'success',
        message: 'Collections sync completed successfully',
        hasPlexPass, // Include Plex Pass status in response
      });
    } catch (error) {
      logger.error('Error during manual collections sync:', error);

      return res.status(500).json({
        status: 'error',
        message: 'An error occurred during collections sync',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

export default collectionsRoutes;
