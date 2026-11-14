import crypto from 'node:crypto';
import { config, eventUrl } from './config.js';
import { buyableTickets, diffSnapshots, summarise } from './diff.js';
import { log } from './log.js';
import { notifyConfigured, sendNotification, type Notification } from './notify.js';
import { appendHistory, loadState, saveState, type State } from './store.js';
import { TixClient } from './tix.js';
import type { Change, Snapshot } from './types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watNow = (): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date()) + ' WAT';

function buildAlert(changes: Change[], next: Snapshot): Notification {
  const release = changes.some((c) => c.release);
  const title = next.event?.title ?? config.eventSlug;
  const lines = changes.map((c) => `• ${c.text}${c.url ? `\n  ${c.url}` : ''}`);
  const buyable = buyableTickets(next);
  if (buyable.length) lines.push('', 'Buyable now:', ...buyable.map((b) => `• ${b}`));
  lines.push('', `Buy: ${eventUrl(config.eventSlug)}`, `Source: Tix Africa API · ${watNow()}`);
  return {
    title: release ? `TICKET RELEASE DETECTED - ${title}` : `Tix change - ${title}`,
    message: lines.join('\n'),
    priority: release ? 5 : 3,
    tags: [release ? 'rotating_light' : 'information_source'],
    // Tapping the notification opens the event page (or the new event, if that is the news).
    click: changes.find((c) => c.release && c.url)?.url ?? eventUrl(config.eventSlug),
  };
}

function queue(state: State, n: Notification): void {
  // The id is a content hash, so the same alert can never sit in the outbox twice.
  const id = crypto.createHash('sha1').update(n.title + '\n' + n.message).digest('hex').slice(0, 12);
  if (!state.outbox.some((m) => m.id === id)) state.outbox.push({ ...n, id, createdAt: new Date().toISOString() });
}

async function flushOutbox(state: State): Promise<void> {
  if (!state.outbox.length) return;
  if (!notifyConfigured()) {
    for (const m of state.outbox) log.warn(`ntfy not configured - alert only logged:\n${m.title}\n${m.message}`);
    state.outbox = [];
    saveState(state);
    return;
  }
  for (const m of [...state.outbox]) {
    if (!(await sendNotification(m))) {
      log.warn(`Alert ${m.id} not delivered yet; will retry next cycle`);
      break;
    }
    state.outbox = state.outbox.filter((x) => x.id !== m.id);
    saveState(state);
    log.info(`Alert ${m.id} delivered to ntfy`);
  }
}

/** One full check. Throws if Tix could not be read. */
async function checkOnce(tix: TixClient, state: State): Promise<void> {
  const next = await tix.snapshot();
  const prev = state.snapshot;

  if (!prev) {
    log.info(`Baseline saved:\n${summarise(next)}`);
    queue(state, {
      title: 'GT ticket watcher started',
      message: `${summarise(next)}\n\nChecking every ~${config.pollSeconds}s.`,
      priority: 3,
      tags: ['white_check_mark'],
      click: eventUrl(config.eventSlug),
    });
  } else {
    const changes = diffSnapshots(prev, next);
    if (changes.length) {
      appendHistory(next.takenAt, changes);
      for (const c of changes) log.info(`CHANGE [${c.kind}${c.release ? ', RELEASE' : ''}] ${c.text}`);
      const toSend = changes.filter((c) => c.notify);
      if (toSend.length) queue(state, buildAlert(toSend, next));
    }
  }
  // Snapshot and queued alerts are saved together, so a change is never alerted twice
  // and never lost if the process dies before delivery.
  state.snapshot = next;
  saveState(state);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));

  if (args.has('--test-notify')) {
    if (!notifyConfigured()) throw new Error('Set NTFY_TOPIC in .env first.');
    const ok = await sendNotification({
      title: 'GT ticket watcher test',
      message: 'If you can read this on your phone, alerts are working.',
      priority: 5,
      tags: ['white_check_mark'],
      click: eventUrl(config.eventSlug),
    });
    log.info(ok ? 'Test notification sent.' : 'Test notification FAILED - see warnings above.');
    process.exitCode = ok ? 0 : 1;
    return;
  }

  if (args.has('--simulate-release')) {
    // Fakes a release on top of the saved snapshot and pushes the exact alert a real
    // one would produce (same diff rules, same formatting, same urgent priority).
    // Saves nothing, so it cannot disturb the real watcher.
    if (!notifyConfigured()) throw new Error('Set NTFY_TOPIC in .env first.');
    const base = loadState().snapshot;
    if (!base?.event) throw new Error('No saved snapshot yet - run "npm run once" first.');
    const fake = structuredClone(base);
    fake.event!.status = 'active';
    const first = fake.event!.tickets.find((t) => t.status === 'inactive');
    if (first) first.status = 'active';
    fake.organiserEvents.push({ slug: fake.event!.slug, title: fake.event!.title, status: 'active' });
    const alert = buildAlert(diffSnapshots(base, fake).filter((c) => c.notify), fake);
    alert.title = `[TEST] ${alert.title}`;
    alert.message = `THIS IS A SIMULATION - no real release.\n\n${alert.message}`;
    const ok = await sendNotification(alert);
    log.info(ok ? `Simulated release alert sent:\n${alert.title}\n${alert.message}` : 'Simulated alert FAILED to send.');
    process.exitCode = ok ? 0 : 1;
    return;
  }

  const once = args.has('--once');
  const state = loadState();
  state.lastHeartbeatAt ??= new Date().toISOString();
  state.checksSinceHeartbeat ??= 0;
  const startedAt = Date.now();
  const tix = new TixClient();
  let failures = 0;
  let failureAlerted = false;
  let stopping = false;

  const shutdown = () => {
    stopping = true;
    log.info('Stopping...');
    void tix.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (!notifyConfigured()) log.warn('NTFY_TOPIC is not set - alerts will only be written to the log.');
  log.info(`Watching "${config.eventSlug}" every ~${config.pollSeconds}s`);

  while (!stopping) {
    try {
      await checkOnce(tix, state);
      if (failureAlerted) {
        queue(state, { title: 'GT ticket watcher recovered', message: 'Checking Tix again.', priority: 3, tags: ['white_check_mark'] });
      }
      failures = 0;
      failureAlerted = false;
      state.checksSinceHeartbeat = (state.checksSinceHeartbeat ?? 0) + 1;
      const e = state.snapshot?.event;
      if (config.heartbeatHours && Date.now() - Date.parse(state.lastHeartbeatAt!) >= config.heartbeatHours * 3_600_000) {
        // A quiet proof of life: if these stop arriving, the PC or the watcher is down.
        queue(state, {
          title: 'GT watcher still running',
          message: `${state.checksSinceHeartbeat} successful checks since the last heartbeat. Event is ${e?.status ?? 'not found'}. ${watNow()}`,
          priority: 2,
          tags: ['green_heart'],
        });
        state.lastHeartbeatAt = new Date().toISOString();
        state.checksSinceHeartbeat = 0;
      }
      saveState(state);
      log.info(e ? `OK event=${e.status} sold=${e.totalTicketsSold} buyable_now=${buyableTickets(state.snapshot!).length} active_tickets=${e.tickets.filter((t) => t.status === 'active').length}/${e.tickets.length}` : 'OK event not found');
    } catch (err) {
      failures++;
      log.error(`Check failed (${failures} in a row): ${(err as Error).message.split('\n')[0]}`);
      // Start the next attempt from a fresh browser page.
      await tix.close();
      if (failures >= config.failureAlertThreshold && !failureAlerted) {
        failureAlerted = true;
        queue(state, {
          title: 'GT ticket watcher is FAILING',
          message: `${failures} checks in a row could not read Tix. You are NOT currently protected - check data/watcher.log.`,
          priority: 4,
          tags: ['warning'],
        });
        saveState(state);
      }
    }

    await flushOutbox(state).catch((err) => log.error(`Outbox error: ${(err as Error).message}`));
    if (once) break;
    if (config.maxRuntimeMinutes && Date.now() - startedAt >= config.maxRuntimeMinutes * 60_000) {
      log.info(`Reached ${config.maxRuntimeMinutes} minute run limit - exiting so the next run can take over.`);
      break;
    }

    // Normal cadence with jitter. The first 3 failures retry at the normal pace so the
    // "FAILING" alert arrives within a few minutes; after that, back off (max 5 min).
    const base = failures > 3 ? Math.min(300, config.pollSeconds * 2 ** Math.min(failures - 3, 4)) : config.pollSeconds;
    await sleep((base + Math.random() * base * 0.2) * 1000);
  }

  await tix.close();
  if (once && failures) process.exitCode = 1;
}

main().catch((err) => {
  log.error(`Fatal: ${(err as Error).message}`);
  process.exit(1);
});
