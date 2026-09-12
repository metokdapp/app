import { createWalletClient, custom, getAddress, type Address } from 'viem'
import { monad, RPC_URLS, EXPLORER_URL } from './config'

export type Eip1193Provider = {
  request(args:{method:string;params?:unknown[]|object}):Promise<unknown>
}

type MetaMaskClient = {
  connect(options?:{chainIds?:`0x${string}`[]}):Promise<{accounts:string[];chainId?:string}>
  disconnect():Promise<void>
  getProvider():Eip1193Provider
  switchChain(options:{chainId:`0x${string}`;chainConfiguration?:Record<string,unknown>}):Promise<void>
}

type WalletEvents={accountsChanged:(accounts:string[])=>void;chainChanged:(chainId:string)=>void}
const subscribers=new Set<Partial<WalletEvents>>()
let clientPromise:Promise<MetaMaskClient>|undefined
let activeProvider:Eip1193Provider|undefined

function emit<K extends keyof WalletEvents>(name:K,value:Parameters<WalletEvents[K]>[0]){
  for(const sub of subscribers){
    const fn=sub[name] as ((v:typeof value)=>void)|undefined
    try{fn?.(value)}catch{}
  }
}

function dappUrl(){
  if(typeof window==='undefined')return 'https://metok.app'
  return window.location.href
}

async function metaMaskClient():Promise<MetaMaskClient>{
  if(!clientPromise){
    clientPromise=(async()=>{
      const {createEVMClient}=await import('@metamask/connect-evm')
      const client=await createEVMClient({
        dapp:{name:'METOK',url:dappUrl()},
        api:{supportedNetworks:{'0x8f':RPC_URLS[0]}},
        analytics:{enabled:false},
        eventHandlers:{
          accountsChanged:(accounts:string[])=>emit('accountsChanged',accounts),
          chainChanged:(chainId:string)=>emit('chainChanged',chainId),
        },
      } as any)
      activeProvider=client.getProvider() as Eip1193Provider
      return client as unknown as MetaMaskClient
    })()
  }
  return clientPromise
}

export function watchWallet(events:Partial<WalletEvents>){subscribers.add(events);return()=>subscribers.delete(events)}

export async function restoreWallet():Promise<Address|undefined>{
  try{
    const client=await metaMaskClient()
    const provider=client.getProvider()
    activeProvider=provider
    const accounts=await provider.request({method:'eth_accounts',params:[]}) as string[]
    return accounts?.[0]?getAddress(accounts[0]):undefined
  }catch{return undefined}
}

export async function connectWallet():Promise<Address>{
  const client=await metaMaskClient()
  const result=await client.connect({chainIds:['0x8f']})
  activeProvider=client.getProvider()
  const account=result.accounts?.[0]
  if(!account) throw new Error('MetaMask has not granted account access.')
  await ensureMonad()
  return getAddress(account)
}

export async function disconnectWallet(){
  try{const client=await metaMaskClient();await client.disconnect()}finally{activeProvider=undefined;emit('accountsChanged',[])}
}

export async function ensureMonad(){
  const client=await metaMaskClient()
  await client.switchChain({
    chainId:'0x8f',
    chainConfiguration:{
      chainId:'0x8f',chainName:'Monad Mainnet',
      nativeCurrency:{name:'Monad',symbol:'MON',decimals:18},
      rpcUrls:RPC_URLS,blockExplorerUrls:[EXPLORER_URL],
    },
  })
  activeProvider=client.getProvider()
}

export function walletClient(account:Address){
  if(!activeProvider) throw new Error('MetaMask is not connected. Connect MetaMask first.')
  return createWalletClient({account,chain:monad,transport:custom(activeProvider as any)})
}

export function metaMaskDappDeepLink(){
  if(typeof window==='undefined')return 'https://link.metamask.io/'
  const url=window.location.href.replace(/^https?:\/\//,'')
  return `https://link.metamask.io/dapp/${url}`
}
