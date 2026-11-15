import { CorsOptions, CorsOptionsDelegate } from 'cors';
import { Request } from 'express';
import { env } from './env';

/**
 * Builds CORS configuration options for Express.
 * Rejects disallowed origins without using wildcards with credentials.
 */
export function createCorsOptions(
  allowedOrigins = env.CORS_ALLOWED_ORIGINS,
  nodeEnv = env.NODE_ENV
): CorsOptions {
  const sanitizedOrigins = allowedOrigins.filter((origin) => origin && origin !== '*');

  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, server-to-server, or curl)
      if (!origin) {
        return callback(null, true);
      }

      // Check if origin matches allowed origins
      const isAllowed = sanitizedOrigins.some((allowed) => {
        if (allowed === origin) return true;
        if (nodeEnv === 'development' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return true;
        }
        if (nodeEnv === 'development' && /^https:\/\/[a-z0-9-]+\.run\.app$/i.test(origin)) {
          return true;
        }
        return false;
      });

      if (isAllowed) {
        callback(null, true);
      } else {
        const error = new Error(`Origin '${origin}' not allowed by PharmaDesk CORS policy`);
        (error as any).status = 403;
        callback(error);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Tenant-ID',
      'X-Branch-ID',
      'X-Request-ID',
      'X-Correlation-ID',
      'Idempotency-Key',
      'X-Idempotency-Key',
      'X-Firebase-AppCheck',
    ],
    exposedHeaders: [
      'X-Request-ID',
      'X-Correlation-ID',
      'X-Cache',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Retry-After',
    ],
    maxAge: 86400, // 24 hours
  };
}

/**
 * Wraps createCorsOptions with strict same-origin support when frontend and API share a host.
 */
export function createRequestCorsOptions(
  allowedOrigins = env.CORS_ALLOWED_ORIGINS,
  nodeEnv = env.NODE_ENV
): CorsOptionsDelegate<Request> {
  const baseOptions = createCorsOptions(allowedOrigins, nodeEnv);
  return (req, callback) => {
    const requestOrigin = req.headers.origin;
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim()
      .toLowerCase();

    if (requestOrigin && forwardedHost) {
      try {
        const originHost = new URL(requestOrigin).host.toLowerCase();
        if (originHost === forwardedHost) {
          return callback(null, { ...baseOptions, origin: true });
        }
      } catch {
        // Fall through to strict base origin policy
      }
    }

    return callback(null, baseOptions);
  };
}
