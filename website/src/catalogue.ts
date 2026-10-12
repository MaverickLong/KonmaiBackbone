import { compareNames, nameSortKey, type PublicAppView } from 'konmai-shared';

export const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

// The group follows the sort key, so "osu!droid" sits under O and "D4DJ" under D. Names whose
// first letter is not Latin land in the "#" group, matching how the old site grouped them.
export function letterOf(app: PublicAppView): string {
  const first = nameSortKey(app.displayName).charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

export function groupByLetter(apps: PublicAppView[]): Map<string, PublicAppView[]> {
  const groups = new Map<string, PublicAppView[]>();
  for (const app of [...apps].sort((a, b) => compareNames(a.displayName, b.displayName))) {
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
