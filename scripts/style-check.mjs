/**
 * M5 visual verification harness.
 *
 * Requires a running dev server (default http://localhost:5173/) and Google
 * Chrome. Captures live/empty/error/stale states in light and dark, checks the
 * theme tokens and map tile source, and verifies cardinal marker headings.
 *
 * Run with `npm run style:check`. Override the URL with STYLE_BASE_URL.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE_URL = process.env.STYLE_BASE_URL ?? 'http://localhost:5173/';
const SCREENSHOT_DIR = new URL('../docs/screenshots/', import.meta.url);
const WORKSPACE_KEY = 'window-seat:workspace:v2';
const perimeter = { lamin: 50.8, lomin: -0.8, lamax: 52.2, lomax: 0.4 };

function aircraft(index, heading = 40 + index * 54) {
  const nowSec = Math.floor(Date.now() / 1000);
  return [
    `abc${String(index).padStart(3, '0')}`,
    `WSE${100 + index}`,
    ['United Kingdom', 'France', 'Germany', 'Netherlands', 'Ireland', 'Spain'][
      index % 6
    ],
    nowSec,
    nowSec,
    -0.55 + index * 0.18,
    51.35 + index * 0.16,
    2_500 + index * 2_200,
    false,
    180 + index * 22,
    heading,
    (index % 3) - 1,
    null,
    2_500 + index * 2_200,
    '7000',
    false,
    0,
  ];
}

async function presetWorkspace(page) {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: WORKSPACE_KEY,
      value: {
        version: 2,
        perimeter,
        mode: 'perimeter',
        direction: null,
        savedSelections: [],
        units: 'aviation',
        theme: 'system',
        autoRefreshMs: 300_000,
        providerId: null,
      },
    },
  );
}

async function routeSnapshot(page, states) {
  const nowSec = Math.floor(Date.now() / 1000);
  await page.route('**/opensky/api/states/all*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ time: nowSec, states }),
    });
  });
}

async function routeFailure(page) {
  await page.route('**/opensky/api/states/all*', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'text/plain',
      body: 'service unavailable',
    });
  });
}

async function open(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.leaflet-container');
  await page.evaluate(() => document.fonts.ready);
}

async function shot(page, scheme, state) {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: new URL(`${scheme}-${state}.jpg`, SCREENSHOT_DIR).pathname,
    type: 'jpeg',
    quality: 82,
  });
}

async function captureState(browser, scheme, state) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: scheme,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await presetWorkspace(page);

  try {
    if (state === 'error') {
      await routeFailure(page);
      await open(page);
      await page.locator('.status-banner--error').waitFor();
    } else if (state === 'empty') {
      await routeSnapshot(page, []);
      await open(page);
      await page
        .getByText('No airborne aircraft in this area right now.')
        .waitFor();
    } else {
      await routeSnapshot(page, [0, 1, 2, 3, 4, 5].map((i) => aircraft(i)));
      await open(page);
      await page.waitForFunction(
        () => document.querySelectorAll('.flight-row').length > 0,
      );
      if (state === 'live') {
        await page.locator('.flight-row').first().click();
        await page.locator('.detail-card').waitFor();
      }
      if (state === 'stale') {
        // Advance the app's clock without waiting 90 real seconds. The hook
        // refreshes data age every 5 s.
        await page.evaluate(() => {
          const realNow = Date.now.bind(Date);
          const offset = 120_000;
          Date.now = () => realNow() + offset;
        });
        await page.waitForTimeout(5_500);
        await page.locator('.status-banner--warning').waitFor();
      }
    }

    await page.waitForTimeout(900);
    await shot(page, scheme, state);
    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  } finally {
    await context.close();
  }
}

async function checkTokens(browser) {
  const results = {};
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: scheme,
    });
    const page = await context.newPage();
    await presetWorkspace(page);
    await routeSnapshot(page, [aircraft(0), aircraft(1)]);
    await open(page);
    await page.waitForFunction(
      () => document.querySelectorAll('.flight-row').length > 0,
    );

    results[scheme] = await page.evaluate(() => {
      const style = (selector) =>
        getComputedStyle(document.querySelector(selector));
      return {
        body: style('body').backgroundColor,
        panel: style('.flight-panel').backgroundColor,
        ink: style('body').color,
        muted: style('.row-country').color,
        wordmarkFont: style('.panel-header h2').fontFamily,
        activeMode: style('.mode-btn--active').backgroundColor,
        mapTiles: document
          .querySelector('.leaflet-tile')
          ?.getAttribute('src'),
        darkMap: document
          .querySelector('.leaflet-container')
          ?.classList.contains('map-dark'),
      };
    });
    await context.close();
  }

  assert.equal(results.light.body, 'rgb(250, 250, 249)');
  assert.equal(results.dark.body, 'rgb(12, 10, 9)');
  assert.equal(results.light.panel, 'rgb(255, 255, 255)');
  assert.equal(results.dark.panel, 'rgb(28, 25, 23)');
  assert.match(results.light.wordmarkFont, /Playfair Display/);
  assert.match(results.dark.wordmarkFont, /Playfair Display/);
  assert.equal(results.light.darkMap, false);
  assert.equal(results.dark.darkMap, true);
  assert.match(results.light.mapTiles, /tile\.openstreetmap\.org/);
  assert.match(results.dark.mapTiles, /tile\.openstreetmap\.org/);
  console.log('theme tokens + map tiles: PASS');
}

async function checkCardinalHeadings(browser) {
  const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
    colorScheme: 'light',
  });
  const page = await context.newPage();
  await presetWorkspace(page);
  await routeSnapshot(
    page,
    [0, 90, 180, 270].map((heading, index) =>
      aircraft(index, heading),
    ),
  );
  await open(page);
  await page.waitForFunction(
    () => document.querySelectorAll('.plane-glyph').length === 4,
  );
  await page.waitForTimeout(600);

  const transforms = await page.evaluate(() =>
    [...document.querySelectorAll('.plane-glyph')].map(
      (element) => element.style.transform,
    ),
  );
  const rotations = transforms.map((transform) => {
    const match = transform.match(/rotate\(([\d.]+)deg\)/);
    return match ? Number(match[1]) : null;
  });
  assert.deepEqual(
    [...rotations].sort((a, b) => a - b),
    [0, 90, 180, 270],
    `cardinal marker headings should rotate correctly: ${rotations.join(', ')}`,
  );
  console.log('cardinal marker headings: PASS');
  await context.close();
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.STYLE_CHANNEL ?? 'chrome',
    headless: true,
  });

  try {
    for (const scheme of ['light', 'dark']) {
      for (const state of ['live', 'empty', 'error', 'stale']) {
        await captureState(browser, scheme, state);
        console.log(`${scheme} ${state}: screenshot captured`);
      }
    }
    await checkTokens(browser);
    await checkCardinalHeadings(browser);
    console.log('Visual verification: PASS');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
