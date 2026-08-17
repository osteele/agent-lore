import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ID_ENV_VARS = [
  "CLAUDE_CODE_SESSION_ID",
  "CODEX_THREAD_ID",
  "AGENT_SESSION_ID",
];

const AGENT_MAIL_NAMES_DIR = path.join(
  os.homedir(),
  ".claude",
  "agent-mail",
  "session-names",
);

export interface Identity {
  sessionId: string;
  idSource: string;
  minted: boolean;
  name: string;
  authorName: string;
  authorEmail: string;
}

/**
 * Resolve the session identity once at startup.
 */
export function resolveIdentity(home = os.homedir()): Identity {
  let sessionId = "";
  let idSource = "";
  for (const envVar of ID_ENV_VARS) {
    const value = process.env[envVar];
    if (value && value !== "") {
      sessionId = value;
      idSource = envVar;
      break;
    }
  }
  let minted = false;
  if (sessionId === "") {
    sessionId = randomUUID();
    idSource = "minted";
    minted = true;
  }

  const name = resolveSessionName(sessionId, home);
  return {
    sessionId,
    idSource,
    minted,
    name,
    authorName: name,
    authorEmail: `${sessionId}@agent-lore`,
  };
}

function resolveSessionName(sessionId: string, home: string): string {
  // agent-mail keys its persisted name assignments by sha256(sessionId), with
  // the raw id repeated inside the record.
  const hash = createHash("sha256").update(sessionId).digest("hex");
  const file = path.join(
    home,
    ".claude",
    "agent-mail",
    "session-names",
    `${hash}.json`,
  );
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const candidate = extractName(parsed, sessionId);
    if (candidate) return candidate;
  } catch (err) {
    // Missing or unparseable agent-mail name file: fall through to default.
    if (
      !(err instanceof Error) ||
      (!("code" in err && err.code === "ENOENT") &&
        !(err instanceof SyntaxError))
    ) {
      throw err;
    }
  }
  return `session-${sessionId.slice(0, 8)}`;
}

function extractName(parsed: unknown, sessionId: string): string | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const obj = parsed as Record<string, unknown>;

  // The file is keyed by a hash; when the record names its session, require
  // that it is actually ours before adopting the name.
  if (typeof obj.sessionId === "string" && obj.sessionId !== sessionId) {
    return undefined;
  }

  // agent-mail's record shape: { sessionId, scheme, slug, displayName }.
  // The kebab-case slug ("fair-garden") doubles as ledger filename and git
  // author name; accept displayName and legacy-ish keys as fallbacks.
  for (const key of ["slug", "displayName", "full", "display", "name"]) {
    const value = obj[key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }

  return undefined;
}
