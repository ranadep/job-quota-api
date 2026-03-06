const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Add this to handle raw text body as fallback
app.use(express.json());
app.use(express.text({ type: '*/*' }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const LIMITS = {
  platinum: 10000,
  gold: 3,
  silver: 1,
  bronze: 0
};

app.post('/post-job', async (req, res) => {
  let body = req.body;

  // If body came in as a string (due to bad JSON), clean and parse it
  if (typeof body === 'string') {
    body = body
      .replace(/[\r\n\t]/g, ' ')  // replace newlines/tabs with spaces
      .replace(/\s+/g, ' ');       // collapse multiple spaces
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({ error: 'Could not parse body: ' + e.message });
    }
  }

  const { email, tier, title, description, link } = body;

  // Sanitize each field just in case
  const clean = (str) => (str || '').replace(/[\r\n\t]/g, ' ').trim();

  if (!email || !tier || !title || !description)
    return res.status(400).json({ error: 'Missing fields' });

  const limit = LIMITS[tier.toLowerCase()];
  if (limit === undefined) return res.status(400).json({ error: 'Invalid tier' });
  if (limit === 0) return res.status(403).json({ error: 'Your tier cannot post jobs' });

  const month = new Date().toISOString().slice(0, 7).replace('-', '_');
  const sponsorKey = `${tier.toLowerCase()}_${email}_${month}`;

  const { data } = await supabase
    .from('job_quotas')
    .select('count')
    .eq('sponsor_key', sponsorKey)
    .single();

  const currentCount = data?.count || 0;
  if (currentCount >= limit)
    return res.status(429).json({ error: `Monthly limit of ${limit} reached` });

  await supabase.from('job_quotas').upsert({
    sponsor_key: sponsorKey,
    count: currentCount + 1,
    updated_at: new Date().toISOString()
  }, { onConflict: 'sponsor_key' });

  const message = [
    '━━━━━━━━━━━━━━━━━━━━━━',
    `📢 **${clean(title)}**`,
    '',
    `📝 ${clean(description)}`,
    link ? `🔗 Apply: ${clean(link)}` : '',
    '━━━━━━━━━━━━━━━━━━━━━━'
  ].filter(Boolean).join('\n');

  await fetch(process.env.DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message })
  });

  res.json({ success: true, used: currentCount + 1, limit });
});

app.listen(process.env.PORT || 3000);
