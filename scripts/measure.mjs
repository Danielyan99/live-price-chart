// Reproducible performance measurement.
//
//   npm run measure              (builds, serves dist/, runs all scenarios)
//   npm run measure -- --headed  (shows the browser window)
//
// Runs the production build in Google Chrome (installed locally, GPU on),
// sets up each scenario through the real UI, then calls the app's own
// window.__lpc.measure(seconds), which records every animation frame.
// CPU slowdown uses Chrome DevTools' CPU throttling, to approximate slower
// laptops and phones. Results go to docs/measurements.json and .md.
import { writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import { chromium } from "playwright";
import { preview } from "vite";

const headed = process.argv.includes("--headed");
const SECONDS = 10;

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: "warn" });
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  channel: "chrome",
  headless: !headed,
  args: ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
const cdp = await context.newCDPSession(page);

await page.goto(url);
const gpu = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl");
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
});

const results = [];

async function run(name, cpu = 1) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await page.waitForTimeout(2000); // let the new view settle
  const r = await page.evaluate((s) => window.__lpc.measure(s), SECONDS);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  results.push({ name, cpu, ...r });
  console.log(
    `${name} (cpu ${cpu}x): ${r.fps.toFixed(0)} FPS, draw avg ${r.avg.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms, ` +
      `max ${r.max.toFixed(1)} ms, ${r.overBudget}/${r.frames} over budget, ${r.pointsInView} points in view`,
  );
}

const click = (name) => page.getByRole("button", { name, exact: true }).click();

// 1. Live Coinbase data with ~10k trades of history.
await page.waitForFunction(() => window.__lpc.feed.get().backfill !== "loading", null, {
  timeout: 30_000,
});
const live = await page.evaluate(() => window.__lpc.feed.get().source);
if (live === "live") {
  await click("15m");
  await run("Live feed, 15 min view");
  await click("All");
  await run("Live feed, all history in view");
  await run("Live feed, all history in view", 4);
} else {
  console.warn(`Live feed not available (source: ${live}); skipping live scenarios.`);
}

// 2. Stress: 100,000 simulated trades, feed at 10x, everything in view.
await click("Load 100k points");
await page.waitForFunction(() => window.__lpc.store.points.length >= 99_000, null, {
  timeout: 30_000,
});
await click("All");
await run("Stress 10x, 100k points in view");
await run("Stress 10x, 100k points in view", 4);
await run("Stress 10x, 100k points in view", 6);
await click("5m");
await run("Stress 10x, 5 min view", 6);

// 3. Replay at 16x through the same 100k points.
await page.getByRole("button", { name: "Replay this session" }).click();
await click("16×");
await click("5m");
await run("Replay 16x, 5 min view");

const env = {
  date: new Date().toISOString(),
  browser: `Chrome ${browser.version()}${headed ? "" : " (headless)"}`,
  gpu,
  cpu: os.cpus()[0]?.model.trim(),
  os: `${os.type()} ${os.release()}`,
  viewport: "1440x900 @1x",
  seconds: SECONDS,
};

await browser.close();
await server.close();

const fmt = (n, d = 2) => n.toFixed(d);
const lines = [
  `Measured ${env.date.slice(0, 10)} on ${env.cpu}, ${env.gpu.replace(/ \(0x[0-9a-f]+\)/i, "")}, ${env.browser}, ${env.viewport}. ${SECONDS} s per row.`,
  "",
  "| Scenario | CPU slowdown | Points in view | Feed msg/s | FPS | Draw avg | Draw p95 | Draw p99 | Draw max | Frames over 16.7 ms |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...results.map(
    (r) =>
      `| ${r.name} | ${r.cpu === 1 ? "none" : `${r.cpu}×`} | ${r.pointsInView.toLocaleString("en-US")} | ${r.msgsPerSec} | ${fmt(r.fps, 0)} | ${fmt(r.avg)} ms | ${fmt(r.p95)} ms | ${fmt(r.p99)} ms | ${fmt(r.max, 1)} ms | ${r.overBudget} / ${r.frames} |`,
  ),
];
await mkdir("docs", { recursive: true });
await writeFile("docs/measurements.json", JSON.stringify({ env, results }, null, 2) + "\n");
await writeFile("docs/measurements.md", lines.join("\n") + "\n");
console.log("\n" + lines.join("\n"));
