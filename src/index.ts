import { Elysia } from 'elysia'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import cors from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { env } from 'cloudflare:workers'
import type { Env } from './env'
import { getEnv, getAllowedOrigins } from './env'

const app = new Elysia({ adapter: CloudflareAdapter })
    .use(cors())
    .use(openapi({
        documentation:{
            info:{
                title: 'CouponPies API',
                version: '1.0.0',
                description: 'CouponPies API',
            }
        }
    }))
    .get('/', () => {
        const appName = getEnv(env as Env, 'APP_NAME', 'CouponPies API')
        const appVersion = getEnv(env as Env, 'APP_VERSION', '1.0.0')
        const appEnv = getEnv(env as Env, 'APP_ENV', 'development')
        
        return {
            message: 'Hello Elysia on Cloudflare Workers!',
            app: appName,
            version: appVersion,
            environment: appEnv
        }
    })
    .get('/env/info', () => {
        // 示例：展示如何使用环境变量
        return {
            appName: getEnv(env as Env, 'APP_NAME'),
            version: getEnv(env as Env, 'APP_VERSION'),
            environment: getEnv(env as Env, 'APP_ENV'),
            allowedOrigins: getAllowedOrigins(env as Env),
            // 注意：不要在生产环境中暴露敏感信息
        }
    })
    .post('/hello', () => 'OpenAPI')
    .compile()

export default app
