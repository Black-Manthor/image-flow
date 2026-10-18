// Each invocation receives a disposable registry before importing the writer.
import { chromium } from '@playwright/test';
import { currentRun, record, registry } from '../registro.mjs';
import { assertRunConsoleIsolation } from '../registro-isolamento.mjs';
import { watchPage } from '../pagina-segnalazioni.mjs';

const action = process.argv[2];
const identity = currentRun('fixture-isolamento');
try {
	if (action === 'foreign') {
		record({ kind: 'console', level: 'warning', text: 'prova: evento di una esecuzione estranea' });
	} else {
		if (action === 'leak') {
			const browser = await chromium.launch({ headless: true });
			try {
				const page = await browser.newPage();
				// Deliberately use the actual default registry sink instead of memory.
				const watch = await watchPage(page, { label: 'isolamento' });
				try {
					await page.evaluate(() => console.error('evento corrente senza prefisso convenzionale'));
					for (let i = 0; i < 100 && !watch.observations.length; i++) await page.waitForTimeout(10);
					if (!watch.observations.length) throw new Error('Evento di prova non osservato');
				} finally { await watch.stop(); }
			} finally { await browser.close(); }
		} else if (action === 'missing') {
			record({ kind: 'console', run: undefined, level: 'error', text: 'identità mancante' });
		} else if (action === 'ambiguous') {
			record({ kind: 'run', suite: 'suite-contraddittoria' });
		} else if (action !== 'clean') throw new Error('Azione di prova sconosciuta');
		await assertRunConsoleIsolation(registry, identity);
	}
	record({ kind: 'end', superato: 1, fallito: 0 });
} catch (error) {
	record({ kind: 'end', superato: 0, fallito: 1 });
	throw error;
}
