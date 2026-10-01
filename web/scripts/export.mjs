import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { keccak256, toHex, isAddress } from 'viem';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(root, 'dist');
const readJSON = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
export const canonical = (v) => JSON.stringify(sort(v));
function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]));
  return v;
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const abiHash = (abi) => keccak256(toHex(canonical(abi))).slice(2);
const fail = (condition, message) => { if (!condition) throw new Error(message); };
const handoff = await readJSON('web/deployment/handoff.json');
const network = await readJSON('web/deployment/network.json');
fail(handoff.version === 1 && network.network.chainId === handoff.chainId, 'Chain/version mismatch');
fail(Number(network.walletAddChain.chainId) === handoff.chainId, 'Wallet chain mismatch');
const contracts = [];
for (const item of handoff.contracts) {
  fail(/^[A-Za-z][A-Za-z0-9]*$/.test(item.name) && isAddress(item.address), 'Invalid contract');
  const source = `docs/abi/${item.name}.json`;
  const bytes = await readFile(resolve(root, source));
  const pinned = execFileSync('git', ['show', `${handoff.sourceCommit}:${source}`], { cwd: root });
  fail(bytes.equals(pinned), `${source} differs from pinned source`);
  const abi = JSON.parse(bytes);
  fail(Array.isArray(abi) && abiHash(abi) === item.abiHash, `${item.name}: canonical ABI hash mismatch`);
  contracts.push({ name: item.name, address: item.address, abiHash: item.abiHash, abiPath: `abi/${item.name}.json` });
}
fail(new Set(contracts.map(c => c.name)).size === contracts.length, 'Duplicate contract name');
// The mandatory schema excludes poolKey. Preserve the exact attested key in an inventoried asset.
const expected = { version: 1, launchId: handoff.launchId, chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit, attestationHash: handoff.attestationHash,
  contracts, network: network.network, walletAddChain: network.walletAddChain };
const checking = process.argv.includes('--check');
if (!checking) {
  await mkdir(resolve(dist, 'abi'), { recursive: true });
  for (const c of contracts) await writeFile(resolve(dist, c.abiPath), await readFile(resolve(root, `docs/abi/${c.name}.json`)));
  await writeFile(resolve(dist, 'pool-key.json'), JSON.stringify(handoff.poolKey, null, 2) + '\n');
}
const files = [];
async function walk(dir) {
  for (const name of (await readdir(dir)).sort()) {
    const path = resolve(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) await walk(path);
    else if (relative(dist, path) !== 'imd-deployment.json') {
      fail(info.size <= 8388608, `Asset too large: ${path}`);
      files.push({ path: relative(dist, path), sha256: hash(await readFile(path)) });
    }
  }
}
await walk(dist);
fail(files.some(f => f.path === 'index.html') && files.length <= 128, 'Missing index or too many assets');
const manifest = { ...expected, assets: files };
if (!checking) await writeFile(resolve(dist, 'imd-deployment.json'), JSON.stringify(manifest, null, 2) + '\n');
const actual = await readJSON('dist/imd-deployment.json');
fail(canonical(actual) === canonical(manifest), 'Manifest does not match handoff, network or asset bytes');
fail(canonical(await readJSON('dist/pool-key.json')) === canonical(handoff.poolKey), 'Pool key differs from handoff');
for (const c of actual.contracts) fail(abiHash(await readJSON(`dist/${c.abiPath}`)) === c.abiHash, 'Exported ABI mismatch');
const bytes = (await Promise.all(files.map(async f => (await stat(resolve(dist, f.path))).size))).reduce((a,b) => a+b, 0);
fail(bytes < 8 * 1024 * 1024, 'Export exceeds the submission size budget');
console.log(JSON.stringify({ result: 'PASS', assets: files.length, exportBytes: bytes, sourceCommit: handoff.sourceCommit, abiHashes: contracts.map(c => ({ name: c.name, hash: c.abiHash })) }, null, 2));
