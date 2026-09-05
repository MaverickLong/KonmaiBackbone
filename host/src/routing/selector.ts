export interface Candidate {
  id: number;
  countries: string[];
  catchAll: boolean;
  weight: number;
}

// Country match first, then catch-all nodes, then anyone holding the file. Within a group the
// pick is weighted-random so a stronger node can take more traffic.
export function selectNode<T extends Candidate>(
  candidates: T[],
  country: string | null,
  random: () => number = Math.random,
): T | null {
  const groups = [
    country === null ? [] : candidates.filter((candidate) => candidate.countries.includes(country)),
    candidates.filter((candidate) => candidate.catchAll),
    candidates,
  ];
  const group = groups.find((members) => members.length > 0);
  if (group === undefined) {
    return null;
  }
  const totalWeight = group.reduce((sum, candidate) => sum + candidate.weight, 0);
  let roll = random() * totalWeight;
  for (const candidate of group) {
    roll -= candidate.weight;
    if (roll < 0) {
      return candidate;
    }
  }
  return group[group.length - 1]!;
}
