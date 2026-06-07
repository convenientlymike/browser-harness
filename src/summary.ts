/**
 * summary.ts — reads a JSONL event file produced by `harness capture` and
 * prints a grouped markdown digest (or raw JSON with --json).
 *
 * Groups are ordered by severity: pageerror → console_error →
 * console_warning → requestfailed → responseerror.
 */

import * as fs from "fs";
import * as readline from "readline";
import type { BrowserEvent, EventKind, SummaryOptions } from "./types.js";

// ---------------------------------------------------------------------------
// JSONL reader
// ---------------------------------------------------------------------------

export async function readEvents(filePath: string): Promise<BrowserEvent[]> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const events: BrowserEvent[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as BrowserEvent);
    } catch {
      // Silently skip malformed lines — a partial write at the tail is normal
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Grouping + formatting
// ---------------------------------------------------------------------------

interface GroupedSummary {
  total: number;
  byKind: Record<EventKind, BrowserEvent[]>;
}

const KIND_ORDER: EventKind[] = [
  "pageerror",
  "console_error",
  "console_warning",
  "requestfailed",
  "responseerror",
];

const KIND_LABEL: Record<EventKind, string> = {
  pageerror: "Page Errors",
  console_error: "Console Errors",
  console_warning: "Console Warnings",
  requestfailed: "Failed Requests",
  responseerror: "HTTP Error Responses",
};

export function groupEvents(events: BrowserEvent[]): GroupedSummary {
  const byKind: Record<string, BrowserEvent[]> = {};
  for (const kind of KIND_ORDER) byKind[kind] = [];

  for (const event of events) {
    const bucket = byKind[event.kind];
    if (bucket) {
      bucket.push(event);
    }
  }

  // Total reflects only rendered buckets so the header count matches what is shown.
  // Events with an unrecognised kind are silently dropped from both count and output.
  const total = KIND_ORDER.reduce((sum, k) => sum + (byKind[k]?.length ?? 0), 0);

  return { total, byKind: byKind as Record<EventKind, BrowserEvent[]> };
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}

function renderEvent(event: BrowserEvent): string {
  switch (event.kind) {
    case "pageerror":
      return `  - \`${event.message.split("\n")[0]}\`${
        event.stack ? `\n    \`\`\`\n    ${event.stack.split("\n").slice(0, 4).join("\n    ")}\n    \`\`\`` : ""
      }`;

    case "console_error":
    case "console_warning":
      return `  - \`${event.text.slice(0, 200)}\`${
        event.location ? `  _(${event.location})_` : ""
      }`;

    case "requestfailed":
      return `  - **${event.method}** \`${event.url}\` — ${event.failure}`;

    case "responseerror":
      return `  - **${event.method}** \`${event.url}\` — HTTP ${event.status} ${event.statusText}`;
  }
}

export function buildMarkdown(summary: GroupedSummary, source: string): string {
  const lines: string[] = [
    `# Browser Harness — Runtime Diagnostics`,
    ``,
    `**Source:** \`${source}\`  `,
    `**Total events:** ${summary.total}`,
    ``,
  ];

  if (summary.total === 0) {
    lines.push("_No events captured. The page loaded cleanly._");
    return lines.join("\n");
  }

  for (const kind of KIND_ORDER) {
    const group = summary.byKind[kind];
    if (group.length === 0) continue;

    lines.push(`## ${KIND_LABEL[kind]} (${group.length})`);
    lines.push("");

    for (const event of group) {
      lines.push(`- **${formatTimestamp(event.ts)}**`);
      lines.push(renderEvent(event));
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runSummary(opts: SummaryOptions): Promise<void> {
  if (!fs.existsSync(opts.file)) {
    throw new Error(`File not found: ${opts.file}`);
  }

  const events = await readEvents(opts.file);
  const summary = groupEvents(events);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(buildMarkdown(summary, opts.file));
  }
}
