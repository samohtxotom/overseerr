# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Overseerr is a media request management application that integrates with Plex, Sonarr, and Radarr. It provides a web interface for users to request movies and TV shows, with approval workflows and notifications.

## Architecture

This is a full-stack TypeScript application with:

- **Backend**: Express.js server (`server/`) with TypeORM for database management
- **Frontend**: Next.js React application (`src/`) with TailwindCSS for styling
- **Database**: SQLite with TypeORM migrations
- **API Documentation**: OpenAPI/Swagger specification in `overseerr-api.yml`

### Key Architectural Components

**Server Architecture** (`server/`):
- `index.ts` - Main Express server setup with middleware, session management, and OpenAPI validation
- `routes/` - API endpoints organized by feature (auth, movies, tv, requests, settings, etc.)
- `lib/` - Core business logic including notifications, scanners, permissions, and collections sync
- `entity/` - TypeORM database entities (User, Media, MediaRequest, etc.)
- `api/` - External API integrations (Plex, TMDB, Sonarr, Radarr, Trakt, etc.)
- `job/` - Scheduled background jobs
- `middleware/` - Authentication and other middleware

**Client Architecture** (`src/`):
- `pages/` - Next.js file-based routing with dynamic routes for movies, TV shows, users, etc.
- `components/` - Reusable React components organized by feature
- `hooks/` - Custom React hooks for data fetching and state management
- `context/` - React context providers for global state (User, Settings, Language)
- `utils/` - Utility functions and helpers

**Collections System** (`server/lib/collections/`):
- New modular collections sync system with support for multiple data sources
- `BaseCollectionSync.ts` - Abstract base class for all collection sync implementations
- Service-specific implementations: Tautulli, Trakt, TMDB, IMDB, Overseerr
- `AutoRequestService.ts` - Handles automatic requesting of collection items
- `TemplateEngine.ts` - Template processing for collection names
- `LibraryConfigExpander.ts` - Expands "all libraries" configs into library-specific configs

## Development Commands

**Building and Running:**
```bash
# Development mode (with hot reload)
yarn dev

# Build for production
yarn build          # Builds both client and server
yarn build:next     # Build Next.js client only
yarn build:server   # Build server only

# Start production server
yarn start
```

**Code Quality:**
```bash
# Linting and type checking
yarn lint           # ESLint for both client and server
yarn typecheck      # TypeScript compilation check for both
yarn typecheck:server  # Server-only typecheck
yarn typecheck:client  # Client-only typecheck

# Code formatting
yarn format         # Format code with Prettier
yarn format:check   # Check formatting without changes
```

**Database:**
```bash
# Database migrations
yarn migration:generate    # Generate new migration
yarn migration:create      # Create empty migration
yarn migration:run         # Run pending migrations
```

**Testing:**
```bash
# Cypress end-to-end tests
yarn cypress:open          # Open Cypress UI
yarn cypress:prepare       # Prepare test database
yarn cypress:build         # Build and prepare for testing
```

**Internationalization:**
```bash
yarn i18n:extract          # Extract translatable strings
```

## Key Configuration Files

- `next.config.js` - Next.js configuration with SVG support and image domains
- `tsconfig.json` - TypeScript configuration with path aliases (`@server/*`, `@app/*`)
- `server/tsconfig.json` - Server-specific TypeScript configuration
- `tailwind.config.js` - TailwindCSS configuration
- `overseerr-api.yml` - OpenAPI specification for API documentation

## Development Guidelines

**Path Aliases:**
- Use `@server/*` for server-side imports
- Use `@app/*` for client-side imports within src/

**Database Patterns:**
- All entities extend TypeORM base classes
- Migrations are auto-generated and manually reviewed
- Database runs in WAL mode with foreign key support

**API Patterns:**
- All routes use Express router with middleware for authentication
- OpenAPI validation is enforced on all endpoints
- Session-based authentication with TypeORM session store
- CSRF protection available via settings

**Component Patterns:**
- Components organized by feature in folders with index.tsx
- Use React hooks for state management and data fetching
- SWR for client-side data fetching and caching
- Context providers for global state (user, settings, language)

**External API Integration:**
- API clients in `server/api/` for Plex, TMDB, Sonarr, Radarr, etc.
- Rate limiting and error handling for external requests
- Caching layer for frequently accessed data

**Collections System:**
- Service classes extend `BaseCollectionSync` for different data sources
- Template engine supports dynamic collection naming
- Library-specific configuration expansion for Plex home screen ordering
- Automatic request functionality with user filtering and quotas

**Notification System:**
- Agent-based architecture in `server/lib/notifications/agents/`
- Support for Discord, Email, Gotify, Pushover, Slack, Telegram, WebPush, Webhooks
- Template-based email notifications with Pug templates

## Common Development Tasks

**Adding New API Endpoints:**
1. Create route handler in appropriate `server/routes/` file
2. Add to OpenAPI spec in `overseerr-api.yml`
3. Add TypeScript interfaces in `server/interfaces/api/`

**Adding New Components:**
1. Create component folder in `src/components/`
2. Follow existing patterns for styling with TailwindCSS
3. Add to appropriate page in `src/pages/`

**Database Changes:**
1. Modify entities in `server/entity/`
2. Generate migration with `yarn migration:generate`
3. Review and test migration before committing

**Adding External API Integration:**
1. Create API client in `server/api/`
2. Add configuration to settings system
3. Integrate with existing scanners or create new ones

The codebase follows strict TypeScript patterns with comprehensive error handling and logging throughout.

## Project-Specific Features (This Fork)

This fork extends the upstream sct/overseerr with a comprehensive **Plex Collections System** that automatically creates and manages Plex collections based on various data sources. This is a significant enhancement over the base Overseerr functionality.

### Plex Collections System Overview

**Core Enhancement**: Automated creation and management of Plex collections from multiple data sources including Tautulli (watch statistics), Trakt (trending/popular lists), TMDB, IMDB, and Overseerr's own request data.

**Key Features Added**:
- **Multi-source collection sync**: Supports Tautulli, Trakt, TMDB, IMDB, and Overseerr data sources
- **Template-based collection naming**: Configurable collection names with user variables
- **Library-specific configurations**: Different collection configs per Plex library
- **Automatic Plex home screen ordering**: Collections sorted with special prefixes for prominence
- **User filtering with Plex Pass**: Collections can be filtered by user groups (requires Plex Pass)
- **Scheduled sync jobs**: Automated collection updates via cron jobs
- **Rich admin interface**: Complete UI for managing collection configurations

### New Architecture Components

**Server-Side Additions** (`server/lib/collections/`):
- `BaseCollectionSync.ts` - Abstract base class for all collection sync services
- `TautulliCollectionSync.ts` - Syncs collections from Tautulli watch statistics
- `TraktCollectionSync.ts` - Syncs collections from Trakt trending/popular lists  
- `TmdbCollectionSync.ts` - Syncs collections from TMDB data
- `ImdbCollectionSync.ts` - Syncs collections from IMDB data
- `OverseerrCollectionSync.ts` - Syncs collections from Overseerr request data
- `AutoRequestService.ts` - Handles automatic requesting of collection items
- `TemplateEngine.ts` - Processes collection name templates with user variables
- `LibraryConfigExpander.ts` - Expands "all libraries" configs into library-specific configs
- `ServiceUserManager.ts` - Manages user filtering and Plex Pass requirements
- `TimeRestrictionUtils.ts` - Handles time-based collection restrictions
- `types.ts` - TypeScript interfaces for the collections system

**Enhanced Core Services**:
- `collectionsSync.ts` - Main collections orchestration service (1700+ lines)
- `collectionsUtils.ts` - Utility functions for collection management (650+ lines)
- `templateUtils.ts` - Template parsing and user data utilities

**New API Integrations**:
- `server/api/tautulli.ts` - Complete Tautulli API client for watch statistics
- `server/api/trakt.ts` - Trakt API client for trending/popular data
- Enhanced `server/api/plexapi.ts` - Extended with collection management methods

**API Routes**:
- `server/routes/settings/collections.ts` - REST API for collection configuration
- Enhanced settings routes with collection management endpoints

**Database Schema**:
- `server/entity/User.ts` - Added Plex Pass and title tracking fields
- Migration `1753437344000-AddPlexTitleAndPlexPassToUser.ts` - Database schema updates

**Frontend Components**:
- `src/components/Settings/Collections/` - Complete collection management UI
- Enhanced `src/components/Settings/SettingsPlex.tsx` - Integrated collections settings
- Collection configuration forms with drag-drop ordering, template editing, library selection

### Collection Configuration System

**Collection Types Supported**:
- **Tautulli**: Most played movies/shows by duration or play count
- **Trakt**: Trending, popular, or most watched content
- **TMDB**: Various TMDB-based collections
- **IMDB**: IMDB-based collections  
- **Overseerr**: Collections based on user requests

**Configuration Options**:
- Template-based naming with user variables (`{displayName}`, `{username}`, etc.)
- Library-specific settings and sort ordering
- Media type filtering (movies, TV, or both)
- Time period restrictions (custom days for Tautulli)
- User visibility controls (all users, admin only, specific users)
- Maximum items per collection
- Automatic expansion for "all libraries" configurations

**Template System**:
- Dynamic collection naming: `"{displayName}'s Most Watched"` 
- User variable substitution with fallbacks
- Special character sanitization for Plex compatibility
- Support for custom movie vs TV templates when media type is "both"

### Plex Integration Enhancements

**Collection Management**:
- Automatic collection creation/updating in Plex
- Smart merging of existing collections (preserves user's custom items)
- Label-based user filtering (requires Plex Pass)
- Home screen prominence via sort title prefixes
- Batch processing for performance

**Plex Pass Features**:
- User-specific collection visibility via Plex labels
- Advanced filtering and access control
- Enhanced collection metadata and organization

### Development Notes for This Fork

**Key Files Modified/Added** (vs upstream):
- `server/lib/collectionsSync.ts` - 1700+ lines of collection orchestration logic
- `server/lib/collectionsUtils.ts` - 650+ lines of collection utilities
- `src/components/Settings/SettingsPlex.tsx` - 2400+ lines (vs ~73 upstream)
- Complete `server/lib/collections/` directory with modular service architecture
- New API clients for Tautulli and Trakt
- Enhanced Plex API with collection management methods

**Database Changes**:
- User entity extended with Plex Pass status and title fields
- Collection configurations stored in JSON settings
- Migration for new user fields

**Settings Integration**:
- New collection configuration API endpoints
- Frontend forms for collection management
- Real-time sync status and controls
- Library-specific configuration management

**Scheduled Jobs**:
- Automatic collection sync via cron jobs
- Configurable sync intervals
- Status monitoring and cancellation support

This collections system represents a major feature addition that transforms Overseerr from a simple request management tool into a comprehensive Plex content curation platform.

## CRITICAL: Debugging and Analysis Principles

**NEVER make premature assumptions or jump to conclusions when debugging complex issues.**

### When the user asks for "full analysis" or "complete assessment":

1. **DO THE ENTIRE ANALYSIS** - trace every single step from start to finish
2. **DO NOT STOP** at the first thing that looks like it might be the issue
3. **DO NOT make changes** until you have completed the full systematic trace
4. **DO NOT assume** you understand the problem without verifying each step

### Real Example: Collection Ordering Issue
- **Wrong approach**: Assume it's just sort direction, flip the sort, realize that doesn't work, flip it again
- **Right approach**: Trace the complete flow: UI drag → settings save → config expansion → library grouping → processing order → actual execution
- **The real issue**: Code was grouping by type and processing in hardcoded order, completely ignoring the UI sort order

### Debugging Complex Issues:
1. **Map the complete data flow** from user action to final result
2. **Verify each transformation step** - don't assume any step works correctly
3. **Check logs and actual execution** - what the code says vs. what it actually does
4. **Compare with working versions** if available (like pre-refactor behavior)
5. **Only make changes** after you have identified the exact breaking point

### Token Efficiency vs. Thoroughness:
- Shortcuts and assumptions waste MORE tokens by going in circles
- Systematic analysis saves tokens by finding the real issue quickly
- When user says "don't stop until complete" - they mean it, follow through completely

**Remember: The user knows their system better than you do. If they say an issue is tricky and requires full analysis, believe them and do exactly that.**

## Plex Hub Management System (NEW - 2025)

**CRITICAL DISCOVERY**: Plex has undocumented APIs that allow full programmatic control over home screen hub ordering and visibility, including built-in hubs like "Recently Added".

### Plex Hub vs Collection Terminology

**Hubs** = Home screen rows (horizontal scrollable sections)
- Examples: "Recently Added", "Continue Watching", promoted collections
- Technical term: "hubs" in Plex API
- What we control: Order, visibility, promotion settings

**Collections** = Groups of media items  
- Examples: "Marvel Movies", "Christmas Films", user-created collections
- When promoted: Collections become hubs on home screen
- What we control: Content, metadata, promotion to hub status

### Hub Management APIs Discovered

**Get Library Hubs:**
```
GET /hubs/sections/{libraryId}/manage
```
Returns all available hubs for a library with current settings including:
- `identifier`: Hub ID (e.g., "movie.recentlyadded", "movie.curated")
- `title`: Display name
- `promotedToRecommended`: Show in recommended section
- `promotedToOwnHome`: Show on server owner home
- `promotedToSharedHome`: Show on shared user home
- `homeVisibility`: Overall home visibility ("all", "none")  
- `recommendationsVisibility`: Recommendations visibility

**Reorder Hubs:**
```
PUT /hubs/sections/{libraryId}/manage/{hubIdentifier}/move?after={targetHubIdentifier}
```
Moves any hub (built-in or custom) to appear after target hub.

**Update Hub Visibility:**
```  
PUT /hubs/sections/{libraryId}/manage/{hubIdentifier}
```
With payload containing promotion settings (promotedToOwnHome, etc.)

### Built-in Hub Identifiers

**Movie Library Hubs:**
- `movie.recentlyadded` - Recently Added Movies
- `movie.recentlyreleased` - Recently Released Movies
- `movie.recentlyviewed` - Recently Watched Movies
- `movie.curated` - Seasonal Movies
- `movie.genre` - Top Movies in Genre
- `movie.topunwatched` - Top Unwatched Movies
- `movie.by.actor.or.director` - Top Movies by Actor/Director

**TV Library Hubs:**
- `show.recentlyadded` - Recently Added Shows
- `show.recentlyaired` - Recently Aired Shows
- `show.recentlyviewed` - Recently Watched Shows
- Similar pattern to movies

**Universal Hubs:**
- `recent.library.playlists` - Library Playlists
- `continue.watching` - Continue Watching (cannot be disabled)

### Hub Management Implementation Plan

**Phase 1: Core Hub Management**
- Add hub management methods to PlexAPI class
- Create hub listing and reordering functionality
- Implement hub visibility controls

**Phase 2: Integrated Hub Manager UI**
- Create PlexHubManager component
- Drag-and-drop interface for ALL hubs (built-in + custom)
- Unified visibility controls
- Real-time hub order management

**Phase 3: Advanced Features**
- Per-library hub management
- Hub templates and presets
- Bulk hub operations
- Hub analytics and usage tracking

### Hub Management API Methods to Implement

```typescript
// Get all hubs for a library section
async getLibraryHubs(sectionId: string): Promise<Hub[]>

// Move hub to new position
async moveHub(sectionId: string, hubId: string, afterHubId: string): Promise<void>

// Update hub visibility and promotion settings
async updateHubVisibility(sectionId: string, hubId: string, settings: HubVisibilitySettings): Promise<void>

// Get hub details
async getHubDetails(sectionId: string, hubId: string): Promise<HubDetails>

// Reset hub customizations to defaults
async resetLibraryHubs(sectionId: string): Promise<void>
```

### Key Capabilities Unlocked

✅ **Full Built-in Hub Control**: Reorder, show/hide "Recently Added", "Continue Watching", etc.
✅ **Unified Management**: Control both algorithm-generated hubs and custom collections
✅ **Drag-and-Drop Ordering**: Complete programmatic control over home screen layout
✅ **Granular Visibility**: Per-user-group visibility for any hub
✅ **Library-Specific Settings**: Different hub configurations per library
✅ **Real-time Updates**: Changes reflect immediately in Plex

### Limitations Discovered

❌ **"Continue Watching" Cannot Be Disabled**: Always visible, can be reordered but not hidden
⚠️ **Hub Availability Varies**: Not all hubs available in all library types
⚠️ **Plex Pass Features**: Some advanced hub features require Plex Pass

### Integration with Existing Collections System

The hub management system integrates seamlessly with our existing collection sync:
- **Collection Creation**: Collections can be automatically promoted to hubs
- **Visibility Control**: Collections inherit hub visibility settings
- **Ordering Integration**: Collections positioned relative to built-in hubs
- **Unified Interface**: Single UI manages both collections and hubs

This discovery transforms Overseerr into a complete **Plex Home Screen Manager** with unprecedented control over the Plex user experience.