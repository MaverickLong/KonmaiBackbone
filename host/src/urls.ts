import { fileUrlPath, type FileLocator } from 'konmai-shared';

export function downloadUrl(publicUrl: string, locator: FileLocator, latest: boolean): string {
  return `${publicUrl}/d/${fileUrlPath({ ...locator, version: latest ? 'latest' : locator.version })}`;
}

export function iconUrl(publicUrl: string, iconFileName: string | null): string | null {
  return iconFileName === null ? null : `${publicUrl}/icons/${encodeURIComponent(iconFileName)}`;
}

export function nodeFileUrl(domain: string, locator: FileLocator): string {
  return `https://${domain}/files/${fileUrlPath(locator)}`;
}
