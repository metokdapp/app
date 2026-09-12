import fs from 'node:fs'
import path from 'node:path'

const root=process.cwd()
function parseEnv(file){
  try{return Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#')&&x.includes('=')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).replace(/^['"]|['"]$/g,'')]}))}catch{return{}}
}
const local={...parseEnv(path.join(root,'.env.example')),...parseEnv(path.join(root,'.env'))}
const raw=process.env.VITE_RPC_URLS||process.env.VITE_RPC_URL||local.VITE_RPC_URLS||local.VITE_RPC_URL||'https://rpc.monad.xyz'
const eventRaw=process.env.VITE_EVENT_RPC_URLS||local.VITE_EVENT_RPC_URLS||'https://rpc1.monad.xyz,https://rpc3.monad.xyz,https://rpc.monad.xyz'
const origins=[]
for(const item of `${raw},${eventRaw}`.split(',').map(x=>x.trim()).filter(Boolean)){
  try{const u=new URL(item);if(u.protocol==='https:'||u.protocol==='http:')origins.push(u.origin)}catch{}
}
if(!origins.length)origins.push('https://rpc.monad.xyz')
const relay='wss://mm-sdk-relay.api.cx.metamask.io'
const connect=[...new Set([...origins,relay])].join(' ')
const csp=`default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${connect}; font-src 'self'; media-src 'none'; worker-src 'self'; manifest-src 'self'`
const headers=`/*\n  Content-Security-Policy: ${csp}\n  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()\n  X-Frame-Options: DENY\n  X-Permitted-Cross-Domain-Policies: none\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`
fs.mkdirSync(path.join(root,'public'),{recursive:true})
fs.writeFileSync(path.join(root,'public','_headers'),headers)
fs.writeFileSync(path.join(root,'public','_redirects'),'/* /index.html 200\n')
const vercel={
  $schema:'https://openapi.vercel.sh/vercel.json',
  rewrites:[{source:'/(.*)',destination:'/index.html'}],
  headers:[
    {source:'/(.*)',headers:[
      {key:'Content-Security-Policy',value:csp},{key:'Strict-Transport-Security',value:'max-age=63072000; includeSubDomains; preload'},
      {key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'},
      {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=()'},{key:'X-Frame-Options',value:'DENY'}
    ]},
    {source:'/assets/(.*)',headers:[{key:'Cache-Control',value:'public, max-age=31536000, immutable'}]}
  ]
}
fs.writeFileSync(path.join(root,'vercel.json'),JSON.stringify(vercel,null,2)+'\n')
console.log(`Security headers generated for MetaMask Connect + RPC origins: ${connect}`)
