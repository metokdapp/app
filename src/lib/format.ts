import { formatUnits, parseUnits } from 'viem'
import { describeMetokError } from './errors'

export function parse18(value: string): bigint {
  const v = value.trim()
  if (!/^\d+(?:\.\d{0,18})?$/.test(v)) throw new Error('Invalid amount or more than 18 decimal places.')
  return parseUnits(v, 18)
}
export function fmt(value?: bigint, digits = 4): string {
  if (value === undefined) return '—'
  const s = formatUnits(value, 18)
  const [a,b=''] = s.split('.')
  const t = b.slice(0,digits).replace(/0+$/,'')
  return `${group(a)}${t ? `.${t}` : ''}`
}
export function compact(value?: bigint): string {
  if (value === undefined) return '—'
  const whole = value / 10n**18n
  const abs = whole < 0n ? -whole : whole
  if (abs >= 1_000_000_000n) return `${Number(whole / 10_000_000n)/100}B`
  if (abs >= 1_000_000n) return `${Number(whole / 10_000n)/100}M`
  if (abs >= 1_000n) return `${Number(whole / 10n)/100}K`
  return fmt(value,2)
}
export function pctWad(value?: bigint): string {
  if (value === undefined) return '—'
  const sign = value > 0n ? '+' : ''
  return `${sign}${fmt(value,2)}%`
}
export function short(a?: string, l=6, r=4){ return a ? `${a.slice(0,l+2)}…${a.slice(-r)}` : '—' }
export function minOut(quote: bigint, slippageBps: number){ return quote * BigInt(10_000-slippageBps) / 10_000n }
export function group(s:string){ return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
export function deadline3m(){ return BigInt(Math.floor(Date.now()/1000)+180) }
export function randomBytes32(): `0x${string}` {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes)
  if (bytes.every(v=>v===0)) bytes[0]=1
  return `0x${Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}`
}
export function errorText(e:unknown){
  const decoded=describeMetokError(e)
  if(decoded) return decoded
  const raw=e instanceof Error?e.message:String(e||'')
  const rules:[RegExp,string][]=[
    [/User rejected|UserRejectedRequest|rejected the request/i,'You rejected the request in your wallet.'],
    [/SlippageExceeded/i,'The quote moved beyond your slippage limit. Refresh and try again.'],
    [/OrderNotReady/i,'The FIFO head is not ready to settle.'],
    [/NoPendingCurveOrder/i,'No curve order is pending.'],
    [/InsufficientValue/i,'The attached MON is insufficient for the wager or budget plus the oracle fee.'],
    [/InvalidBatchSize/i,'Invalid batch settlement.'],
    [/P2PSellOrderNotFound|P2PBuyOrderNotFound/i,'The P2P order has no remaining liquidity, was cancelled, or does not exist.'],
    [/NotP2PSeller|NotP2PBuyer/i,'The connected wallet is not the maker of this order.'],
    [/ZeroAmount/i,'Amount must be greater than 0.'],
    [/DirectMonTransferDisabled|DirectTokenTransferToContractDisabled/i,'The contract does not accept direct MON or METOK transfers; use the appropriate dApp function.'],
    [/chain.*143|wrong chain|chain mismatch/i,'Your wallet is on the wrong network. Switch to Monad Mainnet (chain 143).'],
    [/Failed to fetch|fetch failed|network/i,'Unable to reach the RPC. The dApp will try fallback endpoints if configured.']
  ]
  for(const [re,msg] of rules) if(re.test(raw)) return msg
  if(e instanceof Error) return e.message.split('\n')[0]
  return 'Transaction failed.'
}
