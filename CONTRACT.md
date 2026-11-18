# Gavel API contract (source of truth)

Backend (Node 24 + TypeScript, Fastify) on http://localhost:8787. All JSON. Auth: header `x-pairing-code` must equal env PAIRING_CODE (glasses app has no login UI; user types the code once, stored in localStorage).

## Types
FlaggedItem = {
  id: string,
  chatId: number, chatTitle: string,
  userId: number, username: string | null,
  text: string,            // original message, truncated to 400 chars
  messageId: number,
  risk: "low" | "medium" | "high",
  score: number,           // 0..1
  reason: string,          // <= 60 chars, e.g. "Fake support + wallet link"
  flaggedAt: string        // ISO
}
Action = "ban" | "mute" | "ignore"

## Endpoints
GET  /health                          -> { ok: true }
GET  /queue/next                      -> FlaggedItem | 204 (empty). Does not remove the item; oldest highest-risk first.
GET  /queue/stats                     -> { pending: number, handled: number }
POST /queue/:id/action  { action: Action, deleteRecent?: number, muteMinutes?: number }
                                      -> { ok: true, undoToken: string }  (ban deletes the message; mute default 1440 min; deleteRecent deletes that user's last N messages in the chat when known)
POST /queue/undo        { undoToken }  -> { ok: true }  (unban/unrestrict; valid 60 s)
POST /voice/intent      { text: string, itemId: string } -> { action: Action, deleteRecent?: number, muteMinutes?: number } | 422
                                      (parses short phrases like "ban and delete their last 10", "mute for a day")
POST /dev/seed                         -> { added: number }  (only when NODE_ENV!=production; injects sample scams without Telegram)

## Rules
- NEVER auto-moderate. Only act on POST /queue/:id/action.
- Bot token, LLM key only in env (see .env.example). Never log them.
- Classifier: cheap rules first (links, new account, "DM me", "support", seed phrase / wallet words), optional LLM refinement if LLM_API_KEY set; must work offline with rules only.

## Glasses gestures (Even Hub)
press = confirm primary action (ban), double press = ignore, swipe down = next/skip, swipe up = undo last action, long press = open voice command (mic -> STT -> /voice/intent).
