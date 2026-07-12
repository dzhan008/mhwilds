/**
 * Shared icon renderers.
 *
 * Small pure functions used by both ui.js and farming-list.js. They live here
 * (rather than in ui.js) because farming-list.js must not import ui.js — ui.js
 * imports farming-list.js, so the reverse would be a circular import.
 */

// Decoration slot icon. `size` is the slot level 1–3; anything else renders as
// an empty ring so a piece's slot layout still lines up visually.
export function slotIcon(size) {
  if (size >= 1 && size <= 3) {
    return `<img src="/images/slots/slot-${size}.png" alt="${size}-slot" class="slot-img" />`;
  }
  return `<span class="slot-icon">○</span>`;
}

// Normalize a slots array (entries may be plain numbers or `{ size }` objects)
// to an array of numeric levels, then render them as icons.
export function slotIcons(slots) {
  return (slots || []).map(s => slotIcon(typeof s === 'object' ? (s.size ?? 0) : s)).join('');
}

// Numeric slot levels from a raw slots array, for snapshotting onto a goal.
export function slotLevels(slots) {
  return (slots || []).map(s => (typeof s === 'object' ? (s.size ?? 0) : s)).filter(n => n >= 1 && n <= 3);
}
