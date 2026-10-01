import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import type { Config } from './config';
import { useGuestbook, type Entry } from './useGuestbook';
import { AddressLink, Gate, units } from './components';
import { Swap } from './Swap';
import { TokenTools } from './TokenTools';
import { errorText } from './protocol';

export function App({ config }: { config: Config }) {
  const app = useGuestbook(config);
  const { snapshot, account, busy } = app;
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [older, setOlder] = useState<Entry[]>([]);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState('');
  const bytes = new TextEncoder().encode(message).length;
  const maxBytes = Number(snapshot?.maxBytes ?? 280n);
  const valid = bytes > 0 && bytes <= maxBytes;
  const symbol = snapshot?.symbol || 'GUEST';
  const fee = snapshot ? formatUnits(snapshot.fee, snapshot.decimals) : '10';
  const approvalNeeded = snapshot && snapshot.allowance < snapshot.fee;
  const insufficient = snapshot && snapshot.balance < snapshot.fee;
  const signLabel = approvalNeeded ? `Approve ${fee} ${symbol}` : `Sign & burn ${fee} ${symbol}`;
  const explorer = config.manifest.network.explorer;
  useEffect(() => { setOlder([]); setPageError(''); }, [snapshot?.count]);
  const entries = [...(snapshot?.entries || []), ...older];
  async function loadOlder() {
    if (!snapshot || paging) return;
    setPaging(true); setPageError('');
    try {
      const before = entries.at(-1)!.id;
      const raw = await app.client.readContract({ address: config.guestbook.address, abi: config.guestbook.abi, functionName: 'entriesBefore', args: [before, 12n], blockNumber: snapshot.block }) as Omit<Entry, 'id'>[];
      setOlder(old => [...old, ...raw.map((e, i) => ({ ...e, id: before - 1n - BigInt(i) }))]);
    } catch (e) { setPageError(errorText(e)); } finally { setPaging(false); }
  }
  async function sign() {
    if (!snapshot || !valid || insufficient || !consent) return;
    const success = approvalNeeded
      ? await app.transact(signLabel, { address: config.token.address, abi: config.token.abi, functionName: 'approve', args: [config.guestbook.address, snapshot.fee] })
      : await app.transact(signLabel, { address: config.guestbook.address, abi: config.guestbook.abi, functionName: 'sign', args: [message] });
    if (success && !approvalNeeded) { setMessage(''); setConsent(false); }
  }
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="site-header shell"><a href="#" className="brand" aria-label="Guestbook home"><svg width="32" height="36" viewBox="0 0 32 36" fill="none" aria-hidden="true"><path d="M4 3h18a6 6 0 0 1 6 6v24H10a6 6 0 0 1-6-6V3Zm6 0v30M15 13h8m-8 6h8" stroke="currentColor" strokeWidth="1.7" /></svg><span>Guestbook<span className="brand-note">A shared onchain record</span></span></a><div className="wallet-nav"><span className="network-badge"><span className="dot" aria-hidden="true" />{config.chain.name} · {config.chain.testnet ? 'testnet' : 'mainnet'}</span>{account ? <AddressLink address={account} explorer={explorer} compact label="Connected wallet" /> : <button onClick={app.connect} disabled={app.walletBusy}>{app.walletBusy ? 'Connecting…' : 'Connect wallet'}</button>}</div></header>
    <main id="main" className="shell">
      <section className="intro"><div><p className="eyebrow">An open book. An enduring record.</p><h1>A small mark<br />that <em>lasts.</em></h1><p className="intro-copy">A hello, a thought, a moment worth keeping.<br className="desktop-break" /> Leave a note onchain, and become part of the story.</p><a className="text-link" href="#write">Leave your note <span aria-hidden="true">↗</span></a></div><div className="bookplate" aria-label="About this guestbook"><span className="bookplate-number">01 / ∞</span><div className="asterisk" aria-hidden="true">✳</div><p>Open to everyone.<br />Written to stay.</p><span className="bookplate-caption">Built on Ethereum</span></div></section>
      <section className="stats" aria-label="Live guestbook statistics"><div><span className="stat-value">{snapshot ? snapshot.count.toLocaleString() : '—'}</span><span className="stat-label">Notes onchain</span></div><div><span className="stat-value">{snapshot ? units(snapshot.count * snapshot.fee, snapshot.decimals, 0) : '—'} <small>{symbol}</small></span><span className="stat-label">Burned by signing</span></div><div><span className="stat-value">{fee} <small>{symbol}</small></span><span className="stat-label">One permanent note</span></div><p className="stats-note">No edits. No deletes.<br />Just a little piece of you.</p></section>
      {app.walletError && <p className="notice error" role="alert">{app.walletError}</p>}
      {account && !app.correctChain && <div className="notice network-warning" role="status"><p>Your wallet is on another network. Switch to {config.chain.name} to continue.</p><button onClick={app.switchChain} disabled={app.walletBusy}>{app.walletBusy ? 'Switching…' : `Switch to ${config.chain.name}`}</button></div>}
      {app.readError && <p className="notice error" role="alert">Unable to refresh live state. {app.readError} {snapshot ? 'Previously loaded entries remain visible.' : ''} Use “Refresh entries” to retry.</p>}
      <div className="workspace"><section className="feed" aria-labelledby="entries-heading"><div className="section-heading"><div><p className="eyebrow">The collective record</p><h2 id="entries-heading">Notes from here & there</h2></div><button className="quiet" onClick={app.refresh} disabled={app.loading}>Refresh entries <span aria-hidden="true">↻</span></button></div>
        <div className="feed-meta"><span>{snapshot ? `${snapshot.count.toLocaleString()} ${snapshot.count === 1n ? 'entry' : 'entries'}` : 'Reading the chain'}</span><span>Newest first</span></div>
        {!snapshot && <div className="empty"><span className="empty-mark" aria-hidden="true">“</span><h3>{app.readError ? 'The book is taking a moment.' : 'Opening the guestbook…'}</h3><p>{app.readError ? 'The public RPC is unavailable. Refresh entries to try again.' : 'Loading notes directly from the deployed contract.'}</p></div>}
        {snapshot?.count === 0n && <div className="empty"><span className="empty-mark" aria-hidden="true">“</span><h3>The first page is yours.</h3><p>No notes yet. Connect your wallet and leave the first one.</p><a href="#write">Write the first note ↗</a></div>}
        <ol className="entries">{entries.map(entry => <li key={entry.id.toString()}><article className="entry"><div className="entry-top"><span className="entry-number">#{(entry.id + 1n).toString().padStart(3, '0')}</span><AddressLink address={entry.signer} explorer={explorer} compact /><time dateTime={new Date(Number(entry.timestamp) * 1000).toISOString()}>{new Date(Number(entry.timestamp) * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC</time></div><p className="entry-message" dir="auto">{entry.message}</p><span className="entry-footer">Recorded onchain <span aria-hidden="true">↗</span></span></article></li>)}</ol>
        {entries.length > 0 && entries.at(-1)!.id > 0n && <button className="full" onClick={loadOlder} disabled={paging}>{paging ? 'Loading older notes…' : 'Load older notes'}</button>}
        <p className="error" role="alert">{pageError}</p>
        <p className="feed-footnote">Every note is public and permanent. Messages belong to their authors.</p>
      </section>
      <aside className="compose-column" aria-label="Write and manage tokens"><section className="panel compose" id="write" aria-labelledby="write-heading"><div className="compose-heading"><span className="eyebrow">Your place in the book</span><span aria-hidden="true">↗</span></div><h2 id="write-heading">Leave a note.</h2><p>Something simple. Something you.<br />Up to {maxBytes} bytes, kept onchain.</p>
        <form onSubmit={e => { e.preventDefault(); void sign(); }}><label htmlFor="message">Your message</label><textarea id="message" rows={5} placeholder="I was here. And I’m glad you are, too." value={message} disabled={!!busy} onChange={e => { setMessage(e.target.value); setConsent(false); }} aria-describedby="message-hint message-error" aria-invalid={bytes > maxBytes} />
          <div className="field-foot"><span id="message-hint">Emoji can use more than one byte.</span><span className={bytes > maxBytes ? 'error' : ''}>{bytes} / {maxBytes}</span></div><p className="error" id="message-error" role="alert">{bytes > maxBytes ? `Remove ${bytes - maxBytes} bytes to continue.` : ''}</p>
          <dl className="sign-cost"><div><dt>Signing cost</dt><dd>{fee} {symbol} <span className="muted">+ gas</span></dd></div><div><dt>Your balance</dt><dd>{account && snapshot ? `${units(snapshot.balance, snapshot.decimals)} ${symbol}` : 'Connect to view'}</dd></div></dl>
          <label className="check"><input type="checkbox" checked={consent} disabled={!!busy} onChange={e => setConsent(e.target.checked)} /><span>I understand this note is public, cannot be edited or deleted, and burns {fee} {symbol}.</span></label>
          <Gate app={app} primary><button type="submit" className="primary full" disabled={!valid || !consent || !!busy || !!insufficient}>{busy === signLabel ? `${signLabel}…` : signLabel}</button></Gate>
          {account && snapshot && app.correctChain && <p className="hint">{insufficient ? `You need ${fee} ${symbol} to sign. Open “Get or swap GUEST” below.` : approvalNeeded ? `Step 1 of 2: approve exactly ${fee} ${symbol}. Then sign your note.` : `Ready to sign. ${fee} ${symbol} will be permanently burned.`}</p>}
          <p className="small-print">Tokens are destroyed, never collected. USD pricing is unavailable. Keep ETH for network fees.</p>
        </form>
      </section><Swap app={app} /><TokenTools app={app} /><div className="transaction" aria-live="polite" role="status">{app.tx.text && <><strong>{app.tx.label}</strong><p className={app.tx.error ? 'error' : ''}>{app.tx.text}</p>{app.tx.hash && <a href={`${explorer}/tx/${app.tx.hash}`} target="_blank" rel="noreferrer">View transaction on explorer ↗</a>}{app.tx.uncertain && <button className="full" onClick={app.checkPending}>Check confirmation</button>}</>}</div></aside></div>
      <details className="deployment"><summary>About this deployment <span className="summary-meta">Contracts & verification</span></summary><div className="deployment-body"><p>This guestbook has no owner, pause switch, or editing function. Its fixed-supply token can be transferred or burned. Runtime configuration and implementation ABIs are loaded from the same deployment manifest used to verify this export.</p><dl>{config.contracts.map(c => <div key={c.name}><dt>{c.name}</dt><dd><AddressLink address={c.address} explorer={explorer} label={c.name} /></dd></div>)}<div><dt>Total token supply</dt><dd>{snapshot ? `${units(snapshot.supply, snapshot.decimals)} ${symbol}` : 'Waiting for contract reads'}</dd></div><div><dt>Read status</dt><dd>{app.readError ? 'Unavailable; transactions disabled' : snapshot ? `Chain and contract code checked · block ${snapshot.block}` : 'Checking chain and contract code…'}</dd></div><div><dt>Source commit</dt><dd className="hash">{config.manifest.sourceCommit}</dd></div><div><dt>Attestation hash</dt><dd className="hash">{config.manifest.attestationHash}</dd></div></dl><div className="deployment-links"><a href="./imd-deployment.json">View deployment manifest ↗</a>{config.manifest.network.faucets.map((faucet, index) => <a key={faucet} href={faucet} target="_blank" rel="noreferrer">{config.chain.name} faucet {index + 1} ↗</a>)}</div><p className="hint">Public RPC reads refresh every 15 seconds while this tab is visible. Wallet signatures stay in your wallet.</p></div></details>
    </main><footer className="shell site-footer"><span className="footer-brand">Guestbook</span><span>A shared record. One note at a time.</span><span>Made to remain. <span aria-hidden="true">↗</span></span></footer>
  </>;
}
