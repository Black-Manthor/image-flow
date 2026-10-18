// The report of `npm run lint`: ESLint's own `stylish` output, unchanged, so
// the terminal shows what ESLint always shows. When tests/registro-comando.mjs
// runs it, it also writes how many errors and warnings ESLint found to the file
// IW_DIAGNOSTICHE names: ESLint exits 0 with warnings alone, and its report goes
// to stdout with nothing to tell problems from other text, so the counts come
// from its results, not from its output. With them, the first ITEMS problems
// (severity, rule, message, file, line, column), the others counted in
// `omitted`; a message longer than MESSAGE is cut, with its length kept.
import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import process from 'node:process';
import { ESLint } from 'eslint';

export const ITEMS = 100, MESSAGE = 500;

/** @param {import('eslint').ESLint.LintResult[]} results */
export default async function format(results, context) {
	const counts = { tool: 'eslint', errors: 0, warnings: 0, items: [], omitted: 0 };
	for (const result of results) {
		counts.errors += result.errorCount;
		counts.warnings += result.warningCount;
		for (const message of result.messages) {
			if (message.severity !== 1 && message.severity !== 2) continue;
			if (counts.items.length >= ITEMS) { counts.omitted++; continue; }
			const text = String(message.message ?? '');
			counts.items.push({ severity: message.severity === 2 ? 'error' : 'warning', rule: message.ruleId ?? null,
				message: text.slice(0, MESSAGE), ...(text.length > MESSAGE ? { messageLength: text.length } : {}),
				file: relative(context.cwd ?? process.cwd(), result.filePath).replaceAll('\\', '/'),
				...(message.line ? { line: message.line, column: message.column } : {}), ...(message.fatal ? { fatal: true } : {}) });
		}
	}
	if (process.env.IW_DIAGNOSTICHE) writeFileSync(process.env.IW_DIAGNOSTICHE, JSON.stringify(counts));
	const stylish = await new ESLint({ cwd: context.cwd }).loadFormatter('stylish');
	return stylish.format(results, context);
}
