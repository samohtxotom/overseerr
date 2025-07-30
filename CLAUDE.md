# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Overseerr is a media request management application that integrates with Plex, Sonarr, and Radarr. It's a full-stack TypeScript application with a Next.js frontend and Express.js backend.

## Development Commands

### Essential Commands

- `yarn dev` - Start development server with hot reload (backend + frontend)
- `yarn build` - Build both server and Next.js frontend (`yarn build:server && yarn build:next`)
- `yarn build:server` - Compile TypeScript server code to dist/
- `yarn build:next` - Build Next.js frontend
- `yarn start` - Start production server
- `yarn lint` - Run ESLint on server and client code
- `yarn typecheck` - Run TypeScript checks for both server and client
- `yarn format` - Format code with Prettier
- `yarn format:check` - Check code formatting

### Database & Migrations

- `yarn migration:generate` - Generate new TypeORM migration
- `yarn migration:create` - Create empty migration file
- `yarn migration:run` - Run pending migrations

### Testing

- `yarn cypress:open` - Open Cypress test runner
- `yarn cypress:prepare` - Prepare test database
- `yarn cypress:build` - Build and prepare for Cypress tests

## Architecture Overview

### Backend Structure (/server)

- **Express.js** server with TypeORM SQLite database
- **API Routes** (`/server/routes/`) - RESTful API endpoints under `/api/v1/`
- **External APIs** (`/server/api/`) - Integrations with Plex, TMDB, Sonarr, Radarr, Tautulli, Trakt
- **Core Libraries** (`/server/lib/`) - Business logic, settings, notifications, scanners, collections
- **Entities** (`/server/entity/`) - TypeORM database models
- **Middleware** (`/server/middleware/`) - Authentication, CSRF protection
- **Jobs** (`/server/job/`) - Scheduled background tasks
- **Migrations** (`/server/migration/`) - Database schema changes

### Frontend Structure (/src)

- **Next.js** with React, TypeScript, and Tailwind CSS
- **Pages** (`/src/pages/`) - Next.js file-based routing
- **Components** (`/src/components/`) - Reusable React components organized by feature
- **Hooks** (`/src/hooks/`) - Custom React hooks for state management and API calls
- **Context** (`/src/context/`) - React context providers for global state
- **i18n** (`/src/i18n/`) - Internationalization with react-intl

### Key Architectural Patterns

- **Authentication**: Session-based auth with Plex integration, stored in TypeORM sessions
- **API Validation**: OpenAPI spec validation using express-openapi-validator
- **Database**: SQLite with TypeORM, migrations for schema changes
- **Notifications**: Pluggable notification agents (Discord, Email, Telegram, etc.)
- **Media Scanning**: Modular scanners for Plex, Sonarr, Radarr integration
- **Collections**: Configurable collections from Overseerr, Tautulli, or Trakt sources
- **Caching**: In-memory caching with node-cache for API responses
- **Queue System**: Background job processing with node-schedule

## Configuration

### Settings Management

- Main settings stored in `/config/settings.json`
- Settings loaded via `getSettings()` from `server/lib/settings.ts`
- Database configuration in `server/datasource.ts` (SQLite)
- Frontend settings passed via `PublicSettingsResponse` interface

### Environment Variables

- `NODE_ENV` - production/development mode
- `CONFIG_DIRECTORY` - Path to config directory (defaults to `./config`)
- `PORT` - Server port (default: 5055)
- `HOST` - Server host binding
- `COMMIT_TAG` - Git commit tag for version tracking

## Development Workflow

### Key Files to Understand

- `server/index.ts` - Main server entry point and Express setup
- `server/routes/index.ts` - API route registration and middleware
- `src/pages/_app.tsx` - Next.js app wrapper with providers and authentication
- `server/lib/settings.ts` - Settings management system
- `server/datasource.ts` - Database configuration and repository access

### Adding New Features

1. **API Endpoints**: Add routes in `server/routes/` with authentication middleware
2. **Database Changes**: Create TypeORM migrations in `server/migration/`
3. **Frontend Pages**: Add to `src/pages/` following Next.js conventions
4. **Components**: Create reusable components in `src/components/`
5. **External Integrations**: Add API clients in `server/api/`

### Testing Strategy

- Cypress for E2E testing (`/cypress/`)
- ESLint + Prettier for code quality
- TypeScript strict mode for type safety
- OpenAPI spec validation for API contracts

## Important Implementation Notes

### Collections System

- Collections sync from multiple sources (Overseerr, Tautulli, Trakt)
- Collection configuration managed in settings with templates
- Sync jobs handle fetching and updating collection data
- Collection visibility controls (shared/admin/none)

### Media Request Flow

- Users request movies/TV shows through frontend
- Requests stored in database with approval workflow
- Integration with Sonarr/Radarr for automatic downloading
- Notification system alerts users of status changes

### Authentication & Permissions

- Plex-based authentication with local user fallback
- Granular permission system using bitwise flags
- Session management with TypeORM session store
- CSRF protection configurable via settings

### Notification System

- Multiple notification agents (Discord, Email, Telegram, etc.)
- Template-based notification content with Pug templates
- Configurable notification types per user
- Web push notifications support

When working on this codebase, always run `yarn lint` and `yarn typecheck` before committing changes to ensure code quality and type safety.

## Current Feature Branch: Plex Collections Enhancement

This branch (`plex-collections`) is implementing enhanced Plex collections functionality with the following key features:

### What's Being Built

- **User-based Plex Collections**: Create collections in users' Plex libraries based on their requests/watchlists
- **Multi-source Collections**: Support for Overseerr, Tautulli, and Trakt as collection data sources
- **Collection Sync Management**: Manual and automated synchronization of collections
- **Plex Pass Integration**: Enhanced features for Plex Pass subscribers
- **Advanced Collection Controls**: Label management, sorting, and visibility controls

### Key New Components & Files

#### Backend Changes

- **`server/api/plexapi.ts`**: Major expansion with collection management methods:

  - `getAllCollections()` - Fetch all collections from Plex libraries
  - `createCollectionWithItems()` - Create collections with bulk item addition
  - `addItemsToCollection()` - Add items to existing collections (bulk and individual)
  - `removeItemsFromCollection()` - Remove items from collections
  - `addLabelToCollection()` - Add Overseerr labels while preserving user labels
  - `updateCollectionTitle()` / `updateCollectionSortTitle()` - Update collection metadata
  - `checkPlexPass()` - Verify Plex Pass subscription status

- **`server/lib/collectionsSync.ts`**: Core collection synchronization logic
- **`server/lib/collectionsUtils.ts`**: Utility functions for collection processing
- **`server/lib/tautulliCollectionSync.ts`**: Tautulli-specific collection sync
- **`server/lib/traktCollectionSync.ts`**: Trakt-specific collection sync
- **`server/routes/settings/collections.ts`**: Collection settings API endpoints

#### Frontend Changes

- **`src/components/Settings/SettingsPlex.tsx`**: Enhanced Plex settings with collection controls
- Collections sync status UI with progress tracking
- Manual sync trigger buttons
- Collection configuration interface

#### API Extensions

- **`overseerr-api.yml`**: New endpoints for collection sync management:
  - `GET /settings/plex/collections/sync` - Get sync status
  - `POST /settings/plex/collections/sync` - Trigger manual sync

### Technical Implementation Details

#### Collection Label System

- Uses Plex collection labels to identify Overseerr-managed collections
- Preserves user's custom labels while adding/updating Overseerr labels
- Label format: `overseerr:user:{userId}:{collectionType}`

#### Sync Architecture

- Progress tracking with detailed status reporting
- Bulk operations with fallback to individual item processing
- Error handling with detailed logging
- Plex Pass feature detection and conditional functionality

#### Data Flow

1. Collection configurations stored in settings
2. Sync jobs fetch data from configured sources (Overseerr/Tautulli/Trakt)
3. Transform data into Plex collection format
4. Create/update collections in user's Plex libraries
5. Apply appropriate labels and metadata

### Development Notes for This Branch

#### Working with Plex API

- Use the enhanced PlexAPI class methods for collection operations
- Handle both bulk and individual item operations (bulk preferred for performance)
- Always preserve existing user labels when updating collections
- Check Plex Pass status before using advanced features

#### Collection Sync Patterns

- Use progress tracking for long-running operations
- Implement proper error handling and logging
- Support cancellation of sync operations
- Maintain order of items (chronological request order, not alphabetical)

#### Testing Collection Features

- Test with both Plex Pass and non-Plex Pass accounts
- Verify label preservation during updates
- Test bulk vs individual item operations
- Validate collection ordering and metadata

#### Settings Integration

- Collection configurations are stored in the main settings system
- Use `getSettings().collections` to access collection settings
- Settings changes require restart flag for some operations

This feature significantly expands Overseerr's integration with Plex by allowing users to automatically maintain collections in their Plex libraries based on their Overseerr activity.
