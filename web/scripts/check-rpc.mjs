import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createPublicClient, http, encodeAbiParameters, keccak256 } from 'viem';
import { protocol, poolParameters } from '../src/protocol.ts';
const manifest = JSON.parse(await readFile(new URL('../../dist/imd-deployment.json', import.meta.url)));
const pool = JSON.parse(await readFile(new URL('../../dist/pool-key.json', import.meta.url)));
const reports = [];
for (const url of manifest.network.rpcUrls) {
  const client = createPublicClient({ transport: http(url, { timeout: 10000, retryCount: 0 }) });
  const report = { url, timestamp: new Date().toISOString() };
  try {
    report.chainId = await client.getChainId();
    if (report.chainId !== manifest.chainId) throw new Error('Wrong chain');
    report.code = await Promise.all([...manifest.contracts, ...Object.entries(manifest.network.uniswapV4).map(([name,address]) => ({ name,address })), { name: 'poolGuard', address: pool.hooks }].map(async c => ({ name: c.name, address: c.address, bytes: ((await client.getCode({ address: c.address }))?.length - 2) / 2 })));
    const guestbook = manifest.contracts.find(c => c.name === 'Guestbook');
    const abi = JSON.parse(await readFile(new URL(`../../dist/${guestbook.abiPath}`, import.meta.url)));
    report.entryCount = String(await client.readContract({ address: guestbook.address, abi, functionName: 'entryCount' }));
    report.tokenBinding = await client.readContract({ address: guestbook.address, abi, functionName: 'TOKEN' });
    if (report.tokenBinding.toLowerCase() !== manifest.contracts.find(c => c.name === 'LaunchToken').address.toLowerCase()) throw new Error('Guestbook token binding mismatch');
    const poolId = keccak256(encodeAbiParameters(poolParameters, [pool]));
    report.slot0 = (await client.readContract({ address: manifest.network.uniswapV4.stateView, abi: protocol.stateView, functionName: 'getSlot0', args: [poolId] })).map(String);
    report.liquidity = String(await client.readContract({ address: manifest.network.uniswapV4.stateView, abi: protocol.stateView, functionName: 'getLiquidity', args: [poolId] }));
    report.result = report.code.every(c => c.bytes > 0) ? 'PASS' : 'FAIL';
  } catch (e) { report.result = 'UNAVAILABLE'; report.error = e.shortMessage || e.message; }
  reports.push(report);
}
await mkdir(new URL('../../docs/evidence/', import.meta.url), { recursive: true });
await writeFile(new URL('../../docs/evidence/rpc.json', import.meta.url), JSON.stringify(reports, null, 2) + '\n');
console.log(JSON.stringify(reports, null, 2));
