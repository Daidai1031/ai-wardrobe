# AI Wardrobe — Implementation Checklist

> Last updated: 2026-07-27（进度重整 + 范围扩充）
>
> **本文件只负责「已完成的实现细节 + Debug Log」。未来要做什么、按什么顺序做、新功能的技术方案，全部移到 [`ROADMAP.md`](./ROADMAP.md)。**
>
> 当前优先级：Phase 6 = Daily/Weekly outfit planning + 出差模式（天气 + Google Calendar + Gmail）。
> 新增但尚未排期的范围：双端（C 端/B 端）、Human Stylist Consultation 预约、Shopping Recommendations、冷启动 Onboarding、Avatar（fal.ai）。详见 ROADMAP.md 第四节。
>
> **动手前已敲定的 14 条决策记在 ROADMAP.md 第二节「决策记录」，改动前先读理由。**
>
> ⚠️ ROADMAP 第四节新增「数据边界」一节：哪些数据可进 Folk CRM、哪些绝不出 App。原始日历事件与邮箱内容是硬边界。
>
> 上一次进度（2026-07-10）：搭配创建/保存与自由拼贴 Canvas 完成；鞋子/耳环/手镯配对泛化 + 上传 single/multi 预选完成；已保存 outfit 支持编辑完成；Home 每日推荐（天气+衣橱版）完成。

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
| 每日推荐 (Home Page) | ✅ Phase 6.1 完成且已真实验证（2026-07-30） | `/home` 已接天气 + `eventsOnLocalDay()` + 活跃衣橱，Haiku 动态输出 1–N 个 segments；三层数据库结构是唯一缓存，普通同日 GET 不再调 Claude；Dislike 明确排除旧 item IDs；segment 可编辑和单独保存；Worn 原子写 journal，并让当天出现过的每件单品统一 `times_worn +1`。端到端验证详见下方「任务 1」 |
| Weekly planning (7 天规划) | ❌ 待开发 | ROADMAP Phase 6.2。需要 OpenWeather 5day/3hour 预报 + 当周日历 + 「7 天内 statement piece 不重复」等约束 |
| Google Calendar 集成 | ✅ OAuth/事件同步/语义化/daily 接线 / ❌ stylist/weekly 待接 | daily 已用真实缓存事件构建动态 segments；`stylist` route 的 `context.calendar` 仍未接线 |
| Gmail 集成（行程/dress code 信号） | ❌ 待开发 | ROADMAP Phase 6.0/6.3。用途是行程确认邮件 → 自动发现出差、活动邀请、邮件里的明文 dress code；只存抽取后的结构化字段，不存正文。注意 Gmail readonly 属于 Google restricted scope，上线前需通过 Google 验证审核 |

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
| Capsule Wardrobe Generator | ❌ 占位页面 | ROADMAP Phase 6.3。目标函数和 daily/weekly 不同：最小化件数、最大化组合数（一衣多穿） |
| Travel Packing Planner | ❌ 占位页面 | `src/app/(dashboard)/travel/page.tsx` 目前只是一句 "coming in Phase 5" 的静态文案；`travel_plans` 表（含 `packing_list`/`daily_outfits`/`weather_data` 三个 JSONB 列）已建好但零读写 |
| Printable outfit cards | ❌ 待开发 | ROADMAP Phase 6.3。`/travel/[id]/print` + `@media print`，一天一卡（含天气/日程/单品图/理由/手写备注区），确定性网格排版而非自由拼贴 |
| Packing List 导出 | ❌ 待开发 | 先做「复制为文本」+ 打印/PDF，不必一上来做原生分享 |

### Phase 6+ — 新增范围（详细方案见 ROADMAP.md）

| 功能 | 状态 | 依赖 / 备注 |
|------|------|------|
| Phase 6.0/6.1 schema | ✅ 全部已在生产库执行（2026-07-30） | 6.0 的三张表已在生产建好；6.1 把扁平 `outfit_plans` 升级为父表 + `outfit_plan_segments` + `outfit_plan_segment_items`，修正 nullable unique，并增加 journal 快照及三个原子 RPC。`database.ts` 已补齐 6.0/6.1 类型。`google_connections` 继续保持只有 service role 可访问。执行后已用 `information_schema`/`pg_constraint` 复核：两张新表、三个 RPC、`UNIQUE NULLS NOT DISTINCT` 约束、`outfit_plans` 旧扁平列已清、`outfit_journal` 的 `plan_segment_id`/`item_ids` 均到位 |
| Google OAuth 底座 — Calendar 一路 | ✅ 已实现且已真实跑通 | 2026-07-30，分支 `phase-6.0-google-oauth`。`GET /api/google/auth?scope=calendar`（CSRF state + httpOnly cookie）→ Google consent（`calendar.readonly`，`access_type=offline&prompt=consent`）→ `GET /api/google/callback` 换 token、upsert `google_connections`（真实拿到的 `scopes` 数组，不是请求时设的）→ `src/lib/google/client.ts` 的 `getAccessToken()`/`hasScope()`，走 `src/lib/supabase/service.ts` 新增的 service-role client（`google_connections` 无 RLS policy，只有它能读写）。refresh 失败会打 `invalid_at` 时间戳、返回 `null`，不抛 500。**已真实验证（2026-07-30）**：在 Testing 模式项目下完整走通 consent（含「Google hasn't verified this app」→ Advanced → 继续）→ callback → `/profile?google_calendar=connected`，直接查库确认 `google_connections` 行写入正确（`scopes=["…/calendar.readonly"]`、`expires_at` 约 1 小时后、`invalid_at=null`、`google_email=null`——预期如此，因为只请求了 calendar scope，没带 email/openid）。**设置页面 UI 已补（2026-07-30）**：`/profile` 的「Connected accounts」区块，Calendar 可连接/重新授权/断开，Gmail 一行标为「Not available yet」（故意显示不隐藏，让 D1 的「两次独立授权」在界面上可见）。状态由 Server Component 用 `getConnectionStatus()` 读、返回结构不含 token；断开走 `POST /api/google/disconnect`。**⚠️ 设置页 UI 只过了 build，未真人点过** —— 待验三条：断开后 Google 账号第三方访问列表里确实消失（证明 revoke 打到了 Google 而不只是删了本地行）、重连后地址栏的 `?google_calendar=connected` 会被清掉、断开状态下 `/home` 优雅降级为无日历事件而不是 500。Gmail 那一路（`?scope=gmail`）仍故意 400，下一个任务再做 |
| `outfit_plans` 统一计划结构 | ✅ 完成且已真实验证 | 日/周/出差共用日期父行，动态段落与单品使用关系型子表；daily 已读写并完全替换 localStorage |
| 日历事件抓取 + 语义化（occasion + formality） | ✅ 已实现且已真实验证 | 2026-07-30，分支 `phase-6.0-google-oauth`。`GET /api/google/calendar/sync` 拉真实 Google Calendar 事件（`src/lib/google/calendar.ts`）→ upsert 进 `calendar_events` → 对 `occasion IS NULL` 的行批量调一次 Haiku（`src/lib/calendar/classify-events.ts`，只喂 title/location/attendee_count，不喂 description，避免用户自己写的「预期答案」污染分类）。**已用真实 Google Calendar 里手动建的 8 个覆盖不同场合的测试事件跑通**：occasion 标签基本准确（`board_meeting`/`gym`/`travel`/`dinner`/`coffee`/`doctor_appointment` 等），6/8 formality 完全命中用户预期，2 个（board meeting、client call）低了 1 档——board meeting 期望 5 实际给 4，可能是模型把 5 分留给纯黑领结场合、公司会议算 4，如果要卡死「board meeting=5」需要在 prompt 里显式区分「business formal」和「black tie」。重跑同一批事件验证了「同一个 `google_event_id` 只分类一次」：occasion 已存在的行不会再触发 Haiku 调用 |
| 本地日期分桶工具（`day-bucket.ts`） | ✅ 已实现且已真实验证 | 2026-07-30。`src/lib/calendar/day-bucket.ts` 的 `eventsOnLocalDay(events, localDate, timeZone)`——daily（6.1）和 weekly（6.2）共用同一份时区转换 + 跨天事件重叠判断逻辑，不各写一份。全天事件特殊处理：按 UTC 日期字符串直接比较，不经过时区转换（因为全天事件本来就没有真实的时刻，硬转时区会把它错误地挪到相邻的本地日）。**已用真实 8 个测试事件验证**：`America/New_York` 时区下，9:45am/3pm/8:15pm（跨 UTC 日期）三个事件正确落进同一个本地日——命中用户「一天三个场合」的测试意图；2 天的 Boston 出差全天事件正确出现在两个本地日上、且不出现在 exclusive 的结束日；换成 `Asia/Shanghai` 时区后分桶结果确实不同（不是写死某个时区）。这一步做完才开始 6.1 的 daily 专属逻辑 |
| 冷启动 Onboarding（问卷 + 风格滑卡） | ❌ 待开发 | Phase 7。`preference_swipes` 表 + `profiles.preference_dna` 字段都已就绪；ROADMAP 里建议把它排在 Avatar/Shopping 之前，因为它是所有推荐质量的上游且成本最低。唯一非代码工作量是准备 20–40 张风格参考图 |
| Avatar 生成（fal.ai） | ❌ 待开发 | Phase 8。`profiles` 的 `skin_tone`/`hair_color`/`hair_length`/`body_shape` 就是给这个预留的。**成本量级和文本调用不同，必须缓存 + 限流**；虚拟试穿比静态 avatar 难得多，建议分两步 |
| Shopping Recommendations | ❌ 待开发 | Phase 9。缺口信号已经在产出（daily 的 `gap`、出差 capsule 缺口、Analytics 类别失衡）只是丢掉了。**最大未决问题是商品数据源**，建议先接一个联盟 feed 而不是做通用爬虫 |
| 搭配师授权访问 + Folk CRM 集成 | ❌ 待开发 | Phase 10（原「Human Stylist Consultation」，已简化）。需要 `stylists`/`stylist_availability`/`consultations` 等表 + Stripe Connect + 显式限时可撤销的衣橱授权（`wardrobe_grants`），不能靠角色一刀切放开 RLS |
| 双端（C 端客户 + B 端公司/造型师） | 🚫 **已取消**（2026-07-30，D12） | 公司为自有少数长期搭配师，不做第三方入驻平台。改为 Folk CRM 管客户列表/阶段/跟进 + App 只做 `wardrobe_grants` 授权访问。省掉 Stripe Connect 分账、入驻审核、评价体系 |

### 部署

| 功能 | 状态 | 备注 |
|------|------|------|
| Vercel 部署 | ✅ 完成 | 自动部署 from GitHub |
| 自定义域名 | ✅ 完成 | `closet.daidingrdesigns.com` → Vercel Domains 添加 |
| 环境变量 | ✅ 完成 | SUPABASE_URL, SUPABASE_ANON_KEY, FAL_KEY, ANTHROPIC_API_KEY |
| Supabase 心跳（防免费版暂停） | ✅ 完成 | `vercel.json` 里的 Vercel Cron（`0 0 */3 * *`，每 3 天）打 `GET /api/keep-alive` → 跑 `select id from profiles limit 1` 制造 DB 活动，避开免费版 7 天无活动自动暂停；返回空 200，无 body、无认证（anon 角色下 RLS 返回 0 行也算活动，不报错）。查询失败时 best-effort POST 到可选的 `KEEP_ALIVE_ALERT_WEBHOOK`（Slack/Discord）再返回 500——**已用 Discord webhook 实测告警送达（2026-07-30）**；**局限**：只能报「跑了但失败」，抓不到「cron 根本没触发」，后者需外部 dead-man's-switch（如 healthchecks.io） |

---

## 下一步开发任务

> **完整的优先级和技术方案已移到 [`ROADMAP.md`](./ROADMAP.md)。** Phase 6.0 共用底座和 6.1 Daily 均已完成并真实验证（含 section 15 migration 已在生产库执行）；进入 Phase 6.2 Weekly 之前先清「6.1 收尾」两项：按 segment 单独 Dislike、「Adjust this segment」改 Canvas 编辑。
>
> 下面两条保留下来，是因为它们记录了已经落地的实现细节和明确的剩余缺口：

### 任务 1: 每日推荐 (Home Page) — ✅ Phase 6.1 完成且已真实验证（2026-07-30）

- 需求: dashboard 需要一个真正的首页，结合 Google Calendar（当天日程）+ OpenWeather（当天天气）生成每日穿搭推荐。原来 `/` (`src/app/page.tsx`) 只是重定向到 `/closet` 或 `/login`，dashboard 路由组下没有独立首页。
- 已实现:
  - `src/lib/weather.ts`（原始版本，已废弃）：把原来内联在 `api/weather/route.ts` 里的 OpenWeatherMap 请求逻辑抽成 `getWeather(city)`，两处（`/api/weather` 和新的 `/api/ai/daily`）共用，避免服务端互相发 HTTP 请求。**2026-07-30 起被 `src/lib/weather/` 目录取代**（ROADMAP Phase 6.0-E）：拆成 `openweather.ts`（`getCurrentWeather(lat, lon)`）+ `open-meteo.ts`（`getForecast`，weekly/travel 用）+ `geocode.ts`（`geocodeCity(city)`，唯一做城市名转坐标的地方）。provider 层现在只认经纬度；`profiles` 新增 `lat`/`lng` 字段，保存 city 时顺手转一次坐标存下，daily 每次直接读存好的坐标，不再每次都转换。
  - `src/app/api/ai/daily/route.ts`（新增 `GET`）：读取当前用户 `profiles.lat`/`lng`（保存 city 时经 `geocodeCity()` 转好存下的坐标）→ `getCurrentWeather` 拿当天天气（没有坐标或没配 `OPENWEATHER_API_KEY` 时优雅降级为 `weather: null`，prompt 里注明"天气未知"）；并行读取活跃 (`archived=false`) 衣橱（复用 `stylist` route 同款字段）；系统 prompt 要求 Claude Haiku 只能从真实衣橱 id 里选 2–5 件组成当日一套搭配，输出严格 JSON（`{"itemIds":[...],"reasoning":"...","gap":"..."}`），用正则提取花括号 JSON 块解析（`parseDailyPick`），并用返回的 id 反查真实 `wardrobe_items` 行（防止模型编造不存在的 id）。衣橱少于 2 件或解析失败时返回 `message` 而不是报错，前端据此显示引导文案。
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
- **Phase 6.1 升级（2026-07-30）**:
  - `outfit_plans` 改为每天/来源/出差范围一个父行，新增 `outfit_plan_segments` 和 `outfit_plan_segment_items`；原普通 nullable unique 改成 `UNIQUE NULLS NOT DISTINCT`，保证 daily/weekly 的 `travel_plan_id=NULL` 也会正确命中 upsert。
  - `GET /api/ai/daily` 先查数据库缓存；只有 miss 才取天气、调用 Haiku 并通过 `replace_outfit_plan` 原子写入。日历输入来自已验证的 `eventsOnLocalDay()`，输出是动态 1–N 个完整 segments。
  - `POST /api/ai/daily` 是唯一显式重生成入口：接收当前所有 segment item IDs 的去重集合，验证都是用户自有单品，在候选集和 prompt 两层排除后覆盖同一计划并更新 `generated_at`。
  - `/home` 删除全部 localStorage 读写；按 segment 展示、增删实际单品、单独通过 `save_outfit_plan_segment` 保存到 Looks。Like 状态也写回 `outfit_plans.status`。
  - `mark_outfit_plan_worn` 在单个事务内保存调整后的 segment items、为每段写一条带 `item_ids` 快照的 `outfit_journal`，并更新 distinct 单品的 `times_worn/last_worn_at`。已确认计数口径：同一单品跨多个 segment，当天只 `+1`。这是本次唯一新增的 `wardrobe_items` 写路径。
  - **已真实验证（2026-07-30，真实账号 + 生产库）**：section 15 migration 在 Supabase SQL Editor 执行并复核通过后，用真实 Google Calendar 事件（当天 = 全天 Conference + 傍晚 Gym）跑通全链路：
    - **动态分段**：Haiku 按当天两个真实场合输出 2 段，label 为 `Conference`/`Gym`，两段 `event_ids` 各自绑定正确的事件行，第 2 段的 `change_from_previous` 正确描述了换装动作。
    - **缓存**：连续刷新 `/home` 只有 1 条 `outfit_plans` 行、`generated_at` 完全不变、`GET /api/ai/daily` 稳定在 ~300ms（真调 Haiku 是秒级）。证明 `UNIQUE NULLS NOT DISTINCT` 的 upsert 命中，而不是每次插新行——**没有这个修饰符时会静默地每次刷新都插一条新计划并重复计费**，是这次最值得盯的一项。
    - **Dislike**：`plan_id` 不变（覆盖同一父行）、`generated_at` 刷新、新旧 item IDs **零重叠**，推荐内容实质变化（黑西裤西装 → 海军蓝连衣裙叠白衬衫）。
    - **保存到 Looks**：`saved_outfit_id` 回填，`outfits` 行为 `ai_generated=true`/`folder='Everyday'`/`ai_reasoning` = 该段 reasoning，`outfit_items` 件数等于用户调整后的件数（5，不是 Claude 原始的 6）。
    - **Worn**：两段各写一条 `outfit_journal`；Conference 段因单品集合与已保存 outfit 一致而带上 `outfit_id`、Gym 段为 `NULL`——`mark_outfit_plan_worn` 的两个分支一次覆盖。人为让一件黑配饰同时出现在两段后，**它的 `times_worn` 只 `+1` 而不是 `+2`**；被用户从 Conference 删掉的 navy 连衣裙保持 `0`（证明计数跟的是调整后的集合，不是 Claude 的原始输出，即 D10）；8 件参与单品的 `last_worn_at` 全部是同一时间戳，未参与的 40+ 件纹丝不动。`status` 置为 `worn`。
  - **验证过程中踩到的两个坑（不是代码 bug，但要知道）**：① Supabase SQL Editor 里 `auth.uid()` 永远返回 `NULL`（以 `postgres` 角色直连、无 JWT），所有排查用的 SQL 必须换成字面 uuid，否则一律「0 rows」；② SQL Editor 一次运行多条语句只显示最后一条的结果集，多项检查要 `union all` 合并成一个结果。
  - **发现的行为与缺口**：天气在生成时快照进 `outfit_plans.weather`、当天不再刷新（改城市后旧计划仍显示旧城天气，需 Dislike 重生成）；`profiles.timezone` 为 NULL 时静默回落 `"UTC"` 而前端不传 `?timezone=`；Dislike 只能整天重生成、不能按 segment 单独重来；「Adjust this segment」仍是 `<select>` 下拉而非 Canvas。后两条列为「6.1 收尾」，已于同日实现，见下方。

### 任务 1b: 6.1 收尾（单段 Dislike + Canvas 编辑） — ✅ 完成且已真实验证（2026-07-30）

- 需求（用户 2026-07-30 提出）: ① 应该能对单个 segment 点 Dislike，而不是只能整天重来；② 「Adjust this segment」的下拉选择应改为进入 Canvas 编辑（复用 `/outfits` 那套），搭配完返回 `/home` 展示用户改好的穿搭。
- 两个动手前敲定的决策:
  - **`change_from_previous` 过期 → 同一次调用里一并重算**。重生成第 N 段后，第 N+1 段的「相对上一段的变化」描述的是已经不存在的那套衣服。备选是置空或放任不管；选了重算，因为模型本来就拿到了整天的上下文，多返回一个 `nextChangeFromPrevious` 字段零额外成本，而置空会让「早上那套 → (无说明) → 晚上那套」的衔接感断掉。
  - **Canvas 布局持久化**，给 `outfit_plan_segment_items` 加 `x/y/width`。备选是只把 Canvas 当选择器、不存版式；选了持久化，否则用户精心排的拼贴在返回 `/home` 时就丢了，和需求②「展示的是新的用户修改好的穿搭」不符。
- 已实现:
  - `src/components/outfit/outfit-canvas.tsx`（新增）：把 `outfits-view.tsx` 里的 `OutfitCanvas`/`ClosetPicker`/`defaultLayoutFor`/拖拽 payload 读写抽出来共享，泛型化为 `CanvasItem`（`WardrobeItem` 和 `DailyWardrobeItem` 都天然满足，调用方不用转数据）。新增 `layoutsFromRows()`（null 几何回退到默认网格）和只读的 `OutfitCollage`。`outfits-view.tsx` 改为 import，删掉本地副本。
  - `supabase/schema.sql`：`outfit_plan_segment_items` 加 `x/y/width`；新增 `apply_plan_segment_items()`（所有改写 segment 单品的路径统一入口）、`update_outfit_plan_segment_items()`（Canvas 保存）、`regenerate_outfit_plan_segment()`（单段重生成）；`replace_outfit_plan`/`mark_outfit_plan_worn`/`save_outfit_plan_segment` 改为走 helper，后者额外把几何复制进 `outfit_items`。
  - `src/app/api/ai/daily/route.ts`：抽出 `loadDailyContext()` 供三条路径共用（避免本地日期/日历窗口的推导逻辑分叉）；`POST` 带 `segmentId` 时走 `handleSegmentRegeneration`。
  - `src/app/(dashboard)/home/daily-recommendation.tsx`：每段头部加「重生成本段」和「Adjust」两个按钮；`<select>` 下拉整个删除；段内容改用 `OutfitCollage` 按持久化版式展示；新增 `SegmentCanvasEditor` 子组件。
- **顺带修掉的 bug**：旧的下拉编辑只是客户端 state，而计划每次加载都从数据库重读，所以用户改完不点「保存到 Looks」也不点 Worn 就刷新，改动会**静默丢失**。现在 Canvas 的「Done」立即落库。
- **踩坑**：`apply_plan_segment_items` 里必须先把存活行的 `position` 挪到 `+1000` 再重编号——`(segment_id, position)` 是唯一约束且不可延迟，就地更新会瞬时冲突；`position >= 0` 的 check 又排除了「挪成负数」这个更常见的写法。
- **已真实验证（2026-07-30，真实账号 + 生产库，section 15 重跑后）**，四条各自针对一种静默失败模式：
  - **单段重生成**：点 Segment 1 的 ↺ 后，它的 6 个 item id 与之前 5 个**零重叠**，而 **Segment 2 的 item_ids 一字未变**——后者才是「单段」作用域的证据，整天重排会把它也换掉。Segment 2 的 `change_from_previous` 同时被改写：改前写「换掉 cream pants 和 navy 上衣」，改后写「换掉 black trousers / white shirt / blazer，把 cream pumps 换成白跑鞋」，引用的正是重生成后的新单品。没有这次重算，它会一直指向一套已不存在的衣服。重生成段的 `x/y/width` 正确重置为 null，`saved_outfit_id` 正确清空。
  - **Canvas 落库**：排完版点 Done 后**刷新整个页面**，版式仍在——旧的下拉编辑只是客户端 state，刷新必丢。
  - **几何进 Looks**：存成 Look 后在 `/outfits` 点 Edit 打开，是同一张拼贴。
  - **Worn 不抹版式**：Confirm worn 后两段的 `x/y` 全部保留。这条在验 `mark_outfit_plan_worn` 走的是 `p_apply_layout = false`——它会重写 segment items（用户可能改过单品），传错成 `true` 就会把刚排好的几何静默抹成 null。
- **模型层面的小瑕疵（非管线 bug，未处理）**：重算出的 `change_from_previous` 里写了「remove accessories (bangle, belt)」，但重生成后的那套里并没有 belt，是 Haiku 顺手多写的。不影响数据正确性。
- **已验证**: `tsc --noEmit` 与 `npm run build` 均通过。`npm run lint` 在 Next 16 下已失效（`next lint` 把 `lint` 当成目录参数），是仓库既有问题，ESLint 实际由 `npm run build` 跑。

### 任务 2: AI Stylist 用 Canvas 展示推荐并可编辑 — ❌ 待开发（建议并入 ROADMAP Phase 6.1 一起做，因为两者都要给搭配加结构化输出）

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
| 每日推荐 (Home) 数据+AI 逻辑 | `src/app/api/ai/daily/route.ts`, `src/lib/weather/openweather.ts` |
| 天气 provider / 城市转坐标 | `src/lib/weather/` (`openweather.ts`, `open-meteo.ts`, `geocode.ts`), `src/app/api/geocode/route.ts` |
| Home 首页 UI | `src/app/(dashboard)/home/page.tsx`, `daily-recommendation.tsx` |
| AI Stylist 页面（目前纯文字聊天） | `src/app/(dashboard)/stylist/page.tsx` |
| 搭配创建/保存、自由拼贴 Canvas | `src/app/(dashboard)/outfits/outfits-view.tsx` |
| 搭配页服务端数据查询 | `src/app/(dashboard)/outfits/page.tsx` |
| 数据库类型定义 | `src/types/database.ts` |
| 认证 / 路由保护 | `src/proxy.ts` |
| 数据库 Schema | `supabase/schema.sql` |
| 环境变量 | `.env.local` |
