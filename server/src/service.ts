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
  key: string;
  version: number;
}

export class ModService {
  private recent = new Map<string, number[]>();
  private undos = new Map<string, UndoEntry>();
  private locks = new Map<string, Promise<void>>();
  private versions = new Map<string, number>();

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
    if (verdict.score < this.refiner.minScore) return null;
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

  private serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(task, task);
    const settled = run.then(() => undefined, () => undefined);
    this.locks.set(key, settled);
    void settled.then(() => {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    });
    return run;
  }

  async act(id: string, req: ActionRequest): Promise<{ undoToken: string } | null> {
    const item = this.queue.claim(id);
    if (!item) return null;
    const key = `${item.chatId}:${item.userId}`;
    try {
      return await this.serialize(key, async () => {
        if (req.action !== "ignore" && this.tg && !item.demo) {
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
        this.queue.commit(id);
        const undoToken = randomUUID();
        const version = (this.versions.get(key) ?? 0) + 1;
        this.versions.set(key, version);
        this.undos.set(undoToken, { item, action: req.action, expires: this.now() + UNDO_WINDOW_MS, key, version });
        return { undoToken };
      });
    } catch (error) {
      this.queue.release(id);
      throw error;
    }
  }

  async undo(token: string): Promise<boolean> {
    const entry = this.undos.get(token);
    if (!entry || entry.expires < this.now()) return false;
    return this.serialize(entry.key, async () => {
      if (this.versions.get(entry.key) !== entry.version) {
        this.undos.delete(token);
        return false;
      }
      if (this.tg && !entry.item.demo) {
        if (entry.action === "ban") await this.tg.unbanChatMember(entry.item.chatId, entry.item.userId);
        if (entry.action === "mute") await this.tg.unmuteChatMember(entry.item.chatId, entry.item.userId);
      }
      this.undos.delete(token);
      this.queue.restore(entry.item);
      return true;
    });
  }
}
