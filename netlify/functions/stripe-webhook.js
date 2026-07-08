const stripe = require('stripe')(process.env.STRIPE_S_KEY);
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

// Supabase admin client — bypasses RLS, server-side only
const supabase = createClient(
  'https://cwcibkvoclsdqdmglhiy.supabase.co',
  process.env.SUPABASE_S_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_S_KEY);

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Verify the webhook came from Stripe
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }

  // Only process completed checkouts
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Event ignored' };
  }

  const session = stripeEvent.data.object;
  const email = session.customer_details?.email;

  if (!email) {
    console.error('No email in session:', session.id);
    return { statusCode: 400, body: 'No email found in session' };
  }

  console.log(`Processing purchase for: ${email}`);

  try {
    // 1. Check if user already exists in Supabase
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === email);

    let userId;

    if (existingUser) {
      // User already exists (e.g. existing Etsy buyer) — just use their ID
      userId = existingUser.id;
      console.log(`Existing user found: ${userId}`);
    } else {
      // New user — create their account and send invite email
      // The invite email contains a link to signup.html where they set their password
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true, // mark email as confirmed so they don't get a separate confirmation
      });

      if (createError) {
        console.error('Failed to create user:', createError);
        return { statusCode: 500, body: 'Failed to create user' };
      }

      userId = newUser.user.id;
      console.log(`New user created: ${userId}`);

      // Generate invite link pointing to signup.html
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'invite',
        email,
        options: {
          redirectTo: `${process.env.SITE_URL}/signup.html`,
        },
      });

      if (linkError) {
        console.error('Failed to generate invite link:', linkError);
        // Don't return — still write entitlement, just send fallback email
      }

      // Send branded welcome email via Resend
      const inviteUrl = linkData?.properties?.action_link || `${process.env.SITE_URL}/signup.html`;

      await resend.emails.send({
        from: 'myshoplight <hello@myshoplight.com>',
        to: email,
        subject: 'Set up your myshoplight account',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8"/>
            <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
          </head>
          <body style="margin:0;padding:0;background:#F5F0E8;font-family:'Source Sans 3',system-ui,sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;padding:40px 20px;">
              <tr><td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

                  <!-- Header -->
                  <tr>
                    <td style="background:#0D5C5C;border-radius:12px 12px 0 0;padding:24px 32px;">
                      <span style="font-family:sans-serif;font-size:20px;letter-spacing:-0.02em;">
                        <span style="color:rgba(255,255,255,0.45);font-weight:400;">my</span><span style="color:#4DD4A0;font-weight:700;">shop</span><span style="color:#fff;font-weight:700;">light</span>
                      </span>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="background:#ffffff;padding:36px 32px;">
                      <h1 style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#0D5C5C;margin:0 0 12px;">Your account is ready.</h1>
                      <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 8px;">Thanks for purchasing myshoplight. Click below to set your password and access your dashboard.</p>
                      <p style="font-size:13px;color:#666;line-height:1.6;margin:0 0 28px;">After setting your password you can log in from any device at myshoplight.com.</p>

                      <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                        <tr>
                          <td style="background:#0D5C5C;border-radius:8px;padding:14px 28px;">
                            <a href="${inviteUrl}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;font-family:sans-serif;">Set my password</a>
                          </td>
                        </tr>
                      </table>

                      <p style="font-size:13px;color:#666;line-height:1.6;margin:0 0 4px;"><strong style="color:#2A2A2A;">What's next:</strong></p>
                      <ol style="font-size:13px;color:#666;line-height:1.8;margin:0 0 24px;padding-left:18px;">
                        <li>Set your password using the button above</li>
                        <li>Request your Amazon order history from Amazon's privacy portal</li>
                        <li>Upload your file from a desktop browser to see your full spending breakdown</li>
                      </ol>

                      <div style="background:#FBF0EB;border-left:3px solid #E0977A;border-radius:0 8px 8px 0;padding:14px 16px;">
                        <p style="font-size:13px;color:#2A2A2A;margin:0 0 4px;"><strong>Important: Amazon requires a confirmation step.</strong></p>
                        <p style="font-size:12px;color:#666;margin:0;line-height:1.6;">After requesting your data, look for an email with subject <strong>"Your Data Request Confirmation"</strong> from Amazon and click the button inside — without it, your data file won't be sent.</p>
                      </div>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#EDE8DC;border-radius:0 0 12px 12px;padding:18px 32px;text-align:center;">
                      <p style="font-size:11px;color:#888;margin:0;">Questions? <a href="mailto:help@myshoplight.com" style="color:#0D5C5C;">help@myshoplight.com</a> &nbsp;·&nbsp; <a href="https://myshoplight.com/privacy" style="color:#888;">Privacy</a></p>
                      <p style="font-size:11px;color:#aaa;margin:6px 0 0;">&copy; 2026 Caliet Ventures LLC</p>
                    </td>
                  </tr>

                </table>
              </td></tr>
            </table>
          </body>
          </html>
        `,
      });

      console.log(`Welcome email sent to: ${email}`);
    }

    // 2. Write entitlement record
    // Check first to avoid duplicates (e.g. if Stripe fires the webhook twice)
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
          // No license_key_id — this is a direct Stripe purchase
        });

      if (entitlementError) {
        console.error('Failed to write entitlement:', entitlementError);
        return { statusCode: 500, body: 'Failed to write entitlement' };
      }

      console.log(`Entitlement written for: ${email}`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('Webhook handler error:', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
