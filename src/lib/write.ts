import { getAddress, type Address } from 'viem'
import { METOK_ABI } from './abi'
import { CONTRACT_ADDRESS, publicClient, ZERO } from './config'
import { errorText } from './format'
import { beginTransaction, markConfirmed, markFailed, markSubmitted } from './tx'
import { ensureMonad, walletClient } from './wallet'

const EXPECTED_SUPPLY=100_000_000_000n*10n**18n

async function assertWriteTarget(){
  if(!CONTRACT_ADDRESS) throw new Error('The contract address is not configured.')
  const [chainId,code,owner,supply]=await Promise.all([
    publicClient.getChainId(),
    publicClient.getCode({address:CONTRACT_ADDRESS}),
    publicClient.readContract({address:CONTRACT_ADDRESS,abi:METOK_ABI,functionName:'owner'}),
    publicClient.readContract({address:CONTRACT_ADDRESS,abi:METOK_ABI,functionName:'totalSupply'})
  ])
  if(chainId!==143) throw new Error(`RPC chain mismatch: expected 143, got ${chainId}`)
  if(!code||code==='0x') throw new Error('No bytecode was found at the METOK contract address.')
  if(getAddress(owner as Address)!==ZERO) throw new Error('Contract identity check failed: owner() must be zero.')
  if(supply!==EXPECTED_SUPPLY) throw new Error('Contract identity check failed: total supply is not 100B METOK.')
}

export async function writeContractTx({
  account,functionName,args=[],value,label,detail
}:{
  account:Address
  functionName:string
  args?:readonly unknown[]
  value?:bigint
  label:string
  detail?:string
}){
  if(!CONTRACT_ADDRESS) throw new Error('The contract address is not configured.')
  const txId=beginTransaction(label,detail)
  try{
    await ensureMonad()
    await assertWriteTarget()
    const client=walletClient(account)
    const simulation:any={address:CONTRACT_ADDRESS,abi:METOK_ABI,functionName,account}
    if(args.length) simulation.args=args
    if(value!==undefined) simulation.value=value
    const {request}=await publicClient.simulateContract(simulation)
    const hash=await client.writeContract(request as any)
    markSubmitted(txId,hash)
    const receipt=await publicClient.waitForTransactionReceipt({hash})
    if(receipt.status!=='success') throw new Error('Transaction reverted on-chain.')
    markConfirmed(txId)
    return {hash,receipt}
  }catch(e){
    markFailed(txId,errorText(e));throw e
  }
}
