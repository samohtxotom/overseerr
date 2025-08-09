import OverseerrAPI from '@server/api/overseerr';
import logger from '@server/logger';
import { Router } from 'express';

const router = Router();

router.post('/test', async (req, res, next) => {
  try {
    const { hostname, port, apiKey, useSsl, urlBase } = req.body;

    if (!hostname || !port || !apiKey) {
      return next({
        status: 400,
        message: 'Hostname, port, and API key are required',
      });
    }

    const settings = {
      hostname,
      port: Number(port),
      useSsl: useSsl || false,
      urlBase: urlBase || '',
      apiKey,
    };

    const overseerrClient = new OverseerrAPI(settings);
    const result = await overseerrClient.testConnection();

    if (!result.success) {
      throw new Error('Unable to connect to Overseerr');
    }

    return res.status(200).json({
      success: true,
      version: result.version,
    });
  } catch (e) {
    logger.error('Overseerr connection test failed', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to connect to Overseerr.',
    });
  }
});

export default router;