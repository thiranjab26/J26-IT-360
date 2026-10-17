import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { History as HistoryIcon, LogOut, MessageSquareText } from "../components/icons";
import type { Auth, Report, Session } from "../api/types";
import { Brand, ErrorNotice, Skeleton } from "../components/components";
import { useService, useStoredAuth } from "../hooks/useViva";
import Workspace from "./Workspace";
import Welcome from "./Welcome";
import "../styles/viva.css";
import "../styles/motion.css";
import "../styles/student.css";

const History = lazy(() => import("./History"));
const ReportView = lazy(() => import("./ReportView"));

// Kept from the earlier single page, so a student who is signed in stays signed in.
const STORAGE = "adaptlearn-auth-v1";

/** The student page at /viva: sign in, take a viva, read the report, and see past vivas. */
export default function StudentApp() {
  const [error, setError] = useState("");
  const [auth, setAuth] = useStoredAuth(STORAGE, ["participant"], setError);
  const { topics } = useService(setError, "The viva service is not available right now. Please try again in a few minutes.");
  const [session, setSession] = useState<Session | null>(null),
    [report, setReport] = useState<Report | null>(null),
    [celebrate, setCelebrate] = useState(false);
  const go = useNavigate();
  const page = /\/history\/?$/.test(useLocation().pathname) ? "history" : "viva";
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [page, report?.session_id]);
  function open(next: "viva" | "history") {
    setReport(null);
    setError("");
    go(next === "history" ? "/viva/history" : "/viva");
  }
  function signedIn(value: Auth) {
    setAuth(value);
    setSession(null);
    setReport(null);
    setError("");
  }
  function signOut() {
    window.speechSynthesis?.cancel();
    setAuth(null);
    setSession(null);
    setReport(null);
    go("/viva");
  }
  // fresh: the student has just finished this viva, so the report opens with a celebration.
  function showReport(r: Report, fresh = false) {
    setCelebrate(fresh);
    setReport(r);
    setSession(null);
  }
  const code = auth?.user.participant_code ?? "";
  const tab = (target: "viva" | "history", icon: React.ReactNode, text: string) => (
    <button className="sh-tab" aria-current={page === target && !report ? "page" : undefined} onClick={() => open(target)}>
      {icon}
      {text}
    </button>
  );
  return (
    <div className="student-shell">
      <header className="sh-bar">
        <div className="sh-bar-inner">
          <Brand sub="INTELLIGENT VIVA" onClick={() => open("viva")} />
          {auth && (
            <>
              <nav className="sh-tabs" aria-label="Main">
                {tab("viva", <MessageSquareText size={17} />, "Viva")}
                {tab("history", <HistoryIcon size={17} />, "My vivas")}
              </nav>
              <div className="sh-user">
                <span className="sh-avatar" aria-hidden="true">
                  {code.slice(0, 2).toUpperCase()}
                </span>
                <span className="sh-code">{code}</span>
                <button className="sh-icon" aria-label="Sign out" title="Sign out" onClick={signOut}>
                  <LogOut size={17} />
                </button>
              </div>
            </>
          )}
        </div>
      </header>
      <main id="main-content" className="sh-main">
        <ErrorNotice message={error} onClose={() => setError("")} />
        <div className="view-enter" key={report ? `report-${report.session_id}` : `${page}-${auth?.token ?? "guest"}`}>
          <Suspense fallback={<Skeleton rows={2} height={180} />}>
            {!auth ? (
              <Welcome onSignedIn={signedIn} onError={setError} />
            ) : report ? (
              <ReportView report={report} celebrate={celebrate} token={auth.token} onBack={() => open("viva")} onError={setError} />
            ) : page === "history" ? (
              <History
                auth={auth}
                onResume={(s) => {
                  setSession(s);
                  open("viva");
                }}
                onReport={(r) => showReport(r)}
                onError={setError}
              />
            ) : (
              <Workspace auth={auth} topics={topics} session={session} setSession={setSession} onReport={(r) => showReport(r, true)} onError={setError} />
            )}
          </Suspense>
        </div>
      </main>
      {!auth && (
        <footer className="sh-foot no-print">
          <span>© {new Date().getFullYear()} AdaptLearn</span>
          <Link to="/viva/lecturer">Lecturer sign in</Link>
        </footer>
      )}
    </div>
  );
}
