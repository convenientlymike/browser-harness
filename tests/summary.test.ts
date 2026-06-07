/**
 * Tests for the summary module — no network, no browser required.
 *
 * Run: npm test
 */

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readEvents, groupEvents, buildMarkdown } from "../src/summary.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "sample.jsonl");

describe("readEvents", () => {
  it("reads all 6 lines from the fixture JSONL", async () => {
    const events = await readEvents(FIXTURE);
    assert.equal(events.length, 6);
  });

  it("preserves the kind discriminator on every event", async () => {
    const events = await readEvents(FIXTURE);
    const kinds = events.map((e) => e.kind);
    assert.deepEqual(kinds, [
      "pageerror",
      "console_error",
      "console_warning",
      "requestfailed",
      "responseerror",
      "responseerror",
    ]);
  });

  it("parses timestamps as numbers", async () => {
    const events = await readEvents(FIXTURE);
    for (const e of events) {
      assert.equal(typeof e.ts, "number");
      assert.ok(e.ts > 0);
    }
  });
});

describe("groupEvents", () => {
  it("totals match input length", async () => {
    const events = await readEvents(FIXTURE);
    const summary = groupEvents(events);
    assert.equal(summary.total, 6);
  });

  it("groups by kind correctly", async () => {
    const events = await readEvents(FIXTURE);
    const { byKind } = groupEvents(events);
    assert.equal(byKind.pageerror.length, 1);
    assert.equal(byKind.console_error.length, 1);
    assert.equal(byKind.console_warning.length, 1);
    assert.equal(byKind.requestfailed.length, 1);
    assert.equal(byKind.responseerror.length, 2);
  });
});

describe("buildMarkdown", () => {
  it("includes all section headings when each kind has events", async () => {
    const events = await readEvents(FIXTURE);
    const summary = groupEvents(events);
    const md = buildMarkdown(summary, FIXTURE);

    assert.ok(md.includes("## Page Errors"), "missing Page Errors section");
    assert.ok(md.includes("## Console Errors"), "missing Console Errors section");
    assert.ok(md.includes("## Console Warnings"), "missing Console Warnings section");
    assert.ok(md.includes("## Failed Requests"), "missing Failed Requests section");
    assert.ok(
      md.includes("## HTTP Error Responses"),
      "missing HTTP Error Responses section"
    );
  });

  it("includes the pageerror message text", async () => {
    const events = await readEvents(FIXTURE);
    const md = buildMarkdown(groupEvents(events), FIXTURE);
    assert.ok(
      md.includes("Uncaught ReferenceError: __app is not defined"),
      "pageerror message not in output"
    );
  });

  it("includes HTTP status codes for responseerror events", async () => {
    const events = await readEvents(FIXTURE);
    const md = buildMarkdown(groupEvents(events), FIXTURE);
    assert.ok(md.includes("HTTP 401"), "missing HTTP 401");
    assert.ok(md.includes("HTTP 500"), "missing HTTP 500");
  });

  it("returns a clean message when there are no events", () => {
    const empty = groupEvents([]);
    const md = buildMarkdown(empty, "empty.jsonl");
    assert.ok(md.includes("loaded cleanly"), "expected clean-load message");
  });
});
