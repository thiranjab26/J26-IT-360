import type { RouteObject } from "react-router-dom";
import VivaApp from "./pages/VivaApp";
import "./styles/viva.css";

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
        <VivaApp />
      </div>
    ),
  },
];
