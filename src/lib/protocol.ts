import { type Address, getAddress } from 'viem'
import { METOK_ABI } from './abi'
import { CONTRACT_ADDRESS, publicClient, ZERO } from './config'

export type CurveHead = {
  id:bigint
  kind:number
  user:Address
  amount:bigint
  minOut:bigint
  deadline:bigint
  entropySequence:bigint
  randomReady:boolean
}

export type ProtocolState = {
  hasCode:boolean; ownerOk:boolean; supplyOk:boolean; bucketsOk:boolean; solvent:boolean;
  totalSupply:bigint; virtualMon:bigint; realMon:bigint; curveReserve:bigint; circulating:bigint;
  pendingPlay:bigint; claimReserve:bigint; sellEscrow:bigint; p2pSellEscrow:bigint; p2pBuyEscrow:bigint;
  price:bigint; entropyFee:bigint; cardCount:number; nextCurve:bigint; nextSettle:bigint; canSettle:boolean;
  balance:bigint; credit:bigint; changes:bigint[]; fullWindows:boolean[]; deployedAt:bigint;
  referencePrices:bigint[]; referenceTimestamps:bigint[]; sinceLaunch:bigint;
  nextP2PSell:bigint; nextP2PBuy:bigint; head?:CurveHead;
  entropy:Address; entropyProvider:Address; minOrderLifetime:bigint; maxOrderLifetime:bigint;
  blockNumber:bigint; chainId:number; syncedAt:number;
}

const read = async (functionName:any, args?: readonly unknown[]) => {
  if (!CONTRACT_ADDRESS) throw new Error('VITE_METOK_CONTRACT is not configured')
  return publicClient.readContract({ address:CONTRACT_ADDRESS, abi:METOK_ABI, functionName, args } as any) as Promise<any>
}

export async function loadProtocol(account?: Address): Promise<ProtocolState> {
  if (!CONTRACT_ADDRESS) throw new Error('VITE_METOK_CONTRACT is not configured')
  const [code,blockNumber,chainId,base] = await Promise.all([
    publicClient.getCode({address:CONTRACT_ADDRESS}),
    publicClient.getBlockNumber(),
    publicClient.getChainId(),
    Promise.all([
      read('owner'),read('totalSupply'),read('VIRTUAL_MON'),read('realMonReserve'),read('curveTokenReserve'),read('circulatingSupply'),read('pendingPlayMon'),read('claimReservedToken'),read('protocolSellEscrowToken'),read('p2pSellEscrowToken'),read('p2pBuyEscrowMon'),read('protocolPriceWad'),read('entropyFee'),read('CARD_COUNT'),read('nextCurveOrderId'),read('nextCurveOrderToSettle'),read('canSettleNextCurveOrder'),read('tokenBucketsBalanced'),read('monAccountingSolvent'),read('priceChangeStats'),read('DEPLOYED_AT'),read('nextP2PSellOrderId'),read('nextP2PBuyOrderId'),read('ENTROPY'),read('ENTROPY_PROVIDER'),read('MIN_ORDER_LIFETIME'),read('MAX_ORDER_LIFETIME')
    ])
  ])
  const [owner,totalSupply,virtualMon,realMon,curveReserve,circulating,pendingPlay,claimReserve,sellEscrow,p2pSellEscrow,p2pBuyEscrow,price,fee,cardCount,nextCurve,nextSettle,canSettle,bucketsOk,solvent,stats,deployedAt,nextP2PSell,nextP2PBuy,entropy,entropyProvider,minOrderLifetime,maxOrderLifetime] = base
  const [balance,credit] = account ? await Promise.all([read('balanceOf',[account]),read('withdrawableMon',[account])]) : [0n,0n]
  const [changes,fullWindows,referencePrices,referenceTimestamps,sinceLaunch] = stats as [bigint[],boolean[],bigint[],bigint[],bigint]
  let head:CurveHead|undefined
  if(nextSettle<nextCurve){
    try{
      const h=await read('getCurveOrderState',[nextSettle]) as [bigint,Address,bigint,bigint,bigint,bigint,boolean]
      head={id:nextSettle,kind:Number(h[0]),user:h[1],amount:h[2],minOut:h[3],deadline:h[4],entropySequence:h[5],randomReady:h[6]}
    }catch{}
  }
  return {
    hasCode:!!code && code !== '0x', ownerOk:getAddress(owner)===ZERO, supplyOk:totalSupply===100_000_000_000n*10n**18n,
    bucketsOk,solvent,totalSupply,virtualMon,realMon,curveReserve,circulating,pendingPlay,claimReserve,sellEscrow,p2pSellEscrow,p2pBuyEscrow,
    price,entropyFee:fee,cardCount:Number(cardCount),nextCurve,nextSettle,canSettle,balance,credit,changes:[...changes],fullWindows:[...fullWindows],deployedAt,
    referencePrices:[...referencePrices],referenceTimestamps:[...referenceTimestamps],sinceLaunch,
    nextP2PSell,nextP2PBuy,head,entropy:getAddress(entropy),entropyProvider:getAddress(entropyProvider),minOrderLifetime,maxOrderLifetime,
    blockNumber,chainId,syncedAt:Date.now()
  }
}

export async function readContract(functionName:any,args?:readonly unknown[]){ return read(functionName,args) }
