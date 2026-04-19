import puppeteer from "puppeteer-core";
import { config } from "dotenv";
import { access } from "node:fs/promises";
config({ path: ".env.local" });

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

// First argv: artist id to scrape albums from
// Second argv: album id to inspect for play counts
const artistId = process.argv[2] || "2U3bFzN7xGOhqdATusepqC";
const probeAlbumId = process.argv[3] || null;

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-blink-features=AutomationControlled",
  ],
});

async function stealth(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5].map(() => ({})),
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
    window.chrome = { runtime: {} };
  });
}

async function dismissCookie(page) {
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const accept = btns.find((b) => /accept|agree|ok/i.test(b.textContent ?? ""));
    if (accept) accept.click();
  }).catch(() => {});
}

// 1) Load artist page and collect album IDs
const artistPage = await browser.newPage();
await stealth(artistPage);
await artistPage.setUserAgent(
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
);
await artistPage.setViewport({ width: 1366, height: 800 });
await artistPage.goto(`https://open.spotify.com/artist/${artistId}`, {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});
await artistPage.waitForFunction(
  () => /monthly listeners/i.test(document.body.innerText),
  { timeout: 20000 },
);
await dismissCookie(artistPage);
await artistPage.evaluate(() => window.scrollTo(0, 2000));
await new Promise((r) => setTimeout(r, 3000));
await artistPage.evaluate(() => window.scrollTo(0, 5000));
await new Promise((r) => setTimeout(r, 3000));

const albumLinks = await artistPage.evaluate(() => {
  const anchors = Array.from(document.querySelectorAll('a[href*="/album/"]'));
  const ids = new Set();
  const items = [];
  for (const a of anchors) {
    const m = a.href.match(/\/album\/([a-zA-Z0-9]{22})/);
    if (!m) continue;
    if (ids.has(m[1])) continue;
    ids.add(m[1]);
    items.push({ id: m[1], text: a.textContent?.trim().slice(0, 80) ?? "" });
  }
  return items;
});
await artistPage.close();
console.log(`Found ${albumLinks.length} unique album IDs from artist page:`);
for (const a of albumLinks.slice(0, 15)) {
  console.log(`  ${a.id}  ${a.text}`);
}

// 2) Probe one album for track-level play counts
const targetAlbum = probeAlbumId || albumLinks[0]?.id;
if (!targetAlbum) {
  console.log("No album to probe");
  await browser.close();
  process.exit(0);
}
console.log(`\n=== Probing album ${targetAlbum} ===`);
const albumPage = await browser.newPage();
await stealth(albumPage);
await albumPage.setUserAgent(
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
);
await albumPage.setViewport({ width: 1366, height: 800 });
await albumPage.goto(`https://open.spotify.com/album/${targetAlbum}`, {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});
await albumPage.waitForSelector('[data-testid^="tracklist-row"]', { timeout: 15000 }).catch(() => null);
await dismissCookie(albumPage);
await albumPage.evaluate(() => window.scrollTo(0, 400));
await new Promise((r) => setTimeout(r, 2500));

const report = await albumPage.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-testid^="tracklist-row"]'));
  return rows.slice(0, 20).map((row) => {
    const a = row.querySelector('a[href*="/track/"]');
    const m = a?.href.match(/\/track\/([a-zA-Z0-9]{22})/);
    return {
      id: m?.[1] ?? null,
      name: a?.textContent?.trim() ?? null,
      rowText: (row.innerText ?? "").replace(/\n/g, " | "),
    };
  });
});
console.log(JSON.stringify(report, null, 2));

await browser.close();
