import { QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { PublicAppView } from 'konmai-shared';

export const apiBase =
  (import.meta.env['VITE_API_BASE'] as string | undefined)?.replace(/\/+$/, '') ?? '';

const syncingRefetchMilliseconds = 30_000;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`请求失败 (${response.status})`);
  }
  return (await response.json()) as T;
}

const catalogueKey = ['catalogue'];

// The catalogue a page was prerendered with.
export interface CatalogueSnapshot {
  apps: PublicAppView[];
  // Milliseconds since the epoch.
  fetchedAt: number;
  // The backend's name for exactly this catalogue. The next prerender asks about it to learn
  // whether anything has changed.
  etag: string | null;
}

export function createQueryClient(catalogue: CatalogueSnapshot | null): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
  });
  if (catalogue !== null) {
    // Dated as fetched, so that a browser refreshes a catalogue that has aged inside a page.
    queryClient.setQueryData(catalogueKey, catalogue.apps, { updatedAt: catalogue.fetchedAt });
  }
  return queryClient;
}

export function useCatalogue() {
  return useQuery({
    queryKey: catalogueKey,
    queryFn: () => getJson<PublicAppView[]>(`${apiBase}/api/public/apps`),
    // A release that just came in cannot be downloaded until a node has fetched it; keep looking
    // so that someone waiting with the page open sees the button come alive.
    refetchInterval: (query) =>
      query.state.data?.some((app) =>
        app.variants.some((variant) => variant.release.files.some((file) => !file.available)),
      )
        ? syncingRefetchMilliseconds
        : false,
  });
}

const bmsBase = 'https://bms.alvorna.com';

export interface BmsTable {
  diff_table_name: string;
  diff_table_url: string;
}

export interface BmsChart {
  chart_name: string;
  title: string;
  artist: string;
  md5: string;
  song_name: string | null;
  song_url: string | null;
  song_preview_url: string | null;
}

interface BmsSearchPage {
  page: number;
  total_pages: number;
  data: BmsChart[];
}

export function useBmsTables() {
  return useQuery({
    queryKey: ['bms', 'tables'],
    queryFn: async () => (await getJson<{ tables: BmsTable[] }>(`${bmsBase}/api/tables`)).tables,
    staleTime: 3_600_000,
  });
}

export function useBmsSearch(name: string, tableUrl: string) {
  return useInfiniteQuery({
    queryKey: ['bms', 'search', name, tableUrl],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ page: String(pageParam), table: tableUrl, name });
      return getJson<BmsSearchPage>(`${bmsBase}/api/search?${query}`);
    },
    getNextPageParam: (last) => (last.page < last.total_pages ? last.page + 1 : undefined),
  });
}
