import { randomUUID } from "node:crypto";
import { classify } from "./classifier.js";
import type { Refiner } from "./llm.js";
import type { ModQueue } from "./queue.js";
import type { TelegramGateway } from "./telegram.js";
import type { ActionRequest, FlaggedItem, IncomingMessage } from "./types.js";

const UNDO_WINDOW_MS = 60_000;
const FLAG_THRESHOLD = 0.35;
const RECENT_PER_USER = 50;

interface UndoEntry {
  item: FlaggedItem;
  action: ActionRequest["action"];
  expires: number;
}

export class ModService {
  private recent = new Map<string, number[]>();
  private undos = new Map<string, UndoEntry>();

  constructor(
    readonly queue: ModQueue,
    private tg: TelegramGateway | null,
    private refiner: Refiner,
    private now: () => number = Date.now,
  ) {}

  async ingest(msg: IncomingMessage): Promise<FlaggedItem | null> {
    const key = `${msg.chatId}:${msg.userId}`;
    const ids = this.recent.get(key) ?? [];
    ids.push(msg.messageId);
    this.recent.set(key, ids.slice(-RECENT_PER_USER));

    let verdict = classify(msg.text, msg.accountAgeDays);
    if (verdict.score < FLAG_THRESHOLD) return null;
    verdict = await this.refiner.refine(msg.text, verdict);
    if (verdict.score < FLAG_THRESHOLD) return null;
    return this.queue.add({
      chatId: msg.chatId,
      chatTitle: msg.chatTitle,
      userId: msg.userId,
      username: msg.username,
      text: msg.text,
      messageId: msg.messageId,
      risk: verdict.risk,
      score: verdict.score,
      reason: verdict.reason,
    });
  }

  async act(id: string, req: ActionRequest): Promise<{ undoToken: string } | null> {
    const item = this.queue.get(id);
    if (!item) return null;

    if (req.action !== "ignore" && this.tg) {
      const key = `${item.chatId}:${item.userId}`;
      const toDelete = new Set<number>([item.messageId]);
      const known = this.recent.get(key) ?? [];
      if (req.deleteRecent) known.slice(-req.deleteRecent).forEach((m) => toDelete.add(m));
      if (req.action === "ban") {
        await this.tg.banChatMember(item.chatId, item.userId);
      } else {
        const minutes = req.muteMinutes ?? 1440;
        await this.tg.muteChatMember(item.chatId, item.userId, Math.floor(this.now() / 1000) + minutes * 60);
      }
      if (req.action === "ban" || req.deleteRecent) {
        await Promise.allSettled([...toDelete].map((m) => this.tg!.deleteMessage(item.chatId, m)));
      }
    }

    this.queue.resolve(id);
    const undoToken = randomUUID();
    this.undos.set(undoToken, { item, action: req.action, expires: this.now() + UNDO_WINDOW_MS });
    return { undoToken };
  }

  async undo(token: string): Promise<boolean> {
    const entry = this.undos.get(token);
    if (!entry || entry.expires < this.now()) return false;
    this.undos.delete(token);
    if (this.tg) {
      if (entry.action === "ban") await this.tg.unbanChatMember(entry.item.chatId, entry.item.userId);
      if (entry.action === "mute") await this.tg.unmuteChatMember(entry.item.chatId, entry.item.userId);
    }
    this.queue.restore(entry.item);
    return true;
  }
}
