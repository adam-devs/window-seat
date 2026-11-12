/**
 * M3.5.7 View verification harness.
 *
 * Requires a running dev server (default http://localhost:5173/) and Google
 * Chrome. Serves deterministic synthetic aircraft through the OpenSky proxy
 * route, then checks:
 *
 * - one request per selection change, with no overlapping requests
 * - cone filtering against the stored origin/bearing/distance
 * - View distance keyboard control and persisted reload
 * - keyboard focus/escape behavior and a mobile-sized popover
 * - rapid distance changes abort the in-flight request
 * - the empty-direction copy
 *
 * Run with `npm run view:check`. Override the URL with VIEW_BASE_URL.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.VIEW_BASE_URL ?? 'http://localhost:5173/';
const REQUEST_DELAY_MS = Number(process.env.VIEW_REQUEST_DELAY_MS ?? 350);

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;
const CENTER = { latitude: 51.5, longitude: -0.1 };

const AIRCRAFT = [
  { id: 'e40', bearing: 90, km: 40 },
  { id: 'e90', bearing: 90, km: 90 },
  { id: 'e150', bearing: 90, km: 150 },
  { id: 'n40', bearing: 0, km: 40 },
].map((spec) => ({
  ...spec,
  callsign: `PF${spec.id.toUpperCase()}`,
  point: destination(CENTER, spec.bearing, spec.km * 1_000),
}));

function destination(start, bearingDeg, distanceM) {
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = bearingDeg * DEG;
  const lat1 = start.latitude * DEG;
  const lon1 = start.longitude * DEG;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    latitude: lat2 / DEG,
    longitude: ((lon2 / DEG + 540) % 360) - 180,
  };
}

function snapshot() {
  const now = Math.floor(Date.now() / 1000);
  return {
    time: now,
    states: AIRCRAFT.map((aircraft) => [
      aircraft.id.padEnd(6, '0'),
      aircraft.callsign,
      'Testland',
      now,
      now,
      aircraft.point.longitude,
      aircraft.point.latitude,
      5_000,
      false,
      120,
      90,
      0,
      null,
      5_000,
      '7000',
      false,
      0,
    ]),
  };
}

function distanceMeters(from, to) {
  const lat1 = from.latitude * DEG;
  const lat2 = to.latitude * DEG;
  const deltaLat = (to.latitude - from.latitude) * DEG;
  const deltaLon = (to.longitude - from.longitude) * DEG;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(from, to) {
  const lat1 = from.latitude * DEG;
  const lat2 = to.latitude * DEG;
  const deltaLon = (to.longitude - from.longitude) * DEG;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}

function angularDifference(a, b) {
  let difference = ((b % 360) + 360) % 360 - (((a % 360) + 360) % 360);
  if (difference > 180) difference -= 360;
  if (difference <= -180) difference += 360;
  return difference;
}

function expectedCallsigns(direction) {
  return AIRCRAFT.filter((aircraft) => {
    if (distanceMeters(direction.origin, aircraft.point) >
        direction.visibilityKm * 1_000) {
      return false;
    }
    return (
      Math.abs(
        angularDifference(
          direction.bearingDeg,
          bearingDegrees(direction.origin, aircraft.point),
        ),
      ) <=
      direction.angleDeg / 2 + 1e-9
    );
  })
    .map((aircraft) => aircraft.callsign)
    .sort();
}

async function rows(page) {
  return (await page.locator('.row-callsign').allTextContents())
    .map((text) => text.trim())
    .sort();
}

async function storedDirection(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('window-seat:workspace:v1');
    return raw === null ? null : JSON.parse(raw).direction;
  });
}

async function waitForRows(page, expected) {
  await page.waitForFunction(
    (wanted) => {
      const visible = [...document.querySelectorAll('.row-callsign')]
        .map((element) => element.textContent?.trim() ?? '')
        .sort();
      return JSON.stringify(visible) === JSON.stringify(wanted);
    },
    [...expected].sort(),
    { timeout: 8_000 },
  );
}

async function instruction(page) {
  return (await page.locator('.perimeter-instructions span').textContent())?.trim();
}

async function waitForRequestStart(tracking, count) {
  const deadline = Date.now() + 5_000;
  while (tracking.started < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(
    tracking.started >= count,
    'expected the selection change to start a request',
  );
}

function attachRequestTracking(page) {
  const inFlight = new Set();
  const tracking = { started: 0, aborted: 0, maxInFlight: 0 };

  page.on('request', (request) => {
    if (!/\/opensky\/api\/states\/all/.test(request.url())) return;
    tracking.started += 1;
    inFlight.add(request);
    tracking.maxInFlight = Math.max(tracking.maxInFlight, inFlight.size);
  });
  page.on('requestfinished', (request) => {
    inFlight.delete(request);
  });
  page.on('requestfailed', (request) => {
    if (/\/opensky\/api\/states\/all/.test(request.url())) {
      tracking.aborted += 1;
    }
    inFlight.delete(request);
  });

  return tracking;
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // Blank tile loads are environmental; application errors are not.
    if (message.text().includes('Failed to load resource')) return;
    pageErrors.push(message.text());
  });

  const tracking = attachRequestTracking(page);
  await page.route('**/opensky/api/states/all*', async (route) => {
    try {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(snapshot()),
      });
    } catch {
      // A superseded request may be aborted before it can be fulfilled.
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.leaflet-container');

    // Keyboard: switch to View.
    const viewButton = page.getByRole('button', { name: 'View' });
    await viewButton.focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await viewButton.getAttribute('aria-pressed'),
      'true',
      'View mode should be keyboard-selectable',
    );

    // Pin an origin and aim east-north-east, away from synthetic markers.
    const map = await page.locator('.leaflet-container').boundingBox();
    assert.ok(map, 'map should be visible');
    const originX = map.x + map.width * 0.5;
    const originY = map.y + map.height * 0.5;
    await page.mouse.click(originX, originY);
    await page.waitForTimeout(100);
    assert.match(await instruction(page), /Origin pinned/);

    const aimX = originX + Math.min(120, map.width * 0.3);
    const aimY = originY - Math.min(40, map.height * 0.1);
    await page.mouse.click(aimX, aimY);
    await page.waitForTimeout(REQUEST_DELAY_MS + 450);

    let direction = await storedDirection(page);
    let expected = expectedCallsigns(direction);
    await waitForRows(page, expected);
    assert.deepEqual(await rows(page), expected);
    assert.equal(await page.locator('.view-cone').count(), 1);
    assert.equal(
      await page.locator('.plane-glyph').count(),
      expected.length,
      'visible markers should match the filtered list',
    );
    assert.equal(tracking.started, 1, 'one request for the completed view');
    assert.equal(tracking.maxInFlight, 1, 'requests must not overlap');

    // Settings: area cost + keyboard distance change.
    const settingsButton = page.getByRole('button', { name: 'Settings' });
    await settingsButton.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();

    const areaText =
      (await page.locator('.settings-view-area').textContent())?.trim() ?? '';
    assert.match(areaText, /View area/);
    assert.match(areaText, /credit(s)? per request/);

    const dialogBox = await dialog.boundingBox();
    assert.ok(dialogBox, 'settings dialog should have a box');
    assert.ok(dialogBox.x >= -1, 'dialog should not overflow left');
    assert.ok(
      dialogBox.x + dialogBox.width <= viewport.width + 1,
      'dialog should fit the viewport',
    );

    const radio50 = page.getByRole('radio', { name: /^50 km/ });
    await radio50.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(REQUEST_DELAY_MS + 450);

    direction = await storedDirection(page);
    expected = expectedCallsigns(direction);
    await waitForRows(page, expected);
    assert.equal(direction.visibilityKm, 50, 'distance change should persist');
    assert.deepEqual(await rows(page), expected);
    assert.equal(tracking.started, 2, 'one new request for the distance change');
    assert.equal(tracking.maxInFlight, 1);

    // Escape closes and returns focus.
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-label'),
      ),
      'Settings',
      'Escape should restore focus to the trigger',
    );

    // Reload restores View mode, cone, distance, and filtered rows.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.leaflet-container');
    await page.waitForTimeout(REQUEST_DELAY_MS + 450);

    assert.equal(
      await page.getByRole('button', { name: 'View' }).getAttribute(
        'aria-pressed',
      ),
      'true',
    );
    assert.equal(await page.locator('.view-cone').count(), 1);
    direction = await storedDirection(page);
    expected = expectedCallsigns(direction);
    await waitForRows(page, expected);
    assert.equal(direction.visibilityKm, 50);

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('.settings-popover').waitFor();
    assert.equal(
      await page.getByRole('radio', { name: /^50 km/ }).isChecked(),
      true,
    );
    await page.keyboard.press('Escape');

    if (viewport.name === 'desktop') {
      // Rapid changes: the first in-flight request must be aborted, not overlapped.
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.locator('.settings-popover').waitFor();
      const beforeRapid = tracking.started;
      const beforeAborted = tracking.aborted;
      await page.getByRole('radio', { name: /^25 km/ }).click();
      await waitForRequestStart(tracking, beforeRapid + 1);
      await page.getByRole('radio', { name: /^200 km/ }).click();
      await waitForRequestStart(tracking, beforeRapid + 2);
      await page.waitForTimeout(REQUEST_DELAY_MS + 900);

      direction = await storedDirection(page);
      expected = expectedCallsigns(direction);
      await waitForRows(page, expected);
      assert.equal(direction.visibilityKm, 200);
      assert.ok(
        tracking.aborted > beforeAborted,
        'the superseded rapid-change request should be aborted',
      );
      assert.equal(
        tracking.started - beforeRapid,
        2,
        'each completed change should start exactly one request',
      );

      // Empty-direction copy after a persisted view change.
      await page.evaluate(() => {
        const key = 'window-seat:workspace:v1';
        const workspace = JSON.parse(localStorage.getItem(key));
        workspace.mode = 'direction';
        workspace.direction = {
          origin: { latitude: 0, longitude: 0 },
          bearingDeg: 180,
          angleDeg: 60,
          visibilityKm: 25,
        };
        localStorage.setItem(key, JSON.stringify(workspace));
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.leaflet-container');
      await page.waitForTimeout(REQUEST_DELAY_MS + 450);
      assert.equal(await page.locator('.view-cone').count(), 1);
      assert.equal(
        await page
          .getByText('No aircraft in this direction right now.')
          .isVisible(),
        true,
      );
      assert.equal(
        (await page.locator('.count').textContent())?.trim(),
        '0 aircraft in view',
      );
    }

    assert.deepEqual(
      pageErrors,
      [],
      `unexpected page errors: ${pageErrors.join(' | ')}`,
    );
    console.log(
      `${viewport.name}: PASS — ${tracking.started} requests, ${tracking.aborted} aborted, max ${tracking.maxInFlight} in flight`,
    );
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.VIEW_CHANNEL ?? 'chrome',
    headless: true,
  });

  try {
    await runViewport(browser, {
      name: 'desktop',
      width: 1440,
      height: 900,
    });
    await runViewport(browser, {
      name: 'mobile',
      width: 390,
      height: 844,
    });
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
