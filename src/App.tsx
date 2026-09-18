import { useCallback, useEffect, useState } from 'react'
import { getAddress, type Address } from 'viem'
import { CONTRACT_ADDRESS, EXPLORER_URL, monad } from './lib/config'
import { errorText, short } from './lib/format'
import { loadProtocol, type ProtocolState } from './lib/protocol'
import { connectWallet, disconnectWallet, ensureMonad, metaMaskDappDeepLink, restoreWallet, watchWallet } from './lib/wallet'
import { ActivityPanel } from './components/ActivityPanel'
import { Overview } from './components/Overview'
import { P2PPanel } from './components/P2PPanel'
import { PortfolioPanel } from './components/PortfolioPanel'
import { PlayPanel } from './components/PlayPanel'
import { SecurityPanel } from './components/SecurityPanel'
import { TradePanel } from './components/TradePanel'
import { TransactionDrawer } from './components/TransactionDrawer'
import { WalletButton } from './components/WalletButton'

const tabs=['overview','portfolio','play','trade','p2p','activity','security'] as const
type Tab=typeof tabs[number]

export default function App(){
 const [tab,setTab]=useState<Tab>('overview'); const [address,setAddress]=useState<Address>(); const [connecting,setConnecting]=useState(false); const [p,setP]=useState<ProtocolState>(); const [err,setErr]=useState(''); const [refreshing,setRefreshing]=useState(false);const[online,setOnline]=useState(navigator.onLine)
 const refresh=useCallback(async()=>{if(!CONTRACT_ADDRESS){setErr('Contract is not configured.');return}setRefreshing(true);try{setP(await loadProtocol(address));setErr('')}catch(e){setErr(errorText(e))}finally{setRefreshing(false)}},[address])
 useEffect(()=>{void refresh();const id=setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine)void refresh()},12000);const focus=()=>void refresh();window.addEventListener('focus',focus);return()=>{clearInterval(id);window.removeEventListener('focus',focus)}},[refresh])
 useEffect(()=>{let alive=true;const unwatch=watchWallet({accountsChanged:(arr)=>{if(alive)setAddress(arr[0]?getAddress(arr[0]):undefined)},chainChanged:()=>void refresh()});void restoreWallet().then((a)=>{if(alive&&a)setAddress(a)});return()=>{alive=false;unwatch()}},[refresh])
 useEffect(()=>{const on=()=>setOnline(true),off=()=>setOnline(false);window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off)}},[])
 async function connect(){setConnecting(true);try{setAddress(await connectWallet());setErr('')}catch(e){setErr(errorText(e))}finally{setConnecting(false)}} async function disconnect(){setConnecting(true);try{await disconnectWallet();setAddress(undefined);setErr('')}catch(e){setErr(errorText(e))}finally{setConnecting(false)}}
 return <div className="app-shell"><div className="ambient a1"/><div className="ambient a2"/><header className="topbar"><button className="brand" onClick={()=>setTab('overview')}><span className="brand-mark">M</span><span><b>METOK</b><small>MAINNET</small></span></button><nav className="desktop-nav">{tabs.map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{label(t)}</button>)}</nav><div className="top-actions"><span className={`net-pill ${online?'online':'offline'}`}><i/>{online?'ONLINE':'OFFLINE'}</span><WalletButton address={address} connecting={connecting} onConnect={connect} onDisconnect={disconnect}/></div></header>{!CONTRACT_ADDRESS&&<div className="config-warning"><b>Deployment address required.</b> Set <code>VITE_METOK_CONTRACT</code> in the build environment.</div>}{err&&<div className="global-error"><b>RPC / wallet:</b> {err}</div>}{!address&&<div className="wallet-bridge"><span><b>MetaMask Connect</b> supports the browser extension, MetaMask app browser, and Chrome mobile.</span><a href={metaMaskDappDeepLink()} target="_blank" rel="noreferrer">Open in MetaMask ↗</a></div>}<main>{tab==='overview'&&<Overview p={p} address={address} onPlay={()=>setTab('play')}/>} {tab==='portfolio'&&<PortfolioPanel p={p} address={address} onRefresh={refresh}/>} {tab==='play'&&<PlayPanel p={p} address={address} onRefresh={refresh}/>} {tab==='trade'&&<TradePanel p={p} address={address} onRefresh={refresh}/>} {tab==='p2p'&&<P2PPanel p={p} address={address} onRefresh={refresh}/>} {tab==='activity'&&<ActivityPanel p={p} address={address}/>} {tab==='security'&&<SecurityPanel p={p}/>}</main><nav className="mobile-nav">{tabs.map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}><span>{icon(t)}</span>{label(t)}</button>)}</nav><TransactionDrawer/><footer><span><i className={p?.bucketsOk&&p?.solvent?'live':''}/> METOK · {monad.name}</span><span>Block {p?.blockNumber?.toString()||'—'}</span><a href={`${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">{short(CONTRACT_ADDRESS,8,6)}</a><button onClick={()=>{void ensureMonad()}}>Chain 143</button><span>{refreshing?'Syncing…':'12s live sync'}</span>
<a href="mailto:lanhchienax@gmail.com">Official Contact: lanhchienax@gmail.com</a>
<a href="https://x.com/MetokProtocol" target="_blank" rel="noreferrer">X: @MetokProtocol</a>
<a href="https://t.me/MetokProtocol" target="_blank" rel="noreferrer">Telegram: @MetokProtocol</a>
</footer></div>
}
function label(t:Tab){return({overview:'Overview',portfolio:'Portfolio',play:'PLAY',trade:'Curve',p2p:'P2P',activity:'History',security:'Security'})[t]}
function icon(t:Tab){return({overview:'◫',portfolio:'◎',play:'◆',trade:'↕',p2p:'⇄',activity:'◷',security:'◇'})[t]}
