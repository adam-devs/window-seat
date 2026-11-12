/**
 * M3.6.5 Saved-library verification harness.
 *
 * Requires a running dev server (default http://localhost:5173/) and Google
 * Chrome. Covers the full save/restore/rename/delete lifecycle, v1 migration,
 * corrupt/capped entries, and the mobile layout.
 *
 * Run with `npm run saved:check`. Override the URL with SAVED_BASE_URL.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.SAVED_BASE_URL ?? 'http://localhost:5173/';
const WORKSPACE_KEY = 'window-seat:workspace:v2';
const LEGACY_KEY = 'window-seat:workspace:v1';

const boxA = { lamin: 50, lomin: -1, lamax: 51, lomax: 0 };
const boxB = { lamin: 40, lomin: -2, lamax: 41, lomax: -1 };
const direction = {
  origin: { latitude: 51.5, longitude: -0.1 },
  bearingDeg: 90,
  angleDeg: 60,
  visibilityKm: 100,
};

function savedPerimeter(id, name, perimeter, createdAt = 1_000) {
  return {
    id,
    name,
    kind: 'perimeter',
    perimeter,
    createdAt,
    updatedAt: createdAt + 1_000,
  };
}

function savedDirection(id, name, view = direction) {
  return {
    id,
    name,
    kind: 'direction',
    direction: view,
    createdAt: 3_000,
    updatedAt: 4_000,
  };
}

function storedWorkspace(overrides = {}) {
  return {
    version: 2,
    perimeter: null,
    mode: 'perimeter',
    direction: null,
    savedSelections: [],
    units: 'aviation',
    theme: 'system',
    autoRefreshMs: 30_000,
    providerId: null,
    ...overrides,
  };
}

async function routeEmpty(page) {
  await page.route('**/opensky/api/states/all*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        states: [],
      }),
    });
  });
}

function waitForFetch(page) {
  return page.waitForResponse((response) =>
    /\/opensky\/api\/states\/all/.test(response.url()),
  );
}

async function openSaved(page) {
  await page.getByRole('button', { name: 'Saved areas' }).click();
  await page.locator('.saved-popover').waitFor();
}

async function closeSaved(page) {
  await page.keyboard.press('Escape');
  await page.locator('.saved-popover').waitFor({ state: 'detached' });
}

async function saveCurrent(page, name, label) {
  await openSaved(page);
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: label }).click();
  await closeSaved(page);
}

async function readWorkspace(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, WORKSPACE_KEY);
}

async function reloadAndWait(page) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.leaflet-container');
  await page.waitForTimeout(600);
}

async function runLifecycle(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.text().includes('Failed to load resource')
    ) {
      errors.push(message.text());
    }
  });
  await routeEmpty(page);

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.leaflet-container');
    const map = await page.locator('.leaflet-container').boundingBox();
    assert.ok(map, 'map should be visible');

    // Perimeter 1.
    let fetch = waitForFetch(page);
    await page.mouse.click(map.x + map.width * 0.3, map.y + map.height * 0.3);
    await page.mouse.click(map.x + map.width * 0.6, map.y + map.height * 0.6);
    await fetch;
    await page.waitForTimeout(450);
    await saveCurrent(page, 'Home', 'Save current area');

    // Perimeter 2.
    fetch = waitForFetch(page);
    await page.mouse.click(map.x + map.width * 0.42, map.y + map.height * 0.42);
    await page.mouse.click(map.x + map.width * 0.7, map.y + map.height * 0.7);
    await fetch;
    await page.waitForTimeout(450);
    await saveCurrent(page, 'Work', 'Save current area');

    // Directional View.
    await page.getByRole('button', { name: 'View' }).click();
    const centreX = map.x + map.width * 0.5;
    const centreY = map.y + map.height * 0.5;
    await page.mouse.click(centreX, centreY);
    fetch = waitForFetch(page);
    await page.mouse.click(centreX + 140, centreY - 30);
    await fetch;
    await page.waitForTimeout(500);
    await saveCurrent(page, 'East view', 'Save current view');

    let workspace = await readWorkspace(page);
    assert.equal(workspace.savedSelections.length, 3);
    assert.deepEqual(
      workspace.savedSelections.map((entry) => `${entry.kind}:${entry.name}`),
      ['perimeter:Home', 'perimeter:Work', 'direction:East view'],
    );

    // Reload and confirm all three survived.
    await reloadAndWait(page);
    await openSaved(page);
    for (const name of ['Home', 'Work', 'East view']) {
      assert.equal(
        await page.getByRole('button', { name: `Load ${name}` }).count(),
        1,
      );
    }
    assert.match(await page.locator('.saved-item--active').textContent(), /East view/);
    await closeSaved(page);

    // Restore each entry and confirm the mode/geometry.
    fetch = waitForFetch(page);
    await openSaved(page);
    await page.getByRole('button', { name: 'Load Home' }).click();
    await fetch;
    await page.waitForTimeout(450);
    assert.equal(
      await page.getByRole('button', { name: 'Perimeter' }).getAttribute('aria-pressed'),
      'true',
    );

    fetch = waitForFetch(page);
    await openSaved(page);
    await page.getByRole('button', { name: 'Load Work' }).click();
    await fetch;
    await page.waitForTimeout(450);
    await openSaved(page);
    assert.match(await page.locator('.saved-item--active').textContent(), /Work/);

    fetch = waitForFetch(page);
    await page.getByRole('button', { name: 'Load East view' }).click();
    await fetch;
    await page.waitForTimeout(450);
    assert.equal(await page.locator('.view-cone').count(), 1);
    await openSaved(page);
    assert.match(await page.locator('.saved-item--active').textContent(), /East view/);

    // Rename Work -> Office; reload to prove persistence.
    await page.getByRole('button', { name: 'Rename Work' }).click();
    await page.getByRole('textbox', { name: 'Rename Work' }).fill('Office');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await closeSaved(page);
    await reloadAndWait(page);
    await openSaved(page);
    assert.equal(await page.getByRole('button', { name: 'Load Office' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Load Work' }).count(), 0);

    // Delete a non-active entry and reload.
    await page.getByRole('button', { name: 'Delete Office' }).click();
    await closeSaved(page);
    await reloadAndWait(page);
    await openSaved(page);
    assert.equal(await page.getByRole('button', { name: 'Load Office' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Load Home' }).count(), 1);

    // Delete the active View; the current selection must remain unsaved.
    assert.match(await page.locator('.saved-item--active').textContent(), /East view/);
    await page.getByRole('button', { name: 'Delete East view' }).click();
    assert.equal(await page.locator('.view-cone').count(), 1);
    await closeSaved(page);

    await reloadAndWait(page);
    assert.equal(await page.locator('.view-cone').count(), 1);
    assert.equal(
      await page.getByRole('button', { name: 'View' }).getAttribute('aria-pressed'),
      'true',
    );
    await openSaved(page);
    assert.equal(await page.getByRole('button', { name: 'Load Home' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Load East view' }).count(), 0);
    await closeSaved(page);

    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
    console.log('lifecycle: PASS — 2 perimeters + 1 view, restore/rename/delete');
  } finally {
    await context.close();
  }
}

async function runMigration(browser) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(
    ({ legacyKey, workspace }) => {
      localStorage.setItem(legacyKey, JSON.stringify(workspace));
    },
    {
      legacyKey: LEGACY_KEY,
      workspace: {
        version: 1,
        perimeter: boxA,
        mode: 'direction',
        direction,
        units: 'metric',
        theme: 'dark',
        autoRefreshMs: 60_000,
        providerId: 'opensky',
      },
    },
  );
  await routeEmpty(page);

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.leaflet-container');
    await page.waitForTimeout(600);

    const workspace = await readWorkspace(page);
    assert.ok(workspace, 'v1 should migrate to the v2 key');
    assert.equal(workspace.version, 2);
    assert.deepEqual(workspace.savedSelections, []);
    assert.equal(workspace.mode, 'direction');
    assert.equal(workspace.direction.visibilityKm, 100);
    assert.equal(workspace.units, 'metric');
    assert.equal(workspace.theme, 'dark');
    assert.equal(
      await page.getByRole('button', { name: 'View' }).getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(await page.locator('.view-cone').count(), 1);

    await saveCurrent(page, 'Migrated view', 'Save current view');
    assert.equal((await readWorkspace(page)).savedSelections.length, 1);
    assert.deepEqual(errors, []);
    console.log('v1 migration: PASS');
  } finally {
    await context.close();
  }
}

async function runCapAndInvalidEntries(browser) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const many = Array.from({ length: 32 }, (_, index) =>
    savedPerimeter(`p-${index}`, `Area ${index}`, {
      lamin: 40 + index,
      lomin: -2,
      lamax: 41 + index,
      lomax: -1,
    }),
  );
  await page.addInitScript(
    ({ key, workspace }) => {
      localStorage.setItem(key, JSON.stringify(workspace));
    },
    {
      key: WORKSPACE_KEY,
      workspace: storedWorkspace({
        perimeter: boxA,
        savedSelections: [
          ...many,
          { id: '', name: 'Broken', kind: 'perimeter' },
          { id: 'also-broken', name: 'Broken 2', kind: 'circle' },
        ],
        units: 'metric',
      }),
    },
  );
  await routeEmpty(page);

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.leaflet-container');
    await page.waitForTimeout(500);
    await openSaved(page);

    assert.equal(await page.locator('.saved-item').count(), 30);
    assert.equal(
      (await page.getByRole('button', { name: 'Save current area' }).isDisabled()),
      true,
    );
    assert.match(await page.locator('.saved-note').textContent(), /full \(30\)/);
    assert.equal(await page.getByRole('button', { name: 'Load Broken' }).count(), 0);

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    assert.equal(
      await page.getByRole('radio', { name: /Metric/ }).isChecked(),
      true,
    );
    assert.deepEqual(errors, []);
    console.log('cap/invalid entries: PASS');
  } finally {
    await context.close();
  }
}

async function runMobile(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(
    ({ key, workspace }) => {
      localStorage.setItem(key, JSON.stringify(workspace));
    },
    {
      key: WORKSPACE_KEY,
      workspace: storedWorkspace({
        perimeter: boxA,
        savedSelections: [
          savedPerimeter('p1', 'Home', boxA),
          savedDirection('v1', 'East view'),
        ],
      }),
    },
  );
  await routeEmpty(page);

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.leaflet-container');
    await page.waitForTimeout(400);
    await openSaved(page);

    const box = await page.locator('.saved-popover').boundingBox();
    assert.ok(box);
    assert.ok(box.x >= 0, 'dialog should not overflow left');
    assert.ok(box.x + box.width <= 390 + 1, 'dialog should not overflow right');
    assert.ok(box.y + box.height <= 844 + 1, 'dialog should fit vertically');
    assert.equal(await page.getByRole('button', { name: 'Load Home' }).count(), 1);
    assert.deepEqual(errors, []);
    console.log('mobile layout: PASS');
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.SAVED_CHANNEL ?? 'chrome',
    headless: true,
  });

  try {
    await runLifecycle(browser);
    await runMigration(browser);
    await runCapAndInvalidEntries(browser);
    await runMobile(browser);
    console.log('Saved-library verification: PASS');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
