const {
  canPersistMainWindowBounds,
  createFullScreenController,
  isFullScreenExitShortcut,
  isFullScreenShortcut,
  migrateStartMinimizedSetting,
  normalizeCloseButtonAction,
  shouldStartMinimized,
  shouldStartFullScreen,
  toggleWindowMaximized,
} = require('../../src/window-mode.cjs');
const { EventEmitter } = require('events');

function createWindowMock({
  normalBounds,
  bounds = normalBounds,
  exitMode = 'sync-event',
  snapped = false,
}) {
  const targetWindow = new EventEmitter();
  let fullScreen = false;
  let currentNormalBounds = { ...normalBounds };
  let currentBounds = { ...bounds };
  let pendingExit = false;
  const setBoundsCalls = [];
  const setFullScreenCalls = [];

  Object.assign(targetWindow, {
    completeExit() {
      if (!pendingExit) return;
      pendingExit = false;
      fullScreen = false;
      if (exitMode !== 'deferred-no-event') targetWindow.emit('leave-full-screen');
    },
    getBounds: () => ({ ...currentBounds }),
    getNormalBounds: () => ({ ...currentNormalBounds }),
    isDestroyed: () => false,
    isFullScreen: () => fullScreen,
    isSnapped: () => snapped,
    replaceNormalBounds(bounds) {
      currentNormalBounds = { ...bounds };
    },
    setBounds(bounds) {
      currentBounds = { ...bounds };
      setBoundsCalls.push({ ...bounds });
    },
    setFullScreen(enabled) {
      setFullScreenCalls.push(!!enabled);
      if (enabled) {
        fullScreen = true;
        targetWindow.emit('enter-full-screen');
        return;
      }
      if (exitMode === 'async-event' || exitMode === 'deferred-no-event') {
        pendingExit = true;
        return;
      }
      fullScreen = false;
      if (exitMode === 'sync-event' || exitMode === 'sync-event-overwrite') {
        const nativeExitBounds = { ...currentBounds };
        targetWindow.emit('leave-full-screen');
        if (exitMode === 'sync-event-overwrite') targetWindow.setBounds(nativeExitBounds);
      }
    },
    setBoundsCalls,
    setFullScreenCalls,
  });

  return targetWindow;
}

function wireFullScreenController(targetWindow, options = {}) {
  const controller = createFullScreenController({
    getWindow: () => targetWindow,
    platform: 'win32',
    ...options,
  });
  targetWindow.on('enter-full-screen', controller.handleEnter);
  targetWindow.on('leave-full-screen', controller.handleLeave);
  return controller;
}

describe('window mode helpers', () => {
  test('starts hidden only for opted-in normal launches', () => {
    expect(shouldStartMinimized({ enabled: true, argv: ['app.exe'] })).toBe(true);
    expect(shouldStartMinimized({ enabled: true, argv: ['app.exe', '--login-startup'] })).toBe(
      true
    );
    expect(shouldStartMinimized({ enabled: false, argv: ['app.exe'] })).toBe(false);
    expect(shouldStartMinimized({ enabled: true, argv: ['app.exe', '--fullscreen'] })).toBe(false);
    expect(shouldStartMinimized({ enabled: true, argv: ['app.exe', '--smoke-test'] })).toBe(false);
  });

  test('migrates the login-only preference without overriding an explicit new value', () => {
    const legacy = { startInTrayAtLogin: true };
    expect(migrateStartMinimizedSetting(legacy)).toBe(true);
    expect(legacy).toEqual({ startMinimized: true });

    const current = { startMinimized: false, startInTrayAtLogin: true };
    expect(migrateStartMinimizedSetting(current)).toBe(false);
    expect(current).toEqual({ startMinimized: false });
  });

  test('normalizes the close button action to minimise unless quit is explicit', () => {
    expect(normalizeCloseButtonAction('quit')).toBe('quit');
    expect(normalizeCloseButtonAction('minimize')).toBe('minimize');
    expect(normalizeCloseButtonAction('invalid')).toBe('minimize');
    expect(normalizeCloseButtonAction()).toBe('minimize');
  });

  test('starts full screen only when explicitly requested', () => {
    expect(shouldStartFullScreen(['electron', '.'])).toBe(false);
    expect(shouldStartFullScreen(['electron', '.', '--fullscreen'])).toBe(true);
  });

  test('--windowed overrides --fullscreen as a recovery path', () => {
    expect(shouldStartFullScreen(['electron', '.', '--fullscreen', '--windowed'])).toBe(false);
  });

  test('does not persist transient full-screen, kiosk, maximized or minimized bounds', () => {
    expect(
      canPersistMainWindowBounds({
        isDestroyed: () => false,
        isFullScreen: () => false,
        isKiosk: () => false,
        isMaximized: () => false,
        isMinimized: () => false,
      })
    ).toBe(true);
    expect(
      canPersistMainWindowBounds({
        isDestroyed: () => false,
        isFullScreen: () => true,
        isKiosk: () => false,
        isMaximized: () => false,
        isMinimized: () => false,
      })
    ).toBe(false);
    expect(
      canPersistMainWindowBounds({
        isDestroyed: () => false,
        isFullScreen: () => false,
        isKiosk: () => true,
        isMaximized: () => false,
        isMinimized: () => false,
      })
    ).toBe(false);
    expect(
      canPersistMainWindowBounds({
        isDestroyed: () => false,
        isFullScreen: () => false,
        isKiosk: () => false,
        isMaximized: () => true,
        isMinimized: () => false,
      })
    ).toBe(false);
    expect(
      canPersistMainWindowBounds({
        isDestroyed: () => false,
        isFullScreen: () => false,
        isKiosk: () => false,
        isMaximized: () => false,
        isMinimized: () => true,
      })
    ).toBe(false);
  });

  test('recognises non-repeating F11 and Escape key-down events', () => {
    expect(isFullScreenShortcut({ type: 'keyDown', key: 'F11' })).toBe(true);
    expect(isFullScreenShortcut({ type: 'keyDown', key: 'F11', isAutoRepeat: true })).toBe(false);
    expect(isFullScreenExitShortcut({ type: 'keyDown', key: 'Escape' })).toBe(true);
    expect(isFullScreenExitShortcut({ type: 'keyUp', key: 'Escape' })).toBe(false);
  });

  test('maximises and restores without entering native full-screen mode', () => {
    let maximized = false;
    const targetWindow = {
      isDestroyed: () => false,
      isFullScreen: () => false,
      isMaximized: () => maximized,
      maximize: jest.fn(() => {
        maximized = true;
      }),
      unmaximize: jest.fn(() => {
        maximized = false;
      }),
    };

    expect(toggleWindowMaximized(targetWindow)).toEqual({ success: true, isMaximized: true });
    expect(targetWindow.maximize).toHaveBeenCalledTimes(1);
    expect(targetWindow.unmaximize).not.toHaveBeenCalled();

    expect(toggleWindowMaximized(targetWindow)).toEqual({ success: true, isMaximized: false });
    expect(targetWindow.unmaximize).toHaveBeenCalledTimes(1);
  });

  test('does not maximise an unavailable or native full-screen window', () => {
    expect(toggleWindowMaximized(null)).toEqual({
      success: false,
      error: 'Main window is unavailable.',
    });
    expect(
      toggleWindowMaximized({
        isDestroyed: () => false,
        isFullScreen: () => true,
      })
    ).toEqual({
      success: false,
      error: 'Exit full-screen mode before maximising the window.',
    });
  });

  test('anchors Windows fullscreen to the display matching the original normal bounds', () => {
    const normalBounds = { x: -1800, y: 120, width: 900, height: 700 };
    const displayBounds = { x: -2560, y: 0, width: 2560, height: 1440 };
    const targetWindow = createWindowMock({ normalBounds });
    const screen = { getDisplayMatching: jest.fn(() => ({ bounds: displayBounds })) };
    const controller = wireFullScreenController(targetWindow, { screen });

    expect(controller.setEnabled(true)).toBe(true);

    expect(screen.getDisplayMatching).toHaveBeenCalledWith(normalBounds);
    expect(targetWindow.setBoundsCalls[0]).toEqual(displayBounds);
    expect(targetWindow.setFullScreenCalls).toEqual([true]);
    expect(controller.getRestoreBounds()).toEqual(normalBounds);
  });

  test('captures visible snapped bounds instead of the pre-snap restore rectangle', () => {
    const normalBounds = { x: 300, y: 180, width: 1200, height: 800 };
    const snappedBounds = { x: 0, y: 0, width: 1280, height: 1400 };
    const displayBounds = { x: 0, y: 0, width: 2560, height: 1440 };
    const targetWindow = createWindowMock({
      normalBounds,
      bounds: snappedBounds,
      snapped: true,
    });
    const screen = { getDisplayMatching: jest.fn(() => ({ bounds: displayBounds })) };
    const controller = wireFullScreenController(targetWindow, { screen });

    expect(controller.setEnabled(true)).toBe(true);

    expect(screen.getDisplayMatching).toHaveBeenCalledWith(snappedBounds);
    expect(controller.getRestoreBounds()).toEqual(snappedBounds);
  });

  test('restores exact bounds when Windows emits leave-full-screen synchronously', () => {
    const normalBounds = { x: 354, y: 172, width: 1901, height: 969 };
    const targetWindow = createWindowMock({ normalBounds, exitMode: 'sync-event-overwrite' });
    const controller = wireFullScreenController(targetWindow, {
      screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 2560, height: 1440 } }) },
    });

    controller.setEnabled(true);
    expect(controller.setEnabled(false)).toBe(true);

    expect(targetWindow.setBoundsCalls.at(-1)).toEqual(normalBounds);
    expect(controller.isTransitioning()).toBe(false);
  });

  test('restores exact bounds when native exit completes without an event', () => {
    const normalBounds = { x: 2700, y: -900, width: 1100, height: 1800 };
    const targetWindow = createWindowMock({ normalBounds, exitMode: 'no-event' });
    const controller = wireFullScreenController(targetWindow, {
      screen: {
        getDisplayMatching: () => ({ bounds: { x: 2560, y: -1130, width: 1440, height: 2560 } }),
      },
    });

    controller.setEnabled(true);
    controller.setEnabled(false);

    expect(targetWindow.setBoundsCalls.at(-1)).toEqual(normalBounds);
    expect(controller.getRestoreBounds()).toBeNull();
  });

  test('waits for an asynchronous exit before restoring normal bounds', () => {
    const normalBounds = { x: 100, y: 80, width: 1200, height: 800 };
    const targetWindow = createWindowMock({ normalBounds, exitMode: 'async-event' });
    const scheduled = [];
    const controller = wireFullScreenController(targetWindow, {
      screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 2560, height: 1440 } }) },
      schedule: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancelScheduled: jest.fn(),
    });

    controller.setEnabled(true);
    controller.setEnabled(false);
    expect(targetWindow.setBoundsCalls).toHaveLength(1);
    expect(controller.isTransitioning()).toBe(true);

    targetWindow.completeExit();
    scheduled[0]();
    expect(targetWindow.setBoundsCalls.at(-1)).toEqual(normalBounds);
    expect(controller.isTransitioning()).toBe(false);
  });

  test('rechecks Windows state after an early or missing exit event', () => {
    const normalBounds = { x: 354, y: 172, width: 1901, height: 969 };
    const targetWindow = createWindowMock({ normalBounds, exitMode: 'deferred-no-event' });
    const scheduled = [];
    const controller = wireFullScreenController(targetWindow, {
      screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 2560, height: 1440 } }) },
      schedule: (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
      cancelScheduled: jest.fn(),
    });

    controller.setEnabled(true);
    controller.setEnabled(false);
    expect(controller.isTransitioning()).toBe(true);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].delay).toBe(250);

    targetWindow.completeExit();
    scheduled[0].callback();

    expect(targetWindow.setBoundsCalls.at(-1)).toEqual(normalBounds);
    expect(controller.isTransitioning()).toBe(false);
  });

  test('refreshes the restore snapshot for each fullscreen cycle', () => {
    const firstBounds = { x: 100, y: 80, width: 1200, height: 800 };
    const secondBounds = { x: -2100, y: 140, width: 1400, height: 900 };
    const targetWindow = createWindowMock({ normalBounds: firstBounds });
    const controller = wireFullScreenController(targetWindow, {
      screen: {
        getDisplayMatching: ({ x }) => ({
          bounds: { x: x < 0 ? -2560 : 0, y: 0, width: 2560, height: 1440 },
        }),
      },
    });

    controller.setEnabled(true);
    controller.setEnabled(false);
    targetWindow.replaceNormalBounds(secondBounds);
    controller.setEnabled(true);
    controller.setEnabled(false);

    expect(targetWindow.setBoundsCalls.at(-1)).toEqual(secondBounds);
  });
});
