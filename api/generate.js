export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { addonType, addonName, description, behavior, photo } = req.body;

  if (!addonName || !description) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  const prompt = `You are a Minecraft Bedrock addon generator. Generate a complete addon for the following:\n\nType: ${addonType}\nName: ${addonName}\nDescription: ${description}\nBehavior: ${behavior || 'Default'}\n\nRespond ONLY with a JSON object, no other text:\n\n{"manifest":{"format_version":2,"header":{"name":"${addonName}","description":"${description}","uuid":"GENERATE_UUID_1","version":[1,0,0],"min_engine_version":[1,20,0]},"modules":[{"type":"resources","uuid":"GENERATE_UUID_2","version":[1,0,0]}]},"entity":{"description":"Complete definition for ${addonName}","components":{}},"colors":["#hex1","#hex2","#hex3","#hex4","#hex5"],"addonName":"${addonName}","addonType":"${addonType}","behavior":"${behavior || 'Default'}","description":"${description}"}`;

  try {
    const messages = [];
    if (photo) {
      const base64Data = photo.split(',')[1];
      const mediaType = photo.split(';')[0].split(':')[1];
      messages.push({ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } }, { type: 'text', text: prompt }] });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, messages })
    });

    const data = await response.json();
    if (!response.ok) { res.status(500).json({ error: data.error?.message || 'AI error' }); return; }

    const text = data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.status(200).json({ success: true, addon: parsed });

  } catch (err) {
    res.status(500).json({ error: 'Failed to generate addon: ' + err.message });
  }
} 
