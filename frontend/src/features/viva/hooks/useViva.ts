import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Auth, Health, Role, Topic } from "../api/types";

/**
 * A sign-in kept for this browser tab only. The student and lecturer pages use different
 * keys, so signing in on one never signs you in (or out) on the other.
 */
export function useStoredAuth(key: string, roles: Role[], onError: (s: string) => void) {
  const [auth, setAuth] = useState<Auth | null>(() => {
    try {
      const value: Auth | null = JSON.parse(sessionStorage.getItem(key) || "null");
      return value && roles.includes(value.user.role) ? value : null;
    } catch {
      return null;
    }
  });
  function save(value: Auth | null) {
    try {
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    } catch {
      // Storage can be blocked (private mode); the sign-in then lasts until the page reloads.
    }
    setAuth(value);
  }
  useEffect(() => {
    if (!auth) return;
    api<{ user: Auth["user"] }>("/auth/me", auth.token).catch((error) => {
      if (!(error instanceof ApiError) || error.status !== 401) {
        onError(error.message || "Could not check your sign-in. Please try again.");
        return;
      }
      save(null);
      onError("Your sign-in has expired. Please sign in again.");
    });
  }, [auth?.token]);
  return [auth, save] as const;
}

export type ServiceStatus = "connecting" | "online" | "offline";

/** The service health and the topic list, loaded once when a page opens. */
export function useService(onError: (s: string) => void, offlineMessage: string) {
  const [health, setHealth] = useState<Health | null>(null),
    [status, setStatus] = useState<ServiceStatus>("connecting"),
    [topics, setTopics] = useState<Topic[]>([]);
  const reloadTopics = async () => setTopics((await api<{ items: Topic[] }>("/topics")).items);
  useEffect(() => {
    api<Health>("/health")
      .then((h) => {
        setHealth(h);
        setStatus("online");
        return reloadTopics().catch((e) => onError(e.message));
      })
      .catch(() => {
        setStatus("offline");
        onError(offlineMessage);
      });
  }, []);
  return { health, status, topics, reloadTopics };
}
