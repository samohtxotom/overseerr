import PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import collectionsSync from '@server/lib/collectionsSync';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

/**
 * Simple in-memory rate limiter for external URL fetching
 */
class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly maxRequests = 10; // Max requests per window
  private readonly windowMs = 60000; // 1 minute window

  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const requests = this.requests.get(identifier) || [];
    
    // Remove requests outside the window
    const validRequests = requests.filter(time => now - time < this.windowMs);
    
    if (validRequests.length >= this.maxRequests) {
      return false;
    }
    
    // Add current request
    validRequests.push(now);
    this.requests.set(identifier, validRequests);
    
    return true;
  }
}

const rateLimiter = new RateLimiter();

/**
 * Validate and sanitize external URLs for security
 */
function validateExternalUrl(url: string, type: string): { isValid: boolean; error?: string; sanitizedUrl?: string } {
  try {
    const urlObj = new URL(url);
    
    // Only allow HTTPS URLs for security
    if (urlObj.protocol !== 'https:') {
      return { isValid: false, error: 'Only HTTPS URLs are allowed' };
    }
    
    // Validate allowed domains based on collection type
    const allowedDomains = {
      trakt: ['trakt.tv'],
      tmdb: ['www.themoviedb.org', 'themoviedb.org'],
      imdb: ['www.imdb.com', 'imdb.com'],
      letterboxd: ['letterboxd.com', 'www.letterboxd.com']
    };
    
    const validDomains = allowedDomains[type as keyof typeof allowedDomains];
    if (!validDomains || !validDomains.includes(urlObj.hostname)) {
      return { isValid: false, error: `Invalid domain for ${type} collection. Allowed domains: ${validDomains?.join(', ')}` };
    }
    
    // Validate URL patterns for each service
    switch (type) {
      case 'trakt':
        if (!urlObj.pathname.match(/^\/users\/[^/]+\/lists\/[^/?]+\/?$/)) {
          return { isValid: false, error: 'Invalid Trakt list URL format. Expected: https://trakt.tv/users/username/lists/listname' };
        }
        break;
      case 'tmdb':
        if (!urlObj.pathname.match(/^\/collection\/\d+\/?$/)) {
          return { isValid: false, error: 'Invalid TMDb collection URL format. Expected: https://www.themoviedb.org/collection/123456' };
        }
        break;
      case 'imdb':
        if (!urlObj.pathname.match(/^\/list\/ls\d+\/?$/)) {
          return { isValid: false, error: 'Invalid IMDb list URL format. Expected: https://www.imdb.com/list/ls123456789' };
        }
        break;
      case 'letterboxd':
        if (!urlObj.pathname.match(/^\/[^/]+\/list\/[^/?]+\/?$/)) {
          return { isValid: false, error: 'Invalid Letterboxd list URL format. Expected: https://letterboxd.com/username/list/listname' };
        }
        break;
      default:
        return { isValid: false, error: 'Unsupported collection type' };
    }
    
    // Sanitize URL by removing unnecessary query parameters and fragments
    const sanitizedUrl = `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
    
    return { isValid: true, sanitizedUrl };
  } catch (error) {
    return { isValid: false, error: 'Invalid URL format' };
  }
}

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
        body: JSON.stringify(req.body, null, 2),
        hasCollectionConfigs: !!req.body.collectionConfigs,
        collectionsEnabled: req.body.collectionsEnabled,
        configCount: req.body.collectionConfigs?.length || 0,
      });

      const settings = getSettings();

      // Update collection configurations
      if (req.body.collectionConfigs) {
        logger.info('About to update collection configurations', {
          label: 'Collections API',
          configCount: req.body.collectionConfigs.length,
          configs: req.body.collectionConfigs.map((c: any) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            subtype: c.subtype,
            libraryId: c.libraryId,
          })),
        });
        
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

/**
 * POST /api/v1/settings/plex/collections/fetch-title
 * Fetch title from external collection URL
 */
collectionsRoutes.post('/fetch-title', isAuthenticated(), async (req, res) => {
  try {
    const { url, type } = req.body;
    
    if (!url || !type) {
      return res.status(400).json({
        status: 'error',
        message: 'URL and type are required',
      });
    }

    // Check rate limiting (per user)
    const userId = req.user?.id?.toString() || req.ip || 'anonymous';
    if (!rateLimiter.isAllowed(userId)) {
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests. Please wait before trying again.',
      });
    }

    // Validate and sanitize the URL
    const validation = validateExternalUrl(url, type);
    if (!validation.isValid) {
      return res.status(400).json({
        status: 'error',
        message: validation.error,
      });
    }

    const sanitizedUrl = validation.sanitizedUrl!;

    let title: string | null = null;
    let mediaType: 'movie' | 'tv' | 'both' | null = null;

    switch (type) {
      case 'trakt': {
        const TraktAPI = (await import('@server/api/trakt')).default;
        const settings = getSettings();
        
        if (!settings.trakt.apiKey) {
          return res.status(400).json({
            status: 'error',
            message: 'Trakt API key not configured',
          });
        }

        const traktClient = new TraktAPI(settings.trakt.apiKey);
        
        // Use the existing getCustomList method to fetch list info and detect media type
        try {
          const listData = await traktClient.getCustomList(sanitizedUrl, 10); // Get more items to analyze media type
          if (listData && listData.length >= 0) {
            // Extract the list name from the URL since Trakt API doesn't return list metadata
            const urlMatch = sanitizedUrl.match(/trakt\.tv\/users\/[^/]+\/lists\/([^/?]+)/);
            if (urlMatch) {
              // Convert slug to readable title (replace hyphens with spaces, capitalize)
              title = urlMatch[1]
                .replace(/-/g, ' ')
                .replace(/\b\w/g, (l: string) => l.toUpperCase());
            }

            // Analyze media type from the list content
            if (listData.length > 0) {
              const hasMovies = listData.some(item => item.type === 'movie' || item.movie);
              const hasShows = listData.some(item => item.type === 'show' || item.show);
              
              if (hasMovies && hasShows) {
                mediaType = 'both';
              } else if (hasMovies) {
                mediaType = 'movie';
              } else if (hasShows) {
                mediaType = 'tv';
              }
            }
          }
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Invalid Trakt list URL or list not accessible',
          });
        }
        break;
      }

      case 'tmdb': {
        const TheMovieDb = (await import('@server/api/themoviedb')).default;
        const tmdbClient = new TheMovieDb();
        
        try {
          const urlMatch = sanitizedUrl.match(/themoviedb\.org\/collection\/(\d+)/);
          if (!urlMatch) {
            return res.status(400).json({
              status: 'error',
              message: 'Invalid TMDb collection URL format',
            });
          }

          const collectionId = parseInt(urlMatch[1]);
          const collection = await tmdbClient.getCollection({ collectionId });
          title = collection.name;
          mediaType = 'movie'; // TMDb collections are always movies
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Invalid TMDb collection ID or collection not found',
          });
        }
        break;
      }

      case 'imdb': {
        // For IMDb, we'll need to scrape the title from the page
        const axios = (await import('axios')).default;
        
        try {
          const urlMatch = sanitizedUrl.match(/imdb\.com\/list\/(ls\d+)/);
          if (!urlMatch) {
            return res.status(400).json({
              status: 'error',
              message: 'Invalid IMDb list URL format',
            });
          }

          const response = await axios.get(sanitizedUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
          });

          // Extract title from HTML
          const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            title = titleMatch[1].replace(' - IMDb', '').trim();
          }

          // Try to detect media type from the page content by analyzing list items
          const htmlContent = response.data;
          
          // Try multiple approaches to find list items
          let listItemMatches = htmlContent.match(/<li[^>]*class="[^"]*ipc-metadata-list-summary-item[^"]*"[^>]*>.*?<\/li>/gs);
          
          // If the first pattern doesn't work, try alternative patterns
          if (!listItemMatches) {
            listItemMatches = htmlContent.match(/<div[^>]*class="[^"]*titleColumn[^"]*"[^>]*>.*?<\/div>/gs) ||
                             htmlContent.match(/<div[^>]*class="[^"]*list[^"]*item[^"]*"[^>]*>.*?<\/div>/gs) ||
                             [];
          }
          
          let movieCount = 0;
          let tvCount = 0;
          
          // Analyze the first 10 items to determine media type
          listItemMatches.slice(0, 10).forEach((item: string) => {
            // Look for title type indicators in the structured data or metadata
            const lowerItem = item.toLowerCase();
            
            // Check for movie indicators
            if (lowerItem.includes('titletype-movie') || 
                lowerItem.includes('feature') ||
                lowerItem.includes('film') ||
                lowerItem.includes('"@type":"movie"') ||
                lowerItem.includes('(movie)') ||
                lowerItem.includes('feature film') ||
                lowerItem.includes('short film')) {
              movieCount++;
            }
            
            // Check for TV indicators  
            if (lowerItem.includes('titletype-tv') ||
                lowerItem.includes('tv series') ||
                lowerItem.includes('tv episode') ||
                lowerItem.includes('tv mini-series') ||
                lowerItem.includes('tv movie') ||
                lowerItem.includes('"@type":"tvseries"') ||
                lowerItem.includes('"@type":"episode"') ||
                lowerItem.includes('(tv series)') ||
                lowerItem.includes('(tv episode)') ||
                lowerItem.includes('television')) {
              tvCount++;
            }
          });
          
          // Determine media type based on what we found
          if (movieCount > 0 && tvCount === 0) {
            mediaType = 'movie';
          } else if (tvCount > 0 && movieCount === 0) {
            mediaType = 'tv';
          } else if (movieCount > 0 && tvCount > 0) {
            mediaType = 'both';
          } else {
            // Fallback: try to detect from page title or description
            const lowerContent = htmlContent.toLowerCase();
            if (lowerContent.includes('movie list') || lowerContent.includes('film list')) {
              mediaType = 'movie';
            } else if (lowerContent.includes('tv list') || lowerContent.includes('television list') || lowerContent.includes('series list')) {
              mediaType = 'tv';
            } else {
              mediaType = 'both'; // Default when we can't determine
            }
          }
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Could not fetch IMDb list title',
          });
        }
        break;
      }

      case 'letterboxd': {
        // For Letterboxd, we'll need to scrape the title from the page
        const axios = (await import('axios')).default;
        
        try {
          const urlMatch = sanitizedUrl.match(/letterboxd\.com\/([^/]+)\/list\/([^/?]+)/);
          if (!urlMatch) {
            return res.status(400).json({
              status: 'error',
              message: 'Invalid Letterboxd list URL format',
            });
          }

          const response = await axios.get(sanitizedUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
          });

          // Extract title from HTML
          const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            title = titleMatch[1].replace(' • Letterboxd', '').replace(' - Letterboxd', '').trim();
          }

          // For Letterboxd, assume movies by default since it's primarily a film platform
          mediaType = 'movie';
          
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Could not fetch Letterboxd list title',
          });
        }
        break;
      }

      default:
        return res.status(400).json({
          status: 'error',
          message: 'Unsupported collection type',
        });
    }

    if (!title) {
      return res.status(400).json({
        status: 'error',
        message: 'Could not extract title from URL',
      });
    }

    return res.status(200).json({
      status: 'success',
      title: title,
      mediaType: mediaType,
    });

  } catch (error) {
    logger.error('Error fetching collection title', {
      label: 'Collections API',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error while fetching title',
    });
  }
});

/**
 * Upload a poster image for collections
 * POST /api/v1/settings/collections/poster
 */
collectionsRoutes.post('/poster', async (req, res) => {
  if (!req.user?.hasPermission(Permission.ADMIN)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  try {
    const multer = (await import('multer')).default;
    const { 
      savePosterFile, 
      validatePosterBuffer, 
      initializePosterStorage 
    } = await import('@server/lib/posterStorage');

    // Initialize storage directory
    initializePosterStorage();

    // Configure multer for memory storage with strict security
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1,
        fieldSize: 10 * 1024 * 1024, // 10MB field size limit
        fieldNameSize: 100, // Limit field name size
        fields: 1 // Only allow one field
      },
      fileFilter: (req, file, callback) => {
        // Strict validation - only allow specific mime types
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
        
        // Additional security: check file extension matches mime type
        const fileExt = file.originalname?.toLowerCase().split('.').pop();
        const expectedExts: Record<string, string[]> = {
          'image/jpeg': ['jpg', 'jpeg'],
          'image/png': ['png'],
          'image/webp': ['webp']
        };
        
        if (!allowedMimeTypes.includes(file.mimetype)) {
          return callback(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
        }
        
        if (fileExt && !expectedExts[file.mimetype]?.includes(fileExt)) {
          return callback(new Error('File extension does not match file type.'));
        }
        
        callback(null, true);
      }
    }).single('poster');

    // Handle file upload
    upload(req, res, async (err) => {
      if (err) {
        logger.error('Poster upload error:', err);
        return res.status(400).json({ 
          error: err.message || 'File upload failed' 
        });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      try {
        // Validate the uploaded file
        validatePosterBuffer(req.file.buffer, req.file.mimetype);

        // Save the poster file
        const filename = await savePosterFile(
          req.file.buffer,
          req.file.mimetype,
          req.file.originalname
        );

        const { getPosterUrl } = await import('@server/lib/posterStorage');
        
        return res.status(200).json({
          filename,
          url: getPosterUrl(filename)
        });
      } catch (error) {
        logger.error('Error processing poster upload:', error);
        return res.status(400).json({ 
          error: error instanceof Error ? error.message : 'Failed to process poster' 
        });
      }
    });
  } catch (error) {
    logger.error('Poster upload route error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Serve poster images
 * GET /api/v1/settings/collections/poster/:filename
 */
collectionsRoutes.get('/poster/:filename', async (req, res) => {
  // Note: No authentication required for serving images - they're already uploaded by admins
  // and filenames are UUIDs making them hard to guess
  try {
    const { filename } = req.params;
    const { getPosterPath, posterExists } = await import('@server/lib/posterStorage');
    
    // Security validation is now handled by posterExists and getPosterPath
    if (!posterExists(filename)) {
      return res.status(404).json({ error: 'Poster not found' });
    }

    const posterPath = getPosterPath(filename);
    
    // Set appropriate headers
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    
    // Stream the file
    const fs = await import('fs');
    const stream = fs.createReadStream(posterPath);
    stream.pipe(res);
    
    stream.on('error', (error) => {
      logger.error('Error streaming poster file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to serve poster' });
      }
    });
  } catch (error) {
    logger.error('Error serving poster:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Delete a poster image
 * DELETE /api/v1/settings/collections/poster/:filename
 */
collectionsRoutes.delete('/poster/:filename', async (req, res) => {
  if (!req.user?.hasPermission(Permission.ADMIN)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  try {
    const { filename } = req.params;
    const { deletePosterFile, posterExists } = await import('@server/lib/posterStorage');
    
    // Security validation is now handled by posterExists and deletePosterFile
    if (!posterExists(filename)) {
      return res.status(404).json({ error: 'Poster not found' });
    }

    await deletePosterFile(filename);
    
    return res.status(200).json({ message: 'Poster deleted successfully' });
  } catch (error) {
    logger.error('Error deleting poster:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default collectionsRoutes;
