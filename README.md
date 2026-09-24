# Skinstinct Drafter

Meera drops a note into Telegram. The bot decides whether the note is worth a post, finds a real recent news angle if one fits, drafts a LinkedIn post in her voice, and sends it back for her to review. She presses **Open in LinkedIn**, which puts the draft in LinkedIn's post box. She edits it and publishes it herself. Nothing is ever posted automatically.

## Run it

```
npm install
npm start
```

Then message the bot on Telegram. The first chat that messages it becomes its owner, and every other chat is ignored. Keys live in `.env` (`TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`). Keep that file private.

Other commands:

| Command | What it does |
|---|---|
| `npm run try -- "note text"` | Runs one note through the pipeline in the terminal, without Telegram. Add `--force` to skip triage, or `--file path.txt` to read the note from a file |
| `npm run backlog` | Triages every note in `notes/` and writes a ranked `data/backlog_report.md` |
| `npm run backlog -- --send 3` | Also drafts the best 3 and sends them to Telegram |

## Deploy on Vercel (always on)

On Vercel, Telegram calls `api/telegram.js` for each message (a webhook), so nothing has to stay running on a laptop.

1. Push this repo to GitHub, then on vercel.com choose **Add New → Project** and import it.
2. Storage is Supabase: a table `skinstinct_kv` and a sequence, locked with row-level security so only the secret key can reach them. Upstash Redis also works if its env vars are set.
3. Under **Settings → Environment Variables**, add `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `ALLOWED_CHAT_IDS`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, using the same values as in `.env`. Then redeploy.
4. Point Telegram at the deployment: `npm run webhook -- https://<your-project>.vercel.app`

Running `npm start` locally removes the webhook while it runs. Run step 4 again afterwards.

## Components map

| Stage | What happens | Where |
|---|---|---|
| **Trigger** | Meera sends a text or voice note to the bot, or posts in a channel where the bot is admin | `src/bot.js` |
| **Input** | Note text. Voice notes are transcribed by Gemini first | `src/bot.js`, `src/gemini.js` |
| **Context** | Voice guide plus her 15 published pieces | `context/` |
| **Processing** | 1. **Triage**: is there enough substance? If not, the bot says what's missing instead of padding the note.<br>2. **Source**: a link in the note is read directly. Otherwise the bot searches Google News RSS (last 120 days, starting with any source the note names), Gemini picks one relevant article or none, and the bot decodes the Google link, reads the real article and extracts up to 3 facts. Up to 3 other relevant articles are listed for Meera | `src/pipeline.js`, `src/news.js` |
| **AI** | 3. **Draft**: in her structure, with `[VERIFY: …]` and `[MEERA: …]` flags.<br>4. **Editor pass**: removes invented anecdotes and flags unsourced figures.<br>5. **Style checks**: code-based checks against section 10 of the guide (length, emojis, hashtags, British spelling, banned words, question opener, one-line paragraphs), plus one targeted fix pass | `src/prompts.js`, `src/lint.js` |
| **Output** | Draft in Telegram, plus a review card with the news source, flags and style results. Buttons: **Open in LinkedIn** / **Redraft** (with her feedback) / **Skip** | `src/review.js` |

## Design decisions

- **No automatic posting.** LinkedIn's API can't save drafts; it can only publish. Meera turned down two end-to-end tools, so the bot stops at a prefilled post box and she presses Post.
- **News comes from Google News RSS, not Gemini search.** Search grounding has no quota on a free-tier key. RSS also means every cited article is a real link. The bot reads the article itself; if it's paywalled, the draft uses only the headline and says so.
- **No brand names from the news.** Meera never names or shames companies, so the draft describes them generically.
- **A thin note gets an honest "not enough here".** A padded draft costs her more time than no draft. **Draft anyway** overrides the verdict.
- **Flash models.** Pro models have no free-tier quota. The bot tries the models in `DRAFT_MODELS` in order and falls back if one is overloaded.

## Files

```
context/voice_guide.txt   Meera's voice guide
context/published.txt     her 4 LinkedIn posts and 11 newsletters
notes/                    backlog notes for npm run backlog
samples/                  made-up test notes
data/                     bot state and reports (created on first run)
```
