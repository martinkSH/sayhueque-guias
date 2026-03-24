// api/send-email.js
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { templateId, variables } = req.body;

    // Crear transporter de Nodemailer
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: 'tp@sayhueque.com',
        pass: 'jmjy tqwi xppd huyx',
      },
    });

    let emailHtml = '';
    let emailSubject = '';

    // Cargar template desde Supabase
    if (templateId && variables) {
      const supabase = createClient(
        'https://ewxbghnyjvaijpfiygqg.supabase.co',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eGJnaG55anZhaWpwZml5Z3FnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzcwNTM1MjgsImV4cCI6MjA1MjYyOTUyOH0.YcVy3mHVQUqEUv-3xREnt3aUj_CStIHiSdSIbVd0khU'
      );
      
      const { data: template, error } = await supabase
        .from('email_templates')
        .select('html, subject')
        .eq('id', templateId)
        .single();
      
      if (error) {
        throw new Error('Template no encontrado: ' + templateId);
      }
      
      emailHtml = template.html;
      emailSubject = template.subject;
      
      // Reemplazar variables {{variable}}
      Object.keys(variables).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        emailHtml = emailHtml.replace(regex, variables[key] || '');
        emailSubject = emailSubject.replace(regex, variables[key] || '');
      });
    }

    // Enviar email
    await transporter.sendMail({
      from: 'Say Hueque <tp@sayhueque.com>',
      to: variables.to_email,
      subject: emailSubject || 'Say Hueque - Notificación',
      html: emailHtml,
    });

    console.log('✅ Email enviado a:', variables.to_email);
    return res.status(200).json({ success: true, message: 'Email enviado' });
    
  } catch (error) {
    console.error('❌ Error enviando email:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
