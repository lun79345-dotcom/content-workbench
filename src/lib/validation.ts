import { UserFacingError } from "./action-errors";
export function text(fd: FormData, key: string, required = false, max = 10000): string | null {
  const raw = fd.get(key);
  if (raw != null && typeof raw !== "string") throw new UserFacingError(`${key} 格式不正确`);
  const value = raw?.trim() || null;
  if (required && !value) throw new UserFacingError(`请填写 ${key}`);
  if (value && value.length > max) throw new UserFacingError(`${key} 内容过长`);
  return value;
}
export function number(fd: FormData, key: string, options: { min?: number; max?: number; integer?: boolean; required?: boolean } = {}): number | null {
  const raw = text(fd, key);
  if (raw == null) { if (options.required) throw new UserFacingError(`请填写 ${key}`); return null; }
  return bounded(Number(raw.replace(/[,，\s]/g, "")), key, options);
}
export function bounded(value: number, label: string, { min = 0, max = 1e12, integer = false } = {}) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) throw new UserFacingError(`${label} 数值不正确`);
  return value;
}
export function money(value: number, label = "金额") {
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.000001) throw new UserFacingError(`${label} 最多保留两位小数`);
  return cents / 100;
}
export function id(fd: FormData, key = "id") { return number(fd, key, { min: 1, integer: true, required: true })!; }
export function choice<T extends string>(value: string | null, choices: readonly T[], label: string): T {
  if (!value || !choices.includes(value as T)) throw new UserFacingError(`${label} 选项无效`);
  return value as T;
}
export function date(value: string | null, label = "日期"): string | null {
  if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new UserFacingError(`${label} 不正确`);
  return value;
}
export function month(value: string | null): string {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new UserFacingError("月份不正确");
  return value;
}
export function week(value: string | null): string {
  if (!value || !/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(value)) throw new UserFacingError("周次不正确");
  const [year, n] = value.split("-W").map(Number);
  const d = new Date(Date.UTC(year, 0, 4));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + (n - 1) * 7 + 3);
  if (d.getUTCFullYear() !== year) throw new UserFacingError("该年没有此周次");
  return value;
}
export function url(value: string | null): string | null {
  if (!value) return null;
  const matched = value.match(/https?:\/\/[^\s]+/)?.[0];
  if (!matched) throw new UserFacingError("链接需以 http:// 或 https:// 开头");
  try { if (!new URL(matched).hostname) throw new UserFacingError(); }
  catch { throw new UserFacingError("链接格式不正确"); }
  return matched;
}
