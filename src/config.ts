import path from 'node:path';

const env = (name: string, fallback = ''): string => (process.env[name] ?? '').trim() || fallback;

export const config = {
  eventSlug: env('TIX_EVENT_SLUG', 'klub-aniko'),
  organiserId: env('TIX_ORGANISER_ID', 'VXNlci04MTUxMDUwMC1hMjEzLTQ3NmYtOTI4Ny1lNzJjZjU0ZDE3MGU='),
  pollSeconds: Math.max(15, Number(env('POLL_SECONDS', '45')) || 45),
  // Default is a visible window: Tix's Cloudflare rejected headless Chrome when tested (2026-11-14).
  headless: env('HEADLESS', 'false').toLowerCase() === 'true',
  ntfyServer: env('NTFY_SERVER', 'https://ntfy.sh').replace(/\/+$/, ''),
  ntfyTopic: env('NTFY_TOPIC'),
  ntfyToken: env('NTFY_TOKEN'),
  dataDir: path.resolve('data'),
  profileDir: path.resolve('chrome-profile'),
  graphqlUrl: 'https://core.tix.africa/graphql',
  siteUrl: 'https://tix.africa/',
  /** Consecutive failed checks before a "watcher is failing" alert is sent. */
  failureAlertThreshold: Math.max(1, Number(env('FAILURE_ALERT_THRESHOLD', '3')) || 3),
  /** Exit cleanly after this many minutes (used on GitHub Actions). 0 = run forever. */
  maxRuntimeMinutes: Math.max(0, Number(env('MAX_RUNTIME_MINUTES', '0')) || 0),
  /** Hours between quiet "still watching" pushes. 0 turns them off. */
  heartbeatHours: Math.max(0, Number(env('HEARTBEAT_HOURS', '12')) || 0),
};

export const eventUrl = (slug: string): string => `https://tix.africa/discover/${slug}`;
