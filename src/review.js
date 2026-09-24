// Everything Meera sees in Telegram: progress updates, the draft, the review
// card with its buttons, and the Redraft / Skip / Draft anyway flows.
import { tg, escapeHtml as h, chunk } from './telegram.js';
import { runPipeline, writeDraft } from './pipeline.js';
import { getDraft, saveDraft, newDraft, setAwaiting } from './store.js';
import { withDeadline } from './gemini.js';

// On Vercel, stop before the 300s function limit; locally there's no limit.
const JOB_MS = Number(process.env.JOB_SECONDS || (process.env.VERCEL ? 270 : 0)) * 1000 || Infinity;

const LINKEDIN_COMPOSE = 'https://www.linkedin.com/feed/?shareActive=true';
const linkedInUrl = (text) => `${LINKEDIN_COMPOSE}&text=${encodeURIComponent(text)}`;

// A single status message that gets edited as the pipeline moves along.
async function statusMessage(chatId, text) {
  const msg = await tg('sendMessage', { chat_id: chatId, text });
  let last = text;
  return {
    update: async (next) => {
      if (next === last) return;
      last = next;
      await tg('editMessageText', { chat_id: chatId, message_id: msg.message_id, text: next }).catch(() => {});
    },
    fail: async (err, draftId) => {
      await tg('editMessageText', {
        chat_id: chatId,
        message_id: msg.message_id,
        text: `Something went wrong on note #${draftId}: ${err.message.slice(0, 300)}\n\nThe note is saved.`,
        reply_markup: { inline_keyboard: [[{ text: 'Try again', callback_data: `retry:${draftId}` }]] },
      }).catch(() => {});
    },
    remove: () => tg('deleteMessage', { chat_id: chatId, message_id: msg.message_id }).catch(() => {}),
  };
}

export async function processNote(chatId, note, { force = false, draftId } = {}) {
  const record = draftId ? await getDraft(draftId) : await newDraft(chatId, note);
  const status = await statusMessage(chatId, `Note #${record.id} received. Reading it…`);
  try {
    const result = await withDeadline(JOB_MS, () => runPipeline(note, { force, onStage: status.update }));
    Object.assign(record, { triage: result.triage, force });

    if (result.parked) {
      await saveDraft(Object.assign(record, { status: 'parked' }));
      await status.remove();
      return sendParkedCard(chatId, record);
    }

    record.versions.push({ text: result.draft.text, check: result.draft.check, flags: result.draft.flags, at: new Date().toISOString() });
    await saveDraft(Object.assign(record, { status: 'drafted', angle: result.angle }));
    await status.remove();
    await sendDraft(chatId, record);
  } catch (err) {
    console.error(`[note ${record.id}]`, err);
    await saveDraft(Object.assign(record, { status: 'error', error: err.message }));
    await status.fail(err, record.id);
  }
}

export async function redraft(chatId, draftId, feedback) {
  const record = await getDraft(draftId);
  const previous = record.versions.at(-1)?.text;
  const status = await statusMessage(chatId, `Redrafting #${draftId} with your notes…`);
  try {
    const draft = await withDeadline(JOB_MS, () => writeDraft({
      note: record.note,
      triage: record.triage,
      angle: record.angle,
      previous,
      feedback: /^(again|retry|fresh)$/i.test(feedback.trim()) ? 'Try a different take on the same note.' : feedback,
    }));
    record.versions.push({ text: draft.text, check: draft.check, flags: draft.flags, feedback, at: new Date().toISOString() });
    await saveDraft(Object.assign(record, { status: 'drafted' }));
    await status.remove();
    await sendDraft(chatId, record);
  } catch (err) {
    console.error(`[redraft ${draftId}]`, err);
    await status.fail(err, draftId);
  }
}

async function sendParkedCard(chatId, record) {
  const t = record.triage;
  const missing = t.missing?.length ? `\n\n<b>What would make it work:</b>\n${t.missing.map((m) => `• ${h(m)}`).join('\n')}` : '';
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `<b>Note #${record.id}: not enough here for a post yet</b> (${t.score}/5, ${h(t.pillar)})\n\n${h(t.reason)}${missing}\n\nThe note is saved. Add detail in a new message, or draft it anyway.`,
    reply_markup: {
      inline_keyboard: [[
        { text: 'Draft anyway', callback_data: `force:${record.id}` },
        { text: 'Skip', callback_data: `skip:${record.id}` },
      ]],
    },
  });
}

export async function sendDraft(chatId, record) {
  const version = record.versions.at(-1);
  const { text, check, flags } = version;

  // 1. The draft itself, as plain text so it copies cleanly.
  let firstId;
  for (const part of chunk(text)) {
    const m = await tg('sendMessage', { chat_id: chatId, text: part });
    firstId ??= m.message_id;
  }

  // 2. The review card with sources, flags and buttons.
  const a = record.angle;
  const meta = (x) => [x.source, x.dateLabel].filter(Boolean).map(h).join(', ');
  let angleLine;
  if (!a?.used) {
    angleLine = `<i>None added.</i> ${h(a?.reason ?? '')}`;
  } else {
    angleLine = `${a.fromNote ? '<i>From your note:</i> ' : ''}<a href="${h(a.link)}">${h(a.title)}</a> (${meta(a)})\n`;
    angleLine += a.facts?.length
      ? `<i>Read the article. Facts used:</i>\n${a.facts.map((f) => `• ${h(f)}`).join('\n')}`
      : `<i>Couldn't read the article (paywall or blocked), so only the headline was used. Open it and check.</i>`;
  }
  const related = a?.related?.length
    ? `\n\n<b>Other sources you could use:</b>\n${a.related.map((r) => `• <a href="${h(r.link)}">${h(r.title)}</a> (${meta(r)})`).join('\n')}`
    : '';
  const flagLines = flags.length
    ? flags.slice(0, 10).map((f) => `• <b>${f.kind}</b>: ${h(f.detail)}`).join('\n') + (flags.length > 10 ? `\n• …and ${flags.length - 10} more` : '')
    : 'None.';
  const styleLine = check.ok && !check.suggestions?.length
    ? 'Passed all voice-guide checks.'
    : [...check.issues.map((i) => `• ${h(i)}`), ...(check.suggestions ?? []).map((s) => `• Consider: ${h(s)}`)].join('\n');

  const card =
    `<b>Draft #${record.id}</b> · v${record.versions.length} · ${check.wordCount} words · ${h(record.triage.pillar)}\n\n` +
    `<b>Core claim:</b> ${h(record.triage.core_claim)}\n\n` +
    `<b>Current angle:</b> ${angleLine}${related}\n\n` +
    `<b>Needs your check (${flags.length}):</b>\n${flagLines}\n\n` +
    `<b>Style check:</b>\n${styleLine}\n\n` +
    `<i>Open in LinkedIn puts this draft in the post box. Resolve the flags, then post it yourself.</i>`;

  const buttons = (url, label) => ({
    inline_keyboard: [
      [{ text: label, url }],
      [
        { text: 'Redraft', callback_data: `redraft:${record.id}` },
        { text: 'Skip', callback_data: `skip:${record.id}` },
      ],
    ],
  });

  // Telegram's 4096-character limit: drop the extra sources first if needed.
  const text4096 = card.length > 4000 ? card.replace(related, '') : card;
  const base = { chat_id: chatId, parse_mode: 'HTML', text: text4096, link_preview_options: { is_disabled: true }, reply_parameters: { message_id: firstId } };
  try {
    await tg('sendMessage', { ...base, reply_markup: buttons(linkedInUrl(text), 'Open in LinkedIn') });
  } catch (err) {
    // Very long drafts can exceed Telegram's button URL limit. Fall back to an
    // empty post box; Meera copies the draft from the message above.
    console.warn(`[draft ${record.id}] prefilled LinkedIn link rejected (${err.description}); using plain link`);
    await tg('sendMessage', { ...base, reply_markup: buttons(LINKEDIN_COMPOSE, 'Open LinkedIn (paste the draft)') });
  }
}

export async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const [action, id] = cb.data.split(':');
  const record = await getDraft(id);
  if (!record) return tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'That draft no longer exists.' });

  const stripButtons = (suffix) =>
    tg('editMessageReplyMarkup', { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } })
      .then(() => suffix && tg('sendMessage', { chat_id: chatId, text: suffix, reply_parameters: { message_id: cb.message.message_id } }))
      .catch(() => {});

  if (action === 'skip') {
    await saveDraft(Object.assign(record, { status: 'skipped' }));
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: `Skipped #${id}.` });
    return stripButtons(`#${id} skipped.`);
  }

  if (action === 'redraft') {
    await setAwaiting(chatId, id);
    await tg('answerCallbackQuery', { callback_query_id: cb.id });
    return tg('sendMessage', {
      chat_id: chatId,
      text: `What should change in #${id}? Send your notes (e.g. "less technical, drop the pH part, open with the trade fair"), or send "again" for a fresh take. /cancel to stop.`,
      ...(cb.message.chat.type === 'private' && { reply_markup: { force_reply: true, input_field_placeholder: 'What should change?' } }),
    });
  }

  if (action === 'force' || action === 'retry') {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: action === 'force' ? 'Drafting anyway…' : 'Trying again…' });
    await stripButtons();
    return processNote(chatId, record.note, { force: action === 'force' || record.force, draftId: id });
  }
}
