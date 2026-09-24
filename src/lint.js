// Deterministic checks from section 10 of the voice guide. These don't rely on
// the model noticing its own mistakes: if one fails, the draft goes back for a
// targeted fix, and anything still failing is shown to Meera.

const BANNED = [
  'glow', 'glowing', 'radiant', 'skin-loving', 'self-care', 'self care', 'nourish', 'nourishing',
  'game-changer', 'game changer', 'holy grail', 'revolutionary', 'breakthrough', "you won't believe",
  "here's the thing", 'let that sink in', 'agree?', 'thoughts?', 'humbled', 'follow for more',
  "let's talk about", 'secret the industry',
];

const AMERICAN = {
  color: 'colour', colors: 'colours', behavior: 'behaviour', behaviors: 'behaviours',
  flavor: 'flavour', favor: 'favour', favorite: 'favourite', center: 'centre', centers: 'centres',
  fiber: 'fibre', fibers: 'fibres', gray: 'grey', labor: 'labour', odor: 'odour', odors: 'odours',
  judgment: 'judgement', aluminum: 'aluminium', estrogenic: 'oestrogenic', estrogen: 'oestrogen',
};
// -ize/-yze words, except ones that are spelt that way in British English too.
const IZE_OK = new Set(['capsize', 'downsize', 'oversize', 'resize', 'outsize', 'maize', 'baize']);

const words = (s) => s.split(/\s+/).filter(Boolean);

export function extractFlags(text) {
  return [...text.matchAll(/\[(VERIFY|MEERA):\s*([^\]]*)\]/g)].map(([, kind, detail]) => ({ kind, detail: detail.trim() }));
}

export function lint(text) {
  const issues = [];
  const suggestions = []; // checklist items her own posts don't always follow
  const count = words(text).length;
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const lower = text.toLowerCase();

  if (count < 350 || count > 600) issues.push(`Length is ${count} words; target is 350-600.`);
  if (paragraphs.length < 5 || paragraphs.length > 10) suggestions.push(`${paragraphs.length} paragraphs; target is 6-9 prose paragraphs.`);

  if (/\p{Extended_Pictographic}/u.test(text)) issues.push('Contains emojis.');
  if (/(^|\s)#[A-Za-z]/.test(text)) issues.push('Contains hashtags.');
  if (text.includes('!')) issues.push('Contains exclamation marks.');
  if (/^\s*([-•*]|\d+[.)])\s/m.test(text)) issues.push('Contains bullet or numbered lines; use prose paragraphs.');
  if (/^#{1,6}\s/m.test(text)) issues.push('Contains headers.');

  const shortParas = paragraphs.filter((p) => words(p).length < 10).length;
  if (shortParas > 2) issues.push(`${shortParas} one-line paragraphs; reads like LinkedIn "broetry".`);

  const firstSentence = paragraphs[0]?.match(/^[^.?!]*[.?!]/)?.[0] ?? '';
  if (firstSentence.trim().endsWith('?')) issues.push('Opens with a question; open on a concrete claim, scene or number.');
  if ((text.match(/\?/g) || []).length > 3) issues.push('Too many questions; she uses very few rhetorical questions.');

  const banned = BANNED.filter((b) => new RegExp(`(^|[^a-z])${b.replace(/[?]/g, '\\?')}([^a-z]|$)`, 'i').test(lower));
  if (banned.length) issues.push(`Uses words she never uses: ${banned.join(', ')}.`);

  const american = new Set();
  for (const w of lower.match(/[a-z]+/g) || []) {
    if (AMERICAN[w]) american.add(`${w} -> ${AMERICAN[w]}`);
    if (/^[a-z]{3,}(iz|yz)(e|es|ed|ing|ation|ations|er|ers)$/.test(w) && !IZE_OK.has(w)) {
      american.add(`${w} -> ${w.replace(/iz(?=e|ing|ation|er)/, 'is').replace(/yz(?=e|ing|er)/, 'ys')}`);
    }
  }
  if (american.size) issues.push(`American spelling: ${[...american].join(', ')}.`);

  if (!/(not saying|i'm not|i am not|not making a case|not trying to|not arguing|what i'm not)/i.test(text)) {
    suggestions.push('No clear "what I\'m not saying" beat.');
  }
  const last = paragraphs.at(-1)?.toLowerCase() ?? '';
  if (!/\bask\b|\basking\b/.test(last)) suggestions.push('Closing paragraph should tell the reader what to ask, and of whom.');

  return { ok: issues.length === 0, issues, suggestions, wordCount: count };
}
