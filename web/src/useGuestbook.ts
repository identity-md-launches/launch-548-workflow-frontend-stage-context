import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAddress, type Abi, type Address, type Hash } from 'viem';
import { publicClient, switchNetwork, walletClient, type Config } from './config';
import { errorText } from './protocol';

export type Entry = { signer: Address; timestamp: bigint; message: string; id: bigint };
export type Snapshot = { count: bigint; entries: Entry[]; fee: bigint; maxBytes: bigint; decimals: number; symbol: string; supply: bigint; balance: bigint; allowance: bigint; nativeBalance: bigint; block: bigint };
export type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint };
export type Guestbook = ReturnType<typeof useGuestbook>;

export function useGuestbook(config: Config) {
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [readError, setReadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshId, setRefreshId] = useState(0);
  const [busy, setBusy] = useState('');
  const [tx, setTx] = useState<{ label: string; text: string; hash?: Hash; error?: boolean; uncertain?: boolean }>({ label: '', text: '' });
  const lock = useRef(false);
  const identity = useRef('');
  identity.current = `${account}:${chainId}`;
  const correctChain = chainId === config.manifest.chainId;
  const client = useMemo(() => publicClient(config, correctChain ? window.ethereum : undefined), [config, correctChain]);
  const ready = !!account && correctChain && !!snapshot && !readError && !loading;
  const refresh = useCallback(() => setRefreshId(v => v + 1), []);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    let alive = true;
    const accounts = (list: string[]) => { if (alive) { setSnapshot(undefined); setAccount(list[0] ? getAddress(list[0]) : undefined); } };
    const chain = (id: string) => { if (alive) { setSnapshot(undefined); setChainId(Number(id)); } };
    const disconnect = () => { accounts([]); setChainId(undefined); };
    provider.on?.('accountsChanged', accounts);
    provider.on?.('chainChanged', chain);
    provider.on?.('disconnect', disconnect);
    Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]).then(([a, c]) => { accounts(a); chain(c); }).catch(() => {});
    return () => { alive = false; provider.removeListener?.('accountsChanged', accounts); provider.removeListener?.('chainChanged', chain); provider.removeListener?.('disconnect', disconnect); };
  }, []);

  useEffect(() => {
    let alive = true;
    let running = false;
    setLoading(true);
    setReadError('');
    async function read() {
      if (running) return;
      running = true;
      try {
        if (await client.getChainId() !== config.manifest.chainId) throw new Error('RPC chain verification failed. Transactions are disabled.');
        const block = await client.getBlockNumber({ cacheTime: 0 });
        const codes = await Promise.all(config.contracts.map(c => client.getCode({ address: c.address, blockNumber: block })));
        if (codes.some(code => !code || code === '0x')) throw new Error('A deployed contract has no code. Transactions are disabled.');
        const readContract = <T,>(contract: typeof config.token, functionName: string, args?: readonly unknown[]) => client.readContract({ address: contract.address, abi: contract.abi, functionName, args, blockNumber: block }) as Promise<T>;
        const [tokenAddress, count, fee, maxBytes, decimals, symbol, supply, balance, allowance, nativeBalance] = await Promise.all([
          readContract<Address>(config.guestbook, 'TOKEN'), readContract<bigint>(config.guestbook, 'entryCount'),
          readContract<bigint>(config.guestbook, 'SIGNING_FEE'), readContract<bigint>(config.guestbook, 'MAX_MESSAGE_BYTES'),
          readContract<number>(config.token, 'decimals'), readContract<string>(config.token, 'symbol'), readContract<bigint>(config.token, 'totalSupply'),
          account ? readContract<bigint>(config.token, 'balanceOf', [account]) : 0n,
          account ? readContract<bigint>(config.token, 'allowance', [account, config.guestbook.address]) : 0n,
          account ? client.getBalance({ address: account, blockNumber: block }) : 0n,
        ]);
        if (tokenAddress.toLowerCase() !== config.token.address.toLowerCase()) throw new Error('Guestbook token binding does not match this deployment.');
        const raw = await readContract<Omit<Entry, 'id'>[]>(config.guestbook, 'entriesBefore', [count, 12n]);
        if (alive) { setSnapshot({ count, fee, maxBytes, decimals, symbol, supply, balance, allowance, nativeBalance, block, entries: raw.map((e, i) => ({ ...e, id: count - 1n - BigInt(i) })) }); setReadError(''); }
      } catch (error) { if (alive) setReadError(errorText(error)); }
      finally { running = false; if (alive) setLoading(false); }
    }
    void read();
    const timer = setInterval(() => { if (!document.hidden) void read(); }, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [config, client, account, chainId, refreshId]);

  async function connect() {
    setWalletBusy(true); setWalletError('');
    try {
      if (!window.ethereum) throw new Error('No browser wallet found. Open this page in a wallet browser or install an Ethereum browser wallet, then reload.');
      const list = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const chain = await window.ethereum.request({ method: 'eth_chainId' });
      setAccount(list[0] ? getAddress(list[0]) : undefined); setChainId(Number(chain));
    } catch (e) { setWalletError(errorText(e)); } finally { setWalletBusy(false); }
  }
  async function switchChain() {
    if (!window.ethereum) return;
    setWalletBusy(true); setWalletError('');
    try { await switchNetwork(config, window.ethereum); setChainId(Number(await window.ethereum.request({ method: 'eth_chainId' }))); }
    catch (e) { setWalletError(errorText(e)); } finally { setWalletBusy(false); }
  }
  async function assertWallet(expected: string) {
    if (!window.ethereum || !account) throw new Error('Connect your wallet first.');
    const [accounts, chain] = await Promise.all([window.ethereum.request({ method: 'eth_accounts' }), window.ethereum.request({ method: 'eth_chainId' })]);
    if (Number(chain) !== config.manifest.chainId || accounts[0]?.toLowerCase() !== account.toLowerCase() || identity.current !== expected) throw new Error('Wallet account or chain changed.');
  }
  async function transact(label: string, call: Call): Promise<boolean> {
    if (lock.current || !ready || !account || !window.ethereum) return false;
    lock.current = true; setBusy(label); setTx({ label, text: 'Checking this transaction…' });
    const expected = identity.current;
    let hash: Hash | undefined;
    let uncertain = false;
    try {
      await assertWallet(expected);
      const simulation = await client.simulateContract({ ...call, account });
      await assertWallet(expected);
      setTx({ label, text: 'Confirm the transaction in your wallet.' });
      hash = await walletClient(config, window.ethereum).writeContract(simulation.request);
      setTx({ label, hash, text: 'Submitted. Waiting for onchain confirmation…' });
      let cancelled = false;
      let receipt;
      try {
        receipt = await client.waitForTransactionReceipt({ hash, timeout: 180000, onReplaced: replacement => {
          hash = replacement.transaction.hash; cancelled = replacement.reason === 'cancelled';
          setTx({ label, hash, text: cancelled ? 'Cancellation submitted. Waiting for confirmation…' : 'Replacement submitted. Waiting for confirmation…' });
        } });
      } catch { uncertain = true; setTx({ label, hash, uncertain: true, text: 'Confirmation is not available yet. Check the transaction before trying another action.' }); return false; }
      if (cancelled) throw new Error('Transaction cancelled in your wallet. You can try again.');
      if (receipt.status !== 'success') throw new Error('The transaction reverted onchain. Refresh your balance and retry.');
      setLoading(true); refresh();
      setTx({ label, hash, text: 'Confirmed onchain. Refreshing contract state.' });
      return true;
    } catch (e) { setTx({ label, hash, error: true, text: errorText(e) }); return false; }
    finally { if (!uncertain) { lock.current = false; setBusy(''); } }
  }
  async function checkPending() {
    if (!tx.hash) return;
    try {
      const receipt = await client.getTransactionReceipt({ hash: tx.hash });
      setTx({ label: tx.label, hash: tx.hash, error: receipt.status !== 'success', text: receipt.status === 'success' ? 'Transaction confirmed. Review the explorer for its final action.' : 'The transaction reverted. Refresh and try again.' });
      lock.current = false; setBusy(''); setLoading(true); refresh();
    } catch { setTx(t => ({ ...t, text: 'Still waiting for confirmation. Check the explorer or try checking again.' })); }
  }
  return { config, account, chainId, correctChain, walletBusy, walletError, snapshot, readError, loading, ready, client, busy, tx, connect, switchChain, refresh, transact, checkPending };
}
