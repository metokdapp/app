import type { Address } from 'viem'
import type { ProtocolState } from '../lib/protocol'
import { EXPLORER_URL, CONTRACT_ADDRESS } from '../lib/config'
import { compact, fmt, pctWad, short } from '../lib/format'
import { Badge, Button, Card, Label, Stat } from './Ui'
import { PriceChart } from './PriceChart'
import { QueueHead } from './QueueHead'

export function Overview({p,address,onPlay}:{p?:ProtocolState,address?:Address,onPlay:()=>void}){
  const queue=p?p.nextCurve-p.nextSettle:0n
  const perf=['1H','1D','1W','1M','1Y']
  const healthy=!!p?.hasCode&&p.ownerOk&&p.supplyOk&&p.bucketsOk&&p.solvent&&p.chainId===143
  return <>
    <div className="hero">
      <div className="hero-copy">
        <Badge ok={healthy}>{healthy?'MAINNET HEALTHY':'Verifying runtime'}</Badge>
        <h1>Liquidity by math.<br/><em>Not by admins.</em></h1>
        <p>METOK runs directly on Monad Mainnet with fixed supply, Pyth Entropy, FIFO curve execution, and two-sided P2P isolated from protocol reserves.</p>
        <div className="hero-actions"><Button onClick={onPlay}>PLAY METOK <span>↗</span></Button><a className="ghost-link" href={`${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">View contract</a></div>
        <div className="network-ribbon"><span><i className={p?.chainId===143?'on':''}/> Monad Mainnet</span><span>Block {p?.blockNumber?.toString()||'—'}</span><span>{p?.syncedAt?`sync ${new Date(p.syncedAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:'syncing…'}</span></div>
      </div>
      <Card className="price-orb">
        <Label>PROTOCOL PRICE</Label>
        <div className="price-main"><strong>{fmt(p?.price,12)}</strong><span>MON / METOK · since launch {pctWad(p?.sinceLaunch)}</span></div>
        <PriceChart p={p}/>
        <div className="perf-row">
          {perf.map((x,i)=><div key={x}><span>{x}</span><b className={(p?.changes[i]??0n)>=0n?'up':'down'}>{pctWad(p?.changes[i])}</b><small>{p?.fullWindows[i]?'full window':'launch ref'}</small></div>)}
        </div>
        <div className="contract-chip">{short(CONTRACT_ADDRESS,10,6)}</div>
      </Card>
    </div>
    <div className="stats-grid">
      <Stat label="Real MON Reserve" value={`${compact(p?.realMon)} MON`} sub={`+ ${compact(p?.virtualMon)} virtual`} />
      <Stat label="METOK circulating" value={`${compact(p?.circulating)} METOK`} sub="TOTAL_SUPPLY − curve reserve" />
      <Stat label="Curve METOK" value={`${compact(p?.curveReserve)} METOK`} sub="Protocol liquidity" />
      <Stat label="FIFO Queue" value={queue.toString()} sub={p?`head #${p.nextSettle}`:'—'} />
    </div>
    <QueueHead head={p?.head} canSettle={p?.canSettle}/>
    <div className="dashboard-grid overview-grid">
      <Card className="span-2">
        <div className="section-head"><div><Label>LIVE PROTOCOL</Label><h2>Accounting state</h2></div><Badge ok={!!p?.bucketsOk&&!!p?.solvent}>{p?.bucketsOk&&p?.solvent?'Accounting healthy':'Check required'}</Badge></div>
        <div className="metric-grid">
          <Stat label="Pending PLAY" value={`${fmt(p?.pendingPlay)} MON`}/>
          <Stat label="Claim reserved" value={`${compact(p?.claimReserve)} METOK`}/>
          <Stat label="P2P token escrow" value={`${compact(p?.p2pSellEscrow)} METOK`}/>
          <Stat label="P2P MON escrow" value={`${fmt(p?.p2pBuyEscrow)} MON`}/>
        </div>
        <div className="curve-box"><div className="curve-svg"><span/><span/><span/></div><div><b>X = 100K virtual MON + real reserve</b><p>Winning PLAY removes METOK from the curve; losing PLAY increases backing. Protocol SELL moves in the opposite direction. P2P only moves escrow and credit and never changes X/Y.</p></div></div>
      </Card>
      <Card className="wallet-card">
        <Label>YOUR WALLET</Label><h2>{address?short(address,8,6):'Not connected'}</h2>
        <div className="wallet-number"><strong>{fmt(p?.balance,4)}</strong><span>METOK</span></div>
        <div className="wallet-number small"><strong>{fmt(p?.credit,6)}</strong><span>MON credit</span></div>
        <div className="wallet-divider"/>
        <div className="row-line"><span>Entropy fee</span><b>{fmt(p?.entropyFee,8)} MON</b></div>
        <div className="row-line"><span>Cards</span><b>{p?.cardCount||'—'}</b></div>
        <Button className="wide" onClick={onPlay}>Open PLAY</Button>
      </Card>
      <Card className="span-3 security-strip">
        <div><i>01</i><b>Owner = 0x0</b><span>No admin / upgrade / pause.</span></div>
        <div><i>02</i><b>Fixed 100B</b><span>No mint path after deployment.</span></div>
        <div><i>03</i><b>Pull payouts</b><span>MON credit is withdrawn by the user.</span></div>
        <div><i>04</i><b>Two-sided P2P</b><span>Buy and sell orders do not change the curve.</span></div>
      </Card>
    </div>
  </>
}
