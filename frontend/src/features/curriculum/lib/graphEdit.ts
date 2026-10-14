import type { GraphEdge } from '../api/curriculumApi';

/** Direct prerequisites per concept. */
export function prerequisiteMap(edges: GraphEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of edges) map.set(e.concept_id, [...(map.get(e.concept_id) ?? []), e.prerequisite_id]);
  return map;
}

/** Everything `conceptId` needs, directly or through other concepts. */
export function ancestors(prereqs: Map<string, string[]>, conceptId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...(prereqs.get(conceptId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(prereqs.get(id) ?? []));
  }
  return seen;
}

/** Adding "concept needs prerequisite" loops when the prerequisite already needs the concept. */
export function wouldLoop(
  prereqs: Map<string, string[]>,
  conceptId: string,
  prerequisiteId: string,
): boolean {
  return conceptId === prerequisiteId || ancestors(prereqs, prerequisiteId).has(conceptId);
}

/** A link is redundant when another prerequisite of the concept already needs it. */
export function redundantVia(
  prereqs: Map<string, string[]>,
  conceptId: string,
  prerequisiteId: string,
): string | null {
  for (const other of prereqs.get(conceptId) ?? []) {
    if (other !== prerequisiteId && ancestors(prereqs, other).has(prerequisiteId)) return other;
  }
  return null;
}
