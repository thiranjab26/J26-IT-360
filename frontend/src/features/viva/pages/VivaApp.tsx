import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  ChevronRight,
  CircleHelp,
  FlaskConical,
  History,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type {
  Auth,
  Health,
  Report,
  Role,
  Session,
  Summary,
  Topic,
} from "../api/types";
import { api, ApiError, date, gapLabels } from "../api/client";
import {
  Badge,
  Busy,
  Empty,
  ErrorNotice,
  Modal,
  PageTitle,
} from "../components/components";
import Workspace from "../pages/Workspace";
import ReportView from "../pages/ReportView";
import { Bank, Research } from "../pages/Staff";
const STORAGE = "adaptlearn-auth-v1";
type View = "workspace" | "history" | "bank" | "research";
export default function App() {
  const [auth, setAuth] = useState<Auth | null>(() => {
      try {
        return JSON.parse(sessionStorage.getItem(STORAGE) || "null");
      } catch {
        return null;
      }
    }),
    [health, setHealth] = useState<Health | null>(null),
    [topics, setTopics] = useState<Topic[]>([]),
    [view, setView] = useState<View>("workspace"),
    [session, setSession] = useState<Session | null>(null),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [staffModal, setStaffModal] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [help, setHelp] = useState(false);
  useEffect(() => {
    api<Health>("/health")
      .then(setHealth)
      .catch(() =>
        setError(
          "The viva service is unavailable. Start the backend on port 8000, then refresh.",
        ),
      );
    api<{ items: Topic[] }>("/topics")
      .then((r) => setTopics(r.items))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!auth) return;
    api<{ user: Auth["user"] }>("/auth/me", auth.token).catch((error) => {
      if (!(error instanceof ApiError) || error.status !== 401) {
        setError(error.message || 'Could not check your sign-in. Please retry.');
        return;
      }
      sessionStorage.removeItem(STORAGE);
      setAuth(null);
      setError("Your sign-in has expired. Please sign in again.");
    });
  }, [auth?.token]);
  function signedIn(value: Auth) {
    sessionStorage.setItem(STORAGE, JSON.stringify(value));
    setAuth(value);
    setStaffModal(false);
    setSession(null);
    setReport(null);
    setError("");
    setView(
      value.user.role === "participant"
        ? "workspace"
        : value.user.role === "admin"
          ? "bank"
          : "research",
    );
  }
  function signOut() {
    sessionStorage.removeItem(STORAGE);
    setAuth(null);
    setSession(null);
    setReport(null);
    setView("workspace");
    window.speechSynthesis?.cancel();
  }
  function navigate(next: View) {
    if (
      (next === "bank" || next === "research") &&
      (!auth || auth.user.role === "participant")
    ) {
      setStaffModal(true);
      return;
    }
    setView(next);
    setReport(null);
    setError("");
    setMobileNav(false);
  }
  function showReport(r: Report) {
    setReport(r);
    setSession(null);
    setView("workspace");
  }
  const staff = auth && auth.user.role !== "participant";
  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("workspace");
          }}
        >
          <span className="brand-symbol">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <path d="M10 27L20 10l10 17-10 6z" />
              <path d="M15 23h10" />
            </svg>
          </span>
          <span>
            AdaptLearn<span className="brand-sub">LEARNING, UNDERSTOOD.</span>
          </span>
        </a>
        <div className="workspace-label">
          RESEARCH WORKSPACE <span>v1.0</span>
        </div>
        <nav aria-label="Main navigation">
          <span className="nav-label">LEARN & REFLECT</span>
          <button
            className={view === "workspace" ? "nav-item selected" : "nav-item"}
            onClick={() => navigate("workspace")}
          >
            <MessageSquareText size={19} />
            Viva workspace
            <span className="nav-active-dot" />
          </button>
          {auth?.user.role !== "evaluator" && (
            <button
              className={view === "history" ? "nav-item selected" : "nav-item"}
              onClick={() => navigate("history")}
            >
              <History size={19} />
              Session history
            </button>
          )}
          <span className="nav-label nav-group">MANAGE & EVALUATE</span>
          {auth?.user.role !== "evaluator" && (
            <button
              className={view === "bank" ? "nav-item selected" : "nav-item"}
              onClick={() => navigate("bank")}
            >
              <BookOpenCheck size={19} />
              Question bank
              {!staff && <LockKeyhole size={13} className="nav-lock" />}
            </button>
          )}
          <button
            className={view === "research" ? "nav-item selected" : "nav-item"}
            onClick={() => navigate("research")}
          >
            <FlaskConical size={19} />
            Research dashboard
            {!staff && <LockKeyhole size={13} className="nav-lock" />}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="research-note">
            <div className="research-note-icon">
              <Sparkles size={17} />
            </div>
            <strong>Built for understanding</strong>
            <p>
              Evidence first.
              <br />
              Learning always.
            </p>
            <span>AdaptLearn · Component 04</span>
          </div>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            About this workspace
            <ChevronRight size={15} />
          </button>
          <div className="sidebar-user">
            <div className="avatar">
              {auth
                ? (auth.user.participant_code || auth.user.role)
                    .slice(0, 2)
                    .toUpperCase()
                : "AL"}
            </div>
            <div>
              <strong>
                {auth
                  ? auth.user.participant_code || "Research staff"
                  : "Your learning space"}
              </strong>
              <span>
                {auth ? auth.user.role : "Join with a participant code"}
              </span>
            </div>
            {auth && (
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={signOut}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span>AdaptLearn</span>
            <ChevronRight size={14} />
            <strong>
              {view === "workspace"
                ? "Intelligent Viva"
                : view === "history"
                  ? "Session history"
                  : view === "bank"
                    ? "Question bank"
                    : "Research"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="environment-label">
              <span className={health ? "dot green-dot" : "dot"} />
              {health
                ? health.demo_mode
                  ? "Local research prototype"
                  : "Research prototype"
                : "Connecting to service"}
            </span>
            {!staff && (
              <button
                className="staff-button"
                onClick={() => setStaffModal(true)}
              >
                <ShieldCheck size={16} />
                Staff sign in
              </button>
            )}
            {staff && <Badge tone="blue">{auth.user.role}</Badge>}
          </div>
        </header>
        <main id="main-content" className="main-content">
          <ErrorNotice message={error} onClose={() => setError("")} />
          {!auth ? (
            <Welcome onSignedIn={signedIn} onError={setError} topics={topics} />
          ) : report ? (
            <ReportView
              report={report}
              token={auth.token}
              onBack={() => {
                setReport(null);
                setSession(null);
              }}
              onError={setError}
            />
          ) : view === "workspace" ? (
            auth.user.role === "participant" ? (
              <Workspace
                auth={auth}
                topics={topics}
                session={session}
                setSession={setSession}
                onReport={showReport}
                onError={setError}
              />
            ) : (
              <StaffWelcome role={auth.user.role} navigate={navigate} />
            )
          ) : view === "history" ? (
            <SessionHistory
              auth={auth}
              onResume={(s) => {
                setSession(s);
                setView("workspace");
              }}
              onReport={showReport}
              onError={setError}
            />
          ) : view === "bank" && auth.user.role === "admin" ? (
            <Bank auth={auth} topics={topics} onError={setError} onTopicsChanged={async () => setTopics((await api<{items: Topic[]}>('/topics')).items)} />
          ) : view === "research" && staff ? (
            <Research auth={auth} onError={setError} />
          ) : (
            <Empty title="Staff access required">
              Sign in with a configured research access key.
            </Empty>
          )}
          <footer className="page-footer">
            <span>
              AdaptLearn C04 <span>·</span> Intelligent Viva
            </span>
            <span>
              {health
                ? `Assessment: ${health.assessment_provider} · Integrations: ${health.integration_mode}`
                : "Research prototype"}
            </span>
          </footer>
        </main>
      </div>
      {staffModal && (
        <StaffLogin
          onClose={() => setStaffModal(false)}
          onSignedIn={signedIn}
        />
      )}{" "}
      {help && (
        <Modal
          title="A clearer picture of understanding"
          onClose={() => setHelp(false)}
        >
          <p>
            AdaptLearn C04 uses course-grounded questions and focused follow-ups
            to explore understanding. Reports distinguish possible knowledge
            gaps from communication difficulty only when the evidence supports
            it.
          </p>
          <div className="notice">
            This is a research prototype. Findings are provisional and require
            human review.
          </div>
          <h3>What powers this workspace</h3>
          <dl className="signal-details">
            <div>
              <dt>Assessment provider</dt>
              <dd>{health?.assessment_provider || "Unavailable"}</dd>
            </div>
            <div>
              <dt>Speech provider</dt>
              <dd>{health?.speech_provider || "Unavailable"}</dd>
            </div>
            <div>
              <dt>Course integrations</dt>
              <dd>{health?.integration_mode || "Unavailable"}</dd>
            </div>
          </dl>
          <p className="small muted">
            Sample integrations are not live student records. Speech is
            optional; unavailable transcription always has a typed fallback.
            Pseudonymous session data is saved by the configured backend. Do not
            enter names or personal information.
          </p>
          <button className="button primary" onClick={() => setHelp(false)}>
            Back to workspace
          </button>
        </Modal>
      )}
    </div>
  );
}
function Welcome({
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
function StaffLogin({
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
function StaffWelcome({
  role,
  navigate,
}: {
  role: Role;
  navigate: (s: View) => void;
}) {
  return (
    <>
      <PageTitle
        eyebrow="STAFF WORKSPACE"
        title="Support better conversations."
        description="Review content and independently evaluate the evidence."
      />
      <div className="two-columns">
        {role === "admin" && (
          <section className="panel">
            <BookOpenCheck size={30} />
            <h2>Question bank</h2>
            <p className="muted">
              Generate drafts, review source grounding, and approve question
              revisions.
            </p>
            <button className="button primary" onClick={() => navigate("bank")}>
              Open question bank
              <ArrowRight size={16} />
            </button>
          </section>
        )}
        <section className="panel">
          <FlaskConical size={30} />
          <h2>Research dashboard</h2>
          <p className="muted">
            Rate blinded evidence and inspect condition-specific study metrics.
          </p>
          <button
            className="button primary"
            onClick={() => navigate("research")}
          >
            Open research
            <ArrowRight size={16} />
          </button>
        </section>
      </div>
    </>
  );
}
function SessionHistory({
  auth,
  onResume,
  onReport,
  onError,
}: {
  auth: Auth;
  onResume: (s: Session) => void;
  onReport: (r: Report) => void;
  onError: (s: string) => void;
}) {
  const [items, setItems] = useState<Summary[]>([]),
    [busy, setBusy] = useState(true),
    [opening, setOpening] = useState("");
  useEffect(() => {
    api<{ items: Summary[] }>("/sessions", auth.token)
      .then((r) => setItems(r.items))
      .catch((e) => onError(e.message))
      .finally(() => setBusy(false));
  }, [auth.token]);
  async function open(s: Summary) {
    setOpening(s.id);
    try {
      if (s.status === "completed")
        onReport(await api<Report>(`/sessions/${s.id}/report`, auth.token));
      else onResume(await api<Session>(`/sessions/${s.id}`, auth.token));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setOpening("");
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="YOUR LEARNING JOURNEY"
        title="Every conversation counts."
        description="Pick up where you left off, or revisit the evidence behind a past session."
      />
      {busy ? (
        <Busy />
      ) : items.length ? (
        <div className="history-list">
          {items.map((s) => (
            <article className="panel history-card" key={s.id}>
              <div className="square-icon">
                <BookOpen size={23} />
              </div>
              <div className="history-info">
                <div className="tag-row">
                  <h2>{s.topic}</h2>
                  <Badge tone={s.status === "active" ? "blue" : "green"}>
                    {s.status === "active" ? "In progress" : "Completed"}
                  </Badge>
                </div>
                <p className="small muted">
                  {date(s.created_at)} · {s.turn_count} answers
                  {s.outcome ? ` · ${gapLabels[s.outcome] || s.outcome}` : ""}
                </p>
              </div>
              <button
                className="button secondary"
                disabled={!!opening}
                onClick={() => open(s)}
              >
                {opening === s.id
                  ? "Opening…"
                  : s.status === "active"
                    ? "Resume session"
                    : "View report"}
                <ArrowRight size={16} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={<History size={30} />}
          title="Your first conversation is ahead"
        >
          Start a viva from the workspace. Your saved sessions and reports will
          appear here.
        </Empty>
      )}
    </>
  );
}
