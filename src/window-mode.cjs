'use strict';

const nodeProcess = require('process');
const { clearTimeout: cancelTimeout, setTimeout: scheduleTimeout } = require('timers');

function shouldStartFullScreen(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  if (args.includes('--windowed')) return false;
  return args.includes('--fullscreen');
}

function normalizeCloseButtonAction(value) {
  return value === 'quit' ? 'quit' : 'minimize';
}

function canPersistMainWindowBounds(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed?.()) return false;
  if (targetWindow.isFullScreen?.()) return false;
  if (targetWindow.isKiosk?.()) return false;
  if (targetWindow.isMaximized?.()) return false;
  if (targetWindow.isMinimized?.()) return false;
  return true;
}

function isFullScreenShortcut(input = {}) {
  return input.type === 'keyDown' && !input.isAutoRepeat && input.key === 'F11';
}

function isFullScreenExitShortcut(input = {}) {
  return input.type === 'keyDown' && !input.isAutoRepeat && input.key === 'Escape';
}

function toggleWindowMaximized(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed?.()) {
    return { success: false, error: 'Main window is unavailable.' };
  }
  if (targetWindow.isFullScreen?.()) {
    return { success: false, error: 'Exit full-screen mode before maximising the window.' };
  }

  const isMaximized = !!targetWindow.isMaximized?.();
  try {
    if (isMaximized) {
      targetWindow.unmaximize();
    } else {
      targetWindow.maximize();
    }
    return { success: true, isMaximized: !isMaximized };
  } catch (error) {
    return {
      success: false,
      error: error?.message || 'Unable to maximise or restore the window.',
    };
  }
}

function copyWindowBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const copiedBounds = {
    x: Number(bounds.x),
    y: Number(bounds.y),
    width: Number(bounds.width),
    height: Number(bounds.height),
  };
  if (!Object.values(copiedBounds).every(Number.isFinite)) return null;
  if (copiedBounds.width <= 0 || copiedBounds.height <= 0) return null;
  return copiedBounds;
}

function areWindowBoundsEqual(left, right) {
  return !!left && !!right && Object.keys(left).every((key) => left[key] === right[key]);
}

function createFullScreenController({
  getWindow,
  screen,
  platform = nodeProcess.platform,
  onNormalBoundsCaptured,
  schedule = scheduleTimeout,
  cancelScheduled = cancelTimeout,
  exitFallbackDelayMs = 250,
} = {}) {
  if (typeof getWindow !== 'function') {
    throw new TypeError('createFullScreenController requires getWindow');
  }

  let requested = false;
  let transitionInProgress = false;
  let restoreBounds = null;
  let exitFallbackTimer = null;

  const getUsableWindow = () => {
    const targetWindow = getWindow();
    if (!targetWindow || targetWindow.isDestroyed?.()) return null;
    return targetWindow;
  };

  const publishNormalBounds = (bounds) => {
    if (typeof onNormalBoundsCaptured === 'function') {
      onNormalBoundsCaptured({ ...bounds });
    }
  };

  const clearExitFallback = () => {
    if (exitFallbackTimer === null) return;
    cancelScheduled(exitFallbackTimer);
    exitFallbackTimer = null;
  };

  const finishExit = () => {
    const targetWindow = getUsableWindow();
    if (!targetWindow || !restoreBounds || targetWindow.isFullScreen?.()) return false;

    // Consume the snapshot before restoring it. This keeps a synchronous
    // leave-full-screen event and the immediate fallback idempotent.
    const boundsToRestore = { ...restoreBounds };
    restoreBounds = null;
    clearExitFallback();
    requested = false;
    transitionInProgress = false;
    const currentBounds = copyWindowBounds(targetWindow.getBounds?.());
    if (!areWindowBoundsEqual(currentBounds, boundsToRestore)) {
      targetWindow.setBounds(boundsToRestore);
    }
    publishNormalBounds(boundsToRestore);
    return true;
  };

  const scheduleExitFallback = () => {
    if (!restoreBounds || exitFallbackTimer !== null) return;
    exitFallbackTimer = schedule(() => {
      exitFallbackTimer = null;
      finishExit();
    }, exitFallbackDelayMs);
  };

  const handleEnter = () => {
    clearExitFallback();
    requested = true;
    transitionInProgress = false;
  };

  const handleLeave = () => {
    requested = false;
    // Electron can emit this event from inside setFullScreen(false), before
    // Windows has finished applying its own final bounds. Defer restoration so
    // the native transition cannot overwrite the saved normal geometry.
    transitionInProgress = true;
    scheduleExitFallback();
  };

  const setEnabled = (enabled) => {
    const targetWindow = getUsableWindow();
    if (!targetWindow) return false;

    const shouldEnable = !!enabled;
    const nativeFullScreen = !!targetWindow.isFullScreen?.();
    if (shouldEnable && (requested || nativeFullScreen)) return true;
    if (!shouldEnable && !requested && !nativeFullScreen) {
      finishExit();
      return true;
    }

    if (shouldEnable) {
      clearExitFallback();
      // getNormalBounds() intentionally returns the pre-snap restore rectangle.
      // A snapped Windows window needs its visible zone geometry captured instead.
      const normalBounds = targetWindow.isSnapped?.()
        ? copyWindowBounds(targetWindow.getBounds?.())
        : copyWindowBounds(targetWindow.getNormalBounds?.()) ||
          copyWindowBounds(targetWindow.getBounds?.());
      if (!normalBounds) return false;

      restoreBounds = { ...normalBounds };
      publishNormalBounds(normalBounds);
      requested = true;
      transitionInProgress = true;

      try {
        // Electron does not accept a display argument for setFullScreen. On
        // Windows, place the HWND wholly inside the display containing the
        // normal window before asking the OS to enter native fullscreen.
        if (platform === 'win32') {
          const matchingDisplay = screen?.getDisplayMatching?.(normalBounds);
          const displayBounds = copyWindowBounds(matchingDisplay?.bounds);
          if (displayBounds) targetWindow.setBounds(displayBounds);
        }

        targetWindow.setFullScreen(true);
        if (targetWindow.isFullScreen?.()) transitionInProgress = false;
        return true;
      } catch {
        clearExitFallback();
        requested = false;
        transitionInProgress = false;
        const boundsToRestore = restoreBounds;
        restoreBounds = null;
        if (boundsToRestore) targetWindow.setBounds(boundsToRestore);
        return false;
      }
    }

    requested = false;
    transitionInProgress = true;
    try {
      targetWindow.setFullScreen(false);
      // Windows may complete this synchronously. The permanent event listener
      // handles the normal path; this covers a missing or already-fired event.
      if (!targetWindow.isFullScreen?.()) finishExit();
      if (restoreBounds) {
        // Some Windows builds emit leave-full-screen before isFullScreen() has
        // settled, and it can remain true until after setFullScreen() returns.
        // Re-check once the native transition has had time to complete.
        scheduleExitFallback();
      }
      return true;
    } catch {
      clearExitFallback();
      transitionInProgress = false;
      return false;
    }
  };

  return {
    finishExit,
    getRestoreBounds: () => (restoreBounds ? { ...restoreBounds } : null),
    handleEnter,
    handleLeave,
    isActive: () => requested || !!getUsableWindow()?.isFullScreen?.(),
    isTransitioning: () => transitionInProgress,
    setEnabled,
  };
}

module.exports = {
  canPersistMainWindowBounds,
  createFullScreenController,
  isFullScreenExitShortcut,
  isFullScreenShortcut,
  normalizeCloseButtonAction,
  shouldStartFullScreen,
  toggleWindowMaximized,
};
