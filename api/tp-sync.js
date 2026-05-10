// api/tp-sync.js — TourPlan → Atlas Sherpa sync (ES module)
import sql from 'mssql';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './_auth.js';

function getTPConfig() {
  return {
    server:   process.env.TP_SERVER   || 'LA-SAYHUE.data.tourplan.net',
    port:     Number(process.env.TP_PORT || 50409),
    database: process.env.TP_DATABASE || 'LA-SAYHUE',
    user:     process.env.TP_USER     || 'excelLA-SAYHUE',
    password: process.env.TP_PASSWORD,
    options: { encrypt: true, trustServerCertificate: true, connectTimeout: 30000, requestTimeout: 120000 },
  };
}

const SB_URL = 'https://ewxbghnyjvaijpfiygqg.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eGJnaG55anZhaWpwZml5Z3FnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTgxNTEsImV4cCI6MjA4ODM5NDE1MX0.tySNpML47ViQQ_Xh3Eaj1Dslt17oLZKEiWL0hLNdp4M';

function getSupabase() {
  return createClient(SB_URL, SB_KEY);
}

function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  return d;
}

function toTimeStr(t) {
  if (!t) return null;
  if (typeof t === 'string') return t.slice(0,5);
  return null;
}

async function getGUServices(pool, fromDate, toDate) {
  const r = await pool.request()
    .input('FROM', sql.VarChar(8), fromDate)
    .input('TO', sql.VarChar(8), toDate)
    .query(`
    SELECT
      vw.BookingReference, vw.BookingName,
      vw.BookingTravelDate, vw.LastServiceDate,
      vw.BookingStatus, vw.BookingStatusName,
      vw.BookingAnalysis1Name AS Operador,
      vw.BookingAnalysis3Name AS GR,
      pax_principal.Pax_Principal,
      ops.Service_Date, ops.Dropoff_date,
      CAST(ops.Day_Number AS VARCHAR)+' / '+CAST(ops.Sequence_Number AS VARCHAR) AS Dia_Sec,
      ops.Product_Option_name AS Servicio,
      ops.Supplier_Name, ops.supplier_confirmation,
      ops.Service_status, sst.NAME AS Service_StatusName,
      ops.pickup_time, ops.dropoff_time,
      ops.pickup_date AS Pickup, ops.dropoff_date AS Dropoff,
      ops.Pax+ops.Children+ops.Infants AS Total_Pax,
      ops.Voucher_Number
    FROM vw_BookingHeaderReportData vw
    JOIN OPSView ops ON ops.Booking_Reference=vw.BookingReference
      AND ops.Product_service='GU' AND ops.Product_Location='BUE'
    JOIN sst ON sst.code=ops.Service_status
    LEFT JOIN (
      SELECT bhd_id, pxn.pax_forename+' '+pxn.pax_surname AS Pax_Principal
      FROM PNB JOIN PXN ON PXN.PXN_ID=PNB.PXN_ID WHERE leadpax=1
    ) pax_principal ON pax_principal.bhd_id=vw.bookingid
    WHERE vw.BookingStatus NOT IN ('QU','ZZ','XX','QX','CA','CX')
      AND vw.BookingName NOT LIKE 'ZZ%'
      AND vw.BookingTravelDate >= @FROM
      AND vw.BookingTravelDate <= @TO
      AND ops.Service_status NOT IN ('CX','XX')
    ORDER BY vw.BookingTravelDate, vw.BookingReference, ops.Day_Number, ops.Sequence_Number
  `);
  return r.recordset;
}

const DESIGNAR = ['guia a designar','a designar','guide to be assigned','por designar','sin asignar','tbd','por confirmar'];
const isDesignar = s => !s || DESIGNAR.some(k => s.toLowerCase().includes(k));
const guiaCache = new Map();

async function matchGuia(supabase, supplierName) {
  if (isDesignar(supplierName)) return null;
  if (guiaCache.has(supplierName)) return guiaCache.get(supplierName);
  const parts = supplierName.trim().split(/\s+/).filter(p => p.length > 2);
  if (!parts.length) return null;
  const or = [...parts.map(p=>`apellido.ilike.%${p}%`),...parts.map(p=>`nombre.ilike.%${p}%`)].join(',');
  const { data } = await supabase.from('guias').select('id,nombre,apellido').eq('estado','ACTIVO').or(or).limit(5);
  if (!data?.length) { guiaCache.set(supplierName,null); return null; }
  const exact = data.find(g => parts.some(p => g.apellido?.toLowerCase()===p.toLowerCase()));
  const result = exact ? exact.id : data[0].id;
  guiaCache.set(supplierName, result);
  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!await requireAuth(req, res)) return;

  const { dryRun = false, dateFrom, dateTo } = req.body || {};
  // Default: current month + next 30 days to avoid huge result sets
  const today = new Date();
  const defaultFrom = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}01`;
  const defaultTo = new Date(today.getTime() + 60*24*60*60*1000);
  const defaultToStr = `${defaultTo.getFullYear()}${String(defaultTo.getMonth()+1).padStart(2,'0')}${String(defaultTo.getDate()).padStart(2,'0')}`;
  const supabase = getSupabase();
  guiaCache.clear();

  const results = { files_created:0, files_updated:0, eventos_created:0, eventos_updated:0, guias_matched:0, a_designar:0, invitaciones_creadas:0, discrepancias:0, errors:[], log:[] };
  let pool = null;

  try {
    console.log('Connecting to TourPlan...');
    pool = await sql.connect(getTPConfig());
    const fromDate = dateFrom || defaultFrom;
    const toDate = dateTo || defaultToStr;
    console.log(`Fetching GU services BUE from ${fromDate} to ${toDate}`);
    const rows = await getGUServices(pool, fromDate, toDate);
    console.log(`Fetched ${rows.length} GU service rows`);
    results.log.push(`Fetched ${rows.length} GU services`);

    const bookingMap = new Map();
    for (const row of rows) {
      const ref = row.BookingReference;
      if (!bookingMap.has(ref)) bookingMap.set(ref, {
        ref, travelDate: toDateStr(row.BookingTravelDate), lastDate: toDateStr(row.LastServiceDate),
        status: row.BookingStatus, operador: row.Operador, gr: row.GR, pasajero: row.Pax_Principal, servicios: []
      });
      bookingMap.get(ref).servicios.push({
        diaSec: row.Dia_Sec, fecha: toDateStr(row.Service_Date),
        servicio: row.Servicio, supplier: row.Supplier_Name,
        tpStatus: row.Service_status, tpStatusName: row.Service_StatusName,
        pickupTime: toTimeStr(row.pickup_time), dropoffTime: toTimeStr(row.dropoff_time),
        pickup: row.Pickup, dropoff: row.Dropoff,
      });
    }

    results.log.push(`Processing ${bookingMap.size} bookings`);

    for (const [ref, booking] of bookingMap) {
      try {
        let fileId;
        const now = new Date().toISOString();
        const fileData = {
          nro_file: ref, fecha_in: booking.travelDate, fecha_out: booking.lastDate,
          operador_nombre: booking.operador||'', dh_gr_nombre: booking.gr||'',
          pasajero_principal: booking.pasajero||null,
          tp_ref: ref, tp_status: booking.status, tp_synced_at: now, updated_at: now,
        };

        if (!dryRun) {
          const { data: existing } = await supabase.from('files').select('id').eq('tp_ref',ref).maybeSingle();
          if (existing) {
            await supabase.from('files').update(fileData).eq('id',existing.id);
            fileId = existing.id; results.files_updated++;
          } else {
            const { data: nf, error: fe } = await supabase.from('files').insert(fileData).select('id').single();
            if (fe) throw new Error(`File: ${fe.message}`);
            fileId = nf.id; results.files_created++;
          }
        } else { fileId='dry-'+ref; results.files_created++; }

        for (const svc of booking.servicios) {
          try {
            const guiaId = await matchGuia(supabase, svc.supplier);
            if (guiaId) results.guias_matched++;
            if (isDesignar(svc.supplier)) results.a_designar++;
            // Evento base — siempre A_ASIGNAR, nunca auto-confirmar
            const ed = {
              file_id: fileId, tipo_evento: svc.servicio||'Servicio de Guía',
              fecha: svc.fecha, hora_inicio: svc.pickupTime||null, hora_fin: svc.dropoffTime||null,
              pickup_location: svc.pickup||null, dropoff_location: svc.dropoff||null,
              estado: 'A_ASIGNAR', guia_id: null,
              tp_dia_sec: svc.diaSec, tp_supplier_name: svc.supplier||null,
              tp_service_status: svc.tpStatus||null, tp_synced_at: now,
              tp_guia_discrepancia: false,
            };
            if (!dryRun) {
              const { data: ex } = await supabase.from('eventos').select('id,estado,guia_id')
                .eq('file_id',fileId).eq('tp_dia_sec',svc.diaSec).eq('fecha',svc.fecha).maybeSingle();

              let eventoId;
              if (ex) {
                // Solo actualizar campos TP — nunca pisar estado/guia_id trabajado en Sherpa
                const upd = {
                  tipo_evento: ed.tipo_evento, hora_inicio: ed.hora_inicio, hora_fin: ed.hora_fin,
                  pickup_location: ed.pickup_location, dropoff_location: ed.dropoff_location,
                  tp_supplier_name: ed.tp_supplier_name, tp_service_status: ed.tp_service_status,
                  tp_synced_at: ed.tp_synced_at,
                };
                // Detectar discrepancia: Sherpa tiene guía pero TP dice otro
                if (ex.guia_id && guiaId && ex.guia_id !== guiaId) {
                  upd.tp_guia_discrepancia = true;
                  results.discrepancias++;
                } else if (ex.guia_id && guiaId && ex.guia_id === guiaId) {
                  upd.tp_guia_discrepancia = false;
                }
                await supabase.from('eventos').update(upd).eq('id', ex.id);
                eventoId = ex.id;
                results.eventos_updated++;
              } else {
                // Evento nuevo — crear como A_ASIGNAR
                const { data: newEv, error: evErr } = await supabase
                  .from('eventos').insert(ed).select('id').single();
                if (evErr) throw new Error(`Evento: ${evErr.message}`);
                eventoId = newEv.id;
                results.eventos_created++;
              }

              // Si TP tiene guía con nombre → crear invitación (si no existe ya)
              if (guiaId && eventoId) {
                const { data: existingInv } = await supabase
                  .from('invitaciones').select('id')
                  .eq('evento_id', eventoId).eq('guia_id', guiaId).maybeSingle();
                if (!existingInv) {
                  await supabase.from('invitaciones').insert({
                    evento_id: eventoId, guia_id: guiaId, estado: 'PENDIENTE',
                    expira_at: new Date(Date.now() + 48*60*60*1000).toISOString(),
                  });
                  await supabase.from('eventos').update({ estado: 'ASIGNADO', guia_id: guiaId })
                    .eq('id', eventoId);
                  results.invitaciones_creadas++;
                }
              }
            } else { results.eventos_created++; }
          } catch(e) { results.errors.push(`${ref}/${svc.diaSec}: ${e.message}`); }
        }
      } catch(e) { results.errors.push(`${ref}: ${e.message}`); }
    }

    return res.status(200).json({ success:true, dryRun, bookings_processed:bookingMap.size, ...results });
  } catch(err) {
    console.error('TP sync error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (pool) try { await pool.close(); } catch {}
  }
}
