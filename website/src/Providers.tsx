import { createTheme, MantineProvider } from '@mantine/core';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';

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

export const defaultColorScheme = 'auto';

// The browser and the prerender each put their own router inside this, so that the markup one
// renders is the markup the other expects.
export function Providers({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <StrictMode>
      <MantineProvider theme={theme} defaultColorScheme={defaultColorScheme}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MantineProvider>
    </StrictMode>
  );
}
