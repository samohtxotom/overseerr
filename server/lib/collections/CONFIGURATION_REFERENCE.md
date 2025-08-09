# Collection System Configuration Reference

This document provides a comprehensive guide to all configurable values in the collections system, replacing previously hardcoded values with environment variables and application settings.

## Environment Variables

All configuration values can be set via environment variables with the `COLLECTIONS_` prefix. Each section below lists the available variables with their defaults.

### API and Network Configuration

Controls HTTP timeouts, rate limiting, and network behavior.

| Variable | Default | Description |
|----------|---------|-------------|
| `COLLECTIONS_HTTP_TIMEOUT` | `10000` | HTTP request timeout in milliseconds |
| `COLLECTIONS_RATE_LIMIT_MAX_ATTEMPTS` | `3` | Maximum retry attempts for rate-limited requests |
| `COLLECTIONS_RATE_LIMIT_MAX_DELAY` | `30000` | Maximum delay between retries (ms) |
| `COLLECTIONS_RATE_LIMIT_BASE_DELAY` | `1000` | Base delay for exponential backoff (ms) |
| `COLLECTIONS_RATE_LIMIT_BACKOFF` | `2` | Backoff multiplier for retry delays |
| `COLLECTIONS_RETRY_MAX_ATTEMPTS` | `3` | Maximum retry attempts for failed operations |
| `COLLECTIONS_RETRY_INITIAL_DELAY` | `1000` | Initial delay for retry operations (ms) |
| `COLLECTIONS_RETRY_BACKOFF_MULTIPLIER` | `2` | Multiplier for retry delay backoff |
| `COLLECTIONS_USER_AGENT` | Chrome UA | User agent string for web scraping |

### Collection Processing Limits

Controls collection size limits and processing thresholds.

| Variable | Default | Description |
|----------|---------|-------------|
| `COLLECTIONS_DEFAULT_MAX_ITEMS` | `1000` | Default maximum items per collection |
| `COLLECTIONS_MAX_NAME_LENGTH` | `100` | Maximum collection name length |
| `COLLECTIONS_MINIMUM_PLAYS` | `3` | Minimum play count for Tautulli filtering |
| `COLLECTIONS_DEFAULT_TIME_PERIOD` | `30` | Default time period in days for statistics |
| `COLLECTIONS_AUTO_REQUEST_MAX_SEASONS` | `3` | Maximum seasons for TV auto-approval |

### Batch Processing Configuration

Controls how collections are processed in batches and progress reporting.

| Variable | Default | Description |
|----------|---------|-------------|
| `COLLECTIONS_BATCH_SIZE` | `5` | Collection processing batch size |
| `COLLECTIONS_USER_FETCH_LIMIT` | `1000` | Maximum users to fetch from API |
| `COLLECTIONS_REQUEST_FETCH_LIMIT` | `5000` | Maximum requests to fetch from API |
| `COLLECTIONS_PROGRESS_INTERVAL_LARGE` | `10` | Progress log interval for large lists |
| `COLLECTIONS_PROGRESS_INTERVAL_SMALL` | `5` | Progress log interval for small lists |
| `COLLECTIONS_PROGRESS_THRESHOLD` | `50` | Threshold to switch log intervals |

### Cache Configuration

Controls caching behavior for improved performance.

| Variable | Default | Description |
|----------|---------|-------------|
| `COLLECTIONS_CACHE_SHARED_SERVER_TTL` | `300000` | Shared server cache TTL (5 minutes in ms) |
| `COLLECTIONS_CACHE_METADATA_TTL` | `600000` | Collection metadata cache TTL (10 minutes in ms) |

### Sort Order Configuration

Controls how collections are ordered on the Plex home screen.

| Variable | Default | Description |
|----------|---------|-------------|
| `COLLECTIONS_MAX_SORT_PREFIX_LENGTH` | `20` | Maximum exclamation marks in sort prefix |
| `COLLECTIONS_SORT_PREFIX_HIGH` | `"!!!"` | High priority sort prefix |
| `COLLECTIONS_SORT_PREFIX_MEDIUM` | `"!!"` | Medium priority sort prefix |
| `COLLECTIONS_SORT_PREFIX_LOW` | `"!"` | Low priority sort prefix |
| `COLLECTIONS_CONFIG_ID_MULTIPLIER` | `1000` | Multiplier for expanded config IDs |

### Sync Operation Configuration

Controls sync process timing and shutdown behavior.

| Variable | Default | Description |
|----------|---------|-------------|
| `COLLECTIONS_SHUTDOWN_MAX_WAIT` | `50` | Maximum wait iterations for graceful shutdown |
| `COLLECTIONS_SHUTDOWN_WAIT_INTERVAL` | `100` | Wait interval between shutdown checks (ms) |
| `COLLECTIONS_API_DELAY` | `1000` | Delay between API-heavy operations (ms) |

### Label and Branding Configuration

Controls collection labeling and branding.

| Variable | Default | Description |
|----------|---------|-------------|
| `COLLECTIONS_LABEL_PREFIX` | `"Agregarr"` | Collection label prefix for identification |
| `COLLECTIONS_LEGACY_PREFIX` | `"overseerr"` | Legacy prefix for cleanup operations |
| `COLLECTIONS_ENABLE_CUSTOM_BRANDING` | `false` | Enable custom branding features |

### Debug and Logging Configuration

Controls debug output and logging verbosity.

| Variable | Default | Description |
|----------|---------|-------------|
| `COLLECTIONS_VERBOSE_LOGGING` | `false` | Enable verbose logging |
| `COLLECTIONS_LOG_PERFORMANCE` | `false` | Log performance metrics |
| `COLLECTIONS_DEBUG_MODE` | `false` | Enable debug mode |

## Application Settings Override

Some configuration values can also be overridden through application settings (future feature). These would be accessible via the admin UI and stored in the database settings.

### Settings Schema (Planned)

```json
{
  "plex": {
    "collections": {
      "defaultMaxItems": 1000,
      "httpTimeout": 10000,
      "batchSize": 5,
      "maxRetries": 3,
      "cacheTtl": 300000,
      "sortConfig": {
        "maxPrefixLength": 20,
        "highPriorityPrefix": "!!!",
        "mediumPriorityPrefix": "!!",
        "lowPriorityPrefix": "!"
      },
      "labelPrefix": "Agregarr",
      "debug": {
        "verboseLogging": false,
        "logPerformance": false
      }
    }
  }
}
```

## Migration from Hardcoded Values

The following table shows what values were previously hardcoded and their new configuration options:

### Before and After

| Previous Hardcoded Value | New Configuration | Default |
|-------------------------|-------------------|---------|
| `1000` (max items fallback) | `COLLECTIONS_DEFAULT_MAX_ITEMS` | `1000` |
| `10000` (HTTP timeout) | `COLLECTIONS_HTTP_TIMEOUT` | `10000` |
| `3` (minimum plays) | `COLLECTIONS_MINIMUM_PLAYS` | `3` |
| `30` (days default) | `COLLECTIONS_DEFAULT_TIME_PERIOD` | `30` |
| `3` (max seasons) | `COLLECTIONS_AUTO_REQUEST_MAX_SEASONS` | `3` |
| `5` (batch size) | `COLLECTIONS_BATCH_SIZE` | `5` |
| `100` (name length) | `COLLECTIONS_MAX_NAME_LENGTH` | `100` |
| `20` (sort prefix cap) | `COLLECTIONS_MAX_SORT_PREFIX_LENGTH` | `20` |
| `50/100` (shutdown timeout) | `COLLECTIONS_SHUTDOWN_*` | `50/100` |
| `'Agregarr'` (label prefix) | `COLLECTIONS_LABEL_PREFIX` | `'Agregarr'` |
| `'!!'` (sort prefix) | `COLLECTIONS_SORT_PREFIX_MEDIUM` | `'!!'` |
| Chrome User Agent | `COLLECTIONS_USER_AGENT` | Chrome UA |
| `5 * 60 * 1000` (cache TTL) | `COLLECTIONS_CACHE_SHARED_SERVER_TTL` | `300000` |

### Files Modified

The following files have been updated to use configurable values:

1. **ConfigurationConstants.ts** - New centralized configuration system
2. **constants.ts** - Updated to use ConfigurationConstants for backward compatibility
3. **BaseCollectionSync.ts** - Rate limiting configuration
4. **OverseerrCollectionSync.ts** - Max items configuration
5. **TautulliCollectionSync.ts** - Minimum plays and time periods
6. **ImdbCollectionSync.ts** - HTTP timeout and user agent
7. **LetterboxdCollectionSync.ts** - HTTP timeout and user agent
8. **AutoRequestService.ts** - Max seasons configuration
9. **CollectionOperations.ts** - Sort prefix length configuration
10. **collectionsSync.ts** - Shutdown timeout configuration
11. **CollectionSyncUtils.ts** - Name length and label prefix
12. **LibraryConfigExpander.ts** - ID multiplier configuration
13. **OverseerrCollectionService.ts** - Batch fetch limits

## Usage Examples

### Production Environment
```bash
# Increase timeouts for slower networks
export COLLECTIONS_HTTP_TIMEOUT=30000
export COLLECTIONS_RATE_LIMIT_MAX_DELAY=60000

# Increase collection sizes
export COLLECTIONS_DEFAULT_MAX_ITEMS=2000
export COLLECTIONS_USER_FETCH_LIMIT=2000

# Custom branding
export COLLECTIONS_LABEL_PREFIX="MyServer"
export COLLECTIONS_SORT_PREFIX_HIGH=">>>"
```

### Development Environment
```bash
# Enable debugging
export COLLECTIONS_VERBOSE_LOGGING=true
export COLLECTIONS_LOG_PERFORMANCE=true
export COLLECTIONS_DEBUG_MODE=true

# Smaller batches for testing
export COLLECTIONS_BATCH_SIZE=2
export COLLECTIONS_DEFAULT_MAX_ITEMS=10
```

### High-Performance Environment
```bash
# Larger batches and caches
export COLLECTIONS_BATCH_SIZE=20
export COLLECTIONS_USER_FETCH_LIMIT=5000
export COLLECTIONS_REQUEST_FETCH_LIMIT=10000
export COLLECTIONS_CACHE_SHARED_SERVER_TTL=1800000  # 30 minutes
```

## Validation

All configuration values are validated at runtime:

- **Timeouts**: Must be > 0 and ≤ 300,000ms (5 minutes)
- **Max Items**: Must be > 0 and ≤ 10,000
- **Batch Sizes**: Must be > 0 and ≤ 100
- **Retries**: Must be ≥ 0 and ≤ 10
- **Name Length**: Must be > 0 and ≤ 255
- **Cache TTL**: Must be > 0 and ≤ 24 hours

Invalid values fall back to defaults with warnings logged.

## Benefits

This configuration system provides:

1. **Flexibility**: Adapt to different environments without code changes
2. **Performance Tuning**: Optimize for your specific hardware and network
3. **Debugging**: Enable detailed logging when troubleshooting
4. **Custom Branding**: Personalize collection labeling
5. **Maintainability**: Centralized configuration management
6. **Validation**: Prevent invalid configurations from breaking the system
7. **Backward Compatibility**: Existing deployments continue working without changes

## Next Steps

Future enhancements could include:

1. **Admin UI**: Web interface for changing settings without environment variables
2. **Per-Collection Settings**: Different timeouts/limits per collection type
3. **Dynamic Reconfiguration**: Hot-reload configuration changes without restart
4. **Configuration Profiles**: Predefined sets of optimized settings
5. **Metrics Integration**: Export configuration effectiveness metrics