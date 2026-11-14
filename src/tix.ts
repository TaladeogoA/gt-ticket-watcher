import fs from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { config } from './config.js';
import { log } from './log.js';
import type { EventSnapshot, OrganiserEvent, Snapshot } from './types.js';

/**
 * Tix's GraphQL API sits behind Cloudflare, which rejects plain Node/curl requests
 * (HTTP 403) but accepts requests made by a real browser. So every request is made
 * with fetch() from inside a real Chrome page on tix.africa. No login is needed:
 * both queries below work signed-out (verified 2026-11-14).
 */

// Every field here was verified against the live API. Introspection is disabled,
// so do not add fields without testing them first.
const EVENT_QUERY = `
query WatchEvent($slug: String!) {
  fetchEventBySlug(slug: $slug) {
    id slug title status totalTicketsSold
    tickets { edges { node {
      id name status price priceWithFees limit unlimited purchaseLimit
      ticketSchedules { edges { node { id limit unlimited } } }
    } } }
  }
}`;

const ORGANISER_QUERY = `
query WatchOrganiser($user: ID) {
  filterEvents(user: $user, discoverable: false) { slug title status }
}`;

interface GqlResult {
  httpStatus: number;
  json: { data?: any; errors?: { message: string }[] } | null;
  bodyStart: string;
}

export class TixClient {
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    await this.close();
    fs.mkdirSync(config.profileDir, { recursive: true });
    log.info(`Launching Chrome (${config.headless ? 'headless' : 'visible'})`);
    // channel: 'chrome' uses the Chrome already installed on this machine, with a
    // separate profile folder so it never touches your everyday Chrome profile.
    this.context = await chromium.launchPersistentContext(config.profileDir, {
      channel: 'chrome',
      headless: config.headless,
      viewport: { width: 1100, height: 700 },
    });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    await this.page.goto(config.siteUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Diagnostic only: a Cloudflare title here is normal, the API call is what matters.
    log.info(`Opened ${config.siteUrl} (page title: "${await this.page.title().catch(() => '?')}")`);
    return this.page;
  }

  /** Drop the browser so the next request starts from a fresh page. */
  async close(): Promise<void> {
    const ctx = this.context;
    this.context = null;
    this.page = null;
    if (ctx) await ctx.close().catch(() => undefined);
  }

  private async gql(query: string, variables: Record<string, unknown>): Promise<GqlResult> {
    const page = await this.ensurePage();
    return page.evaluate(
      async ({ url, query, variables }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ query, variables }),
            signal: controller.signal,
          });
          const text = await res.text();
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not JSON - probably a Cloudflare page */
          }
          return { httpStatus: res.status, json, bodyStart: text.slice(0, 120) };
        } finally {
          clearTimeout(timer);
        }
      },
      { url: config.graphqlUrl, query, variables },
    );
  }

  private async fetchEvent(slug: string): Promise<EventSnapshot | null> {
    const r = await this.gql(EVENT_QUERY, { slug });
    if (!r.json) throw new Error(`Non-JSON response (HTTP ${r.httpStatus}): ${r.bodyStart}`);
    const errors = r.json.errors ?? [];
    // Tix's own "no such event" answer, e.g. "Event with 'x' slug does not exist."
    if (errors.some((e) => /does not exist/i.test(e.message))) return null;
    if (errors.length) throw new Error(`GraphQL error: ${errors.map((e) => e.message).join('; ')}`);
    const e = r.json.data?.fetchEventBySlug;
    if (!e) throw new Error('fetchEventBySlug returned no data and no error');
    return {
      id: e.id,
      slug: e.slug,
      title: e.title,
      status: e.status,
      totalTicketsSold: e.totalTicketsSold ?? 0,
      tickets: (e.tickets?.edges ?? []).map(({ node: t }: any) => ({
        id: t.id,
        name: String(t.name ?? '').trim(),
        status: t.status,
        price: t.price,
        priceWithFees: t.priceWithFees,
        limit: t.limit ?? 0,
        unlimited: Boolean(t.unlimited),
        purchaseLimit: t.purchaseLimit ?? null,
        remaining: (t.ticketSchedules?.edges ?? []).reduce(
          (sum: number, s: any) => sum + (s.node?.limit ?? 0),
          0,
        ),
      })),
    };
  }

  private async fetchOrganiserEvents(organiserId: string): Promise<OrganiserEvent[]> {
    const r = await this.gql(ORGANISER_QUERY, { user: organiserId });
    if (!r.json) throw new Error(`Non-JSON response (HTTP ${r.httpStatus}): ${r.bodyStart}`);
    if (r.json.errors?.length) {
      throw new Error(`GraphQL error: ${r.json.errors.map((e) => e.message).join('; ')}`);
    }
    const list = r.json.data?.filterEvents;
    if (!Array.isArray(list)) throw new Error('filterEvents returned no list');
    return list.map((e: any) => ({ slug: e.slug, title: e.title, status: e.status }));
  }

  async snapshot(): Promise<Snapshot> {
    const event = await this.fetchEvent(config.eventSlug);
    const organiserEvents = config.organiserId ? await this.fetchOrganiserEvents(config.organiserId) : [];
    return { takenAt: new Date().toISOString(), event, organiserEvents };
  }
}
