const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_S_KEY);

// Where feedback notifications get sent
const NOTIFY_TO = 'jenna@myshoplight.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let message, email, userId;
  try {
    ({ message, email, userId } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request.' }) };
  }

  if (!message || !message.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Message is required.' }) };
  }

  // Basic guard against oversized submissions
  const safeMessage = String(message).slice(0, 5000);
  const fromEmail = email && String(email).trim() ? String(email).trim() : null;

  // Escape HTML so the message renders as text, not markup
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#2A2A2A;max-width:560px;">
      <h2 style="color:#0D5C5C;margin:0 0 4px;">New feedback from myshoplight</h2>
      <p style="color:#666;font-size:13px;margin:0 0 20px;">Someone just left a note through the app.</p>
      <div style="background:#F5F0E8;border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.6;white-space:pre-wrap;">${esc(safeMessage)}</div>
      <table style="margin-top:20px;font-size:13px;color:#666;border-collapse:collapse;">
        <tr><td style="padding:2px 12px 2px 0;">From</td><td>${fromEmail ? esc(fromEmail) : '<em>no email left</em>'}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;">User ID</td><td>${userId ? esc(userId) : '<em>not logged in</em>'}</td></tr>
      </table>
    </div>`;

  const textLines = [
    'New feedback from myshoplight',
    '',
    safeMessage,
    '',
    `From: ${fromEmail || 'no email left'}`,
    `User ID: ${userId || 'not logged in'}`,
  ];

  try {
    const payload = {
      from: 'myshoplight feedback <jenna@myshoplight.com>',
      to: NOTIFY_TO,
      subject: 'New feedback from myshoplight',
      html,
      text: textLines.join('\n'),
    };
    // Let Jenna reply straight to the person if they left an address
    if (fromEmail) {
      payload.replyTo = fromEmail;
    }

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      console.error('Resend error:', JSON.stringify(error));
      // Feedback is already saved in Supabase, so a failed email is non-fatal
      return { statusCode: 200, body: JSON.stringify({ saved: true, emailed: false }) };
    }

    console.log(`Feedback notification sent, id: ${data.id}`);
    return { statusCode: 200, body: JSON.stringify({ saved: true, emailed: true }) };

  } catch (err) {
    console.error('Failed to send feedback notification:', err);
    return { statusCode: 200, body: JSON.stringify({ saved: true, emailed: false }) };
  }
};
