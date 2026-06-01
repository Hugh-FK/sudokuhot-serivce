import { Elysia } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';
import cors from '@elysiajs/cors';
import { openapi } from '@elysiajs/openapi';
import { env } from 'cloudflare:workers';
import type { Env } from './env';
import { getEnv, getAllowedOrigins } from './env';
import { createV1Routes } from './routes/v1';

function buildApp() {
  const cfEnv = env as Env;
  const origins = getAllowedOrigins(cfEnv);
  const appName = getEnv(cfEnv, 'APP_NAME', 'Sudoku Hot API');

  const app = new Elysia({ adapter: CloudflareAdapter })
    .use(
      cors({
        origin: origins.length > 0 ? origins : true,
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization'],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      }),
    )
    .use(
      openapi({
        documentation: {
          info: {
            title: appName,
            version: getEnv(cfEnv, 'APP_VERSION', '1.0.0'),
            description: 'Sudoku Hot REST API (D1)',
          },
        },
      }),
    )
    .get('/', () => ({
      message: 'Sudoku Hot API',
      app: appName,
      version: getEnv(cfEnv, 'APP_VERSION', '1.0.0'),
      environment: getEnv(cfEnv, 'APP_ENV', 'development'),
    }))
    .get('/health', () => ({ ok: true }));

  if (cfEnv.DB) {
    app.use(createV1Routes(cfEnv.DB, cfEnv));
  } else {
    app.get('/v1/*', () => ({
      error: 'database_not_configured',
      hint: 'Bind D1 as DB in wrangler.toml and run migrations',
    }));
  }

  return app.compile();
}

export default buildApp();
