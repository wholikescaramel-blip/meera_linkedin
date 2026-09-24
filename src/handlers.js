// Handles one Telegram update. Shared by the Vercel webhook (api/telegram.js)
// and the local polling loop (src/bot.js).
import { config } from './config.js';
import { tg, downloadFile } from './telegram.js';
import { transcribeAudio } from './gemini.js';
import { getOwner, setOwner, getAwaiting, setAwaiting, recentDrafts } from './store.js';
import { processNote, redraft, handleCallback } from './review.js';

const HELP = `Send me a note, the way you already do. A sentence, a paragraph, a forwarded message or a voice note all work.

For each note I:
1. Decide whether there's enough in it for a post. If there isn't, I say what's missing.
2. Look for a real, recent news item it connects to (only if one genuinely fits).
3. Draft a LinkedIn post in your voice, marking anything you need to check with [VERIFY] or add with [MEERA].

Then you choose: Open in LinkedIn (the draft goes into the post box; you edit and post), Redraft (tell me what to change), or Skip.

/status: what's been drafted this week
/cancel: stop a redraft request`;

async function authorised(chatId) {
  const id = String(chatId);
  if (config.allowedChatIds.length) return config.allowedChatIds.includes(id);
  const owner = await getOwner();
  if (!owner) {
    await setOwner(id);
    console.log(`[auth] chat ${id} is now the bot's owner. Other chats will be ignored.`);
    return true;
  }
  return String(owner) === id;
}

export async function handleUpdate(update) {
  if (update.callback_query) {
    const cb = update.callback_query;
    if (!(await authorised(cb.message.chat.id))) return tg('answerCallbackQuery', { callback_query_id: cb.id });
    return handleCallback(cb);
  }
  const msg = update.message || update.channel_post;
  if (msg) return handleMessage(msg);
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  if (!(await authorised(chatId))) {
    if (msg.chat.type === 'private') await tg('sendMessage', { chat_id: chatId, text: 'This bot is private.' });
    return;
  }

  const text = (msg.text ?? msg.caption ?? '').trim();
  const command = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : null;

  if (command === '/start' || command === '/help') return tg('sendMessage', { chat_id: chatId, text: HELP });
  if (command === '/cancel') {
    await setAwaiting(chatId, null);
    return tg('sendMessage', { chat_id: chatId, text: 'Cancelled.' });
  }
  if (command === '/status') return sendStatus(chatId);
  if (command) return tg('sendMessage', { chat_id: chatId, text: 'Unknown command. /help shows what I do.' });

  const audio = msg.voice || msg.audio || msg.video_note;
  if (audio && !text) {
    try {
      const buffer = await downloadFile(audio.file_id);
      const transcript = await transcribeAudio(buffer, audio.mime_type || 'audio/ogg');
      await tg('sendMessage', { chat_id: chatId, text: `Transcript:\n\n${transcript}` });
      return routeText(chatId, transcript);
    } catch (err) {
      console.error('[voice]', err);
      return tg('sendMessage', { chat_id: chatId, text: `Couldn't transcribe that voice note: ${err.message.slice(0, 200)}` });
    }
  }

  if (text) return routeText(chatId, text);
}

// A message is either feedback on a draft (after Redraft) or a new note.
async function routeText(chatId, text) {
  const pending = await getAwaiting(chatId);
  if (pending) {
    await setAwaiting(chatId, null);
    return redraft(chatId, String(pending), text);
  }
  return processNote(chatId, text);
}

async function sendStatus(chatId) {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const recent = (await recentDrafts()).filter((d) => new Date(d.createdAt).getTime() > weekAgo);
  const by = (s) => recent.filter((d) => d.status === s).length;
  await tg('sendMessage', {
    chat_id: chatId,
    text: `Last 7 days: ${recent.length} notes. ${by('drafted')} drafted, ${by('parked')} parked as too thin, ${by('skipped')} skipped.`,
  });
}

export const BOT_COMMANDS = [
  { command: 'help', description: 'How this works' },
  { command: 'status', description: "This week's notes and drafts" },
  { command: 'cancel', description: 'Stop a redraft request' },
];
