// Real, recent news from Google News RSS (free, no key). Every item has a
// link the bot actually fetched, so the angle Meera sees is always checkable.

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
};

const decodeEntities = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

export async function searchNews(query, { days = 120, max = 8 } = {}) {
  const q = encodeURIComponent(`${query} when:${days}d`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Google News returned ${res.status}`);
  const xml = await res.text();

  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, max).map(([, item]) => {
    const get = (tag) => decodeEntities(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? '');
    const source = get('source');
    let title = get('title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return { title, source, link: get('link'), date: get('pubDate') };
  });
}

// Google News RSS links are redirects that neither Gemini nor a plain fetch can
// follow. This asks Google News for the real publisher URL, the same way its
// own web page does. Returns the original link if decoding fails.
export async function resolveGoogleNewsUrl(link) {
  if (!/news\.google\.com/.test(link)) return link;
  try {
    const id = new URL(link).pathname.split('/').pop();
    const html = await (await fetch(`https://news.google.com/articles/${id}`, { headers: UA })).text();
    const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!sig || !ts) return link;
    const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sig}"]`;
    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]])),
    });
    const payload = JSON.parse((await res.text()).split('\n\n')[1]);
    const url = JSON.parse(payload[0][2])[1];
    return typeof url === 'string' && url.startsWith('http') ? url : link;
  } catch {
    return link;
  }
}

// Fetch an article and reduce it to readable text. Returns null when the page
// is blocked, paywalled or too thin to be the article itself.
export async function fetchArticleText(url) {
  try {
    const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const html = await res.text();
    const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    const body = (html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html)
      .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|h[1-6]|li|div|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    const text = decodeEntities(body).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    return text.length > 600 ? { title, text: text.slice(0, 12000) } : null;
  } catch {
    return null;
  }
}

export function formatDate(date) {
  const d = new Date(date);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const hostname = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};
