import type { PublicAppView } from 'konmai-shared';

export const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

// Apps whose display name does not start with a Latin letter land in the "#" group, matching
// how the old site grouped the catalogue.
export function letterOf(app: PublicAppView): string {
  const first = app.displayName.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

export function groupByLetter(apps: PublicAppView[]): Map<string, PublicAppView[]> {
  const groups = new Map<string, PublicAppView[]>();
  for (const app of [...apps].sort((a, b) => a.displayName.localeCompare(b.displayName, 'en'))) {
    const letter = letterOf(app);
    const group = groups.get(letter) ?? [];
    group.push(app);
    groups.set(letter, group);
  }
  return groups;
}

export function matchesSearch(app: PublicAppView, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') {
    return true;
  }
  return (
    app.displayName.toLowerCase().includes(needle) ||
    app.packageName.toLowerCase().includes(needle) ||
    app.variants.some((variant) => variant.name.toLowerCase().includes(needle))
  );
}
