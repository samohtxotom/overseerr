# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Overseerr is a media request management application that integrates with Plex, Sonarr, and Radarr. It's built as a full-stack TypeScript application with a Next.js frontend and Express.js backend, using TypeORM for database operations with SQLite.

## Development Commands

```bash
# Development (starts both client and server with hot reload)
yarn dev

# Build entire application
yarn build

# Build individual parts
yarn build:next        # Build Next.js frontend
yarn build:server      # Build Express.js backend

# Code quality
yarn lint              # ESLint for server and client
yarn typecheck         # TypeScript checking for both client and server
yarn typecheck:server  # Server-only TypeScript checking
yarn typecheck:client  # Client-only TypeScript checking
yarn format            # Format code with Prettier
yarn format:check      # Check code formatting

# Production
yarn start             # Start production server (requires build first)

# Database migrations
yarn migration:generate  # Generate new migration
yarn migration:create    # Create empty migration
yarn migration:run       # Run pending migrations

# Testing (Cypress end-to-end)
yarn cypress:open       # Open Cypress UI
yarn cypress:prepare    # Prepare test database
yarn cypress:build      # Build and prepare for tests

# Internationalization
yarn i18n:extract       # Extract translation strings
```

## Architecture

### Backend (`/server`)

- **Entry Point**: `server/index.ts` - Express.js server setup
- **Database**: SQLite with TypeORM, entities in `server/entity/`
- **API Routes**: RESTful endpoints in `server/routes/`
- **External APIs**: Integrations in `server/api/` (Plex, TMDB, Radarr, Sonarr)
- **Background Jobs**: Scheduled tasks in `server/job/`
- **Business Logic**: Core functionality in `server/lib/`
- **Notifications**: Multi-platform notification system in `server/lib/notifications/`
- **Middleware**: Authentication and request processing in `server/middleware/`

### Frontend (`/src`)

- **Framework**: Next.js with TypeScript and Tailwind CSS
- **Pages**: File-based routing in `src/pages/`
- **Components**: Reusable UI components in `src/components/`
- **State Management**: React Context providers in `src/context/`
- **Custom Hooks**: Shared logic in `src/hooks/`
- **Internationalization**: i18n setup in `src/i18n/`

### Key Integrations

- **Plex**: Authentication, library scanning, watchlist sync, collections management
- **Radarr/Sonarr**: Automated movie/TV show downloading
- **TMDB**: Movie and TV show metadata
- **Notification Agents**: Discord, Telegram, Email, Webhook, etc.

### Current Feature Development: Plex Collections Sync

A comprehensive system that automatically creates and manages Plex collections based on user media requests:

**Key Components**:

- `server/lib/collectionsSync.ts` - Main sync engine with progress tracking
- `server/api/plexapi.ts` - Extended with collection management methods
- `server/entity/User.ts` - Added `plexTitle` and `hasPlexPass` fields
- `src/components/Settings/SettingsPlex.tsx` - Collections settings UI
- Scheduled job integration for automated sync every 15 minutes

**Features**:

- Creates user-specific collections in Plex libraries
- Uses Plex Pass labels for user visibility restrictions
- Real-time progress tracking with ETA calculations
- Manual sync triggering and cancellation
- Comprehensive error handling and recovery
- Template-based collection naming with variables

**API Endpoints**:

- `GET /api/v1/settings/plex/collections/sync` - Get sync status
- `POST /api/v1/settings/plex/collections/sync` - Start manual sync

**Testing**:

- Cypress E2E tests in `cypress/e2e/settings/plex-collections.cy.ts`
- Test fixtures for sync progress responses

## Database

- **ORM**: TypeORM with decorators
- **Database**: SQLite (default), supports other databases
- **Migrations**: Located in `server/migration/`
- **Connection**: Configured in `server/datasource.ts`

## File Structure Guidelines

- Server-side TypeScript files use path alias `@server/*`
- Client-side files use path alias `@app/*` (maps to `src/*`)
- API routes follow REST conventions
- Components are organized by feature with index.tsx files
- All React components are functional components with TypeScript

## Testing

- **E2E Testing**: Cypress tests in `cypress/e2e/`
- **Test Database**: Separate SQLite database for testing
- **Config**: `cypress.config.ts` and `cypress/support/`

## Environment & Configuration

- **Settings**: Runtime configuration in `config/settings.json`
- **Environment**: Next.js environment variables support
- **Docker**: Multi-platform Docker builds supported
- **API Documentation**: Auto-generated OpenAPI docs at `/api-docs`

## Development Notes

- Default port: 5055
- API base: `/api/v1/`
- Database migrations are required when modifying entities
- Use TypeORM decorators for entity relationships
- Follow existing component structure when adding new UI elements
- Notification agents follow a common interface pattern
- External API integrations should include rate limiting and error handling
