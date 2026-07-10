# AI Wardrobe — Implementation Checklist

> Last updated: 2026-07-10 (HEIC 支持完成；多件物品识别代码已完成，待真实 fal.ai 调用联调)

---

## Debug Log (已解决的问题)

### 部署 & 构建

| # | 问题 | 原因 | 修复 |
|---|------|------|------|
| 1 | `npm install` 报 `fal-client` 404 | 包名错误 | `fal-client` → `@fal-ai/client` (package.json) |
| 2 | Build 报 `model: "General"` 类型错误 | fal.ai SDK 更新了枚举值 | `"General"` → 删除该参数，用默认值 (remove-bg.ts) |
| 3 | Build 报 `cookiesToSet` implicitly has `any` type | TypeScript strict 模式 | 给 `cookiesToSet` 加显式类型 `{ name: string; value: string; options?: Record<string, unknown> }[]` (server.ts + proxy.ts 两处) |
| 4 | fal.ai 返回 422 Unprocessable Entity | `output_format` 不是图片端点的有效参数 | 删除 `model`、`operating_resolution`、`output_format`，只保留 `image_url` (remove-bg.ts) |
| 5 | Claude API 报 `image exceeds 10 MB` | fal.ai 返回的去背景 PNG 分辨率太高 | 用 Sharp 缩图到 1024px + JPEG 85% 后再发给 Claude (classify.ts)，同时 `npm install sharp` |
| 6 | npm 依赖冲突，Next.js 装成 9.3.3 | package-lock.json 残留 | `rd /s /q node_modules` + `del package-lock.json` + `npm install --legacy-peer-deps` |
| 7 | `next.config.ts` not supported | Next.js 16 实际安装后支持 .ts，但旧版不支持 | 升级到 Next.js 16 后自动解决 |
| 8 | `middleware` file convention deprecated | Next.js 16 改名 middleware → proxy | 文件重命名 `middleware.ts` → `proxy.ts`，函数 `middleware()` → `default proxy()`，`config` → `proxyConfig` |
| 9 | `@import` must precede all rules | CSS @import 在 @tailwind 指令之后 | 把 `@import url(...)` 移到 globals.css 第一行 |

### 成本优化

| 项目 | 优化前 | 优化后 | 节省 |
|------|--------|--------|------|
| AI 分类模型 | Claude Sonnet 4.6 ($3/$15 per MTok) | Claude Haiku 4.5 ($1/$5 per MTok) | 3x |
| AI Stylist 模型 | Claude Sonnet 4.6 | Claude Haiku 4.5 | 3x |
| 分类图片大小 | 原图 (可能 10MB+) | Sharp 缩到 1024px JPEG (~200KB) | token 费大幅降低 |
| 月成本估算 (3用户×50件) | ~$4.50/月 | ~$1.20/月 | ~73% |

---

## 功能实现状态

### Phase 1 — 基础框架 + 数字衣橱 (Module B 核心)

| 功能 | 状态 | 备注 |
|------|------|------|
| Next.js 项目脚手架 | ✅ 完成 | Next.js 16 + Tailwind 3 + TypeScript |
| Supabase 初始化 | ✅ 完成 | schema.sql 含全部表 + RLS |
| Auth (Email 注册/登录) | ✅ 完成 | proxy.ts 保护 dashboard 路由 |
| Auth (Google OAuth) | ✅ 代码就绪 | 需在 Supabase 配置 Google Provider |
| 数据库 Schema | ✅ 完成 | 9 张表: profiles, wardrobe_items, outfits, outfit_items, outfit_journal, folders, style_dna, travel_plans, preference_swipes |
| Storage Bucket | ✅ 完成 | `wardrobe` bucket + RLS 策略 |
| 单件上传 → 去背景 → AI分类 → 存储 | ✅ 完成 | fal.ai BiRefNet + Claude Haiku Vision |
| 衣橱浏览页 | ✅ 完成 | 分类/颜色/季节筛选 |
| 单品详情编辑 | ✅ 完成 | 修正 AI 分类结果 |
| 收藏/删除 | ✅ 完成 | |
| 多件物品识别 | ✅ 已联调 | Claude Vision 同时返回计数和具体物品 noun → 命中多件才调用 `fal-ai/sam-3-1/image` → 按官方 normalized boxes 裁剪；已用 4 个 purse 的真实图片验证返回 4 个 masks/boxes |
| HEIC 格式支持 | ✅ 完成 | heic-convert + Sharp，客户端上传前转换 (convert route) |
| 产品链接智能补充 | ❌ 待开发 | Phase 2+ |

### Phase 2 — Profile + Style Intelligence (Module A, D)

| 功能 | 状态 | 备注 |
|------|------|------|
| 用户 Profile 表单 | ✅ 完成 | 身体数据 + 外貌 |
| 衣橱文件夹系统 | ✅ Schema 就绪 | 前端 UI 待开发 |
| Style DNA 分析 | ✅ Analytics 页面 | 颜色/风格/类别分布统计 |
| Preference Engine (Tinder-style) | ❌ 待开发 | |

### Phase 3 — Outfit + Daily Stylist (Module 5, 6, 7)

| 功能 | 状态 | 备注 |
|------|------|------|
| AI Stylist Chat | ✅ 完成 | 基于真实衣橱推荐 |
| 搭配创建/保存 | ✅ 框架就绪 | 前端拖拽组合 UI 待开发 |
| 天气 API 集成 | ✅ API 就绪 | 需要 OpenWeather Key |
| 每日推荐 (Home Page) | ❌ 待开发 | |
| Google Calendar 集成 | ❌ 待开发 | |

### Phase 4 — Calendar + Analytics (Module 10, 11)

| 功能 | 状态 | 备注 |
|------|------|------|
| Outfit Journal / Calendar | ✅ Schema 就绪 | 前端 UI 待开发 |
| 穿着统计 | ✅ 完成 | times_worn, last_worn_at |
| Closet Health 指标 | ✅ 完成 | 总数/常穿/少穿/从未穿 |
| Declutter 建议 | ✅ 完成 | 基于 never worn 统计 |

### Phase 5 — Travel + Capsule (Module 9, 12)

| 功能 | 状态 | 备注 |
|------|------|------|
| Capsule Wardrobe Generator | ❌ 占位页面 | |
| Travel Packing Planner | ❌ 占位页面 | |
| Packing List 导出 | ❌ 待开发 | |

### 部署

| 功能 | 状态 | 备注 |
|------|------|------|
| Vercel 部署 | ✅ 完成 | 自动部署 from GitHub |
| 自定义域名 | ⏳ 待绑定 | `closet.daidingrdesigns.com` → Vercel Domains 添加 |
| 环境变量 | ✅ 已配置 | SUPABASE_URL, SUPABASE_ANON_KEY, FAL_KEY, ANTHROPIC_API_KEY |

---

## 下一步开发任务

### 任务: 多件物品识别 (自动判断 single vs multi-item) — ✅ 代码已完成，⚠️ 待真实调用验证

- 已实现:
  - `src/lib/ai/segment.ts`
    - `detectItems(imageUrl)`: Haiku vision 在一次调用中返回物品计数和供 SAM 3.1 使用的具体英文 noun prompts（复用 `classify.ts` 的 `resizeForClassification`）；同类物品 prompt 会归一化去重
    - `segmentItems(imageUrl, prompts, expectedCount)`: 调用 fal.ai `fal-ai/sam-3-1/image`，显式开启 `return_multiple_masks/include_scores/include_boxes`；读取官方 normalized `[cx,cy,w,h]` boxes，过滤 <1% 图片面积的碎 mask、按分数去重，最多取 12 个，再用 Sharp 从原图裁剪（不用 SAM 黑底 applied-mask 图）
  - `src/app/api/ai/classify/route.ts`
    - 先调用 `detectItemCount`；≤1 件 → 原单件 pipeline 完全不变（去背景 → Claude 分类 → 存储，返回 `{ item, classification, multiItem: false }`）
    - ≥2 件 → `segmentItems` 拿到裁剪图 → 每张裁剪图先传到 Storage 拿 URL（fal 的去背景需要可访问的 URL）→ 复用同一套「去背景 → Claude 分类 → 插入 wardrobe_items」逻辑（抽成 `processOneItem` 共享函数）→ 返回 `{ items: [...], multiItem: true, count }`；单个 segment 失败不影响其它 segment（catch 后跳过，全部失败才报错）
  - `src/components/closet/upload-zone.tsx`: 新增 `detecting` 阶段提示；根据响应里的 `multiItem` 分流展示「Added N items」或原有单件文案，`result` 增加 `count` 字段
- **已验证 (2026-07-10)**: `fal-ai/sam-3-1/image` 真实响应为 `masks`, `scores`, `boxes`, `metadata`；测试图用 `purse` prompt 返回 4 个独立 mask，boxes 为官方 normalized `[cx,cy,w,h]`。宽泛 prompt 会返回 0 个 mask，因此必须由 Claude 提供具体可见物品 noun。
- 未做 (Phase 2): 前端 checkbox 勾选/取消每个检测到的物品的 UI — 目前 multi-item 检测到的所有 segment 会全部自动分类入库，没有确认环节

---

## 项目结构参考

```
ai-wardrobe/
├── src/
│   ├── app/
│   │   ├── (auth)/login, signup
│   │   ├── (dashboard)/closet, outfits, stylist, profile, analytics, travel
│   │   └── api/ai/classify, stylist + api/weather
│   ├── components/closet, layout
│   ├── lib/ai/remove-bg.ts, classify.ts + supabase/client.ts, server.ts
│   ├── proxy.ts (原 middleware.ts)
│   └── types/database.ts
├── supabase/schema.sql
├── .env.local
└── package.json
```

## 关键文件速查

| 要改什么 | 文件路径 |
|---------|---------|
| AI 分类逻辑 / 模型选择 | `src/lib/ai/classify.ts` |
| 背景移除 | `src/lib/ai/remove-bg.ts` |
| 多件物品计数 / SAM 分割 | `src/lib/ai/segment.ts` |
| HEIC 转换 | `src/app/api/ai/convert/route.ts` |
| 上传 pipeline (计数→单件/多件分支→去背景→分类→存储) | `src/app/api/ai/classify/route.ts` |
| AI Stylist 对话 | `src/app/api/ai/stylist/route.ts` |
| 数据库类型定义 | `src/types/database.ts` |
| 认证 / 路由保护 | `src/proxy.ts` |
| 数据库 Schema | `supabase/schema.sql` |
| 环境变量 | `.env.local` |
