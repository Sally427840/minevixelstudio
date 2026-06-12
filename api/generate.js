export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { addonType, addonName, description, behavior, photo } = req.body;

    if (!addonName || !description) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

    if (!ANTHROPIC_KEY) {
      res.status(500).json({ error: 'API key not configured' });
      return;
    }

    const prompt = `You are a Minecraft Bedrock addon generator. Generate addon data for:
Type: ${addonType}
Name: ${addonName}
Description: ${description}
Behavior: ${behavior || 'Default'}

Respond ONLY with valid JSON, no markdown, no extra text:
{"addonName":"${addonName}","addonType":"${addonType}","behavior":"${behavior || 'Default'}","description":"${description}","colors":["#8B4513","#A0522D","#CD853F","#D2691E","#F4A460"],"manifest":{"format_version":2,"header":{"name":"${addonName}","description":"${description}","uuid":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","version":[1,0,0],"min_engine_version":[1,20,0]},"modules":[{"type":"resources","uuid":"b2c3d4e5-f6a7-8901-bcde-f12345678901","version":[1,0,0]}]},"entity":{"identifier":"minecraft:${addonName.toLowerCase().replace(/\s+/g,'_')}","is_spawnable":true,"is_summonable":true}}`;

    const messages = [];

    if (photo) {
      try {
        const base64Data = photo.split(',')[1];
        const mediaType = photo.split(';')[0].split(':')[1];
        messages.push({
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
            { type: 'text', text: prompt }
          ]
        });
      } catch (e) {
        messages.push({ role: 'user', content: prompt });
      }
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(500).json({ error: data.error?.message || 'Claude API error: ' + response.status });
      return;
    }

    if (!data.content || !data.content[0]) {
      res.status(500).json({ error: 'Empty response from AI' });
      return;
    }

    const text = data.content[0].text;
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      parsed = {
        addonName,
        addonType,
        behavior: behavior || 'Default',
        description,
        colors: ['#5D8A3C', '#4AEDD9', '#FFD700', '#8B5E3C', '#f0f0f0']
      };
    }

    res.status(200).json({ success: true, addon: parsed });

  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
