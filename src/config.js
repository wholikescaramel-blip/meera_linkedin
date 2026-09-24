import { fileURLToPath } from 'node:url';
import path from 'node:path';

const list = (value, fallback) =>
  (value ?? fallback).split(',').map((s) => s.trim()).filter(Boolean);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  geminiKey: process.env.GEMINI_API_KEY,

  // Tried in order; if one is overloaded or out of quota, the next is used.
  // Pro models have no free-tier quota, so these default to Flash models.
  draftModels: list(process.env.DRAFT_MODELS, 'gemini-3.6-flash,gemini-3.5-flash,gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash-lite'),
  fastModels: list(process.env.FAST_MODELS, 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.5-flash'),

  // Telegram chat IDs allowed to use the bot. If empty, the first chat to
  // message the bot becomes its owner and everyone else is ignored.
  allowedChatIds: list(process.env.ALLOWED_CHAT_IDS, ''),

  // How far back to look for a news angle.
  newsDays: Number(process.env.NEWS_DAYS || 120),

  paths: {
    voiceGuide: path.join(ROOT, 'context', 'voice_guide.txt'),
    published: path.join(ROOT, 'context', 'published.txt'),
    state: path.join(ROOT, 'data', 'state.json'),
    notes: path.join(ROOT, 'notes'),
    backlogReport: path.join(ROOT, 'data', 'backlog_report.md'),
  },
};

export function requireEnv(...keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')} in .env`);
    process.exit(1);
  }
}
