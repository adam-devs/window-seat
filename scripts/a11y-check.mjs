/**
 * M4 mobile/accessibility verification harness.
 *
 * Requires a running dev server (default http://localhost:5173/) and Google
 * Chrome. Covers keyboard-only area/View selection, keyboard-operable rows,
 * popover focus wrapping, the mobile bottom sheet, map resizing, and WCAG AA
 * text contrast on the dark theme.
 *
 * Run with `npm run a11y:check`. Override the URL with A11Y_BASE_URL.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.A11Y_BASE_URL ?? 'http://localhost:5173/';
const WORKSPACE_KEY = 'window-seat:workspace:v2';

const perimeter = { lamin: 50.8, lomin: -0.8, lamax: 52.2, lomax: 0.4 };

function aircraft(index) {
  const nowSec = Math.floor(Date.now() / 1000);
  return [
    `a11y${String(index).padStart(3, '0')}`,
    `A11Y${index}`,
    'Testland',
    nowSec,
    nowSec,
    -0.4 + index * 0.2,
    51.3 + index * 0.25,
    4_000 + index * 500,
    false,
    210 + index * 10,
    80 + index * 20,
    0,
    null,
    4_000 + index * 500,
    '7000',
    false,
    0,
  ];
}

async function routeFlights(page) {
  await page.route('**/opensky/api/states/all*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        states: [aircraft(0), aircraft(1), aircraft(2)],
      }),
    });
  });
}

async function waitForFlights(page) {
  await page.waitForFunction(
    () => document.querySelectorAll('.flight-row').length > 0,
    null,
    { timeout: 30_000 },
  );
}

async function focusMap(page) {
  const map = page.locator('.leaflet-container');
  await map.focus();
  assert.ok(
    await map.evaluate((element) => element === document.activeElement),
    'the map should be keyboard focusable',
  );
}

async function pan(page, key, times) {
  for (let index = 0; index < times; index += 1) {
    await page.keyboard.press(key);
  }
  // Leaflet animates arrow-key pans; wait for the centre to settle.
  await page.waitForTimeout(400);
}

function contrastRatio(foreground, background) {
  function luminance([r, g, b]) {
    const channel = (value) => {
      const normalized = value / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    );
  }

  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

async function measureContrast(page, selector) {
  return page.evaluate(
    ({ selector, contrastSource }) => {
      const ratio = new Function(`return (${contrastSource})`)();
      const element = document.querySelector(selector);
      if (!element) return { selector, missing: true };

      function parseColour(value) {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const parts = match[1]
          .split(/[,\s/]+/)
          .filter(Boolean)
          .map(Number);
        return {
          rgb: parts.slice(0, 3),
          alpha: parts.length > 3 ? parts[3] : 1,
        };
      }

      function backgroundFor(node) {
        let current = node;
        while (current) {
          const colour = parseColour(
            getComputedStyle(current).backgroundColor,
          );
          if (colour && colour.alpha > 0.95) return colour.rgb;
          current = current.parentElement;
        }
        return [15, 17, 23];
      }

      const style = getComputedStyle(element);
      const foreground = parseColour(style.color)?.rgb;
      if (!foreground) return { selector, missing: true };
      const background = backgroundFor(element);
      const size = parseFloat(style.fontSize);
      const weight = Number(style.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      return {
        selector,
        ratio: ratio(foreground, background),
        large,
        size,
        weight,
      };
    },
    { selector, contrastSource: contrastRatio.toString() },
  );
}

async function runDesktop(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
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
  await routeFlights(page);

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.leaflet-container');

    const map = page.locator('.leaflet-container');
    assert.match(
      (await map.getAttribute('aria-label')) ?? '',
      /Map for/,
      'the map should expose an aria-label',
    );
    assert.equal(
      await map.getAttribute('aria-describedby'),
      'map-keyboard-instructions',
    );
    assert.ok(
      await page.locator('#map-keyboard-instructions').textContent(),
      'keyboard instructions should exist',
    );

    // ---- Keyboard-only perimeter ----
    await focusMap(page);
    await pan(page, 'ArrowLeft', 3);
    await pan(page, 'ArrowUp', 2);
    await page.keyboard.press('Enter');
    await pan(page, 'ArrowRight', 5);
    await pan(page, 'ArrowDown', 4);
    const request = page.waitForResponse((response) =>
      /\/opensky\/api\/states\/all/.test(response.url()),
    );
    await page.keyboard.press('Enter');
    const response = await request;
    const params = new URL(response.url()).searchParams;
    const bounds = ['lamin', 'lomin', 'lamax', 'lomax'].map((key) =>
      Number(params.get(key)),
    );
    assert.ok(
      bounds[0] < bounds[2] && bounds[1] < bounds[3],
      `keyboard corners should form a non-empty area: ${bounds.join(', ')}`,
    );

    await waitForFlights(page);
    assert.match(
      await page
        .locator('.perimeter-instructions span[aria-live="polite"]')
        .textContent(),
      /Perimeter set/,
    );

    // Rows are real buttons and toggle with the keyboard.
    const row = page.locator('.flight-row').first();
    assert.equal(await row.evaluate((element) => element.tagName), 'BUTTON');
    await row.focus();
    await page.keyboard.press('Enter');
    assert.equal(await row.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.detail-card').count(), 1);
    await page.keyboard.press('Enter');
    assert.equal(await row.getAttribute('aria-pressed'), 'false');

    // ---- Keyboard-only View ----
    await page.getByRole('button', { name: 'View' }).focus();
    await page.keyboard.press('Enter');
    await focusMap(page);
    await page.keyboard.press('Enter');
    assert.equal(
      await map.getAttribute('aria-label'),
      'Map for aiming a view',
    );
    await pan(page, 'ArrowRight', 4);
    await page.keyboard.press('Enter');
    await page.locator('.view-cone').waitFor({ timeout: 10_000 });
    await waitForFlights(page);

    // ---- Popover focus wrapping and Escape ----
    await page.getByRole('button', { name: 'Saved areas' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const focusable = dialog.locator(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const last = focusable.last();
    await last.focus();
    await page.keyboard.press('Tab');
    assert.ok(
      await focusable.first().evaluate(
        (element) => element === document.activeElement,
      ),
      'Tab from the last control should wrap to the first',
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.ok(
      await page
        .getByRole('button', { name: 'Saved areas' })
        .evaluate((element) => element === document.activeElement),
      'Escape should return focus to the trigger',
    );

    // ---- WCAG AA text contrast ----
    await page.locator('.flight-row').first().click();
    await page.locator('.detail-card').waitFor();
    const selectors = [
      '.panel-header h2',
      '.subtitle',
      '.count',
      '.row-callsign',
      '.row-country',
      '.mode-btn--active',
      '.mode-btn:not(.mode-btn--active)',
      '.detail-label',
      '.detail-value',
      '.fr24-link',
    ];
    for (const selector of selectors) {
      const result = await measureContrast(page, selector);
      assert.ok(!result.missing, `${selector} should be present`);
      const minimum = result.large ? 3 : 4.5;
      assert.ok(
        result.ratio >= minimum,
        `${selector} contrast ${result.ratio.toFixed(2)} should be >= ${minimum}`,
      );
    }

    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
    console.log('desktop keyboard + contrast: PASS');
  } finally {
    await context.close();
  }
}

async function runMobile(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
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
        autoRefreshMs: 30_000,
        providerId: null,
      },
    },
  );
  await routeFlights(page);

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.leaflet-container');
    await waitForFlights(page);

    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      'the page should not overflow horizontally',
    );

    const panel = page.locator('.flight-panel');
    const toggle = page.getByRole('button', { name: 'Hide aircraft list' });
    assert.ok(await toggle.isVisible());

    const expandedHeight = (await page
      .locator('.leaflet-container')
      .boundingBox()).height;

    await toggle.click();
    await page.waitForTimeout(500);
    assert.equal(
      await page.getByRole('button', { name: 'Show aircraft list' })
        .getAttribute('aria-expanded'),
      'false',
    );
    assert.equal(
      await page.locator('.flight-panel-body').evaluate(
        (element) => element.hidden,
      ),
      true,
    );

    const collapsedHeight = (await page
      .locator('.leaflet-container')
      .boundingBox()).height;
    assert.ok(
      collapsedHeight > expandedHeight + 20,
      `map should grow when the sheet collapses (${expandedHeight} -> ${collapsedHeight})`,
    );

    const box = await panel.boundingBox();
    assert.ok(box);
    assert.ok(box.x >= 0 && box.x + box.width <= 391);
    assert.ok(box.y + box.height <= 845);

    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
    console.log('mobile bottom sheet + map resize: PASS');
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.A11Y_CHANNEL ?? 'chrome',
    headless: true,
  });

  try {
    await runDesktop(browser);
    await runMobile(browser);
    console.log('Mobile/accessibility verification: PASS');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
