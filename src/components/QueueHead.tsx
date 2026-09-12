import type { CurveHead } from '../lib/protocol'
import { fmt, short } from '../lib/format'

export function QueueHead({head,canSettle}:{head?:CurveHead,canSettle?:boolean}){
  if(!head) return <div className="queue-head empty-head"><i>✓</i><div><b>FIFO queue clear</b><span>No PLAY or SELL orders are waiting for settlement.</span></div></div>
  const isPlay=head.kind===1
  const expired=Number(head.deadline)*1000<Date.now()
  const status=isPlay?(head.randomReady?'Entropy ready':expired?'Oracle timeout ready':'Waiting Entropy'):'Ready to settle'
  return <div className={`queue-head ${canSettle?'ready':''}`}>
    <div className="queue-head-id"><span>HEAD</span><strong>#{head.id.toString()}</strong></div>
    <div className="queue-head-main"><b>{isPlay?'PLAY':'SELL'} · {status}</b><span>{short(head.user,7,5)} · {fmt(head.amount,5)} {isPlay?'MON':'METOK'}</span></div>
    <div className="queue-head-meta"><span>minOut</span><b>{fmt(head.minOut,5)} {isPlay?'METOK':'MON'}</b></div>
    <div className="queue-head-state"><i/>{canSettle?'SETTLEABLE':'BLOCKED'}</div>
  </div>
}
