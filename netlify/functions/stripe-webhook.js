const stripe = require('stripe')(process.env.STRIPE_S_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://cwcibkvoclsdqdmglhiy.supabase.co',
  process.env.SUPABASE_S_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_S_WEBHOOK
    );
  } catch (err) {
    console.error('Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Event ignored' };
  }

  const session = stripeEvent.data.object;
  const email = session.customer_details?.email;

  if (!email) {
    console.error('No email in session:', session.id);
    return { statusCode: 400, body: 'No email found' };
  }

  console.log(`Processing purchase for: ${email}`);

  try {
    // 1. Find or create Supabase user
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const existingUser = users?.find(u => u.email === email);

    let userId;

    if (existingUser) {
      userId = existingUser.id;
      console.log(`Existing user found: ${userId}`);
    } else {
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
      });

      if (createError) {
        console.error('Failed to create user:', createError);
        return { statusCode: 500, body: 'Failed to create user' };
      }

      userId = newUser.user.id;
      console.log(`New user created: ${userId}`);
    }

    // 2. Write entitlement (skip if already exists)
    const { data: existing } = await supabase
      .from('user_entitlements')
      .select('id')
      .eq('user_id', userId)
      .eq('type', 'lifetime')
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`Entitlement already exists for ${email} — skipping`);
    } else {
      const { error: entitlementError } = await supabase
        .from('user_entitlements')
        .insert({
          user_id: userId,
          type: 'lifetime',
          granted_at: new Date().toISOString(),
        });

      if (entitlementError) {
        console.error('Failed to write entitlement:', entitlementError);
        return { statusCode: 500, body: 'Failed to write entitlement' };
      }

      console.log(`Entitlement written for: ${email}`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('Webhook error:', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
