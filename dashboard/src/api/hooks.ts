import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import type {
  AppView,
  DownloadStatsRow,
  DownloaderView,
  HealthEventView,
  LoginView,
  NodeCreatedView,
  NodeDetailView,
  NodeView,
  OverviewView,
  SyncEventView,
  TrafficStatsRow,
  VariantDetailView,
  VariantView,
} from 'konmai-shared';
import { api, ApiError } from './client';

const livePolling = 15_000;

export const keys = {
  overview: ['overview'] as const,
  nodes: ['nodes'] as const,
  node: (id: number) => ['nodes', id] as const,
  apps: ['apps'] as const,
  app: (packageName: string) => ['apps', packageName] as const,
  variant: (id: number) => ['variants', id] as const,
  downloader: ['downloader'] as const,
  events: (params: object) => ['events', params] as const,
  downloads: (params: object) => ['stats', 'downloads', params] as const,
  traffic: (params: object) => ['stats', 'traffic', params] as const,
};

export function useOverview() {
  return useQuery({
    queryKey: keys.overview,
    queryFn: () => api<OverviewView>('/api/admin/overview'),
    refetchInterval: livePolling,
  });
}

export function useNodes() {
  return useQuery({
    queryKey: keys.nodes,
    queryFn: () => api<NodeView[]>('/api/admin/nodes'),
    refetchInterval: livePolling,
  });
}

export function useNode(id: number) {
  return useQuery({
    queryKey: keys.node(id),
    queryFn: () => api<NodeDetailView>(`/api/admin/nodes/${id}`),
    refetchInterval: livePolling,
  });
}

export function useApps() {
  return useQuery({ queryKey: keys.apps, queryFn: () => api<AppView[]>('/api/admin/apps') });
}

export function useApp(packageName: string) {
  return useQuery({
    queryKey: keys.app(packageName),
    queryFn: () => api<AppView>(`/api/admin/apps/${encodeURIComponent(packageName)}`),
  });
}

export function useVariant(id: number) {
  return useQuery({
    queryKey: keys.variant(id),
    queryFn: () => api<VariantDetailView>(`/api/admin/variants/${id}`),
    refetchInterval: livePolling,
  });
}

export function useDownloader() {
  return useQuery({
    queryKey: keys.downloader,
    queryFn: () => api<DownloaderView>('/api/admin/downloader'),
    refetchInterval: livePolling,
  });
}

export interface EventsParams {
  kind?: 'health' | 'sync';
  nodeId?: number;
  limit?: number;
}

export function useEvents(params: EventsParams) {
  return useQuery({
    queryKey: keys.events(params),
    queryFn: () =>
      api<{ health: HealthEventView[]; sync: SyncEventView[] }>('/api/admin/events', {
        query: { ...params },
      }),
    refetchInterval: livePolling,
  });
}

export interface RangeParams {
  from?: string;
  to?: string;
}

export function useDownloadStats(
  params: RangeParams & { groupBy: 'day' | 'variant' | 'node' | 'country' },
) {
  return useQuery({
    queryKey: keys.downloads(params),
    queryFn: () => api<DownloadStatsRow[]>('/api/admin/stats/downloads', { query: { ...params } }),
  });
}

export function useTrafficStats(
  params: RangeParams & { nodeId?: number; resolution: 'hour' | 'day' },
) {
  return useQuery({
    queryKey: keys.traffic(params),
    queryFn: () => api<TrafficStatsRow[]>('/api/admin/stats/traffic', { query: { ...params } }),
  });
}

function describe(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

// Every mutation reports failures the same way and refreshes the queries it affects.
function useAction<Input, Output>(
  run: (input: Input) => Promise<Output>,
  invalidate: readonly (readonly unknown[])[],
  options: Pick<UseMutationOptions<Output, unknown, Input>, 'onSuccess'> = {},
) {
  const client = useQueryClient();
  return useMutation<Output, unknown, Input>({
    mutationFn: run,
    onSuccess: async (data, variables, context, mutation) => {
      await Promise.all(invalidate.map((key) => client.invalidateQueries({ queryKey: key })));
      await options.onSuccess?.(data, variables, context, mutation);
    },
    onError: (error) =>
      notifications.show({ color: 'red', title: 'Request failed', message: describe(error) }),
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: (password: string) => api<LoginView>('/api/admin/session', { body: { password } }),
  });
}

export const useCreateNode = () =>
  useAction(
    (body: object) => api<NodeCreatedView>('/api/admin/nodes', { body }),
    [keys.nodes, keys.overview],
  );
export const useUpdateNode = (id: number) =>
  useAction(
    (body: object) => api<NodeView>(`/api/admin/nodes/${id}`, { method: 'PATCH', body }),
    [keys.nodes, keys.node(id)],
  );
export const useDeleteNode = () =>
  useAction(
    (id: number) => api<void>(`/api/admin/nodes/${id}`, { method: 'DELETE' }),
    [keys.nodes, keys.overview],
  );
export const useRotateToken = (id: number) =>
  useAction(
    () => api<NodeCreatedView>(`/api/admin/nodes/${id}/token`, { method: 'POST' }),
    [keys.node(id)],
  );
export const useProbeNode = () =>
  useAction(
    (id: number) => api<NodeView>(`/api/admin/nodes/${id}/probe`, { method: 'POST' }),
    [keys.nodes],
  );
export const useResyncNode = () =>
  useAction(
    (id: number) =>
      api<{ delivered: boolean }>(`/api/admin/nodes/${id}/resync`, { method: 'POST' }),
    [keys.nodes],
  );

export const useCreateApp = () =>
  useAction(
    (body: object) => api<AppView>('/api/admin/apps', { body }),
    [keys.apps, keys.overview],
  );
export const useUpdateApp = (packageName: string) =>
  useAction(
    (body: object) =>
      api<AppView>(`/api/admin/apps/${encodeURIComponent(packageName)}`, { method: 'PATCH', body }),
    [keys.apps, keys.app(packageName)],
  );
export const useDeleteApp = () =>
  useAction(
    (packageName: string) =>
      api<void>(`/api/admin/apps/${encodeURIComponent(packageName)}`, { method: 'DELETE' }),
    [keys.apps, keys.overview],
  );
export const useUploadIcon = (packageName: string) =>
  useAction(
    (file: File) => {
      const form = new FormData();
      form.append('icon', file);
      return api<AppView>(`/api/admin/apps/${encodeURIComponent(packageName)}/icon`, {
        method: 'PUT',
        form,
      });
    },
    [keys.apps, keys.app(packageName)],
  );
export const useDeleteIcon = (packageName: string) =>
  useAction(
    () =>
      api<void>(`/api/admin/apps/${encodeURIComponent(packageName)}/icon`, { method: 'DELETE' }),
    [keys.apps, keys.app(packageName)],
  );

export const useCreateVariant = (packageName: string) =>
  useAction(
    (body: object) =>
      api<VariantView>(`/api/admin/apps/${encodeURIComponent(packageName)}/variants`, { body }),
    [keys.apps, keys.app(packageName)],
  );
export const useUpdateVariant = (id: number, packageName: string) =>
  useAction(
    (body: object) =>
      api<VariantDetailView>(`/api/admin/variants/${id}`, { method: 'PATCH', body }),
    [keys.variant(id), keys.app(packageName), keys.apps],
  );
export const useDeleteVariant = (packageName: string) =>
  useAction(
    (id: number) => api<void>(`/api/admin/variants/${id}`, { method: 'DELETE' }),
    [keys.apps, keys.app(packageName)],
  );
export const useCheckVariant = () =>
  useAction(
    (id: number) => api<VariantView>(`/api/admin/variants/${id}/check`, { method: 'POST' }),
    [keys.apps],
  );
export const useCheckAll = () =>
  useAction(
    () => api<{ requested: number }>('/api/admin/variants/check-all', { method: 'POST' }),
    [keys.apps],
  );
export const useDeleteRelease = (variantId: number) =>
  useAction(
    (version: string) =>
      api<void>(`/api/admin/variants/${variantId}/releases/${encodeURIComponent(version)}`, {
        method: 'DELETE',
      }),
    [keys.variant(variantId), keys.apps],
  );
