// Vercel entry point. Telegram POSTs each update here. We reply 200 at once
// (so Telegram doesn't resend it) and keep drafting in the background with
// waitUntil, which lasts up to maxDuration in vercel.json.
import { waitUntil } from '@vercel/functions';
import { handleUpdate } from '../src/handlers.js';
import { storageName } from '../src/store.js';

export default async function handler(req, res) {
  // GET is a health check: which settings are present (never their values).
  if (req.method !== 'POST') {
    const has = (...keys) => keys.some((k) => Boolean(process.env[k]));
    return res.status(200).json({
      status: 'Skinstinct drafter is running.',
      storage: storageName,
      env: {
        TELEGRAM_BOT_TOKEN: has('TELEGRAM_BOT_TOKEN'),
        GEMINI_API_KEY: has('GEMINI_API_KEY'),
        TELEGRAM_WEBHOOK_SECRET: has('TELEGRAM_WEBHOOK_SECRET'),
        ALLOWED_CHAT_IDS: has('ALLOWED_CHAT_IDS'),
        database: storageName !== 'local file',
      },
    });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).send('Unauthorised');
  }

  const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  waitUntil(handleUpdate(update));
  return res.status(200).json({ ok: true });
}
