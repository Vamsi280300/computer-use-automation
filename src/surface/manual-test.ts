/**
 * Standalone smoke test for the surface layer. Not a formal test suite - it is a
 * runnable script that drives the mock servicing app end to end so the
 * observe/act contract can be eyeballed against a real page.
 *
 *   npm run mock-app      # in one terminal
 *   npm run test:surface  # in another
 *
 * Set HEADLESS=1 to run without a visible browser window.
 */

import process from 'node:process';

import { Surface } from './surface.js';
import type { ElementSnapshot, PageSnapshot } from './types.js';

const BASE_URL = process.env.MOCK_APP_URL ?? 'http://localhost:4000';
const HEADLESS = process.env.HEADLESS === '1';

function printSnapshot(label: string, snapshot: PageSnapshot): void {
  console.log('');
  console.log('='.repeat(78));
  console.log(`SNAPSHOT: ${label}`);
  console.log('='.repeat(78));
  console.log(`  title: ${snapshot.title}`);
  console.log(`  url:   ${snapshot.url}`);
  console.log(`  elements: ${snapshot.elements.length}${snapshot.truncated ? ' (truncated)' : ''}`);
  console.log('');
  console.log(
    `  ${'ref'.padEnd(5)}${'role'.padEnd(10)}${'name'.padEnd(28)}${'value'.padEnd(14)}${'locator strategy'}`
  );
  console.log(`  ${'-'.repeat(74)}`);

  for (const el of snapshot.elements) {
    const strategy = describeStrategy(el);
    console.log(
      `  ${el.ref.padEnd(5)}${el.role.padEnd(10)}${truncate(el.name, 27).padEnd(28)}` +
        `${truncate(el.value ?? '', 13).padEnd(14)}${strategy}`
    );
  }
}

/** Mirrors the resolution order in surface.ts, for display purposes only. */
function describeStrategy(el: ElementSnapshot): string {
  const { nameSource, nth } = el.locator;
  const accessible =
    nameSource !== 'context' && nameSource !== 'none' && el.name !== '';
  if (accessible) {
    const base = `role+name (${nameSource})`;
    return nth === undefined ? base : `${base} nth=${nth}`;
  }
  return `css fallback (name from ${nameSource})`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function requireElement(
  snapshot: PageSnapshot,
  description: string,
  predicate: (el: ElementSnapshot) => boolean
): ElementSnapshot {
  const found = snapshot.elements.find(predicate);
  if (!found) {
    throw new Error(
      `Expected to find ${description} on ${snapshot.url}, but it was not in the snapshot.`
    );
  }
  console.log(`  -> matched ${description}: ${found.ref} (${found.role} "${found.name}")`);
  return found;
}

async function main(): Promise<void> {
  console.log(`Launching surface (headless=${HEADLESS}) against ${BASE_URL}`);
  const surface = await Surface.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 250 });

  try {
    // ---- login page ------------------------------------------------------
    await surface.goto(`${BASE_URL}/login`);
    const login = await surface.observe();
    printSnapshot('login page', login);

    console.log('');
    console.log('ACT: filling the sign-on form using observed refs');
    const operator = requireElement(login, 'the operator id field',
      (el) => el.role === 'textbox' && /operator/i.test(el.name));
    const password = requireElement(login, 'the password field',
      (el) => el.role === 'textbox' && /password/i.test(el.name));
    const signOn = requireElement(login, 'the sign-on button',
      (el) => el.role === 'button' && /sign on/i.test(el.name));

    await surface.type(operator.ref, 'jdoe');
    await surface.type(password.ref, 'hunter2');
    console.log('  -> typed credentials');

    await surface.click(signOn.ref);
    console.log('  -> clicked sign on');

    await surface.waitFor({ type: 'url-contains', value: '/search' }, 5000);
    console.log('  -> waitFor url-contains "/search" satisfied');

    // ---- search page -----------------------------------------------------
    const search = await surface.observe();
    printSnapshot('search page (post-login)', search);

    console.log('');
    console.log('ACT: exercising the remaining wait conditions');
    await surface.waitFor({ type: 'text-visible', value: 'member number' }, 5000);
    console.log('  -> waitFor text-visible "member number" satisfied');
    await surface.waitFor({ type: 'element-visible', role: 'button', name: 'Search' }, 5000);
    console.log('  -> waitFor element-visible button "Search" satisfied');

    const shot = await surface.screenshot();
    console.log(`  -> screenshot captured: ${shot.length} bytes`);

    console.log('');
    console.log('FLOW COMPLETE: login -> search reached and observed.');
  } finally {
    await surface.close();
    console.log('Browser closed.');
  }
}

main().catch((error: unknown) => {
  console.error('');
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
