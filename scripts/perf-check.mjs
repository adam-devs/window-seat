#!/usr/bin/env node
/*
 * Synthetic performance harness for the map.
 *
 * Serves 300 generated aircraft from the OpenSky proxy route, draws a perimeter,
 * forces repeated snapshots, and measures:
 *   - requestAnimationFrame FPS on desktop and mobile viewports
 *   - largest per-100 ms marker jump (visible snap check)
 *   - JS heap growth and bounded DOM layers
 *
 * Usage:
 *   npm run dev -- --port 5173 --strictPort   # in another terminal
 *   npm run perf:check
 *
 * Requires the Playwright package and either installed Playwright browsers or
 * Google Chrome (used via `channel: 'chrome'`).
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.PERF_BASE_URL ?? 'http://localhost:5173/';
const AIRCRAFT = Number(process.env.PERF_AIRCRAFT ?? 300);
const DESKTOP_FPS_MIN = Number(process.env.PERF_DESKTOP_FPS ?? 50);
const MOBILE_FPS_MIN = Number(process.env.PERF_MOBILE_FPS ?? 30);
const MAX_JUMP_PX = Number(process.env.PERF_MAX_JUMP_PX ?? 15);
const MAX_HEAP_GROWTH_MB = Number(process.env.PERF_MAX_HEAP_MB ?? 50);

let generation = 0;

function snapshot() {
  generation += 1;
  const nowSec = Math.floor(Date.now() / 1000);
  const states = [];

  for (let index = 0; index < AIRCRAFT; index += 1) {
    const angle = (index / AIRCRAFT) * Math.PI * 2 + generation * 0.012;
    const ring = 0.03 + (index % 20) * 0.018;
    const latitude = 51.5 + Math.sin(angle) * ring;
    const longitude = -0.1 + Math.cos(angle) * ring * 1.6;
    const track = (index * 37 + generation * 3) % 360;
    const speed = 90 + (index % 30) * 6;

    states.push([
      `p${String(index).padStart(5, '0')}`,
      `PF${String(index).padStart(3, '0')}`,
      'Perfland',
      nowSec,
      nowSec,
      longitude,
      latitude,
      500 + (index % 30) * 400,
      false,
      speed,
      track,
      (index % 7) - 3,
      null,
      500 + (index % 30) * 400,
      '7000',
      false,
      0,
    ]);
  }

  return { time: nowSec, states };
}

async function routeSyntheticFlights(page) {
  await page.route('**/opensky/api/states/all*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(snapshot()),
    });
  });
}

async function drawPerimeter(page) {
  await page.locator('.leaflet-container').waitFor({ timeout: 20_000 });
  const box = await page.locator('.leaflet-container').boundingBox();
  assert.ok(box, 'map has a bounding box');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.35);
  const response = page.waitForResponse(
    (r) => /\/opensky\/api\/states\/all/.test(r.url()),
    { timeout: 30_000 },
  );
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.65);
  assert.equal((await response).status(), 200);
  await page.waitForFunction(
    () => document.querySelector('.subtitle')?.textContent?.startsWith('Updated'),
    null,
    { timeout: 30_000 },
  );
  await page.locator('.leaflet-marker-icon').first().waitFor({
    timeout: 30_000,
  });
  await page.waitForTimeout(800);
}

async function forceSnapshot(page) {
  const response = page.waitForResponse(
    (r) => /\/opensky\/api\/states\/all/.test(r.url()),
    { timeout: 30_000 },
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
  assert.equal((await response).status(), 200);
  await page.waitForTimeout(120);
}

async function measureFps(page, durationMs) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        let frames = 0;
        let longFrames = 0;
        let last = performance.now();
        const start = last;

        function tick(now) {
          frames += 1;
          if (now - last > 34) longFrames += 1;
          last = now;
          if (now - start >= duration) {
            resolve({
              fps: (frames * 1000) / (now - start),
              frames,
              longFrames,
            });
          } else {
            requestAnimationFrame(tick);
          }
        }

        requestAnimationFrame(tick);
      }),
    durationMs,
  );
}

async function startJumpSampler(page) {
  await page.evaluate(() => {
    const state = { maxJump: 0, last: new Map() };
    window.__perfJump = state;
    window.__perfJumpTimer = window.setInterval(() => {
      for (const element of document.querySelectorAll(
        '.leaflet-marker-icon',
      )) {
        const match = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(
          element.style.transform,
        );
        if (!match) continue;
        const x = Number(match[1]);
        const y = Number(match[2]);
        const previous = state.last.get(element);
        if (previous) {
          const jump = Math.hypot(x - previous.x, y - previous.y);
          if (jump > state.maxJump) state.maxJump = jump;
        }
        state.last.set(element, { x, y });
      }
    }, 100);
  });
}

async function stopJumpSampler(page) {
  return page.evaluate(() => {
    window.clearInterval(window.__perfJumpTimer);
    return window.__perfJump.maxJump;
  });
}

async function domCounts(page) {
  return page.evaluate(() => ({
    markers: document.querySelectorAll('.leaflet-marker-icon').length,
    trails: document.querySelectorAll('path.aircraft-trail').length,
    projected: document.querySelectorAll(
      'path.aircraft-projected-trail',
    ).length,
    rows: document.querySelectorAll('.flight-row').length,
    nodes: document.querySelectorAll('*').length,
  }));
}

async function heapMb(page) {
  return page.evaluate(() => {
    const memory = performance.memory;
    return memory ? memory.usedJSHeapSize / (1024 * 1024) : null;
  });
}

async function runContext(browser, label, contextOptions, fpsMin) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await routeSyntheticFlights(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await drawPerimeter(page);
  await page.waitForTimeout(2_000);

  const initialCounts = await domCounts(page);
  assert.equal(initialCounts.markers, AIRCRAFT);
  const initialHeap = await heapMb(page);

  // Steady-state animation between refreshes.
  const fps = await measureFps(page, 4_000);

  // Snapshot corrections and jump detection.
  await startJumpSampler(page);
  for (let index = 0; index < 3; index += 1) {
    await page.waitForTimeout(1_600);
    await forceSnapshot(page);
  }
  const maxJump = await stopJumpSampler(page);

  for (let index = 0; index < 6; index += 1) {
    await forceSnapshot(page);
  }
  const finalCounts = await domCounts(page);
  const finalHeap = await heapMb(page);
  const heapGrowth =
    initialHeap === null || finalHeap === null
      ? null
      : finalHeap - initialHeap;

  assert.ok(
    fps.fps >= fpsMin,
    `${label} FPS ${fps.fps.toFixed(1)} below ${fpsMin}`,
  );
  assert.ok(
    maxJump <= MAX_JUMP_PX,
    `${label} marker jump ${maxJump.toFixed(2)} px exceeds ${MAX_JUMP_PX}`,
  );
  assert.equal(finalCounts.markers, AIRCRAFT);
  assert.ok(finalCounts.trails <= AIRCRAFT);
  assert.ok(finalCounts.projected <= AIRCRAFT);
  assert.equal(finalCounts.rows, AIRCRAFT);
  assert.ok(
    heapGrowth === null || heapGrowth <= MAX_HEAP_GROWTH_MB,
    `${label} heap grew ${heapGrowth?.toFixed(1)} MB`,
  );
  assert.deepEqual(errors, []);

  await context.close();

  return {
    label,
    fps: fps.fps,
    longFrames: fps.longFrames,
    maxJump,
    heapGrowth,
    initialCounts,
    finalCounts,
  };
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.PERF_CHANNEL || 'chrome',
    headless: true,
    args: ['--enable-precise-memory-info'],
  });

  try {
    const desktop = await runContext(
      browser,
      'desktop',
      { viewport: { width: 1440, height: 900 } },
      DESKTOP_FPS_MIN,
    );
    const mobile = await runContext(
      browser,
      'mobile',
      {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
      MOBILE_FPS_MIN,
    );

    for (const result of [desktop, mobile]) {
      console.log(
        `PASS ${result.label}: ${result.fps.toFixed(1)} fps, ` +
          `${result.longFrames} long frames, max jump ` +
          `${result.maxJump.toFixed(2)} px, ` +
          `heap ${result.heapGrowth === null ? 'n/a' : `${result.heapGrowth.toFixed(1)} MB`}, ` +
          `${result.finalCounts.markers} markers / ` +
          `${result.finalCounts.trails + result.finalCounts.projected} trail paths / ` +
          `${result.finalCounts.nodes} DOM nodes`,
      );
    }
    console.log('M2.6 PERFORMANCE CHECK COMPLETE');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('M2.6 PERFORMANCE CHECK FAILED');
  console.error(error);
  process.exitCode = 1;
});
