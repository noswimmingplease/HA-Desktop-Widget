const {
  QUICK_ACCESS_PRESENTATION_ROOMS,
  QUICK_ACCESS_PRESENTATION_TABS,
  buildQuickAccessLayout,
  calculateQuickAccessMasonryRowSpan,
  filterUnavailableQuickAccessSections,
  getQuickAccessDeviceIdentity,
  getQuickAccessLayoutEntityIds,
  getQuickAccessPresentation,
  normalizeQuickAccessPresentation,
} = require('../../src/quick-access-layout.js');

describe('quick-access-layout helpers', () => {
  const config = {
    activeTabId: 'upstairs',
    customTabs: [
      {
        id: 'downstairs',
        name: 'Downstairs',
        entityIds: ['light.kitchen', 'sensor.router'],
      },
      {
        id: 'upstairs',
        name: 'Upstairs',
        entityIds: ['light.bedroom', 'sensor.router'],
      },
    ],
  };

  test('defaults missing and invalid presentation values to the stock active-tab layout', () => {
    expect(getQuickAccessPresentation(config)).toBe(QUICK_ACCESS_PRESENTATION_TABS);
    expect(normalizeQuickAccessPresentation('columns')).toBe(QUICK_ACCESS_PRESENTATION_TABS);

    expect(buildQuickAccessLayout(config)).toEqual({
      presentation: QUICK_ACCESS_PRESENTATION_TABS,
      sections: [
        {
          id: 'upstairs',
          name: 'Upstairs',
          entityIds: ['light.bedroom', 'sensor.router'],
        },
      ],
    });
  });

  test('returns every room in config order and assigns a repeated entity to its first room', () => {
    const layout = buildQuickAccessLayout({
      ...config,
      ui: { quickAccessPresentation: QUICK_ACCESS_PRESENTATION_ROOMS },
    });

    expect(layout).toEqual({
      presentation: QUICK_ACCESS_PRESENTATION_ROOMS,
      sections: [
        {
          id: 'downstairs',
          name: 'Downstairs',
          entityIds: ['light.kitchen', 'sensor.router'],
        },
        {
          id: 'upstairs',
          name: 'Upstairs',
          entityIds: ['light.bedroom'],
        },
      ],
    });
    expect(getQuickAccessLayoutEntityIds(layout)).toEqual([
      'light.kitchen',
      'sensor.router',
      'light.bedroom',
    ]);
  });

  test('uses the active stock grid while reorganising a room presentation', () => {
    const layout = buildQuickAccessLayout(
      {
        ...config,
        ui: { quickAccessPresentation: QUICK_ACCESS_PRESENTATION_ROOMS },
      },
      { reorganizing: true }
    );

    expect(layout).toEqual({
      presentation: QUICK_ACCESS_PRESENTATION_TABS,
      sections: [
        {
          id: 'upstairs',
          name: 'Upstairs',
          entityIds: ['light.bedroom', 'sensor.router'],
        },
      ],
    });
  });

  test('does not impose a tile-count limit', () => {
    const entityIds = Array.from({ length: 24 }, (_, index) => `sensor.network_${index + 1}`);
    const layout = buildQuickAccessLayout({
      ui: { quickAccessPresentation: QUICK_ACCESS_PRESENTATION_ROOMS },
      customTabs: [{ id: 'network', name: 'Network', entityIds }],
      activeTabId: 'network',
    });

    expect(layout.sections[0].entityIds).toEqual(entityIds);
    expect(getQuickAccessLayoutEntityIds(layout)).toHaveLength(24);
  });

  test('optionally hides device panels whose known entities are all unavailable', () => {
    const layout = buildQuickAccessLayout({
      ui: { quickAccessPresentation: QUICK_ACCESS_PRESENTATION_ROOMS },
      customTabs: [
        { id: 'gamma', name: 'GAMMA', entityIds: ['sensor.gamma_cpu'] },
        {
          id: 'upsilon',
          name: 'Pi2 - UPSILON',
          entityIds: ['sensor.upsilon_cpu', 'sensor.upsilon_memory'],
        },
      ],
      activeTabId: 'gamma',
    });
    const states = {
      'sensor.gamma_cpu': { entity_id: 'sensor.gamma_cpu', state: '12' },
      'sensor.upsilon_cpu': { entity_id: 'sensor.upsilon_cpu', state: 'unavailable' },
      'sensor.upsilon_memory': { entity_id: 'sensor.upsilon_memory', state: 'unknown' },
    };

    expect(filterUnavailableQuickAccessSections(layout, states, true).sections).toEqual([
      layout.sections[0],
    ]);
    expect(filterUnavailableQuickAccessSections(layout, states, false)).toBe(layout);
  });

  test('keeps panels visible before the first snapshot and when an entity is missing', () => {
    const layout = buildQuickAccessLayout({
      ui: { quickAccessPresentation: QUICK_ACCESS_PRESENTATION_ROOMS },
      customTabs: [
        {
          id: 'upsilon',
          name: 'Pi2 - UPSILON',
          entityIds: ['sensor.upsilon_cpu', 'sensor.upsilon_missing'],
        },
      ],
      activeTabId: 'upsilon',
    });

    expect(filterUnavailableQuickAccessSections(layout, {}, true)).toBe(layout);
    expect(
      filterUnavailableQuickAccessSections(
        layout,
        {
          'sensor.upsilon_cpu': { entity_id: 'sensor.upsilon_cpu', state: 'unavailable' },
        },
        true
      )
    ).toEqual(layout);
  });

  test('calculates stable masonry spans from rendered height and grid rhythm', () => {
    expect(calculateQuickAccessMasonryRowSpan(100, 1, 16)).toBe(7);
    expect(calculateQuickAccessMasonryRowSpan(272, 1, 16)).toBe(17);
    expect(calculateQuickAccessMasonryRowSpan(0, 1, 16)).toBe(1);
    expect(calculateQuickAccessMasonryRowSpan(100, 0, 16)).toBe(1);
  });

  test('derives stable, type-aware identities for device sections', () => {
    const sections = [
      { id: 'home', name: 'Home controls', entityIds: ['light.kitchen'] },
      { id: 'gamma', name: 'GAMMA', entityIds: ['sensor.gamma_nvidia_gpu_load'] },
      { id: 'rho', name: 'RHO - NAS', entityIds: ['sensor.rho_cpu_load'] },
      { id: 'chi', name: 'CHI - NAS', entityIds: ['sensor.chi_cpu_load'] },
      { id: 'mu', name: 'Pi5 - MU', entityIds: ['sensor.mu_cpu_load'] },
      { id: 'eta', name: 'Pi4 - ETA', entityIds: ['sensor.eta_cpu_load'] },
      { id: 'upsilon', name: 'Pi2 - UPSILON', entityIds: ['sensor.upsilon_cpu_load'] },
    ];

    expect(sections.map(getQuickAccessDeviceIdentity)).toEqual([
      { kind: 'home', accent: 'sky', rgb: '159, 202, 255' },
      { kind: 'desktop', accent: 'mint', rgb: '156, 225, 195' },
      { kind: 'server', accent: 'lavender', rgb: '201, 184, 255' },
      { kind: 'server', accent: 'apricot', rgb: '255, 194, 158' },
      { kind: 'board', accent: 'rose', rgb: '255, 180, 207' },
      { kind: 'board', accent: 'gold', rgb: '255, 224, 153' },
      { kind: 'board', accent: 'aqua', rgb: '147, 222, 220' },
    ]);
    expect(getQuickAccessDeviceIdentity({ ...sections[6], name: 'Pi2 board Upsilon' })).toEqual({
      kind: 'board',
      accent: 'aqua',
      rgb: '147, 222, 220',
    });
  });
});
