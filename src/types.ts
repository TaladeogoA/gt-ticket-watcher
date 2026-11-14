export interface TicketSnapshot {
  id: string;
  name: string;
  /** "active" | "inactive" as returned by Tix. */
  status: string;
  price: number;
  priceWithFees: number;
  /** Total configured quantity. */
  limit: number;
  unlimited: boolean;
  purchaseLimit: number | null;
  /**
   * Sum of ticketSchedules[].limit. Verified against a live event on 2026-11-14:
   * this is the quantity still unsold (limit - sold), not the configured total.
   */
  remaining: number;
}

export interface EventSnapshot {
  id: string;
  slug: string;
  title: string;
  /** "active" | "inactive" as returned by Tix. */
  status: string;
  totalTicketsSold: number;
  tickets: TicketSnapshot[];
}

export interface OrganiserEvent {
  slug: string;
  title: string;
  status: string;
}

export interface Snapshot {
  takenAt: string;
  /** null when Tix says the slug does not exist. */
  event: EventSnapshot | null;
  /** Upcoming events Tix lists for the organiser (inactive events are not listed). */
  organiserEvents: OrganiserEvent[];
}

export interface Change {
  kind:
    | 'event_status'
    | 'event_appeared'
    | 'event_missing'
    | 'ticket_status'
    | 'ticket_added'
    | 'ticket_removed'
    | 'ticket_restocked'
    | 'ticket_limit'
    | 'ticket_price'
    | 'ticket_sold_out'
    | 'sales'
    | 'organiser_event_added';
  /** true = looks like tickets became (or may become) buyable. Sent as an urgent alert. */
  release: boolean;
  /** false = recorded in history only, no Telegram message. */
  notify: boolean;
  text: string;
  /** Link to send with the alert, when it differs from the watched event. */
  url?: string;
}
