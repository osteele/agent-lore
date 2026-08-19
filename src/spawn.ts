import { spawn } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run a command to completion and collect its output. A non-zero exit is a
 * result, not a rejection: callers decide which exit codes are failures, and
 * git uses several as ordinary answers. Rejection is reserved for the command
 * not starting at all.
 */
export function runCommand(
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}
