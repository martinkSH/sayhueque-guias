// api/send-email.js
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { templateId, variables } = req.body;
    console.log('📧 Email request:', templateId);
    
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.GMAIL_USER || 'tp@sayhueque.com',
        pass: process.env.GMAIL_PASS,
      },
    });
    
    const supabase = createClient(
      'https://ewxbghnyjvaijpfiygqg.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eGJnaG55anZhaWpwZml5Z3FnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTgxNTEsImV4cCI6MjA4ODM5NDE1MX0.tySNpML47ViQQ_Xh3Eaj1Dslt17oLZKEiWL0hLNdp4M'
    );
    
    const { data: template, error } = await supabase
      .from('email_templates')
      .select('html, subject')
      .eq('id', templateId)
      .single();
    
    if (error || !template) {
      throw new Error('Template not found');
    }
    
    let html = template.html;
    let subject = template.subject;

    // Replace {{key}} placeholders. Use split/join so values containing
    // '$' or another placeholder don't trigger $-substitution or infinite loops.
    for (const key in variables) {
      const placeholder = '{{' + key + '}}';
      const value = String(variables[key] ?? '');
      html = html.split(placeholder).join(value);
      subject = subject.split(placeholder).join(value);
    }
    
    await transporter.sendMail({
      from: 'Say Hueque <tp@sayhueque.com>',
      to: variables.to_email,
      subject: subject,
      html: html,
    });
    
    console.log('✅ Sent to:', variables.to_email);
    
    return res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
