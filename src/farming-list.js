/**
 * Farming List (v2 — goal-based, multi-profile)
 *
 * The list tracks *goals* (gear you want to build), not raw materials. The
 * material shopping list is *derived* by aggregating every goal's materials.
 * This keeps provenance ("this carapace is for the Gore helm"), per-goal
 * progress, and clean completion semantics — remove a goal and its materials
 * fall out of the plan automatically.
 *
 * Storage (localStorage key `mhwilds-farming-list`), version 2:
 *   { version, activeProfile, profiles: [
 *       { id, name, goals: [{ id, type, name, sourceId, meta, materials:[{name,qty}] }],
 *         checked: { <materialName>: true } } ] }
 *
 * A v1 flat array `[{name,qty,done}]` migrates into a single "Default" profile
 * whose `custom` goal holds the old entries.
 *
 * Two drawer tabs:
 *   - Hunt Plan: derived materials grouped by best source monster (greedy set
 *     cover), each row tagged with the goal(s) that need it.
 *   - Gear: one card per goal with a progress bar and snapshotted stats.
 */

import { findQuestsForMonster, getQuestBadgeInfo } from './quest-lookup.js';
import { slotIcons } from './icons.js';
import { showSkill } from './reference-panel.js';
import gatheringSources from './data/gathering-sources.json';
import skillsData from './data/skills.json';

const STORAGE_KEY = 'mhwilds-farming-list';
const CUSTOM_GOAL_NAME = 'Pinned materials';

let state = null; // { version, activeProfile, profiles: [...] }
let activeTab = 'plan'; // 'plan' | 'gear'
let hideFarmed = false; // Hunt Plan filter; session-only on purpose
let profileAction = null; // 'new' | 'rename' | 'duplicate' | 'delete' while the inline form is open
let disarmClearAll = () => {}; // real impl assigned in init; see commit()
let materialIndex = {};

let panelEl = null;
let bodyEl = null;
let countEl = null;
let toggleBtn = null;
let profileSelectEl = null;
let profileMenuEl = null;
let profileFormEl = null;
let tabCountEl = null;

// Same labels as formatKind in ui.js — duplicated to avoid a circular import
const KIND_LABELS = {
  'carve': 'Carve',
  'carve-rotten': 'Rotten Carve (field carcass)',
  'target-reward': 'Target Reward',
  'broken-part': 'Break Part',
  'wound-destroyed': 'Wound Part',
  'palico-gathering': 'Palico',
  'capture': 'Capture',
  'dropped-material': 'Dropped'
};

// ---- State helpers ----
function genId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function activeProfile() {
  return state.profiles.find(p => p.id === state.activeProfile) || state.profiles[0];
}

function goalsOf() {
  return activeProfile().goals;
}

function checkedOf() {
  return activeProfile().checked;
}

// A material-less goal (a pendant acquisition): it has nothing to farm, so it's
// absent from the Hunt Plan and tracks done/not-done by its own id in `checked`.
function isAcquisitionGoal(g) {
  return g.type === 'pendant' && g.materials.length === 0;
}

// Toggle a batch of material names together: if all are already checked, clear
// them; otherwise mark them all. Used by the goal / group "complete" controls.
function setChecked(names) {
  if (!names.length) return;
  const checked = checkedOf();
  const allDone = names.every(n => checked[n]);
  for (const n of names) {
    if (allDone) delete checked[n];
    else checked[n] = true;
  }
  commit();
}

function customGoal(create = false) {
  let g = goalsOf().find(x => x.type === 'custom');
  if (!g && create) {
    g = { id: 'custom', type: 'custom', name: CUSTOM_GOAL_NAME, sourceId: null, meta: null, materials: [] };
    goalsOf().push(g);
  }
  return g;
}

function freshProfile(name = 'Default') {
  return { id: genId(), name, goals: [], checked: {} };
}

// ---- Persistence ----
function loadState() {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    raw = null;
  }

  // v1 → v2 migration: a flat array becomes one "Default" profile
  if (Array.isArray(raw)) {
    const entries = raw.filter(e => e && typeof e.name === 'string' && typeof e.qty === 'number');
    const checked = {};
    for (const e of entries) if (e.done) checked[e.name] = true;
    const profile = freshProfile('Default');
    if (entries.length) {
      profile.goals.push({
        id: 'custom', type: 'custom', name: CUSTOM_GOAL_NAME, sourceId: null, meta: null,
        materials: entries.map(e => ({ name: e.name, qty: e.qty })),
      });
    }
    profile.checked = checked;
    state = { version: 2, activeProfile: profile.id, profiles: [profile] };
    return;
  }

  // v2 — normalize each profile so a hand-edited or partially-written payload
  // (missing goals/checked, junk entries) can't crash on first use.
  if (raw && raw.version === 2 && Array.isArray(raw.profiles)) {
    const profiles = raw.profiles
      .filter(p => p && typeof p === 'object')
      .map((p, i) => ({
        id: typeof p.id === 'string' ? p.id : genId(),
        name: typeof p.name === 'string' && p.name ? p.name : `Build ${i + 1}`,
        goals: (Array.isArray(p.goals) ? p.goals : [])
          .filter(g => g && typeof g === 'object' && Array.isArray(g.materials)),
        checked: (p.checked && typeof p.checked === 'object' && !Array.isArray(p.checked)) ? p.checked : {},
      }));
    if (profiles.length) {
      // gearSort is a global view preference (validated by gearSort()); carry it
      // forward so it survives the next save().
      state = { version: 2, activeProfile: raw.activeProfile, profiles, gearSort: raw.gearSort };
      if (!activeProfile()) state.activeProfile = profiles[0].id;
      return;
    }
  }

  // fresh
  const profile = freshProfile('Default');
  state = { version: 2, activeProfile: profile.id, profiles: [profile] };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---- Public API (called from ui.js) ----
// Ad-hoc single material → the active profile's custom goal.
export function addMaterial(name, qty = 1) {
  const g = customGoal(true);
  const existing = g.materials.find(m => m.name === name);
  if (existing) existing.qty += qty;
  else g.materials.push({ name, qty });
  commit({ pulse: true });
}

// Mutate the active profile for one goal, without committing (so batch pins
// commit once). Re-pinning the same id refreshes it; `replaces` unpins the
// mutually exclusive alternative (a weapon tier's Forge vs Upgrade path).
function upsertGoal(goal) {
  if (!goal || !goal.id || !Array.isArray(goal.materials)) return;
  // Gear must carry materials to be pinnable — except pendants, which are
  // acquisition goals (quest/counter rewards, usually no crafting materials).
  if (!goal.materials.length && goal.type !== 'pendant') return;
  const profile = activeProfile();
  if (goal.replaces) profile.goals = profile.goals.filter(g => g.id !== goal.replaces);
  const goals = profile.goals;
  const normalized = {
    id: goal.id,
    type: goal.type || 'custom',
    name: goal.name || 'Goal',
    sourceId: goal.sourceId ?? null,
    meta: goal.meta || null,
    materials: goal.materials.map(m => ({ name: m.name, qty: m.qty })),
  };
  const idx = goals.findIndex(g => g.id === goal.id);
  if (idx >= 0) goals[idx] = normalized;
  else goals.push(normalized);
}

// A whole piece of gear → one goal.
export function addGoal(goal) {
  upsertGoal(goal);
  commit({ pulse: true });
}

// Several goals at once (e.g. "pin this tier + every higher one") → one commit.
export function addGoals(goalList) {
  if (!Array.isArray(goalList) || !goalList.length) return;
  for (const g of goalList) upsertGoal(g);
  commit({ pulse: true });
}

function commit({ pulse = false } = {}) {
  disarmClearAll(); // any state change invalidates an armed "Really clear?" — it may target a different profile now
  pruneChecked();
  save();
  updateBadge();
  if (panelEl?.classList.contains('open')) renderPanel();
  if (pulse) pulseToggle();
}

// Drop checked entries for materials no longer pinned anywhere in the active
// profile — otherwise a material removed and later re-pinned would come back
// already marked as farmed.
function pruneChecked() {
  const checked = checkedOf();
  const names = new Set();
  for (const g of goalsOf()) {
    if (isAcquisitionGoal(g)) names.add(g.id); // acquisition goals track done by id
    for (const m of g.materials) names.add(m.name);
  }
  for (const k of Object.keys(checked)) if (!names.has(k)) delete checked[k];
}

// A goal is subsumed when its parent (the set an armor piece belongs to, or the
// upgrade chain a weapon tier is part of) is also pinned — the parent already
// carries its materials and stats, so the child is skipped during aggregation
// to avoid double-counting quantities, defense, and skills.
function subsumedBy(goal) {
  const pid = goal.meta?.parent;
  return pid ? goalsOf().find(g => g.id === pid) || null : null;
}

// When several tiers of the same weapon chain are pinned individually, only the
// highest is actually equippable — its lower tiers still cost materials (they
// stay in the hunt plan and total zenny) but must NOT stack their defense and
// skills onto the Build Summary. Returns true for every pinned tier except the
// top one in its chain. (Craft/Upgrade of the same tier can't coexist —
// `replaces` prevents it — so tierIndex values within a chain are distinct.)
function isLowerWeaponTier(goal) {
  if (goal.type !== 'weapon') return false;
  const chain = goal.meta?.parent;
  const idx = goal.meta?.tierIndex;
  if (chain == null || idx == null) return false; // pre-tierIndex goal: keep old behavior
  return goalsOf().some(o =>
    o !== goal && o.type === 'weapon' &&
    o.meta?.parent === chain && (o.meta?.tierIndex ?? -1) > idx);
}

// ---- Derived material aggregation (across all goals) ----
function aggregate() {
  const map = new Map(); // name -> { name, qty, sources: [goalName] }
  for (const g of goalsOf()) {
    if (subsumedBy(g)) continue;
    for (const m of g.materials) {
      let e = map.get(m.name);
      if (!e) { e = { name: m.name, qty: 0, sources: [] }; map.set(m.name, e); }
      e.qty += m.qty;
      if (!e.sources.includes(g.name)) e.sources.push(g.name);
    }
  }
  return [...map.values()];
}

// ---- Hunt plan grouping ----
// Assign each material to the source monster that covers the most pinned
// materials overall (greedy set cover), so the plan suggests fewer hunts.
function buildHuntPlan(materials) {
  const coverage = new Map();
  for (const item of materials) {
    for (const src of materialIndex[item.name] || []) {
      coverage.set(src.monsterName, (coverage.get(src.monsterName) || 0) + 1);
    }
  }

  const monsterGroups = new Map();
  const gathering = [];
  const unknown = [];

  for (const item of materials) {
    const sources = materialIndex[item.name] || [];
    if (sources.length > 0) {
      let best = sources[0].monsterName;
      for (const s of sources) {
        if ((coverage.get(s.monsterName) || 0) > (coverage.get(best) || 0)) best = s.monsterName;
      }
      if (!monsterGroups.has(best)) monsterGroups.set(best, []);
      monsterGroups.get(best).push(item);
    } else if ((gatheringSources[item.name] || []).length > 0) {
      gathering.push(item);
    } else {
      unknown.push(item);
    }
  }

  const groups = [...monsterGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([monster, items]) => ({ kind: 'monster', title: monster, items }));
  if (gathering.length) groups.push({ kind: 'gathering', title: 'Gathering & Other', items: gathering });
  if (unknown.length) groups.push({ kind: 'unknown', title: 'Unknown Source', items: unknown });
  return groups;
}

// ---- Rendering ----
function isEmpty() {
  return goalsOf().every(g => g.materials.length === 0 && !isAcquisitionGoal(g));
}

function renderPanel() {
  renderProfileSelect();
  updateTabCount();
  syncTabButtons();

  // Re-rendering replaces the whole body, which drops keyboard focus; remember
  // which control was focused so we can put focus back on its replacement.
  const ae = document.activeElement;
  const refocus = ae && bodyEl.contains(ae) && ae.dataset.action
    ? { action: ae.dataset.action, name: ae.dataset.name, goalId: ae.dataset.goalId }
    : null;

  if (isEmpty()) {
    bodyEl.innerHTML = `
      <div class="farming-empty">
        <p>This build's farming list is empty.</p>
        <p>Click <strong>📌</strong> on any gear card, weapon tier, or set summary to pin the whole thing — or the <span class="chip-pin chip-pin-demo">+</span> on a single material chip.</p>
      </div>
    `;
    return;
  }

  bodyEl.innerHTML = activeTab === 'gear' ? renderGearTab() : renderPlanTab();

  if (refocus) {
    let sel = `[data-action="${refocus.action}"]`;
    if (refocus.name) sel += `[data-name="${CSS.escape(refocus.name)}"]`;
    if (refocus.goalId) sel += `[data-goal-id="${CSS.escape(refocus.goalId)}"]`;
    bodyEl.querySelector(sel)?.focus({ preventScroll: true });
  }
}

// ── Hunt Plan tab ──
function renderPlanTab() {
  const all = aggregate();
  const checked = checkedOf();
  const doneCount = all.filter(m => checked[m.name]).length;
  const materials = hideFarmed ? all.filter(m => !checked[m.name]) : all;
  // Only show provenance tags when there's more than one goal to disambiguate.
  const showProvenance = goalsOf().filter(g => g.materials.length).length > 1;

  const toggle = doneCount ? `
    <label class="farming-hide-toggle">
      <input type="checkbox" data-action="hide-farmed" ${hideFarmed ? 'checked' : ''} />
      Hide farmed (${doneCount})
    </label>
  ` : '';
  const body = materials.length
    ? buildHuntPlan(materials).map(group => renderGroup(group, checked, showProvenance)).join('')
    : `<div class="farming-empty"><p>All ${doneCount} material${doneCount !== 1 ? 's' : ''} farmed 🎉</p></div>`;
  return toggle + body;
}

function renderGroup(group, checked, showProvenance) {
  const icon = group.kind === 'monster' ? '🐲' : group.kind === 'gathering' ? '🌿' : '❓';
  const allDone = group.items.every(i => checked[i.name]);

  let questHtml = '';
  if (group.kind === 'monster') {
    const quest = findQuestsForMonster(group.title)[0];
    if (quest) {
      const badge = getQuestBadgeInfo(quest);
      const rank = quest.stars ? `<span class="quest-rank">★${quest.stars}</span>` : '';
      questHtml = `<div class="farming-group-quest"><span class="quest-chip ${badge.class}">${badge.icon} ${escapeHtml(quest.name)}${rank}</span></div>`;
    }
  }

  return `
    <div class="farming-group${allDone ? ' group-done' : ''}">
      <div class="farming-group-title">
        <span class="farming-group-titletext">
          <input type="checkbox" class="farming-group-check" data-action="complete-group"
                 ${allDone ? 'checked' : ''} title="Mark every material here as farmed"
                 aria-label="Mark all ${escapeHtml(group.title)} materials farmed" />
          ${icon} ${escapeHtml(group.title)}
        </span>
        <span class="farming-group-count">${group.items.length}</span>
      </div>
      ${questHtml}
      <div class="farming-items">
        ${group.items.map(item => renderPlanItem(item, group, checked, showProvenance)).join('')}
      </div>
    </div>
  `;
}

function renderPlanItem(item, group, checked, showProvenance) {
  let hint = '';
  if (group.kind === 'monster') {
    const src = (materialIndex[item.name] || []).find(s => s.monsterName === group.title);
    if (src?.drops?.length) {
      const best = src.drops.reduce((a, b) => (b.chance > a.chance ? b : a));
      hint = `${kindLabel(best.kind)} ${best.chance}%`;
    }
  } else if (group.kind === 'gathering') {
    const g = (gatheringSources[item.name] || [])[0];
    if (g) hint = `${g.type}: ${g.source}`;
  }

  const n = escapeHtml(item.name);
  const isDone = !!checked[item.name];

  let tags = '';
  if (showProvenance) {
    const shown = item.sources.slice(0, 2).map(s => `<span class="prov-tag">${escapeHtml(s)}</span>`).join('');
    const extra = item.sources.length > 2
      ? `<span class="prov-tag prov-more" title="${escapeAttr(item.sources.slice(2).join(', '))}">+${item.sources.length - 2}</span>`
      : '';
    tags = `<div class="farming-item-prov">${shown}${extra}</div>`;
  }

  return `
    <div class="farming-item${isDone ? ' done' : ''}">
      <input type="checkbox" class="farming-check" data-action="toggle" data-name="${n}"
             ${isDone ? 'checked' : ''} aria-label="Mark ${n} as farmed" />
      <div class="farming-item-main">
        <span class="farming-item-name"><span class="qty">${item.qty}x</span> ${n}</span>
        ${hint ? `<span class="farming-item-hint">${escapeHtml(hint)}</span>` : ''}
        ${tags}
      </div>
    </div>
  `;
}

// ── Skill display + aggregation ──
function formatSkill(s) {
  if (typeof s === 'string') return s; // legacy string form (pre-aggregation goals)
  if (s.setBonus) return `${s.name}${s.requires ? ` (${s.requires}pc)` : ' (set)'}`;
  return `${s.name} Lv${s.level}`;
}

function skillMax(name) {
  const sk = skillsData[name];
  if (!sk || sk.kind === 'set') return null;
  return sk.ranks.reduce((m, r) => Math.max(m, r.level), 0);
}

// Highest set-bonus tier reached for a given number of contributing pieces.
function bonusTier(name, pieces) {
  const sk = skillsData[name];
  if (!sk) return null;
  let best = null;
  for (const r of sk.ranks) {
    if (r.setPiecesRequired && pieces >= r.setPiecesRequired &&
        (!best || r.setPiecesRequired > best.setPiecesRequired)) {
      best = r;
    }
  }
  return best; // { level, setPiecesRequired, description } or null
}

// Sum skills across every goal in the active profile. Regular skill levels add
// (capped at the skill's real max); set bonuses accumulate contributing pieces.
function aggregateSkills() {
  const regular = new Map(); // name -> summed level
  const bonus = new Map();   // name -> summed contributing pieces
  for (const g of goalsOf()) {
    if (subsumedBy(g) || isLowerWeaponTier(g)) continue;
    for (const s of (g.meta?.skills || [])) {
      if (typeof s === 'string') continue; // legacy: not structured, can't sum
      if (s.setBonus) bonus.set(s.name, (bonus.get(s.name) || 0) + (s.contributes || 1));
      else regular.set(s.name, (regular.get(s.name) || 0) + (s.level || 0));
    }
  }
  const regularOut = [...regular].map(([name, raw]) => {
    const max = skillMax(name);
    return { name, raw, level: max ? Math.min(raw, max) : raw, capped: !!(max && raw > max) };
  }).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  const bonusOut = [...bonus].map(([name, pieces]) => ({ name, pieces, tier: bonusTier(name, pieces) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { regular: regularOut, bonus: bonusOut };
}

// Sum defense + resistances across the active profile's gear goals.
const RESIST_ELEMS = ['fire', 'water', 'ice', 'thunder', 'dragon'];
const RESIST_NAMES = { fire: 'Fire', water: 'Water', ice: 'Ice', thunder: 'Thunder', dragon: 'Dragon' };
// Status ailments carry bundled icons keyed by the data value (poison.png etc.).
const STATUS_NAMES = { poison: 'Poison', paralysis: 'Para', sleep: 'Sleep', blastblight: 'Blast' };

function aggregateStats() {
  let defense = 0;
  let zenny = 0;
  const resist = { fire: 0, water: 0, ice: 0, thunder: 0, dragon: 0 };
  let hasArmor = false;
  // Weapons aren't summed — you equip one. We collect each distinct pinned
  // weapon (chain goal, or the top pinned tier of a chain — lower tiers and
  // subsumed goals are skipped) and show its stats as its own row.
  const weapons = [];
  for (const g of goalsOf()) {
    if (subsumedBy(g)) continue;
    const m = g.meta || {};
    // Zenny is the cost to build everything pinned, so every pinned tier counts.
    if (typeof m.zenny === 'number') zenny += m.zenny;
    // Defense/resistances are equipped stats — skip lower weapon tiers.
    if (isLowerWeaponTier(g)) continue;
    if (typeof m.defense === 'number' && m.defense) defense += m.defense;
    if (m.resist) {
      hasArmor = true;
      for (const e of RESIST_ELEMS) resist[e] += (m.resist[e] || 0);
    }
    if ((g.type === 'weapon' || g.type === 'weapon-chain') &&
        (m.attack != null || m.affinity != null || m.specials?.length)) {
      weapons.push({ name: g.name, meta: m });
    }
  }
  return { defense, resist, zenny, hasArmor: hasArmor || defense > 0, weapons };
}

function resItem(elem, val) {
  const cls = val > 0 ? 'positive' : val < 0 ? 'negative' : 'neutral';
  const sign = val > 0 ? '+' : '';
  return `<span class="res-item ${cls}"><img src="/images/icons/${elem}.png" alt="${RESIST_NAMES[elem]}" class="res-icon" />${sign}${val}</span>`;
}

// Weapon stat icons (attack / affinity / element or status specials) shared by
// the Gear-tab goal card and the Build Summary weapon row. Returns an array of
// HTML spans. `label` on a special is the resolved element/status name; older
// pinned goals may lack it (snapshot staleness) and fall back to kind.
function weaponStatParts(meta) {
  const parts = [];
  if (meta.attack != null) parts.push(`<span class="goal-stat-item"><img src="/images/icons/attack.png" alt="Attack" title="Attack" class="stat-icon" /> ${meta.attack}</span>`);
  // affinity always shows (0% is real info)
  parts.push(`<span class="goal-stat-item"><img src="/images/icons/affinity.png" alt="Affinity" title="Affinity" class="stat-icon" /> ${meta.affinity > 0 ? '+' : ''}${meta.affinity || 0}%</span>`);
  for (const s of (meta.specials || [])) {
    let icon;
    if (s.elem && RESIST_NAMES[s.elem]) {
      icon = `<img src="/images/icons/${s.elem}.png" alt="${RESIST_NAMES[s.elem]}" class="res-icon" />`;
    } else if (s.status && STATUS_NAMES[s.status]) {
      // Stale pre-icon snapshots lack s.status and fall back to the text label.
      icon = `<img src="/images/icons/${s.status}.png" alt="${STATUS_NAMES[s.status]}" title="${STATUS_NAMES[s.status]}" class="res-icon" />`;
    } else {
      icon = escapeHtml(s.label || s.kind || '');
    }
    if (icon) parts.push(`<span class="goal-stat-item">${icon} ${s.damage}</span>`);
  }
  return parts;
}

// Per-goal stat row with icons (Gear tab). Armor: defense + nonzero resists.
// Weapons: attack / affinity / element specials. Slots for either. Falls back to
// the plain-text statLine for types without structured stats (pendant, charm).
function renderGoalStats(goal) {
  const meta = goal.meta || {};
  const isWeapon = goal.type === 'weapon' || goal.type === 'weapon-chain';
  let parts = [];

  if (isWeapon) {
    parts = weaponStatParts(meta);
  } else if (typeof meta.defense === 'number' && (meta.defense || meta.resist)) {
    parts.push(`<span class="goal-stat-item">${defenseSvg()} ${meta.defense}</span>`);
    if (meta.resist) {
      const resHtml = RESIST_ELEMS.filter(e => meta.resist[e]).map(e => resItem(e, meta.resist[e])).join('');
      if (resHtml) parts.push(`<span class="goal-stat-resist">${resHtml}</span>`);
    }
  }

  const slotHtml = meta.slots?.length
    ? `<span class="goal-stat-item goal-slots" title="Decoration slots">${slotIcons(meta.slots)}</span>`
    : '';

  if (!parts.length && !slotHtml) {
    return meta.statLine ? `<div class="goal-stat">${escapeHtml(meta.statLine)}</div>` : '';
  }
  return `<div class="goal-stat goal-stat-icons">${parts.join('')}${slotHtml}</div>`;
}

// Build Summary: total defense, summed resistances, combined skills, set bonuses —
// scoped to the active profile (one profile = one build).
function renderBuildSummary() {
  const { regular, bonus } = aggregateSkills();
  const { defense, resist, zenny, hasArmor, weapons } = aggregateStats();
  if (!regular.length && !bonus.length && !hasArmor && !zenny && !weapons.length) return '';

  // One row per pinned weapon (not summed — you equip one). Name is shown so the
  // stats are attributable when more than one weapon is pinned.
  const weaponHtml = weapons.map(w => `
    <div class="agg-weapon">
      <span class="agg-weapon-name">${escapeHtml(w.name)}</span>
      <span class="agg-weapon-stats">${weaponStatParts(w.meta).join('')}</span>
    </div>
  `).join('');

  const statsHtml = (hasArmor || zenny || weapons.length) ? `
    <div class="agg-stats">
      ${hasArmor ? `
        <span class="agg-defense">${defenseSvg()} ${defense}</span>
        <div class="resistances">${RESIST_ELEMS.map(e => resItem(e, resist[e])).join('')}</div>
      ` : ''}
      ${weaponHtml}
      ${zenny ? `<span class="agg-zenny">${zennySvg()} ${zenny.toLocaleString()}z</span>` : ''}
    </div>
  ` : '';

  const regChips = regular.map(s =>
    `<span class="agg-skill${s.capped ? ' agg-capped' : ''}" data-action="show-skill" data-skill="${escapeHtml(s.name)}" title="Open in reference">${escapeHtml(s.name)} Lv${s.level}${s.capped ? ' · max' : ''}</span>`
  ).join('');

  const bonusChips = bonus.map(s => {
    const active = s.tier ? ' ✓' : '';
    return `<span class="agg-skill agg-bonus" data-action="show-skill" data-skill="${escapeHtml(s.name)}" title="Open in reference">${escapeHtml(s.name)} · ${s.pieces}pc${active}</span>`;
  }).join('');

  return `
    <div class="agg-summary">
      <div class="agg-summary-head">Build Summary <span class="agg-note">if everything pinned is built &amp; equipped</span></div>
      ${statsHtml}
      ${regChips ? `<div class="agg-skill-label">Skills</div><div class="agg-skills">${regChips}</div>` : ''}
      ${bonusChips ? `<div class="agg-skills agg-bonuses">${bonusChips}</div>` : ''}
    </div>
  `;
}

function defenseSvg() {
  return `<img src="/images/icons/defense.png" alt="Defense" class="res-icon" />`;
}

function zennySvg() {
  return `<img src="/images/icons/zenny.png" alt="Cost" title="Cost" class="res-icon" />`;
}

// ── Gear-tab display sort ──
// A view-only ordering of the goal cards (Build Summary, hunt plan, and storage
// order are untouched). Each goal type maps to a category; a sort mode floats one
// category to the top while the rest keep a fixed canonical order. JS sort is
// stable, so pin order is preserved within a bucket. Custom (ad-hoc) goal always
// renders last as an editable list.
const CATEGORY_OF = {
  weapon: 'weapons', 'weapon-chain': 'weapons',
  set: 'armor', piece: 'armor',
  charm: 'charms', palico: 'palico', pendant: 'pendants',
};
// Canonical order the non-floated categories fall back to. 'default' uses this
// as-is (nothing floated); a category mode moves its category to rank 0 and the
// rest shift down but keep this relative order.
const CATEGORY_ORDER = ['weapons', 'armor', 'charms', 'palico', 'pendants', 'other'];
// Modes that get an "Order" pill (custom is never a category). 'default' first.
const GEAR_SORTS = ['default', 'weapons', 'armor', 'charms', 'palico', 'pendants'];
const GEAR_SORT_LABELS = { default: 'Default', weapons: 'Weapons', armor: 'Armor', charms: 'Charms', palico: 'Palico', pendants: 'Pendants' };
const PIECE_KIND_ORDER = { head: 0, chest: 1, arms: 2, waist: 3, legs: 4 };
// Recover an armor piece's kind for pre-existing pins that predate meta.kind:
// its snapshotted emoji uniquely identifies the slot (the 🛡️/chest overlap with
// set goals is harmless — only piece goals are ranked). Tolerate a stripped
// variation selector so an exact codepoint match isn't required.
const KIND_EMOJI = { head: '🪖', chest: '🛡️', arms: '🧤', waist: '🩻', legs: '🥾' };
const EMOJI_TO_KIND = {};
for (const [k, e] of Object.entries(KIND_EMOJI)) {
  EMOJI_TO_KIND[e] = k;
  EMOJI_TO_KIND[e.replace(/\uFE0F/g, '')] = k;
}
function pieceKindRank(goal) {
  let kind = goal.meta?.kind;
  if (!kind) {
    const e = goal.meta?.emoji || '';
    kind = EMOJI_TO_KIND[e] || EMOJI_TO_KIND[e.replace(/\uFE0F/g, '')];
  }
  const r = PIECE_KIND_ORDER[kind];
  return r == null ? 99 : r; // unknown kind sinks to the end of the piece run
}
// [bucketRank, subRank] compared lexicographically. The floated category is
// bucket 0; other categories follow in canonical order; custom is always last.
// In armor mode the armor bucket splits into sets (0) then pieces by slot.
function gearSortKey(goal, mode) {
  if (goal.type === 'custom') return [CATEGORY_ORDER.length + 1, 0];
  const cat = CATEGORY_OF[goal.type] || 'other';
  const bucket = cat === mode ? 0 : 1 + CATEGORY_ORDER.indexOf(cat);
  if (mode === 'armor' && goal.type === 'piece') return [bucket, 1 + pieceKindRank(goal)];
  return [bucket, 0];
}

function gearSort() {
  return GEAR_SORTS.includes(state?.gearSort) ? state.gearSort : 'default';
}
function setGearSort(mode) {
  if (!GEAR_SORTS.includes(mode) || mode === gearSort()) return;
  state.gearSort = mode;
  save(); // view preference — persist without touching goal/checked state
  renderPanel();
}

// Show Default plus a pill for each category actually pinned (a Palico/Charms
// option only appears once you have palico/charm goals) — no dead options.
// Returns '' when there's nothing meaningful to sort (≤1 goal, or no category
// pill beyond Default).
function renderGearSortControl(sort, goals) {
  const present = new Set(goals.map(g => CATEGORY_OF[g.type]).filter(c => c && c !== 'other'));
  const modes = GEAR_SORTS.filter(m => m === 'default' || present.has(m));
  if (goals.length <= 1 || modes.length <= 1) return '';
  const pills = modes.map(k =>
    // data-name mirrors data-sort so renderPanel's focus-restore lands on the
    // clicked pill after the re-render (its selector keys off data-name).
    `<button class="gear-sort-btn${k === sort ? ' active' : ''}" data-action="gear-sort" data-sort="${k}" data-name="${k}">${GEAR_SORT_LABELS[k]}</button>`
  ).join('');
  return `<div class="gear-sort" role="group" aria-label="Order goals"><span class="gear-sort-label">Order</span>${pills}</div>`;
}

// ── Gear tab ──
function renderGearTab() {
  const sort = gearSort();
  const goals = goalsOf().filter(g => g.materials.length || isAcquisitionGoal(g));
  if (sort === 'default') {
    goals.sort((a, b) => (a.type === 'custom' ? 1 : 0) - (b.type === 'custom' ? 1 : 0));
  } else {
    goals.sort((a, b) => {
      const ka = gearSortKey(a, sort), kb = gearSortKey(b, sort);
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
  }
  const card = g => g.type === 'custom' ? renderCustomGoalCard(g)
    : isAcquisitionGoal(g) ? renderAcquisitionGoalCard(g)
    : renderGoalCard(g);
  return renderGearSortControl(sort, goals) + renderBuildSummary() + goals.map(card).join('');
}

function renderGoalCard(goal) {
  const checked = checkedOf();
  const total = goal.materials.length;
  const done = goal.materials.filter(m => checked[m.name]).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const meta = goal.meta || {};
  const parentGoal = subsumedBy(goal);
  const lowerTier = !parentGoal && isLowerWeaponTier(goal); // stats not counted, but materials are

  const img = meta.img
    ? `<img class="goal-img" src="${meta.img}" alt="${escapeHtml(goal.name)}" loading="lazy" />`
    : `<span class="goal-emoji">${meta.emoji || '📦'}</span>`;

  const subParts = [];
  if (meta.rarity) subParts.push(`★${meta.rarity}`);
  if (meta.rankLabel) subParts.push(meta.rankLabel);
  if (meta.pathLabel) subParts.push(meta.pathLabel);
  if (meta.zenny) subParts.push(`${meta.zenny.toLocaleString()}z`);
  const sub = subParts.length ? `<div class="goal-sub">${escapeHtml(subParts.join(' · '))}</div>` : '';

  const stat = renderGoalStats(goal);
  const skills = (meta.skills && meta.skills.length)
    ? `<div class="goal-skills">${meta.skills.map(s => `<span class="goal-skill" data-action="show-skill" data-skill="${escapeHtml(typeof s === 'string' ? s : s.name)}" title="Open in reference">${escapeHtml(formatSkill(s))}</span>`).join('')}</div>`
    : '';

  const allDone = total > 0 && done === total;

  return `
    <div class="goal-card${allDone ? ' goal-complete' : ''}">
      <div class="goal-card-head">
        ${img}
        <div class="goal-card-title">
          <div class="goal-name">${escapeHtml(goal.name)}</div>
          ${sub}
        </div>
        <div class="goal-card-actions">
          <button class="goal-done-btn${allDone ? ' active' : ''}" data-action="complete-goal" data-goal-id="${escapeHtml(goal.id)}"
                  title="${allDone ? 'Uncheck all materials for this goal' : 'Mark all materials for this goal as farmed'}">
            ${allDone ? '↺ Undo' : '✓ Done'}
          </button>
          <button class="goal-remove" data-action="remove-goal" data-goal-id="${escapeHtml(goal.id)}" title="Remove this goal">Remove</button>
        </div>
      </div>
      <div class="goal-progress" role="progressbar" aria-valuenow="${done}" aria-valuemax="${total}">
        <div class="goal-progress-bar" style="width:${pct}%"></div>
      </div>
      <div class="goal-progress-label">${done}/${total} materials${done === total ? ' ✓' : ''}</div>
      ${parentGoal ? `<div class="goal-included">Included in “${escapeHtml(parentGoal.name)}” — counted once</div>` : ''}
      ${lowerTier ? `<div class="goal-included">Lower tier — materials count, stats superseded by a higher pinned tier</div>` : ''}
      ${stat}
      ${skills}
    </div>
  `;
}

// Material-less pendant goal: no materials to farm, so instead of a progress bar
// it shows the acquisition method and a done/not-done toggle keyed by the goal id.
function renderAcquisitionGoalCard(goal) {
  const meta = goal.meta || {};
  const done = !!checkedOf()[goal.id];
  const img = meta.img
    ? `<img class="goal-img" src="${meta.img}" alt="${escapeHtml(goal.name)}" loading="lazy" />`
    : `<span class="goal-emoji">${meta.emoji || '🎀'}</span>`;
  const sub = meta.rarity ? `<div class="goal-sub">★${meta.rarity} · Pendant</div>` : `<div class="goal-sub">Pendant</div>`;
  const acquire = meta.acquire
    ? `<div class="goal-acquire"><span class="goal-acquire-label">How to get</span> ${escapeHtml(meta.acquire)}</div>`
    : '';
  return `
    <div class="goal-card${done ? ' goal-complete' : ''}">
      <div class="goal-card-head">
        ${img}
        <div class="goal-card-title">
          <div class="goal-name">${escapeHtml(goal.name)}</div>
          ${sub}
        </div>
        <div class="goal-card-actions">
          <button class="goal-done-btn${done ? ' active' : ''}" data-action="complete-goal" data-goal-id="${escapeHtml(goal.id)}"
                  title="${done ? 'Mark as not yet acquired' : 'Mark this pendant as acquired'}">
            ${done ? '↺ Undo' : '✓ Got it'}
          </button>
          <button class="goal-remove" data-action="remove-goal" data-goal-id="${escapeHtml(goal.id)}" title="Remove this goal">Remove</button>
        </div>
      </div>
      ${acquire}
    </div>
  `;
}

function renderCustomGoalCard(goal) {
  const checked = checkedOf();
  const rows = goal.materials.map(m => {
    const n = escapeHtml(m.name);
    return `
      <div class="goal-custom-row${checked[m.name] ? ' done' : ''}">
        <span class="goal-custom-name"><span class="qty">${m.qty}x</span> ${n}</span>
        <div class="farming-item-controls">
          <button data-action="dec" data-name="${n}" aria-label="Decrease ${n}">−</button>
          <button data-action="inc" data-name="${n}" aria-label="Increase ${n}">+</button>
          <button data-action="remove" data-name="${n}" class="farming-remove" aria-label="Remove ${n}">×</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="goal-card goal-card--custom">
      <div class="goal-card-head">
        <span class="goal-emoji">📋</span>
        <div class="goal-card-title">
          <div class="goal-name">${escapeHtml(goal.name)}</div>
          <div class="goal-sub">${goal.materials.length} material${goal.materials.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div class="goal-custom-list">${rows}</div>
    </div>
  `;
}

// ---- Profiles ----
function renderProfileSelect() {
  profileSelectEl.innerHTML = state.profiles
    .map(p => `<option value="${escapeHtml(p.id)}"${p.id === state.activeProfile ? ' selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('');
}

function switchProfile(id) {
  if (state.profiles.some(p => p.id === id)) {
    state.activeProfile = id;
    hideProfileForm(); // an open Rename/Duplicate/Delete form must not act on the new profile
    commit();
  }
}

// Inline form in the drawer header — replaces the native prompt()/confirm()
// dialogs so profile ops match the app's look and stay keyboard-friendly
// (Enter confirms, Escape cancels).
function showProfileForm(action) {
  profileAction = action;
  const p = activeProfile();
  if (action === 'delete') {
    profileFormEl.innerHTML = `
      <span class="profile-form-label">Delete “${escapeHtml(p.name)}”? This can't be undone.</span>
      <button data-pform="ok" class="profile-form-danger">Delete</button>
      <button data-pform="cancel">Cancel</button>
    `;
  } else {
    const defaults = {
      new: `Build ${state.profiles.length + 1}`,
      rename: p.name,
      duplicate: `${p.name} copy`,
    };
    const labels = { new: 'New build name', rename: 'Rename build', duplicate: 'Name for the copy' };
    profileFormEl.innerHTML = `
      <input type="text" value="${escapeAttr(defaults[action])}" maxlength="40" aria-label="${labels[action]}" />
      <button data-pform="ok" title="Confirm">✓</button>
      <button data-pform="cancel" title="Cancel">✕</button>
    `;
  }
  profileFormEl.hidden = false;
  const input = profileFormEl.querySelector('input');
  if (input) { input.focus(); input.select(); }
}

function hideProfileForm() {
  profileAction = null;
  profileFormEl.hidden = true;
  profileFormEl.innerHTML = '';
}

function confirmProfileForm() {
  const p = activeProfile();
  if (profileAction === 'delete') {
    state.profiles = state.profiles.filter(x => x.id !== p.id);
    if (!state.profiles.length) state.profiles.push(freshProfile('Default'));
    state.activeProfile = state.profiles[0].id;
  } else {
    const input = profileFormEl.querySelector('input');
    const name = (input?.value || '').trim();
    if (!name) { input?.focus(); return; } // keep the form open until named or cancelled
    if (profileAction === 'new') {
      const np = freshProfile(name);
      state.profiles.push(np);
      state.activeProfile = np.id;
    } else if (profileAction === 'rename') {
      p.name = name;
    } else if (profileAction === 'duplicate') {
      const copy = { id: genId(), name, goals: JSON.parse(JSON.stringify(p.goals)), checked: { ...p.checked } };
      state.profiles.push(copy);
      state.activeProfile = copy.id;
    }
  }
  hideProfileForm();
  commit();
}

function toggleProfileMenu(force) {
  const show = force !== undefined ? force : profileMenuEl.hidden;
  profileMenuEl.hidden = !show;
}

// ---- Tabs ----
function setTab(tab) {
  activeTab = tab;
  renderPanel();
}

function syncTabButtons() {
  document.querySelectorAll('.farming-tab').forEach(btn => {
    const active = btn.dataset.tab === activeTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  });
}

function updateTabCount() {
  const n = goalsOf().filter(g => g.materials.length || isAcquisitionGoal(g)).length;
  tabCountEl.textContent = n;
  tabCountEl.hidden = n === 0;
}

// ---- Badge + toggle button ----
function updateBadge() {
  const checked = checkedOf();
  const remaining = aggregate().filter(m => !checked[m.name]).length
    + goalsOf().filter(g => isAcquisitionGoal(g) && !checked[g.id]).length;
  countEl.textContent = remaining;
  countEl.hidden = remaining === 0;
}

function pulseToggle() {
  toggleBtn.classList.remove('pulse');
  void toggleBtn.offsetWidth; // restart the animation
  toggleBtn.classList.add('pulse');
}

// ---- Panel open/close ----
function openPanel() {
  panelEl.classList.add('open');
  toggleBtn.classList.add('active');
  document.body.classList.add('farming-open'); // squeezes page content on wide screens; locks scroll on mobile
  document.dispatchEvent(new CustomEvent('mhws:panel-open', { detail: 'farming' }));
  renderPanel();
  panelEl.focus({ preventScroll: true }); // move keyboard focus into the drawer
}

function closePanel() {
  panelEl.classList.remove('open');
  toggleBtn.classList.remove('active');
  document.body.classList.remove('farming-open');
  toggleProfileMenu(false);
  hideProfileForm();
  disarmClearAll();
  // return focus to the toggle, but only if it was inside the drawer
  if (panelEl.contains(document.activeElement)) toggleBtn.focus({ preventScroll: true });
}

// ---- Panel event delegation ----
function onBodyClick(e) {
  const control = e.target.closest('[data-action]');
  if (!control) return;
  const action = control.dataset.action;

  if (action === 'hide-farmed') {
    hideFarmed = control.checked;
    renderPanel(); // view filter only — nothing to persist
    return;
  }

  if (action === 'gear-sort') {
    setGearSort(control.dataset.sort);
    return;
  }

  // Any skill chip (goal card or Build Summary) → open the reference panel on it.
  if (action === 'show-skill') {
    if (control.dataset.skill) showSkill(control.dataset.skill);
    return;
  }

  if (action === 'remove-goal') {
    const id = control.dataset.goalId;
    activeProfile().goals = goalsOf().filter(g => g.id !== id);
    commit();
    return;
  }

  // Mark every material of one gear goal farmed (or unmark if already all done).
  // A material-less acquisition goal (pendant) toggles its done flag by id.
  if (action === 'complete-goal') {
    const g = goalsOf().find(x => x.id === control.dataset.goalId);
    if (!g) return;
    if (isAcquisitionGoal(g)) {
      const checked = checkedOf();
      if (checked[g.id]) delete checked[g.id];
      else checked[g.id] = true;
      commit();
    } else {
      setChecked(g.materials.map(m => m.name));
    }
    return;
  }

  // Mark every material in one hunt-plan group farmed (e.g. after clearing its quest).
  if (action === 'complete-group') {
    const groupEl = control.closest('.farming-group');
    const names = [...groupEl.querySelectorAll('[data-action="toggle"]')].map(c => c.dataset.name);
    setChecked(names);
    return;
  }

  const name = control.dataset.name;
  if (action === 'toggle') {
    const checked = checkedOf();
    if (checked[name]) delete checked[name];
    else checked[name] = true;
    commit();
    return;
  }

  // Custom-goal material controls
  const g = customGoal();
  if (!g) return;
  const mat = g.materials.find(m => m.name === name);
  if (action === 'inc') {
    if (mat) mat.qty += 1;
  } else if (action === 'dec') {
    if (mat) mat.qty = Math.max(1, mat.qty - 1);
  } else if (action === 'remove') {
    g.materials = g.materials.filter(m => m.name !== name);
    if (!g.materials.length) activeProfile().goals = goalsOf().filter(x => x !== g);
  } else {
    return;
  }
  commit();
}

// ---- Init ----
export function initFarmingList(index) {
  materialIndex = index;
  loadState();
  save(); // persist any v1→v2 migration or fresh-state creation immediately

  panelEl = document.getElementById('farming-panel');
  bodyEl = document.getElementById('farming-body');
  countEl = document.getElementById('farming-count');
  toggleBtn = document.getElementById('farming-toggle');
  profileSelectEl = document.getElementById('farming-profile-select');
  profileMenuEl = document.getElementById('farming-profile-menu');
  profileFormEl = document.getElementById('farming-profile-form');
  tabCountEl = document.getElementById('farming-tab-count');

  toggleBtn.addEventListener('click', () => {
    panelEl.classList.contains('open') ? closePanel() : openPanel();
  });
  document.getElementById('farming-close').addEventListener('click', closePanel);

  // Tabs
  document.querySelectorAll('.farming-tab').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  // Profiles
  profileSelectEl.addEventListener('change', () => switchProfile(profileSelectEl.value));
  document.getElementById('farming-profile-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleProfileMenu();
  });
  profileMenuEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-paction]');
    if (!btn) return;
    toggleProfileMenu(false);
    showProfileForm(btn.dataset.paction);
  });
  profileFormEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pform]');
    if (!btn) return;
    if (btn.dataset.pform === 'ok') confirmProfileForm();
    else hideProfileForm();
  });
  profileFormEl.addEventListener('keydown', (e) => {
    // Enter means "confirm" only in the text input — on the buttons it must
    // keep its native click meaning, or Enter on Cancel would confirm.
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); confirmProfileForm(); }
    if (e.key === 'Escape') { e.stopPropagation(); hideProfileForm(); }
  });
  document.addEventListener('click', (e) => {
    if (!profileMenuEl.hidden && !e.target.closest('.farming-profile')) toggleProfileMenu(false);
  });

  // Footer
  document.getElementById('farming-clear-checked').addEventListener('click', () => {
    activeProfile().checked = {};
    commit();
  });
  // Two-click confirm: first click arms the button for 3s instead of a native confirm().
  const clearAllBtn = document.getElementById('farming-clear-all');
  let clearAllTimer = null;
  disarmClearAll = () => {
    clearTimeout(clearAllTimer);
    clearAllBtn.classList.remove('armed');
    clearAllBtn.textContent = 'Clear all';
  };
  clearAllBtn.addEventListener('click', () => {
    if (isEmpty()) return;
    if (clearAllBtn.classList.contains('armed')) {
      disarmClearAll();
      activeProfile().goals = [];
      activeProfile().checked = {};
      commit();
    } else {
      clearAllBtn.classList.add('armed');
      clearAllBtn.textContent = 'Really clear?';
      clearAllTimer = setTimeout(disarmClearAll, 3000);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelEl.classList.contains('open')) {
      if (!profileFormEl.hidden) hideProfileForm();
      else closePanel();
    }
  });
  bodyEl.addEventListener('click', onBodyClick);

  // Narrow-window guard: when the reference panel opens and both panels would
  // squeeze the page (<1100px), yield to it (reference-panel.js listens too).
  document.addEventListener('mhws:panel-open', (e) => {
    if (e.detail !== 'farming' && panelEl.classList.contains('open') && window.innerWidth < 1100) closePanel();
  });

  updateBadge();
}

// ---- Helpers ----
function kindLabel(kind) {
  return KIND_LABELS[kind] || kind.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// escapeHtml leaves double quotes alone (innerHTML serialization doesn't touch
// them), so values placed inside quoted HTML attributes need this instead.
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
