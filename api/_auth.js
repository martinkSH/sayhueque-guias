// api/_auth.js — shared auth helper for /api/* endpoints.
// Verifies the caller is a logged-in Supabase user by validating the
// access_token they pass as `Authorization: Bearer <token>`.
import { createClient } from '@supabase/supabase-js';

const SB_URL = 'https://ewxbghnyjvaijpfiygqg.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eGJnaG55anZhaWpwZml5Z3FnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTgxNTEsImV4cCI6MjA4ODM5NDE1MX0.tySNpML47ViQQ_Xh3Eaj1Dslt17oLZKEiWL0hLNdp4M';

// Returns the Supabase user if the request carries a valid access_token,
// otherwise sends 401 and returns null.
export async function requireAuth(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return null;
  }
  const supabase = createClient(SB_URL, SB_KEY);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: 'Invalid token' });
    return null;
  }
  return data.user;
}
