// Points Telegram at the Vercel deployment.
//   npm run webhook -- https://your-project.vercel.app
import { requireEnv } from './config.js';
import { tg } from './telegram.js';
import { BOT_COMMANDS } from './handlers.js';

requireEnv('TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET');

const base = (process.argv[2] || process.env.WEBHOOK_BASE_URL || '').replace(/\/+$/, '');
if (!base) {
  console.log('Usage: npm run webhook -- https://your-project.vercel.app');
  process.exit(1);
}

await tg('setWebhook', {
  url: `${base}/api/telegram`,
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
  allowed_updates: ['message', 'channel_post', 'callback_query'],
  drop_pending_updates: false,
});
await tg('setMyCommands', { commands: BOT_COMMANDS });
console.log('Webhook set:', await tg('getWebhookInfo'));
