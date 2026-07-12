/**
 * Reference Panel (left slide-in)
 *
 * Global reference material, as opposed to the right farming drawer which is
 * build-scoped workspace. Three tabs:
 *   - Skills: searchable dictionary of every skill in skills.json (name, kind,
 *     per-rank descriptions), each with a "Find gear" action that runs a
 *     regular search for the skill name.
 *   - Materials: searchable dictionary of every material; each entry expands to
 *     the same source breakdown the material-chip popup shows (gathering-first,
 *     monster drops, quests). Names + the renderMaterialSource() renderer are
 *     injected from main.js (initReferencePanel) to avoid a ui.js import cycle —
 *     ui.js already imports showSkill() from this module.
 *   - Legend: the quest-badge legend (formerly the #legend-modal) plus a
 *     stat-icon legend injected from ui.js (renderStatLegend, same DI reason).
 *
 * Layout: squeezes the page from the left on ≥768px (mirrors the farming
 * drawer's right squeeze); full-width overlay with body scroll lock below.
 * When both panels would squeeze a narrow window (<1100px), opening one closes
 * the other — coordinated via the 'mhws:panel-open' CustomEvent so neither
 * module imports the other.
 */

import skillsData from './data/skills.json';

const KIND_LABELS = { armor: 'Armor', weapon: 'Weapon', set: 'Set Bonus', group: 'Group Bonus' };

let panelEl = null;
let bodyEl = null;
let toggleBtn = null;
let searchRowEl = null;
let searchInputEl = null;
let kindFilterEl = null;
let activeTab = 'skills';
let legendSub = 'quests'; // 'quests' | 'stats' — sub-tab within the Legend tab
let filterText = { skills: '', materials: '' }; // per-tab filter text
let kindFilter = 'all'; // 'all' | 'armor' | 'weapon' | 'bonus' (bonus = set + group)
let onFindGear = null; // callback: (skillName) => void, provided by main.js

// Injected by initReferencePanel (see module header for why we don't import ui.js).
let MATERIAL_NAMES = [];              // sorted material names (Materials tab)
let renderMaterialSourceFn = null;   // (name) => HTML string, from ui.js
let renderStatLegendFn = null;       // () => HTML string, stat-icon legend from ui.js

// Which tabs get the search row (skills + materials), with per-tab UI copy.
const SEARCHABLE_TABS = {
  skills: { placeholder: 'Filter skills...', label: 'Filter skills' },
  materials: { placeholder: 'Search materials...', label: 'Search materials' },
};

// Skill names sorted once at module load — the dictionary's stable order.
const SKILL_NAMES = Object.keys(skillsData).sort((a, b) => a.localeCompare(b));

function skillEntryHtml(name) {
  const s = skillsData[name];
  const kind = KIND_LABELS[s.kind] || s.kind;
  const ranks = s.ranks.map(r => {
    const lvLabel = r.setPiecesRequired ? `${r.setPiecesRequired}pc` : `Lv${r.level}`;
    return `<div class="ref-skill-rank"><span class="ref-rank-lv">${lvLabel}</span><span>${escapeHtml(r.description || '')}</span></div>`;
  }).join('');
  return `
    <div class="ref-skill" data-skill-name="${escapeHtml(name)}">
      <button class="ref-skill-head" aria-expanded="false">
        <span class="ref-skill-name">${escapeHtml(name)}</span>
        <span class="ref-skill-meta">
          <span class="ref-skill-kind ref-kind-${s.kind}">${kind}</span>
        </span>
      </button>
      <div class="ref-skill-detail" hidden>
        ${s.description ? `<p class="ref-skill-desc">${escapeHtml(s.description)}</p>` : ''}
        ${ranks}
        <button class="ref-find-gear" data-skill="${escapeHtml(name)}">🔎 Find gear with this skill</button>
      </div>
    </div>
  `;
}

function matchesKind(name) {
  if (kindFilter === 'all') return true;
  const kind = skillsData[name].kind;
  if (kindFilter === 'bonus') return kind === 'set' || kind === 'group';
  return kind === kindFilter;
}

function renderSkillsTab() {
  const raw = filterText.skills;
  const q = raw.trim().toLowerCase();
  let names = SKILL_NAMES.filter(matchesKind);
  if (q) names = names.filter(n => n.toLowerCase().includes(q));
  if (!names.length) {
    return `<div class="ref-empty">No skills match${q ? ` “${escapeHtml(raw)}”` : ''} in this category.</div>`;
  }
  return names.map(skillEntryHtml).join('');
}

// One collapsed material row. The source breakdown is injected lazily on first
// expand (see the delegated click handler) — rendering all ~470 up front is heavy.
function materialEntryHtml(name) {
  return `
    <div class="ref-material" data-material-name="${escapeHtml(name)}">
      <button class="ref-material-head" aria-expanded="false">
        <span class="ref-material-name">${escapeHtml(name)}</span>
        <span class="ref-material-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="ref-material-detail" hidden></div>
    </div>
  `;
}

function renderMaterialsTab() {
  const raw = filterText.materials;
  const q = raw.trim().toLowerCase();
  let names = MATERIAL_NAMES;
  if (q) names = names.filter(n => n.toLowerCase().includes(q));
  if (!names.length) {
    return `<div class="ref-empty">No materials match${q ? ` “${escapeHtml(raw)}”` : ''}.</div>`;
  }
  return names.map(materialEntryHtml).join('');
}

function questBadgesHtml() {
  return `
    <div class="legend-item">
      <span class="quest-chip optional">🟢 Optional</span>
      <p>Repeatable quests. Best for general farming.</p>
    </div>
    <div class="legend-item">
      <span class="quest-chip optional multi-target">⚠️ Optional</span>
      <p>Multiple targets. Takes longer, generally avoid for specific materials unless necessary.</p>
    </div>
    <div class="legend-item">
      <span class="quest-chip event">🟣 Event</span>
      <p>Special time-limited quests. Often have guaranteed or higher drop rates for specific items.</p>
    </div>
    <div class="legend-item">
      <span class="quest-chip assignment">⚪ Assignment</span>
      <p>One-time story quests. Cannot be freely repeated.</p>
    </div>
    <div class="legend-item">
      <span style="color: var(--gold); font-weight: 600;">★ Exclusive</span>
      <p>This quest directly gives the material as a special reward (not just from carving the monster).</p>
    </div>
  `;
}

// Legend tab: a sub-tab switch between the quest-badge legend and the stat-icon
// legend (the latter injected from ui.js — see module header). Sub-tabs avoid a
// long scroll to reach the stat icons.
function renderLegendTab() {
  const subBtn = (id, label) =>
    `<button class="ref-subtab ${legendSub === id ? 'active' : ''}" data-legend-sub="${id}" role="tab" aria-selected="${legendSub === id}">${label}</button>`;
  const section = legendSub === 'stats'
    ? (renderStatLegendFn ? renderStatLegendFn() : '')
    : questBadgesHtml();
  return `
    <div class="ref-subtabs" role="tablist">
      ${subBtn('quests', 'Quest Badges')}
      ${subBtn('stats', 'Stat Icons')}
    </div>
    ${section}
  `;
}

function renderActiveList() {
  if (activeTab === 'skills') return renderSkillsTab();
  if (activeTab === 'materials') return renderMaterialsTab();
  return renderLegendTab();
}

function renderPanel() {
  document.querySelectorAll('.ref-tab').forEach(btn => {
    const active = btn.dataset.tab === activeTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  });

  // Search row shows on the searchable tabs; the kind-filter pills are skills-only.
  const searchable = SEARCHABLE_TABS[activeTab];
  searchRowEl.hidden = !searchable;
  if (searchable) {
    searchInputEl.value = filterText[activeTab];
    searchInputEl.placeholder = searchable.placeholder;
    searchInputEl.setAttribute('aria-label', searchable.label);
  }
  if (kindFilterEl) kindFilterEl.hidden = activeTab !== 'skills';

  bodyEl.innerHTML = renderActiveList();
}

export function isRefOpen() {
  return panelEl?.classList.contains('open') ?? false;
}

export function openRefPanel(tab = null) {
  if (tab) activeTab = tab;
  panelEl.classList.add('open');
  toggleBtn.classList.add('active');
  document.body.classList.add('ref-open');
  document.dispatchEvent(new CustomEvent('mhws:panel-open', { detail: 'reference' }));
  renderPanel();
  panelEl.focus({ preventScroll: true });
}

export function closeRefPanel() {
  panelEl.classList.remove('open');
  toggleBtn.classList.remove('active');
  document.body.classList.remove('ref-open');
  // return focus to the toggle only if focus was inside the panel
  if (panelEl.contains(document.activeElement)) toggleBtn?.focus({ preventScroll: true });
}

// Open the panel to a specific skill's entry — expanded, scrolled to the top of
// the body (matters on the mobile full-screen sheet), briefly highlighted.
// Called from a card's skill detail band ("Open in reference →").
export function showSkill(name) {
  if (!skillsData[name]) return;
  // reset filters so the entry can't be filtered out, switch to the Skills tab
  activeTab = 'skills';
  filterText.skills = '';
  kindFilter = 'all';
  if (searchInputEl) searchInputEl.value = '';
  document.querySelectorAll('.ref-kind-btn').forEach(b => b.classList.toggle('active', b.dataset.kind === 'all'));
  openRefPanel('skills'); // renders the list

  const entry = bodyEl.querySelector(`.ref-skill[data-skill-name="${name.replace(/"/g, '\\"')}"]`);
  if (!entry) return;
  entry.querySelector('.ref-skill-detail').hidden = false;
  entry.querySelector('.ref-skill-head').setAttribute('aria-expanded', 'true');
  bodyEl.scrollTop += entry.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top;
  entry.classList.add('ref-skill-flash');
  setTimeout(() => entry.classList.remove('ref-skill-flash'), 1200);
}

export function initReferencePanel({ findGear, materialNames, renderMaterialSource, renderStatLegend } = {}) {
  onFindGear = findGear || null;
  MATERIAL_NAMES = materialNames || [];
  renderMaterialSourceFn = renderMaterialSource || null;
  renderStatLegendFn = renderStatLegend || null;
  panelEl = document.getElementById('ref-panel');
  bodyEl = document.getElementById('ref-body');
  toggleBtn = document.getElementById('ref-toggle');
  searchRowEl = document.getElementById('ref-search-row');
  searchInputEl = document.getElementById('ref-skill-search');
  kindFilterEl = document.getElementById('ref-kind-filter');

  toggleBtn.addEventListener('click', () => {
    isRefOpen() ? closeRefPanel() : openRefPanel();
  });
  document.getElementById('ref-close').addEventListener('click', closeRefPanel);

  document.querySelectorAll('.ref-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderPanel();
    });
  });

  searchInputEl.addEventListener('input', () => {
    // The row only shows on searchable tabs, so activeTab is skills or materials.
    filterText[activeTab] = searchInputEl.value;
    bodyEl.innerHTML = renderActiveList();
  });

  // Kind filter (All / Armor / Weapon / Bonuses)
  document.querySelectorAll('.ref-kind-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ref-kind-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      kindFilter = btn.dataset.kind;
      bodyEl.innerHTML = renderSkillsTab();
    });
  });

  // Delegated: expand/collapse skill entries + "Find gear" actions
  bodyEl.addEventListener('click', (e) => {
    const subTab = e.target.closest('.ref-subtab');
    if (subTab) {
      legendSub = subTab.dataset.legendSub;
      bodyEl.innerHTML = renderLegendTab();
      bodyEl.scrollTop = 0;
      return;
    }
    const findBtn = e.target.closest('.ref-find-gear');
    if (findBtn) {
      onFindGear?.(findBtn.dataset.skill);
      // On narrow screens the panel covers the results — close it so they're visible.
      if (window.innerWidth < 768) closeRefPanel();
      return;
    }
    const head = e.target.closest('.ref-skill-head');
    if (head) {
      const detail = head.nextElementSibling;
      detail.hidden = !detail.hidden;
      head.setAttribute('aria-expanded', !detail.hidden);
      return;
    }
    const matHead = e.target.closest('.ref-material-head');
    if (matHead) {
      const detail = matHead.nextElementSibling;
      // Lazy-render the source breakdown on first expand.
      if (!detail.dataset.loaded) {
        const name = matHead.closest('.ref-material').dataset.materialName;
        detail.innerHTML = renderMaterialSourceFn ? renderMaterialSourceFn(name) : '';
        detail.dataset.loaded = '1';
      }
      detail.hidden = !detail.hidden;
      matHead.setAttribute('aria-expanded', !detail.hidden);
      matHead.classList.toggle('expanded', !detail.hidden);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isRefOpen() && !e.defaultPrevented) closeRefPanel();
  });

  // Narrow-window guard: if the farming drawer opens and both panels would
  // squeeze the page (<1100px), yield — and vice versa (farming-list listens too).
  document.addEventListener('mhws:panel-open', (e) => {
    if (e.detail !== 'reference' && isRefOpen() && window.innerWidth < 1100) closeRefPanel();
  });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
