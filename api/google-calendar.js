// api/google-calendar.js
// Syncs events to Google Calendar for guides who have connected their account.
// Actions: create | update | delete
import { createClient } from '@supabase/supabase-js';

const SB_URL = 'https://ewxbghnyjvaijpfiygqg.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eGJnaG55anZhaWpwZml5Z3FnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTgxNTEsImV4cCI6MjA4ODM5NDE1MX0.tySNpML47ViQQ_Xh3Eaj1Dslt17oLZKEiWL0hLNdp4M';

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '222183577921-bhnsc85tl25rb7d779mi0anqk28j2ngf.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';

async function getAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Could not refresh access token: ' + JSON.stringify(data));
  return data.access_token;
}

function buildGCalEvent(evento, file) {
  const dateStr = evento.fecha; // YYYY-MM-DD
  const toDateTime = (date, time) => {
    if (!time) return null;
    const t = time.slice(0, 5); // HH:MM
    return `${date}T${t}:00-03:00`; // Argentina UTC-3
  };

  const start = toDateTime(dateStr, evento.hora_inicio) || `${dateStr}`;
  const end   = toDateTime(dateStr, evento.hora_fin || evento.hora_inicio) || `${dateStr}`;
  const isAllDay = !evento.hora_inicio;

  const nroFile = file?.nro_file || evento.nro_file || '';
  const title = `[${nroFile}] ${evento.tipo_evento || 'Evento Say Hueque'}`;

  let description = `Say Hueque · Evento confirmado\n`;
  if (nroFile)                description += `\n📁 File: ${nroFile}`;
  if (file?.operador_nombre)  description += `\n🏢 Operador: ${file.operador_nombre}`;
  if (evento.pickup_location) description += `\n📍 Pick Up: ${evento.pickup_location}`;
  if (evento.dropoff_location)description += `\n📍 Drop Off: ${evento.dropoff_location}`;
  if (evento.datos_vuelos)    description += `\n✈️ Vuelos: ${evento.datos_vuelos}`;
  if (evento.descripcion)     description += `\n📝 ${evento.descripcion}`;
  if (evento.link_adjunto)    description += `\n🔗 ${evento.link_adjunto}`;

  if (isAllDay) {
    return {
      summary: title,
      description,
      start: { date: dateStr },
      end:   { date: dateStr },
      colorId: '2', // sage green
    };
  }

  return {
    summary: title,
    description,
    start: { dateTime: start, timeZone: 'America/Argentina/Buenos_Aires' },
    end:   { dateTime: end,   timeZone: 'America/Argentina/Buenos_Aires' },
    colorId: '2',
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'email', minutes: 1440 }, // 24hs
      ],
    },
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action, eventoId, guiaId } = req.body;
    // action: 'create' | 'update' | 'delete'

    if (!action || !eventoId || !guiaId) {
      return res.status(400).json({ error: 'Missing action, eventoId or guiaId' });
    }

    const supabase = createClient(SB_URL, SB_KEY);

    // Fetch guia to get refresh token
    const { data: guia } = await supabase
      .from('guias')
      .select('id, nombre, apellido, google_refresh_token, google_calendar_event_ids')
      .eq('id', guiaId)
      .single();

    if (!guia?.google_refresh_token) {
      // Guide hasn't connected Google Calendar — silently skip
      return res.status(200).json({ success: true, skipped: true, reason: 'no_token' });
    }

    const accessToken = await getAccessToken(guia.google_refresh_token);

    // Parse stored event IDs map: { eventoId: gcalEventId }
    const calIds = guia.google_calendar_event_ids || {};

    if (action === 'delete') {
      const gcalId = calIds[String(eventoId)];
      if (gcalId) {
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${gcalId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        delete calIds[String(eventoId)];
        await supabase.from('guias').update({ google_calendar_event_ids: calIds }).eq('id', guiaId);
      }
      return res.status(200).json({ success: true, action: 'deleted' });
    }

    // Fetch evento + file for create/update
    const { data: evento } = await supabase
      .from('eventos')
      .select('*')
      .eq('id', eventoId)
      .single();

    if (!evento) return res.status(404).json({ error: 'Evento not found' });

    const { data: file } = evento.file_id
      ? await supabase.from('files').select('*').eq('id', evento.file_id).maybeSingle()
      : { data: null };

    const gcalEvent = buildGCalEvent(evento, file);
    const existingGcalId = calIds[String(eventoId)];

    let gcalResponse, gcalData;

    if (action === 'update' && existingGcalId) {
      // Update existing event
      gcalResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingGcalId}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(gcalEvent),
        }
      );
    } else {
      // Create new event
      gcalResponse = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(gcalEvent),
        }
      );
    }

    gcalData = await gcalResponse.json();

    if (!gcalResponse.ok) {
      console.error('Google Calendar API error:', gcalData);
      return res.status(500).json({ success: false, error: gcalData.error?.message });
    }

    // Save the Google Calendar event ID
    calIds[String(eventoId)] = gcalData.id;
    await supabase
      .from('guias')
      .update({ google_calendar_event_ids: calIds })
      .eq('id', guiaId);

    console.log(`✅ GCal ${action} for guia ${guiaId}, evento ${eventoId}: ${gcalData.id}`);
    return res.status(200).json({ success: true, action, gcalId: gcalData.id });

  } catch (err) {
    console.error('google-calendar error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
