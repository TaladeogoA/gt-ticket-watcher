import { eventUrl } from './config.js';
import type { Change, Snapshot, TicketSnapshot } from './types.js';

const naira = (n: number): string => `NGN ${Math.round(n).toLocaleString('en-NG')}`;

const describeTicket = (t: TicketSnapshot): string =>
  `${t.name} (${naira(t.priceWithFees)} incl. fees, ${t.unlimited ? 'unlimited' : `${t.remaining} of ${t.limit} left`})`;

/** A ticket is buyable only when both it and its event are active and stock remains. */
const buyable = (eventStatus: string, t: TicketSnapshot): boolean =>
  eventStatus === 'active' && t.status === 'active' && (t.unlimited || t.remaining > 0);

export function diffSnapshots(prev: Snapshot, next: Snapshot): Change[] {
  const changes: Change[] = [];

  // --- Organiser listing: catches a release published as a brand-new event. ---
  const knownSlugs = new Set(prev.organiserEvents.map((e) => e.slug));
  for (const e of next.organiserEvents) {
    if (!knownSlugs.has(e.slug)) {
      changes.push({
        kind: 'organiser_event_added',
        release: true,
        notify: true,
        text: `Group Therapy now lists an event on Tix: "${e.title}" (${e.status})`,
        url: eventUrl(e.slug),
      });
    }
  }

  // --- The watched event itself. ---
  const a = prev.event;
  const b = next.event;
  if (!a && !b) return changes;
  if (!a && b) {
    changes.push({ kind: 'event_appeared', release: b.status === 'active', notify: true, text: `Event "${b.title}" now exists on Tix (status: ${b.status})` });
    return changes;
  }
  if (a && !b) {
    changes.push({ kind: 'event_missing', release: false, notify: true, text: `Tix no longer returns the event "${a.title}" for this slug (deleted or renamed?)` });
    return changes;
  }
  if (!a || !b) return changes;

  if (a.status !== b.status) {
    changes.push({
      kind: 'event_status',
      release: b.status === 'active',
      notify: true,
      text: `Event status: ${a.status} -> ${b.status}`,
    });
  }

  const before = new Map(a.tickets.map((t) => [t.id, t]));
  const after = new Map(b.tickets.map((t) => [t.id, t]));

  for (const t of b.tickets) {
    const old = before.get(t.id);
    if (!old) {
      changes.push({
        kind: 'ticket_added',
        release: buyable(b.status, t),
        notify: true,
        text: `New ticket type (${t.status}): ${describeTicket(t)}`,
      });
      continue;
    }
    if (old.status !== t.status) {
      changes.push({
        kind: 'ticket_status',
        release: t.status === 'active' && (t.unlimited || t.remaining > 0),
        notify: true,
        text: `Ticket "${t.name}": ${old.status} -> ${t.status} - ${describeTicket(t)}`,
      });
    }
    if (t.remaining > old.remaining) {
      changes.push({
        kind: 'ticket_restocked',
        release: t.status === 'active',
        notify: true,
        text: `Ticket "${t.name}": remaining went UP ${old.remaining} -> ${t.remaining}`,
      });
    } else if (t.remaining < old.remaining) {
      const soldOut = t.remaining === 0 && !t.unlimited;
      changes.push({
        kind: soldOut ? 'ticket_sold_out' : 'sales',
        release: false,
        notify: soldOut,
        text: soldOut
          ? `Ticket "${t.name}" is now SOLD OUT`
          : `Ticket "${t.name}": remaining ${old.remaining} -> ${t.remaining}`,
      });
    }
    if (old.limit !== t.limit && t.remaining <= old.remaining) {
      // A limit rise that also raised "remaining" is already reported as a restock.
      changes.push({ kind: 'ticket_limit', release: false, notify: true, text: `Ticket "${t.name}": limit ${old.limit} -> ${t.limit}` });
    }
    if (old.price !== t.price || old.priceWithFees !== t.priceWithFees) {
      changes.push({
        kind: 'ticket_price',
        release: false,
        notify: true,
        text: `Ticket "${t.name}": price ${naira(old.priceWithFees)} -> ${naira(t.priceWithFees)} (incl. fees)`,
      });
    }
  }
  for (const t of a.tickets) {
    if (!after.has(t.id)) {
      changes.push({ kind: 'ticket_removed', release: false, notify: true, text: `Ticket type removed: ${t.name}` });
    }
  }
  return changes;
}

/** Tickets that can be bought right now, for the alert body. */
export function buyableTickets(s: Snapshot): string[] {
  const e = s.event;
  if (!e) return [];
  return e.tickets.filter((t) => buyable(e.status, t)).map(describeTicket);
}

export function summarise(s: Snapshot): string {
  const e = s.event;
  if (!e) return 'Event not found on Tix.';
  const lines = e.tickets.map((t) => `- [${t.status}] ${describeTicket(t)}`);
  return [`${e.title}: event ${e.status}, ${e.totalTicketsSold} sold`, ...lines].join('\n');
}
