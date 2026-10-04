import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { DevGhostFile } from './src/game/devGhostFile';

const GHOST_DIR = fileURLToPath(new URL('./src/course/ghosts/', import.meta.url));
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

export default defineConfig({
  plugins: [devGhostWriter()],
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
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
