import { Navigate, createBrowserRouter } from 'react-router-dom';

import { authRoutes } from '@/features/auth';
import { curriculumRoutes } from '@/features/curriculum';
import { RequireAuth } from './RequireAuth';
import { StudentLayout } from './layouts/StudentLayout';

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
          ...curriculumRoutes,
          // C2, C3 and C4 mount their own routes here as they are built.
        ],
      },
    ],
  },
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
