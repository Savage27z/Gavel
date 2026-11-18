import type { ActionRequest, FlaggedItem } from "./types";

export type Phase =
  | "pairing"
  | "loading"
  | "card"
  | "busy"
  | "toast"
  | "empty"
  | "error"
  | "listening"
  | "transcribing"
  | "confirm";

export interface State {
  phase: Phase;
  code: string | null;
  item: FlaggedItem | null;
  pending: number;
  skipped: string[];
  undoToken: string | null;
  message: string;
  error: string | null;
  afterToast: "next" | "stay";
  request: ActionRequest | null;
}

export type Gesture = "press" | "doublePress" | "swipeUp" | "swipeDown" | "longPress" | "longRelease";

export type Msg =
  | { type: "paired"; code: string }
  | { type: "gesture"; gesture: Gesture }
  | { type: "loaded"; item: FlaggedItem | null; pending: number }
  | { type: "acted"; request: ActionRequest; undoToken: string }
  | { type: "undone" }
  | { type: "voiceHeard"; text: string }
  | { type: "voiceIntent"; request: ActionRequest }
  | { type: "voiceFailed"; message: string }
  | { type: "failed"; message: string }
  | { type: "toastDone" }
  | { type: "tick" }
  | { type: "polled"; item: FlaggedItem | null; pending: number }
  | { type: "unpair" };

export type Effect =
  | { type: "none" }
  | { type: "savePairing"; code: string | null }
  | { type: "fetchNext"; skipped: string[] }
  | { type: "poll" }
  | { type: "act"; itemId: string; request: ActionRequest }
  | { type: "undo"; token: string }
  | { type: "startRecording" }
  | { type: "stopRecording"; itemId: string }
  | { type: "scheduleToast"; ms: number };

export interface Step {
  state: State;
  effect: Effect;
}

const NONE: Effect = { type: "none" };
export const TOAST_MS = 2200;

export function initialState(code: string | null): State {
  return {
    phase: code ? "loading" : "pairing",
    code,
    item: null,
    pending: 0,
    skipped: [],
    undoToken: null,
    message: "",
    error: null,
    afterToast: "next",
    request: null,
  };
}

export function bootEffect(state: State): Effect {
  return state.phase === "loading" ? { type: "fetchNext", skipped: [] } : NONE;
}

export function describeAction(request: ActionRequest): string {
  if (request.action === "ban") {
    return request.deleteRecent ? `Banned + deleted ${request.deleteRecent}` : "Banned";
  }
  if (request.action === "mute") {
    return `Muted ${formatMinutes(request.muteMinutes ?? 1440)}${request.deleteRecent ? " + deleted" : ""}`;
  }
  return "Ignored";
}

function formatMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function act(state: State, request: ActionRequest): Step {
  if (!state.item) return { state, effect: NONE };
  return {
    state: { ...state, phase: "busy", message: "Working..." },
    effect: { type: "act", itemId: state.item.id, request },
  };
}

function load(state: State, skipped: string[]): Step {
  return { state: { ...state, phase: "loading", skipped }, effect: { type: "fetchNext", skipped } };
}

function onCardGesture(state: State, gesture: Gesture): Step {
  switch (gesture) {
    case "press":
      return act(state, { action: "mute", muteMinutes: 1440, deleteRecent: 1 });
    case "doublePress":
      return act(state, { action: "ignore" });
    case "swipeDown":
      return state.item ? load(state, [...state.skipped, state.item.id]) : load(state, state.skipped);
    case "swipeUp":
      return state.undoToken
        ? { state: { ...state, phase: "busy", message: "Undoing..." }, effect: { type: "undo", token: state.undoToken } }
        : { state, effect: NONE };
    case "longPress":
      return { state: { ...state, phase: "listening" }, effect: { type: "startRecording" } };
    case "longRelease":
      return { state, effect: NONE };
  }
}

export function reduce(state: State, msg: Msg): Step {
  if (msg.type === "tick") {
    if (state.phase === "empty") return load(state, []);
    if (state.phase === "error") return load(state, state.skipped);
    if (state.phase === "card") return { state, effect: { type: "poll" } };
    return { state, effect: NONE };
  }
  if (msg.type === "polled") {
    return state.phase === "card" ? { state: { ...state, pending: msg.pending }, effect: NONE } : { state, effect: NONE };
  }
  if (msg.type === "paired") {
    return {
      state: { ...initialState(msg.code), phase: "loading" },
      effect: { type: "savePairing", code: msg.code },
    };
  }
  if (msg.type === "unpair") {
    return { state: initialState(null), effect: { type: "savePairing", code: null } };
  }
  if (msg.type === "failed") {
    return { state: { ...state, phase: "error", error: msg.message }, effect: NONE };
  }

  switch (state.phase) {
    case "pairing":
      return { state, effect: NONE };

    case "loading":
      if (msg.type !== "loaded") return { state, effect: NONE };
      if (!msg.item) {
        return { state: { ...state, phase: "empty", item: null, pending: 0, skipped: [] }, effect: NONE };
      }
      return { state: { ...state, phase: "card", item: msg.item, pending: msg.pending }, effect: NONE };

    case "card":
      return msg.type === "gesture" ? onCardGesture(state, msg.gesture) : { state, effect: NONE };

    case "busy":
      if (msg.type === "acted") {
        return {
          state: {
            ...state,
            phase: "toast",
            undoToken: msg.undoToken,
            message: `${describeAction(msg.request)}. Swipe up to undo`,
            afterToast: "next",
          },
          effect: { type: "scheduleToast", ms: TOAST_MS },
        };
      }
      if (msg.type === "undone") {
        return {
          state: { ...state, phase: "toast", undoToken: null, message: "Undone", afterToast: "next" },
          effect: { type: "scheduleToast", ms: 1200 },
        };
      }
      return { state, effect: NONE };

    case "toast":
      if (msg.type === "toastDone") {
        return state.afterToast === "stay" ? { state: { ...state, phase: "card" }, effect: NONE } : load(state, state.skipped);
      }
      if (msg.type === "gesture" && msg.gesture === "swipeUp" && state.undoToken) {
        return { state: { ...state, phase: "busy", message: "Undoing..." }, effect: { type: "undo", token: state.undoToken } };
      }
      return { state, effect: NONE };

    case "empty":
      if (msg.type === "gesture" && (msg.gesture === "swipeDown" || msg.gesture === "press")) return load(state, []);
      if (msg.type === "gesture" && msg.gesture === "swipeUp" && state.undoToken) {
        return { state: { ...state, phase: "busy", message: "Undoing..." }, effect: { type: "undo", token: state.undoToken } };
      }
      return { state, effect: NONE };

    case "error":
      if (msg.type === "gesture" && (msg.gesture === "press" || msg.gesture === "swipeDown")) return load(state, state.skipped);
      return { state, effect: NONE };

    case "listening":
      if (msg.type === "gesture" && msg.gesture === "longRelease" && state.item) {
        return {
          state: { ...state, phase: "transcribing", message: "Thinking..." },
          effect: { type: "stopRecording", itemId: state.item.id },
        };
      }
      return { state, effect: NONE };

    case "confirm":
      if (msg.type !== "gesture") return { state, effect: NONE };
      if (msg.gesture === "press" && state.request) return act({ ...state, phase: "card", request: null }, state.request);
      if (msg.gesture === "swipeDown" || msg.gesture === "doublePress") return { state: { ...state, phase: "card", request: null }, effect: NONE };
      return { state, effect: NONE };

    case "transcribing":
      if (msg.type === "voiceHeard") return { state: { ...state, message: `"${msg.text}"` }, effect: NONE };
      if (msg.type === "voiceIntent") return { state: { ...state, phase: "confirm", request: msg.request }, effect: NONE };
      if (msg.type === "voiceFailed") {
        return {
          state: { ...state, phase: "toast", message: msg.message, afterToast: "stay" },
          effect: { type: "scheduleToast", ms: TOAST_MS },
        };
      }
      return { state, effect: NONE };
  }
}
