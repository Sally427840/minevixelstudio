var STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

var PRICE_IDS = {
  creator: 'price_1U6lC22YSbwpjbjUXjBEU7Mg',
  pro: 'price_1U6lDQ2YSbwpjbjU7IAR1xky',
  credits: 'price_1U6lFZ2YSbwpjbjUEJs5rAPn'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    var body = req.body;
    var plan = body.plan;
    var userId = body.userId;
    var userEmail = body.userEmail;

    if (!plan || !PRICE_IDS[plan]) {
      res.status(400).json({ error: 'Invalid plan selected' });
      return;
    }

    if (!STRIPE_SECRET_KEY) {
      res.status(500).json({ error: 'Stripe not configured' });
      return;
    }

    var priceId = PRICE_IDS[plan];
    var isSubscription = plan !== 'credits';
    var baseUrl = req.headers.origin || 'https://addonstudio.vercel.app';

    var sessionBody = {
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: isSubscription ? 'subscription' : 'payment',
      success_url: baseUrl + '/success.html?plan=' + plan + '&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: baseUrl + '/pricing.html',
      metadata: { userId: userId || '', plan: plan }
    };

    if (userEmail) sessionBody.customer_email = userEmail;

    var response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: encodeFormData(sessionBody)
    });

    var data = await response.json();
    if (!response.ok) { res.status(500).json({ error: data.error ? data.error.message : 'Stripe error' }); return; }
    res.status(200).json({ url: data.url, sessionId: data.id });

  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
}

function encodeFormData(obj, prefix) {
  var parts = [];
  for (var key in obj) {
    if (!obj.hasOwnProperty(key)) continue;
    var fullKey = prefix ? prefix + '[' + key + ']' : key;
    var val = obj[key];
    if (Array.isArray(val)) {
      val.forEach(function(item, i) {
        if (typeof item === 'object') {
          parts.push(encodeFormData(item, fullKey + '[' + i + ']'));
        } else {
          parts.push(encodeURIComponent(fullKey + '[' + i + ']') + '=' + encodeURIComponent(item));
        }
      });
    } else if (typeof val === 'object' && val !== null) {
      parts.push(encodeFormData(val, fullKey));
    } else {
      parts.push(encodeURIComponent(fullKey) + '=' + encodeURIComponent(val));
    }
  }
  return parts.join('&');
}
