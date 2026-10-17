import { lazy, Suspense, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";

// Each page and its styles load only when it is opened, so other AdaptLearn pages
// never download them.
const StudentApp = lazy(() => import("./pages/StudentApp"));
const LecturerApp = lazy(() => import("./pages/LecturerApp"));

const loading = (
  <div
    role="status"
    style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#f6f8fc",
      color: "#62748b",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontSize: 14,
    }}
  >
    Loading…
  </div>
);

const page = (app: ReactNode) => (
  <div className="viva-app">
    <Suspense fallback={loading}>{app}</Suspense>
  </div>
);

/**
 * C4 Intelligent Viva System, mounted by app/router.tsx: students at /viva, lecturers at
 * /viva/lecturer. The viva keeps its own participant and staff login for now, so it sits
 * outside RequireAuth and StudentLayout until it moves to the shared login.
 */
export const vivaRoutes: RouteObject[] = [
  { path: "viva/lecturer/*", element: page(<LecturerApp />) },
  { path: "viva/*", element: page(<StudentApp />) },
];
