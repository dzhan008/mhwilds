/**
 * Quest Lookup Module
 * 
 * Builds a reverse index: material name → quests that drop/reward it.
 * Also provides quest prioritization (repeatable optionals > events > assignments).
 */

import questsData from './data/quests.json';

// Build reverse index: material → quests
// We link quest targets to monster names, so we can match materials
// that come from monsters featured in specific quests
const targetToQuests = new Map();
const exclusiveItemToQuests = new Map();

for (const quest of questsData) {
  // Index by target monster name
  for (const target of quest.targets) {
    const key = target.toLowerCase();
    if (!targetToQuests.has(key)) targetToQuests.set(key, []);
    targetToQuests.get(key).push(quest);
  }

  // Index exclusive reward items
  if (quest.rewardItems) {
    for (const item of quest.rewardItems) {
      const key = item.toLowerCase();
      if (!exclusiveItemToQuests.has(key)) exclusiveItemToQuests.set(key, []);
      exclusiveItemToQuests.get(key).push(quest);
    }
  }
}

/**
 * Materials obtainable ONLY from an event quest — rewarded by an event quest,
 * with no monster drop, no (non-quest) gathering source, and not also a reward
 * of any non-event quest. These are what make a piece of gear "event-locked"
 * (e.g. Amstrigian Ticket → the Amstrigian α set). Drives the Events filter.
 * materialIndex + gatheringSources are passed in (this module doesn't import them).
 */
export function computeEventExclusiveMaterials(materialIndex, gatheringSources) {
  const eventReward = new Set();
  const otherReward = new Set();
  for (const q of questsData) {
    for (const item of (q.rewardItems || [])) {
      (q.type === 'event' ? eventReward : otherReward).add(item);
    }
  }

  const exclusive = new Set();
  for (const name of eventReward) {
    if (otherReward.has(name)) continue;                                   // also from a non-event quest
    if ((materialIndex[name] || []).length > 0) continue;                  // drops from a monster
    if ((gatheringSources[name] || []).some(g => g.type !== 'Quest Reward')) continue; // gatherable
    exclusive.add(name);
  }
  return exclusive;
}

/**
 * Find quests relevant to a specific material.
 * Checks both direct item rewards and monster targets.
 */
export function findQuestsForMaterial(materialName, monsterSources) {
  const results = [];
  const seen = new Set();

  // 1. Check if this material is a direct exclusive reward item
  const directQuests = exclusiveItemToQuests.get(materialName.toLowerCase());
  if (directQuests) {
    for (const q of directQuests) {
      if (!seen.has(q.name)) {
        seen.add(q.name);
        results.push({ ...q, matchType: 'exclusive' });
      }
    }
  }

  // 2. Check quests by monster target (if we know which monsters drop this material)
  if (monsterSources) {
    for (const source of monsterSources) {
      // Skip monsters that only yield this material via a "rotten carve"
      // (field-carcass scavenging). Hunting the live monster in a quest does
      // NOT drop the material, so recommending the quest would be misleading.
      const huntable = (source.drops || []).some(d => d.kind !== 'carve-rotten');
      if (!huntable) continue;

      const monsterName = source.monsterName.toLowerCase();
      // Try exact match and common partial matches
      const matchingQuests = targetToQuests.get(monsterName) || [];
      
      for (const q of matchingQuests) {
        if (!seen.has(q.name)) {
          seen.add(q.name);
          results.push({ ...q, matchType: 'monster-target' });
        }
      }
    }
  }

  // Sort by priority: exclusive first, then by farming efficiency
  return results.sort((a, b) => {
    // Exclusive rewards first
    if (a.matchType === 'exclusive' && b.matchType !== 'exclusive') return -1;
    if (b.matchType === 'exclusive' && a.matchType !== 'exclusive') return 1;

    return questPriority(a) - questPriority(b);
  });
}

// Priority: optional single > event > optional multi > assignment
function questPriority(q) {
  if (q.type === 'optional' && q.targetCount === 1) return 0;
  if (q.type === 'event') return 1;
  if (q.type === 'optional' && q.targetCount > 1) return 2;
  return 3;
}

/**
 * Find quests targeting a specific monster, best farming option first.
 */
export function findQuestsForMonster(monsterName) {
  const quests = targetToQuests.get(monsterName.toLowerCase()) || [];
  return [...quests].sort((a, b) => questPriority(a) - questPriority(b));
}

/**
 * Get the CSS class and label for a quest badge
 */
export function getQuestBadgeInfo(quest) {
  if (quest.type === 'event') {
    return { class: 'event', label: 'Event', icon: '🟣' };
  }
  if (quest.type === 'optional' && quest.targetCount > 1) {
    return { class: 'optional multi-target', label: 'Optional', icon: '⚠️' };
  }
  if (quest.type === 'optional') {
    return { class: 'optional', label: 'Optional', icon: '🟢' };
  }
  return { class: 'assignment', label: 'Assignment', icon: '⚪' };
}
