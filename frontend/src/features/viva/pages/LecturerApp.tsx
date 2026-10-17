import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  AudioLines,
  BookOpenCheck,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
} from "../components/icons";
import type { Auth, Context, Report, Session } from "../api/types";
import { api, VIVA_API_URL } from "../api/client";
import { Badge, Brand, Empty, ErrorNotice, Skeleton } from "../components/components";
import StaffLogin from "../components/StaffLogin";
import { useService, useStoredAuth } from "../hooks/useViva";
import "../styles/viva.css";
import "../styles/motion.css";

const StaffHome = lazy(() => import("./StaffHome"));
const History = lazy(() => import("./History"));
const ReportView = lazy(() => import("./ReportView"));
const Bank = lazy(() => import("./Bank"));
const SpeechLab = lazy(() => import("./SpeechLab"));
const Research = lazy(() => import("./Research"));

const STORAGE = "adaptlearn-staff-auth-v1";
export type LecturerPage = "overview" | "vivas" | "bank" | "lab" | "research";
const PATHS: Record<LecturerPage, string> = {
  overview: "",
  vivas: "vivas",
  bank: "questions",
  lab: "speech-lab",
  research: "research",
};
const ADMIN_ONLY: LecturerPage[] = ["vivas", "bank", "lab"];

/** The lecturer page at /viva/lecturer: overview, student vivas, the question bank and research tools. */
export default function LecturerApp() {
  const [error, setError] = useState("");
  const [auth, setAuth] = useStoredAuth(STORAGE, ["admin", "evaluator"], setError);
  const { health, status, topics, reloadTopics } = useService(
    setError,
    `The viva service is not reachable at ${VIVA_API_URL.replace(/\/api\/v1\/viva$/, "")}. Start viva-service on port 8401, then refresh.`,
  );
  const [report, setReport] = useState<{ report: Report; participant?: string; context: Context | null } | null>(null),
    [mobileNav, setMobileNav] = useState(false);
  const go = useNavigate();
  const segment = useLocation().pathname.split("/lecturer")[1]?.replace(/^\/+|\/+$/g, "") ?? "";
  const page = (Object.keys(PATHS) as LecturerPage[]).find((p) => PATHS[p] === segment) ?? "overview";
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [page, report?.report.session_id]);
  const admin = auth?.user.role === "admin";
  function open(next: LecturerPage) {
    setReport(null);
    setError("");
    setMobileNav(false);
    go(`/viva/lecturer${PATHS[next] ? `/${PATHS[next]}` : ""}`);
  }
  function signedIn(value: Auth) {
    setAuth(value);
    setReport(null);
    setError("");
    open("overview");
  }
  function signOut() {
    setAuth(null);
    setReport(null);
    go("/viva/lecturer");
  }
  // A student's report, with the learning context (C1 to C3) saved when their viva started.
  function showReport(r: Report, participant?: string) {
    setReport({ report: r, participant, context: null });
    if (!auth) return;
    api<Session>(`/sessions/${r.session_id}`, auth.token)
      .then((s) => setReport((now) => (now?.report.session_id === r.session_id ? { ...now, context: s.integration_context } : now)))
      .catch(() => undefined); // the report still shows without the context panel
  }
  if (!auth) return <StaffLogin onSignedIn={signedIn} notice={error} onCloseNotice={() => setError("")} />;
  const titles: Record<LecturerPage, string> = {
    overview: admin ? "Overview" : "Rating queue",
    vivas: "Student vivas",
    bank: "Question bank",
    lab: "Speech lab",
    research: admin ? "Research" : "Blind review",
  };
  const navItem = (target: LecturerPage, icon: React.ReactNode) => (
    <button className={page === target && !report ? "nav-item selected" : "nav-item"} onClick={() => open(target)} aria-current={page === target ? "page" : undefined}>
      {icon}
      {titles[target]}
    </button>
  );
  const blocked = !admin && ADMIN_ONLY.includes(page);
  return (
    <div className="app-shell lecturer-shell">
      {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <Brand sub="LECTURER WORKSPACE" onClick={() => open("overview")} />
        <nav aria-label="Main navigation">
          <span className="nav-label">{admin ? "TEACHING" : "REVIEW"}</span>
          {navItem("overview", <LayoutDashboard size={19} />)}
          {admin && navItem("vivas", <MessagesSquare size={19} />)}
          {admin && navItem("bank", <BookOpenCheck size={19} />)}
          <span className="nav-label nav-group">ANALYSIS</span>
          {admin && navItem("lab", <AudioLines size={19} />)}
          {navItem("research", <FlaskConical size={19} />)}
        </nav>
        <div className="sidebar-bottom">
          <Link className="nav-item" to="/viva" target="_blank">
            Open the student page
            <ExternalLink size={15} />
          </Link>
          <div className="sidebar-user">
            <div className="avatar">{admin ? "LE" : "RA"}</div>
            <div>
              <strong>{admin ? "Lecturer" : "Rater"}</strong>
              <span>Signed in</span>
            </div>
            <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={signOut}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}>
              <Menu size={20} />
            </button>
            <span>{admin ? "Lecturer" : "Review"}</span>
            <ChevronRight size={14} />
            <strong>{report ? "Student report" : titles[page]}</strong>
          </div>
          <div className="topbar-right">
            <span className="environment-label">
              <span className={status === "online" ? "dot green-dot" : status === "offline" ? "dot red-dot" : "dot grey-dot"} />
              {status === "online" ? "Service online" : status === "offline" ? "Service offline" : "Connecting…"}
            </span>
            <Badge tone="blue">{admin ? "Lecturer" : "Rater"}</Badge>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <ErrorNotice message={error} onClose={() => setError("")} />
          <div className="view-enter" key={report ? `report-${report.report.session_id}` : `${page}-${auth.token}`}>
            <Suspense fallback={<Skeleton rows={2} height={180} />}>
              {report ? (
                <ReportView
                  report={report.report}
                  token={auth.token}
                  staff={{ participant: report.participant, context: report.context }}
                  onBack={() => setReport(null)}
                  onError={setError}
                />
              ) : blocked ? (
                <Empty title="Lecturer access needed">This page is for lecturers. Sign in with a lecturer key to open it.</Empty>
              ) : page === "vivas" ? (
                <History auth={auth} staff onResume={() => undefined} onReport={showReport} onError={setError} />
              ) : page === "bank" ? (
                <Bank auth={auth} topics={topics} onError={setError} onTopicsChanged={reloadTopics} />
              ) : page === "lab" ? (
                <SpeechLab auth={auth} onError={setError} />
              ) : page === "research" ? (
                <Research auth={auth} onError={setError} />
              ) : (
                <StaffHome auth={auth} health={health} navigate={open} onReport={showReport} onError={setError} />
              )}
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
