# AI Wardrobe — Implementation Checklist

> Last updated: 2026-07-10 (搭配创建/保存与自由拼贴 Canvas 完成；鞋子/耳环/手镯配对泛化 + 上传 single/multi 预选完成；已保存 outfit 支持编辑完成；Home 每日推荐（天气+衣橱版）完成，Google Calendar 部分仍待开发；下一步：AI Stylist Canvas 化)

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

### 鞋子配对 (segment.ts `mergeShoePairs`)

| # | 问题 | 原因 | 修复 |
|---|------|------|------|
| 10 | 三双鞋的照片 (`test_shoe_1.jpg`) 曾被归为 6 个独立单品，而不是 3 双 | SAM 3.1 对每只鞋单独出一个 mask/box，`processOneItem` 会把每个 crop 都存成一条 `wardrobe_items` | 新增 `mergeShoePairs`：把 `prompt === "shoe"` 的检测结果配对成一双再存一条记录；真正落单的鞋子用 `sharp().flop()` 镜像生成对称的另一只，保证不凭空捏造设计 |
| 11 | 最初用「图片上两只鞋距离最近」配对 (`centerDistance` 贪心算法)，`test_bag&single_shoe.jpg`（6 只互不相关的单鞋）里离得近的不同款鞋子被错误地拼成"一双" | 距离启发式无法区分「同一双鞋的左右脚」和「两只长得像但不同款的单鞋」 | 改为让 Claude Vision 判断 (`classifyShoePairing`)：把所有鞋子裁剪图一次性发给 Haiku，要求逐只描述楦型/鞋跟/材质颜色/开合方式/品牌 logo 再决定是否配对；不确定一律判单只，避免把不同鞋错误合并（已用两张测试图验证：3 双鞋正确识别为 3 双，6 只单鞋正确识别为 6 只单鞋+各自镜像） |
| 12 | 上一版 `classifyShoePairing` prompt 过于宽松，Haiku 会把完全不同的鞋（白色球鞋 vs 金属短靴、裸色尖头鞋 vs 棕色露趾鞋）错误配对成"一双" | `max_tokens` 太小 (200) 且没有给模型留推理空间，直接输出结论导致误判 | 提高 `max_tokens` 到 1024，要求先逐只列出楦型/鞋跟/材质颜色/开合/品牌等特征，最后再输出 `FINAL:{...}` JSON；`parseShoePairing` 从 `FINAL:` 之后提取 JSON |
| 13 | 真实一双鞋拼图时，左右脚有时放反了（左脚拼到了右侧，右脚拼到了左侧） | `composeSideBySide` 按 Claude 返回的配对数组顺序（`[i,j]`）摆放，这个顺序和两只鞋在原图里的实际左右位置无关，纯属随机 | 曾尝试让 Claude 额外判断每只鞋是左脚还是右脚（`{"pairs":[{"left":1,"right":2}]}`），结果不可靠——Claude 把同一双鞋的两只都判成"右脚"从而拒绝配对，反而把本该配对成功的 3 双鞋全部打回单只。已回退该方案，改用确定性做法：比较两只鞋在原图里 SAM box 的 `centerX`（`detection.box[0]`），谁在左边就摆在合成图左边，谁在右边就摆在合成图右边——真实反映拍摄时的实际摆放位置，不依赖不稳定的视觉判断 |
| 14 | `test_shoe_1.jpg` 里明明是同一双鞋的左右两只（例如一只鞋只露出鞋底花纹，另一只只露出侧面的搭扣带），却被误判成两只「单鞋」，各自镜像成了两条记录，而不是合并成一条 | 两个原因叠加：① Haiku 对复杂绑带凉鞋在不同拍摄角度下的描述不稳定（同一双鞋因为拍摄角度不同，看起来鞋跟高度、可见细节都不一样），把角度造成的差异当成了款式差异；② 当两张裁剪图分别展示了鞋子的不同部位（一只只能看到鞋底，另一只只能看到侧面搭扣），可比较的特征本来就没有交集，模型无法确认是同一双 | 把 `classifyShoePairing` 的模型从 Haiku 换成 Sonnet（`claude-sonnet-5`）——只有多鞋照片才会触发这次额外调用，频率低，换用更强的视觉推理模型成本可接受；同时在 prompt 里明确说明「如果两张图展示的是鞋子不同部位，无法比较的特征不算数，只用两边都能看到的特征（皮革颜色、绑带宽度、搭扣样式、鞋跟形状）判断」。踩坑：Sonnet 5 默认会先输出一个 `thinking` 内容块，`message.content[0]` 不再是 text block，原来假设 index 0 是文本的解析代码需要改成 `content.find(b => b.type === "text")`；同时 `max_tokens` 从 1024 提到 4096，因为 Sonnet 输出更啰嗦，token 不够会在真正吐出 `FINAL:{...}` 之前就被截断，导致解析失败回退成「全部单只」 |

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
| 鞋子/耳环/手镯等自动配对/镜像补全 | ✅ 已联调（鞋子）/ ⚠️ 代码完成待验证（手镯/耳环） | `mergeShoePairs` 泛化成 `mergeDuplicateAccessories`：按 `detection.prompt` 分组，同组 ≥2 个才调用 `classifySimilarItems`（Sonnet）判断是否为同一实物；鞋子/耳环（`MIRROR_IF_LONE_PROMPTS`，天生成对穿戴）落单时额外镜像补全，手镯等其它品类落单则原样保留、不调用模型（省 token）；配对成功按原图实际左右位置拼图。已用 `test_shoe_1.jpg`（3 双鞋）和 `test_bag&single_shoe.jpg`（6 只单鞋 + 2 个包）真实联调验证鞋子路径；手镯/耳环泛化后的路径尚未用真实手镯照片验证 |
| 上传时用户预先选择 single/multi 省 token | ✅ 已联调 | `UploadZone` 新增「Single item / Multiple items」切换（默认 single），上传时把 `mode` 传给 `/api/ai/classify`；`mode === "single"` 时后端完全跳过 `detectItems` 这次 Haiku 调用，直接走单件 pipeline；`mode === "multi"` 时仍需调用 `detectItems` 拿 SAM prompts，但用 `Math.max(2, detection.count)` 相信用户的判断而不是模型的计数；不传 `mode`（旧客户端）保持原来的自动检测行为 |
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
| AI Stylist Chat | ✅ 完成 | 基于真实衣橱推荐；**目前只回复纯文字**，下一步计划改成 Canvas 形式展示推荐搭配并可编辑（呼应 outfits 的自由拼贴 Canvas） |
| 搭配创建/保存 + 编辑 | ✅ 完成 | `outfits-view.tsx`：衣橱单品拖入/点击加入、自由定位、缩放、层级调整、名称/合集/备注及 Supabase 保存；Canvas 使用去背图透明展示；已保存搭配可从库卡片「Edit」按钮打开进 Canvas 编辑并保存回原 outfit（`outfit_items` 新增 `x`/`y`/`width` 持久化自由坐标，见「已完成任务详情」） |
| 天气 API 集成 | ✅ API 就绪 | 需要 OpenWeather Key；`stylist` route 已预留 `context.weather` 字段待接入 |
| 每日推荐 (Home Page) | ✅ 天气+衣橱版完成 / ❌ Calendar 部分待开发 | `/` 现在重定向到 `/home`（登录）或 `/login`；`/home` 拉取 profile city → OpenWeather 天气 + 活跃衣橱，让 Claude Haiku 从真实衣橱里选一套当日搭配并给出理由/衣橱缺口提示；Google Calendar 部分仍未接入（无 token 存储，`context.calendar` 暂未使用），见任务 1 详情 |
| Google Calendar 集成 | ❌ 待开发 | `stylist` route 已预留 `context.calendar` 字段待接入；schema 里没有存 Google Calendar token/事件的表 |

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
| 自定义域名 | ✅ 完成 | `closet.daidingrdesigns.com` → Vercel Domains 添加 |
| 环境变量 | ✅ 完成 | SUPABASE_URL, SUPABASE_ANON_KEY, FAL_KEY, ANTHROPIC_API_KEY |

---

## 下一步开发任务

### 任务 1: 每日推荐 (Home Page) — ✅ 天气+衣橱版完成，❌ Google Calendar 部分待开发

- 需求: dashboard 需要一个真正的首页，结合 Google Calendar（当天日程）+ OpenWeather（当天天气）生成每日穿搭推荐。原来 `/` (`src/app/page.tsx`) 只是重定向到 `/closet` 或 `/login`，dashboard 路由组下没有独立首页。
- 已实现:
  - `src/lib/weather.ts`：把原来内联在 `api/weather/route.ts` 里的 OpenWeatherMap 请求逻辑抽成 `getWeather(city)`，两处（`/api/weather` 和新的 `/api/ai/daily`）共用，避免服务端互相发 HTTP 请求。
  - `src/app/api/ai/daily/route.ts`（新增 `GET`）：读取当前用户 `profiles.city` → `getWeather` 拿当天天气（没填 city 或没配 `OPENWEATHER_API_KEY` 时优雅降级为 `weather: null`，prompt 里注明"天气未知"）；并行读取活跃 (`archived=false`) 衣橱（复用 `stylist` route 同款字段）；系统 prompt 要求 Claude Haiku 只能从真实衣橱 id 里选 2–5 件组成当日一套搭配，输出严格 JSON（`{"itemIds":[...],"reasoning":"...","gap":"..."}`），用正则提取花括号 JSON 块解析（`parseDailyPick`），并用返回的 id 反查真实 `wardrobe_items` 行（防止模型编造不存在的 id）。衣橱少于 2 件或解析失败时返回 `message` 而不是报错，前端据此显示引导文案。
  - `src/app/(dashboard)/home/page.tsx`（新增，服务端组件）：查当前用户 profile 名字做问候语 + 日期，渲染下面的客户端组件。
  - `src/app/(dashboard)/home/daily-recommendation.tsx`（新增，客户端组件）：挂载时 fetch `/api/ai/daily`，loading/空态/错误态分别处理；天气用小卡片展示；推荐搭配用和 outfits Canvas 一致的「`clean_url` 优先、透明展示、无卡片底」的拼贴形式横排展示，下方是 Claude 的推荐理由和（如果有）衣橱缺口提示；「Regenerate」按钮重新拉取；底部链接到 `/stylist` 继续追问。
  - `src/proxy.ts`：`isDashboard` 检查新增 `/home` 前缀；已登录用户访问 `/login`/`/signup` 现在重定向到 `/home` 而不是 `/closet`。
  - `src/app/page.tsx`：已登录时重定向到 `/home`。
  - `src/components/layout/sidebar.tsx`：导航新增排在最前的「Home」入口（`Home` 图标）。
- **已验证 (2026-07-10)**: TypeScript `--noEmit` 检查与 Next.js 生产构建（`npm run build`）均通过，`/home` 和 `/api/ai/daily` 正确出现在构建路由列表里。
- **未验证**: 尚未登录真实账号在浏览器里实际打开 `/home` 确认天气卡片、AI 推荐搭配图片的真实效果（依赖 `OPENWEATHER_API_KEY` 和 profile 里填了 city，以及衣橱里至少有 2 件已分类单品）。
- **后续修正 (2026-07-10)**:
  - 修了一个"每次打开/刷新页面都会自己重新生成一次推荐"的问题：`daily-recommendation.tsx` 现在把当天的推荐结果（含反馈状态）缓存进 `localStorage`（key 按 `userId + 当天日期`），挂载时先读缓存，有就直接用，不重新 fetch；只有用户主动 Dislike 才会重新请求 `/api/ai/daily` 并覆盖缓存。移除了原来单独的「Regenerate」按钮，改成 Like/Dislike 两个按钮：Like 只是记录反馈（不重新生成），Dislike 直接重新生成一套新推荐。
  - 新增「Add to outfits」按钮：直接复用 `outfits-view.tsx` saveOutfit 同款客户端 Supabase insert 逻辑（浏览器端 `createClient()`），把当天推荐的 items 写入 `outfits`（`ai_generated: true`，`ai_reasoning` 存 Claude 给的理由，`folder: "Everyday"`）+ `outfit_items`，写完标记为已保存并禁用按钮防止重复保存。
- 待做 (Google Calendar 部分，未在本次任务中实现): OAuth 接入（schema 里没有存 token/事件的表，需要新表或复用 `profiles`）；把当天日程传给 `/api/ai/daily` 的 prompt（`context.calendar` 字段目前只在 `stylist` route 里预留，`daily` route 还没接这个字段）。

### 任务 2: AI Stylist 用 Canvas 展示推荐并可编辑 — ❌ 待开发

- 需求: 目前 `POST /api/ai/stylist` 只返回纯文字 `{ reply }`（`src/app/(dashboard)/stylist/page.tsx` 就是一个文字聊天框）。推荐的搭配应该像 `outfits` 的自由拼贴 Canvas 一样，以图片拼贴的形式展示，并且用户可以直接在 Canvas 上编辑（挪动、替换单品等）。
- 可复用: `src/app/(dashboard)/outfits/outfits-view.tsx` 里的自由拼贴 Canvas 组件（拖拽/缩放/层级/`clean_url` 透明展示逻辑）——目标是让 stylist 推荐结果能复用同一套 Canvas，而不是重新造一个。
- 待做: stylist route 除了文字回复外，还要返回结构化的「推荐单品 id 列表 + 初始布局」；前端渲染 Canvas 而不是纯文字气泡；Canvas 编辑后要能「保存为搭配」（复用任务 3 的编辑/保存逻辑）。

---

## 已完成任务详情（历史记录）

### 任务: 已保存的 outfit 支持编辑 — ✅ 完成

- 需求: `Your outfits` 库里已保存的搭配之前不能编辑，只能新建。用户应该能打开一个已保存的 outfit，回到 Canvas 里调整（挪动/缩放/增删单品）后重新保存。
- 已实现:
  - `supabase/schema.sql`：`outfit_items` 新增 `x`/`y`/`width`（numeric，可空）三列，持久化自由拼贴坐标/宽度；旧记录为 null，读取时回退到按索引计算的默认网格布局。schema.sql 底部附了给已有数据库手动执行的 `alter table` 语句（本仓库无迁移工具，需要在 Supabase SQL Editor 手动跑一次）。
  - `outfits/page.tsx`：查询新增 `x, y, width` 字段。
  - `outfits-view.tsx`：
    - `SavedOutfitJoin` 类型新增 `x`/`y`/`width`。
    - 抽出 `defaultLayoutFor(index)` 复用于「新增单品默认布局」和「编辑已保存 outfit 时旧记录缺失坐标的回退布局」。
    - 新增 `editingOutfitId` state；`startEdit(outfit)` 按 `position` 排序还原 `selectedIds`/`canvasLayouts`/名称/合集/备注并进入 Canvas；`startCreate()` 显式清空 `editingOutfitId` 保证「新建」入口不会误继承编辑态。
    - `saveOutfit()` 按 `editingOutfitId` 是否存在分支：编辑态 `update outfits` 元数据 + 删除旧 `outfit_items` + 按当前 Canvas 状态重新插入（含 `x/y/width`）；创建态保持原 insert 流程不变（同样带上 `x/y/width`）。
    - `OutfitLibrary` 卡片新增悬停显示的「Edit」按钮（Pencil 图标），点击调用 `onEdit(outfit)`；`BuilderHeader` 根据 `isEditing` 切换标题/保存按钮文案（"Edit outfit" / "Save changes"）。
- **已验证 (2026-07-10)**: TypeScript `--noEmit` 检查与 Next.js 生产构建均通过。
- **未验证**: 尚未登录真实账号在浏览器里实际点开一个已保存 outfit、编辑、保存、刷新确认布局被正确恢复（依赖先在 Supabase SQL Editor 手动执行 schema.sql 底部的 `alter table` 语句）。

### 任务: 搭配创建/保存 + 自由拼贴 Canvas — ✅ 前端完成

- 已实现:
  - `src/app/(dashboard)/outfits/page.tsx`
    - 服务端并行读取当前用户的 `outfits`（含 `outfit_items` 与单品预览字段）和全部未归档 `wardrobe_items`，传给客户端搭配视图。
  - `src/app/(dashboard)/outfits/outfits-view.tsx`
    - 搭配库：展示已保存搭配、单品拼图预览、合集、穿着次数和备注；空状态可直接开始第一套搭配。
    - Closet 单品池：支持类别筛选和颜色/品牌/类型搜索；单品使用 1:1 `object-contain` 完整显示，卡片互不遮挡；加入 Canvas 后从左侧消失，从 Canvas 移除后自动回到左侧。
    - 自由拼贴 Canvas：可从 Closet 拖入或点击自动加入；拖入时以释放点作为初始位置；支持鼠标/触屏自由移动、自动置顶和右下角缩放，尺寸限制为画布宽度的 15%–60%，移动和缩放都限制在画布边界内。
    - Canvas 单品直接使用 `clean_url`（缺失时回退 `original_url`）展示；已移除白/灰卡片底、灰色边框和底部名称栏，只保留悬停时的删除与缩放控件。
    - 保存：至少选择 2 件；写入 `outfits` 后按当前层级顺序批量写入 `outfit_items.position`；关联写入失败时自动删除刚创建的空搭配，避免半成品数据。
    - 支持搭配名称、Collection（Everyday/Work/Weekend/Date Night/Travel/Special Occasion 等）和备注；未填写名称时自动生成日期名称。
- **已验证 (2026-07-10)**: TypeScript `--noEmit` 检查与 Next.js 生产构建均通过。
- **边界已解除 (2026-07-10)**: 最初 `x/y/width` 只是创建页面内的客户端状态，刷新或重新打开搭配不会恢复自由坐标和尺寸；现已在「已保存的 outfit 支持编辑」任务里给 `outfit_items` 加了 `x/y/width` 列并接上编辑/保存逻辑，详见上方该任务条目。

### 任务: 多件物品识别 (自动判断 single vs multi-item) — ✅ 代码已完成，⚠️ 待真实调用验证

- 已实现:
  - `src/lib/ai/segment.ts`
    - `detectItems(imageUrl)`: Haiku vision 在一次调用中返回物品计数和供 SAM 3.1 使用的具体英文 noun prompts（复用 `classify.ts` 的 `resizeForClassification`）；同类物品 prompt 会归一化去重
    - `segmentItems(imageUrl, prompts, expectedCount)`: 调用 fal.ai `fal-ai/sam-3-1/image`，显式开启 `return_multiple_masks/include_scores/include_boxes`；读取官方 normalized `[cx,cy,w,h]` boxes，过滤 <1% 图片面积的碎 mask、按分数去重，最多取 12 个，再用 Sharp 从原图裁剪（不用 SAM 黑底 applied-mask 图）
  - `src/app/api/ai/classify/route.ts`
    - ≤1 件 → 原单件 pipeline 完全不变（去背景 → Claude 分类 → 存储，返回 `{ item, classification, multiItem: false }`）
    - ≥2 件 → `segmentItems` 拿到裁剪图 → 每张裁剪图先传到 Storage 拿 URL（fal 的去背景需要可访问的 URL）→ 复用同一套「去背景 → Claude 分类 → 插入 wardrobe_items」逻辑（抽成 `processOneItem` 共享函数）→ 返回 `{ items: [...], multiItem: true, count }`；单个 segment 失败不影响其它 segment（catch 后跳过，全部失败才报错）
    - **已更新**: 判断「≤1 件还是 ≥2 件」现在不是无条件调用 `detectItems`——见下面「泛化配对逻辑…」任务里的 `mode` 参数，用户选 single 时这一步完全跳过
  - `src/components/closet/upload-zone.tsx`: 新增 `detecting` 阶段提示；根据响应里的 `multiItem` 分流展示「Added N items」或原有单件文案，`result` 增加 `count` 字段
- **已验证 (2026-07-10)**: `fal-ai/sam-3-1/image` 真实响应为 `masks`, `scores`, `boxes`, `metadata`；测试图用 `purse` prompt 返回 4 个独立 mask，boxes 为官方 normalized `[cx,cy,w,h]`。宽泛 prompt 会返回 0 个 mask，因此必须由 Claude 提供具体可见物品 noun。
- 未做 (Phase 2): 前端 checkbox 勾选/取消每个检测到的物品的 UI — 目前 multi-item 检测到的所有 segment 会全部自动分类入库，没有确认环节

### 任务: 鞋子自动配对 + 单只镜像补全 — ✅ 代码已完成，✅ 已真实调用验证

- 需求: 多件识别检测到多只鞋子时，同一双鞋的两只应合并成一条 `wardrobe_items` 记录；真正落单的单只鞋子要严格镜像生成对称的另一只（不能凭空编造不同设计），保证左右脚都在；已经是真实一双的不应该再被镜像。
- 已实现 (`src/lib/ai/segment.ts`):
  - `mergeShoePairs`: 从 SAM 检测结果里挑出 `prompt === "shoe"` 的 crop；0 只直接跳过；1 只直接镜像；≥2 只调用 `classifyShoePairing` 判断配对。
  - `classifyShoePairing`: 把所有候选鞋子裁剪图在一次 **Sonnet**（`claude-sonnet-5`，非 Haiku）vision 调用中一起发出去（`resizeForClassification` 复用自 `classify.ts`），要求先逐只描述楦型/鞋跟鞋底/材质颜色/开合方式/品牌 logo，再判断是否有另一只满足全部特征一致才算一双，最后输出 `FINAL:{"pairs":[[1,2]],"singles":[3,4]}`（`max_tokens: 4096`，给足推理空间）。不确定或解析失败一律回退为「全部单只」——错误合并两只不同的鞋比拆成两条单鞋记录更糟。
  - 配对成功的两只 → 按各自在原图里的 `detection.box[0]`（centerX）排序后用 `composeSideBySide` 拼成一张图存一条记录（真实反映拍摄时的左右位置）；落单的一只 → `sharp().flop()` 水平镜像后再 `composeSideBySide`，镜像只是同一像素的翻转，不会编造细节。
- **已验证 (2026-07-10，真实调用 fal.ai + Anthropic API)**:
  - `test_shoe_1.jpg`（3 双鞋，每双两只在照片里交叉/靠近摆放，且经常一只只露鞋底、另一只只露侧面）→ 正确识别为 3 双，未误拆成 6 只单鞋；拼图左右顺序按原图实际位置摆放。
  - `test_bag&single_shoe.jpg`（2 个包 + 6 只互不相关的单鞋：白球鞋/裸色尖头鞋/棕色露趾鞋/黑色短靴/黑色 Prada 拖鞋/黑色尖头高跟鞋）→ 6 只全部正确识别为 singles，各自镜像成对称的一双，没有把不同款鞋错误拼成一双。
  - 详细踩坑记录（distance 贪心 → Haiku 配对过宽松 → Haiku 配对过严格漏掉真实的绑带凉鞋对 → 换 Sonnet）见 Debug Log「鞋子配对」表 #10–14。

### 任务: 泛化配对逻辑到耳环/手镯等 accessories + 上传时用户预选 single/multi 省 token — ✅ 代码已完成，⚠️ 手镯/耳环路径待真实调用验证

- 需求 1（泛化配对）: 鞋子的「同一双合并成一条」问题在耳环、手镯等 accessories 上同样存在——如果一张图里检测到两个很相似的裁剪图，应该判断是不是同一实物，是的话合并成一条记录，而不是分别存两条。
- 需求 2（省 token）: 目前每次上传都会调用一次 `detectItems`（Haiku vision）来判断是单件还是多件，但大部分上传其实是单件。应该让用户上传前就声明「单件」还是「多件」，用户选了单件就完全跳过这次模型判断调用，从入口就把 token 省下来。
- 已实现:
  - `src/lib/ai/segment.ts`：`mergeShoePairs`（鞋子专用）泛化为 `mergeDuplicateAccessories`（通用）：
    - 先把 SAM 检测结果按 `detection.prompt`（`normalizeSamPrompt` 归一化后的名词，如 `shoe`/`earring`/`bracelet`）分组。
    - 每组只有 1 个 → 如果这个品类在 `MIRROR_IF_LONE_PROMPTS`（目前是 `shoe` 和 `earring`——天生成对穿戴的品类）里就镜像补全，否则原样保留、**不调用任何模型**（比如一个手镯本来就是完整的一件，没必要凭空造第二个）。
    - 每组 ≥2 个 → 调用泛化后的 `classifySimilarItems(buffers, itemLabel)`（原 `classifyShoePairing`，prompt 里的 "shoe/toe shape/heel" 等鞋子专属措辞都换成了通用的 "item/shape/material/hardware"），判断哪些是同一实物的不同角度照片；确认配对的按原图 `detection.box[0]` 左右排序后 `composeSideBySide`；`MIRROR_IF_LONE_PROMPTS` 品类里没配对上的落单项额外镜像，其它品类的落单项直接保留。
    - `normalizeSamPrompt` 新增 earring（earring/stud/hoop → `earring`）和 bracelet（bracelet/bangle/cuff → `bracelet`）同义词归一化，避免 Haiku 把同类饰品拆成不同 prompt。
  - `src/app/api/ai/classify/route.ts`：请求体新增可选 `mode: "single" | "multi"`。`mode === "single"` 时完全跳过 `detectItems` 调用，直接 `itemCount = 1` 走单件 pipeline；`mode === "multi"` 时仍调用 `detectItems`（拿 SAM prompts 少不了），但用 `Math.max(2, detection.count)` 强制走多件分支，相信用户的判断而不是模型的计数；不传 `mode` 时保持原来的自动检测行为（向后兼容）。
  - `src/components/closet/upload-zone.tsx`：新增「Single item / Multiple items」切换按钮（默认 single），上传时把 `mode` 一起传给后端；单件模式下拿掉「detecting」这个中间进度提示（因为后端根本不会跑这一步）。
- **已验证 (2026-07-10)**: 类型检查通过；鞋子这条路径的底层函数（`classifySimilarItems`/`mergeDuplicateAccessories`）复用了已经用真实图片验证过的鞋子配对逻辑，只是参数化了名词和 prompt 措辞。
- **未验证**: 手镯/耳环的泛化路径还没有用真实的手镯/耳环照片跑过 `fal.ai` + Anthropic 的真实调用；`mode="single"` 跳过检测调用这条路径也还没有登录到真实账号里点一次上传确认。

---

## 项目结构参考

```
ai-wardrobe/
├── src/
│   ├── app/
│   │   ├── (auth)/login, signup
│   │   ├── (dashboard)/closet, outfits (含自由拼贴 Canvas), stylist, profile, analytics, travel
│   │   └── api/ai/classify, convert (HEIC), stylist + api/weather
│   ├── components/closet (upload-zone.tsx, item-card.tsx), layout
│   ├── lib/ai/remove-bg.ts, classify.ts, segment.ts (多件检测 + 配对泛化) + supabase/client.ts, server.ts
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
| 上传 UI（single/multi 切换、进度提示） | `src/components/closet/upload-zone.tsx` |
| AI Stylist 对话 | `src/app/api/ai/stylist/route.ts` |
| 每日推荐 (Home) 数据+AI 逻辑 | `src/app/api/ai/daily/route.ts`, `src/lib/weather.ts` |
| Home 首页 UI | `src/app/(dashboard)/home/page.tsx`, `daily-recommendation.tsx` |
| AI Stylist 页面（目前纯文字聊天） | `src/app/(dashboard)/stylist/page.tsx` |
| 搭配创建/保存、自由拼贴 Canvas | `src/app/(dashboard)/outfits/outfits-view.tsx` |
| 搭配页服务端数据查询 | `src/app/(dashboard)/outfits/page.tsx` |
| 数据库类型定义 | `src/types/database.ts` |
| 认证 / 路由保护 | `src/proxy.ts` |
| 数据库 Schema | `supabase/schema.sql` |
| 环境变量 | `.env.local` |
