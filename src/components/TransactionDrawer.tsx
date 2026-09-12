import { useEffect, useMemo, useState } from 'react'
import { EXPLORER_URL } from '../lib/config'
import { clearTransactions, getTransactions, TX_EVENT, type TxRecord } from '../lib/tx'
import { short } from '../lib/format'

export function TransactionDrawer(){
  const [open,setOpen]=useState(false);const [items,setItems]=useState<TxRecord[]>(()=>getTransactions())
  useEffect(()=>{const sync=()=>setItems(getTransactions());window.addEventListener(TX_EVENT,sync);window.addEventListener('storage',sync);return()=>{window.removeEventListener(TX_EVENT,sync);window.removeEventListener('storage',sync)}},[])
  const active=useMemo(()=>items.filter(x=>x.status==='wallet'||x.status==='pending').length,[items])
  return <>
    <button className={`tx-fab ${active?'active':''}`} onClick={()=>setOpen(true)} aria-label="Open transaction center"><span>↗</span><b>{active||items.length}</b></button>
    {open&&<div className="drawer-backdrop" onMouseDown={()=>setOpen(false)}><aside className="tx-drawer" onMouseDown={(e:any)=>e.stopPropagation()}>
      <div className="drawer-head"><div><span>TRANSACTION CENTER</span><h3>Wallet activity</h3></div><button onClick={()=>setOpen(false)}>×</button></div>
      <div className="drawer-tools"><span>{active?`${active} in progress`:'No pending transactions'}</span>{items.length>0&&<button onClick={()=>{clearTransactions();setItems([])}}>Clear</button>}</div>
      <div className="tx-list">{!items.length&&<div className="tx-empty"><i>◇</i><b>No transactions yet</b><span>PLAY, Curve, and P2P transactions will appear here after you sign.</span></div>}{items.map(x=><TxRow key={x.id} tx={x}/>)}</div>
    </aside></div>}
  </>
}
function TxRow({tx}:{tx:TxRecord}){
  const status=tx.status==='wallet'?'Waiting for wallet':tx.status==='pending'?'Confirming':tx.status==='confirmed'?'Confirmed':'Failed'
  return <div className={`tx-row ${tx.status}`}><i className="tx-state">{tx.status==='confirmed'?'✓':tx.status==='failed'?'!':tx.status==='pending'?'↻':'⌁'}</i><div className="tx-copy"><b>{tx.label}</b>{tx.detail&&<span>{tx.detail}</span>}<small>{status} · {new Date(tx.updatedAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</small>{tx.error&&<em>{tx.error}</em>}</div>{tx.hash&&<a href={`${EXPLORER_URL}/tx/${tx.hash}`} target="_blank" rel="noreferrer">{short(tx.hash,5,4)} ↗</a>}</div>
}
