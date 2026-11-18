import type { ActionRequest, Risk } from "./types.js";

export function suggest(risk: Risk, offenses: number): ActionRequest {
  if (offenses >= 3 || (risk === "high" && offenses >= 2)) return { action: "ban", deleteRecent: 10 };
  if (risk === "high") return { action: "mute", muteMinutes: 1440, deleteRecent: 1 };
  if (risk === "medium") return { action: "mute", muteMinutes: 60, deleteRecent: 1 };
  return { action: "ignore" };
}
