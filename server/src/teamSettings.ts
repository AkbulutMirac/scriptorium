import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SERVER_ROOT } from "./config.js";

/**
 * The user's choice of models for the team (Settings → Team models): each specialist's Claude model and the
 * builder's DeepSeek worker and thinking level. Only changes from the defaults are stored, in
 * server/data/team-settings.json (user data, not in the repo).
 */
const SettingsSchema = z.object({
  models: z.record(z.string(), z.enum(["haiku", "sonnet", "opus"])).default({}),
  builder: z.object({ worker: z.string().optional(), thinking: z.enum(["low", "high", "max"]).optional() }).default({}),
});
export type StoredTeamSettings = z.infer<typeof SettingsSchema>;

const FILE = path.join(SERVER_ROOT, "data", "team-settings.json");
let cache: StoredTeamSettings | undefined;

export function getTeamSettings(): StoredTeamSettings {
  if (!cache) {
    try {
      cache = SettingsSchema.parse(JSON.parse(readFileSync(FILE, "utf8")));
    } catch {
      cache = SettingsSchema.parse({});
    }
  }
  return cache;
}

export function saveTeamSettings(next: unknown): StoredTeamSettings {
  const parsed = SettingsSchema.parse(next);
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  cache = parsed;
  return parsed;
}
