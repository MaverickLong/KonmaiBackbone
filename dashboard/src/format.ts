import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export { formatBytes } from 'konmai-shared';

export const gigabyte = 1_000_000_000;

export function formatDate(value: string | null | undefined): string {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '–';
}

export function formatRelative(value: string | null | undefined): string {
  return value ? dayjs(value).fromNow() : 'never';
}

export function formatCountry(code: string): string {
  try {
    return `${code} · ${new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code}`;
  } catch {
    return code;
  }
}

export const zodErrors = (
  issues: { path: PropertyKey[]; message: string }[],
): Record<string, string> =>
  Object.fromEntries(issues.map((issue) => [issue.path.join('.'), issue.message]));
