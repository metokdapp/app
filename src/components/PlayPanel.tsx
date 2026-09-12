import { useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { decodeEventLog } from 'viem'
import { METOK_ABI } from '../lib/abi'
import { CONTRACT_ADDRESS, EXPLORER_URL } from '../lib/config'
import { deadline3m, errorText, fmt, minOut, parse18, randomBytes32 } from '../lib/format'
import { readContract, type ProtocolState } from '../lib/protocol'
import { writeContractTx } from '../lib/write'
import { Badge, Button, Card, Field, Label, MiniStat, Spinner } from './Ui'
import { QueueHead } from './QueueHead'

export function PlayPanel({p,address,onRefresh}:{p?:ProtocolState,address?:Address,onRefresh:()=>Promise<void>|void}){
  const [amount,setAmount]=useState('1'); const [card,setCard]=useState(0); const [slip,setSlip]=useState(100)
  const [quote,setQuote]=useState<bigint>(); const [busy,setBusy]=useState(false); const [msg,setMsg]=useState('')
  const wager=useMemo(()=>{try{return parse18(amount)}catch{return 0n}},[amount])
  useEffect(()=>{let alive=true;(async()=>{try{const q=wager?await readContract('quotePlay',[wager]):0n;if(alive)setQuote(q)}catch{if(alive)setQuote(undefined)}})();return()=>{alive=false}},[wager])
  const minimum=quote?minOut(quote,slip):0n
  const feeBps=wager&&p?.entropyFee?p.entropyFee*10_000n/wager:0n
  const feeRatio=feeBps?`${(Number(feeBps)/100).toFixed(2)}%`:'—'

  async function submit(){
    if(!address||!CONTRACT_ADDRESS||!wager) return setMsg('Connect your wallet and enter a valid wager.')
    setBusy(true);setMsg('')
    try{
      const [freshQuote,fee]=await Promise.all([readContract('quotePlay',[wager]) as Promise<bigint>,readContract('entropyFee') as Promise<bigint>])
      const minToken=minOut(freshQuote,slip)
      const {hash,receipt}=await writeContractTx({account:address,functionName:'submitPlay',args:[wager,card,randomBytes32(),minToken,deadline3m()],value:wager+fee,label:'PLAY METOK',detail:`${amount} MON · card ${card+1}`})
      const log=receipt.logs.find((l:any)=>{try{return decodeEventLog({abi:METOK_ABI,data:l.data,topics:l.topics}).eventName==='PlaySubmitted'}catch{return false}})
      let suffix=''
      if(log){const d=decodeEventLog({abi:METOK_ABI,data:log.data,topics:log.topics}); const args=d.args as any; suffix=` · order #${args.orderId}`}
      setMsg(`PLAY entered the FIFO queue${suffix}. Tx ${hash.slice(0,10)}… The oracle fee is separate from the wager.`); await onRefresh()
    }catch(e){setMsg(errorText(e))}finally{setBusy(false)}
  }
  async function settle(){
    if(!address||!CONTRACT_ADDRESS)return
    setBusy(true);setMsg('')
    try{await writeContractTx({account:address,functionName:'settleReadyCurveOrders',args:[8n],label:'Settle FIFO',detail:'Up to 8 ready orders'});setMsg('Settled the ready orders (up to 8).');await onRefresh()}catch(e){setMsg(errorText(e))}finally{setBusy(false)}
  }
  return <div className="two-col">
    <Card className="play-card">
      <div className="section-head"><div><Label>PYTH ENTROPY V2</Label><h2>PLAY METOK</h2></div><Badge ok>{p?.cardCount||3} cards</Badge></div>
      <p className="muted">Choose a card. The random contribution is generated in your browser and Entropy verifies the result; if you win, METOK is requoted when your FIFO turn is reached. `minTokenOut` protects against adverse execution.</p>
      <div className="cards-choice">{Array.from({length:Math.min(p?.cardCount||3,12)},(_,i)=><button key={i} className={card===i?'selected':''} onClick={()=>setCard(i)}><span>{String(i+1).padStart(2,'0')}</span><b>Card {i+1}</b><em>{card===i?'SELECTED':'PICK'}</em></button>)}</div>
      <Field label="Wager (MON)" hint="The oracle fee is refreshed immediately before signing and added separately to msg.value."><input value={amount} onChange={(e:any)=>setAmount(e.target.value)} inputMode="decimal" placeholder="1.0"/></Field>
      <Field label={`Slippage ${slip/100}%`}><input className="range" type="range" min="0" max="500" step="25" value={slip} onChange={(e:any)=>setSlip(Number(e.target.value))}/></Field>
      <div className="quote-grid play-quotes"><MiniStat label="Win quote now" value={`${fmt(quote,4)} METOK`}/><MiniStat label="minTokenOut" value={`${fmt(minimum,4)} METOK`}/><MiniStat label="Oracle fee" value={`${fmt(p?.entropyFee,8)} MON`}/><MiniStat label="Fee / wager" value={feeRatio}/><MiniStat label="Deadline" value="3 min"/><MiniStat label="Settlement" value="Strict FIFO"/></div>
      {feeBps>1000n&&<div className="risk-banner">The oracle fee is currently more than 10% of the wager. Consider increasing the wager or waiting for the fee to decrease before signing.</div>}
      <Button className="wide primary action-xl" onClick={submit} disabled={busy||!address||!wager}>{busy?<><Spinner/> Processing</>:'PLAY ON-CHAIN'}</Button>
      {msg&&<div className="notice">{msg}</div>}
    </Card>
    <div className="stack">
      <Card><div className="section-head"><div><Label>FIFO KEEPER</Label><h3>Permissionless settlement</h3></div><Badge ok={!!p?.canSettle}>{p?.canSettle?'Ready':'Watching'}</Badge></div><div className="queue-big"><strong>{p?String(p.nextCurve-p.nextSettle):'—'}</strong><span>orders pending</span></div><QueueHead head={p?.head} canSettle={p?.canSettle}/><Button className="wide secondary" onClick={settle} disabled={busy||!address||!p?.canSettle}>Settle ready queue</Button></Card>
      <Card><Label>ANTI-OPTION RULE</Label><h3>Timeout only if randomness has not arrived</h3><p className="muted">If Entropy has not called back before the deadline, the wager becomes MON credit. Once randomness is ready, PLAY must still settle even after the deadline — a player cannot keep wins while timing out losses.</p><div className="row-line"><span>Order lifetime</span><b>{p?`${Number(p.minOrderLifetime)/60}–${Number(p.maxOrderLifetime)/60} min`:'—'}</b></div><a className="ghost-link" href={`${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Verify contract ↗</a></Card>
    </div>
  </div>
}
