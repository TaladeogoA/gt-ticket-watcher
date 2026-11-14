import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type { Notification } from './notify.js';
import type { Change, Snapshot } from './types.js';

export interface PendingMessage extends Notification {
  id: string;
  createdAt: string;
}

export interface State {
  snapshot: Snapshot | null;
  /** Alerts not yet delivered to ntfy. Retried every cycle until sent. */
  outbox: PendingMessage[];
  /** Persisted so heartbeats keep their schedule across restarts and GitHub runs. */
  lastHeartbeatAt?: string;
  checksSinceHeartbeat?: number;
}

const stateFile = path.join(config.dataDir, 'state.json');
const historyFile = path.join(config.dataDir, 'history.jsonl');

export function loadState(): State {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Partial<State>;
    return {
      snapshot: parsed.snapshot ?? null,
      outbox: parsed.outbox ?? [],
      lastHeartbeatAt: parsed.lastHeartbeatAt,
      checksSinceHeartbeat: parsed.checksSinceHeartbeat,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { snapshot: null, outbox: [] };
    throw new Error(`Could not read ${stateFile}: ${(err as Error).message}`);
  }
}

/** Write-then-rename so a crash mid-write cannot corrupt the state file. */
export function saveState(state: State): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, stateFile);
}

export function appendHistory(at: string, changes: Change[]): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const lines = changes.map((c) => JSON.stringify({ at, ...c })).join('\n');
  fs.appendFileSync(historyFile, lines + '\n');
}
