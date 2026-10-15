import type { RouteObject } from 'react-router-dom';

import { DashboardPage } from './pages/DashboardPage';
import { PracticalPage } from './pages/PracticalPage';
import { PracticalsPage } from './pages/PracticalsPage';
import { ProfilePage } from './pages/ProfilePage';
import { QuestMapPage } from './pages/QuestMapPage';
import { SessionPage } from './pages/SessionPage';

/** Mounted by app/router.tsx inside the authenticated student layout. */
export const tutorRoutes: RouteObject[] = [
  { path: 'dashboard', element: <DashboardPage /> },
  { path: 'modules/:moduleId', element: <QuestMapPage /> },
  { path: 'sessions/:sessionId', element: <SessionPage /> },
  { path: 'practicals', element: <PracticalsPage /> },
  { path: 'practicals/:practicalId', element: <PracticalPage /> },
  { path: 'profile', element: <ProfilePage /> },
];
