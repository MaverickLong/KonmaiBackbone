import type { FileKind, ReleaseState, Source } from './catalogue.js';
import type { SyncOutcome } from './protocol.js';

export type NodeStatus = 'online' | 'faulty' | 'unknown';
export type CheckStatus = 'up_to_date' | 'updated' | 'failed';
export type DownloaderPhase = 'idle' | 'checking' | 'downloading';

export interface SessionView {
  subject: string;
  expiresAt: string;
}

export interface LoginView extends SessionView {
  token: string;
}

export interface ReleaseFileView {
  id: number;
  fileName: string;
  kind: FileKind;
  sizeBytes: number;
  sha256: string;
  url: string;
  holders: number[];
}

export interface ReleaseView {
  id: number;
  version: string;
  versionCode: number | null;
  state: ReleaseState;
  sizeBytes: number;
  createdAt: string;
  activatedAt: string | null;
  files: ReleaseFileView[];
}

export interface VariantView {
  id: number;
  packageName: string;
  slug: string;
  name: string;
  source: Source;
  enabled: boolean;
  checkRequestedAt: string | null;
  lastCheckedAt: string | null;
  lastCheckStatus: CheckStatus | null;
  lastCheckError: string | null;
  activeRelease: { version: string; versionCode: number | null; sizeBytes: number } | null;
  createdAt: string;
}

export interface VariantDetailView extends VariantView {
  releases: ReleaseView[];
}

export interface AppView {
  packageName: string;
  displayName: string;
  iconUrl: string | null;
  variants: VariantView[];
  createdAt: string;
}

export interface QuotaView {
  periodStart: string;
  periodEnd: string;
  quotaBytes: number;
  usedBytes: number;
  egressBytes: number;
  ingressBytes: number;
  adjustmentBytes: number;
  remainingBytes: number;
  exhausted: boolean;
  projectedPeriodBytes: number;
  projectedExhaustionAt: string | null;
}

export interface NodeView {
  id: number;
  name: string;
  domain: string;
  countries: string[];
  catchAll: boolean;
  weight: number;
  enabled: boolean;
  status: NodeStatus;
  agentConnected: boolean;
  agentVersion: string | null;
  lastHealthyAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  monthlyQuotaBytes: number;
  quotaResetDay: number;
  timezone: string;
  usageAdjustmentBytes: number;
  variantSelection: 'all' | 'allowlist';
  allowedVariants: number[];
  storageTotalBytes: number | null;
  storageFreeBytes: number | null;
  heldFiles: number;
  heldBytes: number;
  quota: QuotaView;
  createdAt: string;
}

export interface HoldingView {
  fileId: number;
  packageName: string;
  variant: string;
  version: string;
  fileName: string;
  sizeBytes: number;
  state: 'present' | 'mismatch';
  reportedAt: string;
}

export interface HealthEventView {
  id: number;
  nodeId: number;
  at: string;
  kind: 'became_faulty' | 'recovered' | 'agent_connected' | 'agent_disconnected';
  detail: string | null;
  emailSent: boolean;
}

export interface SyncEventView {
  id: number;
  nodeId: number;
  packageName: string;
  variant: string;
  version: string;
  at: string;
  outcome: SyncOutcome;
  attempts: number;
  detail: string | null;
}

export interface NodeDetailView extends NodeView {
  holdings: HoldingView[];
  healthEvents: HealthEventView[];
  syncEvents: SyncEventView[];
}

export interface NodeCreatedView {
  node: NodeView;
  token: string;
  config: Record<string, unknown>;
}

export interface OverviewView {
  nodes: { online: number; faulty: number; unknown: number; disabled: number; agentsConnected: number };
  apps: number;
  variants: number;
  activeReleases: number;
  storeBytes: number;
  downloads: { today: number; last7Days: number; last30Days: number };
  servedByHostLast7Days: number;
  unservedCountries: { country: string; downloads: number }[];
  downloader: DownloaderView;
}

export interface DownloaderView {
  lastSeenAt: string | null;
  phase: DownloaderPhase;
  currentVariantId: number | null;
  passStartedAt: string | null;
  passFinishedAt: string | null;
  passSummary: string | null;
}

export interface DownloadStatsRow {
  key: string;
  count: number;
}

export interface TrafficStatsRow {
  nodeId: number;
  start: string;
  egressBytes: number;
  ingressBytes: number;
  requests: number;
}

export interface PublicFileView {
  fileName: string;
  kind: FileKind;
  sizeBytes: number;
  sha256: string;
  url: string;
}

export interface PublicVariantView {
  slug: string;
  name: string;
  release: {
    version: string;
    versionCode: number | null;
    publishedAt: string;
    files: PublicFileView[];
  };
}

export interface PublicAppView {
  packageName: string;
  displayName: string;
  iconUrl: string | null;
  variants: PublicVariantView[];
}
