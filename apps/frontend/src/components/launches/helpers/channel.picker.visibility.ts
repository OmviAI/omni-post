/**
 * Controls which social identifiers appear in the “Add channel” modal and
 * onboarding connect grid, and whether they are clickable or “Coming soon”.
 *
 * Identifiers come from GET /integrations `social[].identifier`.
 */

/** Shown and clickable (connect / OAuth flow allowed). */
export const PRIORITISED_CHANNEL_IDENTIFIERS: readonly string[] = [
  'instagram',
  'instagram-standalone',
  'facebook',
  'discord',
  'telegram',
  'x',
  'youtube',
];

/** Shown greyed with “Coming soon” — not clickable. */
export const COMING_SOON_CHANNEL_IDENTIFIERS: readonly string[] = [
  'linkedin',
  'linkedin-page',
  'reddit',
  'tiktok',
];

// --- Not shown in the picker yet (unprioritised). Examples from the API / product; add to a list above when ready. ---
// 'threads', 'pinterest', 'mastodon', 'bluesky', 'slack', 'medium', 'hashnode',
// 'devto', 'dribbble', 'wrapcast', 'lemmy', 'nostr', 'vk', 'wordpress', 'listmonk',
// 'gmb', 'google_my_business', …

// --- Legacy: single flat allow-list (all enabled vs disabled by opacity only). Kept for reference. ---
// const allowedPlatforms = [
//   'instagram', 'facebook', 'discord', 'telegram', 'x', 'youtube',
//   // 'reddit',
//   'linkedin', 'linkedin-page',
// ];
// const isPlatformEnabled = (identifier: string) =>
//   allowedPlatforms.includes(identifier) || identifier === 'instagram-standalone';

export function shouldShowInAddChannelGrid(identifier: string): boolean {
  return (
    PRIORITISED_CHANNEL_IDENTIFIERS.includes(identifier) ||
    COMING_SOON_CHANNEL_IDENTIFIERS.includes(identifier)
  );
}

export function isComingSoonChannel(identifier: string): boolean {
  return COMING_SOON_CHANNEL_IDENTIFIERS.includes(identifier);
}

export function isConnectEnabledForChannelPicker(identifier: string): boolean {
  return PRIORITISED_CHANNEL_IDENTIFIERS.includes(identifier);
}
