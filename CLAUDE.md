# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server
npm run build      # Production build
npm run preview    # Preview production build locally

node scripts/fetch-data.js   # Re-fetch armor/monster/charm/weapon data from wilds.mhdb.io API
node scripts/add-sharpness.mjs  # One-off: merge sharpness/handicraft into weapons.json (single API call, id-matched)
node scripts/add-weapon-status.mjs  # One-off: add status ailment (poison/paralysis/sleep/blastblight) to weapon specials (single API call, id-matched)
node merge-pendants.cjs       # Merge new pendant entries into src/data/pendants.json
node scripts/debug-data.js    # Quick sanity-check on material-index.json

node scripts/verify-farming.mjs  # Headless E2E suite for the farming list (needs `npm run build`
                                 # + `npm run preview -- --port 4173` running, and playwright-core;
                                 # see the farming-list section of implementation-plan.md)
```

> **Not in the repo.** `scripts/` and `implementation-plan.md` are gitignored, so a fresh clone has
> neither the commands above nor the design history. They exist only in the primary working copy — if
> you can't see them, you're working from the clone, and the verification suite is unavailable to you.
> Say so rather than assuming the checks pass.

There are no unit tests or linting configs — this is a vanilla JS project. The farming-list drawer has the headless verification suite above (193 checks covering goal pinning, subsumption, profiles, migration, drawer polish, card structure, the reference panel, and the mobile/touch pass).

## Task backlog — keep it current

The list of open work is **not in this repo**. It lives as a private Claude artifact titled
**"Wilds Planner Backlog"**, so that it can be read from a phone without a checkout. Its URL is
deliberately not recorded here (this repo is public); recover it with the Artifact tool's
`action: "list"`, or ask the user for the link.

**Update it in the same session that changes what's open** — when an item ships, when something is
newly deferred, or when a trigger condition is met. A backlog that lags the code is worse than none,
because the next session starts from it cold and trusts it.

- Update in place by passing the recovered URL as `url`. Publishing **without** `url` from a session
  that didn't originally create it silently makes a *second* artifact instead of updating this one.
- The page has two halves that must stay in sync: the prose items, and the plain-text **Briefing**
  block at the bottom that gets pasted into cold chats. Editing only one leaves them contradicting.
- In the primary working copy, `implementation-plan.md` is the plan of record and its "Next Actions"
  section must be updated too. A clone won't have that file — say the plan doc still needs updating
  rather than assuming it's done.

## Architecture

**Stack:** Vanilla JS ES modules + Vite for bundling, Fuse.js for fuzzy search. No framework.

**Data flow (one-directional):**
```
JSON files → initSearch() → Fuse.js index
User input → performSearch() → search.js → ui.js → innerHTML
```

**Module responsibilities:**
- `src/main.js` — app state (`allSets`, rank/type/weapon-kind filters, `currentSort`), event wiring, `performSearch()` orchestration, stat-sort logic
- `src/search.js` — wraps Fuse.js; indexes gear names, piece/charm/weapon **skill names**, and material names; attaches `_matchedSkill` to results whose only match was a skill (drives the "🔎 matched" hint chips)
- `src/ui.js` — pure DOM rendering via template literals + `innerHTML`; attaches event listeners after each render via `attachCardListeners()`; centralizes farming-goal construction in `build*Goal()` functions; handles material chip click → source popup
- `src/farming-list.js` — right drawer: build profiles → gear goals → derived hunt plan; localStorage-backed (see implementation-plan.md Phases 5–6)
- `src/reference-panel.js` — left drawer: searchable skill dictionary (from `skills.json`) with "find gear" cross-link into search, plus the quest-badge legend
- `src/icons.js` — shared slot-icon helpers (exists so `farming-list.js` never imports `ui.js`, which imports it — circular)
- `src/quest-lookup.js` — builds two reverse indexes at module load time: `targetToQuests` (monster name → quests) and `exclusiveItemToQuests` (reward item → quests); called from `ui.js` when rendering material source popups

**Panel coordination:** the two side panels squeeze the page via `body.farming-open` / `body.ref-open` padding; under 1100px opening one closes the other, coordinated by the `mhws:panel-open` CustomEvent (no cross-imports).

**Data files (`src/data/`):**

Auto-generated (overwritten by `fetch-data.js` — do not edit manually):
- `armor-sets.json` — armor sets with pieces, skills, crafting materials, defense/resistance stats
- `charms.json` — craftable charms with skills and materials
- `material-index.json` — reverse lookup: `{ "Gore Magala Scale+": [{ monsterName, drops: [{kind, chance, quantity}] }] }`

Manually curated (edit directly):
- `gathering-sources.json` — non-monster material sources (gathering nodes, small monsters); keyed by material name
- `pendants.json` — cosmetic weapon pendants with acquisition method in `quest` field
- `quests.json` — event/repeatable quests with `targets` (monster names) and `rewardItems` (exclusive drops); used by `quest-lookup.js`

**Data pipeline (`scripts/fetch-data.js`):** Fetches from `https://wilds.mhdb.io/en` (community API). Produces `armor-sets.json`, `charms.json`, and `material-index.json`. Uses 1-second delays between requests to be polite to the community API.

**Material source popup flow:** Clicking a `.material-chip` calls `renderMaterialSource(name)` in `ui.js`, which queries `materialIndex` (monster drops), `gatheringSources` (gathering), and `findQuestsForMaterial()` (quest recommendations). Quest priority order: exclusive reward > single-target optional > event > multi-target optional > assignment.

**`merge-pendants.cjs`:** One-off utility for merging a hardcoded list of new pendants into `pendants.json`, deduplicating by normalized name. Run when adding new pendant data.
