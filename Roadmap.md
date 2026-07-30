# AI Wardrobe — 产品路线图 & 进度总览

> Last updated: 2026-07-30
> 本文件负责「往前看」：进度快照 + 优先级 + 未来功能的技术方案。
> `checklist.md` 负责「往回看」：已完成任务的实现细节 + Debug Log。
> `CLAUDE.md` 负责「当前架构」：给 Claude Code 的代码导航。

---

## 一、进度快照（截至 2026-07-30）

Phase 1–4 已基本覆盖，Phase 6.0 / 6.1 / 6.2 均已落地（6.0/6.1 已真实验证，6.2 待验证）。

### ✅ 已完成且已真实验证

| 模块 | 内容 |
|---|---|
| 基础设施 | Next.js 16 App Router + Tailwind 3 + TS；Supabase Auth/DB/Storage；RLS 全表覆盖；`proxy.ts` 路由保护；Vercel 部署 + 自定义域名 `closet.daidingrdesigns.com` |
| 上传 pipeline | HEIC→JPEG 转换 → 用户预选 single/multi → （multi 才调）Haiku 计数+SAM prompts → fal.ai SAM 3.1 分割 → 同款配对/镜像补全 → BiRefNet 去背景 → Haiku Vision 分类 → 入库 |
| 鞋子配对 | Sonnet 视觉判断同款；按原图 centerX 决定左右；落单镜像补全。已用 `test_shoe_1.jpg`（3 双）和 `test_bag&single_shoe.jpg`（6 只单鞋+2 包）真实跑通 |
| 数字衣橱 | 浏览/筛选（类别/颜色/季节）、单品详情编辑、收藏、删除 |
| 搭配 Canvas | 自由拼贴（拖拽/缩放/层级）、保存、已保存搭配可重新编辑（`outfit_items.x/y/width` 持久化） |
| Analytics | Style DNA 分布、穿着统计、Closet Health、Declutter 建议 |
| Profile | 身体数据 + 外貌字段（`skin_tone`/`hair_color`/`hair_length`/`body_shape` 已预留给 avatar） |
| Home 每日推荐 | `/home` + `GET/POST /api/ai/daily`：天气 + 当日本地日历事件 + 活跃衣橱 → Haiku 动态生成 1–N 个 segments；数据库按日本地缓存；Dislike 排除旧单品；segment 可编辑/单独保存；Worn 原子写 journal 和穿着次数 |
| AI Stylist | 多轮需求澄清 → 真实衣橱 ID 校验 → 可视化 Canvas + 理由/造型细节；Canvas 可编辑并保存到 Looks |
| Google Calendar | 独立 OAuth + `/profile` 连接/断开设置页；事件同步与 Haiku 语义化；`eventsOnLocalDay()` 本地日分桶。daily 和 weekly 都已接入 |
| Human Stylist 预约 | `/stylist` 内提供 30 分钟线上 / 9–5 线下全天两种服务；服务工时固定在搭配师时区、转换成用户本地时间显示，后台排除已占用区间并防止并发重复预约 |

### ⚠️ 代码完成但未验证

- 耳环/手镯的泛化配对路径（只验证过鞋子）
- `mode="single"` 跳过检测这条路径未在真实账号点过上传
- AI Stylist 的多轮澄清 → Canvas → 编辑/保存已过 type/build；真实 Anthropic 首次返回暴露的纯文本解析 502 已改为 forced tool call + 文本降级，修复后尚待登录账号重新跑完整链路
- Human Stylist 预约代码已完成，但生产库尚需手动执行 `schema.sql` section 16 后再真实预约验证
- ~~`/home` 的 Phase 6.1 多段计划~~ ✅ 已真实验证（2026-07-30），见 6.1 小节
- ~~`outfit_items` 的 `x/y/width` 三列需要在 Supabase SQL Editor 手动跑~~ ✅ 已随 Phase 6.0 section 15 迁移块一起在生产库执行（2026-07-30）
- **Phase 6.2 Weekly planning（`/plan`）**：代码完成、type/build 通过，但需重跑 section 15（唯一键去掉 `source` + `replace_weekly_plans`），且规则引擎（轮换/结构/完整度/天气）的最后一版尚未真实生成验证
- `/profile` 的 Connected accounts 设置页只过了 build，未真人点过连接/断开

### ❌ 未开始

| 项 | 现状 |
|---|---|
| Gmail | 从未进入过计划（D1 里定了策略，`?scope=gmail` 目前 400） |
| 出差模式 | `/travel` 是纯占位页；`travel_plans` 表建好了但零读写 |
| Capsule Wardrobe / Packing List | 无 |
| Folders UI | schema 就绪，无前端 |
| Outfit Journal / 日历视图 | schema 就绪，无前端 |
| Preference Engine（滑卡） | `preference_swipes` 表就绪，无前端 |
| 多件识别的勾选确认 UI | 检测到的 segment 目前全部自动入库，无确认环节 |
| 产品链接补充 | 无 |
| **新增范围**：双端 / Human Stylist / Shopping / Onboarding / Avatar | 见第三节 |

---

## 二、决策记录（2026-07-27 / 07-30 敲定）

写代码前定下来的 11 条。**改这些决定之前先回来读这一节的理由，不要直接改代码。**

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | Gmail 的 OAuth 策略 | **Calendar 和 Gmail 拆成两个独立授权按钮、两次 consent。Gmail v1 就做，但 Google Cloud 项目保持 Testing 模式、手动加测试用户，商业化前不提交 verification。** | `calendar.readonly` 是 sensitive，`gmail.readonly` 是 **restricted** —— restricted 会触发第三方 CASA 安全评估（年费几百至上千美元 + 4–8 周流程）。豁免条件包括「应用处于 Testing 而非 In production」和「访问少于 100 个 Gmail 账号」，现阶段完全够用。拆开授权是为了不让 Gmail 的合规负担挡住 Calendar：绑在一个 consent 里，用户拒绝 Gmail 就连日历一起没了。**不要为了避开 restricted 而改用 `gmail.modify`**（它被归为 sensitive）——那是拿更大的权限换更低的合规档，一个只读需求要写权限，consent 页会更劝退用户 |
| D2 | 天气 provider | **把 `src/lib/weather.ts` 抽成 provider 接口。daily 继续走 OpenWeather（已跑通，不动）；weekly/travel 走 Open-Meteo。** | OpenWeather 免费档只有 5 天预报，出差常提前更久订。Open-Meteo 无需 API key、16 天逐小时预报 + 1940 年起历史数据、非商业每天 1 万次免费。**注意：Open-Meteo 免费档限定非商业用途，数据按 CC BY 4.0 需署名** —— 本项目后面有 B 端和佣金，迟早算商业，届时要么买它的 customer API 要么统一回 OpenWeather。接口抽出来了，换的时候不疼 |
| D3 | 是否现在加角色字段 | **现在就加 `profiles.roles text[] default '{client}'`，但不写任何 B 端逻辑。** | 一行的成本，省掉 Phase 11 的 RLS 大迁移 |
| D4 | 时区 | **加 `profiles.timezone` + `travel_plans.destination_timezone`。`outfit_plans.plan_date` 一律存「该计划所属地点的当地日期」，写入时显式转换。** | 出差时目的地时区 ≠ 家里时区，是典型的差一天 bug 来源，事后极难查 |
| D5 | 生成的搭配是否落 `outfits` 表 | **不落。停在 `outfit_plans → outfit_plan_segments → outfit_plan_segment_items`，用户把某一个 segment 点「保存到 Looks」时才建 `outfits` 行。** | weekly/出差会生成大量计划段，全落库会把 Looks 库淹掉 |
| D6 | 打印卡片的排版 | **确定性网格，不用自由拼贴。**按固定类别顺序排：外套 / 上装 / 下装 / 鞋 / 配饰。不调 AI 排版 | 生成的搭配没有 `x/y/width` 布局数据（那是手动拼贴才有的）。而且打印卡要的是「一眼看清有哪几件」，自由拼贴在 A5 纸上反而更乱。想要拼贴的用户走「保存到 Looks」进 Canvas |
| D7 | 打印实现方式 | **`/travel/[id]/print` + `@media print` CSS。不上 puppeteer。** | Vercel serverless 跑 headless Chrome 要塞 `@sparticuz/chromium`，冷启动和包体积都疼。两个已知坑写在 6.3 里 |
| D8 | 约束满足交给谁 | **TS 硬过滤 + Claude 软选择的混合方案。**先在 TS 里按温度区间、formality 区间、`archived`、`last_worn_at` 太近筛掉，候选压到 30–50 件再交给 Claude | 不要指望 LLM 做硬约束满足，顺带大幅省 token。模型先 Haiku 试，capsule 那一步值得 Sonnet（低频） |
| D9 | 重生成限流 | **`outfit_plans.generated_at` + 每人每天每类型上限（weekly 3 次/天），超了返缓存。** | 防止反复点「换一套」把成本打上去 |
| D10 | Worn 记录 | **允许用户改完再确认，不直接把推荐记为已穿。** | 实际穿的经常和推荐的不一样，直接记会污染 `times_worn` 和 weekly 的去重逻辑 |
| D11 | Packing list 的非衣物部分 | **写死模板 + 可编辑，不让 AI 生成。** | AI 会漏充电器、也会幻觉出用户没有的东西 |
| D12 | 双端（C 端 / B 端） | **取消 B 端平台。**公司是自有的少数长期搭配师，不做第三方入驻。改为「Folk CRM 管流程 + App 管授权访问」 | 客户列表、阶段、跟进本来就是 CRM 的活，不用自己开发；搭配师看到的就是客户那套界面，不用做第二套。顺带省掉 Stripe Connect 分账和入驻/评价体系 |
| D13 | CRM 与 App 的数据边界 | **Folk 只存指针和业务状态，不存衣橱数据副本。原始日历和邮箱内容既不进 CRM 也不给搭配师。** | 一旦复制进 CRM，「客户撤销授权」就失去意义——副本不受权限规则管。详见第四节「数据边界」 |
| D14 | 一次性授权的跟进窗口 | **咨询结束后 14 天自动失效。** | 留出交付后答疑的时间，又不让授权无限期挂着 |

---

## 三、Phase 6（当前优先级）— Daily/Weekly Planning + 出差模式

三件事共用同一套底座：**Google OAuth（Calendar + Gmail）+ 计划持久化表 + 事件语义化**。建议按 6.0 → 6.1 → 6.2 → 6.3 的顺序做，前一步是后一步的输入。

### 6.0 共用底座（必须先做）

**A. Google OAuth（独立于登录，且 Calendar / Gmail 分开授权 —— D1）—— ✅ Calendar 这一路已实现且已真实验证（2026-07-30，分支 `phase-6.0-google-oauth`）；Gmail 未动**

现在的 Supabase Google Provider 只是登录用。Calendar/Gmail 需要额外 scope，而且 Supabase **不会长期保存 `provider_refresh_token`**（只在首次 sign-in 的 session 里给一次）。所以走自己的 OAuth 流程更可控：

- `GET /api/google/auth?scope=calendar` → consent 只要 `.../auth/calendar.readonly` ✅ 已实现；`scope` 传其他值目前直接 400（Gmail 那条 `?scope=gmail` 分支留给下一个任务，故意没写）
- `GET /api/google/auth?scope=gmail` → consent 只要 `.../auth/gmail.readonly` ❌ 未实现，下一个任务再做
- 两者都带 `access_type=offline` + `prompt=consent`（拿 refresh_token）✅ calendar 分支已带
- `GET /api/google/callback` → 换 token → upsert 进 `google_connections`，**把实际拿到的 scope 记进 `scopes` 数组** ✅ 已实现
- `src/lib/google/client.ts` → 统一的「取 access_token，过期就用 refresh_token 换」helper，并暴露 `hasScope(userId, scope)` 给上层判断功能可用性 ✅ 已实现（`getAccessToken()` / `hasScope()`）

设置页面是两个独立开关（「连接日历」/「连接邮箱」），不是一个「连接 Google」。每个功能入口都要先查 `hasScope`，没授权就显示引导而不是报错。**✅ 设置页面 UI 已实现（2026-07-30）** —— `/profile` 的「Connected accounts」区块：Calendar 一行（连接 / 重新授权 / 断开），Gmail 一行但标为「Not available yet」（故意显示而不是隐藏，让「两次独立授权」这个设计在界面上看得见）。状态在 Server Component 里用新增的 `getConnectionStatus()` 读，返回的结构**不含任何 token** —— `google_connections` 无 RLS policy 就是为了让 token 到不了浏览器，把它塞进 props 传下去等于白设。断开走新增的 `POST /api/google/disconnect`（先向 Google revoke，再删行；revoke 失败也照删，但 UI 会明说「Google 那边可能还挂着，需要自己去账号设置移除」）。三种状态分开处理：未连接 / 已连接 / `needsReconnect`（有行但 `invalid_at` 非空）——最后这种在 Testing 模式下是常态不是异常。

Google Cloud 项目**保持 Testing 模式**（D1），测试用户手动加进 OAuth consent screen 的 test users 列表。Testing 模式下 refresh_token 有效期较短（通常 7 天）会过期，所以 `google/client.ts` 必须能优雅处理「refresh 失败 → 标记连接失效 → 前端提示重新授权」，不能抛 500 —— ✅ `getAccessToken()` 已实现：refresh 失败会把 `google_connections.invalid_at` 打上时间戳并返回 `null`，不抛异常。这一条在正式 verification 之后才会消失。

Google Cloud Console 手动操作清单（代码做不到，需要人去控制台点）：详见 `README.md` 的「Google Calendar OAuth (Phase 6.0-A)」小节 —— 建项目/启用 Calendar API、consent screen 选 External + 保持 Testing、把开发用的 Google 账号加进 test users、建 OAuth client（Web application）并登记 `http://localhost:3000/api/google/callback` 和生产域名下的回调地址为 authorized redirect URI、拿到 client id/secret 填进 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`、在 consent screen 的 Scopes 里加 `.../auth/calendar.readonly`。

**B. 新增数据表**（追加进 `supabase/schema.sql`）— ✅ **6.0 schema 已在生产库执行（2026-07-30，分支 `phase-6.0-schema`）**。`database.ts` 的三张 6.0 表类型现已补齐；Phase 6.1 又加入 segment 两表和事务 RPC，但这一轮 section 15 migration 尚待在 Supabase SQL Editor 执行。下面 SQL 只保留为最初 6.0-B 草案参考，当前权威结构见紧随其后的修正说明和 `schema.sql`。

```sql
-- Google 授权令牌：只允许 service role 访问，客户端一律拒绝
create table public.google_connections (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz,
  scopes         text[] default '{}',   -- 记录实际授到的 scope，配合 hasScope() 判断功能可用性
  google_email   text,
  invalid_at     timestamptz,           -- refresh 失败时打标（Testing 模式下 refresh_token 约 7 天过期）
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
-- 注意：不要给这张表写「用户可读自己行」的 RLS。前端永远不该拿到 token。

-- 日历事件缓存 + 语义化结果（避免每次规划都重新调 Claude 判断场合）
create table public.calendar_events (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  google_event_id text not null,
  title          text,
  location       text,
  starts_at      timestamptz not null,
  ends_at        timestamptz,
  all_day        boolean default false,
  attendee_count int default 0,
  -- Claude 语义化产物
  occasion       text,   -- board_meeting / client_dinner / casual / gym / travel / formal...
  formality      int,    -- 1-5
  synced_at      timestamptz default now(),
  unique (user_id, google_event_id)
);

-- 统一的「穿搭计划」：日/周/出差三种来源共用，替掉现在的 localStorage 缓存
create table public.outfit_plans (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  plan_date    date not null,
  source       text not null check (source in ('daily','weekly','travel')),
  travel_plan_id uuid references public.travel_plans(id) on delete cascade,
  outfit_id    uuid references public.outfits(id) on delete set null,
  item_ids     uuid[] default '{}',
  reasoning    text,
  gap          text,
  weather      jsonb default '{}',
  event_ids    uuid[] default '{}',
  status       text default 'suggested' check (status in ('suggested','accepted','rejected','worn')),
  generated_at timestamptz default now(),  -- D9 限流用
  created_at   timestamptz default now(),
  unique (user_id, plan_date, source, travel_plan_id)
);

-- D3：现在就加角色字段，不写任何 B 端逻辑，纯粹为了避免 Phase 11 的 RLS 大迁移
alter table public.profiles add column if not exists roles text[] default '{client}';

-- D4：时区。plan_date 一律存「该计划所属地点的当地日期」
alter table public.profiles     add column if not exists timezone text;
alter table public.travel_plans add column if not exists destination_timezone text;
```

> **Phase 6.1 结构修正（2026-07-30）**：上面的 6.0-B SQL 是最初的扁平草案，已被实际 daily 多段输出淘汰。当前权威结构见 `supabase/schema.sql`：`outfit_plans` 只存日期/来源/天气/gap/状态，动态段落存 `outfit_plan_segments`，每段的完整单品集合存 `outfit_plan_segment_items`。普通含 nullable `travel_plan_id` 的 unique 也已改为 `UNIQUE NULLS NOT DISTINCT`，否则 daily/weekly 的 NULL 不会触发 upsert 冲突。

> 迁移提醒：本仓库没有 migration 工具，新表同样要在 Supabase SQL Editor 手动执行，并在 `schema.sql` 底部的 alter 区块里补一份。

**C. 事件语义化 —— ✅ 已实现且已真实验证（2026-07-30，分支 `phase-6.0-google-oauth`）**

`src/lib/calendar/classify-events.ts`：一次 Haiku 调用批量吃进当周所有事件的 title/location/attendee_count，输出每个事件的 `occasion` + `formality(1-5)`，结果写回 `calendar_events`，**同一个 `google_event_id` 只算一次**。这是控制成本的关键——按周批量而不是按事件逐个调。

- `GET /api/google/calendar/sync?timeMin=&timeMax=`：拉真实事件（`src/lib/google/calendar.ts` 包一层 Calendar v3 `events.list`）→ upsert 进 `calendar_events`（只写原始字段，不碰 `occasion`/`formality`）→ 对这个时间窗内 `occasion IS NULL` 的行批量调 `classifyEvents()` → 写回。默认窗口是「今天 UTC 零点 到 +14 天」，不是真正的「本周」——那是 6.2 才要做的 Mon–Sun 边界。
- **已真实验证**：用户在真实 Google Calendar 里手动建了 8 个覆盖不同场合的测试事件（7/30–8/7），跑 `/api/google/calendar/sync` 拿到真实结果，逐条对过用户写在事件描述里的预期。occasion 标签基本准确；formality 6/8 完全命中，2 个（board meeting、client call）低了 1 档——不算数据管线的 bug，是模型对「4 分 vs 5 分」的尺度判断偏保守，5 分似乎被模型留给了纯黑领结场合。重跑同一批事件验证了幂等性：已分类的行不会再触发 Haiku 调用。
- **description 字段特意不喂给分类模型**——用户在测试事件描述里写了自己的预期答案，如果喂进 prompt 会污染测试；这条边界以后也要守住，`description` 只用于人工核对，`calendar_events` 表里也没有存它的列。

**D. Gmail 用来干什么（要想清楚再写）**

Gmail 的价值不是「读邮件」，而是三类**结构化信号**：

1. **行程确认**（航班/酒店/Airbnb/火车）→ 自动发现出差，填 destination + 日期，这是出差模式最好的入口
2. **活动邀请/票务**（婚礼、会议、演出、餐厅预订）→ 日历上没有但影响穿搭的场合
3. **dress code 明文**（邮件里写 "black tie" / "business casual" / "smart casual"）→ 直接决定 formality

实现建议：
- 不做全量收件箱扫描。用定向 query，例如
  `newer_than:90d (subject:(confirmation OR itinerary OR "booking") OR from:(booking.com OR airbnb.com OR united.com ...))`
- **只存抽取后的结构化字段，不存邮件正文**（隐私 + 存储成本）。抽取后原文丢弃。
- 抽取用 Haiku，一次吃 10–20 封的 subject + snippet 就够，不必拉 full body。
- UI 上必须是「我们从你的邮箱发现了这段行程，是否确认？」的**建议式**交互，不能默默替用户建行程。
- **Gmail 永远只是加速器，不是主路径（D1）**：出差模式的主流程必须是手填行程也能完整走通。没授权 Gmail、Testing 模式下 token 过期、或者邮箱里根本没有确认邮件，功能都不能残废——最多是少一个「从邮箱导入」按钮。所有 Gmail 相关代码路径都在 `hasScope(userId, 'gmail.readonly')` 后面。

**E. 天气 provider 接口（D2）—— ✅ 已实现（2026-07-30）**

`src/lib/weather/` 已经拆好：

```ts
interface WeatherProvider {
  current(lat: number, lon: number): Promise<WeatherData>;
  forecast(lat: number, lon: number, days: number): Promise<DailyForecast[]>;
}
```

- `src/lib/weather/openweather.ts` —— `getCurrentWeather(lat, lon)`，daily 继续用它，**行为不变**
- `src/lib/weather/open-meteo.ts` —— `getForecast(lat, lon, days)`，weekly/travel 用（尚未接线，等 6.2/6.3）。无需 API key
- `DailyForecast` 统一成 `{ date, tempMin, tempMax, precipitation, code, isEstimate }`
- `isEstimate` 是给出差模式用的：超出预报范围（Open-Meteo 是 16 天）的日期退化成历史气候均值，UI 上必须标注这是估算，不能和真预报混在一起显示
- 记账提醒：Open-Meteo 免费档限非商业用途 + CC BY 4.0 署名，商业化时要处理（见 D2）

**城市名 → 坐标，只在两个时间点转换一次，不是每次查天气都转**：provider 层（`openweather.ts`/`open-meteo.ts`）只认 `lat`/`lon`，完全不知道「城市名」这个概念；城市名解析单独放在 `src/lib/weather/geocode.ts` 的 `geocodeCity(city)`，只在下面两处调用：
- `profiles.city` 保存时 → 顺手转存进新增的 `profiles.lat`/`profiles.lng`（`profile-form.tsx` 的 `handleSave()`，只在城市文本真的改了才调用 `GET /api/geocode`，未改动则沿用已存的坐标）
- 建 `travel_plans` 时 → 顺手转存进新增的 `travel_plans.destination_lat`/`destination_lng`（列已建好，写入逻辑等 6.3 出差模式落地时接上）
`GET /api/geocode?city=` 是这条转换逻辑唯一的入口路由；`GET /api/weather` 仍额外支持直接传 `city`（每次请求都转换）纯粹是为了这个独立调试端点的方便，不代表调用惯例，daily/weekly/travel 的热路径一律读已存坐标。

**F. 本地日期分桶（daily/weekly 共用，D4 落地）—— ✅ 已实现且已真实验证（2026-07-30）**

`src/lib/calendar/day-bucket.ts` 的 `eventsOnLocalDay(events, localDate, timeZone)`：给一批已经从 Supabase 拉出来的 `calendar_events`（daily 拉 1 天的量，weekly 一次拉 7 天的量，都调同一个函数），返回属于某个本地日期的事件——正确处理时区转换（事件的 UTC 时刻要按 IANA `timeZone` 转换才能落到正确的本地日，不能直接切 UTC 日期字符串）和跨天事件（一个事件只要和这一天有重叠就算，不是只在开始那天算一次）。全天事件特殊处理：Google 的全天事件日期本身没有真实时刻，`sync` 路由编码成 `<date>T00:00:00Z` 只是为了塞进 `timestamptz` 列，所以全天事件按 UTC 日期字符串直接比较，完全不经过时区转换——如果硬转，会在非 UTC 时区把全天事件错误地挪到前一天或后一天。

**已用真实数据验证**（同一批 8 个测试事件）：`America/New_York` 时区下，9:45am / 3pm / 8:15pm（8:15pm 那条已经跨到下一个 UTC 日期）三个事件正确落进同一个本地日——命中了用户当初设计「一天三个场合」测试用例的意图；2 天的 Boston 出差全天事件正确出现在两个本地日、且不出现在 exclusive 的结束日；换成 `Asia/Shanghai` 时区后分桶结果确实不同，证明时区参数真的生效而不是写死。

按用户要求，这个工具写完测过、6.1 daily 专属逻辑再开工，避免 daily 和 weekly 各写一份时区/跨天逻辑然后慢慢分叉。

### 6.1 Daily planning（升级现有 `/home`）— ✅ 已实现且已真实验证（2026-07-30）

在已完成的天气版基础上：

- ✅ `GET /api/ai/daily` 用 `eventsOnLocalDay()` 拿当天全部事件，把每个事件的 `id + title + occasion + formality + 时间段` 传进 prompt
- ✅ **场合数量不写死**：prompt 按当天实际场合动态生成或合并 segments；每段保存完整 item 集合、reasoning、相对上一段的变化和 event refs
- ✅ 数据库成为唯一缓存：普通 GET 先查 `source='daily'` 的父计划和子段，命中不调用 Claude；不再读写 `localStorage`
- ✅ Dislike 把当前全部 segments 的 item IDs 去重后传回 route，服务端验证归属、从候选中移除并在 prompt 里明确排除；新结果原子覆盖同一父计划并刷新 `generated_at`
- ✅ 每个 segment 可以先增删实际单品，也可以单独原子保存成一条 `outfits`；「Worn today」把调整后的 segments 原子写回计划并为每段写一条 `outfit_journal` 快照，同时更新 `wardrobe_items.times_worn/last_worn_at`。计数口径已确认：同一件单品即使跨多个 segment，也只在当天统一 `+1`

**已真实验证（2026-07-30，真实账号 + 生产库）**：section 15 migration 执行后，用真实 Google Calendar 事件（当天 = 全天 Conference + 傍晚 Gym）跑通全链路。缓存：连续刷新 `/home` 只有 1 条 `outfit_plans` 行、`generated_at` 不变、`GET /api/ai/daily` 稳定在 300ms 量级（真调 Haiku 是秒级），证明 `UNIQUE NULLS NOT DISTINCT` 的 upsert 确实命中而不是每次插新行。Dislike：`plan_id` 不变、`generated_at` 刷新、新旧 item IDs **零重叠**。保存到 Looks：`saved_outfit_id` 回填，`outfits` 行为 `ai_generated=true`/`folder='Everyday'`，件数等于用户调整后的件数。Worn：两段各写一条 journal，Conference 段因单品集合与已保存 outfit 一致而带上 `outfit_id`、Gym 段为 `NULL`（两个分支一次覆盖）；**人为让一件配饰同时出现在两段，`times_worn` 只 `+1`**，被用户删掉的单品保持 `0`（证明计数跟的是调整后的集合而非 Claude 原始输出），全部 `last_worn_at` 同一时间戳。

**验证时发现的行为与缺口**（前两条已确认为设计使然，后两条是待补的产品缺口）：
- **天气在生成时快照进 `outfit_plans.weather`，当天不再刷新。** 用户中途改城市或天气突变，今天这条计划不会自动更新，只能靠 Dislike 重生成。符合「数据库是唯一缓存」的设计，但要知道有这个行为。
- **`profiles.timezone` 为 NULL 时静默回落到 `"UTC"`**（`daily/route.ts` 的 `timeZone` 取值链），而前端不传 `?timezone=`。非 UTC 用户不填时区会在跨 UTC 日边界的事件上错一天，且不报错。Onboarding（Phase 7）应该把时区设成必填或自动探测。
- ~~Dislike 只能整天重生成~~ ✅ 已做，见下方「6.1 收尾」
- ~~「Adjust this segment」是个 `<select>` 下拉~~ ✅ 已改为 Canvas，见下方「6.1 收尾」

### 6.1 收尾 — ✅ 已实现且已真实验证（2026-07-30）

**A. 按 segment 单独 Dislike —— ✅ 已实现**

- `POST /api/ai/daily` 带 `segmentId` 走单段分支（`handleSegmentRegeneration`），不带则仍是整天重排。单段 prompt 把**整天的 segments 当上下文**喂进去，只重建目标那一段
- 新增 RPC `regenerate_outfit_plan_segment`（现有 `replace_outfit_plan` 是「删光全部 segment 再重插」，单段替换必须单独写）
- **`change_from_previous` 过期问题按「同一次调用里一并重算」落地**（决策 2026-07-30）：模型在同一次响应里额外返回 `nextChangeFromPrevious`，RPC 顺手更新第 N+1 段的该字段。一次调用、零额外成本，衔接描述始终指向真实存在的那套衣服
- 排除范围**只含目标段自己的单品**：其它段保留的单品仍可用——同一件西装外套穿一整天是正常搭配，不是需要规避的重复
- 天气读父行快照而不是重新拉取，否则重建出来的这一段会基于和当天其它段不同的天气推理
- 边界：重生成会**清空该段的 `saved_outfit_id`**（已保存的 Look 是改动前的快照，留着链接会让 UI 显示「已保存」但内容已变；Look 本身不删，用户可以把新版本再存一次）；`status='worn'` 的计划一律拒绝

**B. 「Adjust this segment」改为 Canvas 编辑 —— ✅ 已实现**

- `/outfits` 的 Canvas 抽成 `src/components/outfit/outfit-canvas.tsx`，`/outfits` 和 `/home` 共用同一份（拖拽/缩放/层级/边界钳制/closet picker）。**没有复制两份**——指针手势代码抄两遍必然分叉
- **布局持久化**（决策 2026-07-30）：`outfit_plan_segment_items` 加 `x/y/width` 三列，和 `outfit_items` 同构。`/home` 用只读的 `OutfitCollage` 按用户排好的版式展示；`save_outfit_plan_segment` 把几何一并写进 `outfit_items`，所以存进 Looks 后在 `/outfits` 打开还是同一张拼贴
- 顺带修掉一个更隐蔽的 bug：**旧的下拉编辑只是客户端状态，刷新就丢**（计划每次都从数据库重读）。现在 Canvas 的「Done」通过新 RPC `update_outfit_plan_segment_items` 立即落库
- 所有改写 segment 单品的路径统一走新的 `apply_plan_segment_items()` helper，它负责三件容易各写各的错事：`(segment_id, position)` 唯一且不可延迟，就地重编号会瞬时冲突（先把存活行挪到 `+1000`）；归属靠 join `wardrobe_items` 的 user_id 强制；**只有显式 Canvas 保存才改写 x/y/width**，重生成和 Worn 确认都不能顺手抹掉用户排好的版式

**已真实验证（2026-07-30）**：单段 ↺ 后目标段单品全换、**其它段一字不动**、下一段的 `change_from_previous` 正确改写成引用新单品；Canvas 排完版刷新页面版式仍在；存进 Looks 后在 `/outfits` 打开是同一张拼贴；Worn 确认后几何未被抹掉。逐条细节见 `checklist.md` 任务 1b。

### 6.2 Weekly planning（新页面 `/plan`）— ✅ 代码完成（2026-07-30），⚠️ 待重跑 section 15 后真实验证

**落地时敲定的两个结构决策（原方案没写）：**

- **一个日期只有一条计划。** `outfit_plans` 的唯一键从 `(user_id, plan_date, source, travel_plan_id)` 改成 `(user_id, plan_date, travel_plan_id)`。原来含 `source` 意味着同一天可以并存 daily 和 weekly 两行，而那是**两次独立的 Claude 调用**（输入不同、跨天约束不同），必然选出不同衣服 —— 同一个周四在 `/home` 和 `/plan` 显示两套，且没有任何机制让它们同步。现在 `source` 退化成溯源标记：`/home` 读「今天的计划」不问出处并标注「From your week plan」，单天重算会把它翻回 `daily`（因为这天不再受整周约束），`/plan` 上标「Adjusted」。**代价**：动了 6.1 刚验完的 daily 代码，那几条要回归验。
- **周边界 = 从今天起 7 天**，不是周一到周日。周六打开也有 7 天有效内容，且和 Open-Meteo 从今天起算的预报窗口天然对齐。

**另外两个和原方案不同的实现选择：**

- **`GET /api/ai/weekly` 只读、绝不调 Claude**，生成走 `POST`。和 daily 的「cache miss 就生成」不同——日推是一次小调用、用户预期它自动发生；周计划吃整个衣橱，打开 `/plan` 就烧掉一次不合理。所以 GET 只展示预报/日历/已有计划，生成是主动按钮。
- **单天重生成复用 `POST /api/ai/daily?date=`**，没有新开端点。那条路径本来就处理单个日期，而且会把 `source` 正确翻回 `daily`。接的时候发现一个真 bug：daily 一直用 `getCurrentWeather()`，在 `/plan` 上重算周四会拿**此刻**的天气去推理周四的穿搭，换季时错得最厉害。已加 `weatherForDate()`：是今天才用实况，否则走 Open-Meteo 预报（新增 `getForecastAsCurrent()`）。

**新增的共用模块**：`src/lib/planning/plans.ts`（daily 读 1 天、weekly 读 7 天，join/排序/带 layout 完全一样，抽出来共用）和 `src/lib/planning/candidates.ts`（D8 硬过滤，分级放宽 + 每品类保底，避免过滤到没东西可选）。

⚠️ **需要重跑 section 15**（唯一键变更含去重、`replace_weekly_plans` 新函数、`replace_outfit_plan` 和 `mark_outfit_plan_worn` 有改动）。

原始方案如下，保留为对照：



- `GET /api/ai/weekly?start=YYYY-MM-DD`
  - 天气：**Open-Meteo**（D2），`forecast_days=7`，`daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code`，`timezone=auto`
  - 日历：当周 `calendar_events` + 语义化结果
  - 衣橱：活跃单品，**先经 TS 硬过滤压到 30–50 件再进 prompt（D8）**——按当周温度区间、当周 formality 区间、`archived=false`、`last_worn_at` 过近剔除
  - Prompt 约束（这几条是 weekly 和 daily 的本质区别，必须写进 system prompt）：
    - 7 天内同一件 **statement piece 不重复**；基础款（白 T、牛仔）允许重复但要间隔 ≥2 天
    - 一套里的单品不能同一天出现在两套里
    - 洗衣现实：连续两天不穿同一件贴身衣物
    - 覆盖当周所有 formality 层级
  - 输出：7 天数组，每天包含 1–N 个 `{items, reasoning, changeFromPrevious, eventRefs}` segments；批量写入 7 条 `outfit_plans` 父行（`source='weekly'`）及各自子段
- 成本：这是唯一值得用 Sonnet 的规划调用（7 天 × 约束满足），但一周只跑一次。也可以先用 Haiku 试，效果不行再升。
- UI：7 列周视图，每格一个缩略拼贴；点开进 outfits Canvas 编辑；支持「换一套这天」单天重生成（只重算一天，不重算整周）

### 6.3 出差模式（重写 `/travel`）

流程设计：

1. **建行程**：手动填（目的地/日期/目的标签）—— 这是主路径。**或**从 Gmail 检测到的行程一键导入（可选加速器，见 6.0-D）。目的地要落 `destination_timezone`（D4）
2. **拉数据**：目的地逐日预报走 Open-Meteo（D2）。超出 16 天预报范围的日期退化成历史气候均值并置 `isEstimate=true`，UI 上必须区分显示 + 该时间段的日历事件
3. **生成 capsule**：这是核心算法，和 daily/weekly 不同——目标是**最小化件数、最大化组合数**
   - 先让 Claude 按天出「需要什么类型的 look」（Day1 落地休闲 / Day2 客户会议 / Day3 晚宴…）
   - 再从衣橱选一个能覆盖全部 look 的最小集合（鼓励一衣多穿：同一件西装外套配不同内搭）
   - 候选集同样先经 TS 硬过滤（D8）；这一步值得用 Sonnet，因为低频且是真正的组合优化
   - 输出：capsule 单品列表 + 每天的搭配组合 + 缺口提示（「这趟需要一双正装鞋，你衣橱里没有」→ 直接对接后面的 Shopping Recommendations）
4. **打包清单**：capsule 单品（自动）+ 非衣物部分（**写死模板 + 可编辑，不让 AI 生成 —— D11**，AI 会漏充电器也会幻觉出用户没有的东西）→ 可勾选，勾选状态持久化
5. 写入 `travel_plans.packing_list` / `daily_outfits` / `weather_data`（这三个 JSONB 列已经建好了，正好用上），每日搭配同时写 `outfit_plans`（`source='travel'`，`travel_plan_id` 指回来）

#### Printable outfit cards

出差模式的核心交付物之一：一份能打印出来带走、或者出门前扫一眼的每日穿搭卡。

**一张卡 = 一天一套。** 内容：
- 日期 + 星期 + Day N
- 目的地当日天气：高低温、降水、体感，`isEstimate` 时标注「历史均值估算」
- 当天日程 + 场合标签（来自 `calendar_events.occasion` / `formality`）
- 单品去背景图 + 名称（用 `_clean.png`，就是上传 pipeline 已经产出的那批）
- 一句搭配理由（`outfit_plan_segments.reasoning`）
- 一行手写备注区（打印出来能用笔写）

**多套/天**（白天会议 + 晚间聚餐）出两张卡，标 `Day 3 · AM` / `Day 3 · PM`。

**排版：确定性网格，不用自由拼贴（D6）。** 按固定类别顺序排：外套 → 上装 → 下装 → 鞋 → 配饰。理由是生成的搭配没有 `x/y/width` 布局数据（那是 `/outfits` 手动拼贴才有的），而且打印卡要的是「一眼看清有哪几件」，自由拼贴在 A5 纸上反而更乱。想要拼贴效果的用户走「保存到 Looks」进 Canvas（D5）。

**实现：`/travel/[id]/print` + `@media print` CSS（D7）**，不上 puppeteer（Vercel serverless 要塞 `@sparticuz/chromium`，冷启动和包体积都疼）。用户走浏览器的「打印 / 存为 PDF」。三个已知坑：
- **图片必须 eager 加载**，否则打印时是空白图。这个页面直接用 `<img>` 而不是 Next `<Image>`，避开 lazy loading 和 blur 占位符
- `page-break-inside: avoid` 加在每张卡上，`break-after` 控制一页几张（建议 A4 两张）
- 打印时隐藏侧边栏/导航：给 `Sidebar` 之类加 `print:hidden`

打印页也要能只打包装清单（`?section=packing`）或只打卡片（`?section=cards`），因为这两个的使用场景不同——清单是出发前用，卡片是到了之后用。

---

## 四、Phase 7+ — 新增范围（原计划里没有的）

下面是这次新提的 5 项。已经按**依赖关系**重排过顺序，不是按你说的顺序——理由写在每项下面。

### Phase 7：冷启动 Onboarding（建议提前，优先级仅次于 Phase 6）

**为什么排这么靠前**：它是所有推荐质量的上游。现在 daily/stylist 的 prompt 里只有衣橱和身体数据，没有任何「用户想成为什么样子」的信息。而且这是 5 项里成本最低的——纯前端 + 已有的表。

- 注册后引导流程（可跳过、可稍后补）：
  1. 基本信息（身高/体型/所在城市）→ 已有 `profiles` 字段
  2. 生活场景配比（办公室占比多少 / 远程 / 社交 / 运动）→ 决定推荐的 formality 分布
  3. 风格取向：**滑卡**（`preference_swipes` 表已就绪）—— 20 张风格图 like/dislike
  4. 痛点自述（"衣服很多但不会搭" / "出差总带多" / "想显高"）→ 直接进 stylist system prompt
  5. 引导上传第一批单品（5 件起）
- 产物聚合进 `profiles.preference_dna`（JSONB，字段已建好），所有 AI route 的 prompt 统一读它
- 需要准备的素材：20–40 张风格参考图（这是唯一的非代码工作量）

### Phase 8：Avatar（fal.ai）

**为什么排在 Onboarding 后**：avatar 需要外貌数据，onboarding 正好负责收集。

- `profiles` 已有 `skin_tone`/`hair_color`/`hair_length`/`body_shape`/`height_cm`/身围 —— 输入齐了
- 两种做法，建议先做第一种：
  1. **生成静态 avatar**：fal.ai 文生图，按 profile 字段拼 prompt → 生成一个中性姿势的全身形象 → 存 Storage + `profiles.avatar_url`
  2. **虚拟试穿**：fal 上有 virtual try-on 类模型，把 avatar + 衣橱单品图合成上身效果。这个成本和失败率都高得多，而且多件叠穿效果通常不好——建议先只对单品/上下装两件做，别一上来做全身搭配渲染
- 成本要单独立预算：图像生成 per-call 成本远高于现在的 Haiku 文本调用，必须做**缓存**（同一 profile 不变就不重新生成）和**频率限制**
- 落地面：Canvas 里的「在我身上看看」按钮 + Home 每日推荐的上身预览

### Phase 9：Shopping Recommendations

**依赖**：衣橱缺口分析（`/api/ai/daily` 的 `gap` 字段和出差 capsule 的缺口提示已经在产出这个信号了，现在只是丢掉没用）。

- 缺口来源三条：日推 `gap`、出差 capsule 缺口、Analytics 的类别分布失衡
- 商品数据来源是这一项的**最大未决问题**，必须先定：
  - 联盟平台 feed（如 ShopStyle / Rakuten / Amazon Associates）—— 有结构化数据 + 佣金，但需要申请
  - 电商 API —— 覆盖有限
  - Web search + Claude 抽取 —— 灵活但不稳定、不可持续做商业化
  - 建议：先接一个联盟 feed 做 MVP，别做通用爬虫
- 新表 `shopping_recommendations`（user_id / gap_reason / product 快照 / url / status）
- 关键产品判断：推荐必须**和已有衣橱挂钩**（"这件能和你已有的 6 件搭"），否则就是普通导购，没有差异化

### Phase 10：搭配师授权访问 + Folk CRM 集成

**预约入口已提前完成（2026-07-30，待生产迁移/真实验证）**：`/stylist` 已有 30 分钟线上与 9–5 线下全天两种服务的弹窗式 slot picker。服务工时固定在 `STYLIST_TIME_ZONE`（默认 `America/New_York`），同一批 UTC 时段转换成浏览器 IANA 时区显示，避免每个客户的浏览器各自“生成一套搭配师工时”；`GET/POST /api/stylist/bookings` 用 service role 读取全局占用、服务端重验被选 slot，`stylist_bookings` 的 exclusion constraint 兜底阻止任何两个 confirmed 区间重叠。当前是「一个共享搭配师产能日历」的 MVP；还没有人员分配、付款、改期/取消、日历邀请或 Folk 同步。这一层只负责预约，也**不会因为预约成功自动授予衣橱访问权**——后者仍必须走下方 `wardrobe_grants`。

**决策（2026-07-27）**：公司是自有的少数长期搭配师，不做第三方入驻平台。因此 **Phase 11「双端」取消**，改为「Folk CRM 承担客户列表与流程管理，App 只做授权访问」。

省掉的部分（原方案里最贵的两块）：
- ❌ Stripe Connect 分账 —— 钱直接进公司账户，普通收款即可，不需要给第三方打款
- ❌ 入驻、审核、双向评价、排名 —— 搭配师是自己人，账号手动开通；档期先用现成工具（Calendly 等）

**分工**：

| 层 | 放什么 | 在哪 |
|---|---|---|
| 客户列表、阶段、跟进、备注、付费状态 | 商业关系与流程 | **Folk CRM**（不用开发） |
| 看客户衣橱、出方案 | 就是客户自己那套界面（衣橱 + 拼贴板） | **已有的 App 页面**（不用重做） |
| 桥 | Folk 记录里一个跳回 App 的深链 | 需要开发的只有授权机制 |

搭配师工作流：早上开 Folk 看今天服务谁 → 点链接跳进 App → 在客户衣橱里出方案 → 方案自动落进客户的 App（而不是变成一份发微信的 PDF —— 这才是做这个功能的真正理由：让搭配师的成果能被客户反复使用）。

**授权机制 `wardrobe_grants`**

```sql
create table public.wardrobe_grants (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null references public.profiles(id) on delete cascade,
  stylist_id  uuid not null references public.profiles(id) on delete cascade,
  mode        text not null check (mode in ('one_off','ongoing')),
  scopes      text[] default '{wardrobe,profile,preferences,occasion_summary}',
  granted_at  timestamptz default now(),
  expires_at  timestamptz,          -- one_off：咨询结束 + 14 天（已定）
  reconfirm_at timestamptz,         -- ongoing：每 6 个月让客户重新确认，避免僵尸授权
  revoked_at  timestamptz,
  unique (client_id, stylist_id, mode)
);

-- 访问审计：谁在什么时候看了谁的什么
create table public.wardrobe_access_log (
  id         uuid primary key default uuid_generate_v4(),
  stylist_id uuid not null references public.profiles(id),
  client_id  uuid not null references public.profiles(id),
  resource   text not null,
  accessed_at timestamptz default now()
);
```

两种模式（客户关系一次性和长期都有）：

| | 一次性 `one_off` | 长期 `ongoing` |
|---|---|---|
| 有效期 | **咨询结束后 14 天自动失效**（已定，留跟进窗口） | 长期有效，客户可随时撤销 |
| 卫生机制 | 自动到期 | 每 6 个月客户重新确认一次 |
| Folk 阶段 | 走完即归档 | 进「长期维护」分组，定期跟进 |
| 定价 | 按次 | 订阅 / 包月 |

搭配师长期稳定、不流动，所以**不需要**自助入驻和审核，授权可以做得简单。但审计记录仍要留 —— 目的从「防范外人」变成「出事能查清 + 账号被盗时限制影响范围」。

---

### 数据边界（最容易在赶进度时被破坏，所以写下理由而不只是结论）

**核心原则：CRM 里存指针和业务状态，不存数据副本。**

为什么不能把衣橱/搭配/行程同步进 Folk —— 主要理由不是技术：

1. **一旦数据被复制进 CRM，「客户撤销授权」就失去意义了。** 客户点撤销，App 里断了，Folk 里的副本还在，而且不受权限规则管。对客户的承诺变成空话。客户要求删号时同理，且没有任何机制提醒你去 Folk 再删一遍
2. Folk 是为管理「人和关系」设计的，不是为存几百张衣物照片设计的
3. 同一份数据存两处必然不一致，然后你不知道该信哪个
4. 私人衣物照片进第三方系统，隐私说明就得改写

| 数据 | 可进 Folk | 可给搭配师 |
|---|---|---|
| 客户身份、联系方式、阶段、付费状态、跟进时间、负责搭配师 | ✅ | ✅ |
| 跳回 App 的深链 | ✅（存「去哪看」，不存「看到什么」） | ✅ |
| 加工过的聚合数字（衣橱件数、问卷完成否、最后活跃、下次出行日期） | ✅ | ✅ |
| 衣橱单品照片与明细、搭配、行程 | ❌ | ✅（经 `wardrobe_grants` 授权） |
| 身体数据、外貌、风格偏好、诉求 | ❌ | ✅（经授权） |
| **场合摘要**（「这周三个正式场合」） | ❌（对商业流程无用） | ✅（经授权） |
| **原始日历事件条目** | ❌ | ❌ |
| **邮箱内容（任何形式）** | ❌ | ❌ |

最后两行是硬边界。日历标题里会有「体检」「面试 · 某公司」「和律师见面」这类与穿搭无关但极其敏感的内容，邮箱里更多。搭配师只能拿到加工过的结论。

→ 这就是 Phase 6.0 那条「原始事件与场合摘要分开存储」约束的**物理基础**。现在分开几乎不花成本，事后补要重构。

---

### n8n 的定位与两条纪律

Folk 有完整 REST API（workspace 级 Bearer key）、自定义字段、pipeline 分组和 webhook，n8n 用 HTTP 请求节点即可对接（Folk 官方有 n8n 示例；注意按邮箱先查再决定新建/更新，避免重复记录；也注意 API 有速率限制，配额以官方文档为准）。

**n8n 适合做**：新咨询 → 建/更新 Folk 客户 + 建任务；问卷填完 → 更新 Folk 字段；咨询前后提醒；每周给搭配师发摘要；授权即将到期 → 通知客户续期；Folk 阶段拖到「咨询结束」→ 调 App 接口给 one_off 授权设置 14 天后到期（**搬状态，不搬数据** —— 这是既自动化又不越过数据边界的正确形状）。

**纪律一：n8n 不能进产品的关键路径。** 日历同步、搭配生成、天气获取必须写在 App 里。可视化自动化工具最典型的故障是**静默失败** —— 节点挂了没人发现，你以为在跑其实早停了。业务通知晚一天没关系，用户点「生成本周搭配」没反应就是产品坏了。

**纪律二：绝不把 Supabase 的 service role key 给 n8n。** 那个 key 绕过所有权限规则，等于开一个能读写全部客户数据的后门，安全性取决于 n8n（用云版还取决于第三方）。正确做法：在 App 里开几个窄接口（如「返回某客户的衣橱件数和最后活跃时间」），用独立密钥调用。密钥泄露时泄露的是几个数字，不是整个数据库。

---

---

## 五、建议的执行顺序

```
现在 ──► Phase 6.0  底座（一步到位，后面三步都靠它）
           · Google OAuth，Calendar / Gmail 分开授权（D1）
           · 3 张新表 + roles/timezone/generated_at 字段（D3/D4/D9）
           · 事件语义化（按周批量，缓存）
           · 天气 provider 接口 + Open-Meteo（D2）
         Phase 6.1  ✅ Daily 接日历 + 三层数据库缓存 + Dislike 排除 + Worn 可改后确认
         Phase 6.2  Weekly planning /plan 周视图（TS 硬过滤 + Claude 选，D8）
         Phase 6.3  出差模式
           · 手填行程为主路径 + Gmail 导入为可选加速器
           · capsule 生成（Sonnet）+ packing list（模板 + 可编辑，D11）
           · printable outfit cards（/travel/[id]/print，网格排版，D6/D7）
         ─────────────────────────────────────────────
         Phase 7    Onboarding（便宜、提升全局推荐质量）
         ★ 决策点：Phase 11 的角色/组织模型（不写代码，只定 schema 方向）
         ─────────────────────────────────────────────
         Phase 8    Avatar（fal.ai）
         Phase 9    Shopping Recommendations（先定商品数据源）
         Phase 10   搭配师授权访问 + Folk CRM 集成
                    （Phase 11「双端」已取消 —— 见第四节）
```

**穿插的技术债**（可以在 Phase 6 期间顺手清）：
- ~~`outfit_items.x/y/width` 的 alter table 还没在生产库跑~~ ✅ 已跑（2026-07-30，随 Phase 6.0 迁移块）
- 耳环/手镯配对路径的真实照片验证
- ~~Analytics 的 `times_worn` 没有真实写入来源~~ ✅ 6.1 Worn RPC 已提供唯一新增写入路径（同日同件统一 +1）
- AI Stylist 修复后的真实链路复验（澄清问题 → structured tool response → Canvas → 编辑 → 保存/再次更新）
- 多件识别的勾选确认 UI

---

## 六、成本影响预估

现在约 $1.20/月（3 用户 × 50 件）。Phase 6 之后：

| 新增调用 | 频率 | 模型 | 影响 |
|---|---|---|---|
| 事件语义化 | 每周 1 次批量 | Haiku | 极小 |
| Daily 推荐 | 每天 1 次/人（已缓存） | Haiku | 已计入 |
| Weekly 规划 | 每周 1 次/人 | Haiku 或 Sonnet | 小，但如果用 Sonnet 要盯 |
| Gmail 行程抽取 | 每周 1 次/人 | Haiku（只吃 subject+snippet） | 小 |
| 出差 capsule | 按行程触发 | Sonnet 值得 | 低频 |
| **Avatar 生成（Phase 8）** | 按需 | fal.ai 图像 | **这是唯一可能量级跳变的项，必须缓存 + 限流** |

Google API 和 Open-Meteo 本身都不构成成本项（Calendar/Gmail 读取免费额度充足；Open-Meteo 非商业每天 1 万次免费）。真正的成本是**合规和限制**，按 D1/D2 已经决定绕开，但要记住两笔迟到的账：

- **Gmail 的 CASA 评估**：Testing 模式下不需要，但一旦要 In production + 超过 100 个 Gmail 账号，就要走第三方安全评估（年费几百至上千美元 + 4–8 周）。所以「什么时候需要真实用户量」这个时间点，就是要提前 2 个月启动申请的时间点。
- **Open-Meteo 的商业授权**：免费档限定非商业用途。B 端/佣金上线即视为商业，届时要么买 customer API 要么统一回 OpenWeather。provider 接口已经为此留好了口子。

另外 Testing 模式下 Google 的 refresh_token 大约 7 天过期，这不是成本问题但是体验问题——`google/client.ts` 必须能优雅降级并提示重新授权，不能抛 500。
