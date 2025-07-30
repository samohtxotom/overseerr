import type { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';

/**
 * Template parsing and utility functions for collections
 */

/**
 * Extract error message from unknown error type
 */
export function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Create URL-encoded form data from object
 */
export function createFormData(
  payload: Record<string, string | undefined | null>
): string {
  return Object.entries(payload)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value ?? '')}`
    )
    .join('&');
}

/**
 * Get user display name with basic fallback
 */
export function getUserDisplayName(user: User): string {
  return (
    user.displayName ||
    user.plexUsername ||
    user.username ||
    user.email ||
    `User ${user.plexId || user.id}`
  );
}

/**
 * Extract domain from application URL
 */
function extractDomain(url: string): string {
  if (!url) return '';

  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    // If URL parsing fails, try to extract domain manually
    const match = url.match(/(?:https?:\/\/)?([^/\s]+)/);
    return match?.[1] || '';
  }
}

/**
 * Parse collection template with full variable replacement
 */
export function parseCollectionTemplate(
  template: string,
  user: User,
  mediaType?: 'movie' | 'tv'
): string {
  if (!template) {
    return `${getUserDisplayName(user)}'s requests`;
  }

  const settings = getSettings();
  const domain = extractDomain(settings.main.applicationUrl || '');
  const appTitle = settings.main.applicationTitle || '';

  // Determine media type text for {mediaType} replacement
  let mediaTypeText = 'Movies & TV Shows';
  if (mediaType === 'movie') {
    mediaTypeText = 'Movies';
  } else if (mediaType === 'tv') {
    mediaTypeText = 'TV Shows';
  }

  // Full variable replacement
  const result = template
    .replace(/\{user\}/g, getUserDisplayName(user))
    .replace(/\{username\}/g, user.plexUsername || user.username || '')
    .replace(/\{nickname\}/g, user.plexTitle || user.displayName || '')
    .replace(/\{domain\}/g, domain)
    .replace(/\{appTitle\}/g, appTitle)
    .replace(/\{mediaType\}/g, mediaTypeText)
    .replace(/\{servername\}/g, settings.plex.name || 'Plex Server')
    .trim();

  return result || `${getUserDisplayName(user)}'s requests`;
}

/**
 * Generate global collection name with domain/appTitle fallback
 */
export function generateGlobalCollectionName(): string {
  const settings = getSettings();
  const domain = extractDomain(settings.main.applicationUrl || '');
  const appTitle = settings.main.applicationTitle || 'Overseerr';

  if (domain) {
    return `${domain} requests by Everyone`;
  }

  return `${appTitle} requests by Everyone`;
}
