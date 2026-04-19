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

const id = process.argv[2] || "0UWHB6M62TXlNBxXDnMvBH"; // bada bing bada bØØm

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
await page.setViewport({ width: 1366, height: 800 });
await page.goto(`https://open.spotify.com/track/${id}`, { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button"));
  const accept = btns.find((b) => /accept|agree|ok/i.test(b.textContent ?? ""));
  if (accept) accept.click();
}).catch(() => {});
await new Promise((r) => setTimeout(r, 2000));

const report = await page.evaluate(() => {
  const body = document.body.innerText;
  const lines = body.split("\n").filter((l) => l.trim());
  // numbers with comma separators OR 5+ digit bare numbers
  const nums = body.match(/\d{1,3}(?:,\d{3})+|\d{5,}/g) ?? [];
  return { bodyFirst500: body.slice(0, 500), bigNumbers: nums.slice(0, 20), firstLines: lines.slice(0, 30) };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
