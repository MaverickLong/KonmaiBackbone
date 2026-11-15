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

// The old site linked to a game as `/#<game name>`. The text after `#` names an app when it is
// exactly one app's name or package name, as it had to be on the old site, or else when it is a
// search only one app matches.
export function appForHash(apps: PublicAppView[], hash: string): PublicAppView | null {
  let search: string;
  try {
    search = decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    // A stray `%` is not a valid escape sequence.
    return null;
  }
  const needle = search.trim().toLowerCase();
  if (needle === '') {
    return null;
  }
  const exact = apps.filter(
    (app) => app.displayName.toLowerCase() === needle || app.packageName.toLowerCase() === needle,
  );
  const matches = exact.length > 0 ? exact : apps.filter((app) => matchesSearch(app, search));
  return matches.length === 1 ? matches[0]! : null;
}
