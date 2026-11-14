import { config } from './config.js';
import { log } from './log.js';

export interface Notification {
  title: string;
  message: string;
  /** ntfy priority: 5 = urgent, 4 = high, 3 = default, 2 = low (no sound). */
  priority: 2 | 3 | 4 | 5;
  /** ntfy tag / emoji short codes, e.g. "rotating_light". */
  tags: string[];
  /** URL opened when the notification is tapped. */
  click?: string;
}

export const notifyConfigured = (): boolean => Boolean(config.ntfyTopic);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Returns true when ntfy accepted the message. Never throws, never logs the topic or token. */
export async function sendNotification(n: Notification): Promise<boolean> {
  if (!notifyConfigured()) return false;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.ntfyToken) headers.authorization = `Bearer ${config.ntfyToken}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // JSON publishing (POST to the server root) so titles and text can be UTF-8.
      const res = await fetch(config.ntfyServer, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          topic: config.ntfyTopic,
          title: n.title,
          message: n.message,
          priority: n.priority,
          tags: n.tags,
          ...(n.click ? { click: n.click } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return true;
      log.warn(`ntfy HTTP ${res.status}`);
      // 4xx other than rate limiting means bad topic/token - retrying will not help.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return false;
    } catch (err) {
      log.warn(`ntfy send failed (attempt ${attempt}): ${(err as Error).name}`);
    }
    await sleep(attempt * 2000);
  }
  return false;
}
