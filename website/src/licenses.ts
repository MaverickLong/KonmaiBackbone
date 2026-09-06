// License texts are read straight from the installed packages at build time, so the page can
// never drift from what actually ships.
const files = import.meta.glob(
  [
    '../../node_modules/{react,react-dom,react-router,vite,typescript}/LICENSE*',
    '../../node_modules/@mantine/{core,hooks}/LICENSE*',
    '../../node_modules/@tanstack/react-query/LICENSE*',
    '../../node_modules/@tabler/icons-react/LICENSE*',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const sources: Record<string, string> = {
  react: 'https://github.com/facebook/react',
  'react-dom': 'https://github.com/facebook/react',
  'react-router': 'https://github.com/remix-run/react-router',
  vite: 'https://github.com/vitejs/vite',
  typescript: 'https://github.com/microsoft/TypeScript',
  '@mantine/core': 'https://github.com/mantinedev/mantine',
  '@mantine/hooks': 'https://github.com/mantinedev/mantine',
  '@tanstack/react-query': 'https://github.com/TanStack/query',
  '@tabler/icons-react': 'https://github.com/tabler/tabler-icons',
};

export interface DependencyLicense {
  name: string;
  source: string;
  text: string;
}

export const dependencyLicenses: DependencyLicense[] = Object.entries(files)
  .map(([path, text]) => {
    const name = path.replace(/^.*node_modules\//, '').replace(/\/LICENSE.*$/, '');
    return { name, source: sources[name] ?? '', text: text.trim() };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
