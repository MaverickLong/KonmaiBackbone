import { Router } from 'express';
import { settingsUpdate } from 'konmai-shared';
import { loadSettings, settingsView } from '../../settings.js';
import type { Context } from '../context.js';
import { parse } from '../errors.js';

export function settingsRouter(context: Context): Router {
  const router = Router();
  const em = () => context.orm.em;

  router.get('/', async (_request, response) => {
    response.json(settingsView(await loadSettings(em())));
  });

  router.patch('/', async (request, response) => {
    const body = parse(settingsUpdate, request.body);
    const settings = await loadSettings(em());
    settings.retainedGraceMinutes = body.retainedGraceMinutes;
    await em().flush();
    response.json(settingsView(settings));
  });

  return router;
}
