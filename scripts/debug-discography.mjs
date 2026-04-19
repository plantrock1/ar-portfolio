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
  try { await access(p); executablePath = p; break; } catch {}
}

const artistId = process.argv[2] || "2U3bFzN7xGOhqdATusepqC";

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  window.chrome = { runtime: {} };
});
await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36");
await page.setViewport({ width: 1366, height: 1600 });

// Try the discography "tracks" view
for (const url of [
  `https://open.spotify.com/artist/${artistId}/discography/all/all`,
  `https://open.spotify.com/artist/${artistId}/discography/popular-releases`,
]) {
  console.log(`\n=== ${url} ===`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await new Promise((r) => setTimeout(r, 4000));
    const report = await page.evaluate(() => {
      const body = document.body.innerText;
      const trackLinks = new Set(
        Array.from(document.querySelectorAll('a[href*="/track/"]'))
          .map((a) => a.href.match(/\/track\/([a-zA-Z0-9]{22})/)?.[1])
          .filter(Boolean),
      );
      const nums = body.match(/\d{1,3}(?:,\d{3})+/g) ?? [];
      const rows = Array.from(document.querySelectorAll('[data-testid^="tracklist-row"]')).slice(0, 5)
        .map((r) => (r.innerText || "").replace(/\n/g, " | "));
      return { trackCount: trackLinks.size, bigNumbersCount: nums.length, firstRows: rows, headingText: (document.querySelector("h1,h2")?.textContent ?? "").slice(0, 60) };
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    console.log("error:", e.message);
  }
}

await browser.close();
