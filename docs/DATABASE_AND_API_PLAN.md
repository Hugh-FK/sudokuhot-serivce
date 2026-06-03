# Sudoku Hot — D1 数据库与 API 实施计划

> 基于前端 `sudokuhot` 全站功能与 `user-progress` / `daily-challenge` 数据层设计。  
> 后端仓库：`sudokuhot-serivce`（Cloudflare Workers + Elysia + D1）。

## 1. 目标

| 阶段 | 内容 |
|------|------|
| P0 | 用户、会话、对局存档/完成、每日完成、资料、设置、进度 BFF |
| P1 | 统计聚合、活动流、成就殿堂、反馈、书签 |
| P2 | 真实 OAuth、社区均值定时任务、博客 CMS、404 CMS |

前端策略：`PUBLIC_API_URL` 配置后走 API；未配置或请求失败时回退 localStorage（渐进迁移）。

---

## 2. ER 关系（核心）

```
users 1──1 user_profiles
users 1──1 user_settings
users 1──0..1 game_sessions (进行中，应用层保证单条)
users 1──* game_completions
users 1──* user_daily_completions (PK: user_id + date_key)
users 1──* blog_bookmarks
users 1──1 auth_sessions
feedback_entries ──o users (可选登录)

difficulty_community_stats (全局只读，柱图「玩家均值」)
```

每日挑战 **定义**（难度、seed、tip）仍由服务端/客户端同一规则生成（`daily:{dateKey}:medium`），不入库；可选表 `daily_challenges` 用于运营覆盖。

成就 **规则** 与前端 `achievement-hall.ts` 一致，由 API **计算** 返回 `AchievementHallView`，不单独存 40 条解锁行（P2 可加 `user_achievement_events` 审计）。

---

## 3. D1 表结构

### 3.1 `users`

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| email | TEXT UNIQUE NULL | 邮箱登录 |
| display_name | TEXT | 展示名 |
| provider | TEXT | `google` \| `email` \| `guest` |
| created_at | TEXT ISO | |
| updated_at | TEXT ISO | |
| deleted_at | TEXT NULL | 软删 |

### 3.2 `auth_sessions`

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| user_id | TEXT FK UNIQUE | 每用户一条；再次登录更新 token |
| token_hash | TEXT UNIQUE | SHA-256(token)，登录时刷新 |
| expires_at | TEXT ISO | 默认 30 天，登录时刷新 |
| created_at | TEXT ISO | 首次创建会话时间 |

### 3.3 `user_profiles`

| 列 | 类型 |
|----|------|
| user_id | TEXT PK FK |
| bio | TEXT |
| public_profile | INTEGER 0/1 |
| updated_at | TEXT |

### 3.4 `user_settings`

| 列 | 类型 |
|----|------|
| user_id | TEXT PK FK |
| settings_json | TEXT | `GameSettings` JSON |
| updated_at | TEXT |

### 3.5 `game_sessions`

| 列 | 类型 |
|----|------|
| user_id | TEXT PK FK |
| play_mode | TEXT | classic / hell |
| difficulty_id | TEXT |
| daily_date_key | TEXT NULL |
| puzzle_template_json | TEXT |
| solution_json | TEXT |
| grid_json | TEXT |
| notes_json | TEXT |
| mistakes | INTEGER |
| hints_used | INTEGER |
| elapsed_seconds | INTEGER |
| updated_at | TEXT |

### 3.6 `game_completions`

| 列 | 类型 |
|----|------|
| id | TEXT PK |
| user_id | TEXT FK |
| play_mode | TEXT |
| difficulty_id | TEXT |
| daily_date_key | TEXT NULL |
| result | TEXT | win / loss |
| elapsed_seconds | INTEGER |
| mistakes | INTEGER |
| hints_used | INTEGER |
| completed_at | TEXT ISO |

索引：`(user_id, completed_at DESC)`

### 3.7 `user_daily_completions`

| 列 | 类型 |
|----|------|
| user_id | TEXT FK |
| date_key | TEXT | YYYY-MM-DD |
| difficulty_id | TEXT |
| elapsed_seconds | INTEGER |
| mistakes | INTEGER |
| hints_used | INTEGER |
| completed_at | TEXT ISO |

PK：`(user_id, date_key)`

### 3.8 `feedback_entries`

| 列 | 类型 |
|----|------|
| id | TEXT PK |
| user_id | TEXT NULL |
| name, email, subject | TEXT |
| message | TEXT |
| created_at | TEXT |

### 3.9 `blog_bookmarks`

| 列 | 类型 |
|----|------|
| user_id | TEXT |
| slug | TEXT |
| created_at | TEXT |

PK：`(user_id, slug)`

### 3.10 `difficulty_community_stats`（mock → 可换 API 聚合）

| 列 | 类型 |
|----|------|
| difficulty_id | TEXT PK |
| avg_win_height_pct | INTEGER | 柱图高度 % |
| updated_at | TEXT |

---

## 4. REST API（`/v1`）

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/guest` | 游客会话，返回 `token` + `user` |
| POST | `/auth/session` | body: `{ provider, email?, displayName? }` mock 登录 |
| GET | `/auth/session` | 当前用户 |
| DELETE | `/auth/session` | 登出 |

Header：`Authorization: Bearer <token>`

### 用户

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/users/me` | 资料 + `ProgressSummary` |
| PATCH | `/users/me` | `{ displayName?, bio?, publicProfile? }` |
| DELETE | `/users/me` | 删号（级联清理） |
| GET | `/users/me/settings` | |
| PATCH | `/users/me/settings` | `GameSettings` |

### 进度 BFF（首页/个人/对局恢复）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/users/me/progress` | `{ activeSession, completions[], dailyCompletions[] }` |
| PUT | `/users/me/progress/session` | 保存进行中局 |
| DELETE | `/users/me/progress/session` | 清除进行中局 |

### 对局

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/games/completions` | 写入完成记录（非每日） |

### 每日

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/daily/challenges/:dateKey` | 定义 + 是否已完成 + streak |
| POST | `/daily/completions` | 幂等 upsert by dateKey |

### 统计 / 活动 / 成就

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/users/me/stats?period=30d` | `DerivedStatsDisplay` |
| GET | `/users/me/stats/difficulty-chart?period=30d` | 含社区均值 |
| GET | `/users/me/activity?types=games,daily,achievements&range=30d` | 活动流 |
| GET | `/users/me/achievements` | `AchievementHallView` |
| GET | `/users/me/rank` | 头衔文案 |

### 其它

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/feedback` | 可匿名 |
| GET | `/users/me/bookmarks` | slug[] |
| PUT | `/users/me/bookmarks/:slug` | |
| DELETE | `/users/me/bookmarks/:slug` | |
| GET | `/site/not-found?locale=en` | 404 推荐链接 |

---

## 5. 前端替换映射

| 原 localStorage / 模块 | API |
|------------------------|-----|
| `auth-session` | POST/GET/DELETE `/auth/*` + `sudokuhot-api-token-v1` |
| `profile-edit-data` | PATCH `/users/me` |
| `game-settings` | PATCH `/users/me/settings` |
| `user-progress/store` | GET/PUT/DELETE progress + POST completions |
| `daily-challenge/store` | GET challenge + POST completion |
| `feedback-store` | POST `/feedback` |
| `blog-bookmarks` | bookmarks CRUD |
| `getDerivedStatsDisplay` 等 | GET `/users/me/stats*` |
| `getNotFoundContent` | GET `/site/not-found` |

保留 localStorage：**主题**、**语言**；API 失败时 progress 作离线缓存。

---

## 6. Wrangler / 本地开发

```bash
cd sudokuhot-serivce
pnpm install
npx wrangler d1 create sudokuhot-db   # 将 database_id 写入 wrangler.toml
pnpm db:migrate:local
pnpm dev
```

前端 `.env`：

```bash
PUBLIC_API_URL=http://127.0.0.1:8787/v1
```

---

## 7. 实施顺序（本次提交）

1. ✅ `migrations/0001_init.sql` + wrangler D1 binding  
2. ✅ Elysia `/v1/*` 路由与服务层  
3. ✅ 前端 `src/lib/api/*` + store 双写/拉取  
4. ⏳ 真实 Google OAuth（P2）  
5. ⏳ 博客 CMS（P2）

---

## 8. 与前端类型对齐

- `ActiveGameSession` / `GameCompletionRecord` → JSON 列与 API body 一致  
- `DailyCompletionRecord` → `user_daily_completions`  
- `StatsPeriodKey` → query `period`  
- `AchievementHallId` → 服务端 `evaluateAchievement` 与 `achievement-hall-data.ts` 同步维护
