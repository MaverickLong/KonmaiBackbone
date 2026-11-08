// Decimal units: hosting providers meter bandwidth that way and the quota form takes gigabytes.
const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined) {
    return '–';
  }
  const sign = bytes < 0 ? '-' : '';
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${sign}${value.toFixed(unit === 0 ? 0 : decimals)} ${units[unit]}`;
}
