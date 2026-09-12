export type TxStatus = 'wallet'|'pending'|'confirmed'|'failed'
export type TxRecord = {
  id:string
  label:string
  detail?:string
  hash?:`0x${string}`
  status:TxStatus
  createdAt:number
  updatedAt:number
  error?:string
}

const KEY='metok-v4-transactions-v1'
const EVENT='metok:transactions'
const MAX_ITEMS=20

function load():TxRecord[]{
  try{
    const raw=localStorage.getItem(KEY)
    const parsed=raw?JSON.parse(raw):[]
    return Array.isArray(parsed)?parsed.slice(0,MAX_ITEMS):[]
  }catch{return []}
}
function save(items:TxRecord[]){
  try{localStorage.setItem(KEY,JSON.stringify(items.slice(0,MAX_ITEMS)))}catch{}
  window.dispatchEvent(new CustomEvent(EVENT))
}
export function getTransactions(){return typeof window==='undefined'?[]:load()}
export function beginTransaction(label:string,detail?:string){
  const now=Date.now();const id=`${now}-${Math.random().toString(36).slice(2,8)}`
  const item:TxRecord={id,label,detail,status:'wallet',createdAt:now,updatedAt:now}
  save([item,...load()]);return id
}
function patch(id:string,next:Partial<TxRecord>){
  const items=load().map(x=>x.id===id?{...x,...next,updatedAt:Date.now()}:x);save(items)
}
export function markSubmitted(id:string,hash:`0x${string}`){patch(id,{hash,status:'pending'})}
export function markConfirmed(id:string){patch(id,{status:'confirmed'})}
export function markFailed(id:string,error:string){patch(id,{status:'failed',error})}
export function clearTransactions(){save([])}
export const TX_EVENT=EVENT
