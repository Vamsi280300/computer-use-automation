/**
 * Surface - a thin observe/act layer over one live Playwright page.
 *
 * This module knows nothing about goals, LLMs, prompts or artifacts. It answers
 * exactly two questions: "what is on the page right now" and "do this to it".
 * Both the discovery agent and the deterministic replay engine sit on top of it,
 * which is why the vocabulary here has to be recordable as plain JSON.
 *
 * ---------------------------------------------------------------------------
 * ELEMENT REFERENCE / LOCATOR SCHEME - and why it is built this way
 * ---------------------------------------------------------------------------
 * observe() hands back short-lived refs ("e3"). A ref is a handle for the
 * CURRENT snapshot only; it is deliberately not durable, because an index into
 * a list of elements means nothing once the page changes. What IS durable, and
 * what the artifact will persist, is the LocatorDescriptor attached to every
 * element. Resolution walks three strategies in descending order of robustness:
 *
 *   1. ROLE + ACCESSIBLE NAME (primary).  getByRole('button', { name: 'Open
 *      Sub-Account' }). This survives the changes that actually happen between
 *      runs of a real internal tool: re-ordered rows, new columns, restyled
 *      markup, wrapper divs appearing. It breaks only when the visible label
 *      changes - and if the label changed, a human operator's instructions would
 *      have broken too, so failing there is honest rather than silently clicking
 *      the wrong control.
 *
 *   2. ROLE + NAME + NTH (disambiguation).  Used only when a role+name pair is
 *      genuinely ambiguous, e.g. six identical "View" links in a results table.
 *      Position is scoped to the matching set, not the whole page, so it stays
 *      stable as long as the set's ordering does.
 *
 *   3. CSS STRUCTURAL PATH (last resort).  A nth-of-type path from the root.
 *      This is the brittle one and we treat it as such: it is recorded for every
 *      element but only consulted when 1 and 2 find nothing. Legacy pages force
 *      this on us - the mock servicing app labels its inputs with an adjacent
 *      table cell and no label element, so those inputs have no accessible name
 *      for Playwright to match on at all.
 *
 * That last point drives the `nameSource` field. We compute a name for every
 * element, but only some sources (aria-label, label, placeholder, text, value)
 * are ones Playwright's own accname computation agrees with. A name we inferred
 * from a neighbouring table cell is good for a human or an LLM to read, and
 * useless as a getByRole selector. Recording where the name came from is what
 * lets resolution skip strategy 1 instead of wasting a timeout on it.
 *
 * Deliberately NOT used: raw screenshot/pixel analysis (not reproducible, and
 * unusable for replay assertions) and full HTML dumps (far too large for a
 * prompt). Note also that page.accessibility.snapshot() no longer exists in
 * Playwright 1.62 - it was removed, not merely deprecated - so the accessibility
 * tree is reached through role locators, which is the supported path and has the
 * advantage of returning something directly actionable.
 */

import { Buffer } from 'node:buffer';

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';

import { collectInteractiveElements } from './enumerate.js';
import {
  ACCESSIBLE_NAME_SOURCES,
  type ElementRole,
  type ElementSnapshot,
  type LocatorDescriptor,
  type NameSource,
  type PageSnapshot,
  type RawElement,
  type SurfaceOptions,
  type WaitCondition
} from './types.js';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_ELEMENTS = 80;

const KNOWN_ROLES: ReadonlySet<string> = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio'
]);

/** Roles Playwright's getByRole understands. 'other' never qualifies. */
const ARIA_QUERYABLE: ReadonlySet<ElementRole> = new Set<ElementRole>([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio'
]);

/**
 * Build-tool interop, not application logic.
 *
 * tsx/esbuild compile with keepNames enabled (hardcoded in tsx 4.x, no opt-out),
 * which wraps every named function in a `__name(...)` helper call. That helper is
 * emitted into the *module*, but page.evaluate ships only the stringified
 * function to the browser, where `__name` does not exist - so the in-page
 * enumeration dies with "ReferenceError: __name is not defined". Defining an
 * identity `__name` in the page satisfies the wrapper. Passed as an anonymous
 * arrow so it does not itself get name-wrapped.
 */
const NAME_HELPER_SHIM = (): void => {
  const scope = globalThis as unknown as { __name?: unknown };
  if (typeof scope.__name !== 'function') {
    scope.__name = (fn: unknown): unknown => fn;
  }
};

export class SurfaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SurfaceError';
  }
}

export class Surface {
  readonly #browser: Browser;
  readonly #context: BrowserContext;
  readonly #page: Page;
  readonly #maxElements: number;
  readonly #timeoutMs: number;

  /** Descriptors from the most recent observe(), keyed by ref. */
  #refs = new Map<string, LocatorDescriptor>();

  private constructor(
    browser: Browser,
    context: BrowserContext,
    page: Page,
    maxElements: number,
    timeoutMs: number
  ) {
    this.#browser = browser;
    this.#context = context;
    this.#page = page;
    this.#maxElements = maxElements;
    this.#timeoutMs = timeoutMs;
  }

  static async launch(options: SurfaceOptions = {}): Promise<Surface> {
    const headless = options.headless ?? false;
    const timeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    const browser = await chromium.launch({
      headless,
      ...(options.slowMo !== undefined ? { slowMo: options.slowMo } : {})
    });
    const context = await browser.newContext({
      viewport: options.viewport ?? { width: 1280, height: 900 }
    });
    context.setDefaultTimeout(timeoutMs);
    await context.addInitScript(NAME_HELPER_SHIM);
    const page = await context.newPage();

    return new Surface(
      browser,
      context,
      page,
      options.maxElements ?? DEFAULT_MAX_ELEMENTS,
      timeoutMs
    );
  }

  async goto(url: string): Promise<void> {
    await this.#page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  get url(): string {
    return this.#page.url();
  }

  /** Structured, compact view of the page. Invalidates refs from prior calls. */
  async observe(): Promise<PageSnapshot> {
    // Covers the already-loaded document; addInitScript only covers navigations.
    await this.#page.evaluate(NAME_HELPER_SHIM);
    const raw: RawElement[] = await this.#page.evaluate(collectInteractiveElements);

    const capped = raw.slice(0, this.#maxElements);
    const groupCounts = new Map<string, number>();
    const elements: ElementSnapshot[] = [];

    this.#refs = new Map();

    capped.forEach((item, index) => {
      const role = normalizeRole(item.role);
      const nameSource = normalizeNameSource(item.nameSource);

      // nth counts within the role+name group, so it stays meaningful even as
      // unrelated elements come and go elsewhere on the page.
      const key = `${role} ${item.name}`;
      const nth = groupCounts.get(key) ?? 0;
      groupCounts.set(key, nth + 1);

      const locator: LocatorDescriptor = {
        role,
        name: item.name,
        nameSource,
        css: item.css,
        ...(nth > 0 ? { nth } : {})
      };

      const ref = `e${index + 1}`;
      this.#refs.set(ref, locator);

      elements.push({
        ref,
        role,
        name: item.name,
        ...(item.value !== null && item.value !== '' ? { value: item.value } : {}),
        ...(item.disabled ? { disabled: true } : {}),
        locator
      });
    });

    // A second pass is needed because group size is only known after the whole
    // page is walked: the first of two matching elements must carry nth=0.
    for (const element of elements) {
      const key = `${element.role} ${element.name}`;
      if ((groupCounts.get(key) ?? 0) > 1 && element.locator.nth === undefined) {
        element.locator.nth = 0;
      }
    }

    return {
      url: this.#page.url(),
      title: await this.#page.title(),
      elements,
      ...(raw.length > capped.length ? { truncated: true } : {})
    };
  }

  async click(ref: string): Promise<void> {
    const locator = await this.#resolve(ref);
    await locator.click({ timeout: this.#timeoutMs });
  }

  async type(ref: string, text: string): Promise<void> {
    const locator = await this.#resolve(ref);
    await locator.fill(text, { timeout: this.#timeoutMs });
  }

  async select(ref: string, value: string): Promise<void> {
    const locator = await this.#resolve(ref);
    // Try by option value first, then by visible label - legacy selects differ.
    try {
      await locator.selectOption({ value }, { timeout: this.#timeoutMs });
    } catch {
      await locator.selectOption({ label: value }, { timeout: this.#timeoutMs });
    }
  }

  /**
   * Waits on a condition expressed in page terms, never in terms of our refs -
   * replay checkpoints must be able to assert against elements that were never
   * part of the original observation.
   */
  async waitFor(condition: WaitCondition, timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? this.#timeoutMs;

    switch (condition.type) {
      case 'url-contains':
        await this.#page.waitForURL((url) => url.href.includes(condition.value), { timeout });
        return;

      case 'text-visible':
        await this.#page
          .getByText(condition.value, { exact: false })
          .first()
          .waitFor({ state: 'visible', timeout });
        return;

      case 'element-visible':
        await this.#byRole(condition.role, condition.name)
          .first()
          .waitFor({ state: 'visible', timeout });
        return;
    }
  }

  async screenshot(): Promise<Buffer> {
    return this.#page.screenshot({ fullPage: false });
  }

  async close(): Promise<void> {
    await this.#context.close();
    await this.#browser.close();
  }

  #byRole(role: ElementRole, name: string): Locator {
    return this.#page.getByRole(role as Parameters<Page['getByRole']>[0], {
      name,
      exact: true
    });
  }

  /** Applies the three-strategy scheme documented at the top of this file. */
  async #resolve(ref: string): Promise<Locator> {
    const descriptor = this.#refs.get(ref);
    if (!descriptor) {
      const known = [...this.#refs.keys()].join(', ') || 'none';
      throw new SurfaceError(
        `Unknown element ref "${ref}". Refs are only valid for the most recent ` +
          `observe() call. Known refs: ${known}`
      );
    }

    const nameIsAccessible =
      descriptor.name !== '' && ACCESSIBLE_NAME_SOURCES.has(descriptor.nameSource);

    if (nameIsAccessible && ARIA_QUERYABLE.has(descriptor.role)) {
      const byRole = this.#byRole(descriptor.role, descriptor.name);
      const count = await byRole.count();
      if (count === 1) return byRole;
      if (count > 1) return byRole.nth(descriptor.nth ?? 0);
    }

    const byCss = this.#page.locator(descriptor.css);
    if ((await byCss.count()) >= 1) return byCss.first();

    throw new SurfaceError(
      `Could not resolve ${ref} (role=${descriptor.role}, name="${descriptor.name}", ` +
        `nameSource=${descriptor.nameSource}). Tried role+name and css "${descriptor.css}".`
    );
  }
}

function normalizeRole(role: string): ElementRole {
  return KNOWN_ROLES.has(role) ? (role as ElementRole) : 'other';
}

function normalizeNameSource(source: string): NameSource {
  const known: NameSource[] = [
    'aria-labelledby',
    'aria-label',
    'label',
    'placeholder',
    'value',
    'text',
    'title',
    'context',
    'none'
  ];
  return known.includes(source as NameSource) ? (source as NameSource) : 'none';
}
