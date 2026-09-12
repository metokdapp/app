import { getAddress, type Address } from 'viem'
import { bigArg, eventAddressMatches, syncWalletEvents, type ChainEvent, type EventSyncProgress } from './events'
import { readContract } from './protocol'

export type PendingCurveOrder={
  id:bigint; kind:'play'|'sell'; amount:bigint; minOut:bigint; deadline:bigint; entropySequence:bigint; randomReady:boolean
}
export type ClaimableReward={id:bigint;tokenAmount:bigint}
export type MyP2PSell={id:bigint;remainingToken:bigint;price:bigint}
export type MyP2PBuy={id:bigint;remainingMon:bigint;price:bigint}
export type Portfolio={
  events:ChainEvent[]
  pendingPlays:PendingCurveOrder[]
  pendingSells:PendingCurveOrder[]
  claims:ClaimableReward[]
  p2pSells:MyP2PSell[]
  p2pBuys:MyP2PBuy[]
  pendingPlayMon:bigint
  pendingSellToken:bigint
  claimableToken:bigint
  p2pSellToken:bigint
  p2pBuyMon:bigint
}

async function mapLimit<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{
  const out:R[]=[]
  let cursor=0
  async function worker(){
    while(cursor<items.length){const i=cursor++;out[i]=await fn(items[i])}
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()))
  return out
}
function uniqueIds(events:ChainEvent[],name:string,address:Address,addressKey:string){
  const ids=new Set<bigint>()
  for(const e of events) if(e.name===name&&eventAddressMatches(e,addressKey,address)) ids.add(bigArg(e,'orderId'))
  return [...ids].filter(x=>x>0n)
}

export async function loadPortfolio(address:Address,deployedAt:bigint,onProgress?: (p:EventSyncProgress)=>void):Promise<Portfolio>{
  const account=getAddress(address)
  const events=await syncWalletEvents(account,deployedAt,onProgress)

  const playSettled=new Set(events.filter(e=>e.name==='PlaySettled'&&eventAddressMatches(e,'player',account)).map(e=>bigArg(e,'orderId').toString()))
  const sellClosed=new Set(events.filter(e=>(e.name==='ProtocolSellSettled'||e.name==='ProtocolSellCancelled')&&eventAddressMatches(e,'seller',account)).map(e=>bigArg(e,'orderId').toString()))
  const claimed=new Set(events.filter(e=>e.name==='RewardClaimed'&&eventAddressMatches(e,'player',account)).map(e=>bigArg(e,'orderId').toString()))

  const pendingPlayIds=uniqueIds(events,'PlaySubmitted',account,'player').filter(id=>!playSettled.has(id.toString()))
  const pendingSellIds=uniqueIds(events,'ProtocolSellSubmitted',account,'seller').filter(id=>!sellClosed.has(id.toString()))
  const rewardIds=Array.from(new Set(events.filter(e=>e.name==='PlaySettled'&&eventAddressMatches(e,'player',account)&&bigArg(e,'tokenReward')>0n&&!claimed.has(bigArg(e,'orderId').toString())).map(e=>bigArg(e,'orderId'))))
  const closedAsks=new Set(events.filter(e=>(e.name==='P2PSellOrderCancelled'&&eventAddressMatches(e,'seller',account))||(e.name==='P2PSellOrderFilled'&&eventAddressMatches(e,'seller',account)&&bigArg(e,'remainingToken')===0n)).map(e=>bigArg(e,'orderId').toString()))
  const closedBids=new Set(events.filter(e=>(e.name==='P2PBuyOrderCancelled'&&eventAddressMatches(e,'buyer',account))||(e.name==='P2PBuyOrderFilled'&&eventAddressMatches(e,'buyer',account)&&bigArg(e,'remainingMon')===0n)).map(e=>bigArg(e,'orderId').toString()))
  const p2pSellIds=uniqueIds(events,'P2PSellOrderCreated',account,'seller').filter(id=>!closedAsks.has(id.toString()))
  const p2pBuyIds=uniqueIds(events,'P2PBuyOrderCreated',account,'buyer').filter(id=>!closedBids.has(id.toString()))

  const playRows=await mapLimit(pendingPlayIds,6,async id=>({id,state:await readContract('getCurveOrderState',[id]) as any}))
  const sellRows=await mapLimit(pendingSellIds,6,async id=>({id,state:await readContract('getCurveOrderState',[id]) as any}))
  const claimRows=await mapLimit(rewardIds,6,async id=>({id,state:await readContract('claims',[id]) as any}))
  const p2pSellRows=await mapLimit(p2pSellIds,6,async id=>({id,state:await readContract('p2pSellOrders',[id]) as any}))
  const p2pBuyRows=await mapLimit(p2pBuyIds,6,async id=>({id,state:await readContract('p2pBuyOrders',[id]) as any}))

  const pendingPlays:PendingCurveOrder[]=playRows.filter(x=>Number(x.state[0])===1&&String(x.state[1]).toLowerCase()===account.toLowerCase()).map(x=>({id:x.id,kind:'play',amount:x.state[2],minOut:x.state[3],deadline:x.state[4],entropySequence:x.state[5],randomReady:x.state[6]}))
  const pendingSells:PendingCurveOrder[]=sellRows.filter(x=>Number(x.state[0])===2&&String(x.state[1]).toLowerCase()===account.toLowerCase()).map(x=>({id:x.id,kind:'sell',amount:x.state[2],minOut:x.state[3],deadline:x.state[4],entropySequence:x.state[5],randomReady:x.state[6]}))
  const claims:ClaimableReward[]=claimRows.filter(x=>String(x.state[0]).toLowerCase()===account.toLowerCase()&&x.state[1]>0n).map(x=>({id:x.id,tokenAmount:x.state[1]}))
  const p2pSells:MyP2PSell[]=p2pSellRows.filter(x=>String(x.state[0]).toLowerCase()===account.toLowerCase()&&x.state[1]>0n).map(x=>({id:x.id,remainingToken:x.state[1],price:x.state[2]}))
  const p2pBuys:MyP2PBuy[]=p2pBuyRows.filter(x=>String(x.state[0]).toLowerCase()===account.toLowerCase()&&x.state[1]>0n).map(x=>({id:x.id,remainingMon:x.state[1],price:x.state[2]}))

  return {
    events,pendingPlays,pendingSells,claims,p2pSells,p2pBuys,
    pendingPlayMon:pendingPlays.reduce((a,x)=>a+x.amount,0n),
    pendingSellToken:pendingSells.reduce((a,x)=>a+x.amount,0n),
    claimableToken:claims.reduce((a,x)=>a+x.tokenAmount,0n),
    p2pSellToken:p2pSells.reduce((a,x)=>a+x.remainingToken,0n),
    p2pBuyMon:p2pBuys.reduce((a,x)=>a+x.remainingMon,0n)
  }
}
