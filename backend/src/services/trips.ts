import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { TripHistoryResponse } from "../contract/api.js";
import { createSupabaseTripHistoryStore, type NewTripSummary, type TripCursor, type TripHistoryStore } from "../db/trips.js";
import { AppError } from "../errors.js";

const cursorSchema = z.object({ at: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict();
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().max(512).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict();
const invalid = () => new AppError("BAD_REQUEST", "Invalid trip history page.");

export class TripHistoryService {
  constructor(private readonly store: TripHistoryStore) {}

  async list(userId: string, query: unknown): Promise<TripHistoryResponse> {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) throw invalid();
    const { limit, cursor } = parsed.data;
    let before: TripCursor | null = null;
    if (cursor) {
      try {
        const decoded = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
        before = { ...decoded, at: new Date(decoded.at).toISOString() };
      } catch { throw invalid(); }
    }
    const rows = await this.store.list(userId, before, limit + 1);
    const trips = rows.slice(0, limit);
    const last = trips.at(-1);
    const nextCursor = rows.length > limit && last
      ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id })).toString("base64url") : null;
    return { trips, nextCursor };
  }

  record(userId: string, trip: NewTripSummary): Promise<void> { return this.store.record(userId, trip); }

  async remove(userId: string, id: string): Promise<void> {
    if (!z.string().uuid().safeParse(id).success) throw new AppError("BAD_REQUEST", "Invalid trip.");
    await this.store.remove(userId, id);
  }

  clear(userId: string): Promise<void> { return this.store.clear(userId); }
}

export function createTripHistoryService(config: AppConfig): TripHistoryService | null {
  return config.capabilities.auth ? new TripHistoryService(createSupabaseTripHistoryStore(config)) : null;
}
