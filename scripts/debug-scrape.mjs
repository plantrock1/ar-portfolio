import puppeteerExtra from "puppeteer-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import puppeteerCore from "puppeteer-core";
import { config } from "dotenv";
import { access } from "node:fs/promises";
config({ path: ".env.local" });

puppeteerExtra.use(stealth());
// puppeteer-extra wraps a puppeteer impl passed in, or uses puppeteer by default.
// We use puppeteer-core since that's what the app already depends on.
// Trick: assign the core module as the backing impl.
const puppeteer = puppeteerExtra;
puppeteer.__defaultVanilla = puppeteerCore;
const origLaunch = puppeteer.launch.bind(puppeteer);
puppeteer.launch = (opts) => origLaunch.call({ ...puppeteer, _vanilla: puppeteerCore }, opts);

const paths = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
let executablePath = null;
for (const p of paths) {
  try {
    await access(p);
    executablePath = p;
    break;
  } catch {}
}

const id = process.argv[2] || "2U3bFzN7xGOhqdATusepqC";

const browser = await puppeteerCore.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});

// Apply stealth patches manually to a plain puppeteer-core browser by
// monkey-patching pages with common evasions.
async function applyStealth(page) {
  await page.evaluateOnNewDocument(() => {
    // navigator.webdriver
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // plugins length
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5].map(() => ({})),
    });
    // languages
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
    // chrome runtime
    // @ts-ignore
    window.chrome = { runtime: {} };
    // permissions query
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (p) =>
        p.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(p);
    }
  });
}

const page = await browser.newPage();
await applyStealth(page);
await page.setUserAgent(
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
);
await page.setViewport({ width: 1366, height: 800 });
await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

await page.goto(`https://open.spotify.com/artist/${id}`, {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});
await page.waitForFunction(
  () => /monthly listeners/i.test(document.body.innerText),
  { timeout: 20000 },
);

// Dismiss cookie banner if present
try {
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const accept = btns.find((b) =>
      /accept|agree|ok/i.test(b.textContent ?? ""),
    );
    if (accept) accept.click();
  });
} catch {}

// Let the tracklist fully hydrate and any lazy requests complete
await new Promise((r) => setTimeout(r, 5000));

// Scroll to popular section to trigger any lazy-load
await page.evaluate(() => window.scrollTo(0, 400));
await new Promise((r) => setTimeout(r, 1500));

const report = await page.evaluate(() => {
  const body = document.body.innerText;
  const ml = (body.match(/([\d,\.]+)\s+monthly listeners/i) || [])[1] ?? null;
  const fol = (body.match(/([\d,\.]+)\s+Followers/i) || [])[1] ?? null;

  // Dump everything inside the "Popular" tracklist
  const trackList = document.querySelector('[data-testid="track-list"]');
  const popularSection = trackList?.closest('section, [data-testid]') ?? null;

  const rows = Array.from(
    document.querySelectorAll('[data-testid^="tracklist-row"]'),
  );
  const rowReports = rows.slice(0, 5).map((row) => {
    const anchor = row.querySelector('a[href*="/track/"]');
    const name = anchor?.textContent?.trim() ?? null;
    const rowText = row.innerText ?? "";
    // Find any number that looks like a stream count
    const nums = rowText.match(/\d{1,3}(?:,\d{3})+|\d{4,}/g) ?? [];
    // Look for a child element with "play-count" in its data-testid / aria
    const candidates = Array.from(row.querySelectorAll("*"))
      .filter((el) => {
        const testid = el.getAttribute("data-testid") ?? "";
        const aria = el.getAttribute("aria-label") ?? "";
        return /play|stream|count/i.test(testid) || /play|stream/i.test(aria);
      })
      .map((el) => ({
        tag: el.tagName,
        testid: el.getAttribute("data-testid"),
        aria: el.getAttribute("aria-label"),
        text: el.textContent?.trim().slice(0, 50),
      }));
    return { name, rowText, nums, playCountElements: candidates };
  });

  return {
    monthlyListeners: ml,
    followers: fol,
    popularSectionExists: !!popularSection,
    rowCount: rows.length,
    rowReports,
  };
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
