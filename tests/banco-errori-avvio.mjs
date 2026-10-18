// Starts the real-app bench's own check (tests/banco-errori.mjs) in its own
// environment (tests/banco-errori-ambiente.mjs) and ends as it ended: its exit
// code, or the signal that stopped it. `npm run test:obsidian` runs it before
// the suite, which starts only if the check passed.
//
//   node tests/banco-errori-avvio.mjs
//
// Another check and another folder (`node … <check> <folder>`) only for the
// starter's own tests, with a harmless stand-in.
import { benchEnding, benchPaths, CHECK, runBench } from './banco-errori-ambiente.mjs';
import { finishLikeChild } from './registro-comando.mjs';

const [file = CHECK, dir] = process.argv.slice(2);
const outcome = await runBench({ file, paths: benchPaths(dir) });
if (outcome.error) console.error(`Controllo del banco errori non avviato: ${outcome.error.message}`);
finishLikeChild(benchEnding(outcome));
