import { useEffect, useRef, useState } from 'react';
import { encodeAbiParameters, formatUnits, keccak256, zeroAddress, type Address } from 'viem';
import { amount, errorText, poolParameters, protocol, slippageBps, swapCall } from './protocol';
import { Gate, units } from './components';
import type { Guestbook } from './useGuestbook';

type Quote = { input: Address; inputSymbol: string; inputDecimals: number; outputSymbol: string; outputDecimals: number; amountIn: bigint; amountOut: bigint; minimum: bigint; tokenAllowance: bigint; routerAllowance: bigint; expiration: number; created: number; block: bigint; lpFee: number };
export function Swap({ app }: { app: Guestbook }) {
  const [direction, setDirection] = useState('buy');
  const [text, setText] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [quote, setQuote] = useState<Quote>();
  const [error, setError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const { config, client, account, snapshot } = app;
  const { pool } = config;
  const network = config.manifest.network;
  const paired = pool.currency0.toLowerCase() === config.token.address.toLowerCase() ? pool.currency1 : pool.currency0;
  const input = direction === 'buy' ? paired : config.token.address;
  const output = direction === 'buy' ? config.token.address : paired;
  const [pairMeta, setPairMeta] = useState({ decimals: network.nativeCurrency.decimals, symbol: paired === zeroAddress ? network.nativeCurrency.symbol : 'paired token' });
  const inputSymbol = direction === 'buy' ? pairMeta.symbol : snapshot?.symbol || 'GUEST';
  const outputSymbol = direction === 'buy' ? snapshot?.symbol || 'GUEST' : pairMeta.symbol;
  const inputDecimals = direction === 'buy' ? pairMeta.decimals : snapshot?.decimals ?? 18;
  const outputDecimals = direction === 'buy' ? snapshot?.decimals ?? 18 : pairMeta.decimals;
  const context = `${account}:${app.chainId}:${direction}:${text}:${slippage}`;
  const currentContext = useRef(context);
  currentContext.current = context;
  useEffect(() => { setQuote(undefined); setError(''); }, [context]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (paired === zeroAddress) return;
    let alive = true;
    Promise.all([client.readContract({ address: paired, abi: protocol.erc20, functionName: 'symbol' }), client.readContract({ address: paired, abi: protocol.erc20, functionName: 'decimals' })]).then(([symbol, decimals]) => { if (alive) setPairMeta({ symbol, decimals }); }).catch(e => { if (alive) setError(errorText(e)); });
    return () => { alive = false; };
  }, [client, paired]);

  async function getQuote() {
    if (!account || !app.ready || quoting) return;
    setQuoting(true); setError(''); setQuote(undefined);
    try {
      const amountIn = amount(text, inputDecimals);
      const bps = slippageBps(slippage);
      const addresses = Object.values(network.uniswapV4).concat(pool.hooks === zeroAddress ? [] : [pool.hooks]);
      const codes = await Promise.all(addresses.map(address => client.getCode({ address })));
      if (codes.some(c => !c || c === '0x')) throw new Error('A configured Uniswap contract has no code. Swaps are disabled.');
      const balance = input === zeroAddress ? await client.getBalance({ address: account }) : await client.readContract({ address: input, abi: protocol.erc20, functionName: 'balanceOf', args: [account] });
      if (amountIn > balance) throw new Error(`Insufficient ${inputSymbol}. Add funds or enter a smaller amount. Keep ETH for gas.`);
      const id = keccak256(encodeAbiParameters(poolParameters, [pool]));
      const [slot, liquidity, block] = await Promise.all([
        client.readContract({ address: network.uniswapV4.stateView, abi: protocol.stateView, functionName: 'getSlot0', args: [id] }),
        client.readContract({ address: network.uniswapV4.stateView, abi: protocol.stateView, functionName: 'getLiquidity', args: [id] }), client.getBlockNumber({ cacheTime: 0 }),
      ]);
      if (slot[0] === 0n || liquidity === 0n) throw new Error('This pool has no active liquidity. Try again when liquidity is available.');
      const { result } = await client.simulateContract({ address: network.uniswapV4.quoter, abi: protocol.quoter, functionName: 'quoteExactInputSingle', args: [{ poolKey: pool, zeroForOne: input.toLowerCase() === pool.currency0.toLowerCase(), exactAmount: amountIn, hookData: '0x' }], account });
      const amountOut = result[0];
      const minimum = amountOut * (10000n - bps) / 10000n;
      if (minimum <= 0n || amountOut > 2n ** 128n - 1n) throw new Error('No usable quote for this amount. Try another amount.');
      const [tokenAllowance, permit] = input === zeroAddress ? [amountIn, [amountIn, Number.MAX_SAFE_INTEGER]] : await Promise.all([
        client.readContract({ address: input, abi: input.toLowerCase() === config.token.address.toLowerCase() ? config.token.abi : protocol.erc20, functionName: 'allowance', args: [account, network.uniswapV4.permit2] }) as Promise<bigint>,
        client.readContract({ address: network.uniswapV4.permit2, abi: protocol.permit2, functionName: 'allowance', args: [account, input, network.uniswapV4.universalRouter] }),
      ]);
      if (currentContext.current === context) setQuote({ input, inputSymbol, inputDecimals, outputSymbol, outputDecimals, amountIn, amountOut, minimum, tokenAllowance, routerAllowance: BigInt(permit[0]), expiration: Number(permit[1]), created: Date.now(), block, lpFee: slot[3] });
    } catch (e) { if (currentContext.current === context) setError(errorText(e)); } finally { setQuoting(false); }
  }
  const fresh = quote && now - quote.created < 60000;
  const tokenApproval = quote && quote.input !== zeroAddress && quote.tokenAllowance < quote.amountIn;
  const routerApproval = quote && quote.input !== zeroAddress && (quote.routerAllowance < quote.amountIn || quote.expiration <= Math.floor(now / 1000) + 300);
  const label = tokenApproval ? `Approve ${inputSymbol} for Permit2` : routerApproval ? 'Approve router spending' : `Swap ${inputSymbol} for ${outputSymbol}`;
  async function execute() {
    if (!quote || !fresh || Date.now() - quote.created >= 60000 || !app.ready) return;
    let success = false;
    if (tokenApproval) success = await app.transact(label, { address: quote.input, abi: quote.input.toLowerCase() === config.token.address.toLowerCase() ? config.token.abi : protocol.erc20, functionName: 'approve', args: [network.uniswapV4.permit2, quote.amountIn] });
    else if (routerApproval) success = await app.transact(label, { address: network.uniswapV4.permit2, abi: protocol.permit2, functionName: 'approve', args: [quote.input, network.uniswapV4.universalRouter, quote.amountIn, Math.floor(Date.now() / 1000) + 1800] });
    else success = await app.transact(label, { address: network.uniswapV4.universalRouter, abi: protocol.router, functionName: 'execute', ...swapCall(pool, quote.input, quote.amountIn, quote.minimum, BigInt(Math.floor(Date.now() / 1000) + 300)) });
    if (success) { setQuote(undefined); if (!tokenApproval && !routerApproval) setText(''); }
  }
  return <details className="panel swap" id="swap"><summary><span>Get or swap GUEST</span><span className="summary-meta">Uniswap v4 <span aria-hidden="true">↗</span></span></summary><div className="details-body">
    <p className="hint">Swap on {network.name}. Each approval is a separate transaction; request a fresh quote after it confirms.</p>
    <fieldset disabled={!!app.busy || quoting}><legend className="sr-only">Swap settings</legend>
      <div className="segmented" aria-label="Swap direction"><button type="button" aria-pressed={direction === 'buy'} onClick={() => setDirection('buy')}>Buy GUEST</button><button type="button" aria-pressed={direction === 'sell'} onClick={() => setDirection('sell')}>Sell GUEST</button></div>
      <label htmlFor="swap-amount">You pay ({inputSymbol})</label><input id="swap-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={text} onChange={e => setText(e.target.value)} aria-describedby="swap-help swap-error" />
      <label htmlFor="slippage">Maximum slippage (%)</label><input id="slippage" inputMode="decimal" value={slippage} onChange={e => setSlippage(e.target.value)} aria-describedby="swap-help swap-error" />
    </fieldset>
    <p className="hint" id="swap-help">Choose 0.1–5% slippage. Quotes expire after 60 seconds. Network fees are paid in ETH. USD pricing is unavailable.</p>
    <p className="error" id="swap-error" role="alert">{error}</p>
    <Gate app={app}><button className="full" onClick={getQuote} disabled={quoting || !!app.busy}>{quoting ? 'Getting quote…' : 'Get quote'}</button></Gate>
    {quote && <div className="quote" aria-live="polite"><dl><div><dt>Estimated receive</dt><dd>{units(quote.amountOut, quote.outputDecimals)} {quote.outputSymbol}</dd></div><div><dt>Minimum receive</dt><dd>{formatUnits(quote.minimum, quote.outputDecimals)} {quote.outputSymbol}</dd></div><div><dt>Exchange rate</dt><dd>1 {quote.inputSymbol} ≈ {units(quote.amountOut * 10n ** BigInt(quote.inputDecimals) / quote.amountIn, quote.outputDecimals)} {quote.outputSymbol}</dd></div><div><dt>Pool fee</dt><dd>{quote.lpFee / 10000}%</dd></div></dl>
      <p className="hint">{tokenApproval ? `Step 1: allow Permit2 to spend exactly ${formatUnits(quote.amountIn, quote.inputDecimals)} ${quote.inputSymbol}.` : routerApproval ? 'Step 2: allow the router to spend that amount through Permit2 for 30 minutes.' : `Spend ${formatUnits(quote.amountIn, quote.inputDecimals)} ${quote.inputSymbol}. The swap has a 5-minute deadline.`}</p>
      {!fresh && <p className="error">Quote expired. Get a fresh quote to continue.</p>}
      <button className="full" disabled={!fresh || !app.ready || !!app.busy} onClick={execute}>{app.busy === label ? `${label}…` : label}</button>
    </div>}
    <a href={`${network.explorer}/address/${network.uniswapV4.universalRouter}`} target="_blank" rel="noreferrer">View swap router on explorer ↗</a>
  </div></details>;
}
