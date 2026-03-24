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

    console.log('📧 Procesando email:', { templateId, to: variables?.to_email });

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
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eGJnaG55anZhaWpwZml5Z3FnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTgxNTEsImV4cCI6MjA4ODM5NDE1MX0.tySNpML47ViQQ_Xh3Eaj1Dslt17oLZKEiWL0hLNdp4M'
      );
      
      console.log('🔍 Buscando template:', templateId);
      
      const { data: template, error } = await supabase
        .from('email_templates')
        .select('html, subject')
        .eq('id', templateId)
        .single();
      
      console.log('Resultado Supabase:', { template: template ? 'encontrado' : 'null', error });
      
      if (error) {
        console.error('❌ Error de Supabase:', error);
        throw new Error(`Error cargando template: ${JSON.stringify(error)}`);
      }
      
      if (!template) {
        throw new Error('Template no encontrado (data es null): ' + templateId);
      }
      
      emailHtml = template.html;
      emailSubject = template.subject;
      
      console.log('✅ Template cargado, subject:', emailSubject);
      
      // Reemplazar variables {{variable}}
      Object.keys(variables).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        emailHtml = emailHtml.replace(regex, variables[key] || '');
        emailSubject = emailSubject.replace(regex, variables[key] || '');
      });
    }

    console.log('📤 Enviando email a:', variables.to_email);

    // Enviar email
    await transporter.sendMail({
      from: 'Say Hueque <tp@sayhueque.com>',
      to: variables.to_email,
      subject: emailSubject || 'Say Hueque - Notificación',
      html: emailHtml,
    });

    console.log('✅ Email enviado exitosamente a:', variables.to_email);
    return res.status(200).json({ success: true, message: 'Email enviado' });
    
  } catch (error) {
    console.error('❌ Error completo:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
