// Vercel entry point. Telegram POSTs each update here. We reply 200 at once
// (so Telegram doesn't resend it) and keep drafting in the background with
// waitUntil, which lasts up to maxDuration in vercel.json.
import { waitUntil } from '@vercel/functions';
import { handleUpdate } from '../src/handlers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('Skinstinct drafter is running.');

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).send('Unauthorised');
  }

  const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  waitUntil(handleUpdate(update).catch((err) => console.error('[update]', err)));
  return res.status(200).json({ ok: true });
}
