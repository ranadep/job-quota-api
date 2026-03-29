const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.urlencoded({ extended: true }));
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
  const { company, title, description, link } = req.body;

  if (!company || !title || !description)
    return res.status(400).json({ error: 'Missing fields' });

  // Look up company in sponsors table
  const { data: sponsor, error: sponsorError } = await supabase
    .from('sponsors')
    .select('tier')
    .ilike('company_name', company.trim())
    .single();

  if (sponsorError || !sponsor)
    return res.status(403).json({ error: `Company "${company}" is not a registered sponsor` });

  const tier = sponsor.tier;
  const limit = LIMITS[tier];

  if (limit === 0)
    return res.status(403).json({ error: 'Your tier cannot post jobs' });

  const month = new Date().toISOString().slice(0, 7).replace('-', '_');
  const sponsorKey = `${tier}_${company.trim().toLowerCase().replace(/\s+/g, '_')}_${month}`;

  const { data } = await supabase
    .from('job_quotas')
    .select('count')
    .eq('sponsor_key', sponsorKey)
    .single();

  const currentCount = data?.count || 0;
  if (currentCount >= limit)
    return res.status(429).json({ error: `Monthly limit of ${limit} reached for ${company}` });

  await supabase.from('job_quotas').upsert({
    sponsor_key: sponsorKey,
    count: currentCount + 1,
    updated_at: new Date().toISOString()
  }, { onConflict: 'sponsor_key' });

  const message = [
    '━━━━━━━━━━━━━━━━━━━━━━',
    `**${title}**`,
    `${company}`,
    '',
    `${description}`,
    '',
    link ? `Apply here: ${link}` : '',
    '━━━━━━━━━━━━━━━━━━━━━━'
  ].filter(Boolean).join('\n');

  await fetch(process.env.DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message })
  });

  res.json({ success: true, used: currentCount + 1, limit, tier });
});

app.listen(process.env.PORT || 3000);
