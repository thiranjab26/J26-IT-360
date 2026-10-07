import { Navigate, createBrowserRouter } from 'react-router-dom';

import { authRoutes } from '@/features/auth';
import { tutorRoutes } from '@/features/tutor';
import { vivaRoutes } from '@/features/viva';
import { RequireAuth } from './RequireAuth';
import { StudentLayout } from './layouts/StudentLayout';

/**
 * Each feature owns its own routes.tsx and exports it through its index.ts.
 * Adding a feature is one line here and nothing else in shared code.
 */
export const router = createBrowserRouter([
  ...authRoutes,
  // C4 viva uses its own login for now, so it is mounted outside RequireAuth.
  ...vivaRoutes,
  {
    element: <RequireAuth />,
    children: [
      {
        element: <StudentLayout />,
        children: [
          ...tutorRoutes,
          // C1, C2 and C4 mount their own routes here as they are built.
        ],
      },
    ],
  },
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
