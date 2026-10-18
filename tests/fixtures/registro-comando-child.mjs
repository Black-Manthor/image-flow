// Harmless child process used by registro-comando.test.ts.
import { appendFileSync, writeFileSync } from 'node:fs';

const [mode, value] = process.argv.slice(2);
if (mode === 'output') {
	process.stdout.write('stdout diretto\n');
	process.stderr.write('stderr diretto\n');
} else if (mode === 'mark') {
	appendFileSync(value, 'eseguito\n');
} else if (mode === 'wait') {
	process.stdout.write('pronto\n');
	setInterval(() => {}, 1000);
} else if (mode === 'fail') {
	process.exitCode = Number(value);
} else if (mode === 'counts') {
	// `errors,warnings,exit`, or `-,-,exit` for a tool that writes no counts.
	// Ordinary output on both streams, like a tool's summary, either way.
	// A fourth value: that many described problems, as a tool writes them.
	const [errors, warnings, exit, described] = value.split(',');
	process.stdout.write('riepilogo ordinario\n');
	process.stderr.write('main.js  1.0kb\n');
	const items = described ? Array.from({ length: Number(described) }, (_, index) => ({ severity: 'warning', rule: 'finta', message: `problema ${index + 1}`, file: 'a.js', line: index + 1, column: 1 })) : undefined;
	if (errors !== '-' && process.env.IW_DIAGNOSTICHE) writeFileSync(process.env.IW_DIAGNOSTICHE, JSON.stringify({ tool: 'finto', errors: Number(errors), warnings: Number(warnings), ...(items ? { items } : {}) }));
	process.exitCode = Number(exit);
} else if (mode === 'counts-wait') {
	process.stdout.write('pronto\n');
	setInterval(() => {}, 1000);
} else if (mode === 'env') {
	process.stdout.write(`IW_DIAGNOSTICHE=${process.env.IW_DIAGNOSTICHE ?? ''}\n`);
}
