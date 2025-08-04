# Project Overview

This is a Next.js application with a custom Express backend. It's a full-stack TypeScript project.

**Frontend:**
- Next.js
- React
- TypeScript
- Tailwind CSS
- PostCSS
- `react-intl` for internationalization

**Backend:**
- Express
- TypeScript
- TypeORM for database interaction
- `express-openapi-validator` for API validation

**Tooling:**
- ESLint for linting
- Prettier for formatting
- Husky for git hooks
- Cypress for end-to-end testing
- `semantic-release` for automated releases

# Building and Running

**Development:**

To run the application in development mode, use the following command:

```bash
yarn dev
```

This will start the Next.js development server and the Express backend with `nodemon` for automatic reloading.

**Production:**

To build the application for production, use the following command:

```bash
yarn build
```

This will create a production-ready build of the Next.js application and the Express backend in the `dist` directory.

To run the application in production, use the following command:

```bash
yarn start
```

**Testing:**

To run the Cypress end-to-end tests, use the following command:

```bash
yarn cypress:open
```

# Development Conventions

**Linting and Formatting:**

The project uses ESLint and Prettier to enforce code style. Before committing, the following commands are run automatically via a pre-commit hook:

- `prettier --write`
- `eslint`

**Commits:**

The project uses the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification for commit messages.

**Internationalization:**

The project uses `react-intl` for internationalization. To extract new messages from the source code, run the following command:

```bash
yarn i18n:extract
```

**Database Migrations:**

The project uses TypeORM for database migrations. To generate a new migration, run the following command:

```bash
yarn migration:generate <migration-name>
```

To run the migrations, use the following command:

```bash
yarn migration:run
```
