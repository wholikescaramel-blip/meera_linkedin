// Backlog mode: triage every note in notes/, write a ranked report, and
// optionally send the top N as full drafts to Meera's Telegram.
//
//   npm run backlog              -> triage only, writes data/backlog_report.md
//   npm run backlog -- --send 3  -> also drafts the best 3 and sends them
import fs from 'node:fs';
import path from 'node:path';
import { config, requireEnv } from './config.js';
import { triage } from './pipeline.js';
import { getOwner } from './store.js';
import { processNote } from './review.js';

requireEnv('GEMINI_API_KEY');

const sendIndex = process.argv.indexOf('--send');
const sendCount = sendIndex > -1 ? Number(process.argv[sendIndex + 1] || 3) : 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One note per file, or several in one file separated by a line of ---.
function loadNotes() {
  if (!fs.existsSync(config.paths.notes)) return [];
  return fs.readdirSync(config.paths.notes)
    .filter((f) => /\.(txt|md)$/i.test(f) && !/^readme/i.test(f))
    .flatMap((file) =>
      fs.readFileSync(path.join(config.paths.notes, file), 'utf8')
        .split(/^\s*-{3,}\s*$/m)
        .map((n) => n.trim())
        .filter(Boolean)
        .map((text, i, all) => ({ source: all.length > 1 ? `${file} #${i + 1}` : file, text })),
    );
}

const notes = loadNotes();
if (!notes.length) {
  console.log('No notes found in notes/. Add .txt files there: one note per file, or several per file separated by a line containing ---');
  process.exit(0);
}

console.log(`Triaging ${notes.length} notes…`);
const results = [];
for (const [i, note] of notes.entries()) {
  try {
    const t = await triage(note.text);
    results.push({ ...note, triage: t });
    console.log(`${i + 1}/${notes.length}  ${t.worth_developing ? 'DRAFT' : 'park '}  ${t.score}/5  ${note.source}`);
  } catch (err) {
    console.log(`${i + 1}/${notes.length}  ERROR  ${note.source}: ${err.message.slice(0, 120)}`);
  }
  await sleep(4000); // stay under free-tier requests per minute
}

results.sort((a, b) => Number(b.triage.worth_developing) - Number(a.triage.worth_developing) || b.triage.score - a.triage.score);

const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n+/g, ' ');
const report = [
  `# Backlog triage (${new Date().toLocaleString('en-GB')})`,
  '',
  `${results.filter((r) => r.triage.worth_developing).length} of ${results.length} notes are worth developing.`,
  '',
  '| Rank | Score | Draft? | Pillar | Core claim | What\'s missing | Note |',
  '|---|---|---|---|---|---|---|',
  ...results.map((r, i) =>
    `| ${i + 1} | ${r.triage.score}/5 | ${r.triage.worth_developing ? 'Yes' : 'No'} | ${cell(r.triage.pillar)} | ${cell(r.triage.core_claim)} | ${cell(r.triage.missing.join('; '))} | ${cell(r.source)}: ${cell(r.text.slice(0, 140))}${r.text.length > 140 ? '…' : ''} |`),
].join('\n');

fs.mkdirSync(path.dirname(config.paths.backlogReport), { recursive: true });
fs.writeFileSync(config.paths.backlogReport, report);
console.log(`\nReport written to data/backlog_report.md`);

if (sendCount) {
  requireEnv('TELEGRAM_BOT_TOKEN');
  const chatId = config.allowedChatIds[0] || (await getOwner());
  if (!chatId) {
    console.log('No Telegram chat to send to yet. Message the bot once (npm start), then run this again.');
    process.exit(0);
  }
  const top = results.filter((r) => r.triage.worth_developing).slice(0, sendCount);
  for (const r of top) {
    console.log(`Drafting and sending: ${r.source}`);
    await processNote(chatId, r.text);
  }
}
