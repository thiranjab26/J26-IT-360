import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { api } from "../api/client";
import type { Auth } from "../api/types";
import { ErrorNotice, Modal } from "./components";

/** Admin or evaluator sign-in with a configured access key. */
export default function StaffLogin({
  onClose,
  onSignedIn,
}: {
  onClose: () => void;
  onSignedIn: (a: Auth) => void;
}) {
  const [role, setRole] = useState<"admin" | "evaluator">("admin"),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onSignedIn(
        await api<Auth>("/auth/staff", undefined, { role, access_key: key }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Staff workspace sign in" onClose={onClose}>
      <p className="muted">
        Use an access key configured by your research administrator.
      </p>
      <ErrorNotice message={error} />
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="staff-role">Workspace role</label>
          <select
            id="staff-role"
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "evaluator")}
          >
            <option value="admin">Administrator · content and research</option>
            <option value="evaluator">
              Evaluator · blind ratings and research
            </option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="access-key">Staff access key</label>
          <input
            id="access-key"
            type="password"
            autoComplete="current-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
        </div>
        <button className="button primary" disabled={busy || !key}>
          <LockKeyhole size={16} />
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </Modal>
  );
}
