# AI Wardrobe — Implementation Checklist

> Last updated: 2026-08-13（Phase 6.3 出差模式 `/travel` 代码完成：日历识别行程 + business/leisure 分类 + 复用 `/plan` 同一批计划行 + 确认后打包 + 打印/PDF + 公开分享链接。**待执行 schema section 21 / 21b 后真实验证**；section 20 同样待执行）
>
> **本文件只负责「已完成的实现细节 + Debug Log」。未来要做什么、按什么顺序做、新功能的技术方案，全部移到 [`ROADMAP.md`](./ROADMAP.md)。**
>
> 当前优先级：Phase 6 = Daily/Weekly outfit planning + 出差模式（天气 + Google Calendar + Gmail）。
> 新增范围中 Human Stylist 预约入口已完成代码；人员分配/付款/改期通知、衣橱授权与 Folk CRM 仍未排期。Shopping Recommendations、冷启动 Onboarding、Avatar（fal.ai）详见 ROADMAP.md 第四节。
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
| 16 | 单品详情页加多角度照片时报 `PGRST205 — Could not find the table 'public.wardrobe_item_photos' in the schema cache` | 本仓库没有 migration 工具，schema.sql 只是「真相来源」，改了不等于生产库执行了。section 17 的建表语句还没在 Supabase SQL Editor 跑过；这类问题 `npm run build` 完全发现不了——TS 类型是手写镜像，对不存在的表照样通过 | 在 SQL Editor 执行 schema.sql 第 17 节（可重复执行）。若表已建好仍报同样的错，是 PostgREST 的 schema 缓存没刷新，补一句 `notify pgrst, 'reload schema';`。踩坑连带：insert 失败时那张图已经进了 Storage，代码会回头删掉它，但如果删除也一并失败，`wardrobe` bucket 里会留下 `<user_id>/<item_id>-angle-*.jpg` 这样没有对应数据库行的孤儿文件，需要手动清 |
| 20 | 加完出差模式后 `/plan` 只剩第一天有内容，后面 6 格全空 | 出差模式给 `/api/ai/weekly` 加了 `?days=`，解析写成 `Number(searchParams.get("days"))`。**`Number(null)` 是 `0` 不是 `NaN`**，`Number.isFinite(0)` 为真，于是 `/plan` 这种不带 `days=` 的普通请求被夹成 `windowLength = 1`——只读/只排一天。因为 week-view 的网格是写死的 `grid-cols-7`，一天数据配七列，看起来正好像「后面几天丢了内容」。`tsc`、`lint`、`build` 全过：这是运行期取值，不是类型问题 | 「参数不存在」显式判断，不靠解析：`const daysParam = get("days"); const requested = daysParam === null ? NaN : Number(daysParam);`，再要求 `>= 1`。补了一个覆盖 10 种 query string（无参 / 空值 / `abc` / `0` / `-3` / 正常 / 超上限）的断言脚本，全绿 |
| 19 | Next 16 下 `npm run lint` 把 `lint` 当项目目录并报 `Invalid project directory` | Next.js 16 已移除 `next lint`，同时仓库没有 Flat Config，`eslint-config-next` 还停在 15.x；此外 Next 16 的 `next build` 也不再自动跑 lint | `lint` 改为 `eslint .`，新增 `lint:fix` 与根目录 `eslint.config.mjs`，把 `eslint-config-next` 精确对齐为 16.2.10。保留 Core Web Vitals + TypeScript 规则；对现有客户端 Effect 取数和时间读取显式关闭 `react-hooks/set-state-in-effect` / `react-hooks/purity`，其它真实错误与未使用 import 已清理。`lint`、`tsc --noEmit`、生产构建均通过 |

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

### AI Stylist 结构化回答

| # | 问题 | 原因 | 修复 |
|---|------|------|------|
| 15 | 正常的澄清问题被显示成 `The stylist couldn't structure that answer`，route 返回 502 | 旧协议只在 prompt 里要求 Haiku 输出 `FINAL:{...}`；模型仍可能直接写自然语言，解析器找不到 JSON 就把有效回答当故障 | 改为 Anthropic forced `tool_choice`，要求模型必须调用 `return_stylist_response` 并按 JSON Schema 返回 question/recommendation；同时保留纯文本降级，供应商异常跳过 tool 时把文字作为正常 question 返回 200，不再让格式问题中断对话 |

### 计划规则 (occasion-groups.ts / plan-rules.ts)

| # | 问题 | 原因 | 修复 |
|---|------|------|------|
| 17 | 8/17（周一：10:00 团队会议 → 17:00 出发去 JFK → 20:30 飞伦敦的过夜航班）整天被安排成同一套正装：黑色阔腿裤 + 雪纺衬衫 + **白色高跟鞋**，第二段只把肩包换成托特包。过夜航班穿高跟鞋不是能坐十几个小时的穿搭 | 两层都缺规则：① `classifyEvents()` 把出差日的每个事件（包括航班本身）都按"出差"的正式度打分，于是 `groupOccasions()` 的 formality 算术看到的是一整块连续的 formality 4，只是碰巧因为 `FORMALITY_BREAK` 分成了两段，而两段的着装要求完全一样；② `plan-rules.ts` 只有 composition/weather/coverage/rotation 四族规则，没有任何一条说"在路上的这段不能穿高跟鞋"，模型自己也没想到 | 按 D8 拆成"可判定的进 TypeScript、需要判断的留给模型"：①**分段**——`isTransitOccasion()` 让 transit 无条件切段（不看 formality 差距），transit 组标记 `comfortFirst` 且 formality 上限压到 `TRANSIT_MAX_FORMALITY = 2`；②**单品**——新增第五族规则 Comfort，`isHardToTravelIn()`（只认 `Shoes` + `heel/stiletto/pump/slingback/court shoe/wedge`）+ `enforceComfort()` 在 coverage 之后、rotation 之前把高跟换成平底；③**prompt**——daily/weekly/单段重生成/repair 四处都说明 `comfortFirst` 的含义（易脱平底鞋、耐坐不易皱的软料、机舱可加减的一层），并说明这是唯一鼓励整套换掉的地方。踩坑：判定 transit 时 occasion 标签和事件标题必须用**两套**正则——标签是模型刻意给的一个词，裸 `travel`/`train` 就是在路上；标题是自然语言，"Travel budget review"、"Train the new hire" 都是开会，所以标题只匹配不可能有歧义的说法。另外全天事件永远不算 transit，否则 "Business Trip (London)" 这种覆盖一整天的容器会把当天的会议也按登机穿。**靠标题判定是这个修复能作用于存量数据的原因**——sync 只对 `occasion IS NULL` 的行调用分类，已经分好类的 "Depart for JFK" 不会重跑，但标题永远在。（这里的名字在 #18 里被泛化了：`isTransitOccasion()` → `occasionKind()`，`comfortFirst` → `kind`，`TRANSIT_MAX_FORMALITY` → `MAX_FORMALITY_BY_KIND`） |
| 18 | 运动场景（尤其 tennis / golf）和正式场景被合并成同一段；而且运动完出汗后，后面的段落还在继续穿运动时那套衣服 | 和 #17 同源，但更严重：golf/tennis 常常发生在工作日中间、在俱乐部、和客户一起，`classifyEvents()` 很容易给出 formality 4，于是和前后的会议/晚餐 formality 完全一样，`groupOccasions()` 直接合并；就算分开了，规则里也没有任何一条说"运动那套穿过就不能再穿" | 把 #17 的 transit 概念泛化成 `OccasionKind = transit \| athletic \| general`：① **分段**——kind 不同就断组，`MAX_FORMALITY_BY_KIND` 把 athletic/transit 的 formality 上限压到 2；② **两个 athletic 之间也不合并**（transit 之间合并是对的——打车到登机不换衣服；打完 golf 再打 tennis 要换），③ **出汗规则**——`enforceComfort()` 的 `sweat` 分支：当天更早的 athletic 段里穿过的东西（Bags/Accessories 除外，包不贴身）在之后所有段落都不可用，找同类替代品换掉；④ **prompt**——说明 golf/tennis 即使在俱乐部、和客户一起也按运动装穿（polo 衫、专业球鞋、网球白），并要求在 reasoning 里点名哪几件是运动装。踩坑：单段重生成路径原来只把那一段丢进规则引擎，`sweatyBefore()` 看不到前面的段，所以改成把**整天**（其他段保持原样、目标段换成新生成的）一起跑规则，只落库目标段那一行 |
| 19 | 每次生成都反复推荐同样那几件（silver clutch / gold maxi dress / cream heeled sandals / olive pleated trousers），衣橱里明明还有别的裤子和包 | 四个独立原因叠在一起，每一个单独看都"符合设计"：① **规则用的是"最小间隔天数"而不是"一周最多几天"**——鞋 gap=2 实际允许周一/周三/周五三天，包和配饰 gap=0 等于完全不限制，所以一只 clutch 可以天天出现；② **daily route 根本不跑 rotation**（理由是"一天不可能和自己重复"），于是 `/home` 每日生成和 `/plan` 的「Redo this day」都不受任何轮换约束；③ **轮换只看本次请求里的那几天**，历史为空，所以"一周一次"每周一重新计数，下一周照样先挑同样的心头好；④ **`selectCandidates()` 的打分完全确定性**，同一个衣橱每次都产出同一份 top 45，模型在同一批候选里当然选同样的单品 | ① 规则模型换成 `MAX_WEAR_DAYS_BY_CATEGORY` + `ROTATION_WINDOW_DAYS = 7`（滚动 7 天内最多几**天**，同一天多段只算一天）：上装/下装/连衣裙/外套 1 天、鞋 2 天、包和配饰 3 天，并且**数值由用户决定**（`profiles.rotation_limits`，schema 第 19 节，`/plan` 的「Repeat rules」按钮）；② daily 也跑 `enforceRotation`；③ 新增 `RotationContext.history`，由 `readWearHistory()` 读周围几天已存的计划——weekly 读窗口前 6 天 + 窗口内已 `worn` 的天，daily 读该日 ±6 天；④ `selectCandidates()` 增加 `recentlyPlannedIds`（−2 分）和 `variety`（每件 0–1.5 分随机），重新生成才会真的换一批。踩坑：`rotation_limits` 用**独立一条查询**读（`readRotationLimits()`），不能加进 planner 那条 profile select——这个仓库的 schema 是手动贴的，列还没建时整条 select 会 400，daily/weekly 直接全挂 |
| 20 | 运动装出现在比较正式的场合 | Comfort 族只有"航班不穿高跟"和"运动完不再穿"两条，没有反向的那条；而 `MAX_FORMALITY_BY_KIND` 只压低运动段的正式度，管不到一件运动裤被放进 formality 4 的会议 | Comfort 加第三个 reason `too_casual`：段落 formality ≥ `MIN_FORMALITY_BANNING_ACTIVEWEAR`(3) 时不接受 `isActivewear()` 的单品，和另外两条一样走 1:1 替换。判定要求**两个信号同时成立**，避免误伤：被分类器打了 `work`/`formal`/`party`/`wedding` 标签的一律不算运动装，其余要么 occasion 只有 `sport`，要么命中无歧义关键词（leggings/joggers/track pant/sweatpants/running/gym…）——`casual` 标签的小白鞋不会被判成运动装。运动段本身不会被误伤：`formalityForKind()`（原私有的 `groupFormality`，为此导出）已经把它压到 2，所以 `SegmentContext.formality` 必须走它而不是直接读事件的 formality |
| 21 | 用户把 Outerwear 设成「一周 1 天」，但同一件 Blair Stanley 西装外套还是在一周里出现了 3 天 | 规则**查得出来但修不动**。`enforceRotation()` 的策略是「找同品类替换品，找不到就保留 + 出 warning」；用户只有这一件外套，所以替换品**按定义永远不存在**，每次都走「保留」分支。于是"每周 1 天"这条用户亲手设的规则，在最典型的场景（只有一件的心头好）下 100% 失效——而 UI 上那条限制还明晃晃写着 | 新增 `isDroppableCategory()`（由 `REQUIRED_SLOTS` 反推：外套/包/配饰不占任何必需槽位）。找不到替换品时，**不占槽位的直接从当天整段移除**，用户的上限就此成为硬保证；鞋/上装/下装/连衣裙仍然保留 + warning（光脚比重复更糟）。`enforceComfort()` 走同一个判定（高尔夫球场上的西装外套没有理由因为"没有第二件"而留下）。代价是明确的、也是刻意的：衣橱小的时候，一周里靠后的几天会**少一件外套/包**而不是重复穿 |
| 22 | 运动场景（Morning Golf）里还是出现休闲连衣裙、黑色西裤和白色高跟鞋 | 三层原因：① Comfort 只有 `too_casual`（运动装**不能进**正式场合），**没有反向那条**——从来没有规则说"运动段**必须是**运动装"；② 就算加了规则也无从修：`selectCandidates()` 把这周的 formality 映射成 occasion 标签，一场被日历分类器按"客户 + 私人俱乐部 + 工作日"打成 formality 4 的高尔夫映射到 work/formal/party，**把所有 `sport` 标签的单品全过滤掉了**，候选池里根本没有运动服可换；③ 连衣裙即使被判违规也换不掉——1:1 替换只会找「另一条裙子」，大部分衣橱没有高尔夫裙 | ① Comfort 加第四个 reason `not_sport`：athletic 段里贴身穿的品类（包/配饰豁免）必须 `isSportSuitable()`。它是 `isActivewear()` 的镜像——**分类器的 `sport` 标签单独就够**（这条规则决定什么能**留下**，用户的原话就是"运动场景一定要穿打标了是运动的服饰"），另加 polo/golf/tennis/trainer/sneaker/performance/jersey 等俱乐部装关键词；② `selectCandidates()` 新增 `pinnedIds`，窗口里只要有 athletic 场合，weekly 就把所有运动单品**绕过 occasion 过滤和排序**钉进候选集——过滤器能饿死的规则不算规则；③ `enforceComfort()` 增加第二轮：1:1 换不掉时试着**摘掉它再用 `fillMissingSlots()`（与 `enforceCoverage` 共用）补回 torso+legs**，补不齐才回滚。裙子于是能被 polo + 球裙替代。真的无解时（唯一一双鞋、衣橱完全没有运动服、同一天第二场运动而 sweat 规则禁止复用）仍然保留 + warning |
| 23 | 同一天两段推荐出来的穿搭基本一样（同一件外套/裤子/衬衫），只换了鞋和包，却被拆成两个 segment；而且文字对不上 canvas——"Retained the brown wedge sandals"配的图里是白色高跟鞋，第一段还带着一句 `changeFromPrevious` | 两个独立问题。① `mergeAdjacentEquivalentSegments()` 只在**完整 itemId 集合完全相同**时才合并，模型换一只鞋就绕过了它，于是"一套衣服 + 一个鞋柜"被展示成三套穿搭；② 所有规则都在模型写完 reasoning **之后**才跑，模型描述的是它自己那一版，规则换掉的单品它不知道；第一段那句 `changeFromPrevious` 则是 repair call 留下的——它描述的是"和上一版计划的差异"，不是"和同一天上一段的差异" | ① 合并判据改成**只比对核心品类**（Tops/Bottoms/Dresses/Outerwear）：核心一致就是同一套穿搭，换鞋换包不构成第二个 segment；真正的换装（正装→鸡尾酒裙、上班→运动）必然动核心件，所以永远不会被误合。存活的那段保留**第一段**的单品和 reasoning（第二段的 reasoning 存在的意义就是解释一个已经不发生的变化）。不同 `kind` 不合并，athletic 段不与任何段合并；② 新增 `src/lib/planning/segment-text.ts`：生成前给每段盖上 `originalItemIds`（各 `enforce*` 都是展开对象，字段自然透传），最后 `alignSegmentText()` 把提到"已经不在这段里的单品"的**整句**删掉（按两个显著词匹配，模型很少逐字照抄标签），`changeFromPrevious` 一律由**真实 item diff** 重算（整套换掉时输出"A complete change of clothes: …"），每天第一段直接删除该字段；只有两边都没被规则动过时才保留模型原话（它说的是**为什么**，diff 说不出来）。合并会改变"从哪一套过渡过来"，所以顺序是 enforce → merge → align。单段重生成路径共用 `scrubReasoning()` / `describeTransition()` |
| 24 | `/travel` 把日历上**两趟**行程（8/14–8/16 汉普顿度假、8/17–8/21 伦敦出差）识别成了**一趟** `Hamptons 08-14 → 08-21`。伦敦那半程于是按汉普顿的天气排搭配，两趟共用一张打包清单 | `detectTrips()` 合并 run 时**只看日期相邻，从不比较目的地**（`detect-trips.ts` 的 `daysBetween(current.end, away.first) <= MAX_GAP_DAYS + 1`）。汉普顿最后一天 8/16 和伦敦第一天 8/17 首尾相接，正好落进「中间空一天仍算同一趟」那条桥接规则里。`chooseDestination()` 事后从合并结果里挑标签，`cities` 数组其实**两个城市都在**（`["Hamptons","London"]`），只是没人拿它去切分。合成断言当初没覆盖「两趟紧挨着」这一种排列，7 组用例里两趟行程那组是相隔两周的 | 新增 `sameDestination()` 作为合并的第二个判据：**先比名字、坐标只作兜底**，这个顺序两个方向上都在救命——同一份真实日历里 "Hamptons" 在一个事件上被地理编码到 East Hampton NY、在另一个上被编码到 Auburndale, Florida（相距 1500km），坐标优先会把一个周末劈成两趟；反过来 "London" 和 "Westminster" 是同一周的两个词，靠 `AWAY_RADIUS_KM`(120km) 吸收。两个不同名字又没有坐标可对照时判为不同——那正是这个函数存在的理由。每个 run 与它**最先学到**的目的地（anchor）比较，而不是与前一个事件比，否则会逐城漂移。另修了同一处的**日期争夺**：两趟紧挨着时，中间那班晚班机既是前一趟的返程腿又是后一趟的出发腿，加边后两边会同时认领同一天——而「一个日期只有一条计划」(6.2) 下两趟会各排各的。改成**先给所有 run 统一加边、再成对解冲突**，统一按「离开的那天属于要去的地方」判给后一趟。7 组新断言覆盖：相邻双城、同城空档、同名不同坐标、异名近距离、容器重叠、中间航班归属、全程在家 |

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
| 单品详情编辑 | ✅ 完成 | 可修正 AI 分类结果；新增用户自定义详细名称 `display_name` 与个人备注 `user_notes`，名称优先展示于衣橱、Canvas、计划和搭配师评审，两个字段都作为权威上下文传给 AI |
| 收藏/删除 | ✅ 完成 | |
| 多件物品识别 | ✅ 已联调 | Claude Vision 同时返回计数和具体物品 noun → 命中多件才调用 `fal-ai/sam-3-1/image` → 按官方 normalized boxes 裁剪；已用 4 个 purse 的真实图片验证返回 4 个 masks/boxes |
| 鞋子/耳环/手镯等自动配对/镜像补全 | ✅ 已联调（鞋子）/ ⚠️ 代码完成待验证（手镯/耳环） | `mergeShoePairs` 泛化成 `mergeDuplicateAccessories`：按 `detection.prompt` 分组，同组 ≥2 个才调用 `classifySimilarItems`（Sonnet）判断是否为同一实物；鞋子/耳环（`MIRROR_IF_LONE_PROMPTS`，天生成对穿戴）落单时额外镜像补全，手镯等其它品类落单则原样保留、不调用模型（省 token）；配对成功按原图实际左右位置拼图。已用 `test_shoe_1.jpg`（3 双鞋）和 `test_bag&single_shoe.jpg`（6 只单鞋 + 2 个包）真实联调验证鞋子路径；手镯/耳环泛化后的路径尚未用真实手镯照片验证 |
| 上传时用户预先选择 single/multi 省 token | ✅ 已联调 | `UploadZone` 新增「Single item / Multiple items」切换（默认 single），上传时把 `mode` 传给 `/api/ai/classify`；`mode === "single"` 时后端完全跳过 `detectItems` 这次 Haiku 调用，直接走单件 pipeline；`mode === "multi"` 时仍需调用 `detectItems` 拿 SAM prompts，但用 `Math.max(2, detection.count)` 相信用户的判断而不是模型的计数；不传 `mode`（旧客户端）保持原来的自动检测行为 |
| HEIC 格式支持 | ✅ 完成 | heic-convert + Sharp，客户端上传前转换 (convert route)；判断逻辑抽到 `src/lib/images/convert-heic.ts` 供上传页和单品详情页共用 |
| 单品补充多角度照片 | ⚠️ 代码完成待联调 | 老板需求：上传后可在 `/closet/[id]` 继续加同一件衣服的其它角度（背面/侧面/细节/水洗标）。新表 `wardrobe_item_photos`（schema 第 17 节，需在 Supabase SQL Editor 手动执行）+ `item-photos.tsx` 缩略图条。刻意不放进 `wardrobe_items` 的列里：搭配相关代码（Canvas、`selectCandidates`、stylist/plan prompt）只读 `clean_url`/`original_url`，额外角度存在另一张表就天然不会被搭配读到，**搭配始终用最初那张去背景图**。这些照片不跑任何 AI（无检测/无去背景/无分类），浏览器直传 Storage + insert 一行，零成本；上限 8 张 |
| 单品详情页推荐 3 个 Look | ✅ 代码完成 / ⚠️ 待真实 AI 联调 | `/closet/[id]` 优先列出最多 3 个包含该单品的 Saved Looks，卡片复用 `OutfitCollage`，点击经 `/outfits?open=<id>` 直接进入 Canvas 编辑。完全没有 Saved Look 时才显示用户主动的 Generate 3；`/api/ai/item-outfits` 一次 Haiku tool call 生成恰好 3 套、强制包含当前单品并验证归属/完整度/品类规则/互异性，成功后保存为普通 `ai_generated` Looks。页面打开本身不调用 AI；不需要新 schema |
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
| AI Stylist 深挖 + Canvas | ✅ 代码完成 / ⚠️ 待真实验证 | 客户端发送完整对话历史；Haiku 在信息不足时每轮只追问 1–2 个高价值问题，足够后返回经真实衣橱 ID 校验的结构化 Look。前端以 Canvas + 理由/造型细节展示，可进入共享 Closet/Canvas 编辑并保存或更新到 Looks |
| Human Stylist 预约 | ✅ 代码完成 / ⚠️ 待 section 16 + 真实验证 | `/stylist` 弹窗提供 30 分钟线上和 9–5 线下全天；工时固定在 `STYLIST_TIME_ZONE`、转换成浏览器 IANA 时区显示，服务端排除全局已占用区间并重验，Postgres exclusion constraint 防并发撞期。尚无付款、人员分配、取消/改期和邀请通知 |
| 搭配创建/保存 + 编辑/删除 | ✅ 完成 | `outfits-view.tsx`：衣橱单品拖入/点击加入、自由定位、缩放、层级调整、名称/合集/备注及 Supabase 保存；Canvas 使用去背图透明展示；已保存搭配可从库卡片打开进 Canvas 编辑，也可经确认后删除（只删 Look，衣橱单品保留）；`outfit_items.x/y/width` 持久化自由坐标（见「已完成任务详情」） |
| 天气 API 集成 | ✅ API 就绪 | 需要 OpenWeather Key；daily/weekly 已接天气，Stylist 目前通过需求澄清询问与当次穿搭相关的天气/室内外约束 |
| 每日推荐 (Home Page) | ✅ Phase 6.1 完成且已真实验证（2026-07-30） | `/home` 已接天气 + `eventsOnLocalDay()` + 活跃衣橱，Haiku 动态输出 1–N 个 segments；三层数据库结构是唯一缓存，普通同日 GET 不再调 Claude；Dislike 明确排除旧 item IDs；segment 可编辑和单独保存；Worn 原子写 journal，并让当天出现过的每件单品统一 `times_worn +1`。端到端验证详见下方「任务 1」 |
| Weekly planning (7 天规划) | ✅ Phase 6.2 代码完成 / ⚠️ 待数据库迁移后真实验证 | `/plan` 一次规划从今天起的 7 天。日历地点会在同步时提取城市并缓存坐标，逐日按 event 城市获取 Open-Meteo 预报；支持同日多城市。`Vacation: Hamptons` 这类跨日度假在每个重叠日使用目的地；`Business Trip (London)` 这类跨日商务出差首尾日同时使用常住地 + London，中间日只用 London。事件地址可点击修正或恢复 Google 原地址。仍包含 D8 硬过滤与跨天轮换约束。需执行 schema 中 weekly 唯一键/RPC 及 Calendar location override 的 `alter table`。 |
| Weekly planning 的轮换间隔用户可配置 | ❌ 待开发 | 2026-08-06 新增需求，方案见 ROADMAP 第三节「并行小需求 B」。「同一件多久能再出现一次」现在是 `plan-rules.ts` 里写死的 `REPEAT_GAP_BY_CATEGORY`，要改成用户可调：新增 `profiles.repeat_gap_overrides jsonb`（schema 第 18 节，只存改过的品类、其余回落默认）+ `/profile` 的「Planning preferences」区块（三个预设 + 展开后按品类步进器 + 可行性提示）。**仍按品类分档，不做全局滑块**——6.2 第二次生成已经证明一刀切会把墨镜误判成违规。落地要点：常量降级为默认表、所有吃间隔的函数改成从参数拿 map（不许再直接 import 常量），weekly 和 daily 两条路径都要传，**prompt 里的数字也要跟着改**（否则模型朝错误目标生成、再靠事后强制替换，搭配质量更差）。零新增模型调用 |
| Google Calendar 集成 | ✅ OAuth/设置页/事件同步/地点天气/daily/weekly 接线 / ❌ stylist 待接 | daily 和 weekly 都用真实缓存事件构建动态 segments；同步会从 event location 或明确的旅行标题（冒号、末尾括号、`trip to ...`）提取目的地并缓存。旧的“只看 location”空结果会在下次 sync 自动回填。`/plan` 支持本地修正事件城市/地区（不改 Google Calendar）；`stylist` route 的 `context.calendar` 仍未接线。 |
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
| 日历行程识别（30 天） | ✅ 代码完成，⚠️ 待真实验证 | `src/lib/travel/detect-trips.ts`。纯 TS、零模型调用（D8）：离家 >120km 的坐标或标题里写明的目的地 → 合并成连续日期段（可跨 2 天空档）→ 前后各延一天吸收 transit 事件。已用 7 组合成日历验过（见下方任务 4） |
| Business / Leisure 分类 | ✅ 代码完成，⚠️ 待真实验证 | 先看标题（Business Trip / Conference / Vacation / Wedding…），无定论时数行程内非 transit 事件的 formality 与 occasion。理由字符串 `typeReason` 会显示在徽章 tooltip 里，用户可手动改，改完以存的为准 |
| Travel Packing Planner | ✅ 代码完成，⚠️ 待 section 21 + 真实验证 | `/travel` 列表 + `/travel/[id]` 工作台。**衣物清单是从「已确认的天」派生的**（`garmentsForDays`），不可手改——要改只能改搭配；非衣物部分是写死模板 + 用户增删（D11） |
| 行程内搭配生成 | ✅ 代码完成，⚠️ 待 section 21 + 真实验证 | 走的就是 `/api/ai/weekly`（新增 `?days=` / `?keep=`），写的就是 `/plan` 那批 `outfit_plans` 行 —— 所以「已在 /plan 排过的天直接带进来」不是复制，是同一行。**故意偏离 ROADMAP 6.3 第 5 步**（`source='travel'` + `travel_plan_id`），理由见 CLAUDE.md「Travel mode」 |
| Capsule Wardrobe Generator | ❌ 明确不做（2026-08-13） | 原方案是最小化件数、最大化组合数。实际取舍时用户选了「和 /plan 同一套规则」，所以行程日不放宽 rotation limit。要做的话入口在 weekly route 的 `rotationLimits` |
| Printable outfit cards | ✅ 代码完成，⚠️ 待真实打印验证 | `/travel/[id]/print?section=all\|cards\|packing` + `@media print`（D7，不上 puppeteer）。确定性类别网格而非自由拼贴（D6）；图片用 eager `<img>`；天气读计划生成时的快照而不是重新拉预报 |
| Packing List 导出 / 分享 | ✅ 代码完成，⚠️ 待真实验证 | 两条路都做了：打印/存 PDF，以及 `/trip/[token]` 公开只读页（128 位 CSPRNG token、service role 读、可随时撤销、`robots: noindex`） |

### Phase 6+ — 新增范围（详细方案见 ROADMAP.md）

| 功能 | 状态 | 依赖 / 备注 |
|------|------|------|
| Phase 6.0/6.1 schema | ✅ 全部已在生产库执行（2026-07-30） | 6.0 的三张表已在生产建好；6.1 把扁平 `outfit_plans` 升级为父表 + `outfit_plan_segments` + `outfit_plan_segment_items`，修正 nullable unique，并增加 journal 快照及三个原子 RPC。`database.ts` 已补齐 6.0/6.1 类型。`google_connections` 继续保持只有 service role 可访问。执行后已用 `information_schema`/`pg_constraint` 复核：两张新表、三个 RPC、`UNIQUE NULLS NOT DISTINCT` 约束、`outfit_plans` 旧扁平列已清、`outfit_journal` 的 `plan_segment_id`/`item_ids` 均到位 |
| Google OAuth 底座 — Calendar 一路 | ✅ 已实现且已真实跑通 | 2026-07-30，分支 `phase-6.0-google-oauth`。`GET /api/google/auth?scope=calendar`（CSRF state + httpOnly cookie）→ Google consent（`calendar.readonly`，`access_type=offline&prompt=consent`）→ `GET /api/google/callback` 换 token、upsert `google_connections`（真实拿到的 `scopes` 数组，不是请求时设的）→ `src/lib/google/client.ts` 的 `getAccessToken()`/`hasScope()`，走 `src/lib/supabase/service.ts` 新增的 service-role client（`google_connections` 无 RLS policy，只有它能读写）。refresh 失败会打 `invalid_at` 时间戳、返回 `null`，不抛 500。**已真实验证（2026-07-30）**：在 Testing 模式项目下完整走通 consent（含「Google hasn't verified this app」→ Advanced → 继续）→ callback → `/profile?google_calendar=connected`，直接查库确认 `google_connections` 行写入正确（`scopes=["…/calendar.readonly"]`、`expires_at` 约 1 小时后、`invalid_at=null`、`google_email=null`——预期如此，因为只请求了 calendar scope，没带 email/openid）。**设置页面 UI 已补（2026-07-30）**：`/profile` 的「Connected accounts」区块，Calendar 可连接/重新授权/断开，Gmail 一行标为「Not available yet」（故意显示不隐藏，让 D1 的「两次独立授权」在界面上可见）。状态由 Server Component 用 `getConnectionStatus()` 读、返回结构不含 token；断开走 `POST /api/google/disconnect`。**⚠️ 设置页 UI 只过了 build，未真人点过** —— 待验三条：断开后 Google 账号第三方访问列表里确实消失（证明 revoke 打到了 Google 而不只是删了本地行）、重连后地址栏的 `?google_calendar=connected` 会被清掉、断开状态下 `/home` 优雅降级为无日历事件而不是 500。Gmail 那一路（`?scope=gmail`）仍故意 400，下一个任务再做 |
| `outfit_plans` 统一计划结构 | ✅ 完成且已真实验证 | 日/周/出差共用日期父行，动态段落与单品使用关系型子表；daily 已读写并完全替换 localStorage |
| 日历事件抓取 + 语义化（occasion + formality） | ✅ 已实现且已真实验证 | 2026-07-30，分支 `phase-6.0-google-oauth`。`GET /api/google/calendar/sync` 拉真实 Google Calendar 事件（`src/lib/google/calendar.ts`）→ upsert 进 `calendar_events` → 对 `occasion IS NULL` 的行批量调一次 Haiku（`src/lib/calendar/classify-events.ts`，只喂 title/location/attendee_count，不喂 description，避免用户自己写的「预期答案」污染分类）。**已用真实 Google Calendar 里手动建的 8 个覆盖不同场合的测试事件跑通**：occasion 标签基本准确（`board_meeting`/`gym`/`travel`/`dinner`/`coffee`/`doctor_appointment` 等），6/8 formality 完全命中用户预期，2 个（board meeting、client call）低了 1 档——board meeting 期望 5 实际给 4，可能是模型把 5 分留给纯黑领结场合、公司会议算 4，如果要卡死「board meeting=5」需要在 prompt 里显式区分「business formal」和「black tie」。重跑同一批事件验证了「同一个 `google_event_id` 只分类一次」：occasion 已存在的行不会再触发 Haiku 调用 |
| 本地日期分桶工具（`day-bucket.ts`） | ✅ 已实现且已真实验证 | 2026-07-30。`src/lib/calendar/day-bucket.ts` 的 `eventsOnLocalDay(events, localDate, timeZone)`——daily（6.1）和 weekly（6.2）共用同一份时区转换 + 跨天事件重叠判断逻辑，不各写一份。全天事件特殊处理：按 UTC 日期字符串直接比较，不经过时区转换（因为全天事件本来就没有真实的时刻，硬转时区会把它错误地挪到相邻的本地日）。**已用真实 8 个测试事件验证**：`America/New_York` 时区下，9:45am/3pm/8:15pm（跨 UTC 日期）三个事件正确落进同一个本地日——命中用户「一天三个场合」的测试意图；2 天的 Boston 出差全天事件正确出现在两个本地日上、且不出现在 exclusive 的结束日；换成 `Asia/Shanghai` 时区后分桶结果确实不同（不是写死某个时区）。这一步做完才开始 6.1 的 daily 专属逻辑 |
| 轮换频率由用户决定（ROADMAP 并行小需求 B） | ✅ 代码完成，⚠️ 待 section 19 + 真实验证（2026-08-13） | 规则从「最小间隔天数」改成「滚动 7 天内最多几天」，默认上装/下装/连衣裙/外套 1 天、鞋 2 天、包和配饰 3 天；`profiles.rotation_limits` 只存用户改过的品类，`/plan` 的「Repeat rules」按钮里编辑（三档预设 + 按品类步进器 + 「这个品类你只有 N 件，排满一周需要 M 件」的可行性提示）。同一批改动还修了「总是那几件」的另外三个原因和「运动装进正式场合」——见 Debug Log #19/#20。**同日第二轮**按真实一周的截图修了三处：上限查得出来但没有替换品时被静默忽略（→ 不占槽位的品类改为直接摘掉）、运动段没有「必须是运动装」这条正向规则（→ 新增 `not_sport` + 候选池 `pinnedIds`）、只换一只鞋的两段没有被合并且文字对不上 canvas（→ 合并只比对核心品类 + 新增 `segment-text.ts`），见 Debug Log #21/#22/#23。规则本身有覆盖这三个场景的合成用例跑通，**仍未跑真实生成**；section 19 没执行时会静默沿用默认值（`readRotationLimits()` 单独查询、失败即回落），只有设置面板存不进去 |
| 冷启动 Onboarding（问卷 + 风格滑卡） | ❌ 待开发 | Phase 7。`preference_swipes` 表 + `profiles.preference_dna` 字段都已就绪；ROADMAP 里建议把它排在 Avatar/Shopping 之前，因为它是所有推荐质量的上游且成本最低。唯一非代码工作量是准备 20–40 张风格参考图 |
| Avatar 生成（fal.ai） | ❌ 待开发 | Phase 8。`profiles` 的 `skin_tone`/`hair_color`/`hair_length`/`body_shape` 就是给这个预留的。**成本量级和文本调用不同，必须缓存 + 限流**；虚拟试穿比静态 avatar 难得多，建议分两步 |
| Shopping Recommendations | ❌ 待开发 | Phase 9。缺口信号已经在产出（daily 的 `gap`、出差 capsule 缺口、Analytics 类别失衡）只是丢掉了。**最大未决问题是商品数据源**，建议先接一个联盟 feed 而不是做通用爬虫 |
| 搭配师授权访问 + Folk CRM 集成 | 🟡 预约入口 + Phase 10-A 评审工作台已完成 / CRM 流程待开发 | 已完成单一共享产能日历的线上/线下预约 MVP，以及 Phase 10-A 的 `/pro` 搭配师工作台（见下方任务 3）。人员分配、付款、取消/改期、通知和 Folk 同步仍待开发。**`wardrobe_grants` 按 D16 暂不建** —— 只有一位搭配师时每行 `stylist_id` 都是同一个值；门禁改用 `roles` + `access_expires_at`，加第二位搭配师时再迁移。预约成功不会隐式放开衣橱数据 |
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

### 任务 1c: Phase 6.2 Weekly planning（`/plan`） — ✅ 代码完成，⚠️ 待重跑 section 15 后真实验证

- 动手前敲定的两个决策（2026-07-30）:
  - **一个日期只有一条计划**。原来 `outfit_plans` 的唯一键含 `source`，同一天可以并存 `daily` 和 `weekly` 两行——那是**两次独立的 Claude 调用**（输入不同、约束不同），必然选出不同衣服，于是同一个周四在 `/home` 和 `/plan` 会显示两套，且没有任何机制让它们同步。去掉 `source` 后 `/home` 读「今天的计划」不问出处，`source` 退化成溯源标记。**代价**：碰了 6.1 刚验完的 daily 代码（`readPlanForDate` 去掉 source 过滤、`mark_outfit_plan_worn` 放开 `source='daily'` 限制），这两条要回归验。
  - **周边界 = 从今天起的未来 7 天**，不是周一到周日。周六打开也有 7 天有效内容，且和 Open-Meteo 从今天起算的预报窗口天然对齐。
- 已实现:
  - `supabase/schema.sql`：唯一键改成 `(user_id, plan_date, travel_plan_id)`（迁移里先去重、优先保留 `worn` 行再按 `generated_at` 取新）；`replace_outfit_plan` 的 `on conflict` 补上 `source = excluded.source`；新增 `replace_weekly_plans(p_days)` 一个事务写整周并跳过已 `worn` 的天、返回被跳过的日期。
  - `src/lib/planning/plans.ts`（新增）：`readPlansForDates` / `readPlanForDate` / `hydrateSegments`。daily 读 1 天、weekly 读 7 天，但 join/排序/带 layout 完全一样，抽出来共用而不是各写一份。
  - `src/lib/planning/candidates.ts`（新增）：D8 硬过滤。按当周温区推季节、按当周事件 formality 推 occasion 标签（两套词表原本各自独立，这里是唯一对齐处）。**过滤器真正的风险是过滤到没东西可选**，所以分级放宽（季节且场合 → 任一 → 不过滤）并保证每个品类最少 3 件；无标签一律通过——缺数据不能变成排除理由。
  - `src/app/api/ai/weekly/route.ts`（新增）：`GET` **只读、绝不调 Claude**（和 daily 的「miss 就生成」不同——日推是用户预期自动发生的一次小调用，周计划是吃整个衣橱的大调用，该由用户主动按下）；`POST` 生成整周。
  - `src/lib/weather/open-meteo.ts`：新增 `getForecastAsCurrent()` 和 `describeWeatherCode()`。
  - `src/app/api/ai/daily/route.ts`：`weatherForDate()`——只有当 `localDate` 就是今天才用 OpenWeather 实况，否则走 Open-Meteo 预报。**这是接单天重生成时发现的真 bug**：`/plan` 上重算周四会用「此刻」的天气推理周四的穿搭，换季时错得最厉害。
  - `/plan` 页面（7 列周视图 + 选中日详情）、sidebar 新增「This Week」、`proxy.ts` 的 `isDashboard` 加 `/plan`。
- **`/plan` 上任意一天都能编辑**（2026-07-30 补）：最初 day detail 只有一个「Adjust on Home」链接，而 `/home` 永远只显示今天——点周四会跳到今天，等于其它六天不可编辑。后端从来没有日期限制（`POST /api/ai/daily?date=` 和三个 segment RPC 都不限今天），纯粹是 UI 没接。把 `SegmentCanvasEditor` 从 `daily-recommendation.tsx` 抽成 `src/components/outfit/segment-canvas-editor.tsx` 共用，`/plan` 的每个 segment 现在有「重生成 / Adjust / Save」三个按钮；「Open on Home」只在选中的是今天时才出现。
- **单天重生成复用 `POST /api/ai/daily?date=`**，没有新开端点——那条路径本来就处理单个日期，而且会把 `source` 翻回 `daily`，正好符合「单独重算后不再受整周约束」的语义，`/plan` 上给这天打「Adjusted」标记。
- **前两次真实生成暴露了同一个设计错误的两种形态（2026-07-30）**，根因都是我自己违反了 D8「不要指望 LLM 做硬约束满足」——把能精确判定的规则留在 prompt 里当软约束：
  - **第一次**：跨天轮换。同一双棕鞋连穿 8/03–8/05、同一条黑裤连穿 8/03–8/05、同一个黑配饰连穿 8/01–8/03。**不是衣橱不够**（6 条下装 + 5 条连衣裙 + 7 件上装，7 天排得开），prompt 里写了「间隔 ≥2 天」，Haiku 直接无视。
  - **第二次**（加了校验之后）：规则本身太一刀切 + 缺结构校验。墨镜被当成违规（每天戴同一副墨镜完全正常，纯噪音），而**一个 segment 里出现了两条裤子**——这是比轮换更基本的规则，我压根没写。
  - **第三次**（按品类分档之后）：轮换和结构都对了，但 **8/02 那天整套只有一双凉鞋**，没有衣服没有包。因为我写的规则全是「最多几件」，从来没写「至少要有什么」——一个只有鞋的 segment 一路过关落库。
- 修法（`src/lib/planning/plan-rules.ts`）:
  - **结构规则** `MAX_PER_CATEGORY_IN_SEGMENT`：一套里最多 1 条下装 / 1 条连衣裙 / 1 双鞋 / 1 个包；上装和外套各 2 件（叠穿是真实的：衬衫 + 开衫、马甲 + 西装）；配饰 4 件。**包和配饰最初不限**，导致整套件数根本没有上限——用户衣橱里有 10 条腰带，模型完全可以合规地给出 6 条。全品类封顶后单套最多 11 件（2 上装 + 1 下装 + 2 外套 + 1 鞋 + 1 包 + 4 配饰），实际大多 5–7 件。`enforceComposition()` **确定性执行**，是入库前的最后一步，weekly 和 daily 都接了——「留一条裤子而不是两条」不需要任何判断，而且即使修复调用出问题也不能让不可能的搭配落库。
  - **轮换规则** `REPEAT_GAP_BY_CATEGORY`：**按品类**设间隔。上装/下装/连衣裙/外套 = **7 天**（等于「一周内穿过就不再穿」，因为规划窗口就是 7 天）；鞋 = 2 天（鞋子数量通常多于衣服，一周穿两次同一双不违和）；包和配饰 = 0（豁免）。同一天内跨 segment 重复永远不算违规。
  - **天气规则** `TOO_WARM_FOR_SLEEVES_C = 30`：超过 30°C 的日子不用外套、不用长袖上衣/连衣裙。季节标签管不了这个（很多单品同时标了 spring 和 summer），而候选过滤是按整周温区做的——一周里有一天 32°C 但也有冷天时，毛衣必须留在候选池里，所以只能做成**按天**的规则。没有袖长字段，靠品类（外套一律算）+ 保守的 subcategory/material 关键词推断。weekly 用预报的当日最高温，daily 只有一个代表温度，所以严格程度略低。
  - **互斥规则** `INCOMPATIBLE_WITH`：连衣裙不与上装或下装同时出现——它本身已经覆盖上下身。按品类分别计数完全发现不了这个问题（每件都没超各自的上限）。外套故意**不**互斥（西装/马甲叠在连衣裙外是真实搭配）；副作用是被分类成 `Tops` 的开衫从此不会和连衣裙搭配，真需要的话应该把那件改归 `Outerwear`。裁剪时**保留连衣裙**——删它会让这套同时违反完整度规则。
  - **分段数量改为 TS 计算** `src/lib/planning/occasion-groups.ts`：按 formality 把当天连续场合分组（差 <1 归一组），两个 prompt 都直接收到「要建哪几段、每段挂哪些 eventIds」。原来交给模型「相似就合并」的裁量不稳定——9:45 董事会(4) + 3pm 客户电话(3) + 8:15pm 晚餐(3) 这同一天，有时正确出两段，有时全并成一段。formality 未知的场合并入当前组而不是强制断开，避免缺数据凭空多出一次换装。
  - **完整度规则** `REQUIRED_SLOTS`：一个 segment 必须覆盖 torso（Tops 或 Dresses）、legs（Bottoms 或 Dresses）、feet（Shoes）三个位置，连衣裙一件顶两个。`enforceCoverage()` 从候选池里挑一件补上，且挑的时候会避开「离得太近会造成轮换违规」的单品，所以补洞不会制造新问题。
  - 有违规发**一次**定向修复调用只重建冲突的那几天（点名是哪件、和哪天冲突——重复陈述规则正是已经失败过的做法）。**之后三条规则一律确定性兜底**：`enforceComposition` → `enforceCoverage` → `enforceRotation`，顺序不能乱（补洞可能制造重复，所以轮换放最后）。代码挑的替换单品审美肯定不如模型，但连着三轮「prompt 写了它照样犯」已经证明这些不变量必须**保证**而不是**请求**。真的排不开的（衣橱某品类填不满）通过 `warnings` 返回并在 `/plan` 顶部显示，而不是咽下去。
  - daily 路径也接了 composition + coverage —— `/home` 同样可能生成这些坏搭配，只是还没撞上。
- **校验机制本身第一次就验对了**：3 条警告和数据库里 3 处连穿完全一一对应，说明问题在规则内容而非检测逻辑。
- **已验证**: `tsc --noEmit` 与 `npm run build` 通过，`/plan` 和 `/api/ai/weekly` 出现在构建路由表。
- **未验证**: section 15 需重跑（唯一键变更 + `replace_weekly_plans`）。待验：整周生成的跨天约束是否真的生效（同一件 statement piece 不在 7 天内重复）、已 `worn` 的天是否被正确跳过并出现在 `skippedDates`、`/home` 和 `/plan` 对同一天是否显示同一套、单天重算后 `source` 是否翻回 `daily`、以及 6.1 那几条回归（缓存命中、Worn 计数、Canvas 版式保留）。

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
- **已验证**: `npm run lint`、`tsc --noEmit` 与 `npm run build` 均通过。Next 16 不再在 build 中自动运行 ESLint，因此三项需要在 CI 中分别执行。

### 任务 1d: `/home` + `/plan` 复用并回存 Saved Looks — ✅ 代码完成，⚠️ 待 section 20 + 真实验证（2026-08-13）

- `Home` 与周计划的每个可编辑 segment 都新增 `Use saved`；入口打开共享的 `SegmentCanvasEditor`，从当前用户的 `outfits` + `outfit_items` 读取图库，把选中 Look 的单品、顺序、`x/y/width` 原样载入。载入后仍可增删、拖动、缩放，不另写一套编辑器。
- `Done` 只保存计划 segment。未修改的复用保留 `saved_outfit_id`；修改后清掉精确快照链接，但用 section 20 新增的 `source_outfit_id` 记住来源，刷新后也不会丢。
- 修改后再次点 `Save` 会打开明确的选择弹窗：`Update original` 只覆盖原 Look 的 items/layout、保留名称/folder/notes；`Save as new` 新建一套；也可取消。共享的 `SegmentSaveButton` 让 `/home` 与 `/plan` 行为一致。
- section 20 新增 `update_outfit_plan_segment_from_canvas()` 与 `save_outfit_plan_segment_choice()`，两个 RPC 都校验当前用户对 plan、source Look 和 wardrobe items 的归属，并在一个事务中完成计划落库和 Look 新建/覆盖。更新原 Look 时，其它仍指向旧快照的 segment 会降级为“based on”而不是错误显示 Saved。
- 单段 AI 重生成会清空 `source_outfit_id`，避免把模型全新结果误当作用户对旧 Look 的修改。
- **已验证**：`npx tsc --noEmit`、`npm run build` 通过。
- **未验证**：需先在 Supabase SQL Editor 执行 `schema.sql` section 20，再用真实账号分别走 `/home` 与 `/plan` 的“原样复用 / 修改后另存 / 修改后更新原 Look / 刷新后来源仍在”四条路径。

### 任务 2: AI Stylist 深挖需求 + Canvas 回答/编辑/保存 — ✅ 代码完成，⚠️ 待真实验证

- 根因: 旧页面每次只发送最后一句 `{ message }`，route 也只返回 `{ reply }`，所以模型看不到之前问答，既无法真正澄清需求，也没有能映射到图片的结构化单品 ID。
- 已实现:
  - `POST /api/ai/stylist` 改为接收最近 14 条对话并返回两态协议：信息不足为 `{ type:"question", questions:[...] }`，每轮最多两个高价值问题；信息足够为 `{ type:"recommendation", look:{ itemIds, summary, reasoning, stylingNotes, gap } }`。第二次用户回答后默认做合理假设并出方案，避免无限盘问。
  - 两态协议通过强制 Anthropic tool call + JSON Schema 落地，不再依赖模型遵守 `FINAL:{...}` 文本格式；若供应商异常只返回文字，route 将其作为 question 降级返回而不是 502。
  - 模型 item IDs 在服务端和当前用户的活跃衣橱交叉校验，少于两件有效自有单品就拒绝结构化结果；前端只接收反查后的真实图片行。
  - `/stylist` 把推荐直接显示成 `OutfitCollage`，解释「整体想法 / why it works / finishing notes」；Edit canvas 进入共享 `ClosetPicker` + `OutfitCanvas`，支持增删、拖动、缩放和层级。
  - Save to Looks 写 `outfits(ai_generated=true)` + 带 `x/y/width` 的 `outfit_items`；保存后继续编辑会更新同一个 Look，不重复建一条。

### 任务 2b: Human Stylist 预约 slot picker — ✅ 代码完成，⚠️ 待 section 16 + 真实验证

- `/stylist` 的 Human Stylist 弹窗提供两种服务：`online_30`（工作日 30 分钟）和 `in_person_day`（周二/四/六 9–5 全天）；工时在 `STYLIST_TIME_ZONE`（默认纽约）生成，再转换成浏览器检测到的 IANA 时区显示。
- `GET /api/stylist/bookings` 生成服务时段并通过 service role 排除所有用户已经占用的重叠区间；`POST` 不信任客户端时间，按同一服务日历重新验证并在写入前再查一次冲突。
- `stylist_bookings` 只允许用户读自己的行、没有浏览器写 policy；写入必须经过认证 route。数据库 `tstzrange` exclusion constraint 是并发竞态的最终保护，线下全天与当天线上 slot 也互相排斥。
- 当前边界: 单一共享搭配师产能；未做人员分配、定价/付款、取消/改期、邮件/日历邀请和 Folk CRM 同步；预约不会自动创建 `wardrobe_grants`。
- **已验证**: `tsc --noEmit` 与 `npm run build` 通过，构建路由包含 `/api/ai/stylist`、`/api/stylist/bookings` 和 `/stylist`。**未验证**: 生产库还需手动执行 `supabase/schema.sql` section 16；执行前 availability route 会返回 503，而不是展示假 slot。

### 任务 3: Phase 10-A 搭配师评审与建议（`/pro`） — ✅ 代码完成，⚠️ 待 section 18 + 真实验证

需求：搭配师看客户衣橱和 Looks，给人工评分 + 文字 + Canvas 改版；看不到具体日程，只看到泛化的未来场合和目前选定的搭配；她保存后用户端弹出建议，用户可采纳或拒绝。决策记录见 ROADMAP 的 D15/D16/D17 和第四节「Phase 10-A」。

**建议是提案，不是修改。** 搭配师点「Send」只写 `stylist_reviews` + `stylist_review_items`，绝不碰客户的 `outfits`/`outfit_plan_segment_items`。客户点采纳时才由 `accept_stylist_review()` 覆盖目标，并在同一个事务里把**覆盖前的单品集合连同 x/y/width 几何**快照进 `previous_items`，所以「采纳完又后悔」能通过 `revert_stylist_review()` 精确还原，不只是还原有哪几件、连版式一起还原。撤销后落 `reverted` 而不是回到 `pending`，否则它会重新出现在收件箱里装作没被回答过。

**门禁（D16）**：访问者 `profiles.roles` 含 `'stylist'` **且** 客户 `profiles.access_expires_at > now()`。没有 `wardrobe_grants` —— 只有一位搭配师，那张表的每行 `stylist_id` 都一样，不表达任何信息。同一条规则在 SQL 里存在第二份（`public.stylist_can_view()`，section 18a），**那一份才是真正保护数据的**；`src/lib/stylist/access.ts` 里的检查只负责路由和文案，改一处必须改另一处。`wardrobe_access_log` 现在就建了 —— 事后补的审计日志没有历史。客户可在 `/profile` 点「End access now」把窗口设成 `now()` 提前结束。

**RLS 是白名单不是黑名单**：`stylist_can_view()` 只挂在 `wardrobe_items` / `outfits` / `outfit_items` / `wardrobe_item_photos` / `profiles` 五张表的额外 SELECT policy 上。`calendar_events`、`google_connections`、`outfit_journal`、`outfit_plans` 系列**一条都没加**，以后新建的表默认也进不来。`stylist_can_view()` 必须是 `security definer`：它被挂在 `profiles` 的 policy 上又自己读 `profiles`，写成 invoker 会无限递归。

**场合共享三档（D17）**：L0 不共享（默认，只看衣橱和 Looks）→ L1 `profiles.stylist_share_occasions`（按天给泛化描述 + formality + 当天已选定的搭配）→ L2 `calendar_events.stylist_share_detail`（逐条，才给时间和标题原文）。L1 的文案由 `occasion` + 新增的 `calendar_events.companion` 两个枚举查表拼成（「A dinner with friends」「A formal engagement with colleagues」），**压根不经过事件标题**，所以结构上不可能带出人名地名——让模型去脱敏是能用到它某次不管用为止的方案。同理 `outfit_plan_segments.label`/`reasoning` 一律不投影给搭配师（Haiku 是从标题写的它们，会写出「for your meeting with Sarah」），搭配师看到的计划段名字是从它引用的事件的枚举重新拼的。`occasion` 本身是模型自由生成的 snake_case，所以展示时走固定映射表 `OCCASION_LABELS`，认不出来的值退回按 formality 说话，而不是把模型写的字符串原样显示。

**一个必须跑的 backfill**：`classifyEvents` 现在多返回一个 `companion` 枚举（同一次批量调用，零额外成本），sync 路由的筛选条件从 `occasion IS NULL` 改成 `occasion IS NULL OR companion IS NULL`。存量已分类的行需要重跑一次 `/api/google/calendar/sync` 才会补上 `companion`，否则搭配师那边会永远看到「with someone」。

**新增文件**：`src/lib/stylist/access.ts`（门禁 + 审计）、`src/lib/stylist/occasion-projection.ts`（三档投影 + 枚举查表）、`src/lib/stylist/reviews.ts`（客户侧读取，含 before/after 两套单品）、`src/app/(dashboard)/pro/page.tsx`（客户列表）、`src/app/(dashboard)/pro/[clientId]/`（工作台）、`src/components/stylist/review-inbox.tsx`（客户侧收件箱）、`src/app/(dashboard)/profile/stylist-sharing.tsx`、`POST/GET /api/stylist/reviews`、`POST /api/stylist/reviews/[id]/respond`。

**复用而不是重写**：工作台的编辑器就是 `OutfitCanvas` + `ClosetPicker`，和 `/outfits`、`/home`、`/plan` 是同一份（D12「搭配师看到的就是客户那套界面」）。`eventsOnLocalDay()` 顺手改成了泛型（`BucketableEvent`），让只 select 了部分列的投影也能用它，而不是让投影自己再写一遍时区分桶。

**两处刻意的行为**：采纳搭配师的提案**绕过 `plan-rules.ts` 的规则引擎**（结构/天气/轮换）—— 那套规则是防模型生成不能穿的搭配，人工搭配师排在它前面。`stylist_reviews` 的两个 target FK 都是 `on delete cascade`，所以客户删掉的 Look 或被重生成替换掉的计划段会连同它的待处理建议一起消失，而不是留一个指向空气的采纳按钮。

**首轮真机测试（2026-08-13）修掉的三件事**：

1. **计划中的搭配被错误地藏在「场合共享」开关后面。** 原实现里 L1 关着时投影直接返回空，导致搭配师连客户已经排好的当日/本周搭配都看不到——而那恰恰是这个功能存在的理由。已改成：`segments` 永远给，只有 `occasions` 受 L1 控制；L1 关着时**根本不查 `calendar_events`**，段落名退回 `Look N`。字段从 `shared` 改名 `occasionsShared`。
2. **「采纳后 Today's plan 没变」不是 bug，是对象搞错了。** 评审一个 saved Look，采纳改的是 `outfit_items`，只会在 `/outfits` 里变；`/home` 和 `/plan` 渲染的是 `outfit_plan_segments`，两者按 D5 本来就是不同对象。要改客户某一天穿什么，搭配师必须在工作台的周面板里评审那一天的 **planned look**（`target_kind='plan_segment'`）——而那条路径此前正好被第 1 条的 bug 挡住了，所以第一轮测试根本走不到。
3. **日历事件「突然抓不到了」的真实原因：`/api/google/calendar/sync` 从来就没有任何东西自动触发。** 不是 cron，`/api/ai/daily` 和 `/api/ai/weekly` 也都不调它，两者只读 `calendar_events` 里已有的行。7/30 手动跑那次的窗口是 7/30→8/13，之后新建的事件永远进不来，而且**不报任何错**，表现成「日历是空的」。已在 `/plan` 顶部加「Sync calendar」按钮作为唯一 UI 入口。定时同步仍未做。

4. **采纳之后 `/home`、`/plan` 不跟着变的第二个原因：客户端状态没被刷新。** `router.refresh()` 只重渲染 Server Component，而渲染计划的 `DailyRecommendation` 和 `WeekView` 都是 Client Component、各自持有 fetch 回来的 state，所以数据库已经改了、屏幕上还是旧的那套，要等用户碰巧刷新才会变。已改成采纳/撤销后 `window.location.reload()`；拒绝仍走 `router.refresh()`，因为卡片之外什么都没动。

顺带按需求把搭配师账号做成了独立形态：`roles = '{stylist}'`（不含 client）时侧边栏**只剩 Clients**（2026-08-13 二轮：Profile 也去掉了——那页全是客户侧设置，城市/时区/Google Calendar/共享开关，员工账号一条都用不上；Sign out 本来就在侧边栏底部，不在 Profile 里，所以去掉它不会把任何东西困住），`/home` 重定向到 `/pro`（登录后 `proxy.ts` 会把人送到 `/home`，而 proxy 不查角色——查一次要给每个请求加一次 DB 往返）。两个角色都带的账号保留完整客户端 + Clients，那是开发/自用场景。

**二轮界面改造（2026-08-13）：工作台改成五个 tab。** 之前 `/pro/[clientId]` 只有两块（周视图 + Saved Looks），且是竖着堆的。现在是：**Overview**（默认第一个）、**The week ahead**（当天/本周已排好的搭配，逐段评审）、**Saved Looks**（存下来的 Look）、**Every piece**（整个衣橱，逐件点进去打分 + 留言）、**Build a look**（搭配师用客户已有单品从零搭一套新的）。做成 tab 而不是继续往下堆：一个完整衣橱压在另外几块下面是「一屏滚不完」，不是工作台。Overview 放第一个，是因为它是唯一回答「我现在在看谁」的一块，其余每个 tab 都默认你已经知道了。

**Overview（`src/lib/stylist/client-overview.ts`）**：档案（姓名/邮箱/城市/时区/身高体重/体型/三围/肤色发色）+ 服务状态（窗口剩余天数、场合共享开关、衣橱和 Look 数量、已发建议数与待回复数）+ 会话记录（`stylist_bookings`）。两处都走 service role，但理由不同：`profiles` 那几列**本来**就在 18b 白名单里她能读，只是页面已经为了窗口读过一次这行，再查一遍纯属多一次往返；`stylist_bookings` 则**不在**白名单、以后也不会进——排期要考虑别的用户已占用的时段，那张表按设计就是「用户只能读自己的」，所以这里只投影出她和**这个**客户的会话，且只给 service type / 起止时间 / 状态四个字段。**「过往沟通」只放产品真的记录了的东西**：已预约的咨询 + 已发出的建议。这个仓库还没有消息表，也还没接 CRM（ROADMAP 里的 Folk 集成未做），凭空加一块永远是空的「聊天记录」读起来像 bug，而不像未完成的功能。

**Build a look 仍然是提案，不是写入（`target_kind = 'new_outfit'`）**。这是唯一没有 target 的一种：Look 在客户点采纳之前根本不存在，**采纳才是创建它的动作**——`accept_stylist_review()` 插一行 `outfits`（`ai_generated = false`，人搭的）加上它的 `outfit_items`，并把新 id 记进 `stylist_reviews.created_outfit_id`，撤销就删掉那一行、不多删。所以撤销这一路是「删除」而不是「还原快照」，`revert_stylist_review()` 必须在「没有更早版本可还原」那道检查**之前**先分支——对这种 kind，`previous_items` 空是正常的。那个 FK 是 `on delete set null` 不是 cascade：客户以后自己删了这个 Look，「她曾经提过这套」的记录应该留着。target check 对这种 kind 额外要求 `has_proposal = true` 且 `proposed_name` 非空——一套搭配进到别人衣橱里叫「Untitled」，比客户自己存的还差。**让 `/pro` 直接往客户 `outfits` 写一行**是显而易见的另一种做法，也正好会打破整个工作台唯一的那条规矩。

第三块需要一个新的 `target_kind`：`'item'`，指向新增的 `stylist_reviews.target_item_id`（同样 `on delete cascade`，客户删件时连带清掉待处理建议）。**单件评审永远没有提案** —— 一件衣服没有「版式」可改，所以 section 18d 的 target check 顺手把 `has_proposal = false` 也写进了 `'item'` 那一支：约束在库里，不是靠路由自觉。`stylist_target_items()` 对 `'item'` 返回 `[]`，`accept_stylist_review()` 因此对它天然是「只标记已读」，没有任何要快照/要撤销的东西。客户侧收件箱复用同一张卡片（`hasProposal=false` 那条路本来就存在，按钮是「Got it / No thanks」），只多渲染一张被评单品的图——不然那段留言读起来像在说空气。

**要跑的 SQL**：section 18d 现在多了 `target_item_id`、`proposed_name`、`created_outfit_id` 三列和两条重建的 check 约束（`create table if not exists` 既不加列也不改约束，所以新增了一段显式 `alter table ... drop constraint if exists / add constraint`，对新库是重述、对存量库才是迁移）；`accept_stylist_review` / `revert_stylist_review` 是 `create or replace`，重跑就会带上 `new_outfit` 那两条分支。存量库需要重跑 section 18。

**已验证**: `tsc --noEmit` 与 `npm run build` 通过（含 2026-08-13 二轮的五 tab 改造、单件评审、Overview 与 Build a look），构建路由含 `/pro`、`/pro/[clientId]`、`/api/stylist/reviews`、`/api/stylist/reviews/[id]/respond`。**未验证**: 五 tab、单件评审、Overview、Build a look 都还没真人点过，需要 section 18 重跑之后走两条链路——「Every piece 里点一件 → 打分 + 留言 → 客户 `/home` 收件箱看到那件图 + 留言 → Got it」，和「Build a look → 选 ≥2 件 + 起名 + 写说明 → 客户收件箱 Save to my Looks → `/outfits` 里确实多了这套且版式一致 → Undo 后它消失」；生产库还需手动执行 `supabase/schema.sql` section 18；执行前 `/pro` 会因为 `profiles.roles` 查得到但新表查不到而在收件箱那侧报 `PGRST205`（已做成打日志 + 返回空列表，不会让 `/home` 整页挂掉）。真实验证还需要：给搭配师账号手动 `update profiles set roles = '{client,stylist}'`、用 webhook 或手动给测试客户设 `access_expires_at`、然后跑一遍「评分 + 文字 + 改版 → 客户采纳 → 撤销」，并确认 L0/L1/L2 三档下搭配师看到的东西确实不同。

### 任务 4: Phase 6.3 出差模式（`/travel`） — ✅ 代码完成，✅ section 21/21b 已应用并对真实数据验过识别与 upsert，⚠️ 浏览器端链路待走（2026-08-14）

原来的 `/travel` 是一句 "coming in Phase 5" 的静态文案。现在是：从日历里找出行程 → 分类 business / leisure → 点进去排搭配 → 逐天确认 → 从确认的天生成打包清单 → 打印/存 PDF 或生成公开分享链接。

**行程识别是纯 TS，零模型调用**（`src/lib/travel/detect-trips.ts`，D8 的同一套理由）。判「在外地」看两样：坐标离 `profiles.lat/lng` 超过 120km，或标题里写明了目的地（复用 Calendar sync 那个 `explicitTravelDestinationFromTitle`）。120km 是故意放宽的——给住在纽约的人显示一张「Trip to New York」比漏掉一趟真行程更糟。连续的外地日期合成一段，中间最多可跨 2 天空档（伦敦周二日历是空的，那天仍然在伦敦），前后各延一天用来吸收 transit 事件——一条傍晚 5 点的「Depart for JFK」地理编码落在**家门口**的机场，但那天确实已经在出差了。只有一天的不算行程（那是跑一趟），除非标题白纸黑字写了。

**为什么不能交给模型**：同一份日历问两次会给出两个不同的行程数，而行程的身份（`calendar_signature`）是打包清单挂靠的地方——数量一变，存量行就全部对不上，清单直接成孤儿。

**故意偏离 ROADMAP 6.3 第 5 步**：原方案是每日搭配写 `outfit_plans` 的 `source='travel'` + `travel_plan_id`。那个方案写在 6.2「一个日期只有一条计划」之前，照做的话同一个周四会有「行程里的周四」和「/plan 里的周四」两条独立生成、互不同步的行——正是 6.2 刚消灭掉的 bug。所以 `/travel` 读写的就是 `/plan` 那批行，走的就是 `GET/POST /api/ai/weekly`（新增 `?start=&days=`）。「已经排过的天直接带进来」因此不是复制，是同一行。`travel_plans.daily_outfits` / `weather_data` 保持不用，代码里没有任何路径会产生 `source='travel'`。

**`?keep=` 是为了让「排剩下那几天」是真的而不是近似的**：被 keep 的日期照样送进模型（在 outline 里标 `alreadyWorn`）、照样并进 rotation history，所以真正会被写入的那几天是**绕着**它们选的，而不是对它们一无所知；落库时 `replace_weekly_plans` 跳过它们并连同 worn 的一起回传 `skippedDates`。为此 RPC 加了第二个参数，**必须先 `drop function ... (jsonb)`**，否则两个重载会让每次 `rpc()` 调用变成歧义（PostgREST 报 300，不报人话）。

**确认这一步就是和 `/plan` 的全部差别**：打包清单的衣物部分是从已确认的天**派生**的（`garmentsForDays`），所以清单在结构上不可能和搭配不一致；那里的勾选框意思是「已经装进箱子了」，不是「加进清单」。重排某一天会顺手清掉那天的确认——清单赖以生成的那身衣服已经不在计划里了。非衣物部分是写死模板 + 用户增删，**不让 AI 生成（D11）**。

**Capsule 生成明确不做**：原方案要最小化件数，实际取舍时用户选了「和 /plan 同一套规则」。

**要跑的 SQL**：`supabase/schema.sql` section 21（`travel_plans` 加 `trip_type` / `origin` / `calendar_signature` / `confirmed_dates` / `share_token` / `shared_at` + 唯一约束）和 21b（两参数版 `replace_weekly_plans`）。**没跑之前**：`/travel` 列表页照常出（识别是纯函数，不碰这些列），但点进任何一趟行程会 500 报 `column travel_plans.trip_type does not exist`；21b 没跑的话**连 `/plan` 的生成也会挂**，因为参数个数对不上。

**section 21 / 21b 已应用（2026-08-14）**。应用前先读生产库的 PostgREST OpenAPI spec 确认了故障面：两段**一次都没跑过**，`travel_plans` 六列全缺，`replace_weekly_plans` 还是**只收 `p_days` 的单参数版**——而 route 传的是 `{p_keep_dates, p_days}`，所以当时挂掉的不只是「点进行程 500」，**`/plan` 的 Generate 同样挂**（PostgREST 找不到匹配签名）。其余 block 当时就都在库里：17、18（含 `target_item_id`/`proposed_name`/`created_outfit_id`，即 8/13 之后重跑过）、19、20、photo-enhancement block。

**应用方式改了**：不用再手工粘 SQL Editor——`npx supabase db query --linked --project-ref <ref> -f x.sql` 走 Management API 直接跑，不需要 Docker、不需要 `supabase link` 往仓库落文件、也不用建 `supabase/migrations/`，"本仓库手工应用 schema"的约定不变。唯一前提是 `npx supabase login` 要在**真 TTY** 里做一次（Claude Code 的 `!` 前缀是非 TTY，会报 `LegacyLoginMissingTokenError`）。两段仍然分两次调用跑，理由和以前一样：一次提交 = 一个事务。

**应用前修掉了 21b 自己的一个洞**：`revoke ... from public, anon` / `grant ... to authenticated` 那对授权挂在**单参数签名**上，被 21b 的 `drop function` 一起带走，而 Postgres 新建函数默认对 PUBLIC 开 EXECUTE——照原样应用会白送 `anon` 一个执行权限（`security invoker` 下 RLS 仍会拦住它，但"碰巧被行策略挡住"和"anon 根本调不到"不是同一种保证）。21b 结尾现已重新声明这对授权。

**落库后双向复核**（这一节存在的理由就是上次「报成功、事后 `pg_constraint` 里查不到」）：`information_schema` 里六列齐全、默认值正确（`origin` 默认 `manual`、`confirmed_dates` 默认 `{}`）；`pg_constraint` 里 `travel_plans_trip_type_check` / `origin_check` / `calendar_signature_key` 三条都在；`travel_plans_share_token_key` 是带 `WHERE share_token IS NOT NULL` 的部分唯一索引；`pg_proc` 里 `replace_weekly_plans` **只有一个签名** `(jsonb, date[])`（没有重载歧义），授权是 postgres/authenticated/service_role，**`anon` 不在其中**；PostgREST 侧 spec 也已刷新成 `p_days, p_keep_dates`。

**已验证**: `tsc --noEmit`、`npm run lint`、`npm run build` 全过，构建路由含 `/travel`、`/travel/[id]`、`/travel/[id]/print`、`/trip/[token]`、`/api/travel/trips`、`/api/travel/trips/[id]`、`/api/travel/trips/resolve`。行程识别用 7 组合成日历断言过：带航班的商务行程（出发日被正确吸收进来）、只有标题的度假、单日外地（正确地不算行程）、全在家（不算）、中间空一天（不拆成两趟）、相隔两周的两趟、没写明措辞的休闲行程（靠事件内容分类）。

**对真实数据验过（2026-08-14）**：拿生产库里真实的 29 条日历行喂给真正的 `detectTrips()`（不是合成断言），检出 `Hamptons 2026-08-14 → 2026-08-21`（8 天，leisure，理由「"vacation: Hamptons" 是日历上写着的」），signature `2026-08-14|hamptons`；Chicago 那个没同步过日历的账号正确地检出 0 趟。resolve 的 upsert 也在事务里试过 `on conflict (user_id, calendar_signature) do update` 能命中真约束（CLAUDE.md 警告的「部分唯一索引会让 PostgREST 的 upsert 全挂」在这里不适用，因为 21 建的是真约束），跑完 `rollback`，`travel_plans` 仍是 0 行。

**未验证**: 浏览器里的那一串——「Sync calendar → 列表里认出这趟 Hamptons → 点进去 → 已在 /plan 排过的天确实带着搭配出现 → 排剩下的天没有覆盖掉已排的 → 逐天确认 → Packing tab 的衣物确实等于那几天的并集 → 打印页图片不是空框 → 分享链接在无痕窗口打得开、撤销后 404」。这几步要么需要登录态、要么需要肉眼看渲染，服务端脚本replace不了。

---

## 已完成任务详情（历史记录）

### 任务: Saved Looks 支持删除 — ✅ 完成

- 需求: `/outfits` 的 Saved Looks 除了编辑，也应该能删除不再需要的搭配。
- 已实现 (`src/app/(dashboard)/outfits/outfits-view.tsx`):
  - 每张已保存搭配卡片新增删除按钮；触屏尺寸下常显，鼠标尺寸下与 Edit 操作一起在悬停或键盘聚焦时显示。
  - 删除前明确确认「只删除 saved look，衣橱单品仍保留」；确认后按 `id + user_id` 删除 `outfits` 行，现有外键级联清理 `outfit_items`。
  - 删除期间只锁定目标卡片并显示加载状态；成功后立即从当前列表移除、提示成功并 `router.refresh()` 同步服务端数据；失败则保留卡片并显示错误。

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

### 任务: 单品魔术棒照片优化（多参考图 + 标签识别）— ✅ 代码完成，⚠️ 待 photo-enhancement schema block + 真实图片验证

- Closet 卡片与单品详情主图都有魔术棒入口；生成时原图上覆盖循环扫光遮罩和阶段文案，完成后打开 Before/After，只有用户确认才切换主展示图。
- 生成使用低成本 `bytedance/seedream/v5/lite/edit`，主图加最多 4 张非标签 reference；prompt 锁定颜色、版型、领口、袖长、纽扣/口袋/拉链、logo、图案、面料和做旧细节，禁止重新设计。
- `label` / care-tag 照不进入生成模型。reference 上传后由一次批量 Haiku vision 缓存 `kind/analysis/analyzed_at`，只从可读标签提取 brand 与精确材质成分并自动填入；旧 reference 第一次优化时懒分析一次，后续不重复付费。
- Seedream 结果再次走现有 BiRefNet 抠图，再由 Sharp 按品类裁透明包围盒并放进统一 1024x1024 画布；统一留白/尺度是确定性处理，不交给生成模型猜。
- 原 `original_url` / `clean_url` 不覆盖：候选存 `enhancement_candidate_*`，确认后才进入 `optimized_*`，可拒绝、重新生成和 Restore original。所有 Closet / Looks / plan / AI Stylist / Human Stylist 图片统一使用 `optimized_url ?? clean_url ?? original_url`。
- API：`POST/GET/PATCH/DELETE /api/ai/items/[id]/enhance`，以及 `POST /api/ai/items/[id]/references/analyze`。
- **已验证（2026-08-13）**：`tsc --noEmit`、全项目 `npm run lint`、Next.js production build 全部通过；build 中已列出两个新动态 API route。
- **未验证**：没有为了开发验证额外烧 fal 调用；生产库需先执行 `supabase/schema.sql` 中的 `WARDROBE ITEM PHOTO ENHANCEMENT` block，再用真实的 2–4 张 reference（含一张 label）检查自动字段、身份保持、扫光、确认/拒绝/恢复和各搭配页面图片同步。
- **Runtime debug（2026-08-13）**：远端库未执行该 block 时，显式读取 `optimized_url` 会报 Postgres `42703`，并曾被增强 API 误报成 404。普通读取现用兼容新旧 schema 的 star select；增强 API 会返回带迁移指引的 `503 ENHANCEMENT_SCHEMA_MISSING`。详情主图同时补了 eager loading，清除 LCP 警告。
- **长任务 debug（2026-08-13）**：真实 3-reference 测试中，2 张 label 正确排除、1 张 back 进入生成；候选图成功落库，但 Seedream → BiRefNet → normalize 同步链路约 80 秒，原 UI 在十几秒后停在同一句 copy，容易误判卡死。现显示累计用时与 45–100 秒预期，刷新后自动恢复 `ready` candidate；fal 两段都有 request id / queue status / duration 日志和可取消硬超时，下载及 Haiku reference 分析也有上限。

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
| HEIC 转换 | `src/app/api/ai/convert/route.ts`（服务端），`src/lib/images/convert-heic.ts`（客户端共用判断） |
| 单品多角度参考照 | `src/app/(dashboard)/closet/[id]/item-photos.tsx`, `supabase/schema.sql` section 17 |
| 上传 pipeline (计数→单件/多件分支→去背景→分类→存储) | `src/app/api/ai/classify/route.ts` |
| 上传 UI（single/multi 切换、进度提示） | `src/components/closet/upload-zone.tsx` |
| AI Stylist 多轮澄清 + structured tool response | `src/app/api/ai/stylist/route.ts` |
| AI Stylist Canvas / 编辑 / 保存 / Human Stylist 弹窗 | `src/app/(dashboard)/stylist/page.tsx` |
| Human Stylist slot 与预约 | `src/app/api/stylist/bookings/route.ts`, `supabase/schema.sql` section 16 |
| 每日推荐 (Home) 数据+AI 逻辑 | `src/app/api/ai/daily/route.ts`, `src/lib/weather/openweather.ts` |
| 天气 provider / 城市转坐标 | `src/lib/weather/` (`openweather.ts`, `open-meteo.ts`, `geocode.ts`), `src/app/api/geocode/route.ts` |
| Home 首页 UI | `src/app/(dashboard)/home/page.tsx`, `daily-recommendation.tsx` |
| 搭配创建/保存、自由拼贴 Canvas | `src/app/(dashboard)/outfits/outfits-view.tsx` |
| 搭配页服务端数据查询 | `src/app/(dashboard)/outfits/page.tsx` |
| 数据库类型定义 | `src/types/database.ts` |
| 认证 / 路由保护 | `src/proxy.ts` |
| 数据库 Schema | `supabase/schema.sql` |
| 环境变量 | `.env.local` |
