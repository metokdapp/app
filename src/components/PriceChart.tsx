import type { ProtocolState } from '../lib/protocol'
import { fmt } from '../lib/format'

export function PriceChart({p}:{p?:ProtocolState}){
  if(!p) return <div className="chart-skeleton">Reading on-chain checkpoints…</div>
  const history=[
    {label:'1Y',price:p.referencePrices[4],time:p.referenceTimestamps[4]},
    {label:'1M',price:p.referencePrices[3],time:p.referenceTimestamps[3]},
    {label:'1W',price:p.referencePrices[2],time:p.referenceTimestamps[2]},
    {label:'1D',price:p.referencePrices[1],time:p.referenceTimestamps[1]},
    {label:'1H',price:p.referencePrices[0],time:p.referenceTimestamps[0]},
    {label:'NOW',price:p.price,time:BigInt(Math.floor(p.syncedAt/1000))}
  ]
  const values=history.map(x=>x.price)
  let min=values[0],max=values[0]
  for(const v of values){if(v<min)min=v;if(v>max)max=v}
  const range=max-min
  const xy=history.map((x,i)=>{
    const px=i*(100/(history.length-1))
    const scaled=range===0n?5000n:(x.price-min)*10_000n/range
    const py=86-(Number(scaled)/10_000)*68
    return {x:px,y:py,...x}
  })
  const line=xy.map((p,i)=>`${i?'L':'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
  const area=`${line} L 100 94 L 0 94 Z`
  return <div className="price-chart-wrap">
    <div className="chart-head"><div><span>ON-CHAIN CHECKPOINTS</span><b>{fmt(p.price,12)} MON</b></div><small>{p.fullWindows.filter(Boolean).length}/5 full windows</small></div>
    <svg className="price-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="METOK on-chain checkpoint price chart">
      <defs><linearGradient id="metokArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".19"/><stop offset="100%" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
      <path className="chart-grid" d="M0 26 H100 M0 60 H100 M0 94 H100"/>
      <path className="chart-area" d={area}/><path className="chart-line" d={line}/>
      {xy.map((pt,i)=><circle key={i} cx={pt.x} cy={pt.y} r="1.35" className={i===xy.length-1?'current':''}/>) }
    </svg>
    <div className="chart-labels">{history.map((x,i)=>{const refIndex=[4,3,2,1,0][i];const launchRef=refIndex!==undefined&&!p.fullWindows[refIndex];return <div key={x.label}><span>{x.label}</span><b>{fmt(x.price,10)}</b><small>{launchRef?'launch ref':'checkpoint'}</small></div>})}</div>
  </div>
}
