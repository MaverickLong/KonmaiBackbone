import type {
  AppView,
  HealthEventView,
  HoldingView,
  NodeView,
  QuotaView,
  ReleaseFileView,
  ReleaseView,
  SyncEventView,
  VariantView,
} from 'konmai-shared';
import type {
  App,
  HealthEvent,
  Holding,
  Node,
  Release,
  ReleaseFile,
  SyncEvent,
  Variant,
} from './db/entities.js';
import { downloadUrl, iconUrl } from './urls.js';

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function variantView(variant: Variant, activeRelease: Release | null): VariantView {
  return {
    id: variant.id,
    packageName: variant.app.packageName,
    slug: variant.slug,
    name: variant.name,
    source: variant.source,
    enabled: variant.enabled,
    checkRequestedAt: iso(variant.checkRequestedAt),
    lastCheckedAt: iso(variant.lastCheckedAt),
    lastCheckStatus: variant.lastCheckStatus ?? null,
    lastCheckError: variant.lastCheckError ?? null,
    activeRelease:
      activeRelease === null
        ? null
        : {
            version: activeRelease.version,
            versionCode: activeRelease.versionCode ?? null,
            sizeBytes: activeRelease.sizeBytes,
          },
    createdAt: variant.createdAt.toISOString(),
  };
}

export function appView(publicUrl: string, app: App, variants: VariantView[]): AppView {
  return {
    packageName: app.packageName,
    displayName: app.displayName,
    iconUrl: iconUrl(publicUrl, app.iconFileName ?? null),
    variants,
    createdAt: app.createdAt.toISOString(),
  };
}

export function releaseFileView(
  publicUrl: string,
  release: Release,
  file: ReleaseFile,
  holders: number[],
): ReleaseFileView {
  const locator = {
    packageName: release.variant.app.packageName,
    variant: release.variant.slug,
    version: release.version,
    fileName: file.fileName,
  };
  return {
    id: file.id,
    fileName: file.fileName,
    kind: file.kind,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    url: downloadUrl(publicUrl, locator, release.state === 'active'),
    holders,
  };
}

export function releaseView(
  publicUrl: string,
  release: Release,
  files: ReleaseFile[],
  holdersByFile: Map<number, number[]>,
): ReleaseView {
  return {
    id: release.id,
    version: release.version,
    versionCode: release.versionCode ?? null,
    state: release.state,
    sizeBytes: release.sizeBytes,
    createdAt: release.createdAt.toISOString(),
    activatedAt: iso(release.activatedAt),
    files: files.map((file) =>
      releaseFileView(publicUrl, release, file, holdersByFile.get(file.id) ?? []),
    ),
  };
}

export interface NodeSummary {
  heldFiles: number;
  heldBytes: number;
  quota: QuotaView;
}

export function nodeView(node: Node, summary: NodeSummary): NodeView {
  return {
    id: node.id,
    name: node.name,
    domain: node.domain,
    countries: node.countries,
    catchAll: node.catchAll,
    weight: node.weight,
    enabled: node.enabled,
    status: node.status,
    agentConnected: node.agentConnected,
    agentVersion: node.agentVersion ?? null,
    lastHealthyAt: iso(node.lastHealthyAt),
    lastFailureAt: iso(node.lastFailureAt),
    lastFailureReason: node.lastFailureReason ?? null,
    monthlyQuotaBytes: node.monthlyQuotaBytes,
    quotaResetDay: node.quotaResetDay,
    timezone: node.timezone,
    usageAdjustmentBytes: node.usageAdjustmentBytes,
    variantSelection: node.variantSelection,
    allowedVariants: node.allowedVariants,
    storageTotalBytes: node.storageTotalBytes ?? null,
    storageFreeBytes: node.storageFreeBytes ?? null,
    heldFiles: summary.heldFiles,
    heldBytes: summary.heldBytes,
    quota: summary.quota,
    createdAt: node.createdAt.toISOString(),
  };
}

export function holdingView(holding: Holding): HoldingView {
  const release = holding.file.release;
  return {
    fileId: holding.file.id,
    packageName: release.variant.app.packageName,
    variant: release.variant.slug,
    version: release.version,
    fileName: holding.file.fileName,
    sizeBytes: holding.sizeBytes,
    state: holding.state,
    reportedAt: holding.reportedAt.toISOString(),
  };
}

export function healthEventView(event: HealthEvent): HealthEventView {
  return {
    id: event.id,
    nodeId: event.node.id,
    at: event.at.toISOString(),
    kind: event.kind,
    detail: event.detail ?? null,
    emailSent: event.emailSent,
  };
}

export function syncEventView(event: SyncEvent): SyncEventView {
  return {
    id: event.id,
    nodeId: event.node.id,
    packageName: event.packageName,
    variant: event.variant,
    version: event.version,
    at: event.at.toISOString(),
    outcome: event.outcome,
    attempts: event.attempts,
    detail: event.detail ?? null,
  };
}
