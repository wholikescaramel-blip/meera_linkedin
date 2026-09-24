// Run one note through the pipeline in the terminal, without Telegram.
//   npm run try -- "note text here"
//   npm run try -- --file samples/strong_note.txt
import fs from 'node:fs';
import { requireEnv } from './config.js';
import { runPipeline } from './pipeline.js';

requireEnv('GEMINI_API_KEY');

const args = process.argv.slice(2);
const force = args.includes('--force');
const fileIdx = args.indexOf('--file');
const note = fileIdx > -1 ? fs.readFileSync(args[fileIdx + 1], 'utf8') : args.filter((a) => a !== '--force').join(' ');
if (!note.trim()) {
  console.log('Usage: npm run try -- "your note"   (or --file path.txt, add --force to skip triage)');
  process.exit(1);
}

const result = await runPipeline(note, { force, onStage: (s) => console.log(`… ${s}`) });
console.log('\nTRIAGE', JSON.stringify(result.triage, null, 2));
if (result.parked) process.exit(0);
console.log('');

console.log('\nANGLE', JSON.stringify(result.angle, null, 2));
console.log('\n' + '='.repeat(70) + '\n' + result.draft.text + '\n' + '='.repeat(70));
console.log('\nWORDS', result.draft.check.wordCount);
console.log('FLAGS', result.draft.flags);
console.log('STYLE', result.draft.check.ok ? 'passed' : result.draft.check.issues, result.draft.check.suggestions);
console.log('EDITOR CHANGES', result.draft.editorChanges);
process.exit(0);
