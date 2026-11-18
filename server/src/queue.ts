import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FlaggedItem, Risk } from "./types.js";

const riskRank: Record<Risk, number> = { high: 2, medium: 1, low: 0 };

interface Persisted {
  pending: FlaggedItem[];
  handled: number;
}

export class ModQueue {
  private pending: FlaggedItem[] = [];
  private handled = 0;

  constructor(private file?: string) {
    if (file && existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8")) as Persisted;
      this.pending = data.pending;
      this.handled = data.handled;
    }
  }

  add(input: Omit<FlaggedItem, "id" | "flaggedAt"> & { flaggedAt?: string }): FlaggedItem {
    const item: FlaggedItem = {
      ...input,
      text: input.text.slice(0, 400),
      reason: input.reason.slice(0, 60),
      id: randomUUID(),
      flaggedAt: input.flaggedAt ?? new Date().toISOString(),
    };
    this.pending.push(item);
    this.save();
    return item;
  }

  next(skip: string[] = []): FlaggedItem | undefined {
    const unskipped = this.pending.filter((i) => !skip.includes(i.id));
    const candidates = unskipped.length ? unskipped : this.pending;
    return [...candidates].sort(
      (a, b) => riskRank[b.risk] - riskRank[a.risk] || Date.parse(a.flaggedAt) - Date.parse(b.flaggedAt),
    )[0];
  }

  get(id: string): FlaggedItem | undefined {
    return this.pending.find((i) => i.id === id);
  }

  resolve(id: string): FlaggedItem | undefined {
    const item = this.get(id);
    if (!item) return undefined;
    this.pending = this.pending.filter((i) => i.id !== id);
    this.handled += 1;
    this.save();
    return item;
  }

  restore(item: FlaggedItem): void {
    if (this.get(item.id)) return;
    this.pending.push(item);
    this.handled = Math.max(0, this.handled - 1);
    this.save();
  }

  stats() {
    return { pending: this.pending.length, handled: this.handled };
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ pending: this.pending, handled: this.handled } satisfies Persisted));
  }
}
