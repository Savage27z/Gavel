import type { State } from "./machine";
import type { FlaggedItem, Risk } from "./types";

export interface Screen {
  header: string;
  body: string;
  footer: string;
}

const BADGE: Record<Risk, string> = { high: "[!!!] HIGH", medium: "[!!] MED", low: "[!] LOW" };
const BODY_CHARS = 120;

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1).trimEnd() + "\u2026";
}

function cardBody(item: FlaggedItem): string {
  const name = item.username ? `@${item.username}` : `user ${item.userId}`;
  return [`${name} in ${truncate(item.chatTitle, 24)}`, `"${truncate(item.text, BODY_CHARS)}"`, `> ${truncate(item.reason, 60)}`].join("\n");
}

export function renderScreen(state: State): Screen {
  switch (state.phase) {
    case "pairing":
      return {
        header: "GAVEL",
        body: "Open this app on your phone\nand enter the pairing code.",
        footer: "Waiting for pairing...",
      };
    case "loading":
      return { header: "GAVEL", body: "Loading...", footer: "" };
    case "card":
    case "busy":
      if (!state.item) return { header: "GAVEL", body: state.message, footer: "" };
      return {
        header: `${BADGE[state.item.risk]}   ${state.pending} pending`,
        body: state.phase === "busy" ? state.message : cardBody(state.item),
        footer: "Press ban | 2x ignore | Dn skip | Up undo | Hold voice",
      };
    case "toast":
      return {
        header: "DONE",
        body: state.message,
        footer: state.undoToken ? "Swipe up to undo" : "",
      };
    case "empty":
      return {
        header: "GAVEL",
        body: "Queue clear",
        footer: state.undoToken ? "Up undo | Dn refresh" : "Dn refresh",
      };
    case "error":
      return { header: "OFFLINE", body: state.error ?? "Something went wrong", footer: "Press to retry" };
    case "listening":
      return { header: "LISTENING", body: 'Say: "ban and delete their last 10"\nor "mute for a day"', footer: "Release to send" };
    case "transcribing":
      return { header: "VOICE", body: state.message, footer: "" };
  }
}
