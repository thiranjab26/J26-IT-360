/** viva-service base URL. The viva keeps its own login for now, so it calls the service
 * directly instead of going through the gateway (which only accepts shared-login tokens). */
export const VIVA_API_URL = (import.meta.env.VITE_VIVA_API_URL ?? "http://localhost:8401") + "/api/v1/viva";
const BASE = VIVA_API_URL;
export class ApiError extends Error {
  status: number;
  retryAfter: number | null;
  constructor(message: string, status: number, retryAfter: number | null = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export async function api<T>(
  path: string,
  token?: string,
  body?: unknown,
  method?: string,
  signal?: AbortSignal,
): Promise<T> {
  const form = body instanceof FormData;
  const response = await fetch(BASE + path, {
    signal: signal || AbortSignal.timeout(120000),
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(!form && body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const retry = Number(response.headers.get('Retry-After')) || null;
    const error = await response
      .json()
      .catch(() => ({ detail: "The service could not be reached." }));
    throw new ApiError(
      typeof error.error?.message === "string"
        ? error.error.message + (retry ? ` Try again in ${retry} seconds.` : "")
        : typeof error.detail === "string"
        ? error.detail + (retry ? ` Try again in ${retry} seconds.` : '')
        : JSON.stringify(error.detail),
      response.status,
      retry,
    );
  }
  return response.json();
}
export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function label(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
}
export function date(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
export const gapLabels: Record<string, string> = {
  LIKELY_KNOWLEDGE_GAP: "Likely knowledge gap",
  LIKELY_COMMUNICATION_DIFFICULTY: "Likely communication difficulty",
  MIXED_INSUFFICIENT_EVIDENCE: "Mixed / insufficient evidence",
};
