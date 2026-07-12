/**
 * MH Wilds Planner — Main Entry Point
 * 
 * Architecture:
 *   1. Load static JSON data (armor sets + material index)
 *   2. Initialize Fuse.js search index
 *   3. Render UI and wire up event handlers
 * 
 * The data flows one direction: Search Input → Filter → Render
 * No state management library needed — just module-level variables.
 */

import './style.css';
import armorSetsData from './data/armor-sets.json';
import charmsData from './data/charms.json';
import materialIndexData from './data/material-index.json';
import gatheringSourcesData from './data/gathering-sources.json';
import pendantsData from './data/pendants.json';
import palicogearData from './data/palico-gear.json';
import weaponsData from './data/weapons.json';
import { initSearch, search, skillQueryOf } from './search.js';
import { setMaterialIndex, renderMaterialSource, renderStatLegend, renderResults, renderLoading, renderWelcome, renderGrid, renderGridDetail } from './ui.js';
import { initFarmingList } from './farming-list.js';
import { initReferencePanel } from './reference-panel.js';
import { computeEventExclusiveMaterials } from './quest-lookup.js';

// ---- Weapon grouping ----
function buildWeaponGroups(weapons) {
  const byKey = new Map();
  for (const w of weapons) {
    const key = `${w.kind}::${w.series || w.name}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        _type: 'weapon-group',
        id: `wg-${w.kind}-${(w.series || w.name).replace(/\s+/g, '_')}`,
        name: w.series || w.name,
        kind: w.kind,
        rarity: w.rarity,
        maxRarity: w.rarity,
        hasLowRank: false,
        hasHighRank: false,
        weapons: [],
        allMaterials: [],
      });
    }
    const g = byKey.get(key);
    g.weapons.push(w);
    if (w.rarity < g.rarity) g.rarity = w.rarity;
    if (w.rarity > g.maxRarity) g.maxRarity = w.rarity;
    if (w.rank === 'low') g.hasLowRank = true;
    if (w.rank === 'high') g.hasHighRank = true;
  }
  for (const g of byKey.values()) {
    g.weapons.sort((a, b) => a.rarity - b.rarity || a.id - b.id);
    // Aggregate unique materials for search indexing
    const seen = new Set();
    g.allMaterials = [];
    for (const w of g.weapons) {
      for (const m of (w.materials || [])) {
        if (!seen.has(m.name)) { seen.add(m.name); g.allMaterials.push({ name: m.name }); }
      }
    }
  }
  return [...byKey.values()];
}

// ---- App State ----
let allSets = [
  ...armorSetsData.map(set => ({ ...set, _type: 'set' })),
  ...charmsData.map(charm => ({ ...charm, _type: 'charm' })),
  ...pendantsData.map(pendant => ({ ...pendant, _type: 'pendant' })),
  ...palicogearData.map(set => ({ ...set, _type: 'palico' })),
  ...buildWeaponGroups(weaponsData),
];
let currentRankFilter = 'all'; // 'all', 'low', 'high'
let currentTypeFilter = 'all'; // 'all', 'armor', 'charm', 'pendant', 'palico', 'weapon'
let currentWeaponKindFilter = 'all'; // 'all' or any weapon kind slug
let currentSort = 'default'; // 'default' | 'defense' | fire/water/ice/thunder/dragon | 'rarity'
let eventsFilterActive = false; // when on, show only gear needing an event-quest material
let eventMaterials = new Set(); // event-exclusive material names, computed at init
let searchTimeout = null;
let viewMode = 'welcome'; // 'welcome' | 'grid' | 'detail' | 'search'

// Hoisted so showGrid/showGridDetail can reference them without being inside init()
let resultsContainer = null;
let searchCountEl = null;
let visualBtn = null;

function setVisualActive(active) {
  if (visualBtn) visualBtn.classList.toggle('active', active);
}

// Any non-default filter/sort is active (drives welcome-vs-results decisions).
function anyFilterActive() {
  return currentTypeFilter !== 'all' || currentRankFilter !== 'all' || currentSort !== 'default' || eventsFilterActive;
}

// All crafting-material names for an item (sets/weapon-groups aggregate into
// allMaterials; charms/pendants/palico/pieces use materials).
function itemMaterialNames(item) {
  return (item.allMaterials || item.materials || []).map(m => m.name);
}

function itemNeedsEvent(item) {
  return itemMaterialNames(item).some(n => eventMaterials.has(n));
}

// ---- Grid helpers ----
function matchesRank(item, rank) {
  if (item._type === 'weapon-group') return rank === 'high' ? item.hasHighRank : item.hasLowRank;
  return item.rank === rank;
}

// ---- Stat sort ----
// Sets sort by the summed value across their pieces (that's what you'd wear);
// pieces/palico by their own value. Items without the stat (weapons, pendants,
// charms) sink to the bottom via -Infinity — a negative resistance still
// outranks "doesn't have resistances at all".
function sortValue(item, key) {
  if (key === 'rarity') return item.maxRarity ?? item.rarity ?? -Infinity;
  if (key === 'defense') {
    if (item._type === 'set') return item.pieces.reduce((t, p) => t + (p.defense?.max ?? p.defense?.base ?? 0), 0);
    if (item._type === 'piece') return item.defense?.max ?? item.defense?.base ?? -Infinity;
    if (item._type === 'palico') return item.defense ?? -Infinity;
    return -Infinity;
  }
  // elemental resistance keys
  if (item._type === 'set') return item.pieces.reduce((t, p) => t + (p.resistances?.[key] || 0), 0);
  if (item._type === 'piece' || item._type === 'palico') return item.resistances?.[key] ?? -Infinity;
  return -Infinity;
}

function applySort(items) {
  if (currentSort === 'default') return items;
  // NaN from (-Inf) - (-Inf) is falsy, so equal/statless pairs fall through to the name tiebreak
  return [...items].sort((a, b) => (sortValue(b, currentSort) - sortValue(a, currentSort)) || a.name.localeCompare(b.name));
}

// For grid search: map piece results back to their parent set, deduplicate.
function getSearchedGridItems(query) {
  const results = search(query);
  const seenKeys = new Set();
  const items = [];
  for (const item of results) {
    let topLevel = item;
    if (item._type === 'piece') {
      topLevel = allSets.find(s => s.id === item.setId && s._type === 'set');
      if (!topLevel) continue;
    }
    const key = `${topLevel._type}::${topLevel.id}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      items.push(topLevel);
    }
  }
  return items;
}

function getFilteredItems(query = '') {
  let items = (query && query.trim().length >= 2) ? getSearchedGridItems(query) : allSets;
  if (currentRankFilter !== 'all') {
    items = items.filter(item => matchesRank(item, currentRankFilter));
  }
  if (currentTypeFilter !== 'all') {
    items = items.filter(item => {
      if (currentTypeFilter === 'armor') return item._type === 'set' || item._type === 'piece';
      if (currentTypeFilter === 'palico') return item._type === 'palico';
      if (currentTypeFilter === 'weapon') return item._type === 'weapon-group';
      return item._type === currentTypeFilter;
    });
  }
  if (currentTypeFilter === 'weapon' && currentWeaponKindFilter !== 'all') {
    items = items.filter(item => item.kind === currentWeaponKindFilter);
  }
  if (eventsFilterActive) {
    items = items.filter(itemNeedsEvent);
  }
  return applySort(items);
}

// Sort emphasis info for renderers: which stat drives the order, how to read
// it off an item, and the result set's max (scales the per-card mini-bars).
// Rarity is already on every card/tile, so it gets no emphasis treatment.
function sortStatInfo(items) {
  if (currentSort === 'default' || currentSort === 'rarity') return null;
  const valueOf = (item) => sortValue(item, currentSort);
  let max = -Infinity;
  for (const it of items) {
    const v = valueOf(it);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return { key: currentSort, valueOf, max };
}

function showGrid(query = '') {
  viewMode = 'grid';
  setVisualActive(true);
  const items = getFilteredItems(query);
  searchCountEl.textContent = `${items.length} result${items.length !== 1 ? 's' : ''}`;
  renderGrid(items, resultsContainer, (item) => showGridDetail(item, query), sortStatInfo(items));
}

function showGridDetail(item, query = '') {
  viewMode = 'detail';
  setVisualActive(true);
  searchCountEl.textContent = '';
  renderGridDetail(item, resultsContainer, () => showGrid(query));
}

function exitGridMode(searchInput) {
  setVisualActive(false);
  if (anyFilterActive()) {
    // Stay in list mode showing filtered results, not welcome
    viewMode = 'search';
    const query = searchInput ? searchInput.value : '';
    performSearch(query, resultsContainer, searchCountEl);
  } else {
    viewMode = 'welcome';
    searchCountEl.textContent = '';
    renderWelcome(resultsContainer);
    if (searchInput) searchInput.value = '';
  }
}

// ---- Initialize ----
function init() {
  // Set up material index for the UI module
  setMaterialIndex(materialIndexData);

  // Materials only obtainable from event quests → drives the Events filter
  eventMaterials = computeEventExclusiveMaterials(materialIndexData, gatheringSourcesData);

  // Farming list drawer (persistent, localStorage-backed)
  initFarmingList(materialIndexData);

  // Initialize fuzzy search
  initSearch(allSets);

  // Get DOM references (hoisted to module scope for showGrid/showGridDetail)
  resultsContainer = document.getElementById('results');
  searchCountEl = document.getElementById('search-count');
  visualBtn = document.getElementById('visual-btn');
  const searchInput = document.getElementById('search-input');
  const searchCount = searchCountEl;
  const rankBtns = document.querySelectorAll('.rank-filter .rank-btn');
  const typeBtns = document.querySelectorAll('.type-btn');

  // Show welcome state
  renderWelcome(resultsContainer);

  // ---- Visual Mode button (toggle) ----
  visualBtn.addEventListener('click', () => {
    if (viewMode === 'grid' || viewMode === 'detail') {
      exitGridMode(searchInput);
    } else {
      searchInput.value = '';
      if (anyFilterActive()) {
        showGrid();
      } else {
        viewMode = 'grid';
        setVisualActive(true);
        searchCountEl.textContent = '';
        renderWelcome(resultsContainer);
      }
    }
  });

  // ---- Search handler with debounce ----
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value;

    if (viewMode === 'grid' || viewMode === 'detail') {
      // Stay in grid mode — filter the tiles instead of switching to list view
      searchTimeout = setTimeout(() => showGrid(query), 200);
    } else {
      if (query.trim().length > 0) {
        viewMode = 'search';
        setVisualActive(false);
      }
      searchTimeout = setTimeout(() => {
        performSearch(query, resultsContainer, searchCount);
      }, 200);
    }
  });

  // Keyboard shortcut: focus search on '/'
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.blur();
    }
  });

  // Re-render after a filter/type/sort change. Because these swap the whole
  // result set (not refine a query the user is reading), reset scroll to the top
  // — otherwise a mid-list scroll position carries over and hides the first
  // (often most relevant) results of the new set. The search bar is sticky, so
  // it stays put regardless.
  const rerenderResults = () => {
    if (viewMode === 'grid' || viewMode === 'detail') {
      showGrid(searchInput.value);
    } else {
      performSearch(searchInput.value, resultsContainer, searchCount);
    }
    // Defer to the next frame: clicking a filter button focuses it, and the
    // browser then scrolls that button into view — which would undo the reset.
    // Running after that focus-scroll lets our animation win and land at the top.
    // Smooth-scroll back up (a hard snap felt jarring); it retargets any in-flight
    // focus-scroll to 0.
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  // ---- Rank filter ----
  rankBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rank-filter .rank-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRankFilter = btn.dataset.rank;
      rerenderResults();
    });
  });

  // ---- Type filter ----
  const weaponKindFilterRow = document.getElementById('weapon-kind-filter');
  typeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTypeFilter = btn.dataset.type;

      // Show/hide weapon kind sub-filter
      weaponKindFilterRow.style.display = currentTypeFilter === 'weapon' ? 'flex' : 'none';
      if (currentTypeFilter !== 'weapon') {
        currentWeaponKindFilter = 'all';
        document.querySelectorAll('.weapon-kind-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.weapon-kind-btn[data-kind="all"]').classList.add('active');
      }

      rerenderResults();
    });
  });

  // ---- Stat sort ----
  document.getElementById('sort-select').addEventListener('change', (e) => {
    currentSort = e.target.value;
    e.target.classList.toggle('sort-active', currentSort !== 'default');
    rerenderResults();
  });

  // ---- Events filter (gear that needs an event-quest-only material) ----
  document.getElementById('events-filter-btn').addEventListener('click', (e) => {
    eventsFilterActive = !eventsFilterActive;
    e.currentTarget.classList.toggle('active', eventsFilterActive);
    e.currentTarget.setAttribute('aria-pressed', String(eventsFilterActive));
    rerenderResults();
  });

  // ---- Weapon kind filter ----
  document.querySelectorAll('.weapon-kind-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.weapon-kind-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentWeaponKindFilter = btn.dataset.kind;
      rerenderResults();
    });
  });

  // ---- Reference panel (skill dictionary + material dictionary + quest legend) ----
  initReferencePanel({
    findGear: (skillName) => {
      searchInput.value = skillName;
      // Route through the normal input handler so list/grid mode both work
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    },
    materialNames: buildMaterialNames(),
    renderMaterialSource, // injected to avoid a reference-panel → ui.js import cycle
    renderStatLegend,     // same reason — reference-panel.js never imports ui.js
  });

  console.log(`MH Wilds Planner loaded: ${allSets.length} armor sets, ${Object.keys(materialIndexData).length} materials indexed`);
}

// Union of every material name for the reference panel's Materials tab: monster
// drops + gathering sources + every crafting material across armor/weapons/
// charms/palico. Sorted once at init (mirrors reference-panel's SKILL_NAMES).
function buildMaterialNames() {
  const set = new Set([
    ...Object.keys(materialIndexData),
    ...Object.keys(gatheringSourcesData),
  ]);
  const addMats = (mats) => {
    for (const m of (mats || [])) if (m?.name) set.add(m.name);
  };
  for (const s of Object.values(armorSetsData)) {
    for (const p of (s.pieces || [])) addMats(p.materials);
  }
  for (const w of weaponsData) {
    addMats(w.materials);
    addMats(w.crafting?.craftingMaterials);
    addMats(w.crafting?.upgradeMaterials);
  }
  for (const c of charmsData) addMats(c.materials);
  for (const p of palicogearData) addMats(p.materials);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ---- Search + Filter Logic ----
function performSearch(query, container, countEl) {
  let results;

  if (!query || query.trim().length < 2) {
    if (query.trim().length === 0 && !anyFilterActive()) {
      viewMode = 'welcome';
      renderWelcome(container);
      countEl.textContent = '';
      return;
    } else if (query.trim().length === 1) {
      countEl.textContent = 'Type at least 2 characters...';
      return;
    }
    // Empty query with an active filter — show all items and let filters apply below
    results = allSets;
  } else {
    // Fuzzy search
    results = search(query);
  }

  // Apply rank filter
  if (currentRankFilter !== 'all') {
    results = results.filter(item => matchesRank(item, currentRankFilter));
  }

  // Apply type filter
  if (currentTypeFilter !== 'all') {
    results = results.filter(item => {
      if (currentTypeFilter === 'armor') return item._type === 'set' || item._type === 'piece';
      if (currentTypeFilter === 'weapon') return item._type === 'weapon-group';
      return item._type === currentTypeFilter;
    });
  }
  if (currentTypeFilter === 'weapon' && currentWeaponKindFilter !== 'all') {
    results = results.filter(item => item.kind === currentWeaponKindFilter);
  }
  if (eventsFilterActive) {
    results = results.filter(itemNeedsEvent);
  }

  results = applySort(results);

  // Update count — for a skill-name query with no carriers, say so explicitly
  const skillQ = skillQueryOf(query);
  countEl.textContent = (skillQ && results.length === 0)
    ? `No gear carries "${skillQ}"`
    : `${results.length} result${results.length !== 1 ? 's' : ''}`;

  // Render
  renderResults(results, container, sortStatInfo(results));
}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', init);
