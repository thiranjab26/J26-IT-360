import type { RouteObject } from 'react-router-dom';

import { CurriculumHomePage } from './pages/CurriculumHomePage';
import { GainPage } from './pages/GainPage';
import { GraphEditPage } from './pages/GraphEditPage';
import { ModuleProgressPage } from './pages/ModuleProgressPage';
import { PaperEditorPage } from './pages/PaperEditorPage';
import { PracticePage } from './pages/PracticePage';
import { QuestionsPage } from './pages/QuestionsPage';
import { RoadmapPage } from './pages/RoadmapPage';
import { StaffPage } from './pages/StaffPage';
import { TestPage } from './pages/TestPage';

/** Mounted by app/router.tsx inside the authenticated student layout; all under /curriculum. */
export const curriculumRoutes: RouteObject[] = [
  { path: 'curriculum', element: <CurriculumHomePage /> },
  { path: 'curriculum/:moduleId', element: <ModuleProgressPage /> },
  { path: 'curriculum/:moduleId/roadmap', element: <RoadmapPage /> },
  { path: 'curriculum/:moduleId/test/:kind', element: <TestPage /> },
  { path: 'curriculum/:moduleId/practice/:conceptId', element: <PracticePage /> },
  { path: 'curriculum/:moduleId/gain', element: <GainPage /> },
  { path: 'curriculum/:moduleId/staff', element: <StaffPage /> },
  { path: 'curriculum/:moduleId/questions', element: <QuestionsPage /> },
  { path: 'curriculum/:moduleId/graph', element: <GraphEditPage /> },
  { path: 'curriculum/:moduleId/questions/:paperId', element: <PaperEditorPage /> },
];
