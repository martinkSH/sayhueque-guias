// api/google-callback.js
// Handles the OAuth2 redirect from Google after user grants Calendar access
import { createClient } from '@supabase/supabase-js';

const SB_URL = 'https://ewxbghnyjvaijpfiygqg.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eGJnaG55anZhaWpwZml5Z3FnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTgxNTEsImV4cCI6MjA4ODM5NDE1MX0.tySNpML47ViQQ_Xh3Eaj1Dslt17oLZKEiWL0hLNdp4M';

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const APP_URL              = 'https://sayhueque-guias.vercel.app';
const REDIRECT_URI         = `${APP_URL}/api/google-callback`;

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    console.error('Google OAuth error:', error);
    return res.redirect(`${APP_URL}?gcal=error&reason=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect(`${APP_URL}?gcal=error&reason=missing_params`);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokens.refresh_token) {
      console.error('No refresh_token in response:', tokens);
      return res.redirect(`${APP_URL}?gcal=error&reason=no_refresh_token`);
    }

    // state = guiaId
    const guiaId = parseInt(state);
    const supabase = createClient(SB_URL, SB_KEY);

    const { error: dbError } = await supabase
      .from('guias')
      .update({ google_refresh_token: tokens.refresh_token })
      .eq('id', guiaId);

    if (dbError) {
      console.error('DB error saving token:', dbError);
      return res.redirect(`${APP_URL}?gcal=error&reason=db_error`);
    }

    console.log(`✅ Google Calendar connected for guia ${guiaId}`);
    return res.redirect(`${APP_URL}?gcal=success`);

  } catch (err) {
    console.error('Callback error:', err);
    return res.redirect(`${APP_URL}?gcal=error&reason=${encodeURIComponent(err.message)}`);
  }
}
