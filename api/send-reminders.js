// api/send-reminders.js
// Vercel Cron: runs daily at 11:00 UTC (8:00 AM Argentina)
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

const SB_URL = 'https://ewxbghnyjvaijpfiygqg.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eGJnaG55anZhaWpwZml5Z3FnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTgxNTEsImV4cCI6MjA4ODM5NDE1MX0.tySNpML47ViQQ_Xh3Eaj1Dslt17oLZKEiWL0hLNdp4M';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'tp@sayhueque.com',
    pass: 'jmjy tqwi xppd huyx',
  },
});

function replacePlaceholders(text, variables) {
  let result = text;
  for (const key in variables) {
    const placeholder = '{{' + key + '}}';
    const value = String(variables[key] || '');
    while (result.includes(placeholder)) {
      result = result.replace(placeholder, value);
    }
  }
  return result;
}

export default async function handler(req, res) {
  // Allow Vercel cron (GET) and manual trigger (POST)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Security: only allow Vercel cron or requests with secret
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Also allow Vercel cron calls (they don't send auth header but come from Vercel infra)
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    if (!isVercelCron) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const supabase = createClient(SB_URL, SB_KEY);
  const results = { sent: 0, skipped: 0, errors: [] };

  try {
    // Get tomorrow's date in Argentina time (UTC-3)
    const nowUTC = new Date();
    const nowAR = new Date(nowUTC.getTime() - 3 * 60 * 60 * 1000);
    const tomorrow = new Date(nowAR);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    console.log(`🔔 Sending reminders for: ${tomorrowStr}`);

    // Get all confirmed events for tomorrow with their guide
    const { data: eventos, error: evError } = await supabase
      .from('eventos')
      .select('*, guias(*), files(*)')
      .eq('fecha', tomorrowStr)
      .eq('estado', 'CONFIRMADO')
      .not('guia_id', 'is', null);

    if (evError) throw new Error(`Error fetching eventos: ${evError.message}`);
    if (!eventos?.length) {
      console.log('✅ No events tomorrow, nothing to send.');
      return res.status(200).json({ ...results, message: 'No events tomorrow' });
    }

    // Get the reminder template
    const { data: template, error: tmplError } = await supabase
      .from('email_templates')
      .select('html, subject')
      .eq('id', 'recordatorio_evento')
      .single();

    if (tmplError || !template) throw new Error('Template recordatorio_evento not found');

    // Check which reminders already sent today (avoid duplicates on re-runs)
    const { data: yaEnviados } = await supabase
      .from('historial')
      .select('evento_id')
      .eq('accion', 'RECORDATORIO_ENVIADO')
      .gte('created_at', nowAR.toISOString().slice(0, 10) + 'T00:00:00Z');

    const yaEnviadosSet = new Set((yaEnviados || []).map(h => h.evento_id));

    for (const evento of eventos) {
      if (yaEnviadosSet.has(evento.id)) {
        results.skipped++;
        console.log(`⏭ Already sent reminder for evento ${evento.id}`);
        continue;
      }

      const guia = evento.guias;
      const file = evento.files;

      if (!guia?.email) {
        results.skipped++;
        continue;
      }

      const fechaStr = new Date(evento.fecha + 'T12:00:00').toLocaleDateString('es-AR', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
      });
      const horario = (evento.hora_inicio || '') + (evento.hora_fin ? ' – ' + evento.hora_fin : '');

      const variables = {
        guia_nombre: guia.nombre + ' ' + guia.apellido,
        tipo_evento: evento.tipo_evento || '—',
        fecha: fechaStr,
        horario: horario || '—',
        nro_file: file?.nro_file || evento.nro_file || '—',
        operador: file?.operador_nombre || '—',
        pickup_location: evento.pickup_location || '—',
        dropoff_location: evento.dropoff_location || '—',
        datos_vuelos: evento.datos_vuelos || '—',
        descripcion: evento.descripcion || '—',
        link_adjunto: evento.link_adjunto || '',
      };

      const html = replacePlaceholders(template.html, variables);
      const subject = replacePlaceholders(template.subject, variables);

      try {
        await transporter.sendMail({
          from: 'Say Hueque <tp@sayhueque.com>',
          to: guia.email,
          subject,
          html,
        });

        // Log in historial
        await supabase.from('historial').insert({
          evento_id: evento.id,
          guia_id: guia.id,
          accion: 'RECORDATORIO_ENVIADO',
          actor: 'SISTEMA',
          detalle: `Recordatorio 24hs enviado a ${guia.email}`,
        });

        results.sent++;
        console.log(`✅ Reminder sent to ${guia.email} for evento ${evento.id}`);
      } catch (mailErr) {
        results.errors.push({ evento_id: evento.id, email: guia.email, error: mailErr.message });
        console.error(`❌ Error sending to ${guia.email}:`, mailErr.message);
      }
    }

    console.log(`📊 Results: ${results.sent} sent, ${results.skipped} skipped, ${results.errors.length} errors`);
    return res.status(200).json({ success: true, date: tomorrowStr, ...results });

  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
