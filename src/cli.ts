#!/usr/bin/env node
/**
 * cli.ts — entry point for the `harness` CLI.
 *
 * Usage:
 *   harness capture <url> [--out events.jsonl] [--duration 30] [--headless]
 *   harness summary <file> [--json]
 */

import { parseArgs } from "node:util";
import { runCapture } from "./capture.js";
import { runSummary } from "./summary.js";

const USAGE = `
harness — CDP-driven browser event capture and analysis

COMMANDS
  capture <url>           Launch a browser, navigate to <url>, and stream all
                          runtime failures (page errors, console errors/warnings,
                          failed requests, 4xx/5xx responses) to a JSONL file.

  summary <file>          Read a JSONL event file and print a grouped markdown
                          digest to stdout.

CAPTURE OPTIONS
  --out  <path>           Output file path  [default: events.jsonl]
  --duration <seconds>    Observation window in seconds  [default: 30]
  --headless              Run the browser headlessly  [default: headed]

SUMMARY OPTIONS
  --json                  Emit raw JSON instead of markdown

EXAMPLES
  npx harness capture https://example.com --out run1/events.jsonl --duration 60
  npx harness summary run1/events.jsonl
  npx harness summary run1/events.jsonl --json | jq '.byKind.pageerror'
`.trim();

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedCapture {
  sub: "capture";
  url: string;
  out: string;
  duration: number;
  headed: boolean;
}

interface ParsedSummary {
  sub: "summary";
  file: string;
  json: boolean;
}

type Parsed = ParsedCapture | ParsedSummary;

function parse(argv: string[]): Parsed {
  const sub = argv[0];

  if (sub === "capture") {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      options: {
        out: { type: "string", default: "events.jsonl" },
        duration: { type: "string", default: "30" },
        headless: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    const url = positionals[0];
    if (!url) {
      console.error("Error: capture requires a <url> argument.\n");
      console.error(USAGE);
      process.exit(1);
    }

    const duration = parseInt(values.duration as string, 10);
    if (isNaN(duration) || duration <= 0) {
      console.error("Error: --duration must be a positive integer.");
      process.exit(1);
    }

    return {
      sub: "capture",
      url,
      out: values.out as string,
      duration,
      // headed is the default; --headless flips it
      headed: !(values.headless as boolean),
    };
  }

  if (sub === "summary") {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      options: {
        json: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    const file = positionals[0];
    if (!file) {
      console.error("Error: summary requires a <file> argument.\n");
      console.error(USAGE);
      process.exit(1);
    }

    return { sub: "summary", file, json: values.json as boolean };
  }

  // No subcommand or --help
  console.error(USAGE);
  process.exit(sub === undefined || sub === "--help" || sub === "-h" ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parse(process.argv.slice(2));

  try {
    if (parsed.sub === "capture") {
      await runCapture({
        url: parsed.url,
        out: parsed.out,
        duration: parsed.duration,
        headed: parsed.headed,
      });
    } else {
      await runSummary({
        file: parsed.file,
        json: parsed.json,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[harness] Fatal: ${message}`);
    process.exit(1);
  }
}

main();
