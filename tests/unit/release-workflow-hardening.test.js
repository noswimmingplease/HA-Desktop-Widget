const fs = require('fs');
const path = require('path');

function readWorkflow(name) {
  return fs.readFileSync(path.resolve(__dirname, `../../.github/workflows/${name}`), 'utf8');
}

describe('release workflow hardening', () => {
  const ci = readWorkflow('ci.yml');
  const release = readWorkflow('release.yml');
  const tagRelease = readWorkflow('tag-release.yml');
  const nightlyBeta = readWorkflow('nightly-beta.yml');

  test('packages CI and public releases with fork identity on every platform', () => {
    expect(ci).toContain("branches: [main, 'feature/**']");
    const forkFlags = '--config electron-builder.fork.yml --config.directories.output=dist';
    expect(ci.split(forkFlags)).toHaveLength(4);
    const { scripts } = require('../../package.json');
    for (const script of ['dist', 'dist:win', 'dist:mac', 'dist:linux']) {
      expect(scripts[script]).toContain(forkFlags);
    }
    for (const script of ['dist', 'dist:mac', 'dist:linux']) {
      expect(release).toContain(`npm run ${script} -- --publish never`);
    }
    expect(ci).toContain('dist/linux-unpacked/ha-network-dashboard --smoke-test');
    expect(ci).toContain('HA Network Dashboard.exe');
    expect(release).toContain('HA Network Dashboard.app');
    for (const workflow of [ci, release, nightlyBeta]) {
      expect(workflow.match(/uses: actions\/setup-node@v5/g).length).toBe(
        workflow.match(/npm install --global npm@11\.19\.0/g).length
      );
    }
  });

  test('resolves one fork update destination without inheriting an upstream publisher', async () => {
    const { getConfig } = require('app-builder-lib/out/util/config/config');
    const config = await getConfig(path.resolve(__dirname, '../..'), 'electron-builder.fork.yml');
    expect(config.publish).toEqual({
      provider: 'github',
      owner: 'Ci303',
      repo: 'HA-Desktop-Widget',
      releaseType: 'release',
    });
    expect(config.extraMetadata.githubRepository).toBe('Ci303/HA-Desktop-Widget');
    expect(config.appId).toBe(config.extraMetadata.appId);
  });

  test.each(['electron-builder.local.yml', 'electron-builder.fork.yml'])(
    '%s only packages runtime files, not other builds or checkout files',
    async (configFile) => {
      const { getConfig } = require('app-builder-lib/out/util/config/config');
      const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher');
      const projectDir = path.resolve(__dirname, '../..');
      const config = await getConfig(projectDir, configFile);
      const output = path.join(projectDir, config.directories.output);
      for (const platform of ['win', 'mac', 'linux']) {
        const matchers = getMainFileMatchers(
          projectDir,
          path.join(output, 'app'),
          (value) => value,
          config[platform],
          {
            info: {
              config,
              projectDir,
              buildResourcesDir: 'build',
              debugLogger: { isEnabled: false },
            },
          },
          output,
          false
        );
        const includes = (file) =>
          matchers.some((matcher) =>
            matcher.createFilter()(path.join(projectDir, file), { isDirectory: () => false })
          );
        for (const file of [
          'main.js',
          'package.json',
          'build/icon.ico',
          'dist-renderer/renderer.js',
        ]) {
          expect(includes(file)).toBe(true);
        }
        for (const file of [
          'dist/win-unpacked/resources/app.asar',
          'dist-local/widget-Setup.exe',
          'dist-fork/widget-Portable.exe',
          'tests/unit/example.test.js',
          '.env',
        ]) {
          expect(includes(file)).toBe(false);
        }
      }
    }
  );

  test('keeps CI permissions minimal and packaged smoke launches bounded', () => {
    expect(ci).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(ci.match(/timeout-minutes: 2/g)).toHaveLength(3);
    expect(ci).toContain('timeout --kill-after=5s 30s xvfb-run');
    expect(ci).toContain('npm audit --audit-level=high');
    expect(release).toContain('npm audit --audit-level=high');
  });

  test('pins validation and every release consumer to one tested tag commit', () => {
    expect(release).toContain(
      'ref: refs/tags/${{ github.event.inputs.release_tag || github.ref_name }}'
    );
    expect(release).toContain('release_sha: ${{ steps.release_meta.outputs.release_sha }}');
    expect(release).toContain('$expectedWorkflowRef = "refs/tags/$releaseTag"');
    expect(release).toContain('$env:WORKFLOW_REF -ne $expectedWorkflowRef');
    expect(release.match(/ref: \$\{\{ needs\.validate\.outputs\.release_sha \}\}/g)).toHaveLength(
      5
    );
    expect(release).toContain('git merge-base --is-ancestor "$tag_sha" "$main_head"');
    expect(release).toContain('"refs/tags/$RELEASE_TAG^{commit}"');
    expect(release).toContain('RELEASE_SHA: ${{ needs.validate.outputs.release_sha }}');
  });

  test('requires exact-SHA CI before either manual or nightly tag creation', () => {
    for (const workflow of [tagRelease, nightlyBeta]) {
      expect(workflow).toContain('--workflow ci.yml');
      expect(workflow).toContain('--commit "$main_sha"');
      expect(workflow).toContain('--status success');
    }
  });

  test('dispatches publication from the created tag rather than mutable main', () => {
    expect(tagRelease).toContain('--ref "$release_tag"');
    expect(nightlyBeta).toContain('--ref "$RELEASE_TAG"');
    expect(tagRelease).not.toContain('--ref main');
    expect(nightlyBeta).not.toContain('--ref main');
  });

  test('publishes stable release notes from the matching changelog section', () => {
    expect(release).toContain(
      'node scripts/extract-release-notes.cjs "$RELEASE_VERSION" > "$release_notes_file"'
    );
    expect(release).toContain('notes_flags=(--notes-file "$release_notes_file")');
    expect(release).toContain(
      'Stable releases require a non-empty CHANGELOG.md section for $RELEASE_VERSION.'
    );
    expect(release).toContain('notes_flags=(--generate-notes)');
    expect(release).toContain('Generating prerelease notes from $notes_start_tag to $RELEASE_TAG.');
  });
});
