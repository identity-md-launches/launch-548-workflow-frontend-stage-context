import { serve } from '../tests/server.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const { server, url } = await serve();
await mkdir(new URL('../../test/scratch/browser/', import.meta.url), { recursive: true });
await writeFile(new URL('../../test/scratch/browser/preview.json', import.meta.url), JSON.stringify({ url }));
console.log(`Review preview: ${url} (bounded 180-second lifetime)`);
await new Promise(resolve => setTimeout(resolve, 180000));
server.close();
