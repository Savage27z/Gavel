export type Risk = "low" | "medium" | "high";
export type Action = "ban" | "mute" | "ignore";

export interface FlaggedItem {
  id: string;
  chatId: number;
  chatTitle: string;
  userId: number;
  username: string | null;
  text: string;
  messageId: number;
  risk: Risk;
  score: number;
  reason: string;
  flaggedAt: string;
  offenses: number;
  suggested: ActionRequest;
}

export interface ActionRequest {
  action: Action;
  deleteRecent?: number;
  muteMinutes?: number;
}

export interface ActionResult {
  undoToken: string;
}

export interface QueueStats {
  pending: number;
  handled: number;
}
