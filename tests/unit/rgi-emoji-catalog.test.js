const fs = require('fs');
const path = require('path');

describe('bundled custom icon catalog', () => {
  const mdiCssPath = path.resolve(
    __dirname,
    '../../node_modules/@mdi/font/css/materialdesignicons.css'
  );

  test('contains the main device and backup icon families', () => {
    const css = fs.readFileSync(mdiCssPath, 'utf8');

    [
      'television',
      'monitor',
      'desktop-tower-monitor',
      'backup-restore',
      'nas',
      'harddisk',
      'database',
    ].forEach((iconName) => {
      expect(css).toContain(`.mdi-${iconName}::before`);
    });
  });

  test('provides a broad local catalog without relying on system emoji fonts', () => {
    const css = fs.readFileSync(mdiCssPath, 'utf8');
    const iconSelectors = css.match(/\.mdi-[a-z0-9-]+::before/g) || [];

    expect(new Set(iconSelectors).size).toBeGreaterThan(7000);
  });
});
