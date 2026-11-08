import type { SettingsView } from 'konmai-shared';
import { Settings } from './db/entities.js';
import type { EntityManager } from './db/orm.js';

export async function loadSettings(em: EntityManager): Promise<Settings> {
  const existing = await em.findOne(Settings, { id: 1 });
  if (existing !== null) {
    return existing;
  }
  const created = em.create(Settings, { id: 1, retainedGraceMinutes: 60 });
  await em.flush();
  return created;
}

export function settingsView(settings: Settings): SettingsView {
  return { retainedGraceMinutes: settings.retainedGraceMinutes };
}
