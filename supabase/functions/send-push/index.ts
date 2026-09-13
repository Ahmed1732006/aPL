// Supabase Edge Function: send-push
//
// Sends a real Android push notification (a normal phone notification,
// even while the app is fully closed) via Firebase Cloud Messaging (FCM),
// to every device subscribed to the "all_users" topic.
//
// The app already subscribes every device to that topic automatically
// once push permission is granted (see app/index.html).
//
// SETUP (one time):
// 1. Firebase Console -> gear icon -> Project settings -> Service accounts
//    -> "Generate new private key". This downloads a JSON file that is
//    DIFFERENT from google-services.json - it contains a private key and
//    must stay secret.
// 2. Set it as a secret on this function (from your machine, with the
//    Supabase CLI logged in and linked to this project):
//      supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
// 3. Deploy: supabase functions deploy send-push
// 4. Call it (from a Database Webhook on insert into notif_center, or
//    directly from admin-manager.html) with a POST body like:
//      { "title": "عنوان الإشعار", "body": "نص الإشعار", "url": "app/index.html?openNotifCenter=1" }
//
// This function is intentionally simple: it always broadcasts to the
// "all_users" topic. Per-user targeting can be added later by looking up
// tokens in the device_push_tokens table instead of using a topic.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const FCM_PROJECT_ID = 'in-the-void-aebd7';

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(serviceAccount: any): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(new Uint8Array(signature))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

serve(async (req) => {
  try {
    const serviceAccountRaw = Deno.env.get('FCM_SERVICE_ACCOUNT');
    if (!serviceAccountRaw) {
      return new Response(JSON.stringify({ error: 'FCM_SERVICE_ACCOUNT secret not set' }), { status: 500 });
    }
    const serviceAccount = JSON.parse(serviceAccountRaw);

    const body = await req.json().catch(() => ({}));
    const title = String(body.title || 'IN THE VOID');
    const text = String(body.body || '');
    const url = String(body.url || 'app/index.html?openNotifCenter=1');
    const topic = String(body.topic || 'all_users');

    const accessToken = await getAccessToken(serviceAccount);

    const fcmRes = await fetch(
      `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            topic,
            notification: { title, body: text },
            data: { url },
            android: { priority: 'high' },
          },
        }),
      }
    );
    const fcmData = await fcmRes.json();
    if (!fcmRes.ok) {
      return new Response(JSON.stringify({ error: fcmData }), { status: 502 });
    }
    return new Response(JSON.stringify({ ok: true, fcm: fcmData }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
