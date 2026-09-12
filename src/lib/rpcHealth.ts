import { RPC_URLS } from './config'

export type RpcHealth={url:string;host:string;ok:boolean;latencyMs:number;chainId?:number;blockNumber?:bigint;checkedAt:number;error?:string}
let snapshot:RpcHealth[]=[]

async function rpc(url:string,method:string,signal:AbortSignal){
  const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]}),signal,cache:'no-store'})
  if(!res.ok) throw new Error(`HTTP ${res.status}`)
  const body=await res.json()
  if(body.error) throw new Error(body.error.message||'RPC error')
  return body.result as string
}
function host(url:string){try{return new URL(url).host}catch{return url}}
export async function probeRpc(url:string):Promise<RpcHealth>{
  const start=performance.now();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5_000)
  try{
    const [chainHex,blockHex]=await Promise.all([rpc(url,'eth_chainId',controller.signal),rpc(url,'eth_blockNumber',controller.signal)])
    const chainId=Number(BigInt(chainHex));const blockNumber=BigInt(blockHex)
    return {url,host:host(url),ok:chainId===143,latencyMs:Math.round(performance.now()-start),chainId,blockNumber,checkedAt:Date.now(),error:chainId===143?undefined:`chain ${chainId}`}
  }catch(e){
    return {url,host:host(url),ok:false,latencyMs:Math.round(performance.now()-start),checkedAt:Date.now(),error:e instanceof Error?e.message:String(e)}
  }finally{clearTimeout(timer)}
}
export async function probeAllRpcs(){
  snapshot=(await Promise.all(RPC_URLS.map(probeRpc))).sort((a,b)=>Number(b.ok)-Number(a.ok)||a.latencyMs-b.latencyMs)
  return snapshot
}
export function rpcHealthSnapshot(){return snapshot}
