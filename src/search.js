/**
 * Search Engine
 * 
 * Wraps Fuse.js for fuzzy search across armor sets.
 * Fuse.js handles typo tolerance (e.g., "rathaos" → "Rathalos").
 * 
 * Learning note: Fuse.js works by computing a "score" for each item
 * based on how closely the search query matches the configured keys.
 * Lower score = better match. We search across set name, piece names,
 * and material names so you can search by what you NEED, not just 
 * what you want.
 */

import Fuse from 'fuse.js';
import skillsData from './data/skills.json';

let fuseInstance = null;

// Queries that ARE a skill name get precise skill semantics instead of general
// fuzz: "Mind's Eye" must not surface "Gourmand's Earring" just because bitap
// can stitch "…nd's E…" out of it under the threshold. Normalized so typos in
// punctuation/case still count ("minds eye" → "Mind's Eye").
const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const SKILL_BY_NORM = new Map(Object.keys(skillsData).map(n => [normalize(n), n]));

// Exported so main.js can show an honest "no gear carries this skill" count.
export function skillQueryOf(query) {
  return SKILL_BY_NORM.get(normalize(query || '')) || null;
}

// A weapon's element/status was never indexed, so "blastblight" found nothing and
// "blast" only found weapons *named* "Blaster". Index both the data value and its
// display label per group: the raw value catches "blastblight"/"paralysis", the
// label catches the short forms the UI shows ("Blast", "Para").
const SPECIAL_LABELS = {
  fire: 'Fire', water: 'Water', thunder: 'Thunder', ice: 'Ice', dragon: 'Dragon',
  poison: 'Poison', paralysis: 'Para', sleep: 'Sleep', blastblight: 'Blast',
};

function specialTerms(group) {
  const terms = new Set();
  for (const w of (group.weapons || [])) {
    for (const s of (w.specials || [])) {
      for (const key of [s.element, s.status]) {
        if (!key) continue;
        terms.add(key);
        if (SPECIAL_LABELS[key]) terms.add(SPECIAL_LABELS[key]);
      }
    }
  }
  return [...terms];
}

export function initSearch(items) {
  const searchableItems = [];
  items.forEach(item => {
    if (item._type === 'weapon-group') {
      searchableItems.push({ ...item, _specialTerms: specialTerms(item) });
    } else if (item._type === 'charm' || item._type === 'pendant' || item._type === 'palico') {
      searchableItems.push(item);
    } else {
      searchableItems.push({ ...item, _type: 'set' });
      item.pieces.forEach(piece => {
        searchableItems.push({ 
          ...piece, 
          _type: 'piece', 
          setName: item.name, 
          setId: item.id,
          rank: item.rank, 
          rarity: item.rarity 
        });
      });
    }
  });

  fuseInstance = new Fuse(searchableItems, {
    keys: [
      { name: 'name', weight: 5 },
      { name: 'weapons.name', weight: 4 },      // Individual weapon names within groups
      { name: '_specialTerms', weight: 3 },     // Search by element/status: "fire", "blast", "para"
      { name: 'skills.name', weight: 2 },       // Search by skill: pieces + charms
      { name: 'weapons.skills.name', weight: 2 }, // Search by skill: weapon groups
      { name: 'allMaterials.name', weight: 1 },
      { name: 'materials.name', weight: 1 },
    ],
    threshold: 0.3,        // Tighter matching — fewer false positives
    ignoreLocation: true,  // Don't penalize matches later in the string
    includeScore: true,
    includeMatches: true,  // So results can say *why* they matched (skill hint chips)
    minMatchCharLength: 2
  });
}

// When a result matched via a skill key, surface which skill: the UI shows a
// "has <Skill>" hint chip so skill-driven hits aren't mysterious. Returns
// { name, level } (level = highest across a weapon group's tiers) or null.
function matchedSkillOf(result) {
  const matches = result.matches || [];
  // If the gear's own name matched, that already explains the hit — no hint needed.
  if (matches.some(x => x.key === 'name' || x.key === 'weapons.name')) return null;
  const m = matches.find(x => x.key === 'skills.name' || x.key === 'weapons.skills.name');
  if (!m) return null;
  const name = m.value;
  const item = result.item;
  if (m.key === 'skills.name') {
    const s = (item.skills || []).find(x => x.name === name);
    return s ? { name: s.name, level: s.level } : { name, level: null };
  }
  let level = null;
  for (const w of (item.weapons || [])) {
    for (const s of (w.skills || [])) {
      if (s.name === name && (level === null || s.level > level)) level = s.level;
    }
  }
  return { name, level };
}

export function search(query) {
  if (!fuseInstance) return [];
  if (!query || query.trim().length < 2) return [];

  // Skill-name query → search the canonical name and keep only results that
  // actually matched via a skill key. Zero results is the honest answer when
  // no gear carries the skill.
  const canonicalSkill = skillQueryOf(query);
  let results = fuseInstance.search(canonicalSkill || query.trim());
  if (canonicalSkill) {
    const want = normalize(canonicalSkill);
    results = results.filter(r =>
      (r.matches || []).some(x =>
        (x.key === 'skills.name' || x.key === 'weapons.skills.name') && normalize(x.value) === want));
  }

  return results.map(result => ({
    ...result.item,
    _score: result.score,
    _matchedSkill: matchedSkillOf(result)
  }));
}

export function getAllSets(armorSets) {
  return armorSets;
}
