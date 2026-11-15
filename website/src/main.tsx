import '@mantine/core/styles.css';
import './styles.css';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { createBrowserRouter, matchPath } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { createQueryClient } from './api';
import { prerenderedElementId, type Prerendered } from './prerendered';
import { Providers } from './Providers';
import { routes } from './routes';

const embedded = document.getElementById(prerenderedElementId);
const prerendered = embedded === null ? null : (JSON.parse(embedded.textContent) as Prerendered);

const application = (
  <Providers queryClient={createQueryClient(prerendered?.catalogue ?? null)}>
    <RouterProvider router={createBrowserRouter(routes)} />
  </Providers>
);
const container = document.getElementById('root')!;
// For an address it has no page for, the web server answers with one made for something else:
// normally the 404 page, which has nothing rendered in it. Only markup rendered for this very
// address can be taken over, anything else is replaced.
if (prerendered !== null && matchPath(prerendered.path, location.pathname) !== null) {
  hydrateRoot(container, application);
} else {
  createRoot(container).render(application);
}
