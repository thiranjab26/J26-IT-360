import { useState } from "react";
import { ArrowLeft, BookOpenCheck, LockKeyhole, MessagesSquare, ShieldCheck } from "./icons";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Auth } from "../api/types";
import { Brand, ErrorNotice } from "./components";

/** The lecturer sign-in page: a lecturer or a rater signs in with an access key. */
export default function StaffLogin({
  onSignedIn,
  notice,
  onCloseNotice,
}: {
  onSignedIn: (a: Auth) => void;
  notice: string;
  onCloseNotice: () => void;
}) {
  const [role, setRole] = useState<"admin" | "evaluator">("admin"),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSignedIn(await api<Auth>("/auth/staff", undefined, { role, access_key: key }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="lecturer-login">
      <section className="ll-intro">
        <Brand sub="LECTURER WORKSPACE" onClick={() => undefined} />
        <div>
          <h1>Run vivas that show real understanding.</h1>
          <p>Review every student's viva, manage the questions they are asked, and see where knowledge or communication needs support.</p>
        </div>
        <ul>
          <li>
            <MessagesSquare size={18} /> Every viva, with answers, results and timing
          </li>
          <li>
            <BookOpenCheck size={18} /> Questions written from your course material
          </li>
          <li>
            <ShieldCheck size={18} /> You approve every question before students see it
          </li>
        </ul>
      </section>
      <section className="ll-form">
        <div className="panel">
          <div className="ll-lock">
            <LockKeyhole size={22} />
          </div>
          <h2>Lecturer sign in</h2>
          <p className="muted">Use the access key from your viva administrator.</p>
          <ErrorNotice message={notice || error} onClose={notice ? onCloseNotice : () => setError("")} />
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="staff-role">Sign in as</label>
              <select id="staff-role" value={role} onChange={(e) => setRole(e.target.value as "admin" | "evaluator")}>
                <option value="admin">Lecturer</option>
                <option value="evaluator">Rater (blind review)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="access-key">Access key</label>
              <input
                id="access-key"
                type="password"
                autoComplete="current-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
              />
            </div>
            <button className="button primary full-width" disabled={busy || !key}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
        <Link className="ll-back" to="/viva">
          <ArrowLeft size={15} /> Back to the student page
        </Link>
      </section>
    </div>
  );
}
