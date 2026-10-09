import { useState } from "react";
import { ArrowRight, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "../api/client";
import type { Auth, Topic } from "../api/types";
import { Badge, Busy, PageTitle } from "../components/components";

/** Participant sign-in with a pseudonymous code and consent. */
export default function Welcome({
  onSignedIn,
  onError,
  topics,
}: {
  onSignedIn: (a: Auth) => void;
  onError: (s: string) => void;
  topics: Topic[];
}) {
  const [code, setCode] = useState(""),
    [consent, setConsent] = useState(false),
    [loading, setLoading] = useState(false);
  async function join(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      onSignedIn(
        await api<Auth>("/auth/participant", undefined, {
          participant_code: code.trim(),
          consent: true,
        }),
      );
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="C04 · INTELLIGENT VIVA"
        title="Make your understanding visible."
        description="A thoughtful conversation. A clearer picture of what you know."
      />
      <div className="welcome-grid">
        <section className="panel welcome-form">
          <div className="section-heading">
            <div className="square-icon">
              <MessageSquareText size={24} />
            </div>
            <Badge tone="blue">Your space to explain</Badge>
          </div>
          <h2>Welcome to your viva workspace.</h2>
          <p className="muted">
            Begin with a participant code. Choose a topic, explain your
            thinking, and leave with a focused learning plan.
          </p>
          <form onSubmit={join}>
            <div className="field">
              <label htmlFor="participant-code">Participant code</label>
              <input
                id="participant-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. learner-042"
                minLength={3}
                maxLength={64}
                required
                autoComplete="off"
              />
              <p className="field-help">
                Use a pseudonym, not your name or email address.
              </p>
            </div>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
              />
              <span>
                I agree to take part in this research prototype. My answers and
                session evidence will be stored for review. I will not include
                personal information.
              </span>
            </label>
            <button
              className="button primary full-width"
              disabled={!consent || code.trim().length < 3 || loading}
            >
              {loading ? (
                <Busy text="Creating your workspace…" />
              ) : (
                <>
                  Enter workspace
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="welcome-privacy">
            <ShieldCheck size={17} />
            <span>
              A fresh participant identity is created each time you join. This
              browser tab keeps your access token for session history.
            </span>
          </div>
        </section>
        <section className="welcome-story">
          <span className="eyebrow">BEYOND RIGHT OR WRONG</span>
          <h2>
            Good learning begins
            <br />
            with a better
            <br />
            <em>conversation.</em>
          </h2>
          <div className="welcome-orbits" aria-hidden="true">
            <div />
            <div />
            <span>
              <Sparkles size={40} />
            </span>
            <i className="orbit-label label-reason">Reason</i>
            <i className="orbit-label label-reflect">Reflect</i>
            <i className="orbit-label label-connect">Connect</i>
          </div>
          <p>
            Explore a concept. Make connections.
            <br />
            Find your next step.
          </p>
          <div className="topic-tags">
            {topics.slice(0, 4).map((t) => (
              <span key={t.id}>{t.name}</span>
            ))}
          </div>
        </section>
      </div>
      <div className="welcome-bottom">
        <div>
          <span>01</span>
          <strong>Grounded questions</strong>
          <p>Approved concepts from your course.</p>
        </div>
        <div>
          <span>02</span>
          <strong>Adaptive follow-ups</strong>
          <p>Space to clarify and show your reasoning.</p>
        </div>
        <div>
          <span>03</span>
          <strong>Evidence you can use</strong>
          <p>A transparent report and a practical next step.</p>
        </div>
      </div>
    </>
  );
}
