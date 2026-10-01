import { createPublicClient, createWalletClient, custom, defineChain, fallback, http, isAddress, keccak256, toHex, type Abi, type Address, type EIP1193Provider } from 'viem';

export type Provider = EIP1193Provider & { on?: (event: string, fn: (...args: any[]) => void) => void; removeListener?: (event: string, fn: (...args: any[]) => void) => void };
declare global { interface Window { ethereum?: Provider } }
export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
export type Deployment = {
  version: 1; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  assets: { path: string; sha256: string }[];
  network: { chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[];
    uniswapV4: Record<'poolManager' | 'universalRouter' | 'quoter' | 'stateView' | 'positionManager' | 'permit2', Address> };
  walletAddChain?: { chainId: string; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] };
};
export type Config = Awaited<ReturnType<typeof loadConfig>>;
export function canonical(value: unknown): string {
  function sort(v: any): any { return Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v; }
  return JSON.stringify(sort(value));
}
async function fetchText(path: string) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Invalid deployment asset path.');
  const response = await fetch(new URL(path, new URL('.', window.location.href)), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load ${path}. Reload to try again.`);
  return response.text();
}
export async function loadConfig() {
  const manifest = JSON.parse(await fetchText('imd-deployment.json')) as Deployment;
  const allowed = ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts', 'assets', 'network', 'walletAddChain'];
  if (Object.keys(manifest).some(k => !allowed.includes(k)) || manifest.version !== 1 || manifest.chainId !== manifest.network?.chainId || !manifest.network.rpcUrls.length) throw new Error('Deployment configuration is invalid.');
  async function asset(path: string) {
    const entry = manifest.assets.find(a => a.path === path);
    if (!entry) throw new Error(`Unlisted deployment asset: ${path}`);
    const value = await fetchText(path);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== entry.sha256) throw new Error(`Deployment asset failed verification: ${path}`);
    return JSON.parse(value);
  }
  const contracts = await Promise.all(manifest.contracts.map(async c => {
    if (!isAddress(c.address)) throw new Error('Invalid contract address.');
    const abi = await asset(c.abiPath) as Abi;
    if (!Array.isArray(abi) || keccak256(toHex(canonical(abi))).slice(2) !== c.abiHash) throw new Error(`ABI verification failed: ${c.name}`);
    return { ...c, abi };
  }));
  const token = contracts.find(c => c.name === 'LaunchToken');
  const guestbook = contracts.find(c => c.name === 'Guestbook');
  if (!token || !guestbook || contracts.length !== 2) throw new Error('Required deployment contracts are missing.');
  const pool = await asset('pool-key.json') as PoolKey;
  if (![pool.currency0, pool.currency1, pool.hooks].every(address => isAddress(address)) || BigInt(pool.currency0) >= BigInt(pool.currency1) || ![pool.currency0.toLowerCase(), pool.currency1.toLowerCase()].includes(token.address.toLowerCase())) throw new Error('Invalid pool key.');
  const chain = defineChain({ id: manifest.chainId, name: manifest.network.name, nativeCurrency: manifest.network.nativeCurrency,
    rpcUrls: { default: { http: manifest.network.rpcUrls } }, blockExplorers: { default: { name: 'Explorer', url: manifest.network.explorer } }, testnet: manifest.network.testnet });
  return { manifest, contracts, token, guestbook, pool, chain };
}
export function publicClient(config: Config, provider?: Provider) {
  const transports = config.manifest.network.rpcUrls.map(url => http(url, { timeout: 8000, retryCount: 0 }));
  return createPublicClient({ chain: config.chain, transport: fallback(provider ? [...transports, custom(provider, { retryCount: 0 })] : transports, { retryCount: 0 }), pollingInterval: 4000 });
}
export function walletClient(config: Config, provider: Provider) { return createWalletClient({ chain: config.chain, transport: custom(provider) }); }
export async function switchNetwork(config: Config, provider: Provider) {
  const switchChain = () => provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHex(config.manifest.chainId) }] });
  try { await switchChain(); } catch (e: any) {
    if ((e.code === 4902 || e?.data?.originalError?.code === 4902 || /unknown chain|unrecognized chain|chain.*not.*added/i.test(e.message)) && config.manifest.walletAddChain) {
      await provider.request({ method: 'wallet_addEthereumChain', params: [config.manifest.walletAddChain as any] });
      await switchChain();
    } else throw e;
  }
}
