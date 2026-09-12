import { decodeErrorResult, isHex, type Hex } from 'viem'
import { METOK_ABI } from './abi'

const ERROR_COPY: Record<string,string> = {
  ZeroAmount:'Amount must be greater than 0.',
  InvalidCardCount:'The contract card-count configuration is invalid.',
  InvalidCardChoice:'Invalid card choice.',
  InvalidEntropyAddress:'The configured Entropy contract is invalid.',
  InvalidEntropyProvider:'The configured Entropy provider is invalid.',
  InvalidEntropySequence:'Invalid Entropy sequence.',
  InvalidBatchSize:'Batch settlement must stay within protocol limits.',
  InvalidUserRandomNumber:'Invalid random contribution. Please try again.',
  InvalidDeadline:'The deadline is outside the allowed range.',
  InsufficientValue:'The attached MON is insufficient for the wager or budget plus the oracle fee.',
  UnauthorizedEntropy:'Unauthorized Entropy callback.',
  WrongPlayer:'The connected wallet is not the player for this order.',
  WrongOrderKind:'The curve order has the wrong type for this action.',
  NoPendingCurveOrder:'No curve order is pending.',
  OrderNotReady:'The FIFO head is not ready to settle.',
  NothingToClaim:'This order has no METOK reward to claim.',
  NotClaimOwner:'The connected wallet does not own this reward.',
  Insolvent:'The contract rejected the action because its solvency check failed.',
  DustAmount:'The amount is too small to execute safely.',
  DirectMonTransferDisabled:'Do not send MON directly to the contract; use the appropriate dApp function.',
  DirectTokenTransferToContractDisabled:'Do not transfer METOK directly to the contract; use SELL or P2P in the dApp.',
  InvalidP2PPrice:'P2P price must be greater than 0.',
  P2PSellOrderNotFound:'The P2P ask has no remaining liquidity, was cancelled, or does not exist.',
  P2PBuyOrderNotFound:'The P2P bid has no remaining budget, was cancelled, or does not exist.',
  NotP2PSeller:'The connected wallet is not the maker of this ask.',
  NotP2PBuyer:'The connected wallet is not the maker of this bid.',
  SlippageExceeded:'The quote moved beyond your slippage limit. Refresh and try again.',
  NativeTransferFailed:'Withdrawing MON to the wallet failed during the native transfer.',
  AccountingInvariantBroken:'The contract detected a broken accounting invariant; the transaction cannot continue.',
  UnsupportedPriceLookback:'The requested price-history lookback is not supported by the contract.',
  PriceChangeOverflow:'Price-change analytics exceeded the safe representation range.'
}

function hexCandidates(input: unknown): Hex[] {
  const out: Hex[]=[]
  const seen=new Set<object>()
  const queue: unknown[]=[input]
  let steps=0
  while(queue.length && steps++<60){
    const v=queue.shift()
    if(typeof v==='string' && isHex(v) && v.length>=10){ out.push(v as Hex); continue }
    if(!v || typeof v!=='object' || seen.has(v as object)) continue
    seen.add(v as object)
    for(const key of ['data','cause','error','details','metaMessages','shortMessage']){
      try{const next=(v as Record<string,unknown>)[key];if(next!==undefined)queue.push(next)}catch{}
    }
  }
  return Array.from(new Set(out))
}

export function decodeMetokError(input: unknown): {name:string; message:string}|undefined {
  for(const data of hexCandidates(input)){
    try{
      const decoded=decodeErrorResult({abi:METOK_ABI,data})
      const name=decoded.errorName
      return {name,message:ERROR_COPY[name]||`Contract reverted: ${name}`}
    }catch{}
  }
  const raw=input instanceof Error?input.message:String(input||'')
  for(const [name,message] of Object.entries(ERROR_COPY)) if(raw.includes(name)) return {name,message}
  return undefined
}

export function describeMetokError(input: unknown): string | undefined {
  return decodeMetokError(input)?.message
}
