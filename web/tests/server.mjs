import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../dist/', import.meta.url));
export async function serve() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!pathname.startsWith('/preview/')) throw new Error('Not found');
      const path = resolve(root, pathname.slice('/preview/'.length) || 'index.html');
      if (!path.startsWith(root) || !(await stat(path)).isFile()) throw new Error('Not found');
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(await readFile(path));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/preview/` };
}
