import { decodeEventLog, getAddress, keccak256, padHex, toBytes, type Address, type Hex } from 'viem'
import { METOK_ABI } from './abi'
import { CONTRACT_ADDRESS, publicClient } from './config'

export type ChainEvent = {
  id:string
  name:string
  blockNumber:bigint
  transactionHash:Hex
  logIndex:number
  args:Record<string,string|boolean>
  timestamp?:number
}

export type EventSyncProgress = { phase:'locate'|'logs'|'hydrate'; from?:bigint; to?:bigint; current?:bigint; message:string }

const eventSignatures:Record<string,string>={
  PlaySubmitted:'PlaySubmitted(uint256,address,uint256,uint32,uint256,uint64,uint64,uint256)',
  PlaySettled:'PlaySettled(uint256,address,bool,bool,bytes32,uint32,uint256,uint256,uint256,uint256)',
  RewardClaimed:'RewardClaimed(uint256,address,uint256)',
  ProtocolSellSubmitted:'ProtocolSellSubmitted(uint256,address,uint256,uint256,uint64)',
  ProtocolSellSettled:'ProtocolSellSettled(uint256,address,uint256,uint256,uint256,uint256)',
  ProtocolSellCancelled:'ProtocolSellCancelled(uint256,address,uint256,bytes32)',
  MonCreditCreated:'MonCreditCreated(address,uint256,bytes32)',
  MonWithdrawn:'MonWithdrawn(address,uint256)',
  P2PSellOrderCreated:'P2PSellOrderCreated(uint256,address,uint256,uint256)',
  P2PSellOrderFilled:'P2PSellOrderFilled(uint256,address,address,uint256,uint256,uint256)',
  P2PSellOrderCancelled:'P2PSellOrderCancelled(uint256,address,uint256)',
  P2PBuyOrderCreated:'P2PBuyOrderCreated(uint256,address,uint256,uint256)',
  P2PBuyOrderFilled:'P2PBuyOrderFilled(uint256,address,address,uint256,uint256,uint256)',
  P2PBuyOrderCancelled:'P2PBuyOrderCancelled(uint256,address,uint256)',
  EntropyRandomReady:'EntropyRandomReady(uint256,uint64,uint256)',
  EntropyCallbackIgnored:'EntropyCallbackIgnored(uint64,uint256,bytes32)'
}

const topic=(name:string)=>keccak256(toBytes(eventSignatures[name]))
const topicNames=Object.fromEntries(Object.keys(eventSignatures).map(n=>[topic(n).toLowerCase(),n])) as Record<string,string>
const allTopics=Object.keys(eventSignatures).filter(n=>!n.startsWith('Entropy')).map(topic)
const topic2WalletNames=[
  'PlaySubmitted','PlaySettled','RewardClaimed','ProtocolSellSubmitted','ProtocolSellSettled','ProtocolSellCancelled',
  'P2PSellOrderCreated','P2PSellOrderFilled','P2PSellOrderCancelled','P2PBuyOrderCreated','P2PBuyOrderFilled','P2PBuyOrderCancelled'
]
const topic1WalletNames=['MonCreditCreated','MonWithdrawn']
const topic3WalletNames=['P2PSellOrderFilled','P2PBuyOrderFilled']
const REORG_BUFFER=256n
const DEPLOY_BLOCK_ENV=(import.meta.env.VITE_DEPLOYMENT_BLOCK||'').trim()
const EVENT_RPC_URLS:string[]=Array.from(new Set<string>(
  (import.meta.env.VITE_EVENT_RPC_URLS||'https://rpc1.monad.xyz,https://rpc3.monad.xyz,https://rpc.monad.xyz')
    .split(',')
    .map((x:string)=>x.trim())
    .filter(Boolean)
))

function safeArgs(input:unknown):Record<string,string|boolean>{
  const out:Record<string,string|boolean>={}
  if(!input||typeof input!=='object') return out
  for(const [k,v] of Object.entries(input as Record<string,unknown>)){
    if(typeof v==='bigint') out[k]=v.toString()
    else if(typeof v==='boolean'||typeof v==='string') out[k]=v
    else if(typeof v==='number') out[k]=String(v)
  }
  return out
}

function decodeRaw(log:any):ChainEvent|undefined{
  try{
    const decoded=decodeEventLog({abi:METOK_ABI,data:log.data,topics:log.topics,strict:false}) as any
    if(!decoded?.eventName||log.blockNumber==null||!log.transactionHash) return
    return {
      id:`${log.transactionHash}:${Number(log.logIndex||0)}`,
      name:decoded.eventName,
      blockNumber:BigInt(log.blockNumber),
      transactionHash:log.transactionHash,
      logIndex:Number(log.logIndex||0),
      args:safeArgs(decoded.args)
    }
  }catch{
    const name=topicNames[String(log?.topics?.[0]||'').toLowerCase()]
    if(!name) return
  }
}

function dedupe(events:ChainEvent[]){
  const map=new Map<string,ChainEvent>()
  for(const e of events) map.set(e.id,e)
  return [...map.values()].sort((a,b)=>a.blockNumber===b.blockNumber?b.logIndex-a.logIndex:a.blockNumber>b.blockNumber?-1:1)
}

function walletTopic(address:Address){return padHex(getAddress(address),{size:32})}

async function rawGetLogs(fromBlock:bigint,toBlock:bigint,topics:any[]):Promise<any[]>{
  if(!CONTRACT_ADDRESS) throw new Error('The contract address is not configured.')

  const params=[{
    address:CONTRACT_ADDRESS,
    fromBlock:`0x${fromBlock.toString(16)}`,
    toBlock:`0x${toBlock.toString(16)}`,
    topics
  }]

  let lastError:unknown

  for(const url of EVENT_RPC_URLS){
    try{
      const controller=new AbortController()
      const timer=setTimeout(()=>controller.abort(),10_000)

      try{
        const response=await fetch(url,{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({
            jsonrpc:'2.0',
            id:1,
            method:'eth_getLogs',
            params
          }),
          signal:controller.signal
        })

        const json=await response.json() as {
          result?:any[]
          error?:{code?:number;message?:string}
        }

        if(response.ok && Array.isArray(json.result)) return json.result

        lastError=new Error(
          json.error?.message||
          `Event RPC returned HTTP ${response.status}`
        )
      }finally{
        clearTimeout(timer)
      }
    }catch(e){
      lastError=e
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('All event RPC endpoints failed.')
}

async function scanAdaptive(fromBlock:bigint,toBlock:bigint,topics:any[],onProgress?: (p:EventSyncProgress)=>void){
  if(fromBlock>toBlock) return [] as ChainEvent[]
  let cursor=fromBlock
  let chunk=100_000n
  const minChunk=100n,maxChunk=100_000n
  const out:ChainEvent[]=[]
  while(cursor<=toBlock){
    const end=cursor+chunk-1n<toBlock?cursor+chunk-1n:toBlock
    onProgress?.({phase:'logs',from:fromBlock,to:toBlock,current:cursor,message:`Scanning blocks ${cursor.toString()} → ${end.toString()}`})
    try{
      const logs=await rawGetLogs(cursor,end,topics)
      for(const log of logs){const e=decodeRaw(log);if(e)out.push(e)}
      cursor=end+1n
      if(logs.length<500 && chunk<maxChunk) chunk=chunk*2n>maxChunk?maxChunk:chunk*2n
      else if(logs.length>5_000 && chunk>minChunk) chunk=chunk/2n<minChunk?minChunk:chunk/2n
    }catch(e){
      if(chunk<=minChunk) throw e
      chunk=chunk/4n<minChunk?minChunk:chunk/4n
    }
  }
  return dedupe(out)
}

const deployKey=()=>`metok:v5:deploy-block:${CONTRACT_ADDRESS||'none'}`
export async function locateDeploymentBlock(deployedAt:bigint,onProgress?: (p:EventSyncProgress)=>void):Promise<bigint>{
  if(DEPLOY_BLOCK_ENV && /^\d+$/.test(DEPLOY_BLOCK_ENV)) return BigInt(DEPLOY_BLOCK_ENV)
  try{const cached=localStorage.getItem(deployKey());if(cached&&/^\d+$/.test(cached))return BigInt(cached)}catch{}
  const latest=await publicClient.getBlockNumber()
  let low=0n,high=latest
  onProgress?.({phase:'locate',message:'Locating the deployment block from DEPLOYED_AT…'})
  while(low<high){
    const mid=(low+high)/2n
    const b=await publicClient.getBlock({blockNumber:mid})
    if(b.timestamp<deployedAt) low=mid+1n; else high=mid
  }
  try{localStorage.setItem(deployKey(),low.toString())}catch{}
  return low
}

type CachedWalletEvents={syncedTo:string;deployBlock:string;events:Array<Omit<ChainEvent,'blockNumber'> & {blockNumber:string}>}
function walletCacheKey(address:Address){return `metok:v5:wallet-events:${CONTRACT_ADDRESS}:${getAddress(address).toLowerCase()}`}
function loadWalletCache(address:Address):{syncedTo:bigint;deployBlock:bigint;events:ChainEvent[]}|undefined{
  try{
    const raw=localStorage.getItem(walletCacheKey(address));if(!raw)return
    const p=JSON.parse(raw) as CachedWalletEvents
    return {syncedTo:BigInt(p.syncedTo),deployBlock:BigInt(p.deployBlock),events:p.events.map(e=>({...e,blockNumber:BigInt(e.blockNumber)}))}
  }catch{return}
}
function saveWalletCache(address:Address,syncedTo:bigint,deployBlock:bigint,events:ChainEvent[]){
  try{
    const serial:CachedWalletEvents={syncedTo:syncedTo.toString(),deployBlock:deployBlock.toString(),events:events.map(e=>({...e,blockNumber:e.blockNumber.toString()}))}
    localStorage.setItem(walletCacheKey(address),JSON.stringify(serial))
  }catch{}
}

export async function syncWalletEvents(address:Address,deployedAt:bigint,onProgress?: (p:EventSyncProgress)=>void):Promise<ChainEvent[]>{
  const latest=await publicClient.getBlockNumber()
  const cached=loadWalletCache(address)
  const deployBlock=cached?.deployBlock??await locateDeploymentBlock(deployedAt,onProgress)
  const rewind=cached&&cached.syncedTo>REORG_BUFFER?cached.syncedTo-REORG_BUFFER:deployBlock
  const from=rewind>deployBlock?rewind:deployBlock
  const wt=walletTopic(address)
  const topic1=await scanAdaptive(from,latest,[topic1WalletNames.map(topic),wt],onProgress)
  const topic2=await scanAdaptive(from,latest,[topic2WalletNames.map(topic),null,wt],onProgress)
  const topic3=await scanAdaptive(from,latest,[topic3WalletNames.map(topic),null,null,wt],onProgress)
  const kept=(cached?.events||[]).filter(e=>e.blockNumber<from)
  const merged=dedupe([...kept,...topic1,...topic2,...topic3])
  saveWalletCache(address,latest,deployBlock,merged)
  return merged
}

export async function loadRecentProtocolEvents(blockWindow=500_000n,onProgress?: (p:EventSyncProgress)=>void):Promise<ChainEvent[]>{
  const latest=await publicClient.getBlockNumber()
  const from=latest>blockWindow?latest-blockWindow:0n
  return scanAdaptive(from,latest,[allTopics],onProgress)
}

const blockTimeKey=()=>`metok:v5:block-times:${CONTRACT_ADDRESS||'none'}`
function loadBlockTimes():Record<string,number>{try{return JSON.parse(localStorage.getItem(blockTimeKey())||'{}')}catch{return {}}}
function saveBlockTimes(x:Record<string,number>){try{const entries=Object.entries(x).slice(-500);localStorage.setItem(blockTimeKey(),JSON.stringify(Object.fromEntries(entries)))}catch{}}

export async function hydrateEventTimestamps(events:ChainEvent[],maxEvents=120,onProgress?: (p:EventSyncProgress)=>void){
  const top=events.slice(0,maxEvents)
  const cache=loadBlockTimes()
  const missing=Array.from(new Set(top.map(e=>e.blockNumber.toString()).filter(n=>cache[n]===undefined)))
  onProgress?.({phase:'hydrate',message:`Loading timestamps for ${missing.length} blocks…`})
  for(let i=0;i<missing.length;i+=8){
    const part=missing.slice(i,i+8)
    const rows=await Promise.all(part.map(async n=>[n,Number((await publicClient.getBlock({blockNumber:BigInt(n)})).timestamp)] as const))
    for(const [n,t] of rows)cache[n]=t
  }
  saveBlockTimes(cache)
  return events.map(e=>cache[e.blockNumber.toString()]?{...e,timestamp:cache[e.blockNumber.toString()]}:e)
}

export function bigArg(e:ChainEvent,key:string){const v=e.args[key];return typeof v==='string'&&/^\d+$/.test(v)?BigInt(v):0n}
export function strArg(e:ChainEvent,key:string){const v=e.args[key];return typeof v==='string'?v:''}
export function boolArg(e:ChainEvent,key:string){return e.args[key]===true}
export function eventAddressMatches(e:ChainEvent,key:string,address:Address){const v=strArg(e,key);return !!v&&v.toLowerCase()===address.toLowerCase()}
