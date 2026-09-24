import { config } from './config.js';
import { generate } from './gemini.js';
import { searchNews, formatDate, resolveGoogleNewsUrl, fetchArticleText, hostname } from './news.js';
import { lint, extractFlags } from './lint.js';
import * as P from './prompts.js';

// Step 1: is this note worth a post?
export async function triage(note) {
  return generate({
    models: config.fastModels,
    system: P.TRIAGE_SYSTEM,
    contents: P.triagePrompt(note),
    schema: P.TRIAGE_SCHEMA,
    temperature: 0.2,
  });
}

// Step 2: find a source to anchor the post. A link in the note wins; otherwise
// search Google News (starting with any source the note names), pick the best
// fit or none, then read the actual article so the draft can use real facts.
export async function findAngle(note, t) {
  const noteUrl = note.match(/https?:\/\/[^\s)>\]]+/)?.[0];
  if (noteUrl) {
    const url = await resolveGoogleNewsUrl(noteUrl);
    const read = await readFacts(t, url);
    return {
      used: true,
      fromNote: true,
      title: read.title || url,
      source: hostname(url),
      link: url,
      dateLabel: '',
      angle: read.angle || 'Source from your note.',
      facts: read.facts,
      related: [],
    };
  }

  const queries = [t.cited_source, ...t.news_queries].filter(Boolean).slice(0, 4);
  const seen = new Set();
  const items = [];
  for (const query of queries) {
    try {
      for (const it of await searchNews(query, { days: config.newsDays })) {
        if (!seen.has(it.title)) { seen.add(it.title); items.push(it); }
      }
    } catch (err) {
      console.warn(`[news] "${query}" failed: ${err.message}`);
    }
  }
  if (!items.length) return { used: false, reason: 'No recent news found for this topic.', related: [] };

  const candidates = items.slice(0, 15);
  const pick = await generate({
    models: config.fastModels,
    system: P.ANGLE_SYSTEM,
    contents: P.anglePrompt(t, candidates),
    schema: P.ANGLE_SCHEMA,
    temperature: 0.2,
  });

  // Real publisher links for the extra sources, so Meera doesn't get Google redirects.
  const related = await Promise.all(
    (pick.related || [])
      .filter((i) => i !== pick.index && candidates[i - 1])
      .slice(0, 3)
      .map(async (i) => {
        const it = candidates[i - 1];
        return { title: it.title, source: it.source, dateLabel: formatDate(it.date), link: await resolveGoogleNewsUrl(it.link) };
      }),
  );

  const chosen = pick.use && candidates[pick.index - 1];
  if (!chosen) return { used: false, reason: 'Found recent news, but none connected strongly enough to use.', related };

  const link = await resolveGoogleNewsUrl(chosen.link);
  const read = await readFacts(t, link);
  return {
    used: true,
    title: chosen.title,
    source: chosen.source,
    link,
    date: chosen.date,
    dateLabel: formatDate(chosen.date),
    angle: read.angle || pick.angle,
    facts: read.facts,
    related,
  };
}

// Read the article and pull out a few specific facts. Empty facts means the
// page was blocked or paywalled; the draft then treats it as headline-only.
async function readFacts(t, url) {
  const article = await fetchArticleText(url);
  if (!article) return { facts: [] };
  try {
    const out = await generate({
      models: config.fastModels,
      system: P.FACTS_SYSTEM,
      contents: P.factsPrompt(t.core_claim, article),
      schema: P.FACTS_SCHEMA,
      temperature: 0,
    });
    return out.readable ? { title: article.title, facts: out.facts.slice(0, 3), angle: out.angle } : { title: article.title, facts: [] };
  } catch (err) {
    console.warn(`[news] couldn't extract facts from ${url}: ${err.message}`);
    return { title: article.title, facts: [] };
  }
}

// Steps 3-5: draft, editor review, deterministic style checks with one fix pass.
export async function writeDraft({ note, triage: t, angle, previous, feedback }) {
  const first = await generate({
    models: config.draftModels,
    system: P.DRAFT_SYSTEM,
    contents: P.draftPrompt({ note, triage: t, angle, previous, feedback }),
    temperature: 0.8,
  });

  const review = await generate({
    models: config.draftModels,
    system: P.REVIEW_SYSTEM,
    contents: P.reviewPrompt({ note, angle, draft: first }),
    schema: P.REVIEW_SCHEMA,
    temperature: 0.2,
  });
  let text = clean(review.revised_post || first);

  let check = lint(text);
  if (!check.ok || check.suggestions.length) {
    text = clean(await generate({
      models: config.draftModels,
      system: P.DRAFT_SYSTEM,
      contents: P.fixPrompt(text, [...check.issues, ...check.suggestions]),
      temperature: 0.3,
    }));
    check = lint(text);
  }

  return { text, check, flags: extractFlags(text), editorChanges: review.changes || [] };
}

// Strip wrapping quotes/fences a model sometimes adds.
// Also swaps em dashes for the spaced hyphens she uses for asides.
function clean(text) {
  return text
    .replace(/^```[a-z]*\n?|```$/g, '')
    .replace(/^"""\n?|\n?"""$/g, '')
    .replace(/\s*—\s*/g, ' - ')
    .trim();
}

export async function runPipeline(note, { force = false, onStage = () => {} } = {}) {
  await onStage('Reading the note…');
  const t = await triage(note);
  if (!t.worth_developing && !force) return { triage: t, parked: true };

  await onStage(`Worth developing (${t.score}/5, ${t.pillar}). Looking for a current angle…`);
  const angle = await findAngle(note, t);

  const found = angle.fromNote
    ? `Read the source in your note (${angle.source}).`
    : angle.used
      ? `Found an angle: ${angle.source}${angle.facts?.length ? ', read the article' : ', headline only'}.`
      : 'No strong news angle.';
  await onStage(`${found} Drafting in Meera's voice…`);
  const draft = await writeDraft({ note, triage: t, angle });
  return { triage: t, angle, draft };
}
