// api/send-email.js
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // CORS headers
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
    console.log('📧 Procesando email:', { templateId, to: variables?.to_email });
    
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
      
      if (error || !template) {
        throw new Error('Template no encontrado: ' + templateId);
      }
      
      // NORMALIZAR saltos de línea (crucial para Windows \r\n)
      emailHtml = template.html.replace(/\r\n/g, '\n');
      emailSubject = template.subject.replace(/\r\n/g, '\n');
      
      console.log('✅ Template cargado');
      console.log('📝 Variables a reemplazar:', Object.keys(variables));
      
      // Reemplazar variables usando REGEX con escape correcto
      Object.keys(variables).forEach(key => {
        const value = String(variables[key] || '');
        // Escapar caracteres especiales en la key para regex
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g');
        
        const beforeCount = (emailHtml.match(regex) || []).length;
        emailHtml = emailHtml.replace(regex, value);
        emailSubject = emailSubject.replace(regex, value);
        const afterCount = (emailHtml.match(regex) || []).length;
        
        if (beforeCount > 0) {
          console.log(`   ✓ Reemplazó ${beforeCount}x {{${key}}} → "${value.substring(0, 40)}${value.length > 40 ? '...' : ''}"`);
        }
      });
      
      // Verificar si quedaron variables sin reemplazar
      const unreplacedVars = emailHtml.match(/\{\{[^}]+\}\}/g);
      if (unreplacedVars) {
        console.warn('⚠️ Variables sin reemplazar:', [...new Set(unreplacedVars)]);
      } else {
        console.log('✅ Todas las variables fueron reemplazadas');
      }
    }
    
    console.log('📤 Enviando email a:', variables.to_email);
    
    await transporter.sendMail({
      from: 'Say Hueque <tp@sayhueque.com>',
      to: variables.to_email,
      subject: emailSubject || 'Say Hueque - Notificación',
      html: emailHtml,
    });
    
    console.log('✅ Email enviado exitosamente');
    
    return res.status(200).json({ success: true, message: 'Email enviado' });
    
  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
```

---

## 🎯 Lo que cambié:

1. **Normalizar `\r\n` → `\n`** antes de reemplazar
2. **Usar regex correcta** con escape de caracteres especiales  
3. **Contar reemplazos** para debuggear
4. **Detectar variables sin reemplazar** al final

---

## 🚀 Pasos:

1. **Reemplazá** `/api/send-email.js` con el código de arriba
2. **Commit + Push**
3. **Esperá el deploy**
4. **Probá** y **revisá los logs de Vercel**

Los logs ahora van a mostrar:
```
✓ Reemplazó 1x {{tipo_evento}} → "City Tour"
✓ Reemplazó 1x {{fecha}} → "jueves, 26 de marzo de 2026"
...
✅ Todas las variables fueron reemplazadas
```

O si algo falla:
```
⚠️ Variables sin reemplazar: ['{{tipo_evento}}', '{{fecha}}']
