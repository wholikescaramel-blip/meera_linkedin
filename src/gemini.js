import { AsyncLocalStorage } from 'node:async_hooks';
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

const ai = new GoogleGenAI({ apiKey: config.geminiKey, httpOptions: { timeout: 120_000 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A time budget for one note. Vercel stops a function after maxDuration, so we
// give up cleanly before that and let Meera press Try again.
const budget = new AsyncLocalStorage();
export const withDeadline = (ms, fn) => budget.run({ deadline: Date.now() + ms }, fn);
function checkDeadline(needMs = 0) {
  const store = budget.getStore();
  if (store && Date.now() + needMs > store.deadline) {
    throw new Error('Gemini is too busy right now, so this ran out of time. Press Try again in a minute.');
  }
}

function retryDelayMs(err) {
  const match = String(err.message).match(/"retryDelay":"(\d+(?:\.\d+)?)s"/);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

/**
 * One Gemini call with model fallback.
 * - 503/500 (overloaded): retry once, then move to the next model.
 * - 429 (quota): wait if it's a short per-minute limit, otherwise next model.
 * - 404 (model unavailable), network error or timeout: next model.
 * - json: true parses the response; a malformed reply is retried once.
 */
export async function generate({ models, system, contents, schema, temperature = 0.7 }) {
  let lastErr;
  // Free-tier Flash models are often briefly overloaded; if every model fails,
  // wait and go round the list again.
  for (const [round, pause] of [0, 10_000, 30_000].entries()) {
    if (pause) {
      checkDeadline(pause + 20_000);
      console.warn(`[gemini] all models busy, retrying in ${pause / 1000}s (round ${round + 1})`);
      await sleep(pause);
    }
    const result = await tryModels({ models, system, contents, schema, temperature });
    if (result.ok) return result.value;
    lastErr = result.err;
    if (!result.transient) break;
  }
  throw lastErr;
}

async function tryModels({ models, system, contents, schema, temperature }) {
  let lastErr;
  let transient = true;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      checkDeadline();
      try {
        const res = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: system,
            temperature,
            ...(schema && { responseMimeType: 'application/json', responseSchema: schema }),
          },
        });
        const text = res.text?.trim();
        if (!text) throw Object.assign(new Error('Empty response from Gemini'), { retryable: true });
        return { ok: true, value: schema ? JSON.parse(text) : text };
      } catch (err) {
        lastErr = err;
        const status = err.status;
        if (err instanceof SyntaxError || err.retryable) continue;
        if (status === 503 || status === 500) { await sleep(3000); continue; }
        if (status === 429) {
          const wait = retryDelayMs(err);
          const daily = /PerDay/.test(String(err.message));
          if (wait && wait <= 35000 && !daily && attempt === 0) { await sleep(wait); continue; }
          break;
        }
        if (status === 404 || !status) break; // no status = network error/timeout
        return { ok: false, err, transient: false };
      }
    }
    console.warn(`[gemini] ${model} unavailable (${lastErr?.status ?? lastErr?.message})`);
  }
  return { ok: false, err: lastErr, transient };
}

export async function transcribeAudio(buffer, mimeType) {
  return generate({
    models: config.fastModels,
    temperature: 0,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: buffer.toString('base64') } },
          { text: 'Transcribe this voice note verbatim. If it mixes Hindi and English, transcribe as spoken in Latin script. Output only the transcript.' },
        ],
      },
    ],
  });
}
