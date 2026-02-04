import { Elysia } from 'elysia'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import cors from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'

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
    .get('/', () => 'Hello Elysia on Cloudflare Workers1')
    .post('/hello', () => 'OpenAPI')
    .compile()

export default app
