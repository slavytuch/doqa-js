import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
export function atomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + "." + randomUUID() + ".tmp";
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  renameSync(temp, path);
}
export function hash(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}
export function warn(message: string): void {
  process.stderr.write(`[doqa-js] ${message}\n`);
}
