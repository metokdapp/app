import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import { EXPLORER_URL } from '../lib/config'
import { type EventSyncProgress, hydrateEventTimestamps } from '../lib/events'
import { errorText, fmt, short } from '../lib/format'
import { loadPortfolio, type Portfolio } from '../lib/portfolio'
import type { ProtocolState } from '../lib/protocol'
import { writeContractTx } from '../lib/write'
import { Badge, Button, Card, Label, MiniStat, Spinner } from './Ui'

export function PortfolioPanel({p,address,onRefresh}:{p?:ProtocolState,address?:Address,onRefresh:()=>Promise<void>|void}){
  const [portfolio,setPortfolio]=useState<Portfolio>();const[busy,setBusy]=useState(false);const[loading,setLoading]=useState(false);const[msg,setMsg]=useState('');const[progress,setProgress]=useState('')
  const sync=useCallback(async()=>{
    if(!address||!p?.deployedAt){setPortfolio(undefined);return}
    setLoading(true);setMsg('')
    try{
      const onProgress=(x:EventSyncProgress)=>setProgress(x.message)
      const data=await loadPortfolio(address,p.deployedAt,onProgress)
      data.events=await hydrateEventTimestamps(data.events,80,onProgress)
      setPortfolio(data);setProgress('')
    }catch(e){setMsg(errorText(e));setProgress('')}
    finally{setLoading(false)}
  },[address,p?.deployedAt])
  useEffect(()=>{void sync()},[sync])

  async function action(functionName:string,args:readonly unknown[],label:string,detail:string){
    if(!address)return;setBusy(true);setMsg('')
    try{await writeContractTx({account:address,functionName,args,label,detail});await onRefresh();await sync()}
    catch(e){setMsg(errorText(e))}finally{setBusy(false)}
  }

  if(!address) return <Card><Label>PORTFOLIO</Label><h2>Connect your wallet to build your on-chain portfolio</h2><p className="muted">The dApp scans events for your wallet from the deployment block, then verifies the current state directly from the contract mappings.</p></Card>

  return <div className="portfolio-page">
    <div className="portfolio-hero">
      <div><Label>ON-CHAIN PORTFOLIO</Label><h1>My METOK positions</h1><p>Independent of browser history. Events discover candidate positions, while contract state determines the final status.</p></div>
      <div className="portfolio-sync"><Badge ok={!loading}>{loading?'Syncing chain':'Chain indexed'}</Badge><Button className="secondary" onClick={()=>void sync()} disabled={loading}>{loading?<><Spinner/> Sync</>:'Refresh events'}</Button></div>
    </div>
    {progress&&<div className="sync-banner"><Spinner/>{progress}</div>}
    {msg&&<div className="notice">{msg}</div>}
    <div className="portfolio-summary">
      <Card><MiniStat label="Wallet METOK" value={`${fmt(p?.balance,4)} METOK`}/></Card>
      <Card><MiniStat label="MON credit" value={`${fmt(p?.credit,8)} MON`}/></Card>
      <Card><MiniStat label="Claimable" value={`${fmt(portfolio?.claimableToken,4)} METOK`}/></Card>
      <Card><MiniStat label="Pending PLAY" value={`${fmt(portfolio?.pendingPlayMon,8)} MON`}/></Card>
      <Card><MiniStat label="Curve SELL escrow" value={`${fmt(portfolio?.pendingSellToken,4)} METOK`}/></Card>
      <Card><MiniStat label="P2P escrow" value={`${fmt(portfolio?.p2pSellToken,4)} METOK · ${fmt(portfolio?.p2pBuyMon,8)} MON`}/></Card>
    </div>

    <div className="portfolio-grid">
      <Card><div className="section-head"><div><Label>REWARDS</Label><h2>Unclaimed METOK</h2></div><span className="count-pill">{portfolio?.claims.length||0}</span></div>
        <div className="my-order-list">{!portfolio?.claims.length&&<Empty text="No rewards are waiting to be claimed."/>}{portfolio?.claims.map(x=><div className="my-order" key={`claim-${x.id}`}><div><b>PLAY #{x.id.toString()}</b><span>{fmt(x.tokenAmount,4)} METOK reserved</span></div><Button onClick={()=>void action('claimReward',[x.id],'Claim METOK reward',`Curve order #${x.id}`)} disabled={busy}>Claim</Button></div>)}</div>
      </Card>
      <Card><div className="section-head"><div><Label>CURVE FIFO</Label><h2>Pending PLAY / SELL</h2></div><span className="count-pill">{(portfolio?.pendingPlays.length||0)+(portfolio?.pendingSells.length||0)}</span></div>
        <div className="my-order-list">
          {!portfolio?.pendingPlays.length&&!portfolio?.pendingSells.length&&<Empty text="No curve order is pending."/>}
          {portfolio?.pendingPlays.map(x=><div className="my-order" key={`play-${x.id}`}><div><b>PLAY #{x.id.toString()}</b><span>{fmt(x.amount,8)} MON · min {fmt(x.minOut,4)} METOK</span><small>{x.randomReady?'Random ready · waiting for FIFO':'Waiting for Entropy'} · deadline {time(x.deadline)}</small></div>{p?.nextSettle===x.id&&p?.canSettle&&<Button onClick={()=>void action('settleNextCurveOrder',[],'Settle FIFO head',`PLAY #${x.id}`)} disabled={busy}>Settle</Button>}</div>)}
          {portfolio?.pendingSells.map(x=><div className="my-order" key={`sell-${x.id}`}><div><b>SELL #{x.id.toString()}</b><span>{fmt(x.amount,4)} METOK · min {fmt(x.minOut,8)} MON</span><small>FIFO protected · deadline {time(x.deadline)}</small></div>{p?.nextSettle===x.id&&p?.canSettle&&<Button onClick={()=>void action('settleNextCurveOrder',[],'Settle FIFO head',`SELL #${x.id}`)} disabled={busy}>Settle</Button>}</div>)}
        </div>
      </Card>
      <Card><div className="section-head"><div><Label>P2P MAKER</Label><h2>My asks</h2></div><span className="count-pill">{portfolio?.p2pSells.length||0}</span></div>
        <div className="my-order-list">{!portfolio?.p2pSells.length&&<Empty text="No open asks."/>}{portfolio?.p2pSells.map(x=><div className="my-order" key={`ask-${x.id}`}><div><b>ASK #{x.id.toString()}</b><span>{fmt(x.remainingToken,4)} METOK @ {fmt(x.price,10)} MON</span></div><Button className="danger-lite" onClick={()=>void action('cancelP2PSellOrder',[x.id],'Cancel P2P ask',`Order #${x.id}`)} disabled={busy}>Cancel</Button></div>)}</div>
      </Card>
      <Card><div className="section-head"><div><Label>P2P MAKER</Label><h2>My bids</h2></div><span className="count-pill">{portfolio?.p2pBuys.length||0}</span></div>
        <div className="my-order-list">{!portfolio?.p2pBuys.length&&<Empty text="No open bids."/>}{portfolio?.p2pBuys.map(x=><div className="my-order" key={`bid-${x.id}`}><div><b>BID #{x.id.toString()}</b><span>{fmt(x.remainingMon,8)} MON @ {fmt(x.price,10)} MON/METOK</span></div><Button className="danger-lite" onClick={()=>void action('cancelP2PBuyOrder',[x.id],'Cancel P2P bid',`Order #${x.id}`)} disabled={busy}>Cancel</Button></div>)}</div>
      </Card>
    </div>
    <Card><div className="section-head"><div><Label>INDEX STATUS</Label><h2>Wallet event source</h2></div><Badge ok>Blockchain logs</Badge></div><div className="row-line"><span>Wallet</span><b>{short(address,10,8)}</b></div><div className="row-line"><span>Events indexed</span><b>{portfolio?.events.length??'—'}</b></div><div className="row-line"><span>Latest protocol block</span><b>{p?.blockNumber?.toString()||'—'}</b></div><p className="muted">The event cache is only a performance checkpoint. Every sync rescans a reorg buffer, and asset state is still verified through contract reads before display or action.</p><a className="ghost-link" href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noreferrer">View wallet on explorer ↗</a></Card>
  </div>
}
function Empty({text}:{text:string}){return <div className="empty">{text}</div>}
function time(v:bigint){return v?new Date(Number(v)*1000).toLocaleString('en-US'):'—'}
