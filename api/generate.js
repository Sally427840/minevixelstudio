function genUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    var body = req.body;
    var addonType = body.addonType || 'mob';
    var addonName = body.addonName || 'MyAddon';
    var description = body.description || '';
    var behavior = body.behavior || 'Passive';
    var photo = body.photo || null;

    var ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    if (!ANTHROPIC_KEY) {
      res.status(500).json({ error: 'API key not configured' });
      return;
    }

    var identifier = addonName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    var prompt = 'You are a Minecraft Bedrock addon expert.\n' +
      'Generate addon data for:\n' +
      'Type: ' + addonType + '\n' +
      'Name: ' + addonName + '\n' +
      'Description: ' + description + '\n' +
      'Behavior: ' + behavior + '\n\n' +
      'Respond ONLY with valid JSON, no markdown, no extra text:\n' +
      '{"addonName":"' + addonName + '","addonType":"' + addonType + '","identifier":"' + identifier + '","behavior":"' + behavior + '","description":"' + description + '","colors":["#5D8A3C","#4AEDD9","#FFD700","#8B5E3C","#f0f0f0"],"health":20,"attack":4,"speed":0.3,"size":"medium","lore":"A mysterious creature"}';

    var messages = [];
    if (photo) {
      try {
        var base64Data = photo.split(',')[1];
        var mediaType = photo.split(';')[0].split(':')[1];
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

    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: messages
      })
    });

    var data = await response.json();

    if (!response.ok) {
      res.status(500).json({ error: data.error ? data.error.message : 'Claude API error' });
      return;
    }

    var text = data.content[0].text;
    var clean = text.replace(/```json/g, '').replace(/```/g, '').trim();

    var parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      parsed = {
        addonName: addonName,
        addonType: addonType,
        identifier: identifier,
        behavior: behavior,
        description: description,
        colors: ['#5D8A3C', '#4AEDD9', '#FFD700', '#8B5E3C', '#f0f0f0'],
        health: 20,
        attack: 4,
        speed: 0.3,
        size: 'medium',
        lore: description
      };
    }

    var id = parsed.identifier || identifier;
    var uuid1 = genUUID();
    var uuid2 = genUUID();
    var uuid3 = genUUID();
    var uuid4 = genUUID();

    var isHostile = (behavior === 'Hostile' || behavior === 'Boss');
    var isCompanion = (behavior === 'Companion');
    var isNeutral = (behavior === 'Neutral');

    // Build entity components
    var components = {
      'minecraft:type_family': { family: ['mob', id] },
      'minecraft:health': { value: parsed.health || 20, max: parsed.health || 20 },
      'minecraft:movement': { value: parsed.speed || 0.25 },
      'minecraft:collision_box': { width: 0.9, height: 1.9 },
      'minecraft:nameable': {},
      'minecraft:physics': {},
      'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
      'minecraft:breathable': { total_supply: 15, suffocate_time: -1 },
      'minecraft:despawn': { despawn_from_distance: {} },
      'minecraft:navigation.walk': { can_path_over_water: true },
      'minecraft:movement.basic': {},
      'minecraft:jump.static': {},
      'minecraft:can_climb': {},
      'minecraft:behavior.random_stroll': { priority: 8, speed_multiplier: 0.8 },
      'minecraft:behavior.look_at_player': { priority: 9, look_distance: 6, probability: 0.02 },
      'minecraft:behavior.random_look_around': { priority: 10 }
    };

    if (isHostile) {
      components['minecraft:attack'] = { damage: parsed.attack || 4 };
      components['minecraft:targeting'] = {};
      components['minecraft:behavior.nearest_attackable_target'] = {
        priority: 2,
        must_see: true,
        reselect_targets: true,
        within_radius: 16,
        entity_types: [{
          filters: {
            all_of: [
              { test: 'is_family', subject: 'other', value: 'player' },
              { test: 'in_water', subject: 'other', operator: '!=', value: true }
            ]
          },
          max_dist: 16
        }]
      };
      components['minecraft:behavior.melee_attack'] = { priority: 3, speed_multiplier: 1.2, track_target: true };
      components['minecraft:behavior.hurt_by_target'] = { priority: 1 };
    }

    if (isCompanion) {
      components['minecraft:behavior.follow_owner'] = {
        priority: 3,
        speed_multiplier: 1.2,
        start_distance: 10,
        stop_distance: 2,
        can_teleport: true
      };
      components['minecraft:behavior.owner_hurt_by_target'] = { priority: 1 };
    }

    if (isNeutral) {
      components['minecraft:behavior.hurt_by_target'] = { priority: 1 };
      components['minecraft:behavior.melee_attack'] = { priority: 2, speed_multiplier: 1.0, track_target: true };
      components['minecraft:attack'] = { damage: parsed.attack || 3 };
    }

    // Resource pack files
    var resourceManifest = {
      format_version: 2,
      header: {
        name: addonName + ' Resource Pack',
        description: description,
        uuid: uuid1,
        version: [1, 0, 0],
        min_engine_version: [1, 20, 0]
      },
      modules: [{
        type: 'resources',
        uuid: uuid2,
        version: [1, 0, 0]
      }]
    };

    var entityResource = {
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'minevixel:' + id,
          materials: { default: 'entity_alphatest' },
          textures: { default: 'textures/entity/' + id },
          geometry: { default: 'geometry.' + id },
          animations: {
            walk: 'animation.' + id + '.walk',
            idle: 'animation.' + id + '.idle'
          },
          scripts: {
            animate: [{ walk: 'query.modified_move_speed' }, 'idle']
          },
          render_controllers: ['controller.render.default']
        }
      }
    };

    var geometry = {
      format_version: '1.12.0',
      'minecraft:geometry': [{
        description: {
          identifier: 'geometry.' + id,
          texture_width: 64,
          texture_height: 64,
          visible_bounds_width: 2,
          visible_bounds_height: 2.5,
          visible_bounds_offset: [0, 1.25, 0]
        },
        bones: [
          {
            name: 'body',
            pivot: [0, 12, 0],
            cubes: [{ origin: [-6, 7, -4], size: [12, 8, 8], uv: [0, 16] }]
          },
          {
            name: 'head',
            parent: 'body',
            pivot: [0, 15, 0],
            cubes: [{ origin: [-4, 15, -4], size: [8, 8, 8], uv: [0, 0] }]
          },
          {
            name: 'leg0',
            parent: 'body',
            pivot: [-2, 7, 2],
            cubes: [{ origin: [-4, 0, 0], size: [4, 7, 4], uv: [0, 32] }]
          },
          {
            name: 'leg1',
            parent: 'body',
            pivot: [2, 7, 2],
            cubes: [{ origin: [0, 0, 0], size: [4, 7, 4], uv: [0, 32] }]
          },
          {
            name: 'leg2',
            parent: 'body',
            pivot: [-2, 7, -2],
            cubes: [{ origin: [-4, 0, -4], size: [4, 7, 4], uv: [0, 32] }]
          },
          {
            name: 'leg3',
            parent: 'body',
            pivot: [2, 7, -2],
            cubes: [{ origin: [0, 0, -4], size: [4, 7, 4], uv: [0, 32] }]
          }
        ]
      }]
    };

    var animations = {
      format_version: '1.8.0',
      animations: {}
    };
    animations.animations['animation.' + id + '.walk'] = {
      loop: true,
      animation_length: 1,
      bones: {
        leg0: { rotation: ['math.sin(query.anim_time * 360) * 30', 0, 0] },
        leg1: { rotation: ['math.sin(query.anim_time * 360 + 180) * 30', 0, 0] },
        leg2: { rotation: ['math.sin(query.anim_time * 360 + 180) * 30', 0, 0] },
        leg3: { rotation: ['math.sin(query.anim_time * 360) * 30', 0, 0] }
      }
    };
    animations.animations['animation.' + id + '.idle'] = {
      loop: true,
      animation_length: 2,
      bones: {
        head: { rotation: [0, 'math.sin(query.anim_time * 180) * 5', 0] }
      }
    };

    // Simple colored texture (16x16 PNG base64 - green placeholder)
    var texturePng = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAABDQAABO8B4b4AAABkSURBVHic7dAxAQAADMKg+TfdycgLGrhFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgbQMAAP//AwABAAD/AAABAAAAAAAAAAAAAAAAAAAAAAAASQAA//8DAAECAP8AAAMAAAAAAAAAAAAAAAAAAAAA8AMAAP//AwABAgD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASQAA//8DAAEC';

    // Behavior pack files
    var behaviorManifest = {
      format_version: 2,
      header: {
        name: addonName + ' Behavior Pack',
        description: description,
        uuid: uuid3,
        version: [1, 0, 0],
        min_engine_version: [1, 20, 0]
      },
      modules: [{
        type: 'data',
        uuid: uuid4,
        version: [1, 0, 0]
      }],
      dependencies: [{
        uuid: uuid1,
        version: [1, 0, 0]
      }]
    };

    var entityBehavior = {
      format_version: '1.18.0',
      'minecraft:entity': {
        description: {
          identifier: 'minevixel:' + id,
          is_spawnable: true,
          is_summonable: true,
          is_experimental: false
        },
        component_groups: {},
        components: components,
        events: {}
      }
    };

    // Spawn rules
    var spawnRules = {
      format_version: '1.8.0',
      'minecraft:spawn_rules': {
        description: {
          identifier: 'minevixel:' + id,
          population_control: 'monster'
        },
        conditions: [{
          minecraft_herd: { min_size: 1, max_size: 3 },
          minecraft_spawns_on_surface: {},
          minecraft_brightness_filter: { min: 0, max: 7, adjust_for_weather: true },
          minecraft_difficulty_filter: { min: 'easy', max: 'hard' },
          minecraft_weight: { default: 100 }
        }]
      }
    };

    var files = {};
    files['resource_pack/manifest.json'] = JSON.stringify(resourceManifest, null, 2);
    files['resource_pack/entity/' + id + '.entity.json'] = JSON.stringify(entityResource, null, 2);
    files['resource_pack/models/entity/' + id + '.geo.json'] = JSON.stringify(geometry, null, 2);
    files['resource_pack/animations/' + id + '.animation.json'] = JSON.stringify(animations, null, 2);
    files['resource_pack/textures/entity/' + id + '.png'] = texturePng;
    files['behavior_pack/manifest.json'] = JSON.stringify(behaviorManifest, null, 2);
    files['behavior_pack/entities/' + id + '.json'] = JSON.stringify(entityBehavior, null, 2);
    files['behavior_pack/spawn_rules/' + id + '.json'] = JSON.stringify(spawnRules, null, 2);

    res.status(200).json({ success: true, addon: parsed, files: files });

  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
