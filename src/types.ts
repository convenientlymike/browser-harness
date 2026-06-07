/**
 * Shared types for the browser-harness event stream.
 *
 * Every captured browser event is written as one JSON line (JSONL) to the
 * output file. All variants share the discriminated `kind` field so a
 * consumer can switch without reading extra fields.
 */

export type EventKind =
  | "pageerror"
  | "console_error"
  | "console_warning"
  | "requestfailed"
  | "responseerror";

/** Milliseconds since Unix epoch — included on every event for easy sorting. */
type Ts = { ts: number };

export interface PageErrorEvent extends Ts {
  kind: "pageerror";
  message: string;
  stack?: string | undefined;
}

export interface ConsoleEvent extends Ts {
  kind: "console_error" | "console_warning";
  text: string;
  location?: string | undefined;
}

export interface RequestFailedEvent extends Ts {
  kind: "requestfailed";
  url: string;
  method: string;
  failure: string;
}

export interface ResponseErrorEvent extends Ts {
  kind: "responseerror";
  url: string;
  method: string;
  status: number;
  statusText: string;
}

export type BrowserEvent =
  | PageErrorEvent
  | ConsoleEvent
  | RequestFailedEvent
  | ResponseErrorEvent;

/** CLI-facing options for the capture subcommand. */
export interface CaptureOptions {
  url: string;
  out: string;
  duration: number; // seconds
  headed: boolean;
}

/** CLI-facing options for the summary subcommand. */
export interface SummaryOptions {
  file: string;
  json: boolean; // emit raw JSON instead of markdown
}
