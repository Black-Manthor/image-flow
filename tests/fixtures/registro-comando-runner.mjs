// Gives the command runner harmless phases for its process-level tests.
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { finishLikeChild, runRegisteredCommand } from '../registro-comando.mjs';

const child = fileURLToPath(new URL('./registro-comando-child.mjs', import.meta.url));
const [mode, value] = process.argv.slice(2);
let steps;
if (mode === 'build-fail') steps = [
	{ phase: 'type-check', executable: process.execPath, args: [child, 'fail', value] },
	{ phase: 'bundle', executable: process.execPath, args: [child, 'mark', process.env.IW_FIXTURE_MARKER] },
];
else if (mode === 'wait') steps = [{ phase: 'wait', executable: process.execPath, args: [child, 'wait'] }];
else if (mode === 'mark') steps = [{ phase: 'mark', executable: process.execPath, args: [child, 'mark', value] }];
else if (mode === 'report') steps = [{ phase: 'fixture', executable: process.execPath, args: [child, 'output'], reportOnStderr: true }];
else if (mode === 'report-silent') steps = [{ phase: 'fixture', executable: process.execPath, args: [child, 'fail', '0'], reportOnStderr: true }];
else if (mode === 'fail') steps = [{ phase: 'fixture', executable: process.execPath, args: [child, 'fail', value] }];
else if (mode === 'counts') steps = [{ phase: 'fixture', executable: process.execPath, args: [child, 'counts', value], structured: true }];
else if (mode === 'counts-wait') steps = [{ phase: 'fixture', executable: process.execPath, args: [child, 'counts-wait'], structured: true }];
else if (mode === 'env') steps = [{ phase: 'fixture', executable: process.execPath, args: [child, 'env'] }];
// The real ESLint with the project's formatter, on `value` (a folder with its files).
else if (mode === 'eslint') steps = [{ phase: 'lint', cwd: value, executable: process.execPath, structured: true,
	args: [fileURLToPath(new URL('../../node_modules/eslint/bin/eslint.js', import.meta.url)), '--no-config-lookup', '--rule', '{"no-unused-vars":"warn","no-var":"error"}', '.',
		'--format', fileURLToPath(new URL('../eslint-formato.mjs', import.meta.url))] }];
// The project's esbuild.config.mjs, run in `value` (a copy with its own src/ and node_modules link).
else if (mode === 'esbuild') steps = [{ phase: 'bundle', cwd: value, executable: process.execPath, structured: true, args: ['esbuild.config.mjs', 'production'] }];
else steps = [{ phase: 'fixture', executable: process.execPath, args: [child, 'output'] }];
// IW_FIXTURE_COMMAND records the fixture under a real command name, for the summary's tests.
finishLikeChild(await runRegisteredCommand(process.env.IW_FIXTURE_COMMAND ?? 'fixture', steps));
