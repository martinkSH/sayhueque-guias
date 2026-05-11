// api/tp-query.js
// Read-only ad-hoc query endpoint against the TourPlan MSSQL database.
// Designed for the local /tp-query Claude Code skill, NOT for the frontend.
//
// Auth: Authorization: Bearer <TP_QUERY_SECRET>  (env var on Vercel)
// Validation:
//   - method must be POST
//   - body.sql must be a single SELECT/WITH statement
//   - rejects DDL (DROP/ALTER/CREATE/TRUNCATE), DML (INSERT/UPDATE/DELETE/MERGE),
//     EXEC/EXECUTE, GO batches, and multiple statements (no `;` other than trailing)
// Limits:
//   - 5000 rows max returned
//   - 60s query timeout
import sql from 'mssql';

function getTPConfig() {
  return {
    server:   process.env.TP_SERVER   || 'LA-SAYHUE.data.tourplan.net',
    port:     Number(process.env.TP_PORT || 50409),
    database: process.env.TP_DATABASE || 'LA-SAYHUE',
    user:     process.env.TP_USER     || 'excelLA-SAYHUE',
    password: process.env.TP_PASSWORD,
    options: { encrypt: true, trustServerCertificate: true, connectTimeout: 30000, requestTimeout: 60000 },
  };
}

const FORBIDDEN = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec|execute|sp_|xp_|bulk|backup|restore|shutdown|kill|use)\b/i;
const MAX_ROWS = 5000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth via shared secret — this endpoint is reached from the local CLI skill,
  // not from the browser, so Supabase JWT auth doesn't apply.
  const expectedSecret = process.env.TP_QUERY_SECRET;
  if (!expectedSecret) return res.status(500).json({ error: 'TP_QUERY_SECRET not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token !== expectedSecret) return res.status(401).json({ error: 'Invalid or missing Authorization header' });

  const { sql: rawSql } = req.body || {};
  if (typeof rawSql !== 'string' || !rawSql.trim()) {
    return res.status(400).json({ error: 'Missing body.sql' });
  }

  // Strip block + line comments BEFORE the keyword/statement checks so people
  // can't smuggle write statements past the regex with /* ... */ tricks.
  const stripped = rawSql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();

  if (!stripped) return res.status(400).json({ error: 'SQL is empty after stripping comments' });

  // Allow exactly one statement. A trailing semicolon is fine; anything else
  // (semicolon followed by more SQL) is rejected as a multi-statement attempt.
  const noTrailingSemi = stripped.replace(/;\s*$/, '');
  if (noTrailingSemi.includes(';')) {
    return res.status(400).json({ error: 'Multiple statements not allowed' });
  }

  // Must start with SELECT or WITH (CTE) — case-insensitive.
  if (!/^\s*(select|with)\b/i.test(noTrailingSemi)) {
    return res.status(400).json({ error: 'Only SELECT / WITH statements are allowed' });
  }

  // Forbidden keywords as whole words. /USE database/ is also blocked because
  // we don't want users switching to system databases.
  if (FORBIDDEN.test(noTrailingSemi)) {
    return res.status(400).json({ error: 'Statement contains a forbidden keyword (read-only endpoint)' });
  }

  let pool = null;
  try {
    pool = await sql.connect(getTPConfig());
    const result = await pool.request().query(noTrailingSemi);
    const rowset = result.recordset || [];
    const truncated = rowset.length > MAX_ROWS;
    return res.status(200).json({
      success: true,
      rowCount: rowset.length,
      truncated,
      rows: truncated ? rowset.slice(0, MAX_ROWS) : rowset,
    });
  } catch (err) {
    console.error('tp-query error:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (pool) try { await pool.close(); } catch {}
  }
}
