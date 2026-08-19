import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_SKILL_DIRS = [
  path.join(os.homedir(), ".claude/skills"),
  path.join(os.homedir(), ".codex/skills"),
  path.join(os.homedir(), ".agents/skills"),
];

/**
 * List installed skill names by reading the immediate subdirectories of the
 * given directories. Missing directories are silently ignored.
 */
export async function listSkillNames(
  dirs: string[] = resolveSkillDirs(),
): Promise<Set<string>> {
  const names = new Set<string>();
  for (const dir of dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Missing or unreadable directory is normal; degrade silently.
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        names.add(entry.name);
      }
    }
  }
  return names;
}

function resolveSkillDirs(): string[] {
  const envDirs = process.env.AGENT_LORE_SKILL_DIRS;
  if (envDirs) {
    // path.delimiter, not ":" — a Windows drive letter carries a colon.
    return envDirs.split(path.delimiter).filter((d) => d !== "");
  }
  return DEFAULT_SKILL_DIRS;
}

/**
 * If the last path segment of `target` matches an installed skill name,
 * return that skill name so callers can report the target as a skill rather
 * than as a missing lore page.
 */
export function skillForTarget(
  target: string,
  names: Set<string>,
): string | undefined {
  const last = target.split("/").pop() ?? target;
  if (names.has(last)) {
    return last;
  }
  return undefined;
}
