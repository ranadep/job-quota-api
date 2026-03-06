const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();

app.use(express.text({ type: '*/*' }));
app.use((req, res, next) => {
  if (typeof req.body === 'string') {
    try {
      const cleaned = req.body.replace(/\r\n/g, '\\n').replace(/\r/g, '\\n').replace(/\n/g, '\\n');
      req.body = JSON.parse(cleaned);
    } catch (e) {
      return res.status(400).json({ error: 'Could not parse body: ' + e.message });
    }
  }
  next();
});
app.use(express.json());

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
  const { email, tier, title, description, link } = req.body;

  const clean = (str) => (str || '').replace(/\\n/g, '\n').trim();

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
