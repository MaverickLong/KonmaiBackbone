import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined) {
    return '–';
  }
  const sign = bytes < 0 ? '-' : '';
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${sign}${value.toFixed(unit === 0 ? 0 : decimals)} ${units[unit]}`;
}

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
