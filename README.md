# browser-harness

[![CI](https://img.shields.io/github/actions/workflow/status/convenientlymike/browser-harness/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/convenientlymike/browser-harness/actions) [![npm version](https://img.shields.io/npm/v/browser-harness?style=flat-square)](https://www.npmjs.com/package/browser-harness) [![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE) [![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)

**A CDP-driven browser event capture CLI — surfaces the runtime failures that source-reading can't see.**

`browser-harness` launches a real Chromium browser, navigates to any URL, and
records every observable failure — uncaught JS exceptions, console errors and
warnings, network request failures, and HTTP 4xx/5xx responses — to a structured
JSONL file. A `summary` subcommand reads that file and renders a grouped markdown
digest, making CI integration or manual audit one command away.

---

## What it does

Most front-end bugs are invisible until the page actually runs. Reading React or
Vue source tells you what the _intent_ is; attaching to a real browser tells you
what _actually happened_. `browser-harness` automates that second step:

| Event type | What it catches |
|---|---|
| `pageerror` | Uncaught JS exceptions + stack traces |
| `console_error` | `console.error(...)` calls, resource-load failures |
| `console_warning` | Deprecation warnings, policy violations |
| `requestfailed` | DNS failures, connection resets, CORS blocks |
| `responseerror` | Any HTTP 4xx or 5xx response |

All events are written as newline-delimited JSON (JSONL), one object per line,
with a `ts` (Unix ms), `kind` discriminator, and kind-specific fields. The format
is trivially queryable with `jq` and ingestible by any log pipeline.

---

## Quickstart

### 1 — Install

```bash
npm install          # installs playwright + typescript + tsx
```

> Playwright ships a bundled Chromium, so `harness capture` works out of the box.
> See [Chrome for Testing](#chrome-for-testing) below if you want to pin a specific binary.

### 2 — Build

```bash
npm run build        # tsc → dist/
```

### 3 — Capture events from a live page

```bash
node dist/cli.js capture https://example.com --out events.jsonl --duration 30
```

The browser opens (headed by default), navigates to the URL, and records events
for 30 seconds before closing. Pass `--headless` to suppress the window.

### 4 — Read the summary

```bash
node dist/cli.js summary events.jsonl
```

Output (markdown, generated from the bundled `tests/fixtures/sample.jsonl`):

```
# Browser Harness — Runtime Diagnostics

**Source:** `tests/fixtures/sample.jsonl`  
**Total events:** 6

## Page Errors (1)

- **2024-06-07T00:00:00.000Z**
  - `Uncaught ReferenceError: __app is not defined`
    ```
    ReferenceError: __app is not defined
        at main.js:42:5
        at HTMLDocument.<anonymous> (main.js:1:1)
    ```

## Console Errors (1)

- **2024-06-07T00:00:01.000Z**
  - `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT`  _(https://example.com/analytics.js:1)_

## Console Warnings (1)

- **2024-06-07T00:00:02.000Z**
  - `[Deprecation] Synchronous XMLHttpRequest on the main thread is deprecated`  _(https://example.com/legacy.js:88)_

## Failed Requests (1)

- **2024-06-07T00:00:03.000Z**
  - **GET** `https://fonts.googleapis.com/css2?family=Inter` — net::ERR_INTERNET_DISCONNECTED

## HTTP Error Responses (2)

- **2024-06-07T00:00:04.000Z**
  - **GET** `https://example.com/api/user` — HTTP 401 Unauthorized

- **2024-06-07T00:00:05.000Z**
  - **POST** `https://example.com/api/data` — HTTP 500 Internal Server Error
```

Pipe to `jq` for machine consumption:

```bash
node dist/cli.js summary events.jsonl --json | jq '.byKind.responseerror'
```

### 5 — Run tests

```bash
npm test             # typecheck + unit tests (no browser, no network)
```

---

## Commands

```
harness capture <url> [options]

  --out <path>          JSONL output file         [default: events.jsonl]
  --duration <seconds>  Observation window         [default: 30]
  --headless            Run without a visible window

harness summary <file> [options]

  --json                Emit JSON instead of markdown
```

---

## Architecture

```
CLI invocation
      │
      ▼
  src/cli.ts              parseArgs → routes to capture or summary
      │
      ├── src/capture.ts  Playwright browser launch + event listeners
      │     │               • pageerror  → PageErrorEvent
      │     │               • console    → ConsoleEvent (error/warning only)
      │     │               • requestfailed → RequestFailedEvent
      │     │               • response   → ResponseErrorEvent (status ≥ 400)
      │     └── JSONL writer (one line per event, fs.writeSync for safety)
      │
      └── src/summary.ts  readline JSONL reader → groupEvents → buildMarkdown
            │               • Grouped by kind in severity order
            │               • --json emits the raw GroupedSummary object
            └── src/types.ts  Discriminated-union event types (shared)
```

The capture loop is intentionally thin: Playwright emits events via its
internal page instrumentation (CDP `Target.setAutoAttach` + Runtime/Network
domain events). No polling, no setInterval. The JSONL writer uses synchronous
`fs.writeSync` so a hard kill never truncates a completed event line.

---

## Chrome for Testing

By default Playwright resolves its own bundled browser — no extra step needed.
If you want to pin a specific Chrome for Testing binary (the same one used by
[playwright install chromium](https://playwright.dev/docs/cli)):

```bash
# Option A — env var (takes highest priority)
export CHROME_FOR_TESTING_BIN="/path/to/Google Chrome for Testing"
node dist/cli.js capture ...

# Option B — install via Playwright (auto-discovered from the cache)
npx playwright install chromium
node dist/cli.js capture ...
```

The resolution order in `src/capture.ts`:

1. `$CHROME_FOR_TESTING_BIN` env var
2. Playwright's macOS/Linux cache (`~/Library/Caches/ms-playwright/chromium-*`)
3. Playwright's bundled browser (automatic fallback — always works)

The browser always launches **headed** (`--headless` inverts this), so you can
watch events arrive in real time.

---

## Project layout

```
browser-harness/
├── src/
│   ├── cli.ts        Entry point — argument parsing and dispatch
│   ├── capture.ts    Browser launch, CDP event subscription, JSONL writer
│   ├── summary.ts    JSONL reader, event grouper, markdown renderer
│   └── types.ts      Discriminated-union BrowserEvent types
├── tests/
│   ├── fixtures/
│   │   └── sample.jsonl   Fixture with one of each event kind
│   └── summary.test.ts    Unit tests for readEvents / groupEvents / buildMarkdown
├── dist/             TypeScript build output (gitignored)
├── tsconfig.json     Strict ES2022 / NodeNext config
├── package.json
├── .gitignore
├── LICENSE           MIT
└── README.md
```

---

## CI integration example

```yaml
# .github/workflows/audit.yml
- run: npm ci
- run: npm run build
- run: node dist/cli.js capture ${{ env.STAGING_URL }} --out events.jsonl --headless --duration 60
- run: node dist/cli.js summary events.jsonl --json | jq -e '.byKind.pageerror | length == 0'
```

The `jq -e` exit code is non-zero when page errors exist, failing the workflow.

---

_This is a clean-room demonstration project built to showcase CDP-based browser
instrumentation with Playwright and TypeScript. It represents real, production-useful
tooling patterns developed while building automated browser debugging pipelines._
