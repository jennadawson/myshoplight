const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://cwcibkvoclsdqdmglhiy.supabase.co',
  process.env.SUPABASE_S_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let email, password;
  try {
    ({ email, password } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request.' }) };
  }

  if (!email || !password) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email and password are required.' }) };
  }

  if (password.length < 6) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Password must be at least 6 characters.' }) };
  }

  try {
    // Look up user by email
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;

    const user = users?.find(u => u.email === email);

    if (!user) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No account found for that email.' }) };
    }

    // Guard: only allow if account has no password set yet
    if (user.encrypted_password && user.encrypted_password !== '') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Password already set. Log in or use forgot password.' }) };
    }

    // Set password via admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (updateError) throw updateError;

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('set-password error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Try again.' }) };
  }
};
