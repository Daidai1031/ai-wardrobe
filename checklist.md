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
| 自定义域名 | ✅ 完成 | `closet.daidingrdesigns.com` → Vercel Domains 添加 |
| 环境变量 | ✅ 完成 | SUPABASE_URL, SUPABASE_ANON_KEY, FAL_KEY, ANTHROPIC_API_KEY |

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
