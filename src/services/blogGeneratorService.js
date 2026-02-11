/**
 * Blog Generator Service — uses Google Gemini to produce blog posts.
 * Ported from auto-blog to run on the trading backend with Postgres.
 */

const { GoogleGenAI } = require('@google/genai');
const db = require('../config/database');

const MODEL = 'gemini-2.5-pro';

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.includes('your_')) throw new Error('GEMINI_API_KEY not set');
  return new GoogleGenAI({ apiKey: key });
}

function getCurrentDate() {
  const d = new Date();
  return {
    full: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    month: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' }),
    year: d.getFullYear(),
    yesterday: new Date(d - 86400000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  };
}

const NICHE_PROMPTS = {
  movies: `You are a professional movie critic and film journalist. Cover latest movie releases, reviews, box office analysis, trailers, casting news. Include IMDb/Rotten Tomatoes-style ratings where appropriate.`,
  'tv-series': `You are a TV series reviewer. Cover latest streaming shows, season reviews, episode guides, casting news, show comparisons.`,
  bollywood: `You are a Bollywood entertainment journalist. Cover latest Hindi/regional Indian films, OTT releases, box office collection in crores (₹), Bollywood gossip.`,
  hollywood: `You are a Hollywood entertainment journalist. Cover Marvel/DC movies, Oscar predictions, big-budget blockbusters, director spotlights.`,
  'ott-streaming': `You are a streaming platform expert. Compare shows across Netflix, Amazon Prime, Disney+, HBO Max, Apple TV+.`,
  trending: `You are a news journalist covering today's trending topics. Write about viral stories, breaking developments, Google Trends topics.`,
  'indian-stocks': `You are an Indian stock market analyst. Cover NSE, BSE, Nifty 50, Sensex, IPOs, SEBI regulations, FII/DII flows.`,
  'mutual-funds': `You are an Indian mutual fund advisor. Cover SIP plans, ELSS, debt funds, AMC comparisons, mutual fund taxation.`,
  'tax-planning': `You are an Indian tax planning expert. Cover income tax saving, ITR filing, Section 80C/80D, GST, HRA exemption.`,
  'indian-insurance': `You are an Indian insurance advisor. Cover LIC plans, health insurance, term insurance, IRDAI regulations.`,
  'us-stocks': `You are a US stock market analyst. Cover S&P 500, NASDAQ, Dow Jones, US IPOs, SEC filings, earnings reports.`,
  'us-insurance': `You are a US insurance advisor. Cover health insurance, Medicare, auto insurance, life insurance, ACA marketplace.`,
  finance: `You are a personal finance expert. Cover investing, mutual funds, tax planning, and wealth building strategies.`,
  technology: `You are a technology journalist. Cover AI tools, software reviews, gadgets, cybersecurity, and tech news.`,
  crypto: `You are a cryptocurrency analyst. Cover Bitcoin, Ethereum, DeFi, NFTs, crypto trading, and blockchain technology.`,
};

const NICHE_PHOTOS = {
  movies: ['photo-1489599849927-2ee91cede3ba', 'photo-1536440136628-849c177e76a1'],
  'tv-series': ['photo-1593784991095-a205069470b6', 'photo-1611162617213-7d7a39e9b1d7'],
  bollywood: ['photo-1598899134739-24c46f58b8c0', 'photo-1517604931442-7e0c8ed2963c'],
  hollywood: ['photo-1478720568477-152d9b164e26', 'photo-1542204165-65bf26472b9b'],
  'ott-streaming': ['photo-1611162617213-7d7a39e9b1d7', 'photo-1574375927938-d5a98e8d7e28'],
  trending: ['photo-1495020689067-958852a7765e', 'photo-1585829365295-ab7cd400c167'],
  finance: ['photo-1611974789855-9c2a0a7236a3', 'photo-1579532537598-459ecdaf39cc'],
  'indian-stocks': ['photo-1611974789855-9c2a0a7236a3', 'photo-1590283603385-17ffb3a7f29f'],
  'us-stocks': ['photo-1611974789855-9c2a0a7236a3', 'photo-1590283603385-17ffb3a7f29f'],
  insurance: ['photo-1554224155-6726b3ff858f', 'photo-1556742049-0cfed4f6a45d'],
  technology: ['photo-1518770660439-4636190af475', 'photo-1550751827-4bd374c3f58b'],
  crypto: ['photo-1639762681057-408e52192e55', 'photo-1621761191319-c6fb62004040'],
};

function getUnsplashUrl(query, width = 1200, height = 630) {
  const q = (query || '').toLowerCase();
  let key = 'trending';
  if (q.match(/movie|film|cinema|oscar/)) key = 'movies';
  else if (q.match(/series|tv.?show|season/)) key = 'tv-series';
  else if (q.match(/bollywood|hindi/)) key = 'bollywood';
  else if (q.match(/hollywood|marvel|dc/)) key = 'hollywood';
  else if (q.match(/netflix|streaming|ott/)) key = 'ott-streaming';
  else if (q.match(/financ|invest|stock|money/)) key = 'finance';
  else if (q.match(/tech|software|ai|gadget/)) key = 'technology';
  else if (q.match(/crypto|bitcoin|blockchain/)) key = 'crypto';

  const photos = NICHE_PHOTOS[key] || NICHE_PHOTOS.trending;
  const photo = photos[Math.floor(Math.random() * photos.length)];
  return `https://images.unsplash.com/${photo}?w=${width}&h=${height}&fit=crop&auto=format&q=80`;
}

async function getHeroImage(query) {
  // Try Pexels first
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey && !pexelsKey.includes('your_')) {
    try {
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`;
      const res = await fetch(url, { headers: { Authorization: pexelsKey } });
      if (res.ok) {
        const data = await res.json();
        if (data.photos && data.photos.length > 0) {
          const p = data.photos[0];
          return { url: p.src.large2x || p.src.large, alt: query };
        }
      }
    } catch (e) { /* fall through to unsplash */ }
  }
  return { url: getUnsplashUrl(query), alt: query };
}

/**
 * Generate a topic + metadata for a given niche.
 */
async function generateTopic(niche, existingTitles = []) {
  const client = getClient();
  const date = getCurrentDate();
  const market = niche.market || 'global';
  const avoidList = existingTitles.slice(0, 30).map(t => `- ${t}`).join('\n');
  const nichePrompt = NICHE_PROMPTS[niche.id] || '';

  const marketContext = {
    india: `Target audience: Indian readers. Use Indian context — INR (₹) currency, Indian references.`,
    us: `Target audience: American readers. Use US context — USD ($) currency, US references.`,
    global: `Target audience: Global readers. Keep content internationally relevant.`,
  };

  const prompt = `${nichePrompt}

You are a content strategist for "Info Bytes" — a trending news and entertainment blog.
CURRENT DATE: ${date.full} (YESTERDAY: ${date.yesterday})
CURRENT YEAR: ${date.year}
${marketContext[market] || marketContext.global}

Generate a blog post topic that:
1. Is EXTREMELY CURRENT — reference things happening THIS WEEK
2. Would rank well in Google search TODAY
3. MUST be about ${date.year} content ONLY

NICHE: ${niche.name}
${niche.keywords ? `Seed keywords: ${niche.keywords}` : ''}
${avoidList ? `ALREADY PUBLISHED (do NOT repeat):\n${avoidList}\n` : ''}

Return ONLY a JSON object (no markdown, no backticks):
{
  "title": "Compelling title with ${date.year} reference (50-65 chars)",
  "slug": "url-friendly-slug-with-dashes",
  "keyword": "primary target keyword phrase",
  "excerpt": "Compelling 1-2 sentence meta description (120-155 chars)",
  "tags": ["tag1", "tag2", "tag3", "tag4"],
  "imageQuery": "2-3 word search query for hero image",
  "market": "${market}"
}`;

  const result = await client.models.generateContent({
    model: MODEL,
    contents: prompt,
  });
  const text = result.text.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
  return JSON.parse(text);
}

/**
 * Generate full blog post content in Markdown.
 */
async function generateContent(topic, niche) {
  const client = getClient();
  const date = getCurrentDate();
  const market = topic.market || niche.market || 'global';
  const nichePrompt = NICHE_PROMPTS[niche.id] || '';
  const isEntertainment = ['movies', 'tv-series', 'bollywood', 'hollywood', 'ott-streaming'].includes(niche.id);

  const marketContext = {
    india: `Write for an INDIAN audience. Use INR (₹) for currency.`,
    us: `Write for an AMERICAN audience. Use USD ($) for currency.`,
    global: `Write for a GLOBAL audience.`,
  };

  const prompt = `${nichePrompt}

Write a comprehensive blog article for "Info Bytes" blog.
CURRENT DATE: ${date.full}
YESTERDAY: ${date.yesterday}

TOPIC: ${topic.title}
PRIMARY KEYWORD: ${topic.keyword}
${marketContext[market] || marketContext.global}

RULES:
1. Write 1800–2500 words of HIGH-QUALITY, original, CURRENT content
2. ALL information must be CURRENT as of ${date.month} ${date.year}
3. Use Markdown: Start with strong intro (NO H1), use ## for sections, ### for sub-sections, bold **key terms**
4. SEO: Include primary keyword in first paragraph and at least 2 H2 headings
5. TONE: ${isEntertainment ? 'Engaging, passionate, opinionated but balanced.' : 'Authoritative, helpful, clear.'}
6. End with a "Key Takeaways" or "The Bottom Line" section
7. DO NOT reference 2025 or earlier as current. Everything for ${date.year}.

Return ONLY the markdown content, nothing else.`;

  const result = await client.models.generateContent({
    model: MODEL,
    contents: prompt,
  });
  return result.text.trim();
}

/**
 * Generate a single blog post for a random (or specific) niche and save it to Postgres.
 */
async function generatePost(specificNicheId = null) {
  await db._ready;

  let niche;
  if (specificNicheId) {
    niche = await db.prepare('SELECT * FROM blog_niches WHERE id=? AND is_active=1').get(specificNicheId);
    if (!niche) throw new Error(`Niche "${specificNicheId}" not found or inactive`);
  } else {
    // Weighted-random: prefer niches with fewer posts
    const niches = await db.prepare('SELECT * FROM blog_niches WHERE is_active=1').all();
    if (niches.length === 0) throw new Error('No active niches found. Run seed first.');

    const counts = {};
    for (const n of niches) {
      const c = await db.prepare('SELECT COUNT(*) as cnt FROM blog_posts WHERE niche_id=?').get(n.id);
      counts[n.id] = Number(c?.cnt || 0);
    }
    const maxCount = Math.max(...Object.values(counts), 1);
    const weighted = niches.map(n => ({ ...n, weight: maxCount - counts[n.id] + 1 }));
    const totalWeight = weighted.reduce((s, n) => s + n.weight, 0);
    let r = Math.random() * totalWeight;
    for (const n of weighted) {
      r -= n.weight;
      if (r <= 0) { niche = n; break; }
    }
    if (!niche) niche = niches[0];
  }

  console.log(`[Blog] Generating post for niche: ${niche.name}`);

  // Get existing titles
  const existing = await db.prepare('SELECT title FROM blog_posts WHERE niche_id=? ORDER BY created_at DESC LIMIT 30').all(niche.id);
  const existingTitles = existing.map(e => e.title);

  // Step 1: Generate topic
  const topic = await generateTopic(niche, existingTitles);
  console.log(`[Blog] Topic: ${topic.title}`);

  // Step 2: Fetch hero image
  const image = await getHeroImage(topic.imageQuery || topic.keyword);

  // Step 3: Generate full content
  const content = await generateContent(topic, niche);
  const wordCount = content.split(/\s+/).length;
  const readingTime = Math.max(3, Math.ceil(wordCount / 250));

  // Step 4: Slug uniqueness
  let slug = topic.slug.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 120);
  const existingSlug = await db.prepare('SELECT id FROM blog_posts WHERE slug=?').get(slug);
  if (existingSlug) slug = slug + '-' + Date.now().toString(36);

  // Step 5: Save to DB
  await db.prepare(`
    INSERT INTO blog_posts (slug, title, excerpt, content, niche_id, tags, image_url, image_alt, reading_time, meta_title, meta_description, market, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
  `).run(
    slug,
    topic.title,
    topic.excerpt,
    content,
    niche.id,
    (topic.tags || []).join(', '),
    image.url,
    image.alt || topic.title,
    readingTime,
    topic.title,
    topic.excerpt || topic.title,
    niche.market || 'global',
  );

  // Log
  await db.prepare('INSERT INTO blog_generation_log (niche_id, topic, status) VALUES (?, ?, ?)').run(niche.id, topic.title, 'success');

  console.log(`[Blog] Published: /post/${slug} (${wordCount} words, ${readingTime} min read)`);
  return { slug, title: topic.title, wordCount, readingTime };
}

/**
 * Batch-generate multiple posts.
 */
async function batchGenerate(count = 3) {
  const results = [];
  for (let i = 0; i < count; i++) {
    try {
      const result = await generatePost();
      results.push(result);
      // 5s delay between posts to be respectful to APIs
      if (i < count - 1) await new Promise(r => setTimeout(r, 5000));
    } catch (err) {
      console.error(`[Blog] Post ${i + 1} failed:`, err.message);
      try {
        await db.prepare('INSERT INTO blog_generation_log (topic, status, error) VALUES (?, ?, ?)').run('unknown', 'failed', err.message);
      } catch {}
    }
  }
  return results;
}

/**
 * Seed default niches into Postgres.
 */
async function seedNiches() {
  await db._ready;

  const niches = [
    { id: 'movies', name: 'Movies', description: 'Latest movie reviews, box office updates, upcoming releases.', avg_cpc: 3.50, market: 'global', keywords: 'new movie releases 2026, best movies 2026, movie reviews, box office collection' },
    { id: 'tv-series', name: 'TV Series', description: 'Latest TV show reviews, streaming series, season updates.', avg_cpc: 3.00, market: 'global', keywords: 'best tv series 2026, netflix new shows, amazon prime series, hbo max shows' },
    { id: 'bollywood', name: 'Bollywood & Indian Cinema', description: 'Bollywood movies, south Indian films, OTT releases.', avg_cpc: 2.50, market: 'india', keywords: 'bollywood new movies 2026, south indian movies, ott release this week' },
    { id: 'hollywood', name: 'Hollywood & Global Cinema', description: 'Hollywood blockbusters, Marvel/DC updates, Oscar contenders.', avg_cpc: 4.00, market: 'us', keywords: 'hollywood movies 2026, marvel phase 6, oscar predictions 2026' },
    { id: 'ott-streaming', name: 'OTT & Streaming', description: 'Netflix, Amazon Prime, Disney+, HBO Max releases.', avg_cpc: 3.50, market: 'global', keywords: 'netflix new releases this week, amazon prime best movies, disney plus upcoming' },
    { id: 'trending', name: 'Trending News', description: 'Trending topics, viral stories, breaking news.', avg_cpc: 2.00, market: 'global', keywords: 'trending news today, viral stories, breaking news, google trending' },
    { id: 'indian-stocks', name: 'Indian Stock Market', description: 'NSE, BSE, Nifty 50, Sensex, IPOs.', avg_cpc: 6.00, market: 'india', keywords: 'nifty 50 analysis today, best stocks to buy india, ipo listing today' },
    { id: 'mutual-funds', name: 'Mutual Funds India', description: 'SIP plans, ELSS, debt funds, hybrid funds.', avg_cpc: 7.50, market: 'india', keywords: 'best sip plans 2026, elss tax saving mutual funds, mutual fund returns comparison' },
    { id: 'tax-planning', name: 'Tax Planning India', description: 'Income tax saving, ITR filing, Section 80C/80D.', avg_cpc: 8.00, market: 'india', keywords: 'income tax saving tips, section 80c deductions, itr filing online' },
    { id: 'indian-insurance', name: 'Insurance India', description: 'LIC plans, health insurance, term insurance.', avg_cpc: 10.00, market: 'india', keywords: 'best term insurance plan india, lic new plan, health insurance family floater' },
    { id: 'us-stocks', name: 'US Stock Market', description: 'S&P 500, NASDAQ, Dow Jones, US IPOs.', avg_cpc: 9.00, market: 'us', keywords: 'best stocks to buy now, s&p 500 forecast, nasdaq today' },
    { id: 'us-insurance', name: 'Insurance US', description: 'Health insurance, Medicare, auto insurance.', avg_cpc: 14.00, market: 'us', keywords: 'best health insurance plans, medicare enrollment, car insurance comparison' },
    { id: 'finance', name: 'Finance & Investing', description: 'Personal finance, stock market investing.', avg_cpc: 8.50, market: 'global', keywords: 'best investment plans, how to invest money, stock market for beginners' },
    { id: 'technology', name: 'Technology & AI', description: 'AI tools, software reviews, gadgets.', avg_cpc: 6.50, market: 'global', keywords: 'best ai tools 2026, chatgpt alternatives, cybersecurity tips' },
    { id: 'crypto', name: 'Cryptocurrency & Blockchain', description: 'Bitcoin, Ethereum, DeFi, NFTs.', avg_cpc: 7.00, market: 'global', keywords: 'bitcoin price prediction, best crypto exchange, ethereum staking guide' },
  ];

  let seeded = 0;
  for (const n of niches) {
    // Upsert: delete + insert
    await db.prepare('DELETE FROM blog_niches WHERE id=?').run(n.id);
    await db.prepare(
      'INSERT INTO blog_niches (id, name, description, avg_cpc, keywords, market, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
    ).run(n.id, n.name, n.description, n.avg_cpc, n.keywords, n.market);
    seeded++;
  }
  console.log(`[Blog] Seeded ${seeded} niches`);
  return seeded;
}

module.exports = { generatePost, batchGenerate, seedNiches, generateTopic, generateContent, getHeroImage };
