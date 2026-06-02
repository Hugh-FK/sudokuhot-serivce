---
name: sudokuhot-project
description: Overview and operating guide for the SudokuHot system (Astro frontend in `../sudokuhot` + Cloudflare Worker API in this repo). Use when working on overall architecture, local dev setup, env vars, OAuth (Google callback on API domain), API endpoints, or troubleshooting Wrangler/workerd port conflicts.
disable-model-invocation: true
---

# SudokuHot 项目整体（前端 + API）

本 Skill 面向 **整套系统**：`sudokuhot`（前端，Astro + Solid）与 `sudokuhot-serivce`（API，Cloudflare Workers + Elysia + D1）。

## 项目分仓与职责

- **前端**：`/Users/fuguanwen/project/sudokuhot`
  - Astro 站点（默认 `http://localhost:4321`）
  - API 接入开关：`.env` 的 `PUBLIC_API_URL`（例如 `http://127.0.0.1:8787/api/v1`）
  - Google 登录入口：登录页点击 Google → 跳转到 **API** 的 `/auth/google`
  - OAuth 回调承接页：`/auth/callback`（接收 API 302 回来的 `token`，写入本地 token 并跳转）

- **API（本仓库）**：`/Users/fuguanwen/project/sudokuhot-serivce`
  - Cloudflare Worker + Elysia（`wrangler dev` 默认 `http://127.0.0.1:8787`）
  - D1 数据库绑定：`wrangler.toml` 的 `[[d1_databases]]` 绑定为 `DB`
  - REST 前缀：`/api/v1/*`
  - Google OAuth：回调在 **API 域名** `/auth/callback`，成功后 302 到 `FRONTEND_URL/auth/callback?token=...`

## 本地开发（推荐顺序）

### 1) 启动 API（Worker）

在 `sudokuhot-serivce`：

```bash
pnpm dev
```

常用脚本（本仓库 `package.json`）：
- `pnpm dev`: `wrangler dev`
- `pnpm db:migrate:local`: D1 本地迁移
- `pnpm db:migrate:remote`: D1 远端迁移

### 2) 启动前端

在 `sudokuhot`：

```bash
pnpm dev
```

并确保 `.env`：

```bash
PUBLIC_API_URL=http://127.0.0.1:8787/api/v1
```

## 环境变量（关键项）

### API（Worker）侧（`.dev.vars` / Cloudflare vars & secrets）

- `API_SECRET_KEY`: OAuth state 签名用（必填，启用 Google 登录时）
- `API_PUBLIC_URL`: API 对外根地址（无尾斜杠），用于拼 `.../auth/callback`
  - 本地通常是 `http://127.0.0.1:8787`
- `FRONTEND_URL`: 登录成功后跳回的前端根地址
  - 本地通常是 `http://localhost:4321`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`（可选）
  - 不设时自动使用 `${API_PUBLIC_URL}/auth/callback`
  - 若设，必须与 Google 控制台「已获授权的重定向 URI」**完全一致**

### 前端侧（`.env`）

- `PUBLIC_API_URL`: API base（必须以 `/api/v1` 结尾）
  - 前端会从它推导 API origin（用于跳转 `/auth/google`）

## Google OAuth（回调在 API 域名）

### Google 控制台配置

「已获授权的重定向 URI」必须是**完整 URL**，例如：
- 本地：`http://127.0.0.1:8787/auth/callback`
- 生产：`https://<你的API域名>/auth/callback`

### 运行时流程（高层）

1. 前端登录页点击 Google：跳转到 `GET {apiOrigin}/auth/google`
2. API 生成 state 并重定向到 Google 授权页
3. Google 回调：`GET {apiOrigin}/auth/callback?code&state`
4. API 换取 token，创建会话后 302 到：`{FRONTEND_URL}/auth/callback?token=...&expiresAt=...`
5. 前端 `/auth/callback` 保存 token 并跳转到用户页

## API 关键端点（当前实现）

- `GET /auth/google`: 发起 Google OAuth（API 域名回调）
- `GET /auth/callback`: Google 回调处理，成功后跳到前端
- `GET /api/v1/auth/google/url`: 返回 Google 授权 URL（备用方案：前端自己跳转）
- `POST /api/v1/auth/google`: 用 `code` 换 session（备用方案：前端回调）
- `POST /api/v1/auth/guest`: 游客会话
- `POST /api/v1/auth/session`: mock 登录（email / google），会创建用户 + session token
- `GET /api/v1/auth/session`: 读取当前会话用户（需要 `Authorization: Bearer <token>`）
- `DELETE /api/v1/auth/session`: 登出并清 token

## 常见故障排查

### 端口被占用（Wrangler/workerd）

报错特征：`Address already in use (127.0.0.1:8790)` 或类似。

处理：
- 查占用：`lsof -i :<port>`
- 结束残留 `workerd`：`kill <PID>`（必要时 `kill -9 <PID>`）
- 或换端口：`wrangler dev --port 8791`

### 前端点 Google 没反应

检查：
- 前端 `.env` 是否配置了 `PUBLIC_API_URL`
- `PUBLIC_API_URL` 是否形如 `http://127.0.0.1:8787/api/v1`（必须带 `/api/v1`）
- API 是否已配置 `FRONTEND_URL`，否则回调后无法跳回前端

## 需要读代码时的定位指引

- API 路由入口：`src/index.ts`
- API v1 路由：`src/routes/v1.ts`
- OAuth 路由（API 域名回调）：`src/routes/auth-oauth.ts`
- OAuth 交换与用户创建：`src/services/google-oauth.ts`
- D1 仓储：`src/db/*`
- 前端登录 UI：`../sudokuhot/src/components/auth/AuthForm.tsx`
- 前端 OAuth 回调页：`../sudokuhot/src/pages/auth/callback.astro` + `../sudokuhot/src/components/auth/OAuthCallback.tsx`

