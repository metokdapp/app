import type { Address } from 'viem'
import { Button } from './Ui'
import { short } from '../lib/format'

type Props={
  address?:Address
  connecting:boolean
  onConnect:()=>void
  onDisconnect:()=>void
}

export function WalletButton({address,connecting,onConnect,onDisconnect}:Props){
  if(!address){
    return <Button
      className="wallet-btn metamask-wallet"
      onClick={onConnect}
      disabled={connecting}
      title="Connect MetaMask"
    >
      <span className="wallet-fox" aria-hidden="true">◆</span>
      <span className="wallet-label">{connecting?'Opening MetaMask…':'Connect Wallet'}</span>
    </Button>
  }

  return <div className="wallet-connected-actions">
    <Button
      className="wallet-btn metamask-wallet connected"
      onClick={()=>{}}
      disabled
      title="MetaMask connected"
    >
      <span className="wallet-fox" aria-hidden="true">◆</span>
      <span className="wallet-label">{short(address,6,4)}</span>
    </Button>

    <Button
      className="wallet-disconnect"
      onClick={onDisconnect}
      disabled={connecting}
      title="Disconnect wallet"
    >
      {connecting?'Disconnecting…':'Disconnect Wallet'}
    </Button>
  </div>
}
