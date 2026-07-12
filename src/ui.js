/**
 * UI Renderer
 * 
 * Pure DOM rendering functions. No framework — we use template literals
 * and innerHTML for the initial render, then attach event listeners.
 * 
 * Learning note: This is the "vanilla JS component" pattern. Each function
 * returns an HTML string (think of it like a server-side template). 
 * The tradeoff vs React: more manual DOM management, but zero framework 
 * overhead and complete control. For a read-heavy app like this, it's ideal.
 */

import { findQuestsForMaterial, getQuestBadgeInfo } from './quest-lookup.js';
import { addMaterial, addGoal, addGoals } from './farming-list.js';
import { showSkill } from './reference-panel.js';
import { slotIcon, slotIcons, slotLevels } from './icons.js';
import gatheringSources from './data/gathering-sources.json';
import imageManifest from './data/image-manifest.json';
import skillsData from './data/skills.json';

const ARMOR_IMAGE_IDS = new Set(imageManifest.armorSets);
const ARMOR_PIECE_IMAGE_IDS = new Set(imageManifest.armorPieces);
const PENDANT_IMAGE_IDS = new Set(imageManifest.pendants);
const PALICO_IMAGE_IDS = new Set(imageManifest.palicogear || []);
const WEAPON_KIND_IMAGE_SET = new Set(imageManifest.weaponKinds || []);
const WEAPON_IMAGE_IDS = new Set(imageManifest.weapons || []);

function getArmorImagePath(setId) {
  return ARMOR_IMAGE_IDS.has(setId) ? `/images/armor-sets/${setId}.webp` : null;
}

function getArmorPieceImagePath(pieceId) {
  return ARMOR_PIECE_IMAGE_IDS.has(pieceId) ? `/images/armor-pieces/${pieceId}.webp` : null;
}

function getPendantImagePath(pendantId) {
  return PENDANT_IMAGE_IDS.has(pendantId) ? `/images/pendants/${pendantId}.webp` : null;
}

function getPalicoImagePath(setId) {
  return PALICO_IMAGE_IDS.has(setId) ? `/images/palico-gear/${setId}.webp` : null;
}

function getWeaponKindImagePath(kind) {
  return WEAPON_KIND_IMAGE_SET.has(kind) ? `/images/weapons/${kind}.webp` : null;
}

function getWeaponImagePath(id) {
  return WEAPON_IMAGE_IDS.has(id) ? `/images/weapons/${id}.webp` : null;
}

let materialIndex = {};

export function setMaterialIndex(index) {
  materialIndex = index;
}

const ELEMENT_NAMES = { fire: 'Fire', water: 'Water', ice: 'Ice', thunder: 'Thunder', dragon: 'Dragon' };

function elementIcon(elem) {
  const name = ELEMENT_NAMES[elem];
  if (name) return `<img src="/images/icons/${elem}.png" alt="${name}" class="res-icon" />`;
  return elem;
}

function defenseIcon() {
  return `<img src="/images/icons/defense.png" alt="Defense" class="res-icon" />`;
}

// Weapon stat icons (attack / affinity / sharpness), bundled from Fextralife.
function statIcon(name, alt) {
  return `<img src="/images/icons/${name}.png" alt="${alt}" title="${alt}" class="stat-icon" />`;
}

// Zenny cost line (icon + text) — placed under a materials list.
function zennyCostLine(amount) {
  return `<div class="zenny-cost">${statIcon('zenny', 'Cost')} ${formatZenny(amount)}</div>`;
}

// Decoration-slot row shown under the stats, with the slots icon label.
function slotsRow(levels) {
  if (!levels?.length) return '';
  return `<div class="slots-row">${statIcon('slots', 'Slots')} ${slotIcons(levels)}</div>`;
}

const PIECE_ICONS = {
  head: '🪖',
  chest: '🛡️',
  arms: '🧤',
  waist: '🩻',
  legs: '🥾'
};

const WEAPON_KIND_LABELS = {
  'great-sword': 'Great Sword',
  'sword-shield': 'Sword & Shield',
  'dual-blades': 'Dual Blades',
  'long-sword': 'Long Sword',
  'hammer': 'Hammer',
  'hunting-horn': 'Hunting Horn',
  'lance': 'Lance',
  'gunlance': 'Gunlance',
  'switch-axe': 'Switch Axe',
  'charge-blade': 'Charge Blade',
  'insect-glaive': 'Insect Glaive',
  'light-bowgun': 'Light Bowgun',
  'heavy-bowgun': 'Heavy Bowgun',
  'bow': 'Bow',
};

const WEAPON_KIND_ICONS = {
  'great-sword': '⚔️',
  'sword-shield': '🛡️',
  'dual-blades': '🗡️',
  'long-sword': '⚔️',
  'hammer': '🔨',
  'hunting-horn': '🎺',
  'lance': '🏹',
  'gunlance': '💥',
  'switch-axe': '🪓',
  'charge-blade': '⚡',
  'insect-glaive': '🦗',
  'light-bowgun': '🏹',
  'heavy-bowgun': '🏹',
  'bow': '🏹',
};

const SPECIAL_ELEMENT_NAMES = {
  fire: 'Fire', water: 'Water', thunder: 'Thunder', ice: 'Ice', dragon: 'Dragon',
  poison: 'Poison', paralysis: 'Para', sleep: 'Sleep', blastblight: 'Blast',
};

// A weapon special is either elemental (s.element: fire/water/…) or a status
// ailment (s.status: poison/paralysis/sleep/blastblight, with s.element null).
// Prefer whichever is set so status weapons show the ailment, not a bare "status".
function specialDisplayName(s) {
  const key = s.element || s.status;
  return SPECIAL_ELEMENT_NAMES[key] || key || s.kind || '';
}

// Icon for a weapon special: element glyph, or status-ailment glyph now that
// poison/paralysis/sleep/blastblight icons are bundled (keyed by the data value,
// same convention as element icons). Text label for anything unmapped.
function specialIcon(s) {
  if (ELEMENT_NAMES[s.element]) return elementIcon(s.element);
  if (s.status && SPECIAL_ELEMENT_NAMES[s.status]) {
    const name = SPECIAL_ELEMENT_NAMES[s.status];
    return `<img src="/images/icons/${s.status}.png" alt="${name}" title="${name}" class="res-icon" />`;
  }
  return `<span class="special-type">${escapeHtml(specialDisplayName(s))}</span>`;
}

// ---- Rarity color helper ----
function getRarityColor(rarity) {
  const colors = {
    1: 'var(--rarity-1)', 2: 'var(--rarity-2)',
    3: 'var(--rarity-3)', 4: 'var(--rarity-4)',
    5: 'var(--rarity-5)', 6: 'var(--rarity-6)',
    7: 'var(--rarity-7)', 8: 'var(--rarity-8)',
    9: 'var(--rarity-9)', 10: 'var(--rarity-10)'
  };
  return colors[rarity] || 'var(--text-secondary)';
}

// ---- Format zenny with comma separator ----
function formatZenny(z) {
  return z.toLocaleString() + 'z';
}

// ---- Shared material chip ----
// Click → source popup; the nested + pins the material to the farming list.
function materialChipHtml(name, qty) {
  const hasSources = !!(materialIndex[name]?.length);
  return `
    <span class="material-chip"
          data-material="${escapeHtml(name)}"
          data-qty="${qty}"
          title="Click to see sources"
          ${hasSources ? 'data-has-source="true"' : ''}>
      <span class="qty">${qty}x</span> ${escapeHtml(name)}
      <button class="chip-pin" title="Add to farming list" aria-label="Add ${escapeHtml(name)} to farming list">+</button>
    </span>
  `;
}

// ---- Goal pin button ----
// Serializes the goal skeleton (id/type/name/meta) into a data attribute; the
// click handler attaches materials by reading the sibling material chips. Used
// on set summaries, armor pieces, weapon tiers, charms, pendants, and palico.
function attrJson(obj) {
  return JSON.stringify(obj)
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;');
}

function pinGoalBtn(goal, opts = {}) {
  const classes = ['pin-goal-btn'];
  if (opts.header) classes.push('pin-header-btn');
  if (opts.tile) classes.push('pin-tile-btn');
  const title = `Pin ${goal.name} to the farming list`;
  // A weapon tier with higher tiers carries the whole upper chain; clicking the
  // pin then prompts "this tier only" vs "this + N higher" instead of pinning
  // straight away. `chainGoals` includes the clicked tier as its first entry.
  const chainAttr = opts.chainGoals && opts.chainGoals.length > 1
    ? ` data-chain-goals='${attrJson(opts.chainGoals)}'` : '';
  return `<button class="${classes.join(' ')}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" data-goal='${attrJson(goal)}'${chainAttr}>${opts.label || '📌'}</button>`;
}

// Sort-reactive emphasis: when a stat sort is active, the sorted stat is
// promoted out of the muted stat row into a gold badge with a mini-bar scaled
// to the current result set's max — "what has the highest X" becomes visible
// without reading numbers, and equal bars expose ties the ordering hides.
function sortEmphasis(item, sortInfo) {
  if (!sortInfo) return '';
  const v = sortInfo.valueOf(item);
  if (!Number.isFinite(v)) return ''; // statless under this sort — no badge reads as "n/a"
  const icon = sortInfo.key === 'defense' ? defenseIcon() : elementIcon(sortInfo.key);
  const pct = sortInfo.max > 0 ? Math.max(0, Math.round((v / sortInfo.max) * 100)) : 0;
  const sign = v > 0 && sortInfo.key !== 'defense' ? '+' : '';
  return `
    <span class="sort-emph" title="Sorted by this stat">
      <span class="sort-emph-value">${icon} ${sign}${v}</span>
      <span class="sort-emph-bar"><span class="sort-emph-fill" style="width:${pct}%"></span></span>
    </span>
  `;
}

// Compact stat row for collapsed cards — filtering/sorting is useless if you
// have to expand every card to see the numbers. Sets show summed defense +
// nonzero summed resistances; weapon groups show the end tier's ATK/element.
// With an active sort, the sorted stat leads as the emphasis badge and is
// dropped from the muted row (no duplicate).
function collapsedSetStats(meta, item = null, sortInfo = null) {
  const emph = item ? sortEmphasis(item, sortInfo) : '';
  const skipKey = emph ? sortInfo.key : null;
  const defHtml = skipKey === 'defense' ? '' : `<span class="piece-defense">${defenseIcon()} ${meta.defense}</span>`;
  const resHtml = Object.keys(ELEMENT_NAMES).filter(e => e !== skipKey && meta.resist?.[e])
    .map(e => {
      const v = meta.resist[e];
      return `<span class="res-item ${v > 0 ? 'positive' : 'negative'}">${elementIcon(e)}${v > 0 ? '+' : ''}${v}</span>`;
    }).join('');
  return `
    <div class="collapsed-stats">
      ${emph}
      ${defHtml}
      ${resHtml ? `<div class="resistances">${resHtml}</div>` : ''}
    </div>
  `;
}

// ---- Sharpness bar ----
// mhdb gives melee weapons units-per-colour summing toward the game's 400-unit
// max; ranged weapons have none. Normalizing to 400 keeps bars comparable
// across tiers (higher tiers fill more and reach the better colours).
const SHARPNESS_ORDER = ['red', 'orange', 'yellow', 'green', 'blue', 'white', 'purple'];
const SHARPNESS_COLORS = {
  red: '#b0392b', orange: '#d67a2a', yellow: '#e6c018',
  green: '#3a9b46', blue: '#2f74c0', white: '#d8dde3', purple: '#8e44ad',
};
const SHARPNESS_MAX = 400;

function sharpnessBar(sharpness) {
  if (!sharpness) return '';
  const total = SHARPNESS_ORDER.reduce((t, c) => t + (sharpness[c] || 0), 0);
  if (!total) return '';
  const segs = SHARPNESS_ORDER
    .filter(c => sharpness[c] > 0)
    .map(c => `<span class="sharp-seg" style="width:${(sharpness[c] / SHARPNESS_MAX) * 100}%;background:${SHARPNESS_COLORS[c]}"></span>`)
    .join('');
  return `<span class="sharpness-bar" title="Sharpness (${total}/${SHARPNESS_MAX})">${segs}</span>`;
}

// A collapsed weapon-group card shows the final tier's stats — that reading is
// assumed, so no explicit "(final tier)" label is needed.
function collapsedWeaponStats(endWeapon) {
  const parts = [
    `<span class="weapon-stat">${statIcon('attack', 'Attack')} ${endWeapon.damage?.display ?? endWeapon.damage?.raw ?? '?'}</span>`,
    // Affinity always shows (0% is real info) so it's never mysteriously absent.
    `<span class="weapon-stat">${statIcon('affinity', 'Affinity')} ${endWeapon.affinity > 0 ? '+' : ''}${endWeapon.affinity || 0}%</span>`,
  ];
  for (const s of (endWeapon.specials || [])) {
    parts.push(`<span class="weapon-stat">${specialIcon(s)} ${s.damage}</span>`);
  }
  const sharp = sharpnessBar(endWeapon.sharpness);
  if (sharp) parts.push(`<span class="weapon-stat">${statIcon('sharpness', 'Sharpness')} ${sharp}</span>`);
  return `<div class="collapsed-stats">${parts.join('')}</div>`;
}

// "Why did this result appear?" chip for skill-driven search hits (search.js
// attaches _matchedSkill only when the skill — not the gear name — matched).
function matchedSkillChip(item) {
  const m = item._matchedSkill;
  if (!m) return '';
  const label = m.level ? `${m.name} Lv${m.level}` : m.name;
  return `<span class="matched-skill-chip" title="Matched your search">🔎 ${escapeHtml(label)}</span>`;
}

// ---- Collapsed-card meta extras (slots + truncated skills) ----
// Shown on collapsed set/piece cards so you can scan slots and skills without
// expanding. Skills truncate to keep search results scannable, not overwhelming.
function collapsedSlots(slotLevelsArr) {
  if (!slotLevelsArr?.length) return '';
  return `<span class="collapsed-slots" title="Decoration slots">${slotIcons(slotLevelsArr)}</span>`;
}

// Uses the same .skill-tag chip style as expanded cards (incl. the purple
// .set-bonus variant, so full-set bonuses show). Truncates to `max`; the "+n"
// button reveals the rest inline so you can see every skill without opening
// individual pieces. Chips carry data-skill so the shared skill-popup handler
// makes them clickable, exactly like the expanded tags.
function collapsedSkillChips(skillMetaArr, max = 3) {
  // Regular skills first, set bonuses after (stable within each group), so the
  // display order is consistent everywhere and truncation drops bonuses last.
  const skills = [...(skillMetaArr || [])].sort((a, b) => (a.setBonus ? 1 : 0) - (b.setBonus ? 1 : 0));
  if (!skills.length) return '';
  const chip = (s) => {
    const label = s.setBonus
      ? `${escapeHtml(s.name)}${s.requires ? ` (${s.requires}pc)` : ''}`
      : `${escapeHtml(s.name)} Lv${s.level}`;
    const lvl = s.setBonus ? '' : ` data-skill-level="${s.level}"`;
    return `<span class="skill-tag collapsed-skill${s.setBonus ? ' set-bonus' : ''}" data-skill="${escapeHtml(s.name)}"${lvl}>${label}</span>`;
  };
  const shown = skills.slice(0, max).map(chip).join('');
  const rest = skills.slice(max);
  const restHtml = rest.length
    ? `<span class="collapsed-skills-rest">${rest.map(chip).join('')}</span>` +
      `<button class="skill-tag collapsed-skill-more" data-action="show-more-skills" title="Show ${rest.length} more skill${rest.length !== 1 ? 's' : ''}">+${rest.length}</button>`
    : '';
  return `<div class="collapsed-skills">${shown}${restHtml}</div>`;
}

// ---- Snapshotted stat metadata for the Gear tab ----
function rankLabelOf(rank) {
  return rank === 'high' ? 'High Rank' : rank === 'low' ? 'Low Rank' : (rank || '');
}

function resistanceLine(resistances) {
  if (!resistances) return '';
  return Object.entries(resistances)
    .filter(([, v]) => v !== 0)
    .map(([elem, v]) => `${ELEMENT_NAMES[elem] || elem} ${v > 0 ? '+' : ''}${v}`)
    .join(' · ');
}

// Structured skill entries so the Gear tab can sum them across goals.
// Regular skill → { name, level }. Set bonus → { name, setBonus, requires, contributes }.
function skillMeta(skills) {
  return (skills || []).map(s => s.isSetBonus
    ? { name: s.name, setBonus: true, requires: s.setPiecesRequired, contributes: 1 }
    : { name: s.name, level: s.level });
}

// A whole set's skills: sum regular skill levels across its pieces, and count
// how many pieces contribute each set bonus.
function setSkillMeta(set) {
  const regular = new Map();     // name -> summed level
  const bonusPieces = new Map(); // name -> contributing piece count
  const bonusReq = new Map();    // name -> setPiecesRequired threshold
  for (const p of (set.pieces || [])) {
    for (const s of (p.skills || [])) {
      if (s.isSetBonus) {
        bonusPieces.set(s.name, (bonusPieces.get(s.name) || 0) + 1);
        if (s.setPiecesRequired) bonusReq.set(s.name, s.setPiecesRequired);
      } else {
        regular.set(s.name, (regular.get(s.name) || 0) + s.level);
      }
    }
  }
  return [
    ...[...regular].map(([name, level]) => ({ name, level })),
    ...[...bonusPieces].map(([name, contributes]) => ({ name, setBonus: true, requires: bonusReq.get(name), contributes })),
  ];
}

// A whole set's defense (fully upgraded) and summed resistances.
function setDefenseResist(set) {
  let defense = 0;
  const resist = {};
  for (const p of (set.pieces || [])) {
    defense += p.defense?.max ?? p.defense?.base ?? 0;
    for (const [elem, v] of Object.entries(p.resistances || {})) resist[elem] = (resist[elem] || 0) + v;
  }
  return { defense, resist };
}

function weaponStatLine(w) {
  const parts = [`ATK ${w.damage?.display ?? w.damage?.raw ?? '?'}`];
  if (w.affinity) parts.push(`AFF ${w.affinity > 0 ? '+' : ''}${w.affinity}%`);
  for (const s of (w.specials || [])) {
    const elem = specialDisplayName(s);
    if (elem) parts.push(`${elem} ${s.damage}`);
  }
  return parts.join(' · ');
}

// Structured weapon specials (element/status) so the Gear tab can render icons.
// `label` is the resolved display name (element or status ailment).
function weaponSpecialsMeta(w) {
  return (w.specials || []).map(s => ({ elem: s.element || null, status: s.status || null, label: specialDisplayName(s), kind: s.kind || null, damage: s.damage }));
}

// ---- Goal builders ----
// One place that constructs each goal type (with materials + snapshotted meta),
// so header pins, expanded "Add all" pins, and gallery-tile pins all produce an
// identical goal — same id, same materials — no matter where you click.

function buildSetGoal(set) {
  const { defense, resist } = setDefenseResist(set);
  return {
    id: `set::${set.id}`, type: 'set', name: set.name, sourceId: set.id,
    meta: {
      rarity: set.rarity, rankLabel: rankLabelOf(set.rank),
      img: getArmorImagePath(set.id), emoji: '🛡️',
      statLine: `${set.pieces.length} pieces`,
      skills: setSkillMeta(set), zenny: set.totalZenny || 0,
      defense, resist,
      slots: set.pieces.flatMap(p => slotLevels(p.slots)).sort((a, b) => b - a),
    },
    materials: (set.allMaterials || []).map(m => ({ name: m.name, qty: m.quantity })),
  };
}

function buildPieceGoal(piece, parent = null) {
  if (!piece.materials?.length) return null;
  const def = piece.defense;
  return {
    id: `piece::${piece.id}`, type: 'piece', name: piece.name, sourceId: piece.id,
    meta: {
      rarity: piece.rarity ?? parent?.rarity,
      rankLabel: rankLabelOf(piece.rank ?? parent?.rank),
      img: getArmorPieceImagePath(piece.id),
      emoji: PIECE_ICONS[piece.kind] || '⬡',
      kind: piece.kind, // for the Gear-tab armor sort (head→chest→arms→waist→legs)
      statLine: [`DEF ${def?.base || '?'}–${def?.max || '?'}`, resistanceLine(piece.resistances)].filter(Boolean).join(' · '),
      skills: skillMeta(piece.skills),
      defense: def?.max ?? def?.base ?? 0,
      resist: piece.resistances || null,
      zenny: piece.zennyCost || 0,
      slots: slotLevels(piece.slots),
      parent: (parent?.id ?? piece.setId) != null ? `set::${parent?.id ?? piece.setId}` : null,
    },
    materials: piece.materials.map(m => ({ name: m.name, qty: m.quantity })),
  };
}

function buildCharmGoal(charm) {
  if (!charm.materials?.length) return null;
  return {
    id: `charm::${charm.id}`, type: 'charm', name: charm.name, sourceId: charm.id,
    meta: {
      rarity: charm.rarity, rankLabel: rankLabelOf(charm.rank), img: null, emoji: '📿',
      statLine: '', skills: skillMeta(charm.skills), zenny: charm.zennyCost || 0,
    },
    materials: charm.materials.map(m => ({ name: m.name, qty: m.quantity })),
  };
}

// Pendants are almost always quest/counter acquisitions with no crafting
// materials, so this yields a material-less "acquisition goal" (tracked as
// done/not-done, absent from the Hunt Plan). The rare pendant that does have
// materials flows through the normal material path.
function buildPendantGoal(pendant) {
  return {
    id: `pendant::${pendant.id}`, type: 'pendant', name: pendant.name, sourceId: pendant.id,
    meta: {
      rarity: pendant.rarity, rankLabel: '', img: getPendantImagePath(pendant.id), emoji: '🎀',
      statLine: pendant.quest || 'Pendant', acquire: pendant.quest || '', skills: [], zenny: pendant.zennyCost || 0,
    },
    materials: (pendant.materials || []).map(m => ({ name: m.name, qty: m.quantity })),
  };
}

function buildPalicoGoal(set) {
  if (!set.materials?.length) return null;
  return {
    id: `palico::${set.id}`, type: 'palico', name: set.name, sourceId: set.id,
    meta: {
      rarity: set.rarity, rankLabel: rankLabelOf(set.rank), img: getPalicoImagePath(set.id), emoji: '🐱',
      statLine: `DEF ${set.defense}`, skills: [], defense: set.defense || 0,
      resist: set.resistances || null, zenny: set.totalZenny || 0,
    },
    materials: set.materials.map(m => ({ name: m.name, qty: m.quantity })),
  };
}

// Cost of building a weapon's whole upgrade chain from scratch: forge the base
// tier, then upgrade through each subsequent tier. (Summing craft+upgrade on
// every tier would double-count the ~54 weapons that have both recipes.)
function weaponChainSummary(group) {
  const matTotals = {};
  let totalZenny = 0;
  group.weapons.forEach((w, i) => {
    const craftMats = w.crafting?.craftingMaterials || [];
    const upgradeMats = w.crafting?.upgradeMaterials || [];
    const craftZenny = w.crafting?.craftingZennyCost || 0;
    const upgradeZenny = w.crafting?.upgradeZennyCost || 0;
    // Base tier: forge it. Later tiers: upgrade into them. Fall back either way.
    const useCraft = i === 0 ? craftMats.length || !upgradeMats.length : !upgradeMats.length && craftMats.length;
    const mats = useCraft ? craftMats : upgradeMats;
    for (const m of mats) matTotals[m.name] = (matTotals[m.name] || 0) + m.quantity;
    totalZenny += useCraft ? craftZenny : upgradeZenny;
  });
  const summaryMats = Object.entries(matTotals)
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity);
  return { summaryMats, totalZenny };
}

// Weapon upgrade chain: base-tier forge cost + each later tier's upgrade cost.
// `summaryMats`/`totalZenny` are already computed by the caller (renderWeaponGroupCard).
function buildChainGoal(group, summaryMats, totalZenny) {
  if (!summaryMats.length) return null;
  const endWeapon = group.weapons[group.weapons.length - 1];
  const kindLabel = WEAPON_KIND_LABELS[group.kind] || group.kind;
  const rankLabel = group.hasHighRank && group.hasLowRank ? 'LR → HR' : group.hasHighRank ? 'High Rank' : 'Low Rank';
  return {
    id: `weapon-chain::${group.id}`, type: 'weapon-chain', name: group.name, sourceId: group.id,
    meta: {
      rarity: group.maxRarity, rankLabel,
      img: getWeaponImagePath(endWeapon.id), emoji: WEAPON_KIND_ICONS[group.kind] || '⚔️',
      statLine: `${kindLabel} · ${group.weapons.length} tiers · ${weaponStatLine(endWeapon)}`,
      skills: skillMeta(endWeapon.skills), defense: endWeapon.defenseBonus || 0, zenny: totalZenny || 0,
      attack: endWeapon.damage?.display ?? endWeapon.damage?.raw ?? null,
      affinity: endWeapon.affinity || 0,
      specials: weaponSpecialsMeta(endWeapon),
      slots: slotLevels(endWeapon.slots),
    },
    materials: summaryMats.map(m => ({ name: m.name, qty: m.quantity })),
  };
}

// Full weapon-tier goal (materials embedded) for one path. `path` is 'craft'
// (forge) or 'upgrade'. Returns null if that path has no recipe. One source of
// truth for the per-tier pins, the chain-from-here pins, and item-1's tierIndex.
function buildTierGoal(group, w, path) {
  const mats = path === 'craft' ? (w.crafting?.craftingMaterials || []) : (w.crafting?.upgradeMaterials || []);
  if (!mats.length) return null;
  const zenny = path === 'craft' ? (w.crafting?.craftingZennyCost || 0) : (w.crafting?.upgradeZennyCost || 0);
  const other = path === 'craft' ? 'upgrade' : 'craft';
  return {
    id: `weapon::${w.id}::${path}`,
    type: 'weapon',
    name: w.name,
    sourceId: w.id,
    replaces: `weapon::${w.id}::${other}`, // the two paths to a tier are mutually exclusive
    meta: {
      rarity: w.rarity,
      rankLabel: rankLabelOf(w.rank),
      img: getWeaponImagePath(w.id),
      emoji: WEAPON_KIND_ICONS[w.kind] || '⚔️',
      statLine: weaponStatLine(w),
      skills: skillMeta(w.skills),
      defense: w.defenseBonus || 0,
      attack: w.damage?.display ?? w.damage?.raw ?? null,
      affinity: w.affinity || 0,
      specials: weaponSpecialsMeta(w),
      slots: slotLevels(w.slots),
      zenny,
      pathLabel: path === 'craft' ? 'Forge' : 'Upgrade',
      parent: `weapon-chain::${group.id}`,
      tierIndex: group.weapons.indexOf(w),
    },
    materials: mats.map(m => ({ name: m.name, qty: m.quantity })),
  };
}

// Goals for "pin this tier and every higher one". The starting tier uses
// `startPath` (whichever cost row the user clicked); higher tiers climb by
// upgrade, and every tier falls back to its other recipe if the preferred one
// doesn't exist (some base tiers only have an upgrade recipe, upgrading in from
// another tree).
function chainFromTierGoals(group, fromIndex, startPath = null) {
  const out = [];
  for (let i = fromIndex; i < group.weapons.length; i++) {
    const w = group.weapons[i];
    const hasCraft = (w.crafting?.craftingMaterials || []).length > 0;
    const hasUpgrade = (w.crafting?.upgradeMaterials || []).length > 0;
    let path;
    if (i === fromIndex && startPath) path = startPath;
    else path = i === 0 ? (hasCraft ? 'craft' : 'upgrade') : (hasUpgrade ? 'upgrade' : 'craft');
    const g = buildTierGoal(group, w, path);
    if (g) out.push(g);
  }
  return out;
}

// Full goal for a gallery-tile / search-result item, dispatched by _type.
function buildGoalForItem(item) {
  switch (item._type) {
    case 'set': return buildSetGoal(item);
    case 'charm': return buildCharmGoal(item);
    case 'pendant': return buildPendantGoal(item);
    case 'palico': return buildPalicoGoal(item);
    case 'weapon-group': {
      const { summaryMats, totalZenny } = weaponChainSummary(item);
      return buildChainGoal(item, summaryMats, totalZenny);
    }
    default: return null;
  }
}

// ---- Render a single armor set card ----
export function renderSetCard(set, sortInfo = null) {
  const rarityColor = getRarityColor(set.rarity);
  const imageSrc = getArmorImagePath(set.id);
  const goal = buildSetGoal(set);

  return `
    <div class="set-card" data-set-id="${set.id}" id="set-card-${set.id}">
      <div class="set-card-header" role="button" tabindex="0" aria-expanded="false">
        <div class="set-card-info">
          <div class="set-card-name">
            <span>${escapeHtml(set.name)}</span>
          </div>
          <div class="set-card-meta">
            <span class="rarity-badge" style="color: ${rarityColor}">
              ★ Rarity ${set.rarity}
            </span>
            <span class="rank-badge">${set.rank}</span>
            <span>${set.pieces.length} pieces</span>
          </div>
          ${collapsedSetStats(goal.meta, set, sortInfo)}
          ${slotsRow(goal.meta.slots)}
          ${collapsedSkillChips(goal.meta.skills)}
        </div>
        ${pinGoalBtn(goal, { header: true })}
        <span class="set-card-chevron" aria-hidden="true">▼</span>
      </div>
      <div class="set-details">
        <div class="set-details-inner">
          <div class="set-overview">
            ${imageSrc ? `
              <div class="set-preview-image">
                <img src="${imageSrc}" alt="${escapeHtml(set.name)} preview" loading="lazy" />
              </div>
            ` : ''}
            ${renderFullSetSummary(set)}
          </div>
          ${renderPieceList(set)}
        </div>
      </div>
    </div>
  `;
}

// ---- Full set material summary ----
// No pin here — the set card's header pin covers "pin the whole set".
function renderFullSetSummary(set) {
  const materialChips = set.allMaterials.map(mat => materialChipHtml(mat.name, mat.quantity)).join('');

  return `
    <div class="full-set-summary">
      <div class="summary-header">
        <h4>📦 Full Set Materials</h4>
      </div>
      <div class="material-list">
        ${materialChips}
      </div>
      ${zennyCostLine(set.totalZenny)}
      <div class="material-source-container" id="mat-source-${set.id}"></div>
    </div>
  `;
}

// ---- Render individual pieces ----
function renderPieceList(set) {
  return `
    <div class="piece-list">
      ${set.pieces.map(piece => renderPiece(piece, set)).join('')}
    </div>
  `;
}

// Shared skeleton for collapsible gear cards — armor pieces and weapon tiers
// use the same .piece-card shell (header: image / title / stats / extra rows,
// pins, chevron; details hidden until expand). Type-specific content stays in
// the callers; card-layout changes happen here once.
function gearCardShell({ className = '', imgHtml = '', titleHtml, statsHtml = '', extraRowsHtml = '', pinsHtml = '', detailsHtml = '' }) {
  return `
    <div class="piece-card${className ? ` ${className}` : ''}">
      <div class="piece-header" role="button" tabindex="0" aria-expanded="false">
        ${imgHtml}
        <div class="piece-header-info">
          ${titleHtml}
          ${statsHtml ? `<div class="piece-stats">${statsHtml}</div>` : ''}
          ${extraRowsHtml}
        </div>
        ${pinsHtml}
        <span class="piece-chevron" aria-hidden="true">▼</span>
      </div>
      <div class="piece-details">${detailsHtml}</div>
    </div>
  `;
}

function renderPiece(piece, parent = null) {
  const icon = PIECE_ICONS[piece.kind] || '⬡';
  const def = piece.defense;
  const pieceImageSrc = getArmorPieceImagePath(piece.id);

  const resistances = piece.resistances ? Object.entries(piece.resistances).map(([elem, val]) => {
    const cls = val > 0 ? 'positive' : val < 0 ? 'negative' : 'neutral';
    const sign = val > 0 ? '+' : '';
    return `<span class="res-item ${cls}">${elementIcon(elem)}${sign}${val}</span>`;
  }).join('') : '';

  const materialChips = piece.materials.map(mat => materialChipHtml(mat.name, mat.quantity)).join('');

  const pieceGoal = buildPieceGoal(piece, parent);

  return gearCardShell({
    imgHtml: pieceImageSrc
      ? `<img src="${pieceImageSrc}" alt="${escapeHtml(piece.name)}" class="piece-img" loading="lazy" />`
      : `<span class="piece-kind-icon">${icon}</span>`,
    titleHtml: `<span class="piece-name">${escapeHtml(piece.name)}</span>`,
    statsHtml: `
      <span class="piece-defense">${defenseIcon()} ${def?.base || '?'}-${def?.max || '?'}</span>
      ${resistances ? `<div class="resistances">${resistances}</div>` : ''}
    `,
    extraRowsHtml: pieceGoal ? slotsRow(pieceGoal.meta.slots) + collapsedSkillChips(pieceGoal.meta.skills) : '',
    pinsHtml: pieceGoal ? pinGoalBtn(pieceGoal, { header: true }) : '',
    detailsHtml: `
      <div class="piece-materials">
        <div class="summary-header">
          <h4>Materials</h4>
        </div>
        <div class="material-list">${materialChips}</div>
        ${piece.zennyCost ? zennyCostLine(piece.zennyCost) : ''}
        <div class="material-source-container"></div>
      </div>
    `,
  });
}

function renderPieceCardStandalone(piece, sortInfo = null) {
  return `
    <div class="set-card expanded" data-piece-id="${piece.id}" style="cursor: default;">
      <div class="set-card-header" style="padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border-subtle);">
        <div class="set-card-info">
          <div class="set-card-name" style="font-size: 0.95rem; color: var(--text-secondary);">
            Part of <strong style="color: var(--text-primary); margin-left: 0.25rem;">${escapeHtml(piece.setName)}</strong> Set
          </div>
          <div class="set-card-meta">
            <span class="rank-badge">${piece.rank}</span>
            ${matchedSkillChip(piece)}
            ${sortEmphasis(piece, sortInfo)}
          </div>
        </div>
      </div>
      <div class="set-details" style="max-height: none;">
        <div class="set-details-inner" style="border-top: none; padding-top: 1.25rem;">
          ${renderPiece(piece)}
        </div>
      </div>
    </div>
  `;
}

export function renderCharmCard(charm) {
  const rarityColor = getRarityColor(charm.rarity);
  
  const skillTags = (charm.skills || []).map(s => {
    return `<span class="skill-tag" data-skill="${escapeHtml(s.name)}" data-skill-level="${s.level}">
      ${escapeHtml(s.name)} Lv${s.level}
    </span>`;
  }).join('');

  const materialChips = (charm.materials || []).map(mat => materialChipHtml(mat.name, mat.quantity)).join('');

  const charmGoal = buildCharmGoal(charm);

  return `
    <div class="set-card expanded" data-charm-id="${charm.id}" style="cursor: default;">
      <div class="set-card-header" style="padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border-subtle);">
        <div class="set-card-info">
          <div class="set-card-name" style="font-size: 1.05rem;">
            <span class="piece-kind-icon">📿</span>
            <span>${escapeHtml(charm.name)}</span>
          </div>
          <div class="set-card-meta">
            <span class="rarity-badge" style="color: ${rarityColor}">
              ★ Rarity ${charm.rarity}
            </span>
            <span class="rank-badge">${charm.rank}</span>
            ${matchedSkillChip(charm)}
          </div>
        </div>
        ${charmGoal ? pinGoalBtn(charmGoal, { header: true }) : ''}
      </div>
      <div class="set-details" style="max-height: none;">
        <div class="set-details-inner" style="border-top: none; padding-top: 1.25rem;">
          ${skillTags ? `<div class="piece-skills" style="margin-bottom: 1rem;">${skillTags}</div>` : ''}
          <div class="piece-materials" style="border-top: none; padding-top: 0;">
            <div class="summary-header">
              <h4>Materials</h4>
            </div>
            <div class="material-list">${materialChips}</div>
            ${charm.zennyCost ? zennyCostLine(charm.zennyCost) : ''}
            <div class="material-source-container"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderPendantCard(pendant) {
  const rarityColor = getRarityColor(pendant.rarity);
  const imageSrc = getPendantImagePath(pendant.id);

  const materialChips = (pendant.materials || []).map(mat => materialChipHtml(mat.name, mat.quantity)).join('');

  const pendantGoal = buildPendantGoal(pendant);

  const bodyContent = materialChips ? `
    <div class="piece-materials" style="border-top: none; padding-top: 0;">
      <div class="summary-header">
        <h4>Materials</h4>
      </div>
      <div class="material-list">${materialChips}</div>
      <div class="material-source-container"></div>
    </div>
  ` : '<div style="color: var(--text-muted); font-size: 0.85rem;">No crafting materials required.</div>';

  return `
    <div class="set-card expanded" data-pendant-id="${pendant.id}" style="cursor: default;">
      <div class="set-card-header" style="padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border-subtle);">
        <div class="set-card-info">
          <div class="set-card-name" style="font-size: 1.05rem;">
            <span class="piece-kind-icon">🎀</span>
            <span>${escapeHtml(pendant.name)}</span>
          </div>
          <div class="set-card-meta">
            <span class="rarity-badge" style="color: ${rarityColor}">
              ★ Rarity ${pendant.rarity}
            </span>
            <span class="rank-badge" style="background: var(--bg-alt); color: var(--text-secondary); border: 1px solid var(--border-subtle);">${pendant.quest || 'Pendant'}</span>
          </div>
        </div>
        ${pendantGoal ? pinGoalBtn(pendantGoal, { header: true }) : ''}
      </div>
      <div class="set-details" style="max-height: none;">
        <div class="set-details-inner" style="border-top: none; padding-top: 1.25rem;">
          <div class="set-overview">
            ${imageSrc ? `
              <div class="set-preview-image set-preview-image--pendant">
                <img src="${imageSrc}" alt="${escapeHtml(pendant.name)} preview" loading="lazy" />
              </div>
            ` : ''}
            <div class="set-overview-body">
              ${bodyContent}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- Material source popup ----
export function renderMaterialSource(materialName) {
  const monsterSources = materialIndex[materialName] || [];
  const gatherSources = gatheringSources[materialName] || [];
  const quests = findQuestsForMaterial(materialName, monsterSources);

  let html = `
    <div class="material-source">
      <div class="source-header">🔍 Sources for "${escapeHtml(materialName)}"</div>
  `;

  // "Quest Reward" is an acquisition method, not a gathering type — split it out
  // so it renders in the QUESTS section, not under the 🪨 Gathering header.
  const realGather = gatherSources.filter(g => g.type !== 'Quest Reward');
  const questRewardNotes = gatherSources.filter(g => g.type === 'Quest Reward');

  // Gathering sources first — gathering is far easier than carving a monster,
  // so it's the recommended way to get a material when available (e.g. bones
  // come from bonepiles as well as field-carcass "rotten carves").
  if (realGather.length > 0) {
    html += `<div class="source-monster">
      <div class="source-monster-name">🪨 Gathering <span class="source-recommended">easiest</span></div>
      <table class="drop-table">
        <thead><tr><th>Type</th><th>Location / Source</th></tr></thead>
        <tbody>
          ${realGather.map(g => `
            <tr>
              <td class="kind">${escapeHtml(g.type)}</td>
              <td>${escapeHtml(g.source)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // Monster sources
  if (monsterSources.length > 0) {
    for (const source of monsterSources) {
      html += `
        <div class="source-monster">
          <div class="source-monster-name">🐲 ${escapeHtml(source.monsterName)}</div>
          <table class="drop-table">
            <thead><tr><th>Method</th><th>Detail</th><th>Chance</th><th>Qty</th></tr></thead>
            <tbody>
              ${source.drops.map(d => `
                <tr>
                  <td class="kind">${formatKind(d.kind)}</td>
                  <td>${d.subtype ? escapeHtml(d.subtype) : '—'}</td>
                  <td class="chance">${d.chance}%</td>
                  <td>${d.quantity}x</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  if (monsterSources.length === 0 && gatherSources.length === 0 && quests.length === 0) {
    html += `<div style="color: var(--text-muted); font-size: 0.8rem; margin: 0.5rem 0;">
      No specific drop data found — may be obtained via gathering, quest reward, or trade.
    </div>`;
  }

  // Quest sources. Show matched quest chips; fall back to any curated
  // "Quest Reward" note only when we have no concrete quest chips (otherwise
  // the note is redundant with the list below it).
  if (quests.length > 0 || questRewardNotes.length > 0) {
    html += `<div class="source-quests"><h4 style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.35rem;">QUESTS</h4>`;
    for (const quest of quests) {
      const badge = getQuestBadgeInfo(quest);
      const multiWarning = quest.targetCount > 1
        ? `<span class="warning-icon">⚠️ ${quest.targetCount} targets</span>`
        : '';
      const exclusive = quest.matchType === 'exclusive'
        ? '<span style="color: var(--gold); font-weight: 600;">★ </span>'
        : '';
      const rank = quest.stars ? `<span class="quest-rank">★${quest.stars}</span>` : '';
      html += `
        <span class="quest-chip ${badge.class}">
          ${exclusive}${badge.icon} ${escapeHtml(quest.name)}${rank} ${multiWarning}
        </span>
      `;
    }
    if (quests.length === 0) {
      for (const note of questRewardNotes) {
        html += `<div style="color: var(--text-secondary); font-size: 0.78rem; margin: 0.15rem 0;">${escapeHtml(note.source)}</div>`;
      }
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

// Stat-icon legend for the reference panel's Legend tab. Lives here (not in
// reference-panel.js) so it can reuse the private icon helpers; injected via
// initReferencePanel, same as renderMaterialSource — reference-panel.js never
// imports ui.js (ui.js already imports showSkill from it → would cycle).
export function renderStatLegend() {
  const elemRow = Object.keys(ELEMENT_NAMES)
    .map(e => `<span class="legend-chip">${elementIcon(e)} ${ELEMENT_NAMES[e]}</span>`).join('');
  const statusRow = ['poison', 'paralysis', 'sleep', 'blastblight']
    .map(s => `<span class="legend-chip">${specialIcon({ status: s })} ${SPECIAL_ELEMENT_NAMES[s]}</span>`).join('');
  const kindRow = Object.entries(PIECE_ICONS)
    .map(([k, glyph]) => `<span class="legend-chip">${glyph} ${k[0].toUpperCase() + k.slice(1)}</span>`).join('');
  // A representative sharpness spread so every color in the ladder shows.
  const sampleSharp = sharpnessBar({ red: 40, orange: 40, yellow: 50, green: 70, blue: 80, white: 50, purple: 20 });

  const row = (head, desc) =>
    `<div class="legend-item"><span class="legend-stat-head">${head}</span><p>${desc}</p></div>`;

  return `
    ${row(`${statIcon('attack', 'Attack')} <strong>Attack</strong>`, 'Raw attack power — higher means more damage per hit.')}
    ${row(`${statIcon('affinity', 'Affinity')} <strong>Affinity</strong>`, 'Critical-hit chance. Negative affinity is a chance to deal reduced damage instead.')}
    ${row(`${statIcon('sharpness', 'Sharpness')} <strong>Sharpness</strong> ${sampleSharp}`, 'Ladder red › orange › yellow › green › blue › white › purple. Higher sharpness raises damage and stops bounces.')}
    ${row(`${defenseIcon()} <strong>Defense</strong>`, 'Armor defense value. Higher reduces damage taken.')}
    ${row(`<span class="legend-icon-row">${elemRow}</span>`, 'Element — bonus elemental damage on a weapon, or elemental resistance on armor (one value per element).')}
    ${row(`<span class="legend-icon-row">${statusRow}</span>`, 'Weapon status ailment — builds up to inflict Poison, Paralysis, Sleep, or Blastblight.')}
    ${row(`${slotIcons([3, 2, 1])} <strong>Slots</strong>`, 'Decoration slot sizes ①②③. A level-N slot holds any decoration of level N or lower.')}
    ${row(`${statIcon('zenny', 'Cost')} <strong>Zenny</strong>`, 'Crafting / upgrade cost in zenny.')}
    ${row(`<span class="legend-icon-row">${kindRow}</span>`, 'Armor slots: the five equipment pieces of a set.')}
  `;
}

export function renderPalicoCard(set, sortInfo = null) {
  const rarityColor = getRarityColor(set.rarity);
  const imageSrc = getPalicoImagePath(set.id);

  const resistances = set.resistances
    ? Object.entries(set.resistances).map(([elem, val]) => {
        const cls = val > 0 ? 'positive' : val < 0 ? 'negative' : 'neutral';
        const sign = val > 0 ? '+' : '';
        return `<span class="res-item ${cls}">${elementIcon(elem)}${sign}${val}</span>`;
      }).join('')
    : '';

  const materialChips = (set.materials || []).map(mat => materialChipHtml(mat.name, mat.quantity)).join('');

  const palicoGoal = buildPalicoGoal(set);

  return `
    <div class="set-card expanded" data-palico-id="${set.id}" style="cursor: default;">
      <div class="set-card-header" style="padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border-subtle);">
        <div class="set-card-info">
          <div class="set-card-name" style="font-size: 1.05rem;">
            <span class="piece-kind-icon">🐱</span>
            <span>${escapeHtml(set.name)}</span>
          </div>
          <div class="set-card-meta">
            <span class="rarity-badge" style="color: ${rarityColor}">★ Rarity ${set.rarity}</span>
            <span class="rank-badge">${set.rank}</span>
            <span class="rank-badge" style="background: var(--bg-alt); color: var(--text-secondary); border: 1px solid var(--border-subtle);">Palico Set</span>
            ${sortEmphasis(set, sortInfo)}
          </div>
        </div>
        ${palicoGoal ? pinGoalBtn(palicoGoal, { header: true }) : ''}
      </div>
      <div class="set-details" style="max-height: none;">
        <div class="set-details-inner" style="border-top: none; padding-top: 1.25rem;">
          <div class="set-overview">
            ${imageSrc ? `
              <div class="set-preview-image set-preview-image--pendant">
                <img src="${imageSrc}" alt="${escapeHtml(set.name)} preview" loading="lazy" />
              </div>
            ` : ''}
            <div class="set-overview-body">
              <div class="palico-stats">
                <div class="piece-defense">${defenseIcon()} DEF ${set.defense}</div>
                ${resistances ? `<div class="resistances" style="margin-top: 0.5rem;">${resistances}</div>` : ''}
              </div>
              ${materialChips ? `
                <div class="piece-materials" style="border-top: none; padding-top: 0; margin-top: 1rem;">
                  <div class="summary-header">
                    <h4>Materials</h4>
                  </div>
                  <div class="material-list">${materialChips}</div>
                  ${set.totalZenny ? zennyCostLine(set.totalZenny) : ''}
                  <div class="material-source-container"></div>
                </div>
              ` : '<div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 1rem;">No crafting materials required.</div>'}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- Weapon Group Card ----
export function renderWeaponGroupCard(group) {
  const kindLabel = WEAPON_KIND_LABELS[group.kind] || group.kind;
  const kindIconPath = getWeaponKindImagePath(group.kind);
  const kindIcon = kindIconPath
    ? `<img src="${kindIconPath}" alt="${escapeHtml(kindLabel)}" class="weapon-kind-icon" />`
    : (WEAPON_KIND_ICONS[group.kind] || '⚔️');
  const rarityColor = getRarityColor(group.maxRarity);
  const rankLabel = group.hasHighRank && group.hasLowRank ? 'LR → HR' : group.hasHighRank ? 'High Rank' : 'Low Rank';

  const { summaryMats, totalZenny } = weaponChainSummary(group);
  const chainGoal = buildChainGoal(group, summaryMats, totalZenny);

  const summaryHtml = summaryMats.length ? `
    <div class="full-set-summary">
      <div class="summary-header">
        <h4>📦 Total Materials (full upgrade chain)</h4>
      </div>
      <div class="material-list">
        ${summaryMats.map(m => materialChipHtml(m.name, m.quantity)).join('')}
      </div>
      ${totalZenny ? zennyCostLine(totalZenny) : ''}
      <div class="material-source-container"></div>
    </div>
  ` : '';

  // ── Tiers: highest rarity first ──
  const tiersHtml = [...group.weapons].reverse().map(w => {
    const attack = w.damage?.display ?? w.damage?.raw ?? '?';
    const affinity = `${w.affinity > 0 ? '+' : ''}${w.affinity || 0}%`;
    const wRarityColor = getRarityColor(w.rarity);

    const specialsHtml = (w.specials || []).map(s =>
      `<span class="weapon-special">${specialIcon(s)} ${s.damage}</span>`
    ).join(' ');

    const craftMats = w.crafting?.craftingMaterials || [];
    const upgradeMats = w.crafting?.upgradeMaterials || [];
    const craftZenny = w.crafting?.craftingZennyCost || 0;
    const upgradeZenny = w.crafting?.upgradeZennyCost || 0;

    // Forge and Upgrade are alternate paths to the same tier; buildTierGoal
    // stamps `replaces` so pinning one unpins the other.
    const craftGoal = buildTierGoal(group, w, 'craft');
    const upgradeGoal = buildTierGoal(group, w, 'upgrade');

    // When higher tiers exist, the pin prompts "this tier only" vs "this +
    // higher"; each path's chain climbs from that path. Top tier → plain pin.
    const tierIndex = group.weapons.indexOf(w);
    const hasHigher = tierIndex < group.weapons.length - 1;
    const craftChain = hasHigher ? chainFromTierGoals(group, tierIndex, 'craft') : null;
    const upgradeChain = hasHigher ? chainFromTierGoals(group, tierIndex, 'upgrade') : null;

    // Pins live on the name row. Material sections mirror the armor layout:
    // a small-caps header, a material-list grid, then the cost underneath.
    // Single-path tiers just say "Materials" (like armor); dual-path tiers label
    // the two paths "Craft" and "Upgrade" to keep them distinct.
    const singlePath = !(craftGoal && upgradeGoal);
    const weaponMatSection = (label, mats, zenny) => `
      <div class="weapon-tier-mats">
        <h4 class="tier-mat-label">${label}</h4>
        <div class="material-list">${mats.map(m => materialChipHtml(m.name, m.quantity)).join('')}</div>
        ${zennyCostLine(zenny)}
      </div>`;
    const craftSection = craftGoal ? weaponMatSection(singlePath ? 'Materials' : 'Forge', craftMats, craftZenny) : '';
    const upgradeSection = upgradeGoal ? weaponMatSection(singlePath ? 'Materials' : 'Upgrade', upgradeMats, upgradeZenny) : '';

    let tierPins = '';
    if (craftGoal && upgradeGoal) {
      tierPins = pinGoalBtn(craftGoal, { chainGoals: craftChain, label: '📌 Forge' })
        + pinGoalBtn(upgradeGoal, { chainGoals: upgradeChain, label: '📌 Upgrade' });
    } else if (craftGoal) {
      tierPins = pinGoalBtn(craftGoal, { chainGoals: craftChain });
    } else if (upgradeGoal) {
      tierPins = pinGoalBtn(upgradeGoal, { chainGoals: upgradeChain });
    }

    const wImgPath = getWeaponImagePath(w.id);
    const thumb = wImgPath ? `<img src="${wImgPath}" alt="${escapeHtml(w.name)}" class="piece-img" loading="lazy" />` : '';
    const skillChips = collapsedSkillChips(skillMeta(w.skills));

    // Each tier is its own collapsible card, sharing the armor-piece shell:
    // header = name/stats/slots/skills summary + pins; details = materials.
    return gearCardShell({
      className: 'weapon-tier',
      imgHtml: thumb,
      titleHtml: `
        <div class="weapon-tier-title">
          <span class="piece-name">${escapeHtml(w.name)}</span>
          <span class="weapon-tier-rarity" style="color:${wRarityColor}">★${w.rarity}</span>
        </div>
      `,
      statsHtml: `
        <span class="weapon-stat">${statIcon('attack', 'Attack')} ${attack}</span>
        <span class="weapon-stat">${statIcon('affinity', 'Affinity')} ${affinity}</span>
        ${specialsHtml ? `<span class="weapon-stat">${specialsHtml}</span>` : ''}
        ${w.sharpness ? `<span class="weapon-stat">${statIcon('sharpness', 'Sharpness')} ${sharpnessBar(w.sharpness)}</span>` : ''}
      `,
      extraRowsHtml: slotsRow(slotLevels(w.slots)) + skillChips,
      pinsHtml: tierPins ? `<span class="weapon-tier-pins">${tierPins}</span>` : '',
      detailsHtml: `
        ${craftSection}${upgradeSection}
        <div class="material-source-container"></div>
      `,
    });
  }).join('');

  return `
    <div class="set-card" id="weapon-group-${escapeHtml(group.id)}">
      <div class="set-card-header" role="button" tabindex="0" aria-expanded="false">
        <div class="set-card-info">
          <div class="set-card-name">
            <span class="piece-kind-icon">${kindIcon}</span>
            <span>${escapeHtml(group.name)}</span>
          </div>
          <div class="set-card-meta">
            <span style="color:var(--text-secondary);font-size:0.8rem;">${kindLabel}</span>
            <span class="rarity-badge" style="color:${rarityColor}">★ R${group.rarity}–R${group.maxRarity}</span>
            <span class="rank-badge">${rankLabel}</span>
            ${matchedSkillChip(group)}
          </div>
          ${collapsedWeaponStats(group.weapons[group.weapons.length - 1])}
          ${slotsRow(slotLevels(group.weapons[group.weapons.length - 1].slots))}
          ${collapsedSkillChips(skillMeta(group.weapons[group.weapons.length - 1].skills))}
        </div>
        ${chainGoal ? pinGoalBtn(chainGoal, { header: true }) : ''}
        <span class="set-card-chevron" aria-hidden="true">▼</span>
      </div>
      <div class="set-details">
        <div class="set-details-inner weapon-group-tiers">
          ${summaryHtml}
          ${tiersHtml}
          <div class="material-source-container"></div>
        </div>
      </div>
    </div>
  `;
}

// ---- Render results list ----
// ---- Gear Grid (Visual mode) ----

// When a stat sort is active, tiles append the sorted value ("why is this
// first?") — otherwise an ordered gallery gives no clue what it's ordered by.
function sortStatBadge(item, sortInfo) {
  if (!sortInfo) return '';
  const v = sortInfo.valueOf(item);
  if (!Number.isFinite(v)) return '';
  const icon = sortInfo.key === 'defense' ? defenseIcon() : elementIcon(sortInfo.key);
  return ` · <span class="tile-sort-stat">${icon} ${v > 0 && sortInfo.key !== 'defense' ? '+' : ''}${v}</span>`;
}

function renderGridTile(item, index, sortInfo = null) {
  let imgHtml, subtitle;

  if (item._type === 'set') {
    const imgPath = getArmorImagePath(item.id)
      || (item.pieces || []).reduce((found, p) => found || getArmorPieceImagePath(p.id), null);
    imgHtml = imgPath
      ? `<img src="${imgPath}" alt="${escapeHtml(item.name)}" loading="lazy" />`
      : `<span class="gear-tile-emoji">⚔️</span>`;
    const rarityColor = getRarityColor(item.rarity);
    subtitle = `<span style="color:${rarityColor}">★${item.rarity}</span> · ${item.rank === 'high' ? 'High Rank' : 'Low Rank'}`;
  } else if (item._type === 'charm') {
    imgHtml = `<span class="gear-tile-emoji">📿</span>`;
    subtitle = `Charm · ${item.rank === 'high' ? 'High Rank' : 'Low Rank'}`;
  } else if (item._type === 'palico') {
    const imgPath = getPalicoImagePath(item.id);
    imgHtml = imgPath
      ? `<img src="${imgPath}" alt="${escapeHtml(item.name)}" loading="lazy" />`
      : `<span class="gear-tile-emoji">🐱</span>`;
    const rarityColor = getRarityColor(item.rarity);
    subtitle = `<span style="color:${rarityColor}">★${item.rarity}</span> · ${item.rank === 'high' ? 'High Rank' : 'Low Rank'} · Palico`;
  } else if (item._type === 'weapon-group') {
    // Use the end-tier weapon's image for the tile
    const endWeapon = item.weapons[item.weapons.length - 1];
    const wImgPath = getWeaponImagePath(endWeapon.id);
    const wkImgPath = !wImgPath && getWeaponKindImagePath(item.kind);
    imgHtml = wImgPath
      ? `<img src="${wImgPath}" alt="${escapeHtml(endWeapon.name)}" loading="lazy" />`
      : wkImgPath
        ? `<img src="${wkImgPath}" alt="${escapeHtml(WEAPON_KIND_LABELS[item.kind] || item.kind)}" loading="lazy" />`
        : `<span class="gear-tile-emoji">${WEAPON_KIND_ICONS[item.kind] || '⚔️'}</span>`;
    const rarityColor = getRarityColor(item.maxRarity);
    const kindLabel = WEAPON_KIND_LABELS[item.kind] || item.kind;
    const rankLabel = item.hasHighRank && item.hasLowRank ? 'LR→HR' : item.hasHighRank ? 'High Rank' : 'Low Rank';
    subtitle = `${kindLabel} · <span style="color:${rarityColor}">★R${item.rarity}–R${item.maxRarity}</span> · ${rankLabel}`;
  } else {
    const imgPath = getPendantImagePath(item.id);
    imgHtml = imgPath
      ? `<img src="${imgPath}" alt="${escapeHtml(item.name)}" loading="lazy" />`
      : `<span class="gear-tile-emoji">🎀</span>`;
    subtitle = 'Pendant';
  }

  const goal = buildGoalForItem(item);
  const pin = goal ? pinGoalBtn(goal, { tile: true }) : '';

  return `
    <div class="gear-tile" data-index="${index}" role="button" tabindex="0" aria-label="${escapeHtml(item.name)}">
      <div class="gear-tile-img">${imgHtml}${pin}</div>
      <div class="gear-tile-info">
        <div class="gear-tile-name">${escapeHtml(item.name)}</div>
        <div class="gear-tile-meta">${subtitle}${sortStatBadge(item, sortInfo)}</div>
      </div>
    </div>
  `;
}

// ---- Incremental batch rendering ----
// The full result set can be huge (all-weapons ≈ 411 cards / 82k DOM nodes /
// 10MB of HTML) and we re-render it on every filter/sort/type change. Rendering
// it all at once is slow and memory-heavy, so we render one batch up front and
// append the next as an IntersectionObserver sentinel nears the viewport. Cards
// already rendered stay in the DOM (no node recycling) — simplest thing that
// works with variable-height, expandable cards.
const RESULT_BATCH_SIZE = 40;
const BATCH_PREFETCH_MARGIN = '800px'; // load the next batch ~a screen before the end
let batchObserver = null;
let batchSentinel = null;

// Stop any in-flight batching (previous result set). Called at the top of every
// results-replacing render so a stale observer can't append into the new list.
export function teardownBatching() {
  batchObserver?.disconnect();
  batchObserver = null;
  batchSentinel?.remove();
  batchSentinel = null;
}

// Render `items` into `container` in batches. `renderItem(item, absoluteIndex)`
// returns a card's HTML; `attach(root)` wires listeners for a batch (run on a
// DocumentFragment before insertion — listeners survive the move into the DOM).
// `gridWrap` nests the batches in a `.gear-grid` for the gallery view.
function renderInBatches({ container, items, renderItem, attach, gridWrap = false }) {
  teardownBatching();
  container.innerHTML = '';
  const target = gridWrap
    ? container.appendChild(Object.assign(document.createElement('div'), { className: 'gear-grid' }))
    : container;

  batchSentinel = document.createElement('div');
  batchSentinel.className = 'batch-sentinel';
  batchSentinel.setAttribute('aria-hidden', 'true');
  target.appendChild(batchSentinel);

  let rendered = 0;
  const renderNext = () => {
    const slice = items.slice(rendered, rendered + RESULT_BATCH_SIZE);
    if (!slice.length) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = slice.map((item, i) => renderItem(item, rendered + i)).join('');
    const frag = document.createDocumentFragment();
    while (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
    attach(frag); // fragments support querySelectorAll; listeners persist on insertion
    target.insertBefore(frag, batchSentinel);
    rendered += slice.length;
    if (rendered >= items.length) teardownBatching(); // all in — drop sentinel/observer
  };

  renderNext(); // first batch, synchronous
  if (rendered < items.length) {
    batchObserver = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) renderNext();
    }, { rootMargin: BATCH_PREFETCH_MARGIN });
    batchObserver.observe(batchSentinel);
  }
}

export function renderGrid(items, container, onTileClick, sortInfo = null) {
  teardownBatching();
  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No results</h3>
        <p>Try adjusting the rank or type filters.</p>
      </div>
    `;
    return;
  }

  renderInBatches({
    container,
    items,
    gridWrap: true,
    renderItem: (item, i) => renderGridTile(item, i, sortInfo),
    attach: (root) => {
      root.querySelectorAll('.gear-tile').forEach(tile => {
        const activate = () => onTileClick(items[+tile.dataset.index]);
        tile.addEventListener('click', (e) => {
          if (e.target.closest('.pin-goal-btn')) return; // pin handles itself
          activate();
        });
        tile.addEventListener('keydown', (e) => {
          if (e.target !== tile) return; // Enter/Space on the tile pin, not the tile itself
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
        });
      });
      attachPinListeners(root);
    },
  });
}

export function renderGridDetail(item, container, onBack) {
  teardownBatching();
  let cardHtml;
  if (item._type === 'charm') cardHtml = renderCharmCard(item);
  else if (item._type === 'pendant') cardHtml = renderPendantCard(item);
  else if (item._type === 'palico') cardHtml = renderPalicoCard(item);
  else if (item._type === 'weapon-group') cardHtml = renderWeaponGroupCard(item);
  else cardHtml = renderSetCard(item);

  container.innerHTML = `
    <div class="grid-detail-view">
      <button class="back-btn" id="back-to-grid"><strong>← Back to equipment gallery</strong></button>
      ${cardHtml}
    </div>
  `;

  // Auto-expand set cards (charms are already expanded by default)
  const card = container.querySelector('.set-card:not(.expanded)');
  if (card) {
    card.classList.add('expanded');
    const header = card.querySelector('.set-card-header');
    if (header) header.setAttribute('aria-expanded', 'true');
  }

  container.querySelector('#back-to-grid').addEventListener('click', onBack);
  attachCardListeners(container);
}

export function renderResults(items, container, sortInfo = null) {
  teardownBatching();
  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No armor sets or pieces found</h3>
        <p>Try a different search term. You can search by set name, piece name, or material name.</p>
      </div>
    `;
    return;
  }

  renderInBatches({
    container,
    items,
    renderItem: (item) => {
      if (item._type === 'piece') return renderPieceCardStandalone(item, sortInfo);
      if (item._type === 'charm') return renderCharmCard(item);
      if (item._type === 'pendant') return renderPendantCard(item);
      if (item._type === 'palico') return renderPalicoCard(item, sortInfo);
      if (item._type === 'weapon-group') return renderWeaponGroupCard(item);
      return renderSetCard(item, sortInfo);
    },
    attach: (root) => attachCardListeners(root),
  });
}

// ---- Loading state ----
export function renderLoading(container) {
  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading armor data...</p>
    </div>
  `;
}

// ---- Welcome state ----
// Interactive explainer: each card *does* the thing it describes — example
// chips run real searches (teaching skill/material search by doing), and the
// panel buttons trigger the same toggles as the floating 📖 / 📌 corners.
export function renderWelcome(container) {
  teardownBatching();
  container.innerHTML = `
    <div class="empty-state welcome-state">
      <h3>⚔️ Search for equipment</h3>
      <div class="welcome-cards">
        <div class="welcome-card">
          <div class="welcome-card-icon">🔎</div>
          <h4>Search anything</h4>
          <p>Sets, pieces, materials — or skills you want on your build.</p>
          <div class="welcome-try">
            <span class="welcome-try-label">Try:</span>
            <button class="welcome-chip" data-try="Gore α">Gore α</button>
            <button class="welcome-chip" data-try="Flinch Free">Flinch Free</button>
            <button class="welcome-chip" data-try="Wyvern Gem">Wyvern Gem</button>
          </div>
        </div>
        <div class="welcome-card">
          <div class="welcome-card-icon">📖</div>
          <h4>Skill dictionary</h4>
          <p>Browse every skill's levels and jump straight to gear that carries it.</p>
          <button class="welcome-action" data-open="ref-toggle">Open reference</button>
        </div>
        <div class="welcome-card">
          <div class="welcome-card-icon">📌</div>
          <h4>Farming list</h4>
          <p>Pin gear to build a hunt plan with drop sources, quests, and progress.</p>
          <button class="welcome-action" data-open="farming-toggle">Open list</button>
        </div>
      </div>
      <p class="welcome-footnote">Filter by type &amp; rank, or sort by stats, with the controls above — sorted results show the ranking stat on every card.</p>
    </div>
  `;

  container.querySelectorAll('.welcome-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('search-input');
      input.value = btn.dataset.try;
      input.dispatchEvent(new Event('input', { bubbles: true })); // normal search path, works in list & visual modes
      input.focus();
    });
  });
  container.querySelectorAll('.welcome-action').forEach(btn => {
    btn.addEventListener('click', () => document.getElementById(btn.dataset.open)?.click());
  });
}

// Goal pin (📌 on a piece / tier / set summary / weapon chain / card header /
// gallery tile) → one goal. Header and tile pins embed their materials in the
// data-goal payload (no adjacent chips to read); chip-adjacent pins leave
// materials out and we read them from the sibling material chips in scope.
// Shared by the list/detail views (attachCardListeners) and the gallery grid.
function pinFlash(btn) {
  btn.classList.add('pinned-flash');
  setTimeout(() => btn.classList.remove('pinned-flash'), 600);
}

// Resolve a pin button's goal, filling materials from sibling chips when the
// payload didn't embed them (chip-adjacent pins).
function goalFromPinBtn(btn) {
  let goal;
  try { goal = JSON.parse(btn.dataset.goal); } catch { return null; }
  if (!Array.isArray(goal.materials) || !goal.materials.length) {
    const scope = btn.closest('.weapon-tier-mats, .full-set-summary, .piece-materials');
    const chips = scope ? scope.querySelectorAll('.material-chip') : [];
    goal.materials = [...chips].map(c => ({ name: c.dataset.material, qty: parseInt(c.dataset.qty, 10) || 1 }));
  }
  return goal;
}

// The "this tier only / this + N higher" prompt for weapon-tier pins. Only one
// is open at a time; it closes on choose, outside-click, or Escape.
let openPinPrompt = null;
function closePinPrompt() {
  openPinPrompt?.remove();
  openPinPrompt = null;
}
function showPinPrompt(btn, thisGoal, chainGoals) {
  closePinPrompt();
  const menu = document.createElement('div');
  menu.className = 'pin-prompt';
  menu.innerHTML = `
    <button data-choice="one">📌 This tier only</button>
    <button data-choice="chain">📌 This + ${chainGoals.length - 1} higher tier${chainGoals.length - 1 !== 1 ? 's' : ''}</button>
  `;
  // Fixed to the viewport (position: fixed) so it needs no scroll-into-view —
  // the page uses smooth scrolling, which would otherwise leave it "moving".
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth || 208;
  menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  menu.addEventListener('click', (e) => {
    const choice = e.target.closest('[data-choice]')?.dataset.choice;
    if (!choice) return;
    if (choice === 'one') addGoal(thisGoal); else addGoals(chainGoals);
    pinFlash(btn);
    closePinPrompt();
  });
  openPinPrompt = menu;
}
document.addEventListener('click', (e) => {
  if (openPinPrompt && !e.target.closest('.pin-prompt, .pin-goal-btn')) closePinPrompt();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePinPrompt(); });

// ---- Skill detail band (in-flow, one at a time) ----
// Inserted as a full-width sibling immediately AFTER the card's header row
// (not inside its centered flex column) so the header height — and the gear
// icon — never move. Because it's in normal flow it scrolls with the card and
// never covers the header or the card's own materials. One open at a time.
let openSkillBand = null; // { el, skill }
function closeSkillBand() {
  openSkillBand?.el.remove();
  openSkillBand = null;
}
function toggleSkillBand(tag) {
  const skillName = tag.dataset.skill;
  if (openSkillBand?.skill === skillName && openSkillBand.el.isConnected) { closeSkillBand(); return; }
  closeSkillBand();
  const html = renderSkillBand(skillName, parseInt(tag.dataset.skillLevel, 10));
  if (!html) return;
  // Header chips → after the header row. Charm skills live in the details (no
  // header), so anchor them after their own skills row.
  const anchor = tag.closest('.piece-header, .set-card-header') || tag.closest('.piece-skills');
  if (!anchor) return;
  const div = document.createElement('div');
  div.innerHTML = html;
  const band = div.firstElementChild;
  anchor.insertAdjacentElement('afterend', band);
  openSkillBand = { el: band, skill: skillName };
}
document.addEventListener('click', (e) => {
  const ref = e.target.closest('.skill-band-ref');
  if (ref) { showSkill(ref.dataset.openSkill); return; }
  if (openSkillBand && !e.target.closest('.skill-band, .skill-tag')) closeSkillBand();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSkillBand(); });

function attachPinListeners(container) {
  container.querySelectorAll('.pin-goal-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const goal = goalFromPinBtn(btn);
      if (!goal) return;
      // Weapon tier with higher tiers → prompt instead of pinning outright.
      if (btn.dataset.chainGoals) {
        let chainGoals;
        try { chainGoals = JSON.parse(btn.dataset.chainGoals); } catch { chainGoals = null; }
        if (chainGoals && chainGoals.length > 1) {
          if (openPinPrompt) { closePinPrompt(); return; } // toggle off if already open
          showPinPrompt(btn, goal, chainGoals);
          return;
        }
      }
      addGoal(goal);
      pinFlash(btn);
    });
  });
}

// ---- Event listeners ----
function attachCardListeners(container) {
  // Card expand/collapse
  container.querySelectorAll('.set-card-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.pin-goal-btn, .collapsed-skills')) return; // these handle themselves
      const card = header.closest('.set-card');
      card.classList.toggle('expanded');
      const isExpanded = card.classList.contains('expanded');
      header.setAttribute('aria-expanded', isExpanded);
    });

    header.addEventListener('keydown', (e) => {
      if (e.target !== header) return; // Enter/Space on the header pin, not the header itself
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        header.click();
      }
    });
  });

  // Piece header click → expand/collapse piece details
  container.querySelectorAll('.piece-header[role="button"]').forEach(header => {
    const toggle = () => {
      const card = header.closest('.piece-card');
      card.classList.toggle('expanded');
      header.setAttribute('aria-expanded', card.classList.contains('expanded'));
    };
    header.addEventListener('click', (e) => {
      if (e.target.closest('.pin-goal-btn, .collapsed-skills')) return; // these handle themselves
      toggle();
    });
    header.addEventListener('keydown', (e) => {
      if (e.target !== header) return; // Enter/Space on the header pin, not the header itself
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  // "+n" chip on a collapsed card → reveal the remaining skills inline
  container.querySelectorAll('.collapsed-skill-more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.closest('.collapsed-skills')?.classList.add('skills-expanded');
    });
  });

  // Preview image click → lightbox
  container.querySelectorAll('.set-preview-image img').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      const overlay = document.createElement('div');
      overlay.className = 'lightbox-overlay';
      const fullImg = document.createElement('img');
      fullImg.src = img.src;
      fullImg.alt = img.alt;
      overlay.appendChild(fullImg);
      overlay.addEventListener('click', () => overlay.remove());
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
      });
      document.body.appendChild(overlay);
    });
  });

  attachPinListeners(container);

  // Material chip click → show sources (or pin to farming list via the + button)
  container.querySelectorAll('.material-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.chip-pin')) {
        addMaterial(chip.dataset.material, parseInt(chip.dataset.qty, 10) || 1);
        return;
      }
      const materialName = chip.dataset.material;

      // Universal: chip's parent is always the flex row (material-list, weapon-tier-mats, etc.).
      // The source container is always the immediate next sibling of that row — create it if absent.
      const flexRow = chip.parentElement;
      const nextSib = flexRow.nextElementSibling;
      let targetContainer;
      if (nextSib?.classList.contains('material-source-container')) {
        targetContainer = nextSib;
      } else {
        targetContainer = document.createElement('div');
        targetContainer.className = 'material-source-container';
        flexRow.after(targetContainer);
      }

      const existingSource = targetContainer.querySelector('.material-source');
      if (existingSource) {
        if (existingSource.dataset.material === materialName) {
          existingSource.remove();
          return;
        }
        existingSource.remove();
      }

      const sourceHtml = renderMaterialSource(materialName);
      const sourceDiv = document.createElement('div');
      sourceDiv.innerHTML = sourceHtml;
      const sourceEl = sourceDiv.firstElementChild;
      sourceEl.dataset.material = materialName;
      targetContainer.appendChild(sourceEl);
    });
  });

  // Skill tag click → inline level breakdown band
  container.querySelectorAll('.skill-tag[data-skill]').forEach(tag => {
    tag.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleSkillBand(tag);
    });
  });
}

// ---- Skill detail band renderer ----
// Description + full rank table (granted level highlighted) + a link into the
// reference panel. No kind badge / find-gear — those are the reference's job.
function renderSkillBand(skillName, activeLevel) {
  const skill = skillsData[skillName];
  if (!skill) return '';

  const isSetBonus = skill.kind === 'set';
  const desc = isSetBonus
    ? `<span class="skill-band-kind">Set Bonus</span>`
    : (skill.description ? `<p class="skill-band-desc">${escapeHtml(skill.description)}</p>` : '');

  const rows = skill.ranks.map(r => {
    const isActive = r.level === activeLevel;
    const label = isSetBonus ? `${r.setPiecesRequired} pieces` : `Lv ${r.level}`;
    return `
      <tr class="${isActive ? 'skill-row-active' : ''}">
        <td class="skill-rank-label">${label}</td>
        <td>${escapeHtml(r.description)}</td>
      </tr>`;
  }).join('');

  return `
    <div class="skill-band" data-skill="${escapeHtml(skillName)}">
      <div class="skill-band-header"><strong>${escapeHtml(skillName)}</strong>${desc}</div>
      <table class="skill-rank-table"><tbody>${rows}</tbody></table>
      <button class="skill-band-ref" data-open-skill="${escapeHtml(skillName)}">Open in reference →</button>
    </div>`;
}

// ---- Helpers ----
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


function formatKind(kind) {
  const labels = {
    'carve': 'Carve',
    'carve-rotten': 'Rotten Carve (field carcass)',
    'target-reward': 'Target Reward',
    'broken-part': 'Break Part',
    'wound-destroyed': 'Wound Part',
    'palico-gathering': 'Palico',
    'capture': 'Capture',
    'dropped-material': 'Dropped'
  };
  // Unmapped kinds (e.g. "carve-rotten-severed") → prettify the slug
  return labels[kind] || kind.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
