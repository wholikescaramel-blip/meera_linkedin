// Drafts and bot state. Uses Upstash Redis when its env vars are set (Vercel),
// otherwise a local JSON file (npm start on a laptop). Each draft is its own
// key, so a Skip pressed while another draft is being written can't be lost.
import fs from 'node:fs';
import path from 'node:path';
import { Redis } from '@upstash/redis';
import { config } from './config.js';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

// ---------------------------------------------------------------- backends

const fileBackend = {
  read() {
    try { return JSON.parse(fs.readFileSync(config.paths.state, 'utf8')); }
    catch { return { offset: 0, ownerChatId: null, nextId: 1, drafts: {}, awaitingFeedback: {} }; }
  },
  write(s) {
    fs.mkdirSync(path.dirname(config.paths.state), { recursive: true });
    fs.writeFileSync(config.paths.state, JSON.stringify(s, null, 2));
  },
  async get(key) {
    const s = this.read();
    const [kind, id] = key.split(':');
    if (kind === 'draft') return s.drafts[id] ?? null;
    if (kind === 'awaiting') return s.awaitingFeedback[id] ?? null;
    return s[kind] ?? null;
  },
  async set(key, value) {
    const s = this.read();
    const [kind, id] = key.split(':');
    if (kind === 'draft') s.drafts[id] = value;
    else if (kind === 'awaiting') value == null ? delete s.awaitingFeedback[id] : (s.awaitingFeedback[id] = value);
    else s[kind] = value;
    this.write(s);
  },
  async nextId() {
    const s = this.read();
    const id = s.nextId++;
    this.write(s);
    return String(id);
  },
  async recentDrafts() {
    return Object.values(this.read().drafts);
  },
};

const redisBackend = {
  get: (key) => redis.get(key),
  set: (key, value) => (value == null ? redis.del(key) : redis.set(key, value)),
  nextId: async () => String(await redis.incr('nextId')),
  async recentDrafts() {
    const ids = await redis.lrange('draftIds', 0, 99);
    if (!ids.length) return [];
    return (await redis.mget(...ids.map((id) => `draft:${id}`))).filter(Boolean);
  },
};

const db = redis ? redisBackend : fileBackend;
export const storageName = redis ? 'Upstash Redis' : 'local file';

// ---------------------------------------------------------------- API

export const getDraft = (id) => db.get(`draft:${id}`);

export async function saveDraft(draft) {
  draft.updatedAt = new Date().toISOString();
  await db.set(`draft:${draft.id}`, draft);
  return draft;
}

export async function newDraft(chatId, note) {
  const id = await db.nextId();
  const draft = { id, chatId, note, status: 'new', versions: [], createdAt: new Date().toISOString() };
  await db.set(`draft:${id}`, draft);
  if (redis) await redis.lpush('draftIds', id);
  return draft;
}

export const recentDrafts = () => db.recentDrafts();

export const getAwaiting = (chatId) => db.get(`awaiting:${chatId}`);
export const setAwaiting = (chatId, draftId) => db.set(`awaiting:${chatId}`, draftId);

export const getOwner = () => db.get('ownerChatId');
export const setOwner = (chatId) => db.set('ownerChatId', chatId);

// Only used by the local polling loop.
export const getOffset = async () => (await db.get('offset')) || 0;
export const setOffset = (offset) => db.set('offset', offset);
