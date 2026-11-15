import type { CatalogueSnapshot } from './api';

// What a prerendered page carries, as JSON in a script element, for the browser that takes the
// page over.
export interface Prerendered {
  path: string;
  catalogue: CatalogueSnapshot | null;
  // Names the build whose page template this was rendered into, for the next prerender.
  templateDigest: string;
}

export const prerenderedElementId = 'prerendered';
