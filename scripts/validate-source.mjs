import fs from 'node:fs'
import path from 'node:path'
const root=process.cwd()
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const all=fs.readdirSync(path.join(root,'src'),{recursive:true}).filter(x=>/\.(ts|tsx)$/.test(String(x))).map(x=>read(path.join('src',String(x)))).join('\n')
const abi=read('src/lib/abi.ts'),events=read('src/lib/events.ts'),portfolio=read('src/lib/portfolio.ts'),write=read('src/lib/write.ts'),contract=read('reference/METOK_V4.sol')
const checks=[
 ['contract pinned',all.includes('0xE25AaBa9CBCD0DF6e0b3659c66F1C022a4ED1cf6')],
 ['chain 143',all.includes('id: 143')||all.includes('chainId!==143')],
 ['V4 source fixed supply',contract.includes('TOTAL_SUPPLY = 100_000_000_000 * WAD')],
 ['V4 source virtual MON',contract.includes('VIRTUAL_MON = 100_000 * WAD')],
 ['no approve flow',!all.includes("functionName:'approve'")&&!all.includes('functionName:"approve"')],
 ['simulate before wallet write',write.indexOf('simulateContract')<write.indexOf('client.writeContract')],
 ['identity check owner zero',write.includes("functionName:'owner'")&&write.includes('ZERO')],
 ['identity check 100B supply',write.includes('EXPECTED_SUPPLY')],
 ['all custom errors in ABI',abi.includes("'error AccountingInvariantBroken()'")&&abi.includes("'error InvalidDeadline()'")&&abi.includes("'error UnauthorizedEntropy()'")],
 ['Play events indexed',events.includes('PlaySubmitted')&&events.includes('PlaySettled')&&events.includes('RewardClaimed')],
 ['SELL events indexed',events.includes('ProtocolSellSubmitted')&&events.includes('ProtocolSellSettled')&&events.includes('ProtocolSellCancelled')],
 ['P2P events indexed',events.includes('P2PSellOrderFilled')&&events.includes('P2PBuyOrderFilled')],
 ['wallet event cache reorg buffer',events.includes('REORG_BUFFER')],
 ['adaptive getLogs scanner',events.includes('scanAdaptive')],
 ['portfolio verifies curve state',portfolio.includes("readContract('getCurveOrderState'")],
 ['portfolio verifies claims',portfolio.includes("readContract('claims'")],
 ['portfolio verifies P2P state',portfolio.includes("readContract('p2pSellOrders'")&&portfolio.includes("readContract('p2pBuyOrders'")],
 ['random uses Web Crypto',all.includes('crypto.getRandomValues')],
 ['no seed/private key UX',!all.match(/seed phrase input|private key input/i)],
 ['RPC fallback ranking',read('src/lib/config.ts').includes('rank: true')],
 ['RPC health probe',all.includes('probeAllRpcs')],
 ['MetaMask Connect package',read('package.json').includes('@metamask/connect-evm')&&read('package.json').includes('@metamask/connect-multichain')],
 ['MetaMask Connect cross-platform client',all.includes('createEVMClient')&&all.includes("chainIds:['0x8f']")],
 ['MetaMask analytics disabled',all.includes('analytics:{enabled:false}')],
 ['MetaMask relay allowed by CSP',read('scripts/generate-security.mjs').includes('wss://mm-sdk-relay.api.cx.metamask.io')],
 ['legacy MetaMask SDK absent',!read('package.json').includes('@metamask/sdk"')],
 ['CSP generator',fs.existsSync(path.join(root,'scripts/generate-security.mjs'))],
]
let fail=0
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}`);if(!ok)fail++}
console.log(`\n${checks.length-fail}/${checks.length} checks passed`)
if(fail)process.exit(1)
