import { lazy, Suspense, useEffect, useState } from "react";
import {
  AudioLines,
  BookOpenCheck,
  ChevronRight,
  CircleHelp,
  FlaskConical,
  History as HistoryIcon,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Auth, Health, Report, Session, Topic } from "../api/types";
import { api, ApiError, VIVA_API_URL } from "../api/client";
import { Badge, Empty, ErrorNotice, Modal, Skeleton } from "../components/components";
import StaffLogin from "../components/StaffLogin";
import { providerName } from "../hooks/useSpeech";
import Workspace from "../pages/Workspace";
import Welcome from "../pages/Welcome";
import History from "../pages/History";
import "../styles/viva.css";
import "../styles/motion.css";

// Staff-only pages and the report load on first use, so students download less.
const ReportView = lazy(() => import("../pages/ReportView"));
const StaffHome = lazy(() => import("../pages/StaffHome"));
const Bank = lazy(() => import("../pages/Bank"));
const Research = lazy(() => import("../pages/Research"));
const SpeechLab = lazy(() => import("../pages/SpeechLab"));

const STORAGE = "adaptlearn-auth-v1";
type View = "workspace" | "history" | "bank" | "research" | "lab";
const STAFF_VIEWS: View[] = ["bank", "research", "lab"];

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
          `The viva service is unavailable at ${VIVA_API_URL.replace(/\/api\/v1\/viva$/, "")}. Start viva-service (port 8401), then refresh.`,
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
        setError(error.message || "Could not check your sign-in. Please retry.");
        return;
      }
      sessionStorage.removeItem(STORAGE);
      setAuth(null);
      setError("Your sign-in has expired. Please sign in again.");
    });
  }, [auth?.token]);
  // A new page starts at the top, as a normal page load would.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view, report?.session_id]);
  function signedIn(value: Auth) {
    sessionStorage.setItem(STORAGE, JSON.stringify(value));
    setAuth(value);
    setStaffModal(false);
    setSession(null);
    setReport(null);
    setError("");
    setView(value.user.role === "evaluator" ? "research" : "workspace");
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
    if (STAFF_VIEWS.includes(next) && (!auth || auth.user.role === "participant")) {
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
  }
  const role = auth?.user.role;
  const staff = !!auth && role !== "participant";
  const titles: Record<View, string> = {
    workspace: staff ? "Overview" : "Intelligent Viva",
    history: "Session history",
    bank: "Question bank",
    research: "Research",
    lab: "Speech lab",
  };
  const navItem = (target: View, icon: React.ReactNode, text: string, locked = false) => (
    <button className={view === target && !report ? "nav-item selected" : "nav-item"} onClick={() => navigate(target)} aria-current={view === target ? "page" : undefined}>
      {icon}
      {text}
      {target === "workspace" && <span className="nav-active-dot" />}
      {locked && <LockKeyhole size={13} className="nav-lock" />}
    </button>
  );
  const fallback = <Skeleton rows={2} height={180} />;
  return (
    <div className="app-shell">
      {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
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
          RESEARCH WORKSPACE <span>v1.1</span>
        </div>
        <nav aria-label="Main navigation">
          <span className="nav-label">{staff ? "WORKSPACE" : "LEARN & REFLECT"}</span>
          {navItem("workspace", staff ? <LayoutDashboard size={19} /> : <MessageSquareText size={19} />, staff ? "Overview" : "Viva workspace")}
          {role !== "evaluator" && navItem("history", <HistoryIcon size={19} />, "Session history")}
          <span className="nav-label nav-group">MANAGE & EVALUATE</span>
          {role !== "evaluator" && navItem("bank", <BookOpenCheck size={19} />, "Question bank", !staff)}
          {role !== "evaluator" && navItem("lab", <AudioLines size={19} />, "Speech lab", !staff)}
          {navItem("research", <FlaskConical size={19} />, "Research dashboard", !staff)}
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
            <div className="avatar">{auth ? (auth.user.participant_code || auth.user.role).slice(0, 2).toUpperCase() : "AL"}</div>
            <div>
              <strong>{auth ? auth.user.participant_code || "Research staff" : "Your learning space"}</strong>
              <span>{auth ? auth.user.role : "Join with a participant code"}</span>
            </div>
            {auth && (
              <button className="icon-button" aria-label="Sign out" onClick={signOut}>
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}>
              <Menu size={20} />
            </button>
            <span>AdaptLearn</span>
            <ChevronRight size={14} />
            <strong>{report ? "Report" : titles[view]}</strong>
          </div>
          <div className="topbar-right">
            <span className="environment-label">
              <span className={health ? "dot green-dot" : "dot"} />
              {health ? (health.demo_mode ? "Local research prototype" : "Research prototype") : "Connecting to service"}
            </span>
            {!staff && (
              <button className="staff-button" onClick={() => setStaffModal(true)}>
                <ShieldCheck size={16} />
                Staff sign in
              </button>
            )}
            {staff && <Badge tone="blue">{role}</Badge>}
          </div>
        </header>
        <main id="main-content" className="main-content">
          <ErrorNotice message={error} onClose={() => setError("")} />
          <div className="view-enter" key={report ? `report-${report.session_id}` : `${view}-${auth?.token ?? "guest"}`}>
            <Suspense fallback={fallback}>
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
                role === "participant" ? (
                  <Workspace auth={auth} topics={topics} session={session} setSession={setSession} onReport={showReport} onError={setError} />
                ) : (
                  <StaffHome auth={auth} navigate={navigate} onReport={showReport} onError={setError} />
                )
              ) : view === "history" ? (
                <History
                  auth={auth}
                  onResume={(s) => {
                    setSession(s);
                    setView("workspace");
                  }}
                  onReport={showReport}
                  onError={setError}
                />
              ) : view === "bank" && role === "admin" ? (
                <Bank auth={auth} topics={topics} onError={setError} onTopicsChanged={async () => setTopics((await api<{ items: Topic[] }>("/topics")).items)} />
              ) : view === "lab" && role === "admin" ? (
                <SpeechLab auth={auth} onError={setError} />
              ) : view === "research" && staff ? (
                <Research auth={auth} onError={setError} />
              ) : (
                <Empty title="Staff access required">Sign in with a configured research access key.</Empty>
              )}
            </Suspense>
          </div>
          <footer className="page-footer">
            <span>
              AdaptLearn C04 <span>·</span> Intelligent Viva
            </span>
            <span>
              {health
                ? `Assessment: ${health.assessment_provider} · Live speech: ${providerName(health.live_speech_provider) || "off"} · Voice: ${providerName(health.voice_provider) || "browser"} · Integrations: ${health.integration_mode}`
                : "Research prototype"}
            </span>
          </footer>
        </main>
      </div>
      {staffModal && <StaffLogin onClose={() => setStaffModal(false)} onSignedIn={signedIn} />}
      {help && (
        <Modal title="A clearer picture of understanding" onClose={() => setHelp(false)}>
          <p>
            AdaptLearn C04 uses course-grounded questions and focused follow-ups to explore understanding. Reports distinguish possible knowledge gaps
            from communication difficulty only when the evidence supports it.
          </p>
          <div className="notice">This is a research prototype. Findings are provisional and require human review.</div>
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
              <dt>Live transcription</dt>
              <dd>{providerName(health?.live_speech_provider) || "Off"}</dd>
            </div>
            <div>
              <dt>Question voice</dt>
              <dd>{providerName(health?.voice_provider) || "Browser voice"}</dd>
            </div>
            <div>
              <dt>Course integrations</dt>
              <dd>{health?.integration_mode || "Unavailable"}</dd>
            </div>
          </dl>
          <p className="small muted">
            Sample integrations are not live student records. Speech is optional; unavailable transcription always has a typed fallback. Pseudonymous
            session data is saved by the configured backend. Do not enter names or personal information.
          </p>
          <button className="button primary" onClick={() => setHelp(false)}>
            Back to workspace
          </button>
        </Modal>
      )}
    </div>
  );
}
