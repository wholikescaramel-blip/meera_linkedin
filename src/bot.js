// Local mode: long-polls Telegram from your own machine (npm start).
// In production the bot runs on Vercel via api/telegram.js instead; the two
// can't run at once, so this removes the webhook while it's running.
import { config, requireEnv } from './config.js';
import { tg } from './telegram.js';
import { getOffset, setOffset, storageName } from './store.js';
import { handleUpdate, BOT_COMMANDS } from './handlers.js';

requireEnv('TELEGRAM_BOT_TOKEN', 'GEMINI_API_KEY');

async function main() {
  const hook = await tg('getWebhookInfo');
  if (hook.url) console.log(`[warn] Removing the Vercel webhook (${hook.url}) while running locally. Run "npm run webhook" afterwards to restore it.`);
  await tg('deleteWebhook');
  await tg('setMyCommands', { commands: BOT_COMMANDS });

  const me = await tg('getMe');
  console.log(`@${me.username} is running locally (storage: ${storageName}, drafting with ${config.draftModels[0]}). Ctrl+C to stop.`);

  let offset = await getOffset();
  while (true) {
    try {
      const updates = await tg('getUpdates', {
        offset,
        timeout: 50,
        allowed_updates: ['message', 'channel_post', 'callback_query'],
      });
      for (const update of updates) {
        offset = update.update_id + 1;
        await setOffset(offset);
        handleUpdate(update).catch((err) => console.error('[update]', err));
      }
    } catch (err) {
      console.error('[poll]', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main();
