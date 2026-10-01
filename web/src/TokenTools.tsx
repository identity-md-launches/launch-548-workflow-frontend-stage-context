import { useState } from 'react';
import { getAddress, isAddress } from 'viem';
import { amount, errorText } from './protocol';
import { Gate } from './components';
import type { Guestbook } from './useGuestbook';

export function TokenTools({ app }: { app: Guestbook }) {
  const [action, setAction] = useState('transfer');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState('');
  const [quantity, setQuantity] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const labels: Record<string, string> = { transfer: 'Transfer tokens', approve: 'Set token allowance', burn: 'Burn tokens', transferFrom: 'Transfer with allowance', burnFrom: 'Burn with allowance' };
  const delegated = action === 'transferFrom' || action === 'burnFrom';
  const needsTarget = ['transfer', 'transferFrom', 'approve'].includes(action);
  async function execute() {
    setError('');
    try {
      if (!consent) throw new Error('Review and confirm the action first.');
      if (needsTarget && !isAddress(target.trim())) throw new Error('Enter a valid recipient or spender address.');
      if (delegated && !isAddress(from.trim())) throw new Error('Enter the address that granted you an allowance.');
      const value = action === 'approve' && quantity === '0' ? 0n : amount(quantity, app.snapshot!.decimals);
      const args = action === 'transferFrom' ? [getAddress(from.trim()), getAddress(target.trim()), value] : action === 'burnFrom' ? [getAddress(from.trim()), value] : needsTarget ? [getAddress(target.trim()), value] : [value];
      if (await app.transact(labels[action], { address: app.config.token.address, abi: app.config.token.abi, functionName: action, args })) { setConsent(false); setQuantity(''); }
    } catch (e) { setError(errorText(e)); }
  }
  return <details className="panel token-tools"><summary>Token tools <span className="summary-meta">Advanced</span></summary><div className="details-body">
    <p className="hint">Transfers cannot be reversed. Burns permanently destroy tokens without adding a guestbook entry. Allowances let the named spender transfer or burn your tokens.</p>
    <fieldset disabled={!!app.busy} onChange={() => setConsent(false)}><legend className="sr-only">Token transaction</legend>
      <label htmlFor="token-action">Action</label><select id="token-action" value={action} onChange={e => setAction(e.target.value)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      {delegated && <><label htmlFor="token-from">Token owner address</label><input id="token-from" value={from} autoComplete="off" spellCheck={false} onChange={e => setFrom(e.target.value)} /><p className="hint">Their allowance to your wallet must cover this amount.</p></>}
      {needsTarget && <><label htmlFor="token-target">{action === 'approve' ? 'Spender address' : 'Recipient address'}</label><input id="token-target" value={target} autoComplete="off" spellCheck={false} onChange={e => setTarget(e.target.value)} /></>}
      <label htmlFor="token-quantity">Amount ({app.snapshot?.symbol || 'GUEST'})</label><input id="token-quantity" value={quantity} inputMode="decimal" onChange={e => setQuantity(e.target.value)} />
      {action === 'approve' && <p className="hint">Enter 0 to revoke an allowance. This replaces the existing allowance for this spender.</p>}
    </fieldset>
    <label className="check"><input type="checkbox" checked={consent} disabled={!!app.busy} onChange={e => setConsent(e.target.checked)} /><span>I reviewed the addresses and amount for “{labels[action]}”.</span></label>
    <p role="alert" className="error">{error}</p>
    <Gate app={app}><button className="full" disabled={!consent || !!app.busy} onClick={execute}>{app.busy === labels[action] ? `${labels[action]}…` : labels[action]}</button></Gate>
  </div></details>;
}
