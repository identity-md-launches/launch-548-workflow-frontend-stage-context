import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { decodeFunctionData, encodeFunctionResult, encodeErrorResult, decodeAbiParameters, parseAbiParameters, parseUnits, zeroAddress } from 'viem';
import { protocol, poolParameters, amount, slippageBps, swapCall } from '../src/protocol.ts';
import { serve } from './server.mjs';

const manifest = JSON.parse(await readFile(new URL('../../dist/imd-deployment.json', import.meta.url)));
const pool = JSON.parse(await readFile(new URL('../../dist/pool-key.json', import.meta.url)));
const token = manifest.contracts.find(c => c.name === 'LaunchToken');
const guestbook = manifest.contracts.find(c => c.name === 'Guestbook');
const tokenAbi = JSON.parse(await readFile(new URL(`../../dist/${token.abiPath}`, import.meta.url)));
const guestAbi = JSON.parse(await readFile(new URL(`../../dist/${guestbook.abiPath}`, import.meta.url)));
const addresses = manifest.network.uniswapV4;
const account = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const fee = parseUnits('10', 18);
const evidence = new URL('../../docs/evidence/', import.meta.url);
await mkdir(evidence, { recursive: true });
const report = { timestamp: new Date().toISOString(), target: 'Committed production export served at /preview/', checks: [], consoleErrors: [], resourceFailures: [], measurements: {} };
const { server, url } = await serve();
const launchBrowser = () => chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', ...(process.env.PLAYWRIGHT_LOW_RESOURCE ? ['--single-process', '--no-zygote', '--disable-gpu'] : [])] });
let browser = await launchBrowser();
let fixtureCount = 0;
function pass(name) { report.checks.push({ name, result: 'PASS' }); console.log(`PASS ${name}`); }
const blockHash = `0x${'a'.repeat(64)}`;

async function fixture({ wallet = true, count = 15, badCode = false, offline = false, tamper = false } = {}) {
  // Chromium's single-process mode cannot safely recycle isolated contexts.
  if (process.env.PLAYWRIGHT_LOW_RESOURCE && fixtureCount > 0) { await browser.close().catch(() => {}); browser = await launchBrowser(); }
  fixtureCount++;
  const state = { block: 100, connected: false, chain: '0x1', added: false, reject: false, revert: false, delayed: false, badCode, offline, balance: parseUnits('100', 18), allowance: 0n, permitToken: 0n, permitRouter: 0n, permitExpiry: 0, sends: [], requests: [], entries: Array.from({ length: count }, (_, i) => ({ signer: account, timestamp: 1790820000n + BigInt(i * 300), message: i === count - 1 ? 'A small hello from the other side of the world. May we keep making things that bring us together. 🌿' : i === count - 2 ? 'x'.repeat(280) : `Note ${i + 1}: a moment worth keeping.` })) };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => report.consoleErrors.push(e.message));
  page.on('response', r => { if (r.url().startsWith(url) && r.status() >= 400) report.resourceFailures.push(`${r.status()} ${r.url()}`); });
  const abiFor = address => address.toLowerCase() === token.address.toLowerCase() ? tokenAbi : address.toLowerCase() === guestbook.address.toLowerCase() ? guestAbi : address.toLowerCase() === addresses.quoter.toLowerCase() ? protocol.quoter : address.toLowerCase() === addresses.stateView.toLowerCase() ? protocol.stateView : address.toLowerCase() === addresses.permit2.toLowerCase() ? protocol.permit2 : address.toLowerCase() === addresses.universalRouter.toLowerCase() ? protocol.router : protocol.erc20;
  function call(data, to, mutate = false) {
    const abi = abiFor(to);
    const { functionName: fn, args = [] } = decodeFunctionData({ abi, data });
    let result;
    if (['sign', 'execute', 'transfer', 'burn', 'approve', 'transferFrom', 'burnFrom'].includes(fn) && state.revert) throw new Error('Mock contract reverted');
    if (fn === 'TOKEN') result = token.address;
    else if (fn === 'SIGNING_FEE') result = fee;
    else if (fn === 'MAX_MESSAGE_BYTES') result = 280n;
    else if (fn === 'entryCount') result = BigInt(state.entries.length);
    else if (fn === 'entriesBefore') result = state.entries.slice(0, Math.min(Number(args[0]), state.entries.length)).reverse().slice(0, Number(args[1]));
    else if (fn === 'latestEntries') result = state.entries.slice().reverse().slice(0, Number(args[0]));
    else if (fn === 'decimals') result = 18;
    else if (fn === 'symbol') result = 'GUEST';
    else if (fn === 'totalSupply') result = parseUnits('1000000000', 18);
    else if (fn === 'balanceOf') result = state.balance;
    else if (fn === 'allowance') result = to.toLowerCase() === addresses.permit2.toLowerCase() ? [state.permitRouter, state.permitExpiry, 0] : args[1].toLowerCase() === guestbook.address.toLowerCase() ? state.allowance : state.permitToken;
    else if (fn === 'getSlot0') result = [2n ** 96n, 0, 0, pool.fee];
    else if (fn === 'getLiquidity') result = 1000000000000000000000n;
    else if (fn === 'quoteExactInputSingle') result = [args[0].exactAmount * 2n, 100000n];
    else if (fn === 'approve') {
      if (to.toLowerCase() === addresses.permit2.toLowerCase()) { if (mutate) { state.permitRouter = args[2]; state.permitExpiry = Number(args[3]); } }
      else { result = true; if (mutate) { if (args[0].toLowerCase() === guestbook.address.toLowerCase()) state.allowance = args[1]; else state.permitToken = args[1]; } }
    } else if (fn === 'sign') {
      if (state.allowance < fee || state.balance < fee) throw new Error('Insufficient allowance or balance');
      result = BigInt(state.entries.length);
      if (mutate) { state.allowance -= fee; state.balance -= fee; state.entries.push({ signer: account, timestamp: 1790829999n, message: args[0] }); }
    } else if (fn === 'transfer' || fn === 'transferFrom') { result = true; if (mutate) state.balance -= args.at(-1); }
    else if (fn === 'burn' || fn === 'burnFrom') { if (mutate) state.balance -= args.at(-1); }
    else if (fn !== 'execute') throw new Error(`Unhandled call ${fn}`);
    return { encoded: encodeFunctionResult({ abi, functionName: fn, result }), fn, args };
  }
  const receipt = hash => ({ transactionHash: hash, transactionIndex: '0x0', blockHash, blockNumber: '0x64', from: account, to: guestbook.address, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x1', effectiveGasPrice: '0x1', type: '0x2' });
  const rpc = async payload => {
    const { method, params = [], id } = payload;
    state.requests.push(method);
    try {
      let result;
      if (method === 'eth_chainId') result = `0x${manifest.chainId.toString(16)}`;
      else if (method === 'eth_blockNumber') result = `0x${state.block.toString(16)}`;
      else if (method === 'eth_getCode') result = state.badCode ? '0x' : '0x60006000';
      else if (method === 'eth_getBalance') result = '0x8ac7230489e80000';
      else if (method === 'eth_call') result = call(params[0].data, params[0].to).encoded;
      else if (method === 'eth_getTransactionReceipt') result = state.delayed ? null : receipt(params[0]);
      else if (method === 'eth_getTransactionByHash') result = { hash: params[0], nonce: '0x0', blockHash, blockNumber: '0x64', transactionIndex: '0x0', from: account, to: guestbook.address, value: '0x0', gas: '0x5208', gasPrice: '0x1', input: '0x', type: '0x2', chainId: `0x${manifest.chainId.toString(16)}`, v: '0x1', r: '0x1', s: '0x1' };
      else if (method === 'eth_getBlockByNumber') result = { hash: blockHash, parentHash: blockHash, number: '0x64', timestamp: '0x6abcdef0', nonce: '0x0000000000000000', difficulty: '0x0', gasLimit: '0x1c9c380', gasUsed: '0x5208', miner: account, extraData: '0x', transactions: [], baseFeePerGas: '0x1', size: '0x1' };
      else throw new Error(`Unhandled RPC ${method}`);
      return { jsonrpc: '2.0', id, result };
    } catch (e) { return { jsonrpc: '2.0', id, error: { code: 3, message: `execution reverted: ${e.message}`, data: encodeErrorResult({ abi: guestAbi, errorName: 'EmptyMessage' }) } }; }
  };
  await page.route(url => manifest.network.rpcUrls.some(rpc => url.href.startsWith(rpc)), async route => {
    if (state.offline) return route.fulfill({ status: 503, body: 'RPC unavailable' });
    const payload = route.request().postDataJSON();
    await route.fulfill({ json: Array.isArray(payload) ? await Promise.all(payload.map(rpc)) : await rpc(payload) });
  });
  if (wallet) {
    await page.exposeBinding('mockWallet', async (_, { method, params = [] }) => {
      state.requests.push(method);
      if (method === 'eth_accounts') return state.connected ? [account] : [];
      if (method === 'eth_chainId') return state.chain;
      if (method === 'eth_requestAccounts') { if (state.reject) throw new Error('4001 User rejected request'); state.connected = true; return [account]; }
      if (method === 'wallet_switchEthereumChain') { if (!state.added) return { mockError: true, code: 4902, message: 'Unknown chain' }; state.chain = params[0].chainId; return null; }
      if (method === 'wallet_addEthereumChain') { assert.deepEqual(params[0], manifest.walletAddChain); state.added = true; return null; }
      if (method === 'eth_sendTransaction') {
        if (state.reject) throw new Error('4001 User rejected request');
        const data = params[0]; const decoded = call(data.data, data.to, true); state.sends.push({ ...data, ...decoded });
        return `0x${state.sends.length.toString(16).padStart(64, '0')}`;
      }
      return (await rpc({ method, params, id: 1 })).result;
    });
    await page.addInitScript(() => {
      const listeners = {};
      window.ethereum = { request: async args => { const result = await window.mockWallet(args); if (result?.mockError) throw result; return result; }, on: (e, fn) => { (listeners[e] ||= []).push(fn); }, removeListener: (e, fn) => { listeners[e] = (listeners[e] || []).filter(f => f !== fn); }, emit: (e, v) => (listeners[e] || []).forEach(fn => fn(v)) };
    });
  }
  if (tamper) await page.route('**/abi/Guestbook.json', route => route.fulfill({ json: [] }));
  await page.goto(url);
  await page.getByRole('heading', { name: tamper ? 'Unable to open the guestbook' : 'Leave a note.' }).waitFor();
  return { page, context, state };
}
async function ready(page) { await page.getByRole('button', { name: 'Refresh entries', exact: false }).waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent.includes('Refresh entries')).disabled); }
async function connect(page) { await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click(); await page.getByRole('button', { name: 'Switch to Sepolia', exact: true }).click(); await ready(page); }
async function confirmed(page) { await page.getByText('Confirmed onchain. Refreshing contract state.', { exact: true }).waitFor(); await ready(page); }

try {
  assert.throws(() => amount('1.0000001', 6)); assert.throws(() => amount('-2', 18)); assert.throws(() => amount('1e3', 18)); assert.equal(amount('1.25', 6), 1250000n);
  assert.throws(() => slippageBps('5.01')); assert.equal(slippageBps('0.5'), 50n);
  const reversed = { ...pool, currency0: account, currency1: recipient };
  const encoded = swapCall(reversed, recipient, 100n, 99n, 1000n);
  const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), encoded.args[1][0]);
  assert.equal(actions, '0x060c0f'); assert.equal(encoded.value, 0n);
  const [decoded] = decodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'), params[0]);
  assert.equal(decoded.zeroForOne, false); assert.equal(decoded.poolKey.hooks.toLowerCase(), pool.hooks); assert.equal(decoded.amountOutMinimum, 99n);
  pass('Exact decimal validation, slippage bounds and ERC-20 pair direction encoding');

  const main = await fixture(); const { page, state } = main;
  await page.locator('.entry').first().waitFor();
  assert.equal(await page.locator('.entry').count(), 12); assert.equal(state.sends.length, 0);
  await page.getByRole('button', { name: 'Load older notes' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.entry').length === 15);
  pass('Public reads, newest-first entries, pagination and no unsolicited wallet request');
  await page.screenshot({ path: new URL('desktop.png', evidence).pathname, fullPage: true });
  await page.locator('#message').fill('🌿'.repeat(71));
  await page.getByText('Remove 4 bytes to continue.').waitFor();
  assert.equal(await page.locator('#message').getAttribute('aria-invalid'), 'true');
  pass('UTF-8 byte count rejects 284-byte emoji message');
  await page.locator('#message').fill('A test note with <script>literal text</script>.');
  await page.locator('.compose input[type=checkbox]').check();
  await connect(page);
  assert(state.requests.includes('wallet_addEthereumChain'));
  assert.equal(state.requests.filter(r => r === 'wallet_switchEthereumChain').length, 2);
  pass('Wallet connection, wrong-chain guard, unknown-chain add with exact vetted parameters, then switch');
  await page.getByRole('button', { name: 'Approve 10 GUEST', exact: true }).click();
  await confirmed(page);
  assert.equal(state.sends[0].fn, 'approve'); assert.equal(state.sends[0].args[1], fee); assert.equal(state.sends[0].args[0].toLowerCase(), guestbook.address);
  await page.getByRole('button', { name: 'Sign & burn 10 GUEST', exact: true }).click();
  await confirmed(page);
  await page.getByText('A test note with <script>literal text</script>.', { exact: true }).waitFor();
  assert.equal(state.sends[1].fn, 'sign'); assert.equal(state.balance, parseUnits('90', 18)); assert.equal(state.allowance, 0n);
  assert.equal(await page.locator('#message').inputValue(), '');
  pass('Exact guestbook approval, simulated signing, confirmed receipt, refreshed balance/feed, escaped onchain text');

  await page.locator('#message').fill('Retry a declined signature.'); await page.locator('.compose input[type=checkbox]').check();
  state.reject = true;
  await page.getByRole('button', { name: 'Approve 10 GUEST', exact: true }).click();
  await page.getByText(/Request declined in your wallet/).waitFor();
  assert.equal(state.sends.length, 2); assert(await page.getByRole('button', { name: 'Approve 10 GUEST', exact: true }).isEnabled()); state.reject = false;
  pass('Rejected wallet request reports recovery and releases action lock');

  await page.locator('#swap summary').click(); await page.locator('#swap-amount').fill('0.01');
  await page.getByRole('button', { name: 'Get quote', exact: true }).click();
  await page.getByText('Estimated receive', { exact: true }).waitFor();
  assert.equal(state.sends.length, 2);
  await page.getByRole('button', { name: 'Swap ETH for GUEST', exact: true }).click(); await confirmed(page);
  const buy = state.sends.at(-1); assert.equal(buy.to.toLowerCase(), addresses.universalRouter); assert.equal(BigInt(buy.value), parseUnits('0.01', 18)); assert.equal(buy.args[0], '0x10');
  const [, buyParams] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), buy.args[1][0]);
  const [settleToken, settleAmount] = decodeAbiParameters(parseAbiParameters('address,uint256'), buyParams[1]);
  assert.equal(settleToken, zeroAddress); assert.equal(settleAmount, parseUnits('0.01', 18));
  pass('Native-input simulated quote and swap: exact value, approved router, command/actions, no approvals');
  await page.getByRole('button', { name: 'Sell GUEST', exact: true }).click(); await page.locator('#swap-amount').fill('1');
  await page.getByRole('button', { name: 'Get quote', exact: true }).click();
  await page.getByRole('button', { name: 'Approve GUEST for Permit2', exact: true }).click(); await confirmed(page);
  assert.equal(state.sends.at(-1).args[0].toLowerCase(), addresses.permit2); assert.equal(state.sends.at(-1).args[1], parseUnits('1', 18));
  await page.getByRole('button', { name: 'Get quote', exact: true }).click();
  await page.getByRole('button', { name: 'Approve router spending', exact: true }).click(); await confirmed(page);
  assert.equal(state.sends.at(-1).to.toLowerCase(), addresses.permit2); assert.equal(state.sends.at(-1).args[1].toLowerCase(), addresses.universalRouter);
  await page.getByRole('button', { name: 'Get quote', exact: true }).click();
  await page.getByRole('button', { name: 'Swap GUEST for ETH', exact: true }).click(); await confirmed(page);
  assert.equal(BigInt(state.sends.at(-1).value || 0), 0n);
  pass('Token-input swap: exact token approval, expiring Permit2 router allowance, no native value');

  await page.locator('#swap-amount').fill('1'); await page.getByRole('button', { name: 'Get quote', exact: true }).click();
  await page.getByText('Estimated receive', { exact: true }).waitFor();
  await page.clock.install(); await page.clock.fastForward(61000);
  await page.getByText('Quote expired. Get a fresh quote to continue.').waitFor();
  assert(await page.getByRole('button', { name: 'Swap GUEST for ETH', exact: true }).isDisabled());
  pass('Expired quote disables swap execution');

  await page.locator('.token-tools summary').click();
  await page.locator('#token-target').fill('invalid'); await page.locator('#token-quantity').fill('1'); await page.locator('.token-tools input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Transfer tokens', exact: true }).click(); await page.getByText('Enter a valid recipient or spender address.').waitFor();
  await page.locator('#token-target').fill(recipient); await page.locator('.token-tools input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Transfer tokens', exact: true }).click(); await confirmed(page);
  assert.equal(state.sends.at(-1).fn, 'transfer');
  for (const action of ['burn', 'approve', 'transferFrom', 'burnFrom']) {
    await page.locator('#token-action').selectOption(action);
    if (action.endsWith('From')) await page.locator('#token-from').fill(recipient);
    if (['approve', 'transferFrom'].includes(action)) await page.locator('#token-target').fill(recipient);
    await page.locator('#token-quantity').fill(action === 'approve' ? '0' : '1');
    await page.locator('.token-tools input[type=checkbox]').check();
    await page.locator('.token-tools button.full').click(); await confirmed(page);
    assert.equal(state.sends.at(-1).fn, action);
  }
  pass('Advanced transfer, burn, allowance revocation, transferFrom and burnFrom controls simulate and submit');

  state.revert = true;
  await page.locator('#token-quantity').fill('1'); await page.locator('.token-tools input[type=checkbox]').check();
  const sendsBefore = state.sends.length;
  await page.locator('.token-tools button.full').click(); await page.locator('.transaction .error').waitFor();
  assert.equal(state.sends.length, sendsBefore); state.revert = false;
  pass('Simulation revert prevents wallet submission and presents persistent error');

  await page.evaluate(() => window.ethereum.emit('accountsChanged', [])); await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().waitFor();
  await page.evaluate(() => window.ethereum.emit('chainChanged', '0x1'));
  assert.equal(await page.getByRole('button', { name: 'Sign & burn 10 GUEST', exact: true }).count(), 0);
  pass('Account removal and chain events invalidate transaction prerequisites');

  await page.locator('#swap summary').click(); await page.locator('.token-tools summary').click();
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}`);
    await page.screenshot({ path: new URL(`viewport-${width}.png`, evidence).pathname, fullPage: true });
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  report.measurements.textEnlargementOverflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed').map(e => ({ tag: e.tagName, class: e.className, text: e.textContent.slice(0, 50), right: e.getBoundingClientRect().right })));
  await page.screenshot({ path: new URL('text-enlargement.png', evidence).pathname, fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Overflow with 200% text');
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  pass('Reflow at 1440, 820, 390, 320 CSS pixels and 200% text enlargement at 320px');
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press('Control+Home'); await page.locator('body').click({ position: { x: 1, y: 1 } }); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip to content');
  await page.screenshot({ path: new URL('keyboard-focus.png', evidence).pathname });
  await page.keyboard.press('Enter');
  await page.locator('#message').focus(); await page.keyboard.type('Keyboard note'); await page.keyboard.press('Tab'); await page.keyboard.press('Space');
  pass('Keyboard skip link, visible focus capture and keyboard-operated note/checkbox');
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  await writeFile(new URL('accessibility.json', evidence), JSON.stringify({ violations: accessibility.violations, passes: accessibility.passes.map(p => p.id), incomplete: accessibility.incomplete.map(p => p.id) }, null, 2));
  assert.equal(accessibility.violations.length, 0, JSON.stringify(accessibility.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))));
  report.measurements.styles = await page.evaluate(() => Object.fromEntries(['body', '.compose', '.intro-copy', '.primary', '#message', 'h1', 'h2'].map(selector => { const s = getComputedStyle(document.querySelector(selector)); return [selector, { color: s.color, background: s.backgroundColor, fontSize: s.fontSize, lineHeight: s.lineHeight, fontFamily: s.fontFamily }]; })));
  pass('Automated axe scan: zero WCAG A/AA violations in inspected state');
  report.measurements.contrast = await page.evaluate(() => {
    const rgb = v => v.match(/[\d.]+/g).slice(0,3).map(Number);
    const lum = v => rgb(v).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126,.7152,.0722][i], 0);
    const contrast = (a,b) => { const values = [lum(a),lum(b)].sort((a,b) => a-b); return (values[1] + .05) / (values[0] + .05); };
    const background = e => { while (e) { const c = getComputedStyle(e).backgroundColor; if (!c.endsWith(', 0)') && c !== 'transparent') return c; e = e.parentElement; } return 'rgb(255,255,255)'; };
    const results = ['.intro-copy','.compose','.primary','.hint','.error','.stat-label'].map(selector => { const e = document.querySelector(selector); const fg = getComputedStyle(e).color; const bg = background(e); return { selector, foreground: fg, background: bg, ratio: contrast(fg,bg), threshold: 4.5 }; });
    const input = document.querySelector('#message'); const style = getComputedStyle(input);
    results.push({ selector: '#message border', foreground: style.borderColor, background: background(input), ratio: contrast(style.borderColor, background(input)), threshold: 3 });
    results.push({ selector: 'focus ring on surface', foreground: getComputedStyle(document.documentElement).getPropertyValue('--color-focus').trim(), background: background(input), ratio: contrast('rgb(36,78,65)', background(input)), threshold: 3 });
    return results;
  });
  assert(report.measurements.contrast.every(pair => pair.ratio >= pair.threshold));
  pass('Measured rendered text, form boundary and focus-ring contrast pass their thresholds');
  await main.context.close();

  const empty = await fixture({ wallet: false, count: 0 });
  await empty.page.getByRole('heading', { name: 'The first page is yours.' }).waitFor();
  await empty.page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await empty.page.getByText(/No browser wallet found/).waitFor();
  await empty.page.screenshot({ path: new URL('empty-no-wallet.png', evidence).pathname, fullPage: true }); await empty.context.close();
  pass('Empty guestbook and missing-wallet guidance');

  const code = await fixture({ badCode: true }); await code.page.getByText(/A deployed contract has no code/).waitFor(); await connect(code.page);
  assert.equal(await code.page.getByRole('button', { name: 'Approve 10 GUEST', exact: true }).count(), 0); await code.context.close();
  pass('Missing deployed bytecode blocks transactions');
  const unavailable = await fixture({ offline: true, wallet: false }); await unavailable.page.getByText(/Unable to refresh live state/).waitFor(); await unavailable.page.screenshot({ path: new URL('rpc-error.png', evidence).pathname, fullPage: true }); await unavailable.context.close();
  pass('All RPC failures retain a recoverable error state');
  console.log('Checking delayed receipt…');
  const pending = await fixture(); await connect(pending.page);
  await pending.page.locator('#message').fill('One submission, even while waiting.'); await pending.page.locator('.compose input[type=checkbox]').check();
  pending.state.delayed = true;
  await pending.page.getByRole('button', { name: 'Approve 10 GUEST', exact: true }).click();
  await pending.page.getByText('Submitted. Waiting for onchain confirmation…').waitFor();
  assert(await pending.page.getByRole('button', { name: 'Approve 10 GUEST…', exact: true }).isDisabled());
  assert.equal(pending.state.sends.length, 1);
  pending.state.delayed = false; pending.state.block++; await confirmed(pending.page); await pending.context.close();
  pass('Approval remains locked between wallet submission and delayed receipt confirmation');
  const corrupt = await fixture({ tamper: true });
  await corrupt.page.getByText(/Deployment asset failed verification/).waitFor(); assert.equal(corrupt.state.sends.length, 0); await corrupt.context.close();
  pass('Tampered ABI asset fails manifest verification before rendering transaction controls');
  assert.equal(report.consoleErrors.length, 0); assert.equal(report.resourceFailures.length, 0);
  pass('No browser JavaScript errors or missing local export assets');
  report.result = 'PASS';
} catch (e) { report.result = 'FAIL'; report.error = e.stack; console.error(e); process.exitCode = 1; }
finally { await writeFile(new URL('browser-results.json', evidence), JSON.stringify(report, null, 2) + '\n'); await browser.close(); await new Promise(resolve => server.close(resolve)); }
