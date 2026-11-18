import { describe, expect, it } from "vitest";
import { initialState, reduce, type State } from "./machine";
import { renderScreen, truncate } from "./render";
import type { FlaggedItem } from "./types";

const item: FlaggedItem = {
  id: "a",
  chatId: 1,
  chatTitle: "Chat",
  userId: 7,
  username: "spam",
  text: "DM me for a free wallet",
  messageId: 1,
  risk: "high",
  score: 0.9,
  reason: "Fake support",
  flaggedAt: "2026-01-01T00:00:00Z",
};

const card = (): State => ({ ...initialState("c"), phase: "card", item, pending: 3 });

describe("machine", () => {
  it("starts in pairing without a code and loading with one", () => {
    expect(initialState(null).phase).toBe("pairing");
    expect(initialState("c").phase).toBe("loading");
  });

  it("pairing saves the code and loads the queue", () => {
    const step = reduce(initialState(null), { type: "paired", code: "123" });
    expect(step.state.phase).toBe("loading");
    expect(step.effect).toEqual({ type: "savePairing", code: "123" });
  });

  it("loaded with no item shows empty state", () => {
    const step = reduce(initialState("c"), { type: "loaded", item: null, pending: 0 });
    expect(step.state.phase).toBe("empty");
    expect(renderScreen(step.state).body).toBe("Queue clear");
  });

  it("press bans, double press ignores", () => {
    expect(reduce(card(), { type: "gesture", gesture: "press" }).effect).toEqual({
      type: "act",
      itemId: "a",
      request: { action: "ban" },
    });
    expect(reduce(card(), { type: "gesture", gesture: "doublePress" }).effect).toMatchObject({
      request: { action: "ignore" },
    });
  });

  it("swipe down skips the current item", () => {
    const step = reduce(card(), { type: "gesture", gesture: "swipeDown" });
    expect(step.effect).toEqual({ type: "fetchNext", skipped: ["a"] });
  });

  it("action result shows undo toast, then loads next", () => {
    const busy = reduce(card(), { type: "gesture", gesture: "press" }).state;
    const toast = reduce(busy, { type: "acted", request: { action: "ban" }, undoToken: "u1" });
    expect(renderScreen(toast.state).body).toBe("Banned. Swipe up to undo");
    expect(reduce(toast.state, { type: "toastDone" }).effect.type).toBe("fetchNext");
  });

  it("swipe up during toast undoes the last action", () => {
    const busy = reduce(card(), { type: "gesture", gesture: "press" }).state;
    const toast = reduce(busy, { type: "acted", request: { action: "ban" }, undoToken: "u1" }).state;
    expect(reduce(toast, { type: "gesture", gesture: "swipeUp" }).effect).toEqual({ type: "undo", token: "u1" });
  });

  it("swipe up without undo token does nothing", () => {
    expect(reduce(card(), { type: "gesture", gesture: "swipeUp" }).effect.type).toBe("none");
  });

  it("long press records, release transcribes, intent acts", () => {
    const listening = reduce(card(), { type: "gesture", gesture: "longPress" });
    expect(listening.effect.type).toBe("startRecording");
    const released = reduce(listening.state, { type: "gesture", gesture: "longRelease" });
    expect(released.effect).toEqual({ type: "stopRecording", itemId: "a" });
    const acted = reduce(released.state, { type: "voiceIntent", request: { action: "ban", deleteRecent: 10 } });
    expect(acted.effect).toMatchObject({ type: "act", request: { deleteRecent: 10 } });
  });

  it("voice failure returns to the card after the toast", () => {
    const released = reduce(reduce(card(), { type: "gesture", gesture: "longPress" }).state, { type: "gesture", gesture: "longRelease" });
    const failed = reduce(released.state, { type: "voiceFailed", message: "Did not understand" });
    expect(reduce(failed.state, { type: "toastDone" }).state.phase).toBe("card");
  });

  it("errors show offline state and press retries", () => {
    const failed = reduce(card(), { type: "failed", message: "Offline. Press to retry" });
    expect(renderScreen(failed.state).header).toBe("OFFLINE");
    expect(reduce(failed.state, { type: "gesture", gesture: "press" }).effect.type).toBe("fetchNext");
  });

  it("card render has badge, username, reason and pending count", () => {
    const screen = renderScreen(card());
    expect(screen.header).toContain("HIGH");
    expect(screen.header).toContain("3 pending");
    expect(screen.body).toContain("@spam");
    expect(screen.body).toContain("Fake support");
  });

  it("truncates long text", () => {
    expect(truncate("x".repeat(300), 50)).toHaveLength(50);
  });
});
