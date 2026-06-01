/**
 * 环境变量类型定义
 * Cloudflare Workers 环境变量通过 Env 接口定义
 */
export interface Env {
  // 应用基础配置
  APP_ENV?: string
  APP_NAME?: string
  APP_VERSION?: string

  // 数据库配置
  DATABASE_URL?: string

  // 认证配置
  JWT_SECRET?: string
  JWT_EXPIRES_IN?: string
  API_SECRET_KEY?: string

  // CORS 配置
  ALLOWED_ORIGINS?: string

  // 第三方服务 - Stripe
  STRIPE_SECRET_KEY?: string
  STRIPE_PUBLISHABLE_KEY?: string

  // 第三方服务 - SendGrid
  SENDGRID_API_KEY?: string

  // 第三方服务 - AWS S3
  AWS_ACCESS_KEY_ID?: string
  AWS_SECRET_ACCESS_KEY?: string
  AWS_S3_BUCKET?: string
  AWS_REGION?: string

  // 其他配置
  REDIS_URL?: string
  LOG_LEVEL?: string
}

/**
 * 获取环境变量的辅助函数
 * @param env - Cloudflare Workers 环境对象
 * @param key - 环境变量键名
 * @param defaultValue - 默认值
 * @returns 环境变量值或默认值
 */
export function getEnv(
  env: Env,
  key: keyof Env,
  defaultValue?: string
): string {
  return env[key] ?? defaultValue ?? ''
}

/**
 * 获取必需的环境变量，如果不存在则抛出错误
 * @param env - Cloudflare Workers 环境对象
 * @param key - 环境变量键名
 * @returns 环境变量值
 * @throws 如果环境变量不存在
 */
export function getRequiredEnv(env: Env, key: keyof Env): string {
  const value = env[key]
  if (!value) {
    throw new Error(`环境变量 ${key} 未设置`)
  }
  return value
}

/**
 * 检查是否为生产环境
 */
export function isProduction(env: Env): boolean {
  return env.APP_ENV === 'production'
}

/**
 * 检查是否为开发环境
 */
export function isDevelopment(env: Env): boolean {
  return env.APP_ENV === 'development' || !env.APP_ENV
}

/**
 * 检查是否为预发布环境
 */
export function isStaging(env: Env): boolean {
  return env.APP_ENV === 'staging'
}

/**
 * 获取允许的 CORS 源列表
 */
export function getAllowedOrigins(env: Env): string[] {
  const origins = getEnv(env, 'ALLOWED_ORIGINS', '')
  return origins.split(',').map((origin) => origin.trim()).filter(Boolean)
}
