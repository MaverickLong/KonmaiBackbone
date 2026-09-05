import { createBrowserRouter, Navigate } from 'react-router';
import { Shell } from './layout/Shell';
import { AppDetailPage } from './pages/AppDetail';
import { AppsPage } from './pages/Apps';
import { DownloaderPage } from './pages/Downloader';
import { DownloadsPage } from './pages/Downloads';
import { LoginPage } from './pages/Login';
import { NodeDetailPage } from './pages/NodeDetail';
import { NodesPage } from './pages/Nodes';
import { OverviewPage } from './pages/Overview';
import { VariantPage } from './pages/Variant';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'nodes', element: <NodesPage /> },
      { path: 'nodes/:id', element: <NodeDetailPage /> },
      { path: 'apps', element: <AppsPage /> },
      { path: 'apps/:packageName', element: <AppDetailPage /> },
      { path: 'variants/:id', element: <VariantPage /> },
      { path: 'downloads', element: <DownloadsPage /> },
      { path: 'downloader', element: <DownloaderPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
