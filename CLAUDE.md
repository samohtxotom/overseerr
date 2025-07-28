# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Build Commands

- `yarn build` - Full build (builds both Next.js client and TypeScript server)
- `yarn build:next` - Build Next.js client only
- `yarn build:server` - Build TypeScript server only

### Development

- `yarn dev` - Start development server with hot reload
- `yarn start` - Start production server

### Code Quality

- `yarn lint` - Run ESLint on both server and client code
- `yarn format` - Format code with Prettier
- `yarn format:check` - Check if code is properly formatted
- `yarn typecheck` - Run TypeScript type checking for both client and server
- `yarn typecheck:server` - Type check server code only
- `yarn typecheck:client` - Type check client code only

### Database & Migrations

- `yarn migration:generate` - Generate new TypeORM migration
- `yarn migration:create` - Create empty migration file
- `yarn migration:run` - Run pending migrations

### Testing

- `yarn cypress:open` - Open Cypress test runner
- `yarn cypress:prepare` - Prepare test database
- `yarn cypress:build` - Build app and prepare for testing

### Internationalization

- `yarn i18n:extract` - Extract translatable messages

## Architecture Overview

### Technology Stack

- **Frontend**: Next.js 12 with React 18, TypeScript, Tailwind CSS
- **Backend**: Express.js with TypeScript, TypeORM
- **Database**: SQLite (with TypeORM for migrations and entities)
- **Authentication**: Plex OAuth integration with session-based auth
- **API Integration**: TMDb API, Plex API, Sonarr/Radarr APIs

### Project Structure

#### Frontend (`src/`)

- **pages/**: Next.js pages and routing
- **components/**: Reusable React components organized by feature
- **context/**: React contexts for global state (Settings, User, Language)
- **hooks/**: Custom React hooks
- **i18n/**: Internationalization files and locale data
- **utils/**: Utility functions

#### Backend (`server/`)

- **routes/**: Express API routes organized by resource
- **entity/**: TypeORM database entities
- **lib/**: Core business logic (notifications, settings, sync)
- **api/**: External API integrations (Plex, TMDb, Sonarr, Radarr)
- **job/**: Background job scheduling
- **migration/**: Database migration files
- **middleware/**: Express middleware

### Key Architectural Patterns

#### API Design

- RESTful API with OpenAPI specification (`overseerr-api.yml`)
- All routes under `/api/v1/` prefix
- Request/response validation using express-openapi-validator

#### Database

- TypeORM with SQLite for development/production
- Entities define both database schema and TypeScript types
- Migrations handle schema changes

#### Authentication & Authorization

- Plex OAuth for user authentication
- Session-based authentication with express-session
- Permission system with granular access control
- CSRF protection enabled by default

#### Frontend State Management

- SWR for API data fetching and caching
- React Context for global application state
- No additional state management library (Redux, Zustand, etc.)

#### Internationalization

- React Intl for frontend internationalization
- Message extraction from components
- Support for 25+ languages

### Key Integration Points

#### Plex Integration

- User authentication via Plex OAuth
- Library syncing and media availability tracking
- Watchlist synchronization

#### Media Management

- Sonarr integration for TV show requests
- Radarr integration for movie requests
- Automatic quality profile and root folder selection

#### Notification System

- Pluggable notification agents (Discord, Email, Slack, etc.)
- Configurable notification types and user preferences

### Development Notes

#### Path Aliases

- `@server/*` maps to `server/*` - use for server-side imports
- `@app/*` maps to `src/*` - use for client-side imports

#### Code Organization

- Components are organized by feature/domain
- Shared components go in `src/components/Common/`
- API routes mirror the resource structure
- Entity files contain both database schema and TypeScript interfaces

#### TypeScript Configuration

- Strict mode enabled
- Experimental decorators for TypeORM entities
- Separate tsconfig for server and client

#### Styling

- Tailwind CSS for styling
- Custom CSS in `src/styles/globals.css`
- Component-specific styles co-located with components

#### Environment & Configuration

- Settings managed via database with fallback to defaults
- Configuration files in `config/` directory
- Environment variables for deployment-specific settings

### Testing

- Cypress for end-to-end testing
- Test files in `cypress/` directory
- Database preparation script for test isolation

### Important Files

- `overseerr-api.yml` - OpenAPI specification
- `server/datasource.ts` - Database configuration
- `server/lib/settings.ts` - Application settings management
- `src/pages/_app.tsx` - Next.js app configuration and global providers
