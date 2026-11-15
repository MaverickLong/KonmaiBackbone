import { Navigate, type RouteObject } from 'react-router';
import { Shell } from './layout/Shell';
import { BmsPage } from './pages/Bms';
import { HomePage } from './pages/Home';
import { LicensesPage } from './pages/Licenses';

export interface PageMetadata {
  title: string;
  description: string;
}

export const siteName = 'Konmai Academy';

// The addresses a visitor can land on. Each one is prerendered into an HTML file of its own, so a
// page missing from this list would be answered with 404.
const pages = [
  {
    path: '/',
    element: <HomePage />,
    title: siteName,
    description: 'Konmai Academy — 音游安装包下载站',
  },
  {
    path: '/bms/download',
    element: <BmsPage />,
    title: `BMS 相关工具 - ${siteName}`,
    description: '按曲名或难度表搜索 BMS 谱面，预览谱面并下载对应的曲包。',
  },
  {
    path: '/license',
    element: <LicensesPage />,
    title: `开源与许可证 - ${siteName}`,
    description: '本站的资源声明，以及所使用的开源软件的许可证。',
  },
];

export const pagePaths = pages.map((page) => page.path);

export const routes: RouteObject[] = [
  {
    element: <Shell />,
    children: [
      ...pages.map(({ path, element, title, description }) => ({
        path,
        element,
        handle: { title, description } satisfies PageMetadata,
      })),
      { path: '/bms', element: <Navigate to="/bms/download" replace /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
