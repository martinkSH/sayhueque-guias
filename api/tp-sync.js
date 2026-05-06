// api/tp-sync.js — TourPlan → Atlas Sherpa sync
// Importa viajes confirmados con servicios GU en BUE desde TourPlan SQL Server

const sql = require('mssql');
const { createClient } = require('@supabase/supabase-js');

// ── TourPlan connection ────────────────────────────────────────────────────────
function getTPConfig() {
  return {
    server:   process.env.TP_SERVER   || 'LA-SAYHUE.data.tourplan.net',
    port:     Number(process.env.TP_PORT || 50409),
    database: process.env.TP_DATABASE || 'LA-SAYHUE',
    user:     process.env.TP_USER     || 'excelLA-SAYHUE',
    password: process.env.TP_PASSWORD,
    options: {
      encrypt: true,
      trustServerCertificate: true,
      connectTimeout: 30000,
      requestTimeout: 120000,
    },
  };
}

// ── Supabase connection ────────────────────────────────────────────────────────
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── Normalizar fechas de SQL Server ───────────────────────────────────────────
function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return d;
}

function toTimeStr(t) {
  if (!t) return null;
  if (typeof t === 'string') return t.slice(0, 5);
  return null;
}

// ── Query: bookings confirmados con servicios GU en BUE ───────────────────────
async function getGUServicesFromTP(pool, daysAhead) {
  const result = await pool.request().query(`
    SELECT
      vw.BookingReference,
      vw.BookingName,
      vw.BookingTravelDate,
      vw.LastServiceDate,
      vw.BookingStatus,
      vw.BookingStatusName,
      vw.BookingAnalysis1Name  AS Operador,
      vw.BookingAnalysis3Name  AS GR,
      pax_principal.Pax_Principal,
      ops.Service_Date,
      ops.Dropoff_date,
      CAST(ops.Day_Number AS VARCHAR) + ' / ' +
      CAST(ops.Sequence_Number AS VARCHAR) AS Dia_Sec,
      ops.Product_Option_name  AS Servicio,
      ops.Supplier_Name,
      ops.supplier_confirmation,
      ops.Service_status,
      sst.NAME                 AS Service_StatusName,
      ops.pickup_time,
      ops.dropoff_time,
      ops.pickup_date          AS Pickup,
      ops.dropoff_date         AS Dropoff,
      ops.Pax + ops.Children + ops.Infants AS Total_Pax,
      ops.Voucher_Number
    FROM vw_BookingHeaderReportData vw
    JOIN OPSView ops
      ON  ops.Booking_Reference = vw.BookingReference
      AND ops.Product_service    = 'GU'
      AND ops.Product_Location   = 'BUE'
    JOIN sst ON sst.code = ops.Service_status
    LEFT JOIN (
      SELECT bhd_id,
             pxn.pax_forename + ' ' + pxn.pax_surname AS Pax_Principal
      FROM PNB
      JOIN PXN ON PXN.PXN_ID = PNB.PXN_ID
      WHERE leadpax = 1
    ) AS pax_principal ON pax_principal.bhd_id = vw.bookingid
    WHERE
      -- Excluir: Quotes, Test Bookings, Quotes perdidas, Cancelados
      vw.BookingStatus NOT IN ('QU','ZZ','XX','QX','CA','CX')
      AND vw.BookingName NOT LIKE 'ZZ%'
      AND vw.BookingTravelDate >= '20260501'
      AND ops.Service_status NOT IN ('CX','XX')
    ORDER BY vw.BookingTravelDate, vw.BookingReference, ops.Day_Number, ops.Sequence_Number
  `);
  return result.recordset;
}

// ── Match proveedor → guía en Supabase ────────────────────────────────────────
const DESIGNAR_KEYWORDS = [
  'guia a designar', 'a designar', 'guide to be assigned',
  'por designar', 'sin asignar', 'tbd', 'por confirmar'
];

function isDesignar(supplierName) {
  if (!supplierName) return true;
  const lower = supplierName.toLowerCase().trim();
  return DESIGNAR_KEYWORDS.some(k => lower.includes(k));
}

const guiaCache = new Map();

async function matchGuia(supabase, supplierName) {
  if (!supplierName || isDesignar(supplierName)) return null;
  if (guiaCache.has(supplierName)) return guiaCache.get(supplierName);

  const parts = supplierName.trim().split(/\s+/).filter(p => p.length > 2);
  if (parts.length === 0) return null;

  const orFilter = [
    ...parts.map(p => `apellido.ilike.%${p}%`),
    ...parts.map(p => `nombre.ilike.%${p}%`)
  ].join(',');

  const { data } = await supabase
    .from('guias')
    .select('id, nombre, apellido')
    .eq('estado', 'ACTIVO')
    .or(orFilter)
    .limit(5);

  if (!data || data.length === 0) {
    guiaCache.set(supplierName, null);
    return null;
  }

  const exactMatch = data.find(g =>
    parts.some(p => g.apellido?.toLowerCase() === p.toLowerCase())
  );

  const result = exactMatch ? exactMatch.id : data[0].id;
  guiaCache.set(supplierName, result);
  return result;
}

// ── Handler principal ─────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { daysAhead = 60, dryRun = false } = req.body || {};

  const supabase = getSupabase();
  guiaCache.clear();

  const results = {
    files_created: 0,
    files_updated: 0,
    eventos_created: 0,
    eventos_updated: 0,
    guias_matched: 0,
    a_designar: 0,
    errors: [],
    log: [],
  };

  let pool = null;
  try {
    console.log('Connecting to TourPlan...');
    pool = await sql.connect(getTPConfig());
    console.log('Connected. Fetching GU services...');

    const rows = await getGUServicesFromTP(pool, daysAhead);
    console.log(`Fetched ${rows.length} GU service rows`);
    results.log.push(`Fetched ${rows.length} GU services from TourPlan`);

    // Agrupar por booking
    const bookingMap = new Map();
    for (const row of rows) {
      const ref = row.BookingReference;
      if (!bookingMap.has(ref)) {
        bookingMap.set(ref, {
          ref,
          travelDate: toDateStr(row.BookingTravelDate),
          lastDate:   toDateStr(row.LastServiceDate),
          status:     row.BookingStatus,
          operador:   row.Operador,
          gr:         row.GR,
          pasajero:   row.Pax_Principal,
          servicios:  [],
        });
      }
      bookingMap.get(ref).servicios.push({
        diaSec:       row.Dia_Sec,
        fecha:        toDateStr(row.Service_Date),
        servicio:     row.Servicio,
        supplier:     row.Supplier_Name,
        confirmation: row.supplier_confirmation,
        tpStatus:     row.Service_status,
        tpStatusName: row.Service_StatusName,
        pickupTime:   toTimeStr(row.pickup_time),
        dropoffTime:  toTimeStr(row.dropoff_time),
        pickup:       row.Pickup,
        dropoff:      row.Dropoff,
        pax:          row.Total_Pax,
      });
    }

    results.log.push(`Processing ${bookingMap.size} confirmed bookings`);

    for (const [ref, booking] of bookingMap) {
      try {
        let fileId;
        const now = new Date().toISOString();

        // Upsert file
        const fileData = {
          nro_file:           ref,
          fecha_in:           booking.travelDate,
          fecha_out:          booking.lastDate,
          operador_nombre:    booking.operador || '',
          dh_gr_nombre:       booking.gr || '',
          pasajero_principal: booking.pasajero || null,
          tp_ref:             ref,
          tp_status:          booking.status,
          tp_synced_at:       now,
          updated_at:         now,
        };

        if (!dryRun) {
          const { data: existingFile } = await supabase
            .from('files').select('id').eq('tp_ref', ref).maybeSingle();

          if (existingFile) {
            await supabase.from('files').update(fileData).eq('id', existingFile.id);
            fileId = existingFile.id;
            results.files_updated++;
          } else {
            const { data: newFile, error: fileErr } = await supabase
              .from('files').insert(fileData).select('id').single();
            if (fileErr) throw new Error(`File insert: ${fileErr.message}`);
            fileId = newFile.id;
            results.files_created++;
          }
        } else {
          fileId = 'dry-run-' + ref;
          results.files_created++;
        }

        // Upsert servicios GU como eventos
        for (const svc of booking.servicios) {
          try {
            const guiaId = await matchGuia(supabase, svc.supplier);
            const designar = isDesignar(svc.supplier);

            if (guiaId) results.guias_matched++;
            if (designar) results.a_designar++;

            const eventoData = {
              file_id:           fileId,
              tipo_evento:       svc.servicio || 'Servicio de Guía',
              fecha:             svc.fecha,
              hora_inicio:       svc.pickupTime || null,
              hora_fin:          svc.dropoffTime || null,
              pickup_location:   svc.pickup || null,
              dropoff_location:  svc.dropoff || null,
              estado:            guiaId ? 'CONFIRMADO' : 'A_ASIGNAR',
              guia_id:           guiaId || null,
              tp_dia_sec:        svc.diaSec,
              tp_supplier_name:  svc.supplier || null,
              tp_service_status: svc.tpStatus || null,
              tp_synced_at:      now,
            };

            if (!dryRun) {
              const { data: existingEvt } = await supabase
                .from('eventos')
                .select('id, estado, guia_id')
                .eq('file_id', fileId)
                .eq('tp_dia_sec', svc.diaSec)
                .eq('fecha', svc.fecha)
                .maybeSingle();

              if (existingEvt) {
                const updateData = {
                  tipo_evento:       eventoData.tipo_evento,
                  hora_inicio:       eventoData.hora_inicio,
                  hora_fin:          eventoData.hora_fin,
                  pickup_location:   eventoData.pickup_location,
                  dropoff_location:  eventoData.dropoff_location,
                  tp_supplier_name:  eventoData.tp_supplier_name,
                  tp_service_status: eventoData.tp_service_status,
                  tp_synced_at:      eventoData.tp_synced_at,
                };
                // Solo actualizar asignación si aún A_ASIGNAR
                if (existingEvt.estado === 'A_ASIGNAR' && guiaId) {
                  updateData.estado = 'CONFIRMADO';
                  updateData.guia_id = guiaId;
                }
                await supabase.from('eventos').update(updateData).eq('id', existingEvt.id);
                results.eventos_updated++;
              } else {
                await supabase.from('eventos').insert(eventoData);
                results.eventos_created++;
              }
            } else {
              results.eventos_created++;
            }
          } catch (svcErr) {
            results.errors.push(`${ref}/${svc.diaSec}: ${svcErr.message}`);
          }
        }
      } catch (bookingErr) {
        results.errors.push(`${ref}: ${bookingErr.message}`);
      }
    }

    return res.status(200).json({
      success: true,
      dryRun,
      bookings_processed: bookingMap.size,
      ...results,
    });

  } catch (err) {
    console.error('TP sync error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (pool) { try { await pool.close(); } catch {} }
  }
};
