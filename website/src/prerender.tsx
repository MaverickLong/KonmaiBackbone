import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ColorSchemeScript } from '@mantine/core';
import type { PublicAppView } from 'konmai-shared';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router';
// The page as the client build leaves it: links to the hashed assets and nothing rendered. This
// script is built right after the client and takes the page along, because the first run renders
// over the file and every later run still needs the empty one.
import template from '../dist/index.html?raw';
import { apiBase, createQueryClient, type CatalogueSnapshot } from './api';
import { prerenderedElementId, type Prerendered } from './prerendered';
import { defaultColorScheme, Providers } from './Providers';
import { pagePaths, routes, siteName, type PageMetadata } from './routes';

// Renders every page to an HTML file the web server hands out as it is, so that nothing is
// rendered per visitor. Run again later, it asks the backend whether the catalogue has changed and
// renders only if it has.

const outputDirectory = fileURLToPath(new URL('../dist/', import.meta.url));

// Browsers reach the backend through the page's own origin when no API base is built in. From here
// that is the backend's own address, the one vite.config.ts proxies to in development.
const backend =
  apiBase !== '' ? apiBase : (process.env['KONMAI_HOST_URL'] ?? 'http://127.0.0.1:3000');

// The site's public origin, for canonical links. Without it they are relative, which still folds
// `?app=` addresses into the page they belong to.
const siteUrl = ((import.meta.env['VITE_SITE_URL'] as string | undefined) ?? '').replace(
  /\/+$/,
  '',
);

// Puts the parts into the page template and renames the result into place, so that the web server
// never reads a half-written page.
async function writePage(
  file: string,
  parts: { head: string; body: string; state: string },
): Promise<void> {
  let page = template;
  for (const [placeholder, content] of [
    ['<!--page-head-->', parts.head],
    ['<!--page-body-->', parts.body],
    ['<!--page-state-->', parts.state],
  ] as const) {
    if (!page.includes(placeholder)) {
      throw new Error(`The page template has no ${placeholder}; build the client first.`);
    }
    // A function, because `$` sequences in a replacement string are expanded.
    page = page.replace(placeholder, () => content);
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.new`, page);
  await rename(`${file}.new`, file);
}

const embedded = new RegExp(
  `<script id="${prerenderedElementId}" type="application/json">(.*?)</script>`,
  's',
).exec(await readFile(join(outputDirectory, 'index.html'), 'utf8'));
const found = embedded === null ? null : (JSON.parse(embedded[1]!) as Prerendered);
// Pages from another build link to assets that no longer exist. A run of the previous build's
// script that overlaps a new build can leave such pages behind; they count as not rendered.
const templateDigest = createHash('sha1').update(template).digest('hex');
const previous = found?.templateDigest === templateDigest ? found : null;

let catalogue: CatalogueSnapshot | null = null;
try {
  const knownEtag = previous?.catalogue?.etag ?? null;
  const response = await fetch(`${backend}/api/public/apps`, {
    headers: knownEtag === null ? {} : { 'if-none-match': knownEtag },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 304) {
    console.log('The catalogue has not changed; the pages stay as they are.');
    process.exit(0);
  }
  if (!response.ok) {
    throw new Error(`the backend answered ${response.status}`);
  }
  const apps = (await response.json()) as PublicAppView[];
  if (!Array.isArray(apps)) {
    throw new Error('the answer is not a catalogue');
  }
  catalogue = { apps, fetchedAt: Date.now(), etag: response.headers.get('etag') };
} catch (error) {
  if (previous !== null) {
    console.error(`No catalogue from ${backend}; the pages stay as they are.`, error);
    process.exit(1);
  }
  // A build must not depend on a running backend. Browsers load the list themselves, and the next
  // run that reaches the backend puts it into the page.
  console.warn(`No catalogue from ${backend}; the home page is rendered without games.`, error);
}

for (const path of pagePaths) {
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(new URL(path, 'http://localhost')));
  if (context instanceof Response) {
    throw new Error(`${path} redirects instead of showing a page.`);
  }
  // Only the home page lists the catalogue; the others would carry it for nothing.
  const prerendered: Prerendered = {
    path,
    catalogue: path === '/' ? catalogue : null,
    templateDigest,
  };
  const { title, description } = context.matches.at(-1)!.route.handle as PageMetadata;
  const head = renderToStaticMarkup(
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={`${siteUrl}${path}`} />
      {/* Sets the colour scheme before the first paint; the stylesheet has no colours without. */}
      <ColorSchemeScript defaultColorScheme={defaultColorScheme} />
    </>,
  );
  const body = renderToString(
    <Providers queryClient={createQueryClient(prerendered.catalogue)}>
      <StaticRouterProvider
        router={createStaticRouter(handler.dataRoutes, context)}
        context={context}
        hydrate={false}
      />
    </Providers>,
  );
  // "<" is escaped so that no text in the catalogue can end the script element.
  const state = `<script id="${prerenderedElementId}" type="application/json">${JSON.stringify(
    prerendered,
  ).replaceAll('<', '\\u003c')}</script>`;
  await writePage(join(outputDirectory, path, 'index.html'), { head, body, state });
}

// What the web server answers an unknown address with: nothing rendered, so the browser renders
// it and the router sends the visitor on, while the answer itself still says 404.
await writePage(join(outputDirectory, '404.html'), {
  head: `<title>${siteName}</title>`,
  body: '',
  state: '',
});

console.log(
  `Rendered ${pagePaths.length} pages, with ${catalogue?.apps.length ?? 'no'} games on the home page.`,
);
