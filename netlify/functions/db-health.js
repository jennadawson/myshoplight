// netlify/functions/db-health.js
//
// Honest database health check + keep-alive for myshoplight.
//
// WHY THIS EXISTS
// The original watchdog pinged the Supabase REST root and treated any response
// as "up". A paused Supabase project still responds -- it just responds with a
// pause notice -- so during the Aug 2026 outage the watchdog reported healthy
// every morning while buyers were being charged and getting nothing.
//
// This endpoint does something a broken database cannot fake: it runs a real
// authenticated query against Postgres. If the database is paused, unreachable,
// or erroring, this returns 503 and the watchdog sees it.
//
// It returns NO customer data -- only up/down and latency.
//
// Deploy: save as netlify/functions/db-health.js, commit, push.
// Verify: https://myshoplight.com/.netlify/functions/db-health
//         -> {"ok":true,"db":"up","ms":42}

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://cwcibkvoclsdqdmglhiy.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_S_SERVICE_KEY;

// Fail the check rather than hang. Netlify's own ceiling is ~10s.
const TIMEOUT_MS = 8000;

const HEADERS = {
  'Content-Type': 'application/json',
  // Never let a CDN or browser serve a stale "up" for a database that just died.
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
};

exports.handler = async function () {
  const started = Date.now();

  if (!SERVICE_KEY) {
    return {
      statusCode: 503,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        db: 'down',
        error: 'SUPABASE_S_SERVICE_KEY is not set in the environment',
        ms: Date.now() - started,
      }),
    };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // A real query against a real table. head:true means we get the count
    // without transferring any rows -- enough to prove Postgres answered,
    // and enough traffic to reset the free-tier inactivity clock.
    const query = supabase
      .from('user_entitlements')
      .select('*', { count: 'exact', head: true });

    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timed out after ${TIMEOUT_MS}ms`)),
        TIMEOUT_MS
      )
    );

    const { error, count } = await Promise.race([query, timeout]);
    const ms = Date.now() - started;

    if (error) {
      return {
        statusCode: 503,
        headers: HEADERS,
        body: JSON.stringify({
          ok: false,
          db: 'down',
          error: error.message || String(error),
          ms,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: true,
        db: 'up',
        ms,
        // Row count only -- no customer data. Handy sanity signal: if this
        // ever reads 0, something is wrong beyond mere reachability.
        entitlements: typeof count === 'number' ? count : null,
      }),
    };
  } catch (err) {
    return {
      statusCode: 503,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        db: 'down',
        error: err && err.message ? err.message : String(err),
        ms: Date.now() - started,
      }),
    };
  }
};
