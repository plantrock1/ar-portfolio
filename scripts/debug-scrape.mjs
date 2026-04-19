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

const id = process.argv[2] || "2U3bFzN7xGOhqdATusepqC";

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setUserAgent(
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
);
await page.goto(`https://open.spotify.com/artist/${id}`, {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});
await page.waitForFunction(
  () => /monthly listeners/i.test(document.body.innerText),
  { timeout: 20000 },
);

// Let the tracklist fully hydrate
await new Promise((r) => setTimeout(r, 2000));

const report = await page.evaluate(() => {
  const out = {
    monthlyListeners: null,
    followers: null,
    rowCandidates: [],
    tracks: [],
  };

  const body = document.body.innerText;
  out.monthlyListeners = (body.match(/([\d,\.]+)\s+monthly listeners/i) || [])[1] ?? null;
  out.followers = (body.match(/([\d,\.]+)\s+Followers/i) || [])[1] ?? null;

  // Try each known row convention and report counts
  out.rowCandidates = [
    { selector: '[data-testid^="tracklist-row"]', count: document.querySelectorAll('[data-testid^="tracklist-row"]').length },
    { selector: '[role="row"]', count: document.querySelectorAll('[role="row"]').length },
    { selector: '[data-encore-id="row"]', count: document.querySelectorAll('[data-encore-id="row"]').length },
    { selector: 'a[href*="/track/"]', count: document.querySelectorAll('a[href*="/track/"]').length },
  ];

  const anchors = Array.from(document.querySelectorAll('a[href*="/track/"]')).slice(0, 5);
  for (const a of anchors) {
    const m = a.href.match(/\/track\/([a-zA-Z0-9]{22})/);
    if (!m) continue;
    const info = { id: m[1], name: (a.textContent || "").trim(), ancestorTexts: [] };
    let el = a;
    for (let i = 0; i < 10 && el?.parentElement; i++) {
      el = el.parentElement;
      info.ancestorTexts.push({
        level: i + 1,
        tag: el.tagName,
        testid: el.getAttribute("data-testid") || "",
        role: el.getAttribute("role") || "",
        encore: el.getAttribute("data-encore-id") || "",
        innerTextSample: (el.innerText || "").slice(0, 300).replace(/\n/g, " | "),
      });
    }
    out.tracks.push(info);
  }
  return out;
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
