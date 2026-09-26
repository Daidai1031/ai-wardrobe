# AI Wardrobe — Design Tokens & Shape Rules

Confirmed visual direction, matched from the brand's own site (thestylethatbindsus.com) and refined against the `/home` screen. This is the source of truth for restyling the app — every value here is a decision, not a placeholder, and every rule has a stated reason so it doesn't get silently violated later.

---

## Color

| Token | Value | Usage |
|---|---|---|
| `surface-100` | `#FFFFFF` | Page background. Pure white — matches how the brand site actually reads at full-page scale. |
| `surface-200` | `#F5F2F0` | Card/panel surfaces only. A warm lift off white, matched from the brand site's background swash. **Never used as the page background** — it's a decorative accent color on the real site, not the dominant ground; stretching it edge-to-edge reads muddy instead of quiet. |
| `ink` | `#0A0A0A` | Primary text, primary icon fills, primary borders. The brand's true black logo/nav color. |
| `ink-muted` | `#707070` | Secondary text — metadata, timestamps, helper copy, the weather readout. |
| `ink-inverse` | `#F5F2F0` | Text/icons on `ink`- or `accent`-filled surfaces. |
| `accent` | `#D96826` | The brand's apricot-orange, deepened to carry white text at button contrast. **Reserved for the single primary action on a screen** — see Shape rules. Not used for secondary buttons, tags, or decoration. |
| `accent-soft` | `#F7EEE8` | Large, low-emphasis fills only (e.g. a selected filter's background). **Never on small tags/badges/flags** — a pastel tint on a small label reads cheap; small informational elements use a solid color or no fill at all instead. |
| `border` | `#DBD8D6` | Dividers and card outlines — decorative only. Interactive control borders (inputs, focus states) use `ink` or `accent` instead, to keep 3:1 contrast. |

There is deliberately **no dedicated "success" color**. A resolved/confirmed state (e.g. a saved outfit) is shown as an ink-outlined element, not a new hue — a second saturated color reads as generic SaaS against a one-accent-color brand, and "already decided for you" is a calm state, not a celebratory one. It shouldn't visually compete with `accent`, which is reserved for the one thing that still needs the user's attention.

---

## Typography

Two families only:

```
serif: "Alex Brush", cursive   — every heading (h1–h3, plus font-serif / font-display); single 400 weight, no synthesized bold. Was Ibarra Real Nova.
sans:  "EB Garamond", Georgia, serif   — everything else (a serif under the `sans` key; body sets font-size-adjust 0.46 to offset its small x-height). Was Public Sans.
```

**Rule: serif is a headline device, not a body face.** If serif shows up more than once per screen, that's a sign the screen is trying to say two things at once — split it instead.

| Style | Family | Size / Line-height | Weight | Tracking | Usage |
|---|---|---|---|---|---|
| `display` | serif | 30px / 36px | 600 | 0.005em | Page-level greeting — "Good morning, Victoria". Once per screen, at most. |
| `heading` | serif | 22px / 28px | 600 | 0.005em | Section titles — "Today's plan". Sparingly. |
| `subheading` | sans | 16px / 22px | **600 (Semibold)** | 0em | Segment/item titles — "Morning Golf". Confirmed at Semibold, not Bold — Bold read heavier/clunkier next to the serif greeting at comparable size. |
| `body` | sans | 14px / 21px | 400 | — | AI reasoning text, descriptions. Line-height confirmed generous (~1.5×) for comfortable reading of longer generated copy. |
| `body-small` | sans | 12px / 19px | 400 | — | Item metadata lists, in `ink-muted`. |
| `label` | sans | 11.5px / 15px | 700 | 0.04em | Uppercase eyebrows — "SEGMENT 1", category tags. |
| `button` | sans | 14px / 20px | 600 | — | All button/link labels. |

---

## Spacing

4px-rooted scale:

| Token | Value | Usage |
|---|---|---|
| `space-1` | 4px | Micro gaps — icon to label. |
| `space-2` | 8px | Tight stacks. **Also the fixed padding the card-nesting formula uses** (see Radius) — don't rescale this one independently of that formula. |
| `space-3` | 14px | Default gap between related elements. |
| `space-4` | 21px | Card padding; gap between a card's sections. |
| `space-5` | 34px | Gap between unrelated blocks — between segments, between page header and content. |

(`space-3/4/5` were confirmed ~14% tighter than a first pass that felt loose in the full-page preview.)

---

## Radius — tiered by role, not applied uniformly

| Tier | Token | Value | Used for |
|---|---|---|---|
| Non-tappable info | *(no radius — no box at all)* | — | Purely informational, non-interactive text (e.g. the weather readout). A box of any shape implies tappability; this has none. |
| Functional, secondary | `radius-none` | 0px | Filter chips, informational tags/flags, inputs. Matches the brand site's own zero-rounding nav/body UI. |
| Nested content | `radius-sm` | 8px | An image nested inside a card. **Derived, not set directly** — see formula below. |
| Containers | `radius-md` | 16px | Closet-item cards, the outfit canvas frame. |
| Large surfaces | `radius-lg` | 24px | Modals, sheets, drawers (reserved — none built yet). |
| **Primary tap targets** | `radius-full` | 9999px | **Deliberate and reserved**: circular elements (avatars, a lone icon-only round button) **and** the page's primary tappable actions — the Save/Saved state pill, the main Confirm CTA. Because every other shape in the system is sharp, a pill reads as an unmistakable "tap me" signal precisely by being the one rounded thing on screen. NOT used for filter chips or informational tags. |

**Nesting formula:** when a rounded element sits inside another rounded container, `outer radius = inner radius + padding` keeps the curves concentric (reuse the same value on both and the gap looks uneven — wider on the sides, pinched at the corners). Applied to the closet-item/segment image: `radius-md (16px) − space-2 (8px) = 8px`, which is exactly `radius-sm`. Not a coincidence — the padding was chosen to land on a real token.

---

## Confirmed component treatments (`/home`)

These are the actual resolved decisions from working through the `/home` screen — apply the same logic to other screens rather than copying the literal markup.

**Weather / date readout** — plain text, `ink-muted`, no background, no border. Purely informational; must not look tappable.

**Segment status pill (Save / Saved)** — `radius-full`. No orange:
- `Save` (needs action): solid `ink` fill, `ink-inverse` text.
- `Saved` (resolved): transparent fill, 1px `ink` border, `ink` text, prefixed with a checkmark (`✓`) so the state doesn't rely on color alone (accessibility — color-blind users can't distinguish fill vs. no-fill by hue).

**Main Confirm CTA** ("Confirm worn today") — `radius-full`, solid `accent` fill, `ink-inverse` text. This and the small dot below are the **only two places `accent` appears as a filled color on the whole screen** — that scarcity is intentional and should hold on other screens too: pick one primary action per screen for `accent`, not one per component.

**"Change: complete outfit swap" flag** — no background, no border, no radius. A 6px solid `accent` dot + text in `ink-muted`, weight 500, tracking 0.03em, uppercase. Replaced an earlier pastel `accent-soft` badge, which read cheap.

**Card container** (closet item / segment image) — `surface-200` background, `radius-md`, soft shadow (`0 1px 2px rgba(10,10,10,.05), 0 8px 20px rgba(10,10,10,.08)`), no border. Nested image uses `radius-sm` per the formula above.

**Section heading marks** (`From your stylist` / `Today's plan` / `Style swipe`) — these three used to share the same lucide `Sparkles` icon, indistinguishable at a glance. Replaced with `src/components/icons/section-marks.tsx`: flat `currentColor` solid-block SVG glyphs, no stroke, no radius, `text-ink-muted` like the icons they replace — shape carries the distinction since color doesn't. Two stacked blocks (`PlanMark`) for a day split into segments, two offset blocks (`SwipeMark`) for a stack to swipe through, a chip-framed avatar silhouette (`StylistMark`) — head + shoulders clipped inside a soft circular frame — for the one human-authored surface in the product.

**Filter chips** (e.g. Closet category filters) — not yet finalized on their own screen; until revisited, follow the general rule: `radius-none`, solid colors only (no pastel tints), consistent with the informational-tag treatment above.

**Segment action row** (regenerate / Use saved / Adjust on `/home`) — all three controls are now `radius-full`: regenerate as a fixed `h-8 w-8` circle (icon-only, per the Radius rule), Use saved and Adjust as pills (`px-3 py-1.5`) sized to match. Borderless for now — regenerate and Use saved are plain `text-ink-muted` → `hover:text-ink`, no `border-border` frame — pending a decision on whether this row needs the same bordered-secondary treatment as the swipe deck's gesture buttons (`swipe-deck.tsx`) or reads better unframed next to Adjust's solid fill.

---

## Desktop shell (`lg` and up)

- **Sidebar**: the card tone (`surface-200`), no edge line; its inner dividers use `border`. The page stays white.
- **Content is left-anchored, not centred**: it starts 40px after the sidebar and is at most 1120px wide, so the spare width falls on the right, where the Mailbox tab lives. Centred in the space beside the sidebar it sat ~110px right of the screen's centre and read right-heavy.
- **Home cards** (Today's plan, Style swipe): white with a hairline `border`, no shadow. Below `lg` they keep the warm card with a shadow.

---

## Mobile layout (below `lg`, 1024px)

Desktop is unchanged by all of this: every rule is written as a base class or `max-lg:` / `max-sm:` and `sm:`/`lg:` restores the desktop value.

- **Gutter: 16px** each side, set once by the dashboard layout (`p-4 lg:p-8`). Nothing inside a page adds its own outer margin, and nothing may be wider than the screen — the document must never scroll sideways.
- **Cards: 16px inner padding** on a phone (`p-4 sm:p-6`). Card padding on top of the gutter was what pushed content 40px in from the screen edge.
- **Scrollers bleed to the screen edge** (`max-lg:-mx-4 max-lg:px-4`, scrollbar hidden): a horizontally scrolling row (closet categories, the week / trip day strips, profile tabs) starts on the gutter but runs off the glass, which reads as "more this way"; clipped at the gutter it reads as cut off.
- **Rows that don't fit wrap or stack** rather than shrink: page headers and filter rows `flex-wrap`, a segment's title takes the full width with its actions underneath, and three-across form fields become two.
- **Navigation**: bottom tab bar, a floating full-width white pill with a hairline border and soft shadow, the current page a black capsule with light text (Home, Plan, Closet, Outfits — names only); the top bar takes the card tone (`surface-200`, no border); Travel lives under Plan, and the user avatar is in the top bar beside the logo, opening a dropdown (Profile, Sign out). The floating mailbox is a slim black tab with "MAIL" set sideways, docked on the right edge, about 40% down the screen, sliding vertically only (the same tab on desktop); a dragged position is remembered separately for phone and desktop.

---

## What NOT to do

- Don't add a new color for a new state. Reuse `ink` (neutral/resolved) or `accent` (needs attention) — differentiate with fill vs. outline, not hue.
- Don't use `accent-soft` on anything smaller than a large fill area.
- Don't round a chip, tag, or input — `radius-full` is reserved for the primary tap target(s) only.
- Don't let `surface-200` (the greige) become a full-page background.
- Don't use Bold (700) on `subheading` — confirmed Semibold (600).
