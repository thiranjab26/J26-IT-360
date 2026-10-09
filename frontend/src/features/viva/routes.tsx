import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";

// The viva and its styles load only when /viva is opened, so other AdaptLearn pages
// never download them.
const VivaApp = lazy(() => import("./pages/VivaApp"));

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
    Loading the viva workspace…
  </div>
);

/**
 * C4 Intelligent Viva System. Mounted by app/router.tsx at /viva.
 * The viva keeps its own participant and staff login for now, so it sits outside
 * RequireAuth and StudentLayout until it moves to the shared login.
 */
export const vivaRoutes: RouteObject[] = [
  {
    path: "viva/*",
    element: (
      <div className="viva-app">
        <Suspense fallback={loading}>
          <VivaApp />
        </Suspense>
      </div>
    ),
  },
];
