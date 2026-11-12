/**
 * Flight enrichment verification harness.
 *
 * Requires a running dev server (default http://localhost:5173/) and Google
 * Chrome. Mocks OpenSky and adsbdb, then verifies visible-row enrichment,
 * route/type details, caching across refresh/reload, and unknown fallbacks.
 *
 * Run with `npm run enrich:check`. Override the URL with ENRICH_BASE_URL.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.ENRICH_BASE_URL ?? 'http://localhost:5173/';
const WORKSPACE_KEY = 'window-seat:workspace:v2';
const perimeter = { lamin: 50.8, lomin: -0.8, lamax: 52.2, lomax: 0.4 };

const routePayload = {
  response: {
    aircraft: {
      type: 'A321-231',
      icao_type: 'A321',
      manufacturer: 'Airbus',
      registration: 'D-AIAA',
    },
    flightroute: {
      callsign: 'EXS1286',
      airline: {
        name: 'Jet2.com',
        icao: 'EXS',
        iata: 'LS',
        country: 'United Kingdom',
      },
      origin: {
        country_iso_name: 'ES',
        country_name: 'Spain',
        iata_code: 'LEI',
        icao_code: 'LEAM',
        municipality: 'Almería',
        name: 'Almería Airport',
      },
    },
  },
};

function states() {
  const nowSec = Math.floor(Date.now() / 1000);
  return [0, 1, 2, 3, 4, 5].map((index) => [
    `abc${String(index).padStart(3, '0')}`,
    index === 0 ? 'EXS1286' : `WSE${100 + index}`,
    'United Kingdom',
    nowSec,
    nowSec,
    -0.55 + index * 0.18,
    51.35 + index * 0.16,
    2_500 + index * 2_200,
    false,
    180 + index * 22,
    40 + index * 54,
    (index % 3) - 1,
    null,
    2_500 + index * 2_200,
    '7000',
    false,
    0,
  ]);
}

async function prepare(page) {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
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
        autoRefreshMs: 30_000,
        providerId: null,
      },
    },
  );
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.ENRICH_CHANNEL ?? 'chrome',
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  const enrichRequests = [];

  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.text().includes('Failed to load resource')
    ) {
      errors.push(message.text());
    }
  });

  await prepare(page);
  await page.route('**/opensky/api/states/all*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        states: states(),
      }),
    });
  });
  await page.route('**/adsbdb/**', async (route) => {
    const url = new URL(route.request().url());
    enrichRequests.push(url.pathname + url.search);
    if (url.searchParams.get('callsign') === 'EXS1286') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(routePayload),
      });
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'unknown callsign' }),
      });
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.leaflet-container');
    await page.waitForFunction(
      () => document.querySelectorAll('.flight-row').length === 6,
    );
    await page.waitForFunction(
      () => document.querySelector('.row-flag')?.textContent?.includes('🇪🇸'),
      null,
      { timeout: 30_000 },
    );

    const initialCalls = [...enrichRequests];
    assert.ok(initialCalls.length >= 1, 'visible rows should request metadata');
    assert.equal(
      new Set(initialCalls).size,
      initialCalls.length,
      'each visible flight should request metadata once',
    );
    assert.ok(
      initialCalls.every((url) => url.startsWith('/adsbdb/v0/aircraft/abc')),
      `requests should use the local adsbdb proxy: ${initialCalls.join(', ')}`,
    );

    // The row exposes an origin flag and switches its secondary line to the city.
    assert.equal(
      await page.locator('.row-flag').first().textContent(),
      '🇪🇸',
    );
    assert.match(
      await page.locator('.flight-row').first().textContent(),
      /EXS1286.*Almería/,
    );

    // Clicking the row shows the scheduled origin and aircraft type.
    await page.locator('.flight-row').first().click();
    await page.locator('.detail-card').waitFor();
    const detail = await page.locator('.detail-card').textContent();
    assert.match(detail, /Likely from/);
    assert.match(detail, /Almería/);
    assert.match(detail, /Almería Airport \(LEI \/ LEAM\)/);
    assert.match(detail, /Airbus A321-231/);
    assert.match(detail, /ICAO type A321/);
    assert.match(detail, /Jet2\.com/);
    assert.match(detail, /EXS \/ LS · United Kingdom/);
    assert.match(detail, /via adsbdb\.com/);

    // Unknown callsigns use the neutral globe and unavailable detail states.
    await page.locator('.flight-row').nth(1).click();
    await page.locator('.detail-card').waitFor();
    assert.ok(
      await page.locator('.row-flag').nth(1).locator('svg').count(),
    );
    const unknownDetail = await page.locator('.detail-card').textContent();
    assert.match(unknownDetail, /Unavailable/);
    assert.doesNotMatch(unknownDetail, /Almería/);

    // A refresh reuses the cache and does not issue duplicate requests.
    const beforeRefresh = enrichRequests.length;
    const refreshed = page.waitForResponse((response) =>
      /\/opensky\/api\/states\/all/.test(response.url()),
    );
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await refreshed;
    await page.waitForTimeout(800);
    assert.equal(
      enrichRequests.length,
      beforeRefresh,
      'enrichment should be cached across refreshes',
    );

    // A reload also rehydrates the persistent cache.
    const beforeReload = enrichRequests.length;
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => document.querySelectorAll('.flight-row').length === 6,
    );
    await page.waitForFunction(
      () => document.querySelector('.row-flag')?.textContent?.includes('🇪🇸'),
      null,
      { timeout: 30_000 },
    );
    await page.waitForTimeout(500);
    assert.equal(
      enrichRequests.length,
      beforeReload,
      'enrichment should be cached across reloads',
    );

    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
    console.log(
      `enrichment: PASS — ${initialCalls.length} visible-row lookups, cached on refresh/reload`,
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
