// Serves the built POS at / and the customer display at /display/ on one origin,
// the same layout the NestJS server will use on the shop's on-prem machine.
// Usage: pnpm nx run-many -t build && node tools/serve-dist.mjs [port]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 8080);
const root = join(import.meta.dirname, '..', 'dist', 'apps');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };

function send(res, file) {
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const [app, rest] = url.startsWith('/display') ? ['customer-display', url.slice('/display'.length) || '/'] : ['pos', url];
  const base = join(root, app);
  const file = normalize(join(base, rest));
  if (!file.startsWith(base)) { res.writeHead(400).end(); return; }
  if (existsSync(file) && statSync(file).isFile()) send(res, file);
  else send(res, join(base, 'index.html')); // SPA fallback
}).listen(port, () => console.log(`POS http://localhost:${port}/  ·  customer display http://localhost:${port}/display/`));
