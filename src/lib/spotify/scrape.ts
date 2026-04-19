import type { Browser } from "puppeteer-core";

const LOCAL_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
];

async function localChromePath(): Promise<string | null> {
  const fs = await import("node:fs/promises");
  for (const p of LOCAL_CHROME_PATHS) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // continue
    }
  }
  return null;
}

export async function launchBrowser(): Promise<Browser> {
  const useLocal = process.env.USE_LOCAL_CHROME === "1";
  const puppeteer = await import("puppeteer-core");

  if (useLocal) {
    const executablePath = await localChromePath();
    if (!executablePath) {
      throw new Error(
        "USE_LOCAL_CHROME=1 but no Chrome/Chromium found on this machine",
      );
    }
    return puppeteer.default.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }

  const chromium = (await import("@sparticuz/chromium")).default as unknown as {
    args: string[];
    defaultViewport?: { width: number; height: number; deviceScaleFactor?: number };
    executablePath: () => Promise<string>;
  };
  return puppeteer.default.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

export type ScrapeResult = {
  spotifyId: string;
  monthlyListeners: number | null;
  error?: string;
};

export async function scrapeMonthlyListeners(
  spotifyIds: string[],
  opts: { concurrency?: number } = {},
): Promise<ScrapeResult[]> {
  if (spotifyIds.length === 0) return [];
  const concurrency = opts.concurrency ?? 4;
  const browser = await launchBrowser();
  try {
    const results: ScrapeResult[] = [];
    const queue = [...spotifyIds];
    async function worker() {
      while (queue.length) {
        const id = queue.shift();
        if (!id) return;
        results.push(await scrapeOne(browser, id));
      }
    }
    const workers = Array.from(
      { length: Math.min(concurrency, spotifyIds.length) },
      () => worker(),
    );
    await Promise.all(workers);
    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function scrapeOne(
  browser: Browser,
  spotifyId: string,
): Promise<ScrapeResult> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto(`https://open.spotify.com/artist/${spotifyId}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    const text = await page
      .waitForFunction(
        () => {
          const match = document.body.innerText.match(
            /([\d,\.]+)\s+monthly listeners/i,
          );
          return match ? match[1] : null;
        },
        { timeout: 12_000 },
      )
      .then((h) => h.jsonValue() as Promise<string | null>)
      .catch(() => null);

    if (!text) {
      return { spotifyId, monthlyListeners: null, error: "not found" };
    }
    const n = Number(text.replace(/[,\.]/g, ""));
    return {
      spotifyId,
      monthlyListeners: Number.isFinite(n) ? n : null,
    };
  } catch (e) {
    return {
      spotifyId,
      monthlyListeners: null,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await page.close().catch(() => {});
  }
}
