// Can the /api functions load under plain Node ESM, the way Vercel runs them?
//
// Vercel compiles each TypeScript file on its own and keeps import paths as
// written, so in a "type": "module" project every relative import needs its
// .js extension (and JSON imports need `with { type: 'json' }`), or the
// function crashes at runtime with ERR_MODULE_NOT_FOUND. Vite and Vitest
// don't care, so nothing else would catch it.
//
// This strips the types from api/, server/ and src/ file by file (Node's own
// stripTypeScriptTypes, paths untouched) into .api-check/, then imports each
// function and calls it once without any keys: it must answer, not crash.
//
// Usage: npm run check:api   (Node 22.13+)
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const out = join(root, '.api-check');
rmSync(out, { recursive: true, force: true });

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.json')) {
      mkdirSync(dirname(join(out, relative(root, path))), { recursive: true });
      cpSync(path, join(out, relative(root, path)));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      const target = join(out, relative(root, path)).replace(/\.ts$/, '.js');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform' }));
    }
  }
}
for (const dir of ['api', 'server', 'src']) walk(join(root, dir));

// No keys: every function must still load and answer (503 "not set up").
for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL']) delete process.env[key];

let failed = false;
for (const name of readdirSync(join(root, 'api'))) {
  if (!name.endsWith('.ts')) continue;
  const file = join(out, 'api', name.replace(/\.ts$/, '.js'));
  try {
    const mod = await import(pathToFileURL(file).href);
    const res = await mod.POST(new Request('http://localhost/api/x', { method: 'POST', body: '{}' }));
    console.log(`ok   api/${name} -> ${res.status}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL api/${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
