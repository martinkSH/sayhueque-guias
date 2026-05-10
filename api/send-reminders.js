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
    user: process.env.GMAIL_USER || 'tp@sayhueque.com',
    pass: process.env.GMAIL_PASS,
  },
});

function replacePlaceholders(text, variables) {
  let result = text;
  for (const key in variables) {
    const placeholder = '{{' + key + '}}';
    const value = String(variables[key] ?? '');
    result = result.split(placeholder).join(value);
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

    // ── Reconfirmation requests ──────────────────────────────────────────
    // 7 days out: send reconf request to guide
    // 48h out: send urgent alert to guide AND admin

    const in7days = new Date(nowAR); in7days.setDate(in7days.getDate() + 7);
    const in7Str = in7days.toISOString().slice(0, 10);
    const in2days = new Date(nowAR); in2days.setDate(in2days.getDate() + 2);
    const in2Str = in2days.toISOString().slice(0, 10);

    // Fetch admin email
    const { data: adminEmailCfg } = await supabase.from('config').select('value').eq('key','email_notificaciones_admin').single();
    const adminEmail = adminEmailCfg?.value?.trim();

    // Reconf request at 7 days
    const { data: ev7 } = await supabase
      .from('eventos').select('*, guias(*), files(*)')
      .eq('fecha', in7Str).eq('estado', 'CONFIRMADO').not('guia_id', 'is', null);

    for(const ev of (ev7||[])){
      if(ev.reconfirmado_at) continue;
      const guia = ev.guias;
      if(!guia?.email) continue;
      const fechaStr = new Date(ev.fecha+'T12:00:00').toLocaleDateString('es-AR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
      try {
        await transporter.sendMail({
          from: 'Say Hueque <tp@sayhueque.com>',
          to: guia.email,
          subject: `⏳ Reconfirmá tu servicio del ${fechaStr} — ${ev.tipo_evento}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
            <h2 style="color:#1B6B74">⏳ Recordatorio de reconfirmación</h2>
            <p>Hola <strong>${guia.nombre} ${guia.apellido}</strong>,</p>
            <p>Faltan <strong>7 días</strong> para tu evento y necesitamos que confirmes que podés estar presente:</p>
            <div style="background:#F9F8F6;border-left:4px solid #1B6B74;padding:16px;border-radius:4px;margin:16px 0">
              <strong>${ev.tipo_evento}</strong><br/>
              📅 ${fechaStr}${ev.hora_inicio?' · 🕐 '+ev.hora_inicio:''}<br/>
              ${ev.files?.nro_file?'📁 '+ev.files.nro_file:''}
            </div>
            <p>Por favor ingresá a la plataforma y hacé clic en <strong>Reconfirmar</strong>:</p>
            <a href="https://sayhueque-guias.vercel.app" style="display:inline-block;padding:12px 24px;background:#1B6B74;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Ir a la plataforma →</a>
            <p style="font-size:12px;color:#5A5A5A;margin-top:24px">Say Hueque · Sistema de Gestión de Guías</p>
          </div>`
        });
        console.log(`📩 Reconf 7d sent to ${guia.email} for evento ${ev.id}`);
      } catch(e){ console.error('Reconf 7d error:', e.message); }
    }

    // Urgent reconf alert at 48h
    const { data: ev2 } = await supabase
      .from('eventos').select('*, guias(*), files(*)')
      .eq('fecha', in2Str).eq('estado', 'CONFIRMADO').not('guia_id', 'is', null);

    for(const ev of (ev2||[])){
      if(ev.reconfirmado_at) continue;
      const guia = ev.guias;
      const fechaStr = new Date(ev.fecha+'T12:00:00').toLocaleDateString('es-AR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
      const urgentHtml = (email, nombre) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="color:#E63946">🔴 Reconfirmación urgente — 48 horas</h2>
        <p>Hola <strong>${nombre}</strong>,</p>
        <p>Faltan <strong>48 horas</strong> para el evento y <strong>aún no fue reconfirmado</strong>:</p>
        <div style="background:#FFF5F5;border-left:4px solid #E63946;padding:16px;border-radius:4px;margin:16px 0">
          <strong>${ev.tipo_evento}</strong><br/>
          📅 ${fechaStr}${ev.hora_inicio?' · 🕐 '+ev.hora_inicio:''}<br/>
          ${ev.files?.nro_file?'📁 '+ev.files.nro_file+'<br/>':''}
          👤 Guía: ${guia?.nombre||''} ${guia?.apellido||''}
        </div>
        <a href="https://sayhueque-guias.vercel.app" style="display:inline-block;padding:12px 24px;background:#E63946;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Ir a la plataforma →</a>
        <p style="font-size:12px;color:#5A5A5A;margin-top:24px">Say Hueque · Sistema de Gestión de Guías</p>
      </div>`;

      if(guia?.email){
        try {
          await transporter.sendMail({
            from: 'Say Hueque <tp@sayhueque.com>',
            to: guia.email,
            subject: `🔴 URGENTE: Reconfirmá tu servicio de mañana — ${ev.tipo_evento}`,
            html: urgentHtml(guia.email, guia.nombre+' '+guia.apellido)
          });
          console.log(`🚨 Urgent reconf sent to ${guia.email} for evento ${ev.id}`);
        } catch(e){ console.error('Urgent reconf error:', e.message); }
      }
      if(adminEmail){
        try {
          await transporter.sendMail({
            from: 'Say Hueque <tp@sayhueque.com>',
            to: adminEmail,
            subject: `🔴 Alerta: ${guia?.nombre||''} ${guia?.apellido||''} no reconfirmó — ${ev.tipo_evento} mañana`,
            html: urgentHtml(adminEmail, 'Admin')
          });
        } catch(e){ console.error('Admin alert error:', e.message); }
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    console.log(`📊 Results: ${results.sent} sent, ${results.skipped} skipped, ${results.errors.length} errors`);
    return res.status(200).json({ success: true, date: tomorrowStr, ...results });

  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
