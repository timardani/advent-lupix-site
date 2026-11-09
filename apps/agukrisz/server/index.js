import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
let now = () => new Date();
// Csak helyi teszthez (capture): rögzített kezdőidő, ami tovább ketyeg. Élesben (NODE_ENV=production) tiltott.
if (env.ALLOW_FAKE_TIME === '1' && env.NODE_ENV !== 'production' && env.FAKE_NOW) {
  const base = Date.parse(env.FAKE_NOW); const start = Date.now();
  if (Number.isFinite(base)) { now = () => new Date(base + Date.now() - start); console.warn(`FAKE_NOW aktív: ${env.FAKE_NOW}`); }
}
const app = createApp({
  dataDir: env.DATA_DIR || path.join(root, 'data-local'),
  configDir: env.CONFIG_DIR || path.join(root, 'config'),
  distDir: env.DIST_DIR || path.join(root, 'dist'),
  env, now,
});
const server = http.createServer(app.handler);
server.requestTimeout = 20000;
server.headersTimeout = 15000;
const port = Number(env.PORT || 3000);
server.listen(port, env.HOST || '0.0.0.0', () => console.log(`webkalendárium: http://127.0.0.1:${port}`));
const run = () => app.tick().catch(e => console.error('ütemező:', e.message));
const iv = setInterval(run, 30000);
run();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { clearInterval(iv); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
