// api/send-acceptance-pdf.js
// Called when a guide accepts an event — generates a PDF "compromiso de aceptación"
// and emails it to the admin configured in config table.
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

function buildPdfHtml({ guia, evento, file, acceptedAt }) {
  const fechaEvento = new Date(evento.fecha + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });
  const fechaAccepted = new Date(acceptedAt).toLocaleDateString('es-AR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });
  const horaAccepted = new Date(acceptedAt).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit'
  });
  const horario = (evento.hora_inicio || '') + (evento.hora_fin ? ' – ' + evento.hora_fin : '');
  const nroFile = file?.nro_file || evento.nro_file || '—';
  const operador = file?.operador_nombre || '—';
  const guiaNombre = guia.nombre + ' ' + guia.apellido;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Georgia', serif;
      background: #fff;
      color: #1A1A1A;
      padding: 48px;
      max-width: 700px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 3px solid #1B6B74;
      padding-bottom: 20px;
      margin-bottom: 32px;
    }
    .logo-area h1 {
      font-family: 'Georgia', serif;
      font-size: 28px;
      color: #1B6B74;
      letter-spacing: -0.5px;
    }
    .logo-area p {
      font-size: 12px;
      color: #5A5A5A;
      margin-top: 4px;
      font-family: Arial, sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .doc-meta {
      text-align: right;
      font-family: Arial, sans-serif;
    }
    .doc-meta .doc-title {
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #5A5A5A;
    }
    .doc-meta .doc-id {
      font-size: 13px;
      font-weight: bold;
      color: #1B6B74;
      margin-top: 4px;
    }
    .title-section {
      text-align: center;
      margin-bottom: 32px;
      padding: 24px;
      background: linear-gradient(135deg, #1B6B74, #2A9D8F);
      border-radius: 10px;
    }
    .title-section h2 {
      color: white;
      font-size: 22px;
      font-family: Georgia, serif;
      letter-spacing: 0.5px;
    }
    .title-section p {
      color: rgba(255,255,255,0.85);
      font-size: 13px;
      margin-top: 6px;
      font-family: Arial, sans-serif;
    }
    .intro {
      font-size: 14px;
      line-height: 1.7;
      color: #444;
      font-family: Georgia, serif;
      margin-bottom: 28px;
      padding: 0 4px;
    }
    .intro strong {
      color: #1A1A1A;
    }
    .data-grid {
      border: 1.5px solid #E8E4DD;
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 28px;
    }
    .data-grid-header {
      background: #F5F3EF;
      padding: 10px 18px;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #5A5A5A;
      font-family: Arial, sans-serif;
    }
    .data-row {
      display: flex;
      border-top: 1px solid #E8E4DD;
    }
    .data-label {
      width: 38%;
      padding: 12px 18px;
      font-size: 12px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #5A5A5A;
      background: #FAFAF8;
      font-family: Arial, sans-serif;
    }
    .data-value {
      flex: 1;
      padding: 12px 18px;
      font-size: 14px;
      color: #1A1A1A;
      font-family: Arial, sans-serif;
      font-weight: 500;
    }
    .data-value.highlight {
      color: #1B6B74;
      font-weight: 700;
    }
    .commitment-box {
      background: #F9F8F6;
      border-left: 4px solid #1B6B74;
      padding: 20px 24px;
      border-radius: 0 8px 8px 0;
      margin-bottom: 36px;
      font-family: Georgia, serif;
      font-size: 14px;
      line-height: 1.8;
      color: #333;
    }
    .commitment-box strong {
      color: #1B6B74;
    }
    .signature-area {
      display: flex;
      justify-content: space-between;
      gap: 32px;
      margin-bottom: 32px;
    }
    .signature-block {
      flex: 1;
      text-align: center;
    }
    .signature-line {
      border-bottom: 1.5px solid #1A1A1A;
      margin-bottom: 8px;
      height: 40px;
    }
    .signature-label {
      font-size: 11px;
      color: #5A5A5A;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-family: Arial, sans-serif;
    }
    .signature-name {
      font-size: 13px;
      font-weight: bold;
      color: #1A1A1A;
      margin-top: 4px;
      font-family: Arial, sans-serif;
    }
    .digital-stamp {
      border: 2px solid #2A9D8F;
      border-radius: 8px;
      padding: 12px 20px;
      text-align: center;
      margin-bottom: 24px;
      background: #F0FAF9;
    }
    .digital-stamp .stamp-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #2A9D8F;
      font-weight: bold;
      font-family: Arial, sans-serif;
    }
    .digital-stamp .stamp-value {
      font-size: 13px;
      color: #1A1A1A;
      font-weight: bold;
      margin-top: 4px;
      font-family: Arial, sans-serif;
    }
    .footer {
      border-top: 1px solid #E8E4DD;
      padding-top: 16px;
      text-align: center;
      font-size: 11px;
      color: #5A5A5A;
      font-family: Arial, sans-serif;
      line-height: 1.6;
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="logo-area">
      <h1>Say Hueque</h1>
      <p>Sistema de Gestión de Guías</p>
    </div>
    <div class="doc-meta">
      <div class="doc-title">Compromiso de Aceptación</div>
      <div class="doc-id">CA-${evento.id}-${Date.now().toString(36).toUpperCase().slice(-6)}</div>
    </div>
  </div>

  <!-- Title -->
  <div class="title-section">
    <h2>Compromiso de Aceptación de Evento</h2>
    <p>Documento generado automáticamente · ${fechaAccepted}, ${horaAccepted} hs</p>
  </div>

  <!-- Intro -->
  <p class="intro">
    Por medio del presente documento, el/la guía <strong>${guiaNombre}</strong> acepta formalmente
    su participación en el evento detallado a continuación, comprometiéndose a prestar los servicios
    acordados en tiempo y forma según las condiciones establecidas por <strong>Say Hueque</strong>.
  </p>

  <!-- Datos del Guía -->
  <div class="data-grid">
    <div class="data-grid-header">📋 Datos del Guía</div>
    <div class="data-row">
      <div class="data-label">Nombre</div>
      <div class="data-value highlight">${guiaNombre}</div>
    </div>
    <div class="data-row">
      <div class="data-label">Email</div>
      <div class="data-value">${guia.email || '—'}</div>
    </div>
    <div class="data-row">
      <div class="data-label">Teléfono</div>
      <div class="data-value">${guia.telefono || '—'}</div>
    </div>
  </div>

  <!-- Datos del Evento -->
  <div class="data-grid">
    <div class="data-grid-header">🗓️ Datos del Evento</div>
    <div class="data-row">
      <div class="data-label">Tipo de Evento</div>
      <div class="data-value highlight">${evento.tipo_evento || '—'}</div>
    </div>
    <div class="data-row">
      <div class="data-label">Nro. File</div>
      <div class="data-value">${nroFile}</div>
    </div>
    <div class="data-row">
      <div class="data-label">Operador</div>
      <div class="data-value">${operador}</div>
    </div>
    <div class="data-row">
      <div class="data-label">Fecha</div>
      <div class="data-value">${fechaEvento}</div>
    </div>
    <div class="data-row">
      <div class="data-label">Horario</div>
      <div class="data-value">${horario || '—'}</div>
    </div>
    ${evento.pickup_location ? `
    <div class="data-row">
      <div class="data-label">📍 Pick Up</div>
      <div class="data-value">${evento.pickup_location}</div>
    </div>` : ''}
    ${evento.dropoff_location ? `
    <div class="data-row">
      <div class="data-label">📍 Drop Off</div>
      <div class="data-value">${evento.dropoff_location}</div>
    </div>` : ''}
    ${evento.datos_vuelos ? `
    <div class="data-row">
      <div class="data-label">✈️ Vuelos</div>
      <div class="data-value">${evento.datos_vuelos}</div>
    </div>` : ''}
    ${evento.descripcion ? `
    <div class="data-row">
      <div class="data-label">Descripción</div>
      <div class="data-value">${evento.descripcion}</div>
    </div>` : ''}
  </div>

  <!-- Cláusula de compromiso -->
  <div class="commitment-box">
    El/la guía <strong>${guiaNombre}</strong> declara conocer los detalles del servicio y se compromete a:
    presentarse con puntualidad en el punto de encuentro indicado, contar con la documentación e
    identificación necesaria, y cumplir con los estándares de calidad de <strong>Say Hueque</strong>.
    Cualquier impedimento deberá notificarse con la mayor anticipación posible.
  </div>

  <!-- Sello digital -->
  <div class="digital-stamp">
    <div class="stamp-title">✅ Aceptación Registrada Digitalmente</div>
    <div class="stamp-value">${fechaAccepted} a las ${horaAccepted} hs · ${guia.email}</div>
  </div>

  <!-- Firmas -->
  <div class="signature-area">
    <div class="signature-block">
      <div class="signature-line"></div>
      <div class="signature-label">Guía de Turismo</div>
      <div class="signature-name">${guiaNombre}</div>
    </div>
    <div class="signature-block">
      <div class="signature-line"></div>
      <div class="signature-label">Representante Say Hueque</div>
      <div class="signature-name">Say Hueque S.R.L.</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    Say Hueque · Sistema de Gestión de Guías<br>
    Documento generado automáticamente el ${fechaAccepted} a las ${horaAccepted} hs.<br>
    Este documento tiene validez como registro de aceptación digital.
  </div>

</body>
</html>`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { eventoId, guiaId, acceptedAt } = req.body;
    if (!eventoId || !guiaId) return res.status(400).json({ error: 'Missing eventoId or guiaId' });

    const supabase = createClient(SB_URL, SB_KEY);

    // Fetch evento, guia, file
    const [{ data: evento }, { data: guia }] = await Promise.all([
      supabase.from('eventos').select('*').eq('id', eventoId).single(),
      supabase.from('guias').select('*').eq('id', guiaId).single(),
    ]);

    if (!evento || !guia) return res.status(404).json({ error: 'Evento o guía no encontrado' });

    const { data: file } = await supabase.from('files').select('*').eq('id', evento.file_id).maybeSingle();

    // Get admin email from config
    const { data: configData } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'email_notificaciones_admin')
      .single();
    const emailAdmin = configData?.value?.trim();
    if (!emailAdmin) return res.status(200).json({ success: false, reason: 'No admin email configured' });

    const timestamp = acceptedAt || new Date().toISOString();
    const pdfHtml = buildPdfHtml({ guia, evento, file, acceptedAt: timestamp });

    const guiaNombre = guia.nombre + ' ' + guia.apellido;
    const fechaEvento = new Date(evento.fecha + 'T12:00:00').toLocaleDateString('es-AR', {
      day: '2-digit', month: 'long', year: 'numeric'
    });
    const nroFile = file?.nro_file || evento.nro_file || '—';
    const fechaAccepted = new Date(timestamp).toLocaleDateString('es-AR', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
    const horaAccepted = new Date(timestamp).toLocaleTimeString('es-AR', {
      hour: '2-digit', minute: '2-digit'
    });

    const emailHtml = `
    <div style="font-family:'DM Sans',Arial,sans-serif;background:#F5F3EF;padding:40px 20px;margin:0">
      <div style="max-width:560px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
        <div style="background:linear-gradient(135deg,#1B6B74,#2A9D8F);padding:28px 24px;text-align:center">
          <div style="font-size:40px;margin-bottom:8px">✅</div>
          <h1 style="margin:0;color:white;font-size:22px;font-weight:700">Guía Confirmado</h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px">Aceptación registrada · ${fechaAccepted} ${horaAccepted} hs</p>
        </div>
        <div style="padding:28px 24px">
          <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 20px">
            El/la guía <strong style="color:#1A1A1A">${guiaNombre}</strong> aceptó el evento <strong style="color:#1B6B74">${evento.tipo_evento}</strong> del ${fechaEvento}. File: <strong>${nroFile}</strong>.
          </p>
          <div style="background:#F9F8F6;border-radius:10px;padding:16px 20px;margin-bottom:20px">
            <div style="font-size:11px;font-weight:700;color:#5A5A5A;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px">Resumen del evento</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="padding:4px 0;font-size:12px;color:#5A5A5A;width:40%">Guía</td><td style="padding:4px 0;font-size:13px;font-weight:600;color:#1A1A1A">${guiaNombre}</td></tr>
              <tr><td style="padding:4px 0;font-size:12px;color:#5A5A5A">Tipo</td><td style="padding:4px 0;font-size:13px;font-weight:600;color:#1B6B74">${evento.tipo_evento}</td></tr>
              <tr><td style="padding:4px 0;font-size:12px;color:#5A5A5A">Fecha</td><td style="padding:4px 0;font-size:13px;font-weight:600;color:#1A1A1A">${fechaEvento}</td></tr>
              <tr><td style="padding:4px 0;font-size:12px;color:#5A5A5A">File</td><td style="padding:4px 0;font-size:13px;font-weight:600;color:#1A1A1A">${nroFile}</td></tr>
              ${evento.pickup_location ? `<tr><td style="padding:4px 0;font-size:12px;color:#5A5A5A">Pick Up</td><td style="padding:4px 0;font-size:13px;color:#1A1A1A">${evento.pickup_location}</td></tr>` : ''}
              ${evento.dropoff_location ? `<tr><td style="padding:4px 0;font-size:12px;color:#5A5A5A">Drop Off</td><td style="padding:4px 0;font-size:13px;color:#1A1A1A">${evento.dropoff_location}</td></tr>` : ''}
            </table>
          </div>
          <p style="font-size:13px;color:#666;margin:0">El compromiso de aceptación firmado se adjunta en PDF listo para archivar en la carpeta del viaje.</p>
        </div>
        <div style="background:#F5F3EF;padding:16px 24px;text-align:center;border-top:1px solid #E8E4DD">
          <p style="margin:0;color:#5A5A5A;font-size:11px">Say Hueque · Sistema de Gestión de Guías</p>
        </div>
      </div>
    </div>`;

    await transporter.sendMail({
      from: 'Say Hueque <tp@sayhueque.com>',
      to: emailAdmin,
      subject: `✅ Guía confirmado: ${evento.tipo_evento} · ${fechaEvento} · ${nroFile}`,
      html: emailHtml,
      attachments: [
        {
          filename: `Compromiso_${guiaNombre.replace(/ /g, '_')}_${evento.fecha}_${nroFile.replace(/\//g, '-')}.html`,
          content: pdfHtml,
          contentType: 'text/html',
        }
      ],
    });

    console.log(`✅ Acceptance PDF sent to admin ${emailAdmin} for evento ${eventoId}`);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
