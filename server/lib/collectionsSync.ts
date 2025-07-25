import PlexAPI from '@server/api/plexapi';
import PlexTvAPI from '@server/api/plextv';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import xml2js from 'xml2js';

// TYPE DEFINITIONS

interface CollectionItem {
  ratingKey: string;
  type: 'movie' | 'tv';
}

interface UserCollections {
  [userId: string]: {
    movies: CollectionItem[];
    tv: CollectionItem[];
    user: User;
  };
}

interface SharedServerXml {
  $: {
    id: string;
    username: string;
    email: string;
    userID: string;
    accessToken: string;
    name: string;
    acceptedAt: string;
    invitedAt: string;
    allowSync: string;
    allowCameraUpload: string;
    allowChannels: string;
    allowTuners: string;
    allowSubtitleAdmin: string;
    owned: string;
    allLibraries: string;
    filterAll: string;
    filterMovies: string;
    filterMusic: string;
    filterPhotos: string;
    filterTelevision: string;
  };
  Section?: {
    $: {
      id: string;
      key: string;
      title: string;
      type: string;
      shared: string;
    };
  }[];
}

interface SyncProgress {
  running: boolean;
  cancelled: boolean;
  currentStep: string;
  progress: number;
  total: number;
  isPurgeOperation: boolean;
  isManualOperation: boolean;
  eta?: number | null; // Estimated time to completion in milliseconds
  details: {
    usersProcessed: number;
    totalUsers: number;
    collectionsCreated: number;
    collectionsUpdated: number;
    collectionsDeleted: number;
  };
}

interface ProgressStep {
  name: string;
  weight: number;
  isCompleted: boolean;
  subSteps?: ProgressStep[];
  actualCount?: number;
  estimatedCount?: number;
}

interface ProgressDetails {
  eta?: number | null;
  elapsedTime?: number;
  stepsCompleted?: number;
  totalSteps?: number;
  usersProcessed?: number;
  totalUsers?: number;
  collectionsCreated?: number;
  collectionsUpdated?: number;
  collectionsDeleted?: number;
  processed?: number;
  successful?: number;
  failed?: number;
  [key: string]: unknown; // Allow additional properties for flexibility
}

interface ProgressState {
  startTime: number;
  lastUpdate: number;
  totalWeight: number;
  completedWeight: number;
  averageStepTime: number;
  stepHistory: { name: string; duration: number; timestamp: number }[];
}

// PROGRESS TRACKING SYSTEM

class ProgressTracker {
  private steps: ProgressStep[] = [];
  private state: ProgressState;
  private onProgressUpdate: (
    step: string,
    progress: number,
    details?: ProgressDetails
  ) => void;

  constructor(
    onProgressUpdate: (
      step: string,
      progress: number,
      details?: ProgressDetails
    ) => void
  ) {
    this.onProgressUpdate = onProgressUpdate;
    this.state = {
      startTime: Date.now(),
      lastUpdate: Date.now(),
      totalWeight: 0,
      completedWeight: 0,
      averageStepTime: 0,
      stepHistory: [],
    };
  }

  initializeSteps(steps: ProgressStep[]): void {
    this.steps = steps.map((step) => ({ ...step, isCompleted: false }));
    this.state.totalWeight = this.calculateTotalWeight(this.steps);
    this.state.completedWeight = 0;
    this.state.startTime = Date.now();
    this.updateProgress();
  }

  /**
   * Mark a step as completed and update progress
   */
  completeStep(stepName: string, details?: ProgressDetails): void {
    const step = this.findStep(stepName);
    if (!step || step.isCompleted) return;

    const stepStartTime = this.state.lastUpdate;
    const stepDuration = Date.now() - stepStartTime;

    // Mark step as completed
    step.isCompleted = true;

    // Update completed weight
    this.state.completedWeight += this.getStepWeight(step);

    // Track step timing for ETA calculations
    this.state.stepHistory.push({
      name: stepName,
      duration: stepDuration,
      timestamp: Date.now(),
    });

    // Update average step time (weighted by recency)
    this.updateAverageStepTime();

    this.state.lastUpdate = Date.now();
    this.updateProgress(details);
  }

  /**
   * Update a step with dynamic discovery (for steps with unknown counts)
   */
  updateStepWithDiscovery(
    stepName: string,
    actualCount: number,
    details?: ProgressDetails
  ): void {
    const step = this.findStep(stepName);
    if (!step) return;

    const oldWeight = this.getStepWeight(step);
    step.actualCount = actualCount;

    // Recalculate weights if actual count differs significantly from estimate
    const newWeight = this.getStepWeight(step);
    const weightDiff = newWeight - oldWeight;

    this.state.totalWeight += weightDiff;
    this.updateProgress(details);
  }

  /**
   * Update progress for a step that's in progress (partial completion)
   */
  updateStepProgress(
    stepName: string,
    completed: number,
    total?: number,
    details?: ProgressDetails
  ): void {
    const step = this.findStep(stepName);
    if (!step || step.isCompleted) return;

    if (total && step.estimatedCount !== total) {
      step.estimatedCount = total;
      // Recalculate total weight
      this.state.totalWeight = this.calculateTotalWeight(this.steps);
    }

    // Calculate partial completion weight
    const stepWeight = this.getStepWeight(step);
    const completionRatio = total ? Math.min(completed / total, 1) : 0;
    const partialWeight = stepWeight * completionRatio;

    // Update completed weight (subtract old partial, add new partial)
    const otherCompletedWeight = this.steps
      .filter((s) => s.isCompleted && s !== step)
      .reduce((sum, s) => sum + this.getStepWeight(s), 0);

    this.state.completedWeight = otherCompletedWeight + partialWeight;
    this.updateProgress(details);
  }

  /**
   * Get estimated time to completion
   */
  getETA(): number | null {
    if (this.state.stepHistory.length < 2 || this.state.averageStepTime === 0) {
      return null;
    }

    const remainingWeight = this.state.totalWeight - this.state.completedWeight;
    const remainingSteps = this.steps.filter((s) => !s.isCompleted).length;

    if (remainingSteps === 0) return 0;

    // Estimate based on average step time and remaining weight
    const avgWeightPerStep = this.state.totalWeight / this.steps.length;
    const estimatedRemainingTime =
      (remainingWeight / avgWeightPerStep) * this.state.averageStepTime;

    return Math.max(0, estimatedRemainingTime);
  }

  /**
   * Get current progress percentage (0-100)
   */
  getProgressPercentage(): number {
    if (this.state.totalWeight === 0) return 0;
    return Math.min(
      Math.round((this.state.completedWeight / this.state.totalWeight) * 100),
      100
    );
  }

  /**
   * Get detailed progress information
   */
  getDetailedProgress(): {
    percentage: number;
    currentStep: string;
    eta: number | null;
    stepsCompleted: number;
    totalSteps: number;
    elapsedTime: number;
  } {
    const currentStep = this.steps.find((s) => !s.isCompleted);
    return {
      percentage: this.getProgressPercentage(),
      currentStep: currentStep?.name || 'Completed',
      eta: this.getETA(),
      stepsCompleted: this.steps.filter((s) => s.isCompleted).length,
      totalSteps: this.steps.length,
      elapsedTime: Date.now() - this.state.startTime,
    };
  }

  private findStep(stepName: string): ProgressStep | undefined {
    return this.steps.find((step) => step.name === stepName);
  }

  private getStepWeight(step: ProgressStep): number {
    // Use actual count if available, otherwise use estimated count, fallback to base weight
    const multiplier = step.actualCount || step.estimatedCount || 1;
    return step.weight * multiplier;
  }

  private calculateTotalWeight(steps: ProgressStep[]): number {
    return steps.reduce((total, step) => total + this.getStepWeight(step), 0);
  }

  private updateAverageStepTime(): void {
    if (this.state.stepHistory.length === 0) return;

    // Weight recent steps more heavily for better ETA accuracy
    const recentSteps = this.state.stepHistory.slice(-5);
    const totalWeightedTime = recentSteps.reduce((sum, step, index) => {
      const weight = (index + 1) / recentSteps.length; // More recent = higher weight
      return sum + step.duration * weight;
    }, 0);

    const totalWeight = recentSteps.reduce((sum, _, index) => {
      return sum + (index + 1) / recentSteps.length;
    }, 0);

    this.state.averageStepTime =
      totalWeight > 0 ? totalWeightedTime / totalWeight : 0;
  }

  private updateProgress(details?: ProgressDetails): void {
    const progress = this.getDetailedProgress();
    this.onProgressUpdate(progress.currentStep, progress.percentage, {
      ...details,
      eta: progress.eta,
      elapsedTime: progress.elapsedTime,
      stepsCompleted: progress.stepsCompleted,
      totalSteps: progress.totalSteps,
    });
  }
}

// MAIN COLLECTIONS SYNC SERVICE

class CollectionsSync {
  private running = false;
  private cancelled = false;
  private processedCollections = new Set<string>();
  private progressTracker: ProgressTracker | null = null;
  private syncProgress: SyncProgress = {
    running: false,
    cancelled: false,
    currentStep: '',
    progress: 0,
    total: 100,
    isPurgeOperation: false,
    isManualOperation: false,
    details: {
      usersProcessed: 0,
      totalUsers: 0,
      collectionsCreated: 0,
      collectionsUpdated: 0,
      collectionsDeleted: 0,
    },
  };

  public get status() {
    return {
      running: this.running,
      cancelled: this.cancelled,
      progress: this.syncProgress,
    };
  }

  public cancel(): void {
    this.cancelled = true;
    this.syncProgress.cancelled = true;
    logger.info('Plex collections sync cancellation requested', {
      label: 'Collections Sync',
    });
  }

  private updateProgressDetails(
    step: string,
    completed: number,
    total?: number,
    details?: Partial<SyncProgress['details']>
  ): void {
    this.syncProgress.currentStep = step;

    // Set total operations if provided
    if (total !== undefined) {
      this.syncProgress.total = total;
    }

    // Calculate percentage based on completed operations
    this.syncProgress.progress =
      this.syncProgress.total > 0
        ? Math.min(Math.round((completed / this.syncProgress.total) * 100), 100)
        : 0;

    if (details) {
      Object.assign(this.syncProgress.details, details);
    }
  }

  private updateProgress(
    step: string,
    progress: number,
    details?: ProgressDetails
  ): void {
    this.syncProgress.currentStep = step;
    this.syncProgress.progress = Math.min(Math.max(progress, 0), 100);

    // Update ETA if available
    if (details?.eta !== undefined) {
      this.syncProgress.eta = details.eta;
    }

    if (details) {
      // Merge details with existing details
      Object.assign(this.syncProgress.details, details);
    }
  }

  /**
   * Initialize progress tracking for sync operations
   */
  private initializeSyncProgressTracker(): void {
    this.progressTracker = new ProgressTracker(
      (step: string, progress: number, details?: ProgressDetails) => {
        this.updateProgress(step, progress, details);
      }
    );

    // Define weighted steps for collections sync
    const syncSteps: ProgressStep[] = [
      { name: 'Connecting to Plex server', weight: 1, isCompleted: false },
      { name: 'Fetching approved requests', weight: 2, isCompleted: false },
      { name: 'Organizing requests by user', weight: 1, isCompleted: false },
      { name: 'Updating user titles', weight: 1, isCompleted: false },
      {
        name: 'Processing user collections',
        weight: 10,
        isCompleted: false,
        estimatedCount: 1,
      },
      { name: 'Updating user filters', weight: 3, isCompleted: false },
      { name: 'Cleaning up old collections', weight: 2, isCompleted: false },
    ];

    this.progressTracker.initializeSteps(syncSteps);
  }

  /**
   * Initialize progress tracking for purge operations
   */
  private initializePurgeProgressTracker(): void {
    this.progressTracker = new ProgressTracker(
      (step: string, progress: number, details?: ProgressDetails) => {
        this.updateProgress(step, progress, details);
      }
    );

    // Define weighted steps for purge operations
    const purgeSteps: ProgressStep[] = [
      { name: 'Connecting to Plex server', weight: 1, isCompleted: false },
      { name: 'Fetching collections to delete', weight: 2, isCompleted: false },
      {
        name: 'Deleting collections',
        weight: 10,
        isCompleted: false,
        estimatedCount: 1,
      },
    ];

    this.progressTracker.initializeSteps(purgeSteps);
  }

  public async run(isManual = false): Promise<void> {
    const settings = getSettings();

    if (!settings.plex.collectionsEnabled) {
      logger.warn(
        'Plex collections sync skipped - collections are disabled. Enable collections in Plex settings to run this job.',
        {
          label: 'Collections Sync',
        }
      );
      return;
    }

    if (this.running) {
      logger.warn('Collections sync already running - skipping', {
        label: 'Collections Sync',
      });
      return;
    }

    // Validate Plex configuration
    if (!settings.plex.ip || !settings.plex.machineId) {
      logger.error(
        'Plex server configuration incomplete. Please check Plex settings.',
        { label: 'Collections Sync' }
      );
      return;
    }

    // Get admin user for Plex token
    const userRepository = getRepository(User);
    const admin = await userRepository.findOne({
      where: { id: 1 },
      select: { id: true, plexToken: true },
    });

    if (!admin?.plexToken) {
      logger.warn('Plex collections sync skipped - no admin Plex token found', {
        label: 'Collections Sync',
      });
      return;
    }

    this.running = true;
    this.cancelled = false;
    this.processedCollections.clear();

    // Reset progress state
    this.syncProgress = {
      running: true,
      cancelled: false,
      currentStep: 'Initializing collections sync...',
      progress: 0,
      total: 100,
      isPurgeOperation: false,
      isManualOperation: isManual,
      details: {
        usersProcessed: 0,
        totalUsers: 0,
        collectionsCreated: 0,
        collectionsUpdated: 0,
        collectionsDeleted: 0,
      },
    };

    // Initialize progress tracking
    this.initializeSyncProgressTracker();

    const startTime = Date.now();

    try {
      // Initialize Plex client
      const plexClient = new PlexAPI({
        plexToken: admin.plexToken,
        plexSettings: settings.plex,
      });

      // Test connection
      const isConnected = await plexClient.getStatus();
      if (!isConnected) {
        throw new Error('Could not connect to Plex server');
      }

      this.progressTracker?.completeStep('Connecting to Plex server');

      // Perform the sync operations
      await this.syncCollections(plexClient);

      const duration = Date.now() - startTime;
      logger.info(
        `Plex collections sync completed successfully in ${duration}ms`,
        { label: 'Collections Sync' }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Plex collections sync failed: ${errorMessage}`, {
        label: 'Collections Sync',
        errorMessage,
      });
    } finally {
      this.running = false;
      this.cancelled = false;
      this.syncProgress.running = false;
      this.syncProgress.cancelled = false;
    }
  }

  // CORE SYNC OPERATIONS

  private async syncCollections(plexClient: PlexAPI): Promise<void> {
    if (this.cancelled) return;

    try {
      // Get all approved media requests with Plex rating keys
      const requests = await this.getApprovedRequests();
      if (this.cancelled) return;

      this.progressTracker?.completeStep('Fetching approved requests');

      // Organize by user and media type
      const userCollections = this.organizeRequestsByUser(requests);
      const userCount = Object.keys(userCollections).length;
      const totalMovies = Object.values(userCollections).reduce(
        (sum, user) => sum + user.movies.length,
        0
      );
      const totalTv = Object.values(userCollections).reduce(
        (sum, user) => sum + user.tv.length,
        0
      );

      // Update processing user collections step with actual user count
      this.progressTracker?.updateStepWithDiscovery(
        'Processing user collections',
        userCount,
        {
          totalUsers: userCount,
        }
      );

      logger.info(
        `Found ${userCount} users with ${totalMovies} movies and ${totalTv} TV shows (${requests.length} total requests)`,
        {
          label: 'Collections Sync',
        }
      );

      if (this.cancelled) return;

      this.progressTracker?.completeStep('Organizing requests by user');

      // Update missing user titles for nickname support
      await this.updateMissingUserTitles(userCollections);
      if (this.cancelled) return;

      this.progressTracker?.completeStep('Updating user titles');

      // Create/update collections for each user with progress tracking
      const collectionStats = await this.processUserCollections(
        userCollections,
        plexClient
      );

      if (this.cancelled) return;

      this.progressTracker?.completeStep('Processing user collections', {
        collectionsCreated: collectionStats.created,
        collectionsUpdated: collectionStats.updated,
      });

      // Update filters for the users we just processed
      await this.updateUserFiltersForActiveUsers(userCollections);
      if (this.cancelled) return;

      this.progressTracker?.completeStep('Updating user filters');

      // Clean up any overseerr collections that weren't processed in this sync
      const cleanupStats = await this.cleanupUnprocessedCollections(plexClient);
      if (this.cancelled) return;

      this.progressTracker?.completeStep('Cleaning up old collections', {
        collectionsDeleted: cleanupStats.deleted,
      });

      logger.info(
        `Collections sync completed: ${userCount} users, ${collectionStats.created} created, ${collectionStats.updated} updated, ${cleanupStats.deleted} deleted`,
        {
          label: 'Collections Sync',
        }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error syncing Plex collections: ${errorMessage}`);
      throw new Error(`Plex collections sync failed: ${errorMessage}`);
    }
  }

  // USER MANAGEMENT

  /**
   * Update plexTitle for users who have null values (needed for nickname support)
   */
  private async updateMissingUserTitles(
    userCollections: UserCollections
  ): Promise<void> {
    if (this.cancelled) return;

    const userRepository = getRepository(User);
    const usersNeedingUpdate: User[] = [];

    // Find users missing plexTitle
    for (const userPlexId of Object.keys(userCollections)) {
      const user = userCollections[userPlexId].user;
      if (!user.plexTitle) {
        usersNeedingUpdate.push(user);
      }
    }

    if (usersNeedingUpdate.length === 0) {
      return;
    }

    logger.info(
      `Updating plexTitle for ${usersNeedingUpdate.length} users with missing titles`,
      {
        label: 'Collections Sync',
      }
    );

    try {
      // Get admin user for Plex API access
      const mainUser = await userRepository.findOneOrFail({
        select: { id: true, plexToken: true },
        where: { id: 1 },
      });

      const plexTv = new PlexTvAPI(mainUser.plexToken ?? '');
      const plexUsersResponse = await plexTv.getUsers();

      const usersToUpdate: User[] = [];

      for (const user of usersNeedingUpdate) {
        if (this.cancelled) break;

        try {
          // Find the user in Plex API response
          const plexAccount = plexUsersResponse.MediaContainer.User.find(
            (rawUser) => rawUser.$.id === user.plexId?.toString()
          )?.$;

          if (plexAccount?.title) {
            user.plexTitle = plexAccount.title;
            usersToUpdate.push(user);
          }
        } catch (error) {
          logger.warn(
            `Failed to update plexTitle for user ${user.plexId} (${user.plexUsername}): ${error}`,
            {
              label: 'Collections Sync',
            }
          );
        }
      }

      // Batch save all user updates
      let updatedCount = 0;
      if (usersToUpdate.length > 0) {
        try {
          await userRepository.save(usersToUpdate);
          updatedCount = usersToUpdate.length;
        } catch (error) {
          logger.error('Failed to batch update user titles', {
            label: 'Collections Sync',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      logger.info(
        `Successfully updated plexTitle for ${updatedCount}/${usersNeedingUpdate.length} users`,
        {
          label: 'Collections Sync',
        }
      );
    } catch (error) {
      logger.error(`Error updating user titles: ${error}`, {
        label: 'Collections Sync',
      });
    }
  }

  /**
   * Update user filters for users we're actively processing
   */
  private async updateUserFiltersForActiveUsers(
    userCollections: UserCollections
  ): Promise<void> {
    if (this.cancelled) return;

    const userPlexIds = Object.keys(userCollections);

    let successCount = 0;
    let failureCount = 0;

    for (const userPlexId of userPlexIds) {
      if (this.cancelled) break;

      try {
        await this.updateUserFilterSettings(userPlexId, userPlexIds);
        successCount++;
      } catch (error) {
        failureCount++;
        logger.warn(`Failed to update filter for user ${userPlexId}`, {
          label: 'Collections Sync',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info(
      `User filter restrictions applied: ${successCount} successful${
        failureCount > 0 ? `, ${failureCount} failed` : ''
      }`,
      {
        label: 'Collections Sync',
      }
    );
  }

  /**
   * Get all requests that have Plex rating keys (matching Python script behavior)
   */
  private async getApprovedRequests(): Promise<MediaRequest[]> {
    const requestRepository = getRepository(MediaRequest);

    try {
      // Get ALL requests with media (matching Python script behavior)
      const completedRequests = await requestRepository
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.requestedBy', 'user')
        .leftJoinAndSelect('request.media', 'media')
        .where('request.media IS NOT NULL') // Just need media to exist
        .getMany();

      // Filter for those with rating keys
      const withRatingKeys: MediaRequest[] = [];

      for (const request of completedRequests) {
        if (this.cancelled) break;

        // Check if media exists
        if (!request.media) {
          continue;
        }

        const ratingKey = request.is4k
          ? request.media.ratingKey4k
          : request.media.ratingKey;

        // Handle various null/empty representations
        if (
          !ratingKey ||
          ratingKey === 'null' ||
          ratingKey === '' ||
          ratingKey === 'undefined'
        ) {
          continue;
        }

        // Validate that the user exists
        if (!request.requestedBy) {
          continue;
        }

        withRatingKeys.push(request);
      }

      return withRatingKeys;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error fetching approved requests: ${errorMessage}`);
      throw new Error(`Failed to fetch approved requests: ${errorMessage}`);
    }
  }

  /**
   * Organize requests by user and media type using Plex user IDs
   */
  private organizeRequestsByUser(requests: MediaRequest[]): UserCollections {
    const userCollections: UserCollections = {};

    for (const request of requests) {
      if (this.cancelled) break;

      // Use the Plex ID from the user, not the Overseerr user ID
      const userPlexId = request.requestedBy.plexId;

      if (!userPlexId) {
        continue;
      }

      // Convert to string for consistent usage
      const userPlexIdStr = userPlexId.toString();

      // Get the correct rating key based on whether it's 4K or not
      const ratingKey = request.is4k
        ? request.media?.ratingKey4k
        : request.media?.ratingKey;

      if (!ratingKey || !request.requestedBy) {
        continue;
      }

      // Initialize user collection if not exists (using Plex ID string as key)
      if (!userCollections[userPlexIdStr]) {
        userCollections[userPlexIdStr] = {
          movies: [],
          tv: [],
          user: request.requestedBy,
        };
      }

      const collectionItem: CollectionItem = {
        ratingKey: ratingKey,
        type: request.type,
      };

      if (request.type === 'movie') {
        userCollections[userPlexIdStr].movies.push(collectionItem);
      } else if (request.type === 'tv') {
        userCollections[userPlexIdStr].tv.push(collectionItem);
      }
    }

    return userCollections;
  }

  /**
   * Process collections for all users with progress tracking
   */
  private async processUserCollections(
    userCollections: UserCollections,
    plexClient: PlexAPI
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    let failed = 0;
    let usersProcessed = 0;
    const totalUsers = Object.keys(userCollections).length;

    for (const [userPlexIdStr, collections] of Object.entries(
      userCollections
    )) {
      if (this.cancelled) break;

      const user = collections.user;

      try {
        // Process movies collection
        if (collections.movies.length > 0) {
          const result = await this.createOrUpdateCollection(
            user,
            collections.movies,
            'movie',
            plexClient
          );
          if (result.isNew) {
            created++;
          } else if (result.hasChanges) {
            updated++;
          }
        }

        // Process TV collection
        if (collections.tv.length > 0) {
          const result = await this.createOrUpdateCollection(
            user,
            collections.tv,
            'tv',
            plexClient
          );
          if (result.isNew) {
            created++;
          } else if (result.hasChanges) {
            updated++;
          }
        }
      } catch (error) {
        failed++;
        const username =
          user.displayName ||
          user.plexUsername ||
          user.email ||
          `User ${userPlexIdStr}`;
        logger.error(`Failed to process collections for user ${username}`, {
          label: 'Collections Sync',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue with other users even if one fails
      }

      // Update progress after each user
      usersProcessed++;
      this.progressTracker?.updateStepProgress(
        'Processing user collections',
        usersProcessed,
        totalUsers,
        {
          usersProcessed,
          totalUsers,
          collectionsCreated: created,
          collectionsUpdated: updated,
        }
      );
    }

    if (created > 0 || updated > 0 || failed > 0) {
      const parts = [];
      if (created > 0) parts.push(`${created} created`);
      if (updated > 0) parts.push(`${updated} updated`);
      if (failed > 0) parts.push(`${failed} failed`);

      logger.info(`Collection processing completed: ${parts.join(', ')}`, {
        label: 'Collections Sync',
      });
    } else {
      logger.info('All collections are up to date', {
        label: 'Collections Sync',
      });
    }

    return { created, updated };
  }

  // COLLECTION MANAGEMENT

  /**
   * Create or update a Plex collection for a specific user
   * Returns: { isNew: boolean, hasChanges: boolean }
   */
  private async createOrUpdateCollection(
    user: User,
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    plexClient: PlexAPI
  ): Promise<{ isNew: boolean; hasChanges: boolean }> {
    if (this.cancelled) return { isNew: false, hasChanges: false };

    const collectionTitle = this.generateCollectionTitle(user);
    // Use the Plex ID for the label, not the Overseerr user ID
    const labelName = `overseerr${user.plexId}`;

    try {
      if (items.length === 0) {
        throw new Error('Cannot create collection with no items');
      }

      // Get the library for this media type
      const libraryKey = await this.getLibraryKeyByType(mediaType);
      if (!libraryKey) {
        throw new Error(
          `No enabled ${mediaType} library found. Please enable a ${mediaType} library in Plex settings.`
        );
      }

      // Get actual Plex items using rating keys
      const ratingKeys = items.map((item) => item.ratingKey);
      const plexItems = await plexClient.getItemsByRatingKeys(ratingKeys);

      if (plexItems.length === 0) {
        throw new Error(
          `No Plex items found for rating keys: ${ratingKeys.join(
            ', '
          )}. Items may not exist in Plex library.`
        );
      }

      // Check if collection already exists
      const existingCollection = await plexClient.getCollectionByName(
        collectionTitle,
        libraryKey
      );

      let isNew = false;
      let hasChanges = false;

      if (existingCollection) {
        // For now, we'll assume any existing collection needs updating
        // since we don't have an easy way to compare items without additional API calls
        hasChanges = true;

        // Update existing collection (removeItems + addItems)
        await plexClient.removeItemsFromCollection(
          existingCollection.ratingKey
        );
        await plexClient.addItemsToCollection(
          existingCollection.ratingKey,
          plexItems
        );

        // Always ensure label and sort title are set (but don't count as changes for logging)
        await plexClient.addLabelToCollection(
          existingCollection.ratingKey,
          labelName
        );

        await plexClient.updateCollectionSortTitle(
          existingCollection.ratingKey,
          `!!${collectionTitle}`
        );

        // Set collection visibility: admin collections visible on home, others hidden
        const isAdminUser = user.id === 1;
        await plexClient.updateCollectionVisibility(
          existingCollection.ratingKey,
          false, // recommended
          isAdminUser, // home - only visible for admin
          false // shared
        );
      } else {
        // Create new collection - primary method always works
        const collectionRatingKey = await plexClient.createEmptyCollection(
          collectionTitle,
          libraryKey
        );

        if (collectionRatingKey) {
          isNew = true;
          hasChanges = true;

          // Add all items to the empty collection
          for (const item of plexItems) {
            await plexClient.addItemsToCollection(collectionRatingKey, [item]);
          }

          // Add label
          await plexClient.addLabelToCollection(collectionRatingKey, labelName);

          // Set sort title
          await plexClient.updateCollectionSortTitle(
            collectionRatingKey,
            `!!${collectionTitle}`
          );

          // Set collection visibility: admin collections visible on home, others hidden
          const isAdminUser = user.id === 1;
          await plexClient.updateCollectionVisibility(
            collectionRatingKey,
            false, // recommended
            isAdminUser, // home - only visible for admin
            false // shared
          );
        } else {
          throw new Error(
            'Could not extract collection rating key from Plex response'
          );
        }
      }

      // Track that we processed this collection
      this.processedCollections.add(collectionTitle);

      return { isNew, hasChanges };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Error creating/updating collection ${collectionTitle}: ${errorMessage}`
      );
      throw new Error(
        `Collection operation failed for ${collectionTitle}: ${errorMessage}`
      );
    }
  }

  /**
   * Get library key by media type using only enabled libraries from Overseerr settings
   */
  private async getLibraryKeyByType(
    mediaType: 'movie' | 'tv'
  ): Promise<string | null> {
    try {
      const settings = getSettings();

      // Get enabled libraries from Overseerr settings
      const enabledLibraries = settings.plex.libraries.filter(
        (lib) => lib.enabled
      );

      // Find the first enabled library that matches our media type
      const targetType = mediaType === 'movie' ? 'movie' : 'show';
      const matchingLibrary = enabledLibraries.find(
        (lib) => lib.type === targetType
      );

      if (matchingLibrary) {
        return matchingLibrary.id;
      } else {
        logger.error(
          `No enabled ${mediaType} library found in Overseerr settings`,
          {
            label: 'Collections Sync',
          }
        );
        return null;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Error getting library for type ${mediaType}: ${errorMessage}`
      );
      return null;
    }
  }

  /**
   * Delete any overseerr collections that weren't updated in this sync
   * Returns cleanup statistics
   */
  private async cleanupUnprocessedCollections(
    plexClient: PlexAPI
  ): Promise<{ deleted: number }> {
    if (this.cancelled) return { deleted: 0 };

    try {
      const allCollections = await plexClient.getAllCollections();

      // Find all overseerr collections (case-insensitive)
      const overseerrCollections = allCollections.filter((collection) =>
        collection.labels?.some((label: string) =>
          label.toLowerCase().startsWith('overseerr')
        )
      );

      let deleted = 0;

      for (const collection of overseerrCollections) {
        if (this.cancelled) break;

        // If this collection wasn't processed in the current sync, delete it
        if (!this.processedCollections.has(collection.title)) {
          try {
            await plexClient.deleteCollection(collection.ratingKey);
            deleted++;
          } catch (deleteError) {
            logger.warn(`Failed to delete collection ${collection.title}`, {
              label: 'Collections Sync',
              error:
                deleteError instanceof Error
                  ? deleteError.message
                  : 'Unknown error',
            });
          }
        }
      }

      return { deleted };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Error during unprocessed collections cleanup: ${errorMessage}`
      );
      // Don't throw - cleanup failures shouldn't break main sync
      return { deleted: 0 };
    }
  }

  // CLEANUP OPERATIONS

  /**
   * Remove collections for items that are no longer requested
   * This method can be called periodically to clean up old collections
   */
  async cleanupCollections(): Promise<void> {
    try {
      logger.info('Starting periodic collections cleanup', {
        label: 'Collections Sync',
      });

      // Get admin user for Plex token
      const userRepository = getRepository(User);
      const admin = await userRepository.findOne({
        where: { id: 1 },
        select: { id: true, plexToken: true },
      });

      if (!admin?.plexToken) {
        logger.warn('No admin Plex token found, skipping cleanup');
        return;
      }

      const plexClient = new PlexAPI({
        plexToken: admin.plexToken,
        plexSettings: getSettings().plex,
      });

      // Get all collections with overseerr labels (case-insensitive)
      const allCollections = await plexClient.getAllCollections();
      const overseerrCollections = allCollections.filter((collection) =>
        collection.labels?.some((label: string) =>
          label.toLowerCase().startsWith('overseerr')
        )
      );

      // Get current approved requests
      const currentRequests = await this.getApprovedRequests();
      const currentUserPlexIds = new Set(
        currentRequests
          .map((r) => r.requestedBy.plexId?.toString())
          .filter((id): id is string => id !== undefined)
      );

      let deleted = 0;

      // Remove collections for users who no longer have any approved requests (case-insensitive)
      for (const collection of overseerrCollections) {
        const labelMatch = collection.labels?.find((label: string) =>
          label.toLowerCase().startsWith('overseerr')
        );
        if (labelMatch) {
          const userPlexId = labelMatch.replace(/^overseerr/i, ''); // Case-insensitive replace
          if (!currentUserPlexIds.has(userPlexId)) {
            await plexClient.deleteCollection(collection.ratingKey);
            deleted++;
          }
        }
      }

      logger.info(
        `Periodic collections cleanup completed: ${deleted} collections deleted from ${overseerrCollections.length} total`,
        {
          label: 'Collections Sync',
        }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error during collections cleanup: ${errorMessage}`);
      throw new Error(`Collections cleanup failed: ${errorMessage}`);
    }
  }

  /**
   * Combined purge operation - removes all Overseerr collections and user labels
   */
  async purgeAllData(isManual = false): Promise<{
    collectionsDeleted: number;
    usersProcessed: number;
    labelsSuccessful: number;
    labelsFailed: number;
  }> {
    logger.info('Starting combined purge of all Overseerr data', {
      label: 'Collections Sync',
    });

    // Set running state and initialize progress
    this.running = true;
    this.syncProgress = {
      running: true,
      cancelled: false,
      currentStep: 'Starting data purge...',
      progress: 0,
      total: 100,
      isPurgeOperation: true,
      isManualOperation: isManual,
      details: {
        usersProcessed: 0,
        totalUsers: 0,
        collectionsCreated: 0,
        collectionsUpdated: 0,
        collectionsDeleted: 0,
      },
    };

    // Initialize combined progress tracking
    this.progressTracker = new ProgressTracker(
      (step: string, progress: number, details?: ProgressDetails) => {
        this.updateProgress(step, progress, details);
      }
    );

    const combinedSteps: ProgressStep[] = [
      { name: 'Connecting to Plex server', weight: 1, isCompleted: false },
      { name: 'Fetching collections to delete', weight: 2, isCompleted: false },
      {
        name: 'Deleting collections',
        weight: 5,
        isCompleted: false,
        estimatedCount: 1,
      },
      { name: 'Connecting to Plex.tv', weight: 1, isCompleted: false },
      { name: 'Fetching users for labels', weight: 2, isCompleted: false },
      {
        name: 'Cleaning user labels',
        weight: 5,
        isCompleted: false,
        estimatedCount: 1,
      },
    ];

    this.progressTracker.initializeSteps(combinedSteps);

    try {
      const settings = getSettings();

      // Get admin user for Plex token
      const userRepository = getRepository(User);
      const admin = await userRepository.findOne({
        where: { id: 1 },
        select: { id: true, plexToken: true },
      });

      if (!admin?.plexToken) {
        throw new Error('No admin Plex token found');
      }

      // Initialize Plex client
      const plexClient = new PlexAPI({
        plexToken: admin.plexToken,
        plexSettings: settings.plex,
      });

      // Test connection
      const isConnected = await plexClient.getStatus();
      if (!isConnected) {
        throw new Error('Could not connect to Plex server');
      }

      this.progressTracker?.completeStep('Connecting to Plex server');

      // PHASE 1: Delete Collections
      const collectionsResult = await this.purgeCollectionsInternal(plexClient);

      // PHASE 2: Clean User Labels
      // Complete the "Connecting to Plex.tv" step before starting user labels
      this.progressTracker?.completeStep('Connecting to Plex.tv');
      const labelsResult = await this.purgeUserLabelsInternal(admin.plexToken);

      // Final completion
      this.syncProgress = {
        ...this.syncProgress,
        running: false,
        currentStep: 'Purge completed successfully',
        progress: 100,
        details: {
          ...this.syncProgress.details,
          collectionsDeleted: collectionsResult.deleted,
          usersProcessed: labelsResult.processed,
        },
      };

      const result = {
        collectionsDeleted: collectionsResult.deleted,
        usersProcessed: labelsResult.processed,
        labelsSuccessful: labelsResult.successful,
        labelsFailed: labelsResult.failed,
      };

      logger.info(
        `Combined purge completed: ${result.collectionsDeleted} collections deleted, ${result.usersProcessed} users processed (${result.labelsSuccessful} successful, ${result.labelsFailed} failed)`,
        {
          label: 'Collections Sync',
        }
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.syncProgress = {
        ...this.syncProgress,
        running: false,
        currentStep: `Purge failed: ${errorMessage}`,
        progress: 0,
      };

      logger.error(`Error during combined purge: ${errorMessage}`);
      throw new Error(`Combined purge failed: ${errorMessage}`);
    } finally {
      this.running = false;
      this.progressTracker = null;
    }
  }

  /**
   * Internal method for collections purge (used by combined operation)
   */
  private async purgeCollectionsInternal(
    plexClient: PlexAPI
  ): Promise<{ deleted: number }> {
    // Get all collections with overseerr labels
    const allCollections = await plexClient.getAllCollections();
    const overseerrCollections = allCollections.filter((collection) =>
      collection.labels?.some((label: string) =>
        label.toLowerCase().startsWith('overseerr')
      )
    );

    const totalCollections = overseerrCollections.length;

    // Update the deleting collections step with actual collection count
    this.progressTracker?.updateStepWithDiscovery(
      'Deleting collections',
      totalCollections
    );

    this.progressTracker?.completeStep('Fetching collections to delete');

    let deleted = 0;

    // Delete all overseerr collections
    for (let i = 0; i < overseerrCollections.length; i++) {
      const collection = overseerrCollections[i];
      try {
        await plexClient.deleteCollection(collection.ratingKey);
        deleted++;

        // Update progress based on deletion progress
        this.progressTracker?.updateStepProgress(
          'Deleting collections',
          deleted,
          totalCollections,
          {
            collectionsDeleted: deleted,
          }
        );

        if (this.cancelled) break;
      } catch (error) {
        logger.warn(
          `Failed to delete collection ${collection.title} (${collection.ratingKey})`,
          {
            label: 'Collections Sync',
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }
    }

    this.progressTracker?.completeStep('Deleting collections');
    return { deleted };
  }

  /**
   * Internal method for user labels purge (used by combined operation)
   */
  private async purgeUserLabelsInternal(plexToken: string): Promise<{
    processed: number;
    successful: number;
    failed: number;
  }> {
    // Initialize PlexTV API to get user data with server settings
    const plexTvClient = new PlexTvAPI(plexToken);
    const plexUsersResponse = await plexTvClient.getUsers();
    const plexUsers = plexUsersResponse.MediaContainer.User;

    // Note: 'Connecting to Plex.tv' step is completed by the caller in combined operations

    // Get all users with Plex IDs from our database
    const userRepository = getRepository(User);
    const users = await userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.plexId',
        'user.email',
        'user.plexUsername',
        'user.plexTitle',
        'user.username',
      ])
      .where('user.plexId IS NOT NULL')
      .getMany();

    // Update processing user labels step with actual user count
    this.progressTracker?.updateStepWithDiscovery(
      'Cleaning user labels',
      users.length,
      {
        totalUsers: users.length,
      }
    );

    this.progressTracker?.completeStep('Fetching users for labels');

    let processed = 0;
    let successful = 0;
    let failed = 0;

    // Process each user's label restrictions
    for (const user of users) {
      if (this.cancelled) break;

      // Skip admin user (ID 1) or users without plexId
      if (user.id === 1 || !user.plexId) {
        processed++;
        continue;
      }

      try {
        const plexUser = plexUsers.find(
          (pu: any) => pu.$.id === user.plexId?.toString()
        );
        if (!plexUser) {
          processed++;
          failed++;
          continue;
        }

        // Get current restrictions
        const currentMovieFilter = plexUser.$.filterMovies || '';
        const currentTvFilter = plexUser.$.filterTelevision || '';

        // Clean overseerr labels from filters
        const cleanedMovieFilter =
          this.cleanOverseerrLabels(currentMovieFilter);
        const cleanedTvFilter = this.cleanOverseerrLabels(currentTvFilter);

        // Only update if filters actually changed
        if (
          cleanedMovieFilter !== currentMovieFilter ||
          cleanedTvFilter !== currentTvFilter
        ) {
          const settings = getSettings();
          const url = `https://plex.tv/api/friends/${user.plexId}`;
          const headers = {
            'X-Plex-Token': plexToken,
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          };

          const payload = {
            server_id: settings.plex.machineId,
            filterMovies: cleanedMovieFilter,
            filterTelevision: cleanedTvFilter,
          };

          const formData = this.createFormData(payload);

          const response = await fetch(url, {
            method: 'PUT',
            headers: headers,
            body: formData,
          });

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}: ${await response.text()}`
            );
          }
        }

        processed++;
        successful++;

        // Update progress
        this.progressTracker?.updateStepProgress(
          'Cleaning user labels',
          processed,
          users.length,
          {
            usersProcessed: processed,
          }
        );
      } catch (error) {
        processed++;
        failed++;
        logger.warn(
          `Failed to clean labels for user ${
            user.plexUsername || user.username
          }`,
          {
            label: 'Collections Sync',
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }
    }

    this.progressTracker?.completeStep('Cleaning user labels');
    return { processed, successful, failed };
  }

  /**
   * Purge all Overseerr collections from Plex
   */
  async purgeAllCollections(isManual = false): Promise<{ deleted: number }> {
    logger.info('Starting purge of all Overseerr collections', {
      label: 'Collections Sync',
    });

    // Set running state and initialize progress
    this.running = true;
    this.syncProgress = {
      running: true,
      cancelled: false,
      currentStep: 'Starting collections purge...',
      progress: 0,
      total: 100,
      isPurgeOperation: true,
      isManualOperation: isManual,
      details: {
        usersProcessed: 0,
        totalUsers: 0,
        collectionsCreated: 0,
        collectionsUpdated: 0,
        collectionsDeleted: 0,
      },
    };

    // Initialize progress tracking for purge
    this.initializePurgeProgressTracker();

    try {
      // Get admin user for Plex token
      const userRepository = getRepository(User);
      const admin = await userRepository.findOne({
        where: { id: 1 },
        select: { id: true, plexToken: true },
      });

      if (!admin?.plexToken) {
        throw new Error('No admin Plex token found');
      }

      const settings = getSettings();

      // Initialize Plex client
      const plexClient = new PlexAPI({
        plexToken: admin.plexToken,
        plexSettings: settings.plex,
      });

      // Test connection
      const isConnected = await plexClient.getStatus();
      if (!isConnected) {
        throw new Error('Could not connect to Plex server');
      }

      this.progressTracker?.completeStep('Connecting to Plex server');

      // Get all collections with overseerr labels
      const allCollections = await plexClient.getAllCollections();
      const overseerrCollections = allCollections.filter((collection) =>
        collection.labels?.some((label: string) =>
          label.toLowerCase().startsWith('overseerr')
        )
      );

      const totalCollections = overseerrCollections.length;

      // Update the deleting collections step with actual collection count
      this.progressTracker?.updateStepWithDiscovery(
        'Deleting collections',
        totalCollections
      );

      this.progressTracker?.completeStep('Fetching collections to delete');

      let deleted = 0;

      // Delete all overseerr collections with progress tracking
      for (let i = 0; i < overseerrCollections.length; i++) {
        const collection = overseerrCollections[i];
        try {
          await plexClient.deleteCollection(collection.ratingKey);
          deleted++;

          // Update progress based on deletion progress
          this.progressTracker?.updateStepProgress(
            'Deleting collections',
            i + 1,
            totalCollections,
            { collectionsDeleted: deleted }
          );
        } catch (error) {
          logger.warn(`Failed to delete collection ${collection.title}`, {
            label: 'Collections Sync',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      this.progressTracker?.completeStep('Deleting collections', {
        collectionsDeleted: deleted,
      });

      logger.info(`Purged ${deleted} Overseerr collections`, {
        label: 'Collections Sync',
      });

      return { deleted };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error during collections purge: ${errorMessage}`);
      throw new Error(`Collections purge failed: ${errorMessage}`);
    } finally {
      this.running = false;
      this.syncProgress.running = false;
    }
  }

  /**
   * Extract domain from URL (e.g., "https://wheelerflix.com/path" -> "wheelerflix.com")
   */
  private extractDomain(url?: string): string {
    if (!url) return '';
    try {
      // Handle URLs without protocol
      const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`;
      const domain = new URL(urlWithProtocol).hostname;
      return domain;
    } catch {
      // If URL parsing fails, try to extract domain manually
      const cleanUrl = url
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        .split(':')[0];
      return cleanUrl || '';
    }
  }

  /**
   * Get user display name in preferred order
   */
  private getUserDisplayName(user: User): string {
    return (
      user.displayName ||
      user.plexUsername ||
      user.email ||
      `User ${user.plexId}`
    );
  }

  /**
   * Parse collection name template with variable substitution
   */
  private parseCollectionTemplate(template: string, user: User): string {
    const settings = getSettings();

    const variables: Record<string, string> = {
      username: (
        user.plexUsername ||
        user.username ||
        user.email ||
        ''
      ).replace(/[<>"'&]/g, ''),
      nickname: (user.plexTitle || user.displayName || '').replace(
        /[<>"'&]/g,
        ''
      ),
      domain: this.extractDomain(
        settings.main.applicationUrl || settings.plex.webAppUrl
      ),
      appTitle: settings.main.applicationTitle || 'Overseerr',
      user: this.getUserDisplayName(user).replace(/[<>"'&]/g, ''),
      site: settings.main.applicationTitle || 'Overseerr',
    };

    // Replace all variables in the template
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      result = result.replace(regex, value || '');
    }

    // Clean up any extra spaces and ensure we have a valid collection name
    result = result.replace(/\s+/g, ' ').trim();

    // Remove any remaining potentially problematic characters
    result = result.replace(/[<>"'&]/g, '');

    // Fallback to basic format if result is empty or just whitespace
    if (!result || result.length === 0) {
      result = `Requested by ${this.getUserDisplayName(user).replace(
        /[<>"'&]/g,
        ''
      )}`;
    }

    return result;
  }

  /**
   * Generate collection title using template system with backwards compatibility
   */
  private generateCollectionTitle(user: User): string {
    const settings = getSettings();

    // Use new template system if available
    if (settings.plex.collectionTemplate) {
      return this.parseCollectionTemplate(
        settings.plex.collectionTemplate,
        user
      );
    }

    // Ultimate fallback
    return `${this.getUserDisplayName(user).replace(
      /[<>"'&]/g,
      ''
    )}'s requests`;
  }

  /**
   * Convert payload object to URL-encoded form data string
   */
  private createFormData(payload: Record<string, string | undefined>): string {
    return Object.entries(payload)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value ?? '')}`
      )
      .join('&');
  }

  /**
   * Clean Overseerr labels from filter strings while preserving other labels
   */
  private cleanOverseerrLabels(filterStr: string): string {
    if (!filterStr) return '';

    // Parse label filters (format: "label!=value1,value2,value3")
    const parts = filterStr.split('!=');
    if (parts.length !== 2 || parts[0] !== 'label') {
      // Not a label filter, return as-is
      return filterStr;
    }

    // Remove only overseerr labels (case-insensitive)
    const labels = parts[1]
      .split(',')
      .filter((label: string) => !label.toLowerCase().startsWith('overseerr'));

    // Return cleaned filter or empty if no labels remain
    return labels.length > 0 ? `label!=${labels.join(',')}` : '';
  }

  /**
   * Purge all user label restrictions from Plex.tv
   */
  async purgeUserLabels(isManual = false): Promise<{
    processed: number;
    successful: number;
    failed: number;
  }> {
    logger.info('Starting purge of all user label restrictions', {
      label: 'Collections Sync',
    });

    // Set running state and initialize progress
    this.running = true;
    this.syncProgress = {
      running: true,
      cancelled: false,
      currentStep: 'Starting user labels purge...',
      progress: 0,
      total: 100,
      isPurgeOperation: true,
      isManualOperation: isManual,
      details: {
        usersProcessed: 0,
        totalUsers: 0,
        collectionsCreated: 0,
        collectionsUpdated: 0,
        collectionsDeleted: 0,
      },
    };

    // Initialize progress tracking for user labels purge
    this.progressTracker = new ProgressTracker(
      (step: string, progress: number, details?: ProgressDetails) => {
        this.updateProgress(step, progress, details);
      }
    );

    const purgeSteps: ProgressStep[] = [
      { name: 'Connecting to Plex.tv', weight: 1, isCompleted: false },
      { name: 'Fetching users', weight: 2, isCompleted: false },
      {
        name: 'Processing user labels',
        weight: 10,
        isCompleted: false,
        estimatedCount: 1,
      },
    ];

    this.progressTracker.initializeSteps(purgeSteps);

    try {
      const settings = getSettings();

      // Get admin user for Plex token
      const userRepository = getRepository(User);
      const admin = await userRepository.findOne({
        select: { id: true, plexToken: true },
        where: { id: 1 },
      });

      if (!admin?.plexToken) {
        throw new Error('No admin Plex token found');
      }

      // Initialize PlexTV API to get user data with server settings
      const plexTvClient = new PlexTvAPI(admin.plexToken);
      const plexUsersResponse = await plexTvClient.getUsers();
      const plexUsers = plexUsersResponse.MediaContainer.User;

      this.progressTracker?.completeStep('Connecting to Plex.tv');

      // Get all users with Plex IDs from our database
      const users = await userRepository
        .createQueryBuilder('user')
        .select([
          'user.id',
          'user.plexId',
          'user.email',
          'user.plexUsername',
          'user.plexTitle',
          'user.username',
        ])
        .where('user.plexId IS NOT NULL')
        .getMany();

      // Update processing user labels step with actual user count
      this.progressTracker?.updateStepWithDiscovery(
        'Processing user labels',
        users.length,
        {
          totalUsers: users.length,
        }
      );

      this.progressTracker?.completeStep('Fetching users');

      // Get current user filters from shared_servers XML endpoint (one API call for all users)
      let sharedServers: SharedServerXml[] = [];
      try {
        const shareUrl = `https://plex.tv/api/servers/${settings.plex.machineId}/shared_servers`;
        const shareResponse = await fetch(shareUrl, {
          method: 'GET',
          headers: {
            'X-Plex-Token': admin.plexToken,
            Accept: 'application/xml',
          },
        });

        if (shareResponse.ok) {
          const shareXml = await shareResponse.text();
          const parsedXml = await xml2js.parseStringPromise(shareXml);
          sharedServers = parsedXml.MediaContainer?.SharedServer || [];
        }
      } catch (error) {
        logger.warn(`Error getting shared servers data`, {
          label: 'Collections Sync',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      let processed = 0;
      let successful = 0;
      let failed = 0;

      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        if (!user.plexId) continue;

        try {
          // Skip admin users (user ID 1) as they can't have restrictions
          if (user.id === 1) {
            continue;
          }

          processed++;

          // Update progress based on user processing
          this.progressTracker?.updateStepProgress(
            'Processing user labels',
            processed,
            users.length,
            { usersProcessed: processed }
          );

          // Find this user in the PlexTV API response to get their current server settings
          const plexUser = plexUsers.find(
            (pu) => parseInt(pu.$.id) === user.plexId
          );
          if (!plexUser) {
            logger.warn(
              `User ${user.plexId} not found in Plex users list - skipping`,
              {
                label: 'Collections Sync',
              }
            );
            continue;
          }

          // Find the server settings for our specific Plex server
          const serverSettings = plexUser.Server?.find(
            (server) => server.$.machineIdentifier === settings.plex.machineId
          );

          if (!serverSettings) {
            // User doesn't have access to this server, skip
            continue;
          }

          // Find the user's current filters in the shared servers data
          const userServer = sharedServers.find(
            (server) => server.$.userID === user.plexId?.toString()
          );

          let currentMovieFilter = '';
          let currentTvFilter = '';

          if (userServer) {
            // Extract current filters (URL decode them)
            currentMovieFilter = decodeURIComponent(
              userServer.$.filterMovies || ''
            );
            currentTvFilter = decodeURIComponent(
              userServer.$.filterTelevision || ''
            );
          }
          const cleanedMovieFilter =
            this.cleanOverseerrLabels(currentMovieFilter);
          const cleanedTvFilter = this.cleanOverseerrLabels(currentTvFilter);

          // Only update if filters actually changed
          if (
            cleanedMovieFilter !== currentMovieFilter ||
            cleanedTvFilter !== currentTvFilter
          ) {
            const url = `https://plex.tv/api/friends/${user.plexId}`;
            const headers = {
              'X-Plex-Token': admin.plexToken,
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
            };

            const payload = {
              server_id: settings.plex.machineId,
              filterMovies: cleanedMovieFilter,
              filterTelevision: cleanedTvFilter,
            };

            const formData = this.createFormData(payload);

            const response = await fetch(url, {
              method: 'PUT',
              headers: headers,
              body: formData,
            });

            if (!response.ok) {
              throw new Error(
                `HTTP ${response.status}: ${await response.text()}`
              );
            }
          }

          successful++;
        } catch (error) {
          failed++;
          logger.warn(`Failed to clear filters for user ${user.plexId}`, {
            label: 'Collections Sync',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      this.progressTracker?.completeStep('Processing user labels', {
        usersProcessed: processed,
      });

      logger.info(
        `Purged user label restrictions: ${successful} successful, ${failed} failed`,
        {
          label: 'Collections Sync',
        }
      );

      return { processed, successful, failed };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error during user labels purge: ${errorMessage}`);
      throw new Error(`User labels purge failed: ${errorMessage}`);
    } finally {
      this.running = false;
      this.syncProgress.running = false;
    }
  }

  private async updateUserFilterSettings(
    targetUserPlexId: string,
    allUserPlexIds: string[]
  ): Promise<void> {
    if (this.cancelled) return;

    try {
      const settings = getSettings();

      // Get the admin user's Plex token
      const userRepository = getRepository(User);
      const admin = await userRepository.findOne({
        select: { id: true, plexToken: true },
        where: { id: 1 },
      });

      if (!admin?.plexToken) {
        throw new Error('No admin Plex token found');
      }

      // Get user's current filter settings
      let currentMovieFilter = '';
      let currentTvFilter = '';

      try {
        const shareUrl = `https://plex.tv/api/servers/${settings.plex.machineId}/shared_servers`;
        const shareResponse = await fetch(shareUrl, {
          method: 'GET',
          headers: {
            'X-Plex-Token': admin.plexToken,
            Accept: 'application/xml',
          },
        });

        if (shareResponse.ok) {
          const shareXml = await shareResponse.text();
          const parsedXml = await xml2js.parseStringPromise(shareXml);
          const sharedServers = parsedXml.MediaContainer?.SharedServer || [];

          const userServer = sharedServers.find(
            (server: SharedServerXml) => server.$.userID === targetUserPlexId
          );

          if (userServer) {
            currentMovieFilter = decodeURIComponent(
              userServer.$.filterMovies || ''
            );
            currentTvFilter = decodeURIComponent(
              userServer.$.filterTelevision || ''
            );
          }
        }
      } catch (error) {
        // If we can't get current filters, continue with empty filters
      }

      // Clean overseerr labels from existing filter strings
      const cleanedMovieFilter = this.cleanOverseerrLabels(currentMovieFilter);
      const cleanedTvFilter = this.cleanOverseerrLabels(currentTvFilter);

      // Get other users (everyone except the target user)
      const otherUserPlexIds = allUserPlexIds.filter(
        (id) => id !== targetUserPlexId
      );

      // Create new overseerr label filter values
      const overseerrLabelValues = otherUserPlexIds.map(
        (id) => `overseerr${id}`
      );

      // Combine existing non-overseerr labels with new overseerr labels
      const combineFilters = (
        cleanedFilter: string,
        overseerrLabels: string[]
      ): string => {
        if (overseerrLabels.length === 0) {
          return cleanedFilter;
        }

        if (!cleanedFilter) {
          return `label!=${overseerrLabels.join(',')}`;
        }

        // If there's an existing label filter, combine the labels
        if (cleanedFilter.startsWith('label!=')) {
          const existingLabels = cleanedFilter.split('!=')[1];
          return `label!=${existingLabels},${overseerrLabels.join(',')}`;
        }

        // If there's a non-label filter, we can't combine them properly
        // Log a warning and use only the overseerr labels
        logger.warn(
          `Non-label filter detected for user ${targetUserPlexId}: "${cleanedFilter}". Using only Overseerr labels.`,
          {
            label: 'Collections Sync',
          }
        );
        return `label!=${overseerrLabels.join(',')}`;
      };

      const finalMovieFilter = combineFilters(
        cleanedMovieFilter,
        overseerrLabelValues
      );
      const finalTvFilter = combineFilters(
        cleanedTvFilter,
        overseerrLabelValues
      );

      // Make API call to Plex.tv to update user restrictions
      const url = `https://plex.tv/api/friends/${targetUserPlexId}`;
      const headers = {
        'X-Plex-Token': admin.plexToken,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      };

      const payload = {
        server_id: settings.plex.machineId,
        filterMovies: finalMovieFilter,
        filterTelevision: finalTvFilter,
      };

      // Convert payload to URL-encoded string
      const formData = this.createFormData(payload);

      // Make the request using fetch
      const response = await fetch(url, {
        method: 'PUT',
        headers: headers,
        body: formData,
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`HTTP ${response.status}: ${responseText}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Error updating filter settings for user ${targetUserPlexId}: ${errorMessage}`
      );
      throw error; // Re-throw so caller can track failures
    }
  }
}

// Create single instance and export it
const collectionsSync = new CollectionsSync();
export default collectionsSync;
