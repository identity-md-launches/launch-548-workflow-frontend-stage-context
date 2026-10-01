import { useState } from 'react';
import { formatUnits, getAddress, type Address } from 'viem';
import type { Guestbook } from './useGuestbook';

export function units(value: bigint, decimals: number, precision = 5) {
  const [whole, fraction] = formatUnits(value, decimals).split('.');
  const short = fraction?.slice(0, precision).replace(/0+$/, '');
  if (value > 0n && whole === '0' && !short) return `< ${formatUnits(10n ** BigInt(Math.max(0, decimals - precision)), decimals)}`;
  return `${BigInt(whole).toLocaleString('en-US')}${short ? `.${short}` : ''}`;
}
export function AddressLink({ address, explorer, label, compact = false }: { address: Address; explorer: string; label?: string; compact?: boolean }) {
  const [notice, setNotice] = useState('');
  const checksum = getAddress(address);
  return <span className="address-group"><a className="address" href={`${explorer}/address/${checksum}`} target="_blank" rel="noreferrer" title={checksum} aria-label={label ? `${label}: ${checksum} on explorer` : `${checksum} on explorer`}>{compact ? `${checksum.slice(0, 6)}…${checksum.slice(-4)}` : checksum}</a><button className="copy" type="button" aria-label={`Copy ${label || checksum}`} onClick={async () => { try { await navigator.clipboard.writeText(checksum); setNotice('Copied'); } catch { setNotice('Select address to copy'); } }}>{notice || 'Copy'}</button><span className="sr-only" role="status">{notice}</span></span>;
}
export function Gate({ app, children, primary = false }: { app: Guestbook; children: React.ReactNode; primary?: boolean }) {
  if (!app.account) return <button type="button" className={`${primary ? 'primary ' : ''}full`} disabled={app.walletBusy} onClick={app.connect}>{app.walletBusy ? 'Connecting…' : 'Connect wallet'}</button>;
  if (!app.correctChain) return <p className="hint">Switch to {app.config.chain.name} using the network control above.</p>;
  if (!app.ready) return <p className="hint">{app.readError ? 'Transactions are disabled until contract reads succeed. Use “Refresh entries” to retry.' : 'Verifying contracts and reading your balance…'}</p>;
  return <>{children}</>;
}
