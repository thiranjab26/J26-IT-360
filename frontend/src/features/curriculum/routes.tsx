import type { RouteObject } from 'react-router-dom';

import { DashboardPage } from './pages/DashboardPage';
import { ModuleConceptsPage } from './pages/ModuleConceptsPage';

/** Mounted by app/router.tsx inside the authenticated student layout. */
export const curriculumRoutes: RouteObject[] = [
  { path: 'dashboard', element: <DashboardPage /> },
  { path: 'modules/:moduleId', element: <ModuleConceptsPage /> },
];
