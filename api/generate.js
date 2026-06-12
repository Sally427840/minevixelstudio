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

    const identifier = addonName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    const prompt = `You are a Minecraft Bedrock addon expert. Based on this addon request, generate a color palette and entity description.

Type: ${addonType}
Name: ${addonName}
Description: ${description}
Behavior: ${behavior || 'Passive'}

Respond ONLY with valid JSON like this example, no markdown:
{
  "addonName": "${addonName}",
  "addonType": "${addonType}",
  "identifier": "${identifier}",
  "behavior": "${behavior || 'Passive'}",
  "description": "${description}",
  "colors": ["#5D8A3C", "#4AEDD9", "#FFD700", "#8B5E3C", "#f0f0f0"],
  "health": 20,
  "attack": 4,
  "speed": 0.3,
  "size": "medium",
  "abilities": ["walks", "follows player"],
  "lore": "A mysterious creature from another dimension"
}`;

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
        max_tokens: 1000,
        messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(500).json({ error: data.error?.message || 'Claude API error' });
      return;
    }

    const text = data.content[0].text;
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      parsed = {
        addonName, addonType, identifier,
        behavior: behavior || 'Passive',
        description,
        colors: ['#5D8A3C', '#4AEDD9', '#FFD700', '#8B5E3C', '#f0f0f0'],
        health: 20, attack: 4, speed: 0.3,
        size: 'medium',
        abilities: ['walks'],
        lore: description
      };
    }

    // Now build the mcaddon zip
    const uuid1 = genUUID(), uuid2 = genUUID(), uuid3 = genUUID(), uuid4 = genUUID();
    const id = parsed.identifier || identifier;

    // Build file contents
    const resourceManifest = {
      format_version: 2,
      header: { name: addonName + ' Resources', description, uuid: uuid1, version: [1,0,0], min_engine_version: [1,20,0] },
      modules: [{ type: 'resources', uuid: uuid2, version: [1,0,0] }]
    };

    const behaviorManifest = {
      format_version: 2,
      header: { name: addonName + ' Behaviors', description, uuid: uuid3, version: [1,0,0], min_engine_version: [1,20,0] },
      modules: [{ type: 'data', uuid: uuid4, version: [1,0,0] }],
      dependencies: [{ uuid: uuid1, version: [1,0,0] }]
    };

    const isHostile = (behavior === 'Hostile' || behavior === 'Boss');
    const isCompanion = (behavior === 'Companion' || behavior === 'Passive');

    const entityBehavior = {
      format_version: '1.18.0',
      'minecraft:entity': {
        description: { identifier: `minevixel:${id}`, is_spawnable: true, is_summonable: true, is_experimental: false },
        components: {
          'minecraft:health': { value: parsed.health || 20, max: parsed.health || 20 },
          'minecraft:movement': { value: parsed.speed || 0.25 },
          'minecraft:collision_box': { width: 0.9, height: 1.8 },
          'minecraft:nameable': {},
          'minecraft:physics': {},
          ...(isHostile ? {
            'minecraft:attack': { damage: parsed.attack || 4 },
            'minecraft:behavior.nearest_attackable_target': { priority: 2, entity_types: [{ filters: { test: 'is_family', subject: 'other', value: 'player' }, max_dist: 16 }] },
            'minecraft:behavior.melee_attack': { priority: 3 }
          } : {}),
          ...(isCompanion ? { 'minecraft:behavior.follow_owner': { priority: 1, speed_multiplier: 1.2, start_distance: 10, stop_distance: 2 } } : {}),
          'minecraft:behavior.random_stroll': { priority: 6, speed_multiplier: 0.8 },
          'minecraft:behavior.look_at_player': { priority: 7, look_distance: 6 },
          'minecraft:behavior.random_look_around': { priority: 8 }
        },
        events: {}
      }
    };

    const entityResource = {
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: `minevixel:${id}`,
          materials: { default: 'entity_alphatest' },
          textures: { default: `textures/entity/${id}` },
          geometry: { default: `geometry.${id}` },
          render_controllers: ['controller.render.default']
        }
      }
    };

    const geometry = {
      format_version: '1.12.0',
      'minecraft:geometry': [{
        description: { identifier: `geometry.${id}`, texture_width: 64, texture_height: 64, visible_bounds_width: 2, visible_bounds_height: 2, visible_bounds_offset: [0,1,0] },
        bones: [{ name: 'body', pivot: [0,0,0], cubes: [{ origin: [-4,0,-4], size: [8,8,8], uv: [0,0] }] }]
      }]
    };

    // Simple 1x1 green PNG base64
    const texturePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // Build zip using JSZip via CDN — we'll return all files as JSON for client-side zipping
    const files = {
      'resource_pack/manifest.json': JSON.stringify(resourceManifest, null, 2),
      'resource_pack/entity/' + id + '.entity.json': JSON.stringify(entityResource, null, 2),
      'resource_pack/models/entity/' + id + '.geo.json': JSON.stringify(geometry, null, 2),
      'resource_pack/textures/entity/' + id + '.png': texturePng,
      'behavior_pack/manifest.json': JSON.stringify(behaviorManifest, null, 2),
      'behavior_pack/entities/' + id + '.json': JSON.stringify(entityBehavior, null, 2)
    };

    res.status(200).json({ success: true, addon: parsed, files });

  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
}

function genUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
