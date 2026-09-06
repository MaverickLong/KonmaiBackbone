import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { PublicAppView } from 'konmai-shared';

const apiBase = (import.meta.env['VITE_API_BASE'] as string | undefined)?.replace(/\/+$/, '') ?? '';

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`请求失败 (${response.status})`);
  }
  return (await response.json()) as T;
}

export function useCatalogue() {
  return useQuery({
    queryKey: ['catalogue'],
    queryFn: () => getJson<PublicAppView[]>(`${apiBase}/api/public/apps`),
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
