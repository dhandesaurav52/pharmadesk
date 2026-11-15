import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './server/src/app';
import { env, validateEnv } from './server/src/config/env';
import { logger } from './server/src/lib/logger';

function parseCliPort(): number | null {
  const idx = process.argv.indexOf('--port');
  if (idx !== -1 && process.argv[idx + 1]) {
    const parsed = Number(process.argv[idx + 1]);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  }
  return null;
}

async function startFullStackServer() {
  const config = validateEnv();
  const isProd = config.NODE_ENV === 'production';
  const port = parseCliPort() || Number(process.env.PORT) || 3000;
  const host = '0.0.0.0';

  const app = createApp({ config, serveFrontend: true });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);

    // SPA HTML fallback for non-API routes in development
    app.get('*', async (req, res, next) => {
      if (req.originalUrl.startsWith(config.API_PREFIX)) {
        return next();
      }
      try {
        const indexPath = path.resolve(process.cwd(), 'index.html');
        const template = fs.readFileSync(indexPath, 'utf-8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { index: false }));

    app.get('*', (req, res, next) => {
      if (req.originalUrl.startsWith(config.API_PREFIX)) {
        return next();
      }
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        return res.sendFile(indexHtml);
      }
      return res.status(404).send('Frontend build not found.');
    });
  }

  const server = http.createServer(app);
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 65_000;

  server.listen(port, host, () => {
    logger.info(
      { port, host, nodeEnv: config.NODE_ENV, projectId: env.FIREBASE_PROJECT_ID },
      `PharmaDesk full-stack server running at http://${host}:${port}`
    );
  });

  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}. Shutting down PharmaDesk server...`);
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startFullStackServer().catch((err) => {
  console.error('Failed to start PharmaDesk server:', err);
  process.exit(1);
});
