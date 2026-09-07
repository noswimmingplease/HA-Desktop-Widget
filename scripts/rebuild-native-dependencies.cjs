const path = require('node:path');

// dbus-next's optional usocket addon is neither used nor shipped: our Linux
// integrations use net.Socket instead. Rebuilding it can fail on Windows even
// though electron-builder's files filter excludes it from the finished app.
// Use the same rebuild policy during npm install and each packaging architecture.
async function rebuildNativeDependencies(context = {}, rebuild = null) {
  if (!rebuild) ({ rebuild } = await import('@electron/rebuild'));
  const packager = context.packager;
  const appDir = packager?.appDir || path.resolve(__dirname, '..');
  await rebuild({
    buildPath: appDir,
    projectRootPath: appDir,
    electronVersion: packager?.info.framework.version || require('electron/package.json').version,
    arch: packager ? require('electron-builder').Arch[context.arch] : process.arch,
    platform: context.electronPlatformName || process.platform,
    buildFromSource: packager?.config.buildDependenciesFromSource === true,
    mode: 'sequential',
    disablePreGypCopy: true,
    ignoreModules: ['usocket'],
  });
}

module.exports = rebuildNativeDependencies;

if (require.main === module) {
  rebuildNativeDependencies().catch((error) => {
    console.error('Native dependency rebuild failed:', error);
    process.exitCode = 1;
  });
}
