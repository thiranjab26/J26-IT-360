import { useState } from "react";
import { ArrowRight, ClipboardCheck, MessagesSquare, Mic, ShieldCheck } from "../components/icons";
import { api } from "../api/client";
import type { Auth } from "../api/types";
import { Busy } from "../components/components";
import { ExaminerPortrait } from "../components/Examiner";

/** The student sign-in page: a participant code and consent. */
export default function Welcome({ onSignedIn, onError }: { onSignedIn: (a: Auth) => void; onError: (s: string) => void }) {
  const [code, setCode] = useState(""),
    [consent, setConsent] = useState(false),
    [loading, setLoading] = useState(false);
  async function join(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      onSignedIn(await api<Auth>("/auth/participant", undefined, { participant_code: code.trim(), consent: true }));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="st st-welcome">
      <section className="st-welcome-intro">
        <div className="st-eyebrow">Intelligent Viva</div>
        <h1>Practise explaining what you know, out loud.</h1>
        <p className="st-muted st-lead">
          A short spoken viva on your course. Each follow-up question builds on your own answer, and you finish with a clear report and next
          steps.
        </p>
        <ul className="st-features">
          <li>
            <span className="st-icon">
              <Mic size={19} />
            </span>
            <span>
              <strong>Answer out loud</strong>
              <span className="st-muted st-small">Each question is read to you. Speak your answer, or type it if you prefer.</span>
            </span>
          </li>
          <li>
            <span className="st-icon">
              <MessagesSquare size={19} />
            </span>
            <span>
              <strong>Follow-ups that listen</strong>
              <span className="st-muted st-small">The next question picks up on what you said, so you can show more.</span>
            </span>
          </li>
          <li>
            <span className="st-icon">
              <ClipboardCheck size={19} />
            </span>
            <span>
              <strong>A report you can use</strong>
              <span className="st-muted st-small">See what came through, what to revisit, and a short plan to improve.</span>
            </span>
          </li>
        </ul>
      </section>
      <section className="st-card st-signin">
        <ExaminerPortrait />
        <div>
          <h2>Sign in to start</h2>
          <p className="st-muted st-small">Enter the participant code your lecturer gave you.</p>
        </div>
        <form onSubmit={join}>
          <label className="st-field" htmlFor="participant-code">
            <span className="st-label">Participant code</span>
            <input
              id="participant-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Your code"
              minLength={3}
              maxLength={64}
              required
              autoComplete="off"
              autoFocus
            />
          </label>
          <label className="st-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
            <span className="st-small">
              I agree that my answers and their timing are saved so my lecturer can review them. I will not include personal information.
            </span>
          </label>
          <button className="st-btn st-btn-primary" disabled={!consent || code.trim().length < 3 || loading}>
            {loading ? (
              <Busy text="Signing in…" />
            ) : (
              <>
                Continue <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
        <p className="st-privacy st-small st-muted">
          <ShieldCheck size={16} /> Use your code only: never your name, email or student ID.
        </p>
      </section>
    </div>
  );
}
