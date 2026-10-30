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

export function formatInterval(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    return minutes === 1440 ? '1 day' : `${minutes / 1440} days`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest} min`;
  }
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
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
