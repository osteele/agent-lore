export interface LedgerClientInfo {
  name: string;
  version: string;
}

export interface LedgerParentInfo {
  pid?: number;
  startTime?: string;
  command?: string;
}

export interface LedgerInfo {
  sessionId: string;
  idSource: string;
  minted?: boolean;
  client?: LedgerClientInfo;
  protocolVersion?: string;
  roots?: string[];
  cwd?: string;
  user?: string;
  hostname?: string;
  osVersion?: string;
  parent?: LedgerParentInfo;
  env?: Record<string, string>;
  firstObserved: string;
  loreVersion: string;
}

/**
 * Serialize a session ledger page: YAML frontmatter followed by a one-line
 * human sentence. Unknown/missing fields are omitted.
 */
export function formatLedger(info: LedgerInfo): string {
  const frontmatter = yamlFrontmatter({
    sessionId: info.sessionId,
    idSource: info.idSource,
    ...(info.minted === true ? { minted: true } : {}),
    ...(info.client ? { client: info.client } : {}),
    ...(info.protocolVersion ? { protocolVersion: info.protocolVersion } : {}),
    ...(info.roots && info.roots.length > 0 ? { roots: info.roots } : {}),
    ...(info.cwd ? { cwd: info.cwd } : {}),
    ...(info.user ? { user: info.user } : {}),
    ...(info.hostname ? { hostname: info.hostname } : {}),
    ...(info.osVersion ? { osVersion: info.osVersion } : {}),
    ...(info.parent && hasDefinedParent(info.parent)
      ? { parent: info.parent }
      : {}),
    ...(info.env && Object.keys(info.env).length > 0 ? { env: info.env } : {}),
    firstObserved: info.firstObserved,
    loreVersion: info.loreVersion,
  });

  const clientLabel = info.client
    ? `${info.client.name} ${info.client.version}`
    : "unknown client";
  const cwd = info.cwd ?? "unknown directory";
  const body = `First observed ${info.firstObserved} in ${cwd} via ${clientLabel}.\n`;

  return `---\n${frontmatter}---\n\n${body}`;
}

function hasDefinedParent(parent: LedgerParentInfo): boolean {
  return (
    parent.pid !== undefined ||
    parent.startTime !== undefined ||
    parent.command !== undefined
  );
}

function yamlFrontmatter(value: Record<string, unknown>): string {
  return emitYaml(value, 0);
}

function emitYaml(value: unknown, indent: number): string {
  const prefix = "  ".repeat(indent);
  if (value === null || value === undefined) {
    return `${prefix}null\n`;
  }
  if (typeof value === "boolean") {
    return `${prefix}${value ? "true" : "false"}\n`;
  }
  if (typeof value === "number") {
    return `${prefix}${value}\n`;
  }
  if (typeof value === "string") {
    return `${prefix}${yamlString(value)}\n`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${prefix}[]\n`;
    }
    let out = "";
    for (const item of value) {
      if (isScalar(item)) {
        out += `${prefix}- ${yamlInline(item)}\n`;
      } else {
        out += `${prefix}-\n${emitYaml(item, indent + 1)}`;
      }
    }
    return out;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return `${prefix}{}\n`;
    }
    let out = "";
    for (const key of keys) {
      const child = obj[key];
      if (isScalar(child)) {
        out += `${prefix}${key}: ${yamlInline(child)}\n`;
      } else {
        out += `${prefix}${key}:\n${emitYaml(child, indent + 1)}`;
      }
    }
    return out;
  }
  return `${prefix}${yamlString(String(value))}\n`;
}

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

function yamlInline(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return yamlString(value);
  return yamlString(String(value));
}

function yamlString(s: string): string {
  if (s === "") return '""';
  if (/^[a-zA-Z0-9_./:@~\-]+$/.test(s)) return s;
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}
