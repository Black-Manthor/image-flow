import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import official from 'stylelint-config-obsidianmd';

// The Electron version of each Obsidian release, from the table in the
// stylelint-config-obsidianmd README (the rule's documented browser target).
const electronOf: Record<string, number> = {
	'1.4.5': 25, '1.5.8': 28, '1.6.5': 30, '1.7.4': 31, '1.9.12': 37, '1.11.4': 39, '1.13.4': 43,
};
const TARGET_RULE = 'plugin/no-unsupported-browser-features';

const readJson = <T>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T;
const ours = () => readJson<{ extends?: unknown; rules?: Record<string, unknown> }>('.stylelintrc.json');

test('the CSS check uses the official Obsidian configuration, with nothing disabled or excluded', () => {
	const config = ours();
	assert.deepEqual(Object.keys(config).sort(), ['extends', 'rules'], 'no ignoreFiles, overrides, defaultSeverity or other options');
	assert.equal(config.extends, 'stylelint-config-obsidianmd');
	assert.deepEqual(Object.keys(config.rules ?? {}), [TARGET_RULE], 'only the browser target is set here');
	assert.equal(existsSync('.stylelintignore'), false, 'no ignore file');
	assert.equal('stylelint' in readJson<Record<string, unknown>>('package.json'), false, 'no second configuration in package.json');
	assert.doesNotMatch(readFileSync('styles.css', 'utf8'), /stylelint-(?:disable|enable)/, 'no disable directives in styles.css');
});

test('the browser target is the official rule with the Electron of minAppVersion, and nothing else changed', () => {
	const { minAppVersion } = readJson<{ minAppVersion: string }>('manifest.json');
	const electron = electronOf[minAppVersion];
	assert.ok(electron, `minAppVersion ${minAppVersion} is not in the official Electron table: choose its Electron version`);
	const [enabled, options] = ours().rules?.[TARGET_RULE] as [boolean, Record<string, unknown>];
	const [officialEnabled, officialOptions] = official.rules[TARGET_RULE] as [boolean, Record<string, unknown>];
	assert.equal(enabled, officialEnabled);
	assert.deepEqual(options.browsers, [`electron >= ${electron}`]);
	// Severity and ignored features exactly as the official default: the
	// override never widens what is ignored.
	assert.deepEqual({ ...options, browsers: undefined }, { ...officialOptions, browsers: undefined });
});
