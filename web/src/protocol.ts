import { encodeAbiParameters, parseAbi, parseAbiParameters, parseUnits, zeroAddress, type Address } from 'viem';
import type { PoolKey } from './config';

// Protocol interfaces only. Every deployed address is read from the runtime manifest.
export const protocol = {
  erc20: parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)']),
  permit2: parseAbi(['function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)', 'function approve(address token,address spender,uint160 amount,uint48 expiration)']),
  quoter: parseAbi(['struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }', 'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }', 'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut,uint256 gasEstimate)']),
  router: parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']),
  stateView: parseAbi(['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)', 'function getLiquidity(bytes32 poolId) view returns (uint128)']),
};
export const poolParameters = parseAbiParameters('(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)');
export function amount(text: string, decimals: number): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) || (text.split('.')[1]?.length ?? 0) > decimals) throw new Error(`Enter a positive amount with up to ${decimals} decimal places.`);
  const value = parseUnits(text, decimals);
  if (value <= 0n || value > 2n ** 128n - 1n) throw new Error('Enter a positive amount within the supported range.');
  return value;
}
export function slippageBps(text: string): bigint {
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Slippage must be 0.1–5%, with at most two decimal places.');
  const bps = parseUnits(text, 2);
  if (bps < 10n || bps > 500n) throw new Error('Choose slippage between 0.1% and 5%.');
  return bps;
}
export function swapCall(pool: PoolKey, input: Address, amountIn: bigint, minimum: bigint, deadline: bigint) {
  const zeroForOne = input.toLowerCase() === pool.currency0.toLowerCase();
  const output = zeroForOne ? pool.currency1 : pool.currency0;
  const params = [
    encodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'), [{ poolKey: pool, zeroForOne, amountIn, amountOutMinimum: minimum, hookData: '0x' }]),
    encodeAbiParameters(parseAbiParameters('address,uint256'), [input, amountIn]),
    encodeAbiParameters(parseAbiParameters('address,uint256'), [output, minimum]),
  ];
  return { args: ['0x10', [encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), ['0x060c0f', params])], deadline] as const, value: input === zeroAddress ? amountIn : 0n };
}
export function errorText(error: any): string {
  const message = [error?.shortMessage, error?.details, error?.message, error?.cause?.message].filter(Boolean).join(' ');
  if (/reject|denied|4001/i.test(message) || error?.code === 4001) return 'Request declined in your wallet. Nothing new was submitted; you can try again.';
  if (/insufficient.*(fund|balance)|ERC20InsufficientBalance/i.test(message)) return 'Insufficient balance. Add the required tokens and some ETH for network fees, then retry.';
  if (/ERC20InsufficientAllowance|allowance/i.test(message)) return 'The allowance is too low. Refresh and complete the approval step first.';
  if (/EmptyMessage/i.test(message)) return 'Write a message before signing.';
  if (/MessageTooLong/i.test(message)) return 'Shorten the message to the displayed byte limit.';
  if (/chain|account.*changed/i.test(message)) return 'Your wallet account or network changed. Reconnect on the required network and retry.';
  if (/revert|execution/i.test(message)) return `The contract declined this request. ${error?.shortMessage || 'Check your balance, allowance and pool liquidity, then request a new quote.'}`;
  return error instanceof Error && !/http|fetch|request|timeout/i.test(message) ? error.message : 'The network could not complete this request. Check your connection and retry.';
}
