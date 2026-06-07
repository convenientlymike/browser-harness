/**
 * capture.ts — launches a browser, navigates to a URL, records all runtime
 * events (page errors, console messages, failed requests, 4xx/5xx responses)
 * to a JSONL file, then exits cleanly after the requested duration.
 *
 * Browser resolution order:
 *   1. $CHROME_FOR_TESTING_BIN env var
 *   2. Playwright's Chromium cache (~/Library/Caches/ms-playwright on macOS)
 *   3. Playwright's bundled browser (automatic — lets the tool work out of
 *      the box on a fresh install without a separate download step)
 *
 * The project README documents rule 1/2 for operators who want to point the
 * tool at a pre-installed Chrome for Testing binary. Rule 3 is the safe
 * fallback so the tool is immediately runnable after `npm install`.
 */

import { chromium, Browser, Page, BrowserContext } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import type {
  CaptureOptions,
  BrowserEvent,
  PageErrorEvent,
  ConsoleEvent,
  RequestFailedEvent,
  ResponseErrorEvent,
} from "./types.js";

// ---------------------------------------------------------------------------
// Chrome for Testing resolver (non-downloading)
// ---------------------------------------------------------------------------

function resolveChromeBinary(): string | undefined {
  // Priority 1: explicit env override
  const envBin = process.env.CHROME_FOR_TESTING_BIN;
  if (envBin && fs.existsSync(envBin)) return envBin;

  // Priority 2: scan the Playwright macOS cache without pinning a version dir
  const cache = `${homedir()}/Library/Caches/ms-playwright`;
  if (!fs.existsSync(cache)) return undefined;

  try {
    const entries = fs
      .readdirSync(cache)
      .filter((d) => d.startsWith("chromium-") && !d.includes("headless"))
      .sort()
      .reverse();

    for (const entry of entries) {
      const candidates = [
        // macOS arm64
        `${cache}/${entry}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
        // macOS x64
        `${cache}/${entry}/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
        // Linux
        `${cache}/${entry}/chrome-linux/chrome`,
      ];
      const found = candidates.find(fs.existsSync);
      if (found) return found;
    }
  } catch {
    // Cache unreadable — fall through to Playwright bundled browser
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// JSONL writer
// ---------------------------------------------------------------------------

interface Writer {
  write: (event: BrowserEvent) => void;
  close: () => void;
}

function makeWriter(outPath: string): Writer {
  const dir = path.dirname(outPath);
  if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });

  const fd = fs.openSync(outPath, "w");

  return {
    write: (event: BrowserEvent) => {
      const line = JSON.stringify(event) + "\n";
      fs.writeSync(fd, line);
    },
    close: () => {
      fs.closeSync(fd);
    },
  };
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

function attachListeners(page: Page, write: (e: BrowserEvent) => void): void {
  // Uncaught JS exceptions
  page.on("pageerror", (err) => {
    const event: PageErrorEvent = {
      kind: "pageerror",
      ts: Date.now(),
      message: err.message,
      stack: err.stack,
    };
    write(event);
  });

  // Console messages (errors and warnings only — info/log are too noisy)
  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;

    const location = msg.location();
    const event: ConsoleEvent = {
      kind: type === "error" ? "console_error" : "console_warning",
      ts: Date.now(),
      text: msg.text(),
      location: location.url
        ? `${location.url}:${location.lineNumber}`
        : undefined,
    };
    write(event);
  });

  // Network requests that failed to receive any response
  page.on("requestfailed", (request) => {
    const event: RequestFailedEvent = {
      kind: "requestfailed",
      ts: Date.now(),
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? "unknown",
    };
    write(event);
  });

  // HTTP responses with 4xx or 5xx status codes
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;

    const event: ResponseErrorEvent = {
      kind: "responseerror",
      ts: Date.now(),
      url: response.url(),
      method: response.request().method(),
      status,
      statusText: response.statusText(),
    };
    write(event);
  });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runCapture(opts: CaptureOptions): Promise<void> {
  const executablePath = resolveChromeBinary();

  if (executablePath) {
    console.error(`[harness] Using Chrome for Testing: ${executablePath}`);
  } else {
    console.error(
      "[harness] Chrome for Testing not found in cache; using Playwright bundled browser."
    );
    console.error(
      "[harness] To use Chrome for Testing, set $CHROME_FOR_TESTING_BIN or run `npx playwright install chromium`."
    );
  }

  const launchOpts = {
    headless: !opts.headed,
    ...(executablePath ? { executablePath } : {}),
  };

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let writer: Writer | undefined;

  try {
    browser = await chromium.launch(launchOpts);
    context = await browser.newContext();
    const page = await context.newPage();

    writer = makeWriter(opts.out);
    attachListeners(page, writer.write);

    console.error(`[harness] Navigating to: ${opts.url}`);
    await page.goto(opts.url, { waitUntil: "load", timeout: 30_000 });

    console.error(
      `[harness] Observing for ${opts.duration}s — writing events to: ${opts.out}`
    );
    await page.waitForTimeout(opts.duration * 1000);

    console.error("[harness] Done. Closing browser.");
  } finally {
    // Close browser/context first so no further writeSync calls can occur,
    // then close the file descriptor.
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    writer?.close();
  }
}
