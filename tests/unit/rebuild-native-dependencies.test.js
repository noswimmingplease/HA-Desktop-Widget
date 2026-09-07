const path = require('path');
const fs = require('fs');
const rebuildNativeDependencies = require('../../scripts/rebuild-native-dependencies.cjs');

// Use the real enum re-export without loading unrelated ESM packaging targets
// through Jest's CommonJS runtime.
jest.mock('electron-builder', () => ({ Arch: require('builder-util').Arch }));

describe('native dependency rebuild policy', () => {
  test('reviews install scripts for every platform in the lockfile', () => {
    const { allowScripts } = require('../../package.json');
    const { packages } = require('../../package-lock.json');
    for (const [location, pkg] of Object.entries(packages)) {
      if (!location || !pkg.hasInstallScript) continue;
      const name = location.split('node_modules/').pop();
      expect(typeof allowScripts[`${name}@${pkg.version}`]).toBe('boolean');
    }
  });

  test('postinstall rebuilds runtime addons but excludes unused usocket', async () => {
    const rebuild = jest.fn().mockResolvedValue(undefined);
    await expect(rebuildNativeDependencies({}, rebuild)).resolves.toBeUndefined();
    expect(rebuild).toHaveBeenCalledWith({
      buildPath: path.resolve(__dirname, '../..'),
      projectRootPath: path.resolve(__dirname, '../..'),
      electronVersion: require('electron/package.json').version,
      arch: process.arch,
      platform: process.platform,
      buildFromSource: false,
      mode: 'sequential',
      disablePreGypCopy: true,
      ignoreModules: ['usocket'],
    });
  });

  test.each([
    ['win32', 'x64'],
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'x64'],
  ])('honours packaging target %s/%s rather than host defaults', async (platform, arch) => {
    const rebuild = jest.fn().mockResolvedValue(undefined);
    await rebuildNativeDependencies(
      {
        packager: {
          appDir: '/app',
          info: { framework: { version: '43.5.0' } },
          config: { buildDependenciesFromSource: true },
        },
        electronPlatformName: platform,
        arch: require('electron-builder').Arch[arch],
      },
      rebuild
    );
    expect(rebuild).toHaveBeenCalledWith(
      expect.objectContaining({
        buildPath: '/app',
        electronVersion: '43.5.0',
        platform,
        arch,
        buildFromSource: true,
        ignoreModules: ['usocket'],
      })
    );
  });

  test('does not conceal failures in required native addons', async () => {
    const rebuild = jest.fn().mockRejectedValue(new Error('Native build failed'));
    await expect(rebuildNativeDependencies({}, rebuild)).rejects.toThrow('Native build failed');
  });

  test('installation and packaging share the policy and disable the unused install script', () => {
    const pkg = require('../../package.json');
    expect(pkg.scripts.postinstall).toBe('node scripts/rebuild-native-dependencies.cjs');
    expect(pkg.allowScripts['usocket@1.0.3']).toBe(false);
    const config = fs.readFileSync(path.resolve(__dirname, '../../electron-builder.yml'), 'utf8');
    expect(config).toContain('npmRebuild: false');
    expect(config).toContain('beforePack: scripts/rebuild-native-dependencies.cjs');
    expect(config).not.toMatch(/^beforeBuild:/m);
    expect(config).toContain("'!node_modules/usocket/**/*'");
  });
});
