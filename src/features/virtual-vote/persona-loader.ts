/**
 * persona-loader — Load virtual user persona markdown files.
 *
 * Reads persona cards from the configured directory structure:
 *   {personaBaseDir}/{game}/cards/*.md   (BF style — cards/ subdirectory)
 *   {personaBaseDir}/{game}/*.md         (MS style — flat directory, excludes README/summary)
 *
 * Game aliasing (e.g. BV → BF) is handled via the gameMapping config.
 */

import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Persona {
  /** File-derived id, e.g. "P01_barbara-thompson_US_bingo-blitz_dolphin" */
  id: string;
  /** Display name extracted from first heading, e.g. "Barbara Thompson" */
  name: string;
  /** Short summary line: age/gender/country/pay-tier/motivation */
  summary: string;
  /** Full Layer 1 + Layer 2 text (used as system prompt) */
  profile: string;
  /** Source game code */
  game: string;
}

export interface PersonaIndex {
  game: string;
  resolvedGame: string;
  count: number;
  personas: Persona[];
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface PersonaLoaderConfig {
  /** Root directory containing per-game subdirectories (e.g. 虚拟用户/) */
  personaBaseDir: string;
  /** Game alias mapping, e.g. { "BV": "BF" } */
  gameMapping?: Record<string, string>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Files to skip when scanning flat directories */
const SKIP_FILES = new Set(["readme.md", "summary.md"]);

/** Known per-game subdirectory layouts */
const CARDS_SUBDIR = "cards";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract display name from the first markdown heading.
 * Handles patterns like:
 *   "# P01 — Barbara Thompson｜67岁｜女｜美国 Florida｜Dolphin｜社交连接"
 *   "## P01 — Mia Chen｜20岁｜女｜美国｜免费玩家｜减压逃避"
 */
function parseHeading(line: string): { name: string; summary: string } {
  // Remove leading #
  const cleaned = line.replace(/^#+\s*/, "").trim();
  // Split on — or - (em/en dash)
  const parts = cleaned.split(/\s*[—–-]\s*/);
  if (parts.length < 2) {
    return { name: cleaned, summary: "" };
  }
  // Second part contains "Name｜age｜gender｜country｜tier｜motivation"
  const detail = parts.slice(1).join(" — ");
  const segments = detail.split("｜").map((s) => s.trim());
  const name = segments[0] || cleaned;
  const summary = segments.slice(1).join(" / ");
  return { name, summary };
}

/**
 * Extract Layer 1 + Layer 2 content from a persona markdown file.
 * Stops at Layer 3 heading to keep the prompt focused.
 */
function extractProfile(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let started = false;

  for (const line of lines) {
    // Start capturing from the first heading
    if (!started && /^#+\s/.test(line)) {
      started = true;
    }
    if (!started) continue;

    // Stop at Layer 3 / Layer 4 / expert reflection headings
    if (/^###?\s+(Layer\s*3|Layer\s*4|多视角专家|元数据)/i.test(line)) {
      break;
    }

    result.push(line);
  }

  return result.join("\n").trim();
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve the actual game code after applying aliases.
 */
export function resolveGame(
  game: string,
  gameMapping?: Record<string, string>,
): string {
  const upper = game.toUpperCase();
  return gameMapping?.[upper] ?? upper;
}

/**
 * Get the persona directory path for a given game.
 * Tries {base}/{game}/cards/ first, then {base}/{game}/.
 */
export function getPersonaDir(
  config: PersonaLoaderConfig,
  game: string,
): string | null {
  const resolved = resolveGame(game, config.gameMapping);
  const cardsDir = join(config.personaBaseDir, resolved, CARDS_SUBDIR);
  if (existsSync(cardsDir)) return cardsDir;

  const flatDir = join(config.personaBaseDir, resolved);
  if (existsSync(flatDir)) return flatDir;

  return null;
}

/**
 * Load all personas for a game.
 */
export async function loadPersonas(
  config: PersonaLoaderConfig,
  game: string,
): Promise<PersonaIndex | null> {
  const resolvedGame = resolveGame(game, config.gameMapping);
  const dir = getPersonaDir(config, game);
  if (!dir) return null;

  const files = await readdir(dir);
  const mdFiles = files
    .filter(
      (f) =>
        f.endsWith(".md") && !SKIP_FILES.has(f.toLowerCase()),
    )
    .sort(); // P01, P02, ... natural order by filename

  const personas: Persona[] = [];

  for (const file of mdFiles) {
    const filePath = join(dir, file);
    const content = await readFile(filePath, "utf-8");
    const id = basename(file, ".md");

    // Parse first heading for name + summary
    const firstHeading = content.split("\n").find((l) => /^#+\s/.test(l)) ?? "";
    const { name, summary } = parseHeading(firstHeading);

    // Extract Layer 1 + 2 as profile
    const profile = extractProfile(content);

    personas.push({
      id,
      name,
      summary,
      profile,
      game: resolvedGame,
    });
  }

  return {
    game: game.toUpperCase(),
    resolvedGame,
    count: personas.length,
    personas,
  };
}

/**
 * List available games and their persona counts.
 */
export async function listAvailableGames(
  config: PersonaLoaderConfig,
): Promise<Array<{ game: string; resolvedGame: string; count: number; available: boolean }>> {
  const games = ["BF", "MS", "BV"];
  const results: Array<{ game: string; resolvedGame: string; count: number; available: boolean }> = [];

  for (const game of games) {
    const resolvedGame = resolveGame(game, config.gameMapping);
    const dir = getPersonaDir(config, game);
    if (!dir) {
      results.push({ game, resolvedGame, count: 0, available: false });
      continue;
    }

    const files = await readdir(dir);
    const count = files.filter(
      (f) => f.endsWith(".md") && !SKIP_FILES.has(f.toLowerCase()),
    ).length;

    results.push({ game, resolvedGame, count, available: count > 0 });
  }

  return results;
}
