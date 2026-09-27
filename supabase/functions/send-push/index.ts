// send-push — web push for WoRxshift.
//
// Secrets required: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//
// Who may send what:
//   managers -> any title/body, to specific people or to every active,
//               approved user
//   floaters -> only kind 'timeoff_request', only to managers, and only when
//               they filed a pending request in the last 10 minutes. The
//               wording and dates come from the database, not the caller.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import webpush from 'https://esm.sh/web-push@3.6.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function fmtDate(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Not signed in' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const asCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await asCaller.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: me } = await admin
      .from('profiles')
      .select('id, full_name, role, approved, active, is_floater')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (!me || !me.approved || !me.active) return json({ error: 'Not allowed' }, 403);

    const payloadIn = await req.json().catch(() => ({}));
    const kind = payloadIn.kind ?? 'manager';

    let targetIds: string[] = [];
    let title = '';
    let body = '';

    if (me.role === 'manager' && kind !== 'timeoff_request') {
      title = String(payloadIn.title ?? '').slice(0, 80);
      body = String(payloadIn.body ?? '').slice(0, 240);
      if (!title || !body) return json({ error: 'Missing title or body' }, 400);

      if (Array.isArray(payloadIn.user_ids) && payloadIn.user_ids.length > 0) {
        targetIds = payloadIn.user_ids.map(String);
      } else {
        const { data: everyone } = await admin
          .from('profiles')
          .select('id')
          .eq('active', true)
          .eq('approved', true);
        targetIds = (everyone ?? []).map((p) => p.id);
      }
    } else if (kind === 'timeoff_request' && me.is_floater) {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: recent } = await admin
        .from('time_off')
        .select('start_date, end_date')
        .eq('user_id', me.id)
        .eq('status', 'pending')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1);

      const reqRow = recent?.[0];
      if (!reqRow) return json({ error: 'No recent request' }, 400);

      const dates =
        reqRow.start_date === reqRow.end_date
          ? fmtDate(reqRow.start_date)
          : `${fmtDate(reqRow.start_date)} to ${fmtDate(reqRow.end_date)}`;

      title = 'Time off request';
      body = `${me.full_name} asked for time off — ${dates}.`;

      const { data: managers } = await admin
        .from('profiles')
        .select('id')
        .eq('role', 'manager')
        .eq('active', true)
        .eq('approved', true);
      targetIds = (managers ?? []).map((m) => m.id);
    } else {
      return json({ error: 'Not allowed' }, 403);
    }

    if (targetIds.length === 0) return json({ ok: true, sent: 0 });

    const { data: subs, error: subErr } = await admin
      .from('push_subscriptions')
      .select('*')
      .in('user_id', targetIds);

    if (subErr) {
      console.error('subscription lookup failed', subErr.message);
      return json({ error: 'Lookup failed' }, 500);
    }
    if (!subs || subs.length === 0) return json({ ok: true, sent: 0, note: 'No devices registered' });

    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!vapidPublic || !vapidPrivate) {
      console.error('VAPID secrets are not set');
      return json({ error: 'Notifications are not configured' }, 500);
    }

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
      vapidPublic,
      vapidPrivate
    );

    const payload = JSON.stringify({ title, body, url: '/' });
    let sent = 0;
    let failed = 0;
    const dead: string[] = [];

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) dead.push(sub.endpoint);
        else {
          failed++;
          console.error('push failed', code, (err as Error)?.message);
        }
      }
    }

    if (dead.length > 0) {
      const { error: delErr } = await admin.from('push_subscriptions').delete().in('endpoint', dead);
      if (delErr) console.error('cleanup failed', delErr.message);
    }

    return json({ ok: failed === 0, sent, failed, cleaned: dead.length });
  } catch (err) {
    console.error(err);
    return json({ error: 'Something went wrong' }, 500);
  }
});
