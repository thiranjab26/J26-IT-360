import type { RouteObject } from 'react-router-dom';

import { DashboardPage } from './pages/DashboardPage';
import { QuestMapPage } from './pages/QuestMapPage';
import { SessionPage } from './pages/SessionPage';

/** Mounted by app/router.tsx inside the authenticated student layout. */
export const tutorRoutes: RouteObject[] = [
  { path: 'dashboard', element: <DashboardPage /> },
  { path: 'modules/:moduleId', element: <QuestMapPage /> },
  { path: 'sessions/:sessionId', element: <SessionPage /> },
];
