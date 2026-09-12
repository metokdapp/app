import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { EXPLORER_URL } from '../lib/config'
import { bigArg, boolArg, hydrateEventTimestamps, loadRecentProtocolEvents, strArg, syncWalletEvents, type ChainEvent, type EventSyncProgress } from '../lib/events'
import { errorText, fmt, short } from '../lib/format'
import type { ProtocolState } from '../lib/protocol'
import { Badge, Button, Card, Label, Spinner } from './Ui'

export function ActivityPanel({p,address}:{p?:ProtocolState,address?:Address}){
  const [mode,setMode]=useState<'mine'|'protocol'>('mine');const[events,setEvents]=useState<ChainEvent[]>([]);const[loading,setLoading]=useState(false);const[msg,setMsg]=useState('');const[progress,setProgress]=useState('');const[type,setType]=useState<'all'|'play'|'sell'|'p2p'>('all')
  const load=useCallback(async()=>{
    if(mode==='mine'&&(!address||!p?.deployedAt)){setEvents([]);return}
    setLoading(true);setMsg('')
    try{
      const onProgress=(x:EventSyncProgress)=>setProgress(x.message)
      const rows=mode==='mine'?await syncWalletEvents(address!,p!.deployedAt,onProgress):await loadRecentProtocolEvents(500_000n,onProgress)
      setEvents(await hydrateEventTimestamps(rows,120,onProgress));setProgress('')
    }catch(e){setMsg(errorText(e));setProgress('')}finally{setLoading(false)}
  },[mode,address,p?.deployedAt])
  useEffect(()=>{void load()},[load])
  const filtered=useMemo(()=>events.filter(e=>type==='all'||group(e.name)===type).slice(0,150),[events,type])
  return <div className="event-page">
    <Card><div className="section-head"><div><Label>ON-CHAIN EVENT INDEX</Label><h2>PLAY · SELL · P2P history</h2></div><Badge ok={!loading}>{loading?'Syncing':'RPC logs'}</Badge></div>
      <p className="muted">Data comes directly from contract event logs. “My wallet” syncs from the deployment block and caches checkpoints; “Protocol recent” scans only the latest block window to avoid loading the entire protocol history.</p>
      <div className="event-toolbar"><div className="segmented"><button className={mode==='mine'?'active':''} onClick={()=>setMode('mine')}>My wallet</button><button className={mode==='protocol'?'active':''} onClick={()=>setMode('protocol')}>Protocol recent</button></div><Button className="secondary" onClick={()=>void load()} disabled={loading}>{loading?<><Spinner/> Sync</>:'Refresh'}</Button></div>
      <div className="filter-chips">{(['all','play','sell','p2p'] as const).map(x=><button key={x} className={type===x?'active':''} onClick={()=>setType(x)}>{x==='all'?'All':x.toUpperCase()}</button>)}</div>
      {progress&&<div className="sync-banner"><Spinner/>{progress}</div>}{msg&&<div className="notice">{msg}</div>}
      {!address&&mode==='mine'&&<div className="empty">Connect your wallet to view all events related to your address.</div>}
      <div className="chain-event-list">{address||mode==='protocol'?(!filtered.length&&!loading&&<div className="empty">No events found in the scanned range.</div>):null}{filtered.map(e=><EventRow e={e} key={e.id}/>)}</div>
      <div className="event-foot"><span>{filtered.length} events displayed</span><span>{mode==='mine'?'All-time wallet index':'Recent 500,000 blocks'}</span></div>
    </Card>
  </div>
}

function EventRow({e}:{e:ChainEvent}){
  const meta=describe(e)
  const orderId=bigArg(e,'orderId')
  return <div className={`chain-event ${meta.kind}`}><div className="event-icon">{meta.icon}</div><div className="event-main"><div><b>{meta.title}</b>{orderId>0n&&<span>#{orderId.toString()}</span>}</div><p>{meta.detail}</p><small>{e.timestamp?new Date(e.timestamp*1000).toLocaleString('en-US'):`Block ${e.blockNumber.toString()}`} · {short(e.transactionHash,8,6)}</small></div><a href={`${EXPLORER_URL}/tx/${e.transactionHash}`} target="_blank" rel="noreferrer" aria-label="Open transaction">↗</a></div>
}
function group(name:string):'play'|'sell'|'p2p'|'other'{if(name.startsWith('Play')||name.startsWith('Reward'))return'play';if(name.startsWith('ProtocolSell'))return'sell';if(name.startsWith('P2P'))return'p2p';return'other'}
function describe(e:ChainEvent){
  switch(e.name){
    case'PlaySubmitted':return{kind:'play',icon:'◆',title:'PLAY submitted',detail:`${fmt(bigArg(e,'monAmount'),8)} MON · card ${strArg(e,'cardChoice')} · min ${fmt(bigArg(e,'minTokenOut'),4)} METOK`}
    case'PlaySettled':return{kind:'play',icon:boolArg(e,'refunded')?'↩':boolArg(e,'eligible')?'★':'×',title:boolArg(e,'refunded')?'PLAY refunded':boolArg(e,'eligible')?'PLAY won':'PLAY lost',detail:boolArg(e,'refunded')?`Refund ${fmt(bigArg(e,'monAmount'),8)} MON · reason ${short(strArg(e,'refundReason'),8,6)}`:`Winning card ${strArg(e,'winningCard')} · reward ${fmt(bigArg(e,'tokenReward'),4)} METOK · wager ${fmt(bigArg(e,'monAmount'),8)} MON`}
    case'RewardClaimed':return{kind:'play',icon:'✓',title:'Reward claimed',detail:`${fmt(bigArg(e,'tokenAmount'),4)} METOK transferred to player`}
    case'ProtocolSellSubmitted':return{kind:'sell',icon:'↓',title:'Curve SELL submitted',detail:`${fmt(bigArg(e,'tokenAmount'),4)} METOK · min ${fmt(bigArg(e,'minMonOut'),8)} MON`}
    case'ProtocolSellSettled':return{kind:'sell',icon:'✓',title:'Curve SELL settled',detail:`${fmt(bigArg(e,'tokenAmount'),4)} METOK → ${fmt(bigArg(e,'monCredit'),8)} MON credit`}
    case'ProtocolSellCancelled':return{kind:'sell',icon:'↩',title:'Curve SELL returned',detail:`${fmt(bigArg(e,'tokenReturned'),4)} METOK returned · reason ${short(strArg(e,'reason'),8,6)}`}
    case'P2PSellOrderCreated':return{kind:'p2p',icon:'A',title:'P2P ask created',detail:`${fmt(bigArg(e,'tokenAmount'),4)} METOK @ ${fmt(bigArg(e,'pricePerTokenWad'),10)} MON`}
    case'P2PSellOrderFilled':return{kind:'p2p',icon:'⇄',title:'P2P ask filled',detail:`${fmt(bigArg(e,'tokenAmount'),4)} METOK for ${fmt(bigArg(e,'monAmount'),8)} MON · remaining ${fmt(bigArg(e,'remainingToken'),4)}`}
    case'P2PSellOrderCancelled':return{kind:'p2p',icon:'×',title:'P2P ask cancelled',detail:`${fmt(bigArg(e,'tokenReturned'),4)} METOK returned`}
    case'P2PBuyOrderCreated':return{kind:'p2p',icon:'B',title:'P2P bid created',detail:`${fmt(bigArg(e,'monBudget'),8)} MON @ ${fmt(bigArg(e,'pricePerTokenWad'),10)} MON/METOK`}
    case'P2PBuyOrderFilled':return{kind:'p2p',icon:'⇄',title:'P2P bid filled',detail:`${fmt(bigArg(e,'tokenAmount'),4)} METOK for ${fmt(bigArg(e,'monAmount'),8)} MON · remaining ${fmt(bigArg(e,'remainingMon'),8)} MON`}
    case'P2PBuyOrderCancelled':return{kind:'p2p',icon:'×',title:'P2P bid cancelled',detail:`${fmt(bigArg(e,'monRefund'),8)} MON moved to credit`}
    case'MonCreditCreated':return{kind:'other',icon:'+',title:'MON credit created',detail:`${fmt(bigArg(e,'amount'),8)} MON · reason ${short(strArg(e,'reason'),8,6)}`}
    case'MonWithdrawn':return{kind:'other',icon:'↗',title:'MON withdrawn',detail:`${fmt(bigArg(e,'amount'),8)} MON sent to wallet`}
    default:return{kind:'other',icon:'•',title:e.name,detail:`Block ${e.blockNumber.toString()}`}
  }
}
