import type { RawElement } from './types.js';

/**
 * Runs inside the page via page.evaluate(). Playwright stringifies this function
 * and evaluates it in the browser, so it MUST be entirely self-contained: every
 * helper is nested, and nothing from module scope may be referenced.
 */
export function collectInteractiveElements(): RawElement[] {
  const SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[contenteditable="true"]'
  ].join(', ');

  const norm = (s: string | null | undefined): string =>
    (s ?? '').replace(/\s+/g, ' ').trim();

  function isVisible(el: Element): boolean {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function roleOf(el: Element): string {
    const explicit = norm(el.getAttribute('role')).toLowerCase();
    if (explicit) return explicit;

    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = norm(el.getAttribute('type')).toLowerCase() || 'text';
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') {
        return 'button';
      }
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'search') return 'searchbox';
      // password / email / tel / url / number / text all behave as a textbox
      return 'textbox';
    }
    return 'other';
  }

  /**
   * Simplified accessible-name computation, in roughly the order the real
   * accname spec uses. The final 'context' step is NOT part of accname: it reads
   * the adjacent table cell, which is how legacy table-formatted forms label
   * their fields when they carry no <label> at all.
   */
  function nameOf(el: Element): { name: string; source: string } {
    const labelledBy = norm(el.getAttribute('aria-labelledby'));
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => norm(document.getElementById(id)?.textContent))
        .filter(Boolean)
        .join(' ');
      if (text) return { name: text, source: 'aria-labelledby' };
    }

    const ariaLabel = norm(el.getAttribute('aria-label'));
    if (ariaLabel) return { name: ariaLabel, source: 'aria-label' };

    const tag = el.tagName.toLowerCase();
    const type = norm(el.getAttribute('type')).toLowerCase();

    if (tag === 'input' && (type === 'submit' || type === 'button' || type === 'reset')) {
      const value = norm(el.getAttribute('value'));
      if (value) return { name: value, source: 'value' };
    }

    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const id = el.getAttribute('id');
      if (id) {
        const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const text = norm(forLabel?.textContent);
        if (text) return { name: text, source: 'label' };
      }
      const wrapping = norm(el.closest('label')?.textContent);
      if (wrapping) return { name: wrapping, source: 'label' };

      const placeholder = norm(el.getAttribute('placeholder'));
      if (placeholder) return { name: placeholder, source: 'placeholder' };
    }

    // Form controls never take their name from their own content. Skipping this
    // matters for <select>, whose textContent is the concatenated option labels
    // ("Checking Savings") - a name that describes the choices, not the field.
    const isFormControl = tag === 'input' || tag === 'select' || tag === 'textarea';
    if (!isFormControl) {
      const text = norm(el.textContent);
      if (text) return { name: text, source: 'text' };
    }

    const title = norm(el.getAttribute('title'));
    if (title) return { name: title, source: 'title' };

    const contextual = contextLabelOf(el);
    if (contextual) return { name: contextual, source: 'context' };

    return { name: '', source: 'none' };
  }

  /** Nearest descriptive text in the same table row - the legacy form pattern. */
  function contextLabelOf(el: Element): string {
    const cell = el.closest('td, th');
    if (!cell) return '';

    let prev = cell.previousElementSibling;
    while (prev) {
      const text = norm(prev.textContent);
      if (text) return text;
      prev = prev.previousElementSibling;
    }

    const header = cell.closest('tr')?.querySelector('th');
    if (header && header !== cell) {
      const text = norm(header.textContent);
      if (text) return text;
    }
    return '';
  }

  /** Structural path, used only as a last-resort fallback locator. */
  function cssPathOf(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.tagName.toLowerCase() !== 'html') {
      const tag = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName.toLowerCase() === tag
      );
      parts.unshift(
        siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag
      );
      node = parent;
    }
    return parts.join(' > ');
  }

  function valueOf(el: Element): string | null {
    const tag = el.tagName.toLowerCase();
    const type = norm(el.getAttribute('type')).toLowerCase();
    // Never read back a password field.
    if (tag === 'input' && type === 'password') return null;
    if (tag === 'input' || tag === 'textarea') {
      return (el as HTMLInputElement | HTMLTextAreaElement).value ?? null;
    }
    if (tag === 'select') {
      const select = el as HTMLSelectElement;
      const opt = select.selectedOptions[0];
      return opt ? norm(opt.textContent) || opt.value : select.value;
    }
    return null;
  }

  const out: RawElement[] = [];
  for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
    const type = norm(el.getAttribute('type')).toLowerCase();
    if (type === 'hidden') continue;
    if (!isVisible(el)) continue;

    const { name, source } = nameOf(el);
    out.push({
      role: roleOf(el),
      name: name.length > 120 ? `${name.slice(0, 117)}...` : name,
      nameSource: source,
      value: valueOf(el),
      disabled: (el as HTMLInputElement).disabled === true,
      css: cssPathOf(el)
    });
  }
  return out;
}
