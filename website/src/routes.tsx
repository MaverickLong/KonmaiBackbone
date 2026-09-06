import { createBrowserRouter, Navigate } from 'react-router';
import { Shell } from './layout/Shell';
import { BmsPage } from './pages/Bms';
import { HomePage } from './pages/Home';
import { LicensesPage } from './pages/Licenses';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'bms', element: <Navigate to="/bms/download" replace /> },
      { path: 'bms/download', element: <BmsPage /> },
      { path: 'license', element: <LicensesPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
