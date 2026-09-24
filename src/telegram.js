import { config } from './config.js';

const BASE = `https://api.telegram.org/bot${config.telegramToken}`;

export async function tg(method, body = {}) {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    throw Object.assign(new Error(`Telegram ${method}: ${json.description}`), { description: json.description });
  }
  return json.result;
}

export async function downloadFile(fileId) {
  const { file_path } = await tg('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${config.telegramToken}/${file_path}`);
  return Buffer.from(await res.arrayBuffer());
}

export const escapeHtml = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Telegram caps messages at 4096 characters; split on paragraph breaks.
export function chunk(text, limit = 4000) {
  const parts = [];
  let current = '';
  for (const para of text.split('\n\n')) {
    if ((current + '\n\n' + para).length > limit && current) { parts.push(current); current = para; }
    else current = current ? `${current}\n\n${para}` : para;
  }
  if (current) parts.push(current);
  return parts;
}
