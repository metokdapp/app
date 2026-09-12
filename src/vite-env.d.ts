/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_METOK_CONTRACT?: `0x${string}`
  readonly VITE_RPC_URL?: string
  readonly VITE_RPC_URLS?: string
  readonly VITE_EXPLORER_URL?: string
  readonly VITE_DEPLOYMENT_BLOCK?: string
}
interface ImportMeta { readonly env: ImportMetaEnv }
