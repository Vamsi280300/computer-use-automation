// Shared types for the surface layer. No knowledge of goals, LLMs or artifacts.

/**
 * Our own role vocabulary, derived from tag + type. It deliberately mirrors ARIA
 * role names where one exists so that role+name locators can be handed straight
 * to Playwright's getByRole, but it is not bound by ARIA: input[type=password]
 * has no ARIA role at all, yet we still classify it as a textbox because that is
 * what it is to an operator filling the form.
 */
export type ElementRole =
  | 'button'
  | 'link'
  | 'textbox'
  | 'searchbox'
  | 'combobox'
  | 'checkbox'
  | 'radio'
  | 'other';

/** Where an element's name came from. Drives which locator strategy is viable. */
export type NameSource =
  | 'aria-labelledby'
  | 'aria-label'
  | 'label'
  | 'placeholder'
  | 'value'
  | 'text'
  | 'title'
  | 'context'
  | 'none';

/**
 * Sources Playwright's own accessible-name computation agrees with. When the
 * name came from one of these, getByRole(role, { name }) can resolve it. When it
 * came from 'context' or 'none' it cannot, and we fall back to structure.
 */
export const ACCESSIBLE_NAME_SOURCES: ReadonlySet<NameSource> = new Set<NameSource>([
  'aria-labelledby',
  'aria-label',
  'label',
  'placeholder',
  'value',
  'text',
  'title'
]);

/**
 * How to find this element again later. This is the shape the artifact schema
 * will persist, so it must stay portable: no Playwright objects, no closures,
 * no live handles - plain JSON only.
 */
export interface LocatorDescriptor {
  role: ElementRole;
  name: string;
  nameSource: NameSource;
  /** Index among elements sharing the same role+name. Absent when unique. */
  nth?: number;
  /** Structural fallback. Brittle by design - used only when role+name fails. */
  css: string;
}

export interface ElementSnapshot {
  /** Handle for act calls. Valid only for the most recent observe(). */
  ref: string;
  role: ElementRole;
  name: string;
  /** Current value for inputs and selects. Never captured for passwords. */
  value?: string;
  disabled?: boolean;
  locator: LocatorDescriptor;
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: ElementSnapshot[];
  /** Set when the element cap was hit, so callers know the list is partial. */
  truncated?: boolean;
}

export type WaitCondition =
  | { type: 'url-contains'; value: string }
  | { type: 'text-visible'; value: string }
  | { type: 'element-visible'; role: ElementRole; name: string };

export interface SurfaceOptions {
  /** Headed by default so discovery runs can be watched. */
  headless?: boolean;
  viewport?: { width: number; height: number };
  /** Slows each Playwright operation, useful when watching a headed run. */
  slowMo?: number;
  defaultTimeoutMs?: number;
  /** Cap on elements returned by observe(), to keep prompts small. */
  maxElements?: number;
}

/** Raw shape returned from the in-page enumeration, before typing/validation. */
export interface RawElement {
  role: string;
  name: string;
  nameSource: string;
  value: string | null;
  disabled: boolean;
  css: string;
}
