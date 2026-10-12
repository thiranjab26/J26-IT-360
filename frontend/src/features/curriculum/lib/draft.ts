/**
 * Unsent test answers kept in this browser, so a reload does not lose them.
 * Only a convenience: the server never reads it, and it may be unavailable.
 */
export type Draft = Record<string, number>;

function key(userId: string, moduleId: string, kind: string): string {
  return `c1:test-draft:${userId}:${moduleId}:${kind}`;
}

export function loadDraft(userId: string, moduleId: string, kind: string): Draft {
  try {
    const raw = localStorage.getItem(key(userId, moduleId, kind));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => Number.isInteger(value)),
    ) as Draft;
  } catch {
    return {};
  }
}

export function saveDraft(userId: string, moduleId: string, kind: string, draft: Draft): void {
  try {
    localStorage.setItem(key(userId, moduleId, kind), JSON.stringify(draft));
  } catch {
    // Storage full or blocked: answers still live in memory until submit.
  }
}

export function clearDraft(userId: string, moduleId: string, kind: string): void {
  try {
    localStorage.removeItem(key(userId, moduleId, kind));
  } catch {
    // Nothing to clear.
  }
}
