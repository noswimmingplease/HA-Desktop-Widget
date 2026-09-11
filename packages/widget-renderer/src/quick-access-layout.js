import { getActiveQuickAccessTab, normalizeQuickAccessConfig } from './quick-access-tabs.js';

const QUICK_ACCESS_PRESENTATION_TABS = 'tabs';
const QUICK_ACCESS_PRESENTATION_ROOMS = 'rooms';
const QUICK_ACCESS_DEVICE_ACCENTS = Object.freeze({
  sky: '159, 202, 255',
  mint: '156, 225, 195',
  lavender: '201, 184, 255',
  apricot: '255, 194, 158',
  rose: '255, 180, 207',
  gold: '255, 224, 153',
  aqua: '147, 222, 220',
  periwinkle: '176, 193, 255',
});
const QUICK_ACCESS_DEVICE_ACCENT_NAMES = Object.freeze(Object.keys(QUICK_ACCESS_DEVICE_ACCENTS));
const QUICK_ACCESS_DEVICE_KIND_ACCENTS = Object.freeze({
  home: ['sky'],
  desktop: ['mint', 'periwinkle', 'apricot'],
  server: ['lavender', 'periwinkle', 'apricot'],
  board: ['rose', 'gold', 'aqua'],
  device: QUICK_ACCESS_DEVICE_ACCENT_NAMES,
});

function hashQuickAccessIdentity(value) {
  const source = String(value || 'device');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function inferQuickAccessDeviceKind(section = {}) {
  const identityText = `${section.id || ''} ${section.name || ''}`.trim().toLowerCase();
  const entityIds = Array.isArray(section.entityIds) ? section.entityIds : [];
  if (/\bhome\b|\bhouse\b/.test(identityText)) return 'home';
  if (/\bnas\b|\bserver\b|\bstorage server\b/.test(identityText)) return 'server';
  if (/\bpi\s*\d|raspberry/.test(identityText)) return 'board';
  if (entityIds.some((entityId) => /nvidia|geforce|gpu|display/i.test(String(entityId)))) {
    return 'desktop';
  }
  return 'device';
}

function getQuickAccessDeviceIdentity(section = {}) {
  const kind = inferQuickAccessDeviceKind(section);
  const accents = QUICK_ACCESS_DEVICE_KIND_ACCENTS[kind] || QUICK_ACCESS_DEVICE_ACCENT_NAMES;
  const identityKey = String(section.id || section.name || kind)
    .trim()
    .toLowerCase();
  const accent = accents[hashQuickAccessIdentity(identityKey) % accents.length];
  return {
    kind,
    accent,
    rgb: QUICK_ACCESS_DEVICE_ACCENTS[accent],
  };
}

function normalizeQuickAccessPresentation(value) {
  return value === QUICK_ACCESS_PRESENTATION_ROOMS
    ? QUICK_ACCESS_PRESENTATION_ROOMS
    : QUICK_ACCESS_PRESENTATION_TABS;
}

function getQuickAccessPresentation(config) {
  return normalizeQuickAccessPresentation(config?.ui?.quickAccessPresentation);
}

function isQuickAccessEntityUnavailable(entity) {
  const entityState = String(entity?.state || '')
    .trim()
    .toLowerCase();
  return entityState === 'unavailable' || entityState === 'unknown';
}

/**
 * Hides a device section only when every configured entity still exists in the
 * Home Assistant state map and every one of those entities is unavailable.
 * Missing entities remain visible so the existing repair UI is not concealed.
 */
function filterUnavailableQuickAccessSections(layout, states, enabled = false) {
  if (
    !enabled ||
    layout?.presentation !== QUICK_ACCESS_PRESENTATION_ROOMS ||
    !states ||
    Object.keys(states).length === 0
  ) {
    return layout;
  }

  return {
    ...layout,
    sections: (layout.sections || []).filter((section) => {
      if (!Array.isArray(section?.entityIds) || section.entityIds.length === 0) return true;
      const entities = section.entityIds.map((entityId) => states[entityId]);
      if (entities.some((entity) => !entity)) return true;
      return entities.some((entity) => !isQuickAccessEntityUnavailable(entity));
    }),
  };
}

/**
 * Builds the renderer-facing Quick Access layout without mutating config.
 *
 * The stock active-tab presentation remains the default. Room sections are an
 * explicit opt-in via `ui.quickAccessPresentation: "rooms"`, and reorganise
 * mode deliberately uses the stock active-tab grid so its existing sortable
 * and page-management behaviour remains unchanged.
 */
function buildQuickAccessLayout(config, { reorganizing = false } = {}) {
  const normalizedConfig = normalizeQuickAccessConfig(config);
  const requestedPresentation = getQuickAccessPresentation(normalizedConfig);
  const presentation =
    requestedPresentation === QUICK_ACCESS_PRESENTATION_ROOMS && !reorganizing
      ? QUICK_ACCESS_PRESENTATION_ROOMS
      : QUICK_ACCESS_PRESENTATION_TABS;
  const sourceTabs =
    presentation === QUICK_ACCESS_PRESENTATION_ROOMS
      ? normalizedConfig.customTabs
      : [getActiveQuickAccessTab(normalizedConfig)];
  const seenEntityIds = new Set();

  const sections = sourceTabs.filter(Boolean).map((tab) => ({
    id: tab.id,
    name: tab.name,
    entityIds: tab.entityIds.filter((entityId) => {
      if (presentation !== QUICK_ACCESS_PRESENTATION_ROOMS) return true;
      if (seenEntityIds.has(entityId)) return false;
      seenEntityIds.add(entityId);
      return true;
    }),
  }));

  return { presentation, sections };
}

function getQuickAccessLayoutEntityIds(layout) {
  const seenEntityIds = new Set();
  const sections = Array.isArray(layout?.sections) ? layout.sections : [];

  return sections.reduce((entityIds, section) => {
    if (!Array.isArray(section?.entityIds)) return entityIds;
    section.entityIds.forEach((entityId) => {
      if (typeof entityId !== 'string' || seenEntityIds.has(entityId)) return;
      seenEntityIds.add(entityId);
      entityIds.push(entityId);
    });
    return entityIds;
  }, []);
}

function calculateQuickAccessMasonryRowSpan(itemHeight, rowHeight = 1, rowGap = 0) {
  const safeItemHeight = Number(itemHeight);
  const safeRowHeight = Number(rowHeight);
  const safeRowGap = Number(rowGap);
  if (!Number.isFinite(safeItemHeight) || safeItemHeight <= 0) return 1;
  if (!Number.isFinite(safeRowHeight) || safeRowHeight <= 0) return 1;

  const normalizedGap = Number.isFinite(safeRowGap) ? Math.max(0, safeRowGap) : 0;
  return Math.max(1, Math.ceil((safeItemHeight + normalizedGap) / (safeRowHeight + normalizedGap)));
}

export {
  QUICK_ACCESS_PRESENTATION_ROOMS,
  QUICK_ACCESS_PRESENTATION_TABS,
  buildQuickAccessLayout,
  calculateQuickAccessMasonryRowSpan,
  filterUnavailableQuickAccessSections,
  getQuickAccessDeviceIdentity,
  getQuickAccessLayoutEntityIds,
  getQuickAccessPresentation,
  isQuickAccessEntityUnavailable,
  normalizeQuickAccessPresentation,
};
