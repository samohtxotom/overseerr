describe('Plex Collections Settings', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
    cy.intercept('/api/v1/settings/plex/collections/sync').as(
      'getCollectionsSync'
    );
    cy.intercept('POST', '/api/v1/settings/plex/collections/sync').as(
      'startCollectionsSync'
    );
  });

  it('opens the plex settings page and shows collections settings', () => {
    cy.visit('/settings/plex');

    cy.get('[data-testid=collections-sync-section]').should('be.visible');
    cy.get('[data-testid=collections-sync-toggle]').should('exist');
    cy.get('[data-testid=collections-sync-description]').should(
      'contain',
      'automatically create collections'
    );
  });

  it('can enable and disable collections sync', () => {
    cy.visit('/settings/plex');

    // Enable collections sync
    cy.get('[data-testid=collections-sync-toggle]').click();
    cy.get('[data-testid=settings-plex-form]').submit();

    // Verify it's enabled after reload
    cy.reload();
    cy.get('[data-testid=collections-sync-toggle]').should('be.checked');

    // Disable collections sync
    cy.get('[data-testid=collections-sync-toggle]').click();
    cy.get('[data-testid=settings-plex-form]').submit();

    // Verify it's disabled after reload
    cy.reload();
    cy.get('[data-testid=collections-sync-toggle]').should('not.be.checked');
  });

  it('shows manual sync button when collections are enabled', () => {
    cy.visit('/settings/plex');

    // Enable collections sync first
    cy.get('[data-testid=collections-sync-toggle]').check();
    cy.get('[data-testid=settings-plex-form]').submit();

    // Manual sync button should be visible
    cy.get('[data-testid=manual-collections-sync-button]').should('be.visible');
    cy.get('[data-testid=manual-collections-sync-button]').should(
      'not.be.disabled'
    );
  });

  it('can trigger manual collections sync', () => {
    // Mock successful sync response
    cy.intercept('POST', '/api/v1/settings/plex/collections/sync', {
      statusCode: 200,
      body: {
        status: 'success',
        message: 'Collections sync started successfully',
        hasPlexPass: true,
      },
    }).as('startSync');

    cy.visit('/settings/plex');

    // Enable collections sync
    cy.get('[data-testid=collections-sync-toggle]').check();
    cy.get('[data-testid=settings-plex-form]').submit();

    // Trigger manual sync
    cy.get('[data-testid=manual-collections-sync-button]').click();

    cy.wait('@startSync');

    // Should show success message
    cy.get('[data-testid=sync-success-message]').should('be.visible');
    cy.get('[data-testid=sync-success-message]').should(
      'contain',
      'Collections sync started successfully'
    );
  });

  it('shows sync progress when sync is running', () => {
    // Mock sync status as running
    cy.intercept('/api/v1/settings/plex/collections/sync', {
      statusCode: 200,
      body: {
        running: true,
        cancelled: false,
        progress: {
          running: true,
          cancelled: false,
          currentStep: 'Processing user collections',
          progress: 45,
          total: 100,
          details: {
            usersProcessed: 2,
            totalUsers: 5,
            collectionsCreated: 3,
            collectionsUpdated: 1,
            collectionsDeleted: 0,
          },
        },
      },
    }).as('getSyncProgress');

    cy.visit('/settings/plex');

    cy.wait('@getSyncProgress');

    // Should show progress indicators
    cy.get('[data-testid=sync-progress-section]').should('be.visible');
    cy.get('[data-testid=sync-progress-bar]').should('be.visible');
    cy.get('[data-testid=sync-current-step]').should(
      'contain',
      'Processing user collections'
    );
    cy.get('[data-testid=sync-progress-percentage]').should('contain', '45%');
  });

  it('handles sync errors gracefully', () => {
    // Mock sync error response
    cy.intercept('POST', '/api/v1/settings/plex/collections/sync', {
      statusCode: 400,
      body: {
        status: 'error',
        message: 'Plex collections are not enabled',
      },
    }).as('startSyncError');

    cy.visit('/settings/plex');

    // Enable collections sync
    cy.get('[data-testid=collections-sync-toggle]').check();
    cy.get('[data-testid=settings-plex-form]').submit();

    // Trigger manual sync
    cy.get('[data-testid=manual-collections-sync-button]').click();

    cy.wait('@startSyncError');

    // Should show error message
    cy.get('[data-testid=sync-error-message]').should('be.visible');
    cy.get('[data-testid=sync-error-message]').should(
      'contain',
      'Plex collections are not enabled'
    );
  });

  it('shows plex pass requirement warning when user lacks plex pass', () => {
    // Mock sync response without Plex Pass
    cy.intercept('POST', '/api/v1/settings/plex/collections/sync', {
      statusCode: 200,
      body: {
        status: 'success',
        message: 'Collections sync completed successfully',
        hasPlexPass: false,
      },
    }).as('startSyncNoPass');

    cy.visit('/settings/plex');

    // Enable collections sync
    cy.get('[data-testid=collections-sync-toggle]').check();
    cy.get('[data-testid=settings-plex-form]').submit();

    // Trigger manual sync
    cy.get('[data-testid=manual-collections-sync-button]').click();

    cy.wait('@startSyncNoPass');

    // Should show Plex Pass warning
    cy.get('[data-testid=plex-pass-warning]').should('be.visible');
    cy.get('[data-testid=plex-pass-warning]').should('contain', 'Plex Pass');
  });

  it('can cancel running sync', () => {
    // Mock running sync
    cy.intercept('/api/v1/settings/plex/collections/sync', {
      statusCode: 200,
      body: {
        running: true,
        cancelled: false,
        progress: {
          running: true,
          cancelled: false,
          currentStep: 'Processing user collections',
          progress: 30,
          total: 100,
          details: {
            usersProcessed: 1,
            totalUsers: 5,
            collectionsCreated: 1,
            collectionsUpdated: 0,
            collectionsDeleted: 0,
          },
        },
      },
    }).as('getRunningSyncStatus');

    // Mock cancel response
    cy.intercept('DELETE', '/api/v1/settings/plex/collections/sync', {
      statusCode: 200,
      body: {
        status: 'success',
        message: 'Collections sync cancelled',
      },
    }).as('cancelSync');

    cy.visit('/settings/plex');

    cy.wait('@getRunningSyncStatus');

    // Should show cancel button when sync is running
    cy.get('[data-testid=cancel-sync-button]').should('be.visible');
    cy.get('[data-testid=cancel-sync-button]').click();

    cy.wait('@cancelSync');

    // Should show cancellation message
    cy.get('[data-testid=sync-cancelled-message]').should('be.visible');
  });
});
