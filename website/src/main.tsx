import '@mantine/core/styles.css';
import './styles.css';
import { createTheme, MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from './routes';

// The old site's accent green, expanded into the ten shades Mantine expects.
const theme = createTheme({
  primaryColor: 'brand',
  colors: {
    brand: [
      '#e6f7ee',
      '#c6ebd8',
      '#a3dfc1',
      '#7fd3aa',
      '#5dc794',
      '#3eaf7c',
      '#339a6b',
      '#28855a',
      '#1d7049',
      '#125b38',
    ],
  },
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
  headings: { fontWeight: '600' },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
