import { SEED_KITS_RENAMED } from "@/config";

/**
 * The folder a ready-made bot's own skills ship in (`seed-skills/<this>`), from the bot's
 * name: the name lowercased, or, for a seed renamed since, the folder it ships in now.
 */
export const seedKitName = (bot: string): string => {
  const key = bot.trim().toLowerCase();
  // Its own entries only: a bot named "constructor" is no renamed seed
  return Object.hasOwn(SEED_KITS_RENAMED, key) ? SEED_KITS_RENAMED[key] : key;
};
