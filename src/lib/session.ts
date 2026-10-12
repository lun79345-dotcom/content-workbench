import crypto from "node:crypto";
export const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const sign = (value: string, secret: string) => crypto.createHmac("sha256", secret).update(value).digest("base64url");
export function makeSession(uid: number, version: number, secret: string, now = Date.now()) {
  const value = `${uid}.${now}.${version}.${crypto.randomBytes(16).toString("hex")}`;
  return `${value}.${sign(value, secret)}`;
}
export function readSession(raw: string, secret: string, now = Date.now()): { uid: number; version: number } | null {
  if (raw.length > 300) return null;
  const i = raw.lastIndexOf(".");
  if (i < 0) return null;
  const value = raw.slice(0, i), signature = Buffer.from(raw.slice(i + 1)), expected = Buffer.from(sign(value, secret));
  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) return null;
  const parts = value.split(".");
  if (parts.length !== 2 && parts.length !== 4) return null;
  if (!parts.slice(0, parts.length === 2 ? 2 : 3).every((p) => /^\d+$/.test(p))) return null;
  const [uid, issued, version = 0] = parts.map(Number);
  if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(issued) || issued > now + 60000 || now - issued >= SESSION_AGE || !Number.isSafeInteger(version)) return null;
  if (parts.length === 4 && !/^[0-9a-f]{32}$/.test(parts[3])) return null;
  return { uid, version };
}
