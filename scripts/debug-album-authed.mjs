import puppeteer from "puppeteer-core";
import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
import { access } from "node:fs/promises";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(
  `SELECT spotify_sp_dc FROM site_settings WHERE id = 'main'`,
);
await pool.end();
const spDc = rows[0]?.spotify_sp_dc;
if (!spDc) {
  console.error("No sp_dc stored — save one via /admin first.");
  process.exit(1);
}
console.log("sp_dc loaded (len:", spDc.length, ")");

const paths = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
let executablePath = null;
for (const p of paths) { try { await access(p); executablePath = p; break; } catch {} }

const albumId = process.argv[2] || "5YlKFqNUVuYLG4kiCKG4Qb"; // UY SCUTI BØYZ

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "plugins", { get: () => [1,2,3,4,5] });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US","en"] });
  window.chrome = { runtime: {} };
});
await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36");
await page.setViewport({ width: 1366, height: 900 });
await page.setCookie({
  name: "sp_dc",
  value: spDc,
  domain: ".spotify.com",
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "None",
});

await page.goto(`https://open.spotify.com/album/${albumId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-testid^="tracklist-row"]', { timeout: 15000 }).catch(() => null);
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button"));
  const accept = btns.find((b) => /accept|agree|ok/i.test(b.textContent ?? ""));
  if (accept) accept.click();
}).catch(() => {});
await page.evaluate(() => window.scrollTo(0, 400));
await new Promise((r) => setTimeout(r, 3000));

const authCheck = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    hasLogin: /Log in|Sign up free/i.test(t),
    hasLibrary: /Your Library/i.test(t),
    url: location.href,
    title: document.title,
    bodyPrefix: t.slice(0, 500).replace(/\n/g, " | "),
    rowTestids: Array.from(document.querySelectorAll('[data-testid]'))
      .map((e) => e.getAttribute("data-testid"))
      .filter((v) => v && /row|track|list/i.test(v))
      .slice(0, 20),
  };
});
console.log("auth check:", JSON.stringify(authCheck, null, 2));

const report = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-testid^="tracklist-row"]'));
  return rows.slice(0, 8).map((row) => {
    const a = row.querySelector('a[href*="/track/"]');
    return {
      name: a?.textContent?.trim(),
      rowText: (row.innerText ?? "").replace(/\n/g, " | "),
      children: Array.from(row.querySelectorAll('[data-testid], [aria-label]'))
        .filter((el) => {
          const t = el.getAttribute("data-testid") || "";
          const a = el.getAttribute("aria-label") || "";
          return /play|count|stream/i.test(t) || /play|stream/i.test(a);
        })
        .slice(0, 3)
        .map((el) => ({
          tag: el.tagName,
          testid: el.getAttribute("data-testid"),
          aria: el.getAttribute("aria-label"),
          text: (el.textContent || "").slice(0, 40),
        })),
    };
  });
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
