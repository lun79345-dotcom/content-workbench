export const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
export function draftKey(userId: number, form: string) { return `content-workbench:draft:${userId}:${form}`; }
export type DraftFields = Record<string, string>;
export type FormDraft = { version: string; fields: DraftFields; savedAt: number };
export function draftCreationSucceeded(key: string, digest: unknown, origin: string) {
  if (!key.includes(":new-video:") || typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) return false;
  try {
    const target = new URL(digest.split(";")[2], origin);
    return target.origin === origin && /\/videos\/\d+$/.test(target.pathname);
  } catch { return false; }
}
export function decodeDraft(raw: string | null, defaults: DraftFields, now = Date.now()): FormDraft | null {
  if (!raw || raw.length > 150000) return null;
  try {
    const x = JSON.parse(raw);
    if (!x || typeof x.version !== "string" || !Number.isFinite(x.savedAt) || x.savedAt > now + 60000 || now - x.savedAt > DRAFT_TTL || !x.fields || typeof x.fields !== "object") return null;
    const fields: DraftFields = {};
    for (const key of Object.keys(defaults)) {
      if (typeof x.fields[key] !== "string" || x.fields[key].length > 10000) return null;
      fields[key] = x.fields[key];
    }
    return { version: x.version, fields, savedAt: x.savedAt };
  } catch { return null; }
}
