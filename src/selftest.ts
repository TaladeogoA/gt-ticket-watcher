/**
 * Offline check of the change-detection rules. Takes the saved snapshot, fakes a
 * release on top of it, and prints what the watcher would report. Touches nothing.
 * Run: npm run selftest   (after the watcher has run at least once)
 */
import { diffSnapshots } from './diff.js';
import { loadState } from './store.js';
import type { Snapshot } from './types.js';

const base = loadState().snapshot;
if (!base?.event) throw new Error('No saved snapshot yet - run "npm run once" first.');

const clone = (): Snapshot => structuredClone(base);
const show = (label: string, next: Snapshot) => {
  console.log(`\n${label}`);
  const changes = diffSnapshots(base, next);
  if (!changes.length) console.log('  (no changes)');
  for (const c of changes) console.log(`  [${c.kind}] release=${c.release} notify=${c.notify} :: ${c.text}`);
};

show('1. Nothing changed', clone());

const release = clone();
release.event!.status = 'active';
const firstInactive = release.event!.tickets.find((t) => t.status === 'inactive');
if (firstInactive) firstInactive.status = 'active';
release.organiserEvents.push({ slug: release.event!.slug, title: release.event!.title, status: 'active' });
show('2. Event goes live and the first inactive ticket is switched on', release);

const restock = clone();
restock.event!.tickets[0]!.remaining += 30;
restock.event!.tickets[0]!.limit += 30;
show('3. A sold-out ticket gets 30 more', restock);

const added = clone();
added.event!.tickets.push({ ...added.event!.tickets[0]!, id: 'new-id', name: 'Surprise Release', status: 'inactive', remaining: 100, limit: 100 });
show('4. A new (still inactive) ticket type is added', added);

const sales = clone();
const stocked = sales.event!.tickets.find((t) => t.remaining > 1);
if (stocked) stocked.remaining -= 1;
sales.event!.totalTicketsSold += 1;
show('5. One ordinary sale (should be history-only, notify=false)', sales);
