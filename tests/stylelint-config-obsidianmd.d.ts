// The package ships plain JavaScript: only what stylelint-config.test.ts reads.
declare module 'stylelint-config-obsidianmd' {
	const config: { rules: Record<string, unknown> };
	export default config;
}
