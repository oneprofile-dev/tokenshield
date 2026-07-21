import { createHash } from "node:crypto";

export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function byteLength(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  return Buffer.byteLength(JSON.stringify(value ?? ""), "utf8");
}
