import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { DevGhostFile } from './src/game/devGhostFile.ts';

const GHOST_DIR = fileURLToPath(new URL('./src/course/ghosts/', import.meta.url));
const API_DIR = fileURLToPath(new URL('./api/', import.meta.url));
const MAX_BODY = 1_000_000;

/**
 * Dev server only: POST /__dev/ghost saves a recorded run as a shipped dev
 * ghost (src/course/ghosts/<id>.json). The id is validated against a strict
 * pattern, so the path can't escape that folder.
 */
function devGhostWriter(): Plugin {
  return {
    name: 'surf-duel-dev-ghost-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/ghost', (req, res) => {
        const reply = (status: number, body: object): void => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { ok: false, error: 'POST only' });
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.length > MAX_BODY) req.destroy();
        });
        req.on('end', () => {
          void (async () => {
            try {
              const file = DevGhostFile.parse(JSON.parse(body));
              const target = `${GHOST_DIR}${file.id}.json`;
              await writeFile(target, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
              reply(200, { ok: true, path: `src/course/ghosts/${file.id}.json` });
            } catch (err) {
              reply(400, { ok: false, error: err instanceof Error ? err.message : String(err) });
            }
          })();
        });
      });
    },
  };
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Dev server only: runs the Vercel functions in api/*.ts, so `npm run dev`
 * works end to end without the Vercel CLI. Handlers use the web-standard
 * signature (export function POST(request: Request)), exactly as on Vercel.
 *
 * Server-only variables from .env.local (OPENAI_API_KEY etc.) are loaded into
 * this Node process for the handlers. They never reach the browser: Vite only
 * exposes VITE_-prefixed variables to client code.
 */
function devApi(): Plugin {
  return {
    name: 'surf-duel-dev-api',
    apply: 'serve',
    configureServer(server) {
      // Vite restarts the server in this same process when .env.local changes, so remember
      // which variables came from the real shell (those win, as in Vite) and refresh the rest.
      const shared = globalThis as { __surfShellEnvKeys?: Set<string> };
      shared.__surfShellEnvKeys ??= new Set(Object.keys(process.env));
      const env = loadEnv(server.config.mode, server.config.root, '');
      for (const [key, value] of Object.entries(env)) {
        if (!shared.__surfShellEnvKeys.has(key)) process.env[key] = value;
      }
      server.middlewares.use('/api', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
        if (!/^[a-z0-9-]+$/.test(name) || !existsSync(`${API_DIR}${name}.ts`)) return next();
        void (async () => {
          try {
            const mod = (await server.ssrLoadModule(`/api/${name}.ts`)) as Record<string, unknown>;
            const handler = mod[req.method ?? 'GET'];
            if (typeof handler !== 'function') {
              res.statusCode = 405;
              res.end();
              return;
            }
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
              if (typeof value === 'string') headers.set(key, value);
              else if (Array.isArray(value)) headers.set(key, value.join(', '));
            }
            headers.set('x-real-ip', req.socket.remoteAddress ?? '127.0.0.1');
            const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
            const request = new Request(`http://localhost${req.url ?? ''}`, {
              method: req.method,
              headers,
              body: hasBody ? new Uint8Array(await readBody(req, MAX_BODY)) : undefined,
            });
            const response = (await (handler as (r: Request) => Promise<Response>)(request)) as Response;
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(Buffer.from(await response.arrayBuffer()));
          } catch (err) {
            if (err instanceof Error) server.ssrFixStacktrace(err);
            next(err);
          }
        })();
      });
    },
  };
}

export default defineConfig({
  plugins: [devGhostWriter(), devApi()],
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is ~550 kB minified (~140 kB gzipped); that's expected.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
