import { Navigate, createBrowserRouter } from 'react-router-dom';

import { authRoutes } from '@/features/auth';
import { curriculumRoutes } from '@/features/curriculum';
import { tutorRoutes } from '@/features/tutor';
import { RequireAuth } from './RequireAuth';
import { StudentLayout } from './layouts/StudentLayout';
import { SectionNav } from './layouts/SectionNav';

/**
 * Each feature owns its own routes.tsx and exports it through its index.ts.
 * Adding a feature is one line here and nothing else in shared code.
 */
export const router = createBrowserRouter([
  ...authRoutes,
  {
    element: <RequireAuth />,
    children: [
      {
        element: <StudentLayout />,
        children: [
          {
            element: <SectionNav />,
            children: [
              ...tutorRoutes,
              ...curriculumRoutes,
              // C1, C2 and C4 mount their own routes here as they are built.
            ],
          },
        ],
      },
    ],
  },
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
