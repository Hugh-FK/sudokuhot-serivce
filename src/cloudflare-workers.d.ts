// Cloudflare Workers 类型声明
declare module 'cloudflare:workers' {
  import type { Env } from './env'
  
  export const env: Env
}
