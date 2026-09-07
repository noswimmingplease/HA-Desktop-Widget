/**
 * @jest-environment node
 */

const {
  boundsOverlapWorkArea,
  boundsVisibleOnAnyWorkArea,
  clampPositionToWorkAreas,
  clampWindowBoundsToWorkAreas,
  normalizeWindowDisplayId,
  resolveWindowPlacement,
} = require('../../src/window-placement.cjs');

// The layout that exposed this: three displays with empty space above the left one and to
// the left of the middle one, so 0,0 and 100,100 are not on any display.
const DISPLAYS = [
  { x: 0, y: 1080, width: 2560, height: 1440 },
  { x: 1544, y: 0, width: 1920, height: 1080 },
  { x: 2560, y: 1080, width: 2560, height: 1080 },
];
const WINDOW_SIZE = { width: 500, height: 600 };

describe('window placement', () => {
  const monitors = [
    { id: 1, workArea: { x: 0, y: 0, width: 2560, height: 1392 } },
    { id: 2, workArea: { x: -2560, y: 0, width: 2560, height: 1392 } },
    { id: 3, workArea: { x: 2560, y: -1130, width: 1440, height: 2512 } },
  ];
  const saved = { windowPosition: { x: -1438, y: 137 }, windowSize: { width: 1438, height: 1255 } };

  test.each([1, 2, 3])(
    'fills monitor %s exactly without changing saved windowed geometry',
    (id) => {
      const config = { ...saved, windowDisplayId: String(id), fillMonitor: true };
      const before = JSON.stringify(config);
      expect(resolveWindowPlacement(config, monitors, 1)).toEqual(monitors[id - 1].workArea);
      expect(JSON.stringify(config)).toBe(before);
      expect(resolveWindowPlacement({ ...config, fillMonitor: false }, monitors, 1)).toMatchObject(
        saved.windowSize
      );
    }
  );

  test('automatic uses the last monitor, explicit primary uses primary', () => {
    expect(resolveWindowPlacement({ ...saved, fillMonitor: true }, monitors, 1)).toEqual(
      monitors[1].workArea
    );
    expect(
      resolveWindowPlacement(
        { ...saved, windowDisplayId: 'primary', fillMonitor: true },
        monitors,
        1
      )
    ).toEqual(monitors[0].workArea);
  });

  test('disconnected selection falls back to primary and returns when reconnected', () => {
    const config = { ...saved, windowDisplayId: '3', fillMonitor: true };
    expect(resolveWindowPlacement(config, monitors.slice(0, 2), 1)).toEqual(monitors[0].workArea);
    expect(config.windowDisplayId).toBe('3');
    expect(resolveWindowPlacement(config, monitors, 1)).toEqual(monitors[2].workArea);
  });

  test('fits a window into a selected scaled display and handles no available displays', () => {
    const display = { id: 4, workArea: { x: 0, y: 30, width: 1280, height: 690 } };
    expect(resolveWindowPlacement({ ...saved, windowDisplayId: '4' }, [display], 4)).toEqual(
      display.workArea
    );
    expect(resolveWindowPlacement(saved, [], 4)).toEqual({
      ...saved.windowPosition,
      ...saved.windowSize,
    });
  });

  test('normalises local display identifiers without accepting arbitrary values', () => {
    expect(normalizeWindowDisplayId(123)).toBe('123');
    expect(normalizeWindowDisplayId('primary')).toBe('primary');
    for (const value of [null, {}, true, '', 'abc', Infinity])
      expect(normalizeWindowDisplayId(value)).toBeNull();
  });

  test('fits the reported cross-monitor window into the display with most overlap', () => {
    const areas = [
      { x: 0, y: 0, width: 2560, height: 1392 },
      { x: -2560, y: 0, width: 2560, height: 1392 },
      { x: 2560, y: -1130, width: 1440, height: 2512 },
    ];
    expect(
      clampWindowBoundsToWorkAreas({ x: -1148, y: 601, width: 1438, height: 1255 }, areas)
    ).toEqual({ x: -1438, y: 137, width: 1438, height: 1255 });
    const portrait = { x: 2560, y: -1100, width: 1400, height: 2300 };
    expect(clampWindowBoundsToWorkAreas(portrait, areas)).toEqual(portrait);
    expect(clampWindowBoundsToWorkAreas(portrait, areas.slice(0, 2))).toEqual({
      x: 1160,
      y: 0,
      width: 1400,
      height: 1392,
    });
  });

  test('shrinks oversized windows, handles changed scaling, and ignores invalid work areas', () => {
    const scaledArea = { x: 0, y: 0, width: 1707, height: 928 };
    expect(
      clampWindowBoundsToWorkAreas({ x: 1900, y: 1100, width: 2000, height: 1200 }, [scaledArea])
    ).toEqual({ x: 0, y: 0, width: 1707, height: 928 });
    const bounds = { x: -100, y: -100, width: 300, height: 400 };
    expect(clampWindowBoundsToWorkAreas(bounds, [{ ...scaledArea, width: Infinity }])).toEqual(
      bounds
    );
  });
  test('accepts a position that sits on a display', () => {
    expect(boundsOverlapWorkArea({ x: 300, y: 1200, ...WINDOW_SIZE }, DISPLAYS[0])).toBe(true);
    expect(boundsVisibleOnAnyWorkArea({ x: 2700, y: 1200, ...WINDOW_SIZE }, DISPLAYS)).toBe(true);
  });

  test('treats a barely-overlapping position as off-screen', () => {
    // Only 8px of the window would be grabbable on the left display.
    expect(boundsOverlapWorkArea({ x: -492, y: 1200, ...WINDOW_SIZE }, DISPLAYS[0])).toBe(false);
    // Hanging off an edge but still usable.
    expect(boundsOverlapWorkArea({ x: -200, y: 1200, ...WINDOW_SIZE }, DISPLAYS[0])).toBe(true);
  });

  test('leaves a deliberately placed position untouched', () => {
    expect(clampPositionToWorkAreas({ x: 300, y: 1200, ...WINDOW_SIZE }, DISPLAYS)).toEqual({
      x: 300,
      y: 1200,
    });
    expect(clampPositionToWorkAreas({ x: -120, y: 1200, ...WINDOW_SIZE }, DISPLAYS)).toEqual({
      x: -120,
      y: 1200,
    });
  });

  test('recovers a position in the gap between displays onto the nearest one', () => {
    const placement = clampPositionToWorkAreas({ x: 0, y: 0, ...WINDOW_SIZE }, DISPLAYS);
    expect(boundsVisibleOnAnyWorkArea({ ...placement, ...WINDOW_SIZE }, DISPLAYS)).toBe(true);
    // Nearest display centre to 0,0 is the left one, so the widget lands in its corner.
    expect(placement).toEqual({ x: 0, y: 1080 });
  });

  test('recovers a position on a monitor that is no longer connected', () => {
    const placement = clampPositionToWorkAreas({ x: 6000, y: 2400, ...WINDOW_SIZE }, DISPLAYS);
    expect(placement).toEqual({ x: 4620, y: 1560 });
    expect(boundsVisibleOnAnyWorkArea({ ...placement, ...WINDOW_SIZE }, DISPLAYS)).toBe(true);
  });

  test('handles a window larger than the display it lands on', () => {
    const placement = clampPositionToWorkAreas({ x: 9000, y: 9000, width: 4000, height: 3000 }, [
      { x: 0, y: 0, width: 1280, height: 720 },
    ]);
    expect(placement).toEqual({ x: 0, y: 0 });
  });

  test('falls back safely with unusable input', () => {
    expect(clampPositionToWorkAreas({ x: 10, y: 20, ...WINDOW_SIZE }, [])).toEqual({
      x: 10,
      y: 20,
    });
    expect(clampPositionToWorkAreas({}, DISPLAYS)).toEqual({ x: 0, y: 1080 });
    expect(
      clampPositionToWorkAreas({ x: 'nope', y: null, ...WINDOW_SIZE }, [
        { x: 0, y: 0, width: 0, height: 0 },
      ])
    ).toEqual({ x: 0, y: 0 });
  });
});
