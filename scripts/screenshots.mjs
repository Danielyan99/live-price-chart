// README screenshots: npm run screenshots  (builds, serves dist/, writes docs/*.png)
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "playwright";
import { preview } from "vite";

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: "warn" });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"],
});
await mkdir("docs", { recursive: true });

async function open(contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(url);
  await page.waitForFunction(
    () => window.__lpc?.feed.get().backfill !== "loading" && window.__lpc.store.depth,
    null,
    { timeout: 30_000 },
  );
  return page;
}

const click = (page, name) => page.getByRole("button", { name, exact: true }).click();

// Desktop, live data, crosshair on a trade.
const desk = await open({ viewport: { width: 1440, height: 1000 } });
await desk.waitForTimeout(4000);
const chart = await desk.locator(".chart-host").boundingBox();
await desk.mouse.move(chart.x + chart.width * 0.62, chart.y + chart.height * 0.5);
await desk.waitForTimeout(400);
await desk.screenshot({ path: "docs/screenshot-live.png" });
console.log("live:", await desk.evaluate(() => window.__lpc.feed.get().source));

// Stale data: freeze the feed for 3 s and shoot after 2.4 s.
await desk.mouse.move(5, 5);
await click(desk, "Freeze feed 3 s");
await desk.waitForTimeout(2400);
await desk.screenshot({
  path: "docs/screenshot-stale.png",
  clip: { x: 0, y: 0, width: 1440, height: 110 },
});

// Stress: 100k simulated points, 10x feed, everything in view.
await click(desk, "Load 100k points");
await desk.waitForFunction(() => window.__lpc.store.points.length >= 99_000);
await click(desk, "All");
await desk.waitForTimeout(3000);
await desk.screenshot({ path: "docs/screenshot-stress.png" });

// Replay: paused in the middle, stepping trade by trade.
await desk.getByRole("button", { name: "Replay this session" }).click();
await desk.evaluate(() => {
  const r = window.__lpc.replay;
  r.scrubTo(r.start + (r.end - r.start) * 0.6);
  r.pause();
});
await click(desk, "1m");
await desk.waitForTimeout(500);
await desk.getByRole("button", { name: "Step forward one trade" }).click();
await desk.waitForTimeout(300);
await desk.screenshot({
  path: "docs/screenshot-replay.png",
  clip: { x: 0, y: 0, width: 1440, height: 820 },
});

// Phone.
const phone = await open({ ...devices["iPhone 13"] });
await phone.waitForTimeout(3000);
await phone.screenshot({ path: "docs/screenshot-mobile.png" });

await browser.close();
await server.close();
console.log("screenshots written to docs/");
