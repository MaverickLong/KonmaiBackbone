import { Router } from 'express';
import { login } from 'konmai-shared';
import { issueSession, requireAdmin, verifyPassword } from '../auth.js';
import type { Context } from '../context.js';
import { parse, unauthorized } from '../errors.js';

export function sessionRouter(context: Context): Router {
  const router = Router();

  router.post('/', async (request, response) => {
    const body = parse(login, request.body);
    if (!verifyPassword(body.password, context.config.admin.passwordHash)) {
      throw unauthorized('wrong password');
    }
    response.json(await issueSession(context.config.admin));
  });

  router.get('/', requireAdmin(context.config.admin), (request, response) => {
    response.json(request.session);
  });

  return router;
}
