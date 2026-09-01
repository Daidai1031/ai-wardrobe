# AI Wardrobe — Swipe Feature & Continuous Learning Plan

**Version 1.0 · August 2026**

---

## 1. What We Are Building

A swipe feature that does three jobs at once:

1. **Learns a new user's taste fast** (cold start)
2. **Keeps learning from daily use** (long-term personalization)
3. **Lets stylists teach the system** (human-in-the-loop)

The third job is the important one. It is what makes this different from every other wardrobe app.

**Our position in one sentence:** other apps let you hire a stylist. We turn stylist judgment into a model that gets better every month.

---

## 2. What The Industry Does

### 2.1 Stitch Fix — closest model to ours

Their core method is mixing machine recommendations with expert human judgment. Algorithms score and rank items, then a human stylist picks the final set. They even use an algorithm to match each client to the right stylist.

Their reasoning for keeping humans in the loop is worth copying:

- Humans can use unstructured data (photos, free-text notes)
- Humans build the relationship, which drives loyalty
- Humans handle the weird edge cases, so engineers can focus on the average case

**Most relevant to us:** they say that a dataset of "what makes a good outfit for *this* client" does not exist anywhere. You have to build it on purpose, and the best way is to have your own in-house stylists create it.

That is exactly what we are doing.

**Sources:** [Stylists in the Loop](https://multithreaded.stitchfix.com/blog/2022/09/02/stylists-in-the-loop/) · [Algorithms Tour](https://algorithms-tour.stitchfix.com/) (walks through their whole pipeline — worth reading end to end) · [Expert-in-the-loop with generative AI](https://newsroom.stitchfix.com/blog/how-were-revolutionizing-personal-styling-with-generative-ai/) · [Multithreaded algorithms blog](https://multithreaded.stitchfix.com/algorithms/blog/) · [2025 interview on human-in-the-loop strategy](https://www.uschamber.com/co/good-company/the-leap/stitch-fix-optimizing-with-ai)

### 2.2 Zalando — turning stylist work into training data

Their Algorithmic Fashion Companion learned from ~200,000 outfits created by stylists from their paid styling service.

In a blind test, outfits made by humans were rated "bad" 16.9% of the time. The algorithm's outfits were rated bad 13.9% of the time.

Two things to take from this:

- Stylist output is the training data. Nothing else works as well.
- Stylists keep adjusting the algorithm so it stays current with the season. Trends are handled by humans, not by retraining.

Business result: outfit-level recommendations drove roughly 40% larger baskets than single-item recommendations.

**Sources:** [Zalando corporate — how AFC works](https://corporate.zalando.com/en/company/how-zalando-helps-customers-make-perfect-fashion-choices) · [Blind test results, human vs algorithm](https://www.retaildetail.eu/news/fashion/zalando-lets-computer-give-you-fashion-advice/) · [Interview with Zalando's VP on why stylists stay](https://fashionunited.uk/news/fashion/ai-in-fashion-interview-with-vp-of-inspire-and-engage-at-zalando/2019080944674) · [Launch coverage](https://internetretailing.net/zalando-launches-virtual-stylist-based-on-machine-learning-18618/) · [Competitor benchmark against AFC](https://www.intelistyle.com/intelistyles-ai-stylist-outperforms-zalando/) (from a vendor, so read it as marketing — but the methodology of blind-testing outfit richness is worth copying)

### 2.3 Tinder — two lessons, one warning

In 2017 they presented **TinVec**, a word2vec-style model that turns swipe behavior into user vectors. If two users swipe right on similar profiles, the system assumes similar taste and cross-pollinates their feeds. This is standard collaborative filtering, and the general idea works for outfits too.

**The warning:** their old Elo "desirability score" ranked people globally and showed attractive users to attractive users. It caused a public backlash and they moved away from it.

**Do not build a global "outfit popularity score" and rank on it.** It will push every user toward the same safe, basic outfits and kill personalization — which is the entire product.

Second lesson: if a user swipes left on 95% of cards, the system gets no positive signal and cannot learn. The UI has to prevent mindless left-swiping.

**Sources:** [Analysis of TinVec and the Elo transition](https://www.swipestats.io/blog/tinder-algorithm) · [Behavioral signals dating apps track](https://blog.photofeeler.com/dating-app-algorithms/). Caveat: Tinder has never published a full technical paper, so all public write-ups are reconstructions from conference talks, patents, and observed behavior. Treat the mechanics as directional, not exact.

### 2.4 Consumer wardrobe apps — where we actually compete

| App | What it is good at |
|---|---|
| Whering | Strongest fully free cataloging. ~7M users |
| Acloset | Most automation + social feed. ~7M users |
| Indyx | Human stylist marketplace ($60–$295 per lookbook) + cost-per-wear analytics |
| GetWardrobe | Stylist Mode — stylists run their whole practice inside the app |
| Cladwell | Capsule wardrobe routines |
| Stylebook | Fully manual, no AI |

**Key insight:** "we have real stylists" is **not** a differentiator. Indyx and GetWardrobe already have that.

The difference is that their stylist work is a one-time delivery. The judgment is used once and disappears. Ours compounds into the model. That is the only place we can build a real moat.

**Sources:** [GetWardrobe feature-by-feature comparison](https://getwardrobe.com/compare/) · [Portal's six-app comparison](https://portal-f4u.com/best-ai-stylist-apps/) · [Vesta comparison](https://vestatheapp.com/blog/vesta-vs-indyx-whering-acloset) · [Aurelle comparison, includes GDPR notes](https://aurelle.app/blog/best-ai-wardrobe-apps-2026) · [Indyx on Google Play](https://play.google.com/store/apps/details?id=com.indyx.android)

**Important caveat:** almost every wardrobe-app comparison online is written *by* one of the apps in it. Several disclose this openly, some don't. Use them to find which features exist and roughly what things cost, then verify pricing and user counts on each app's own store listing before quoting any of it externally.

### 2.5 Academic work we can use

- **[Learning Type-Aware Embeddings for Fashion Compatibility](https://arxiv.org/pdf/1803.09196)** (Vasileva et al., ECCV 2018) — the base idea for compatibility: learn both *similarity* (two tops are interchangeable) and *compatibility* (a top and a skirt go together). These are different things and need different treatment. [Code](https://github.com/mvasil/fashion-compatibility)
- **[FashionCLIP](https://huggingface.co/patrickjohncyh/fashion-clip)** (Chia et al., 2022) — showed that fine-tuning CLIP on fashion data produces embeddings that capture **style affinity**, not just visual similarity. This distinction matters a lot for us. We want "these go together stylistically," not "these look alike." [Code](https://github.com/patrickjohncyh/fashion-clip)
- **[Loom: Hybrid Retrieval-Scoring Outfit Recommendation](https://arxiv.org/pdf/2605.09830)** (2026) — combines a learned embedding space with explicit rule constraints, because some domain knowledge cannot be learned from co-occurrence alone. Built for small catalogs of a few hundred to a few thousand items, where you can just score every combination by brute force.
- **[Fashion Meets Computer Vision: A Survey](https://arxiv.org/pdf/2003.13988)** — the best single overview if someone new joins the team and needs to get up to speed on the whole field. Covers the personalization-plus-compatibility problem specifically.

**Loom's finding is the most useful thing in this whole document:** a personal wardrobe is small enough that we can enumerate every valid outfit and score all of them. No retrieval system needed. This removes about 60% of the expected engineering work.

---

## 3. The Architecture

### 3.1 One scoring function

Every outfit gets one score, made of three parts:

```
score = w1 × compatibility_score   (general "does this go together")
      + w2 × personal_score        (this user's taste)
      + w3 × stylist_score         (rules + stylist labels)
      + w4 × trend_score           (current trends, capped at ~15%)
```

All four parts exist from day one. Only the weights change.

| | Compatibility | Personal | Stylist | Trend |
|---|---|---|---|---|
| Day 1 | High | none | Medium | Low |
| Week 1 | Medium | Low | Medium | Low |
| Month 3 | Low | **High** | Medium | Low |

Note that **stylist weight never drops**. It is not a crutch for the cold-start period. It is the product.

### 3.2 Onboarding is not a separate system

This is a common mistake. If onboarding uses different logic, quality visibly drops the day a user finishes onboarding, because you swapped engines.

Onboarding differs in only three ways:

| | Onboarding | Daily use |
|---|---|---|
| Content source | External inspiration images | User's own wardrobe |
| Goal | Maximize information gained | Maximize satisfaction |
| Exploration rate | ~60% | ~20% |

The "maximize information" part is the only real technical difference. During onboarding we deliberately show outfits the model is *uncertain* about, because a 50/50 swipe teaches us more than a swipe we could already predict.

**Do not end onboarding after a fixed number of swipes.** End it when the model's uncertainty about that user drops below a threshold. A consistent user might need 15 swipes. A user with eclectic taste might need 60. A hard-coded number punishes both.

Because the weights slide continuously, there is no switch moment. The user just feels it getting more accurate.

### 3.3 Three layers of learning (and who approves what)

| Layer | Contains | Update speed | Who changes it | Needs approval? |
|---|---|---|---|---|
| **L1 — Rules** | Stylist hard constraints and presets ("no sneakers with business formal", "this client doesn't wear above-knee") | Instant | Stylist directly | No, but fully logged |
| **L2 — Personal** | One preference vector / small model per user, updated from swipes | Seconds to daily | Automatic from behavior | No — affects only that user |
| **L3 — Global model** | Compatibility model, cross-user style priors | Quarterly | Training pipeline | **Yes — Co-Founder sign-off** |

This solves the hardest part of the governance requirement. If everything needs founder approval, the system cannot move. If nothing does, professional standards are not protected.

**Only L3 needs approval, because only L3 affects every user.**

It also gives us explainability for free. When the system says "this doesn't work," it can name the L1 rule instead of saying "the model computed it that way."

---

## 4. Data Design

This is the only thing that must be correct from day one. Everything else can be fixed later.

### 4.1 Four gestures, four meanings

Do not build only left/right.

| Gesture | Meaning | Signal strength |
|---|---|---|
| Right | Like → save to lookbook | Positive |
| **Left** | Dislike → **reason tag required** | Negative |
| Up | I'm wearing this → add to calendar | **Strongest positive** |
| Down | Not now / wrong season | Weak, excluded from training |

### 4.2 Left swipes must carry a reason

This is the single most important design decision in the feature.

A left swipe without a reason is nearly unlearnable. We cannot tell whether to penalize the item, the combination, or the occasion tag. Three different fixes, no way to know which.

Required reason tags (pick at least one):

- Wrong occasion
- Wrong fit for my body
- Wrong color for me
- Not my style
- Don't like this specific item
- Items don't go together

This is also exactly where the "explain why something does or doesn't work" requirement lands in engineering terms. We collect it on both the client side and the stylist side.

### 4.3 Event schema

```
swipe_event:
  user_id, outfit_id, item_ids[]
  gesture: like | dislike | wear_now | later
  reason_tags[]                # required for dislike
  context: occasion, weather, date, calendar_event_type
  surface: onboarding | daily_feed | stylist_review
  candidate_source: rule | embedding | stylist_curated | exploration
  model_version                # required for attribution
  dwell_ms, position_in_deck   # for position-bias correction

stylist_action:
  stylist_id, client_id, original_outfit_id
  action: approve | reject | edit
  edited_outfit_id             # what they changed it to
  rationale_text               # free text — highest-value data we have
  rationale_tags[]

wear_log:
  user_id, outfit_id, worn_date, self_rating
```

**Two fields people always forget:** `candidate_source` and `model_version`. Without them, in three months we cannot evaluate whether any change helped.

**`wear_log` is the ground truth anchor.** Swipe behavior and real wearing behavior drift apart — people right-swipe aspirational outfits they will never actually wear. If we only optimize swipe rate, we build a product full of beautiful outfits nobody wears.

### 4.4 Training signal weights

Not all feedback is equal:

```
stylist approve  >  wear_log  >  swipe up  >  swipe right  >  swipe left
```

One stylist judgment is worth at least ten user swipes.

---

## 5. Models & Datasets

### 5.1 Decisions

| Thing | What it is | What it does for us | Verdict |
|---|---|---|---|
| **Marqo-FashionSigLIP** | Fashion embedding model, 150M params, Apache-2.0 | Turns every clothing photo into a vector. The foundation of everything. | ✅ **Use now** |
| **Polyvore Outfits** | 68,306 outfits, 250K+ items, with categories and descriptions. CC BY 4.0 | Teaches the general "what goes together" baseline | ✅ **Use now** |
| **Loom** (paper) | Embeddings + explicit rules for small catalogs | Architecture blueprint, not code | ✅ **Copy the approach** |
| FashionCLIP | Older fashion embedding model, MIT | Superseded | ❌ Skip |
| OutfitTransformer | Amazon, CVPRW 2022. Treats an outfit as an unordered set, uses self-attention | Better compatibility scoring once we have real labels | 🟡 **Phase 3** |
| Context-Aware Visual Compatibility | Cucurull, CVPR 2019. Graph neural network using "known compatible neighbors" as context | Needs a dense item graph we won't have | ❌ Skip |

**Links for each:**

| Thing | Weights / data | Code | Paper |
|---|---|---|---|
| Marqo-FashionSigLIP | [HF model card](https://huggingface.co/Marqo/marqo-fashionSigLIP) | [GitHub](https://github.com/marqo-ai/marqo-FashionCLIP) | [Marqo blog + benchmarks](https://www.marqo.ai/blog/search-model-for-fashion) |
| Marqo-FashionCLIP (the CLIP variant) | [HF model card](https://huggingface.co/Marqo/marqo-fashionCLIP) | same repo | [GCL training method](https://github.com/marqo-ai/GCL) |
| Polyvore Outfits | [HF dataset](https://huggingface.co/datasets/mvasil/polyvore-outfits) · [original 6GB download](https://github.com/mvasil/fashion-compatibility) | [GitHub](https://github.com/mvasil/fashion-compatibility) | [arXiv 1803.09196](https://arxiv.org/pdf/1803.09196) |
| Loom | — | not released | [arXiv 2605.09830](https://arxiv.org/pdf/2605.09830) |
| FashionCLIP | [HF model card](https://huggingface.co/patrickjohncyh/fashion-clip) | [GitHub](https://github.com/patrickjohncyh/fashion-clip) | — |
| OutfitTransformer | checkpoints in the impl repo | [owj0421/outfit-transformer](https://github.com/owj0421/outfit-transformer) (unofficial — Amazon never released code) | [CVPRW 2022 PDF](https://openaccess.thecvf.com/content/CVPR2022W/CVFAD/papers/Sarkar_OutfitTransformer_Outfit_Representations_for_Fashion_Recommendation_CVPRW_2022_paper.pdf) · [Amazon Science](https://www.amazon.science/publications/outfit-transformer-outfit-representations-for-fashion-recommendation) |
| Context-Aware Visual Compatibility | — | [gcucurull/visual-compatibility](https://github.com/gcucurull/visual-compatibility) (old TensorFlow) | [CVPR 2019 PDF](https://openaccess.thecvf.com/content_CVPR_2019/papers/Cucurull_Context-Aware_Visual_Compatibility_Prediction_CVPR_2019_paper.pdf) |

### 5.2 Why Marqo-FashionSigLIP over FashionCLIP

Three reasons, in order of importance:

1. **It handles our images better.** FashionCLIP was trained on Farfetch catalog photos — white background, centered, no people — and it admits it is biased toward that format. Our users photograph their own closets: bad lighting, wrinkles, cluttered backgrounds. Marqo's model was trained with Generalised Contrastive Learning on categories, style, colors, materials, keywords and fine details, so it generalizes better.
2. **Cleaner license.** Marqo's models are Apache-2.0. FashionCLIP is MIT, but [its own model card](https://huggingface.co/patrickjohncyh/fashion-clip) says it "was not developed for model deployment" and that researchers need to study it carefully before deploying. That sentence is a problem in any technical due diligence.
3. **Better numbers.** Roughly +57% recall@1 versus FashionCLIP 2.0, with about 10% faster inference. Full numbers on the [Marqo leaderboard](https://github.com/marqo-ai/marqo-FashionCLIP) — they benchmarked across seven public fashion datasets (Atlas, DeepFashion in-shop, DeepFashion multimodal, Fashion200k, iMaterialist, KAGL, Polyvore) and [re-uploaded all of them to Hugging Face](https://github.com/marqo-ai/marqo-FashionCLIP), which saves us data-cleaning work if we ever want to run our own eval.

Note: Marqo has since mentioned a newer `marqo-fashion-SigLIP-2`. As of writing it's gated behind a sales conversation, so **start with the open Apache-2.0 SigLIP model** and only look at v2 if embedding quality turns out to be our bottleneck (it won't be — labeling supply will be).

### 5.3 What Polyvore can and cannot give us

**Can give us:** the general grammar of dressing — which items look right together.

**Cannot give us:**
- What any individual user likes
- Stylist professional judgment
- Fit for occasion, body type, industry, or seniority

So Polyvore solves half of cold start. The other half only comes from our own swipe and stylist data. This is why the event schema matters more than the model choice.

**Two cautions:**

- **Legal.** The [Hugging Face distribution](https://huggingface.co/datasets/mvasil/polyvore-outfits) states CC BY 4.0 with commercial use permitted. But the images were scraped from Polyvore, which [shut down after being acquired by SSense](https://github.com/xthan/polyvore-dataset) — the original image URLs are all dead — and the underlying product photos belong to brands and retailers. The dataset author's license grant does not clearly clear those third-party rights. **Practical line: train and evaluate on it, but never display these images in the app.** Keep only embeddings and weights. This is not legal advice — worth a proper review before fundraising.
- **Taste mismatch.** Polyvore's idea of a good outfit reflects 2016–2018 Polyvore users: collage-heavy, fast-fashion leaning. That is not our client base. **Treat the Polyvore score as a floor that stylist rules override, not as truth.**

### 5.4 No GPU training required

Extract Polyvore embeddings once, then train a small MLP on top. That runs on a laptop CPU in under an hour.

At inference time the wardrobe is a few hundred items, so brute-force scoring of all combinations runs in milliseconds.

### 5.5 Content-based, not collaborative filtering

**Do not build collaborative filtering early.** Two reasons:

- We don't have the user volume for it to work.
- It creates a new-item cold-start problem we otherwise don't have.

With embeddings, a newly uploaded garment can be scored against the user's preference vector immediately. A user can buy something today and see it in recommendations today. With collaborative filtering, that item waits for enough interactions — which in a personal closet basically never arrives.

---

## 6. Trends

### 6.1 Trends never go into model weights

If a trend is baked into weights, updating it requires a retrain, and old trends never leave. Three years from now the model would still quietly favor spring 2026.

Instead: **trends are a separate scoring term with time decay.** Adding, reweighting, or retiring a trend is a database row, not a training run.

Zalando does it the same way — their stylists continuously adjust the algorithm to keep it seasonal, while the learned model stays put.

### 6.2 The useful trick

Because the embedding model aligns images and text, a stylist can describe a trend in one sentence and we get a usable vector instantly:

```python
trend_vec = model.encode_text("oversized blazer with barrel-leg trousers")
trend_score = cosine(outfit_embedding, trend_vec)
```

No images to collect. No training. No labeling. Live the same day.

```
trend_score = Σ_t  w_t(now) × cos(outfit_emb, trend_vec_t)
w_t(now)    = base_weight × decay(now − peak_date)
```

```
trend:
  id, description_text, trend_vec
  category         # color | silhouette | item | styling
  base_weight, status   # emerging | peak | fading | archived
  first_seen, peak_date
  source           # stylist | own_data | paid_feed
  segment_scope[]
  added_by, approved_by
```

Archived trends stay in the table. Fashion is cyclical — when a trend returns, un-archive it.

### 6.3 Where trends come from

**1. Stylist monthly trend brief — do this first.**

Once a month, a stylist fills in 20–40 trends: one sentence each, plus strength, status, and which client segments it applies to. About 30 minutes of work.

This is the most reliable source, because they already do this work, and their judgment is pre-filtered for whether a trend suits our clients. It sits in L1 — instant effect, fully logged, no founder approval needed.

This covers roughly 80% of the need.

**2. Our own data — the real edge, but it takes time.**

After three months we can compute something nobody else can: the monthly trend in acceptance rate per attribute (color, silhouette, category, material) among *our* users. Rising attributes are trends inside our actual client base.

This is more accurate than any purchased feed, because it is our users' real behavior rather than a global average. Once available, it should become the primary source.

**3. Paid trend data — not yet.**

Rough market (approximate, verify before buying):

| Provider | Approx. cost | Approach |
|---|---|---|
| WGSN | ~$25K/year | Industry standard, expert-led, built for 18-month production decisions |
| Fashion Snoops | ~$7,500/year, modular | Culture-led, can buy only the categories you need |
| [Heuritech](https://heuritech.com/) | Enterprise | Analyzes 3M+ social images daily — reads what people actually wear, not what editors predict |
| Trendalytics | Enterprise | 100K+ online sources, strong on viral velocity |

Pricing figures above come from [this 2026 roundup](https://www.gorgeautiful.com/best-fashion-trend-forecasting-tools-2026/) and [this vendor directory](https://simporter.com/top/ai-trend-forecasting/) — both are secondary sources, so treat the numbers as ballpark and get real quotes if we ever buy. Note that several of these vendors advertise accuracy figures (90%+ and similar) with no published methodology behind them. Ignore those claims.

**Buy none of these now.** We don't have the user base for trend precision to pay back, and our stylists already are the trend source. Revisit after a few thousand MAU, starting with a modular option.

### 6.4 Trend affinity must be per-user

**High trend scores can be a penalty for our clients.**

A 45-year-old law firm partner shown something very on-trend will feel misunderstood. A 26-year-old in a creative industry shown classics will be bored.

So add a per-user `trend_affinity` learned from behavior: compare their right-swipe rate on high-trend outfits versus low-trend ones. **For some users this value should be negative** — the system needs to be able to express "show me the classics."

A global trend weight offends both groups at once.

This also handles a fairness concern cleanly. If trend weight is derived from *age*, the system will systematically show older clients more conservative options — which is age stereotyping. If it is **learned from behavior**, the problem disappears.

### 6.5 Trend rules

- Cap trend weight at 15–20% of total score. It is seasoning, not the meal.
- Never auto-scrape TikTok or Instagram to train on. Copyright risk, unstable APIs, and enormous noise. We need 40 good trend labels, not 4 million images.
- Never let an LLM auto-generate trends. It will confidently invent plausible-sounding trends. A human signs off on every trend — that is also what makes it auditable.

---

## 7. Human Oversight & Governance

Mapping the stated requirements to concrete mechanisms:

| Requirement | How we deliver it |
|---|---|
| Stylist reviews recommendations | Stylist swipe queue — approve / reject / edit, same UI as the client app |
| Stylist explains why something works | Required `reason_tags` + free-text `rationale_text` on every stylist action |
| System learns from those decisions | Stylist actions weighted ~10× user swipes in training; rationale text converted into candidate L1 rules for stylist confirmation |
| Ongoing data sources | Swipes, wear logs, stylist edits, wardrobe contents, engagement outcomes |
| Retrain on a schedule | L3 quarterly; L1 and L2 continuous |
| Audit for patterns and bias | Quarterly slice report (below), bundled with the retrain approval |
| Co-Founder approves significant updates | Required for L3 only. L1 and L2 do not need it, so operations are not blocked |

### 7.1 The primary KPI is Stylist Override Rate

Not swipe rate. Not NDCG.

**The percentage of AI recommendations a stylist edits, trending down over time.** If that falls, the model is learning the stylists' professional judgment. It is a number a non-technical founder can understand and hold us to.

### 7.2 Other metrics

**Offline:** stylist agreement rate, fill-in-the-blank accuracy, pairwise AUC.

**Online:** wear rate (of right-swiped outfits, how many were actually worn), up-swipe rate, outfit completion rate.

**Blind test:** periodic AI-vs-stylist double-blind comparison, same as Zalando's man-vs-machine test.

### 7.3 Bias audit

Method: **slice-based evaluation.** Overall metrics can look fine while a subgroup is failing badly. Break results down by age, body type, industry, and seniority. For each slice compute demographic parity difference, equalized opportunity gap, and calibration error, with confidence intervals so we can tell noise from a real gap. Check intersections too, since unfairness often hides where two attributes meet — but sample sizes shrink fast there, so bootstrap.

**The specific risk to watch in our system:** plus-size users being systematically shown more covered or conservative outfits, because both the inspiration data and historical stylist labels skew thin. Build a dedicated slice for this and monitor it every quarter.

More broadly: fashion recommenders tend to strip out context and optimize statistical targets, which quietly reinforces bias around gender, race, body shape, and cultural norms. Watching slices is how we catch that.

**Sources:** [Slice-based fairness testing methodology](https://www.warden-ai.com/resources/ai-fairness-testing-metrics-methods) · [Fairness metrics and confidence intervals in practice](https://galileo.ai/blog/ai-bias-machine-learning-fairness) · [Modeling Bias Evolution in Fashion Recommender Systems](https://arxiv.org/html/2510.21728) — this one is specifically about our domain and worth reading before writing the first audit template · [FairTree: subgroup fairness auditing that works on small samples](https://arxiv.org/pdf/2604.19357) — relevant because our per-slice sample sizes will be tiny in year one

Output: one fixed quarterly report template, delivered as the artifact the Co-Founder reviews when approving an L3 retrain.

---

## 8. The Plan — Three Steps

### Step 1 — Foundation (Weeks 1–4)

**Goal:** working pipeline, correct instrumentation, no ML training.

| Days | Task |
|---|---|
| 1–2 | Load `hf-hub:Marqo/marqo-fashionSigLIP`. Embed every existing wardrobe item. Store in pgvector or SQLite. **Immediate free wins:** similar-item search and natural-language closet search. |
| 3–4 | Download Polyvore Outfits. Extract embeddings. Train a small MLP compatibility scorer. Positives = real outfits, negatives = the dataset's built-in swapped versions. Record baseline numbers on its fill-in-the-blank and compatibility test sets. |
| 5 | Brute-force score all wardrobe combinations. Look at the top 20. **Decision point:** if they don't look wearable, the answer is more rules — not a bigger model. |
| 6–10 | Build swipe UI (four gestures, mandatory reason tags) and the full event schema. |
| 11–15 | Build L1 rule layer + stylist rule editor. Get the first monthly trend brief from the stylists. |
| 16–20 | Stylist review queue. Ship to a small closed beta. |

**Exit criteria:** events logging correctly with `model_version` and `candidate_source`; stylists have entered their first rules and trends; ~50 beta users swiping.

**Must confirm before starting:** how many hours per week the stylists can commit to labeling, and which existing workflow step it attaches to. This determines the whole timeline.

---

### Step 2 — Personalization (Months 2–3)

**Goal:** the product visibly gets better the more you use it.

- Per-user preference model: Bayesian logistic regression or linear Thompson Sampling over reduced embeddings (32–64 dims) plus attribute one-hots. No GPU, no retraining pipeline — parameters live in the user row. Background reading: [Cold-start via contextual bandits](https://arxiv.org/pdf/1405.7544) · [Thompson Sampling for preference elicitation with negative feedback on attributes](https://arxiv.org/pdf/2005.12979) — the second one matters because our left-swipe reason tags *are* attribute-level negative feedback, which is exactly what it models.
- Uncertainty-based onboarding exit instead of a fixed swipe count.
- Exploration budget: 20% of every deck, so the feed doesn't collapse into a bubble.
- Force stylist-curated outfits into the feed as a deliberate bubble-breaker.
- Learn per-user `trend_affinity` from behavior.
- Start the swipe-vs-wear drift analysis using `wear_log`.
- Stand up the first quarterly slice/bias report, even with small samples.

**Exit criteria:** personal score outperforms compatibility-only in an A/B test on wear rate; Stylist Override Rate baseline established.

---

### Step 3 — Compounding (Months 4–6)

**Goal:** stylist expertise becomes a model asset.

- With a few thousand stylist labels, train a pairwise ranker (Bradley-Terry, LambdaMART, or a small two-tower model) using the weighted signal hierarchy.
- Evaluate OutfitTransformer as the compatibility backbone now that real labels exist. The unofficial implementation `owj0421/outfit-transformer` includes CLIP support and downloadable checkpoints.
- Use an LLM to convert stylist `rationale_text` into candidate L1 rules, which stylists confirm before activation. This is the same expert-in-the-loop pattern Stitch Fix uses to distill client notes — LLM efficiency, human final say.
- Begin using our own acceptance-rate data as the primary trend source.
- First formal L3 retrain with the full governance flow: slice report → Co-Founder review → deploy.

**Exit criteria:** Stylist Override Rate measurably down from the Step 2 baseline. That is the proof the whole thesis works.

---

## 9. Risks, Ranked

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Stylist labeling supply too low.** The entire plan rests on this. 20 labels a week means Step 3 never arrives. | Get a concrete weekly time commitment up front. Embed labeling in the existing client-review workflow so it is not extra work. |
| 2 | **Swipe fatigue.** A 100-item closet runs out of fresh combinations in two days. | Mix in external inspiration images and "buy this one piece to unlock 8 more outfits" suggestions. |
| 3 | **Swipe ≠ wear.** Optimizing swipes builds a product nobody wears. | `wear_log` as the calibration anchor. |
| 4 | **Filter bubble / homogenization.** | Fixed 20% exploration budget + forced stylist injections. |
| 5 | **Privacy and compliance.** Body type and age are sensitive under GDPR, and the EU AI Act has transparency requirements for automated decisions involving personal characteristics. | Store these fields separately with separate consent from day one. Ten times cheaper than retrofitting. Get proper legal advice. |

**Do not build now:** graph neural networks, diffusion-based outfit generation, virtual try-on. At our data volume none of these beat embeddings + rules. They only slow iteration.

---

## 10. Summary

The datasets and models are all off-the-shelf, open source, and commercially usable. **Technical risk is close to zero.**

The real risk is entirely in data collection and stylist labeling supply.

So: don't over-deliberate on model choice. Marqo-FashionSigLIP + Polyvore is the current best answer. Lock it in and go build the instrumentation.

---

## Appendix A — All References

### A.1 Read these first (highest value per minute)

1. **[Stitch Fix Algorithms Tour](https://algorithms-tour.stitchfix.com/)** — an interactive walkthrough of their entire system: recommendations, human computation, client-stylist matchmaking, inventory. The single best document on how a human-in-the-loop styling business actually works.
2. **[Stitch Fix — Stylists in the Loop](https://multithreaded.stitchfix.com/blog/2022/09/02/stylists-in-the-loop/)** — why the dataset we need doesn't exist and has to be built with in-house experts.
3. **[Loom (arXiv 2605.09830)](https://arxiv.org/pdf/2605.09830)** — closest published system to ours. Embeddings + explicit rules, small catalogs, brute-force scoring.
4. **[Marqo-FashionSigLIP model card](https://huggingface.co/Marqo/marqo-fashionSigLIP)** — the model we're building on.
5. **[Modeling Bias Evolution in Fashion Recommender Systems](https://arxiv.org/html/2510.21728)** — domain-specific bias reading, needed for the audit template.

### A.2 Models & weights

| Model | Link | License |
|---|---|---|
| Marqo-FashionSigLIP | https://huggingface.co/Marqo/marqo-fashionSigLIP | Apache-2.0 |
| Marqo-FashionCLIP | https://huggingface.co/Marqo/marqo-fashionCLIP | Apache-2.0 |
| Marqo repo + leaderboard | https://github.com/marqo-ai/marqo-FashionCLIP | Apache-2.0 |
| Generalised Contrastive Learning (Marqo's training method) | https://github.com/marqo-ai/GCL | — |
| FashionCLIP | https://huggingface.co/patrickjohncyh/fashion-clip | MIT (with deployment caveat) |
| FashionCLIP repo | https://github.com/patrickjohncyh/fashion-clip | MIT |

### A.3 Datasets

| Dataset | Link | Notes |
|---|---|---|
| Polyvore Outfits (HF) | https://huggingface.co/datasets/mvasil/polyvore-outfits | CC BY 4.0 stated; see §5.3 caution |
| Polyvore Outfits (original) | https://github.com/mvasil/fashion-compatibility | 6GB, includes compatibility + FITB splits |
| Maryland Polyvore | https://github.com/xthan/polyvore-dataset | 21,889 outfits. Smaller, only for reproducing older papers |
| Marqo's seven benchmark datasets | https://github.com/marqo-ai/marqo-FashionCLIP | Atlas, DeepFashion ×2, Fashion200k, iMaterialist, KAGL, Polyvore |

### A.4 Papers — compatibility & outfit modeling

| Paper | Link | Code |
|---|---|---|
| Learning Type-Aware Embeddings for Fashion Compatibility (ECCV 2018) | https://arxiv.org/pdf/1803.09196 | https://github.com/mvasil/fashion-compatibility |
| OutfitTransformer (CVPRW 2022) | https://openaccess.thecvf.com/content/CVPR2022W/CVFAD/papers/Sarkar_OutfitTransformer_Outfit_Representations_for_Fashion_Recommendation_CVPRW_2022_paper.pdf | https://github.com/owj0421/outfit-transformer (unofficial) |
| Context-Aware Visual Compatibility Prediction (CVPR 2019) | https://openaccess.thecvf.com/content_CVPR_2019/papers/Cucurull_Context-Aware_Visual_Compatibility_Prediction_CVPR_2019_paper.pdf | https://github.com/gcucurull/visual-compatibility |
| Learning Fashion Compatibility with Bidirectional LSTMs (ACM MM 2017) | https://arxiv.org/pdf/1707.05691 | https://github.com/xthan/polyvore |
| CSA-Net: Fashion Outfit Complementary Item Retrieval (CVPR 2020) | — | https://github.com/owj0421/csa-net (unofficial) |
| Loom: Hybrid Retrieval-Scoring Outfit Recommendation (2026) | https://arxiv.org/pdf/2605.09830 | — |
| Fashion Meets Computer Vision: A Survey | https://arxiv.org/pdf/2003.13988 | — |
| Hybrid-Hierarchical Fashion Graph Attention Network (FGAT) | https://www.sciencedirect.com/science/article/pii/S2666827025001859 | — |
| Dress Well via Fashion Cognitive Learning (body-aware compatibility) | https://arxiv.org/pdf/2208.00639 | — |

The last two are for later reference only — both are graph/GNN approaches we decided against for now. The body-aware paper (O4U dataset, personal physical attributes) becomes relevant if we ever want a fit-aware model instead of handling fit through L1 rules.

### A.5 Papers — cold start, bandits, preference learning

| Paper | Link |
|---|---|
| Cold-start Problems in Recommendation Systems via Contextual-bandit Algorithms | https://arxiv.org/pdf/1405.7544 |
| Seamlessly Unifying Attributes and Items: Conversational Recommendation for Cold-Start Users | https://arxiv.org/pdf/2005.12979 |

### A.6 Fairness & auditing

| Resource | Link |
|---|---|
| Modeling Bias Evolution in Fashion Recommender Systems | https://arxiv.org/html/2510.21728 |
| FairTree: subgroup fairness auditing with bias-variance decomposition | https://arxiv.org/pdf/2604.19357 |
| AI fairness testing: metrics & methods (slice-based evaluation) | https://www.warden-ai.com/resources/ai-fairness-testing-metrics-methods |
| Fairness metrics with confidence intervals in practice | https://galileo.ai/blog/ai-bias-machine-learning-fairness |

### A.7 Industry practice

**Stitch Fix**
- Algorithms Tour: https://algorithms-tour.stitchfix.com/
- Stylists in the Loop: https://multithreaded.stitchfix.com/blog/2022/09/02/stylists-in-the-loop/
- Expert-in-the-loop with generative AI: https://newsroom.stitchfix.com/blog/how-were-revolutionizing-personal-styling-with-generative-ai/
- Algorithms blog index: https://multithreaded.stitchfix.com/algorithms/blog/
- 2025 human-in-the-loop interview: https://www.uschamber.com/co/good-company/the-leap/stitch-fix-optimizing-with-ai
- Lessons on ML with humans in the loop: https://medium.com/kaizen-data/machine-learning-with-humans-in-the-loop-lessons-from-stitchfix-300672904f80

**Zalando**
- How AFC works: https://corporate.zalando.com/en/company/how-zalando-helps-customers-make-perfect-fashion-choices
- Blind test, human vs algorithm: https://www.retaildetail.eu/news/fashion/zalando-lets-computer-give-you-fashion-advice/
- VP interview on why stylists stay: https://fashionunited.uk/news/fashion/ai-in-fashion-interview-with-vp-of-inspire-and-engage-at-zalando/2019080944674
- Launch coverage: https://internetretailing.net/zalando-launches-virtual-stylist-based-on-machine-learning-18618/
- Third-party benchmark against AFC: https://www.intelistyle.com/intelistyles-ai-stylist-outperforms-zalando/

**Tinder / swipe mechanics**
- TinVec and the Elo transition: https://www.swipestats.io/blog/tinder-algorithm
- Behavioral signals dating apps track: https://blog.photofeeler.com/dating-app-algorithms/

**Competitor wardrobe apps**
- https://getwardrobe.com/compare/
- https://portal-f4u.com/best-ai-stylist-apps/
- https://vestatheapp.com/blog/vesta-vs-indyx-whering-acloset
- https://aurelle.app/blog/best-ai-wardrobe-apps-2026
- https://play.google.com/store/apps/details?id=com.indyx.android

**Trend forecasting vendors**
- Heuritech: https://heuritech.com/
- 2026 tool roundup with pricing: https://www.gorgeautiful.com/best-fashion-trend-forecasting-tools-2026/
- Vendor directory: https://simporter.com/top/ai-trend-forecasting/

### A.8 Source quality — read this before quoting anything externally

Sources in this document fall into three tiers. Know which you're citing.

**Tier 1 — primary, safe to quote.** Peer-reviewed papers, official model cards, company engineering blogs and newsrooms (Stitch Fix Multithreaded, Zalando corporate), Hugging Face dataset cards. Everything in A.2–A.6 plus the Stitch Fix and Zalando links.

**Tier 2 — trade press.** RetailDetail, FashionUnited, InternetRetailing. Generally reliable on facts and figures, but they're reporting on company press releases, so the framing is the company's.

**Tier 3 — marketing content dressed as analysis.** The wardrobe-app comparisons, the trend-tool roundups, the Tinder algorithm write-ups, the vendor benchmarks. Useful for discovering what exists and rough pricing. **Do not put their numbers in a pitch deck or a document for Delia without independent verification.** Specific things to distrust: user counts, accuracy percentages with no published method, and any comparison written by a company that appears in its own table.

Two claims in this plan that deserve a flag because they rest on Tier 3 sourcing:
- Trend vendor pricing (§6.3) — ballpark only
- Tinder's internal mechanics (§2.3) — reconstructed, never officially published

The strategic conclusions we drew from those two don't depend on the exact numbers, but say "roughly" if you repeat them out loud.
