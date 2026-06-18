import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * eSSL eBioServerNew Biometric Webhook Handler
 * Always returns 200 "Success" so eBioServer does not retry.
 */

async function decryptAES256CBC(encryptedBase64, password) {
  let key = password;
  while (key.length < 32) key += '1';
  key = key.substring(0, 32);
  const keyBytes = new TextEncoder().encode(key);
  const iv = keyBytes.slice(0, 16);
  const cleanBase64 = encryptedBase64.replace(/\s+/g, '');
  const encryptedBytes = Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, encryptedBytes);
  return new TextDecoder().decode(decrypted);
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function normaliseDate(raw) {
  if (!raw) return null;
  if (typeof raw === 'number') return new Date(raw).toISOString();
  const s = String(raw).trim();
  if (!s) return null;
  if (/Z$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  let isoStr = s;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) isoStr = s.replace(' ', 'T');
  const dmy = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
  if (dmy) isoStr = `${dmy[3]}-${dmy[2]}-${dmy[1]}T${dmy[4] || '00:00:00'}`;
  const naive = new Date(isoStr);
  if (isNaN(naive.getTime())) return null;
  return new Date(naive.getTime() - IST_OFFSET_MS).toISOString();
}

function getField(obj, ...names) {
  if (!obj) return undefined;
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null && obj[name] !== '') return obj[name];
    const lower = name.toLowerCase();
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === lower && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
  }
  return undefined;
}

function extractEmpCode(obj) {
  return getField(obj,
    'EmployeeCode', 'employeeCode', 'employee_code', 'EmpCode', 'empCode', 'empcode',
    'EnrollNumber', 'enrollnumber', 'enroll_number', 'UserID', 'userid', 'user_id',
    'PinCode', 'pincode', 'pin', 'BadgeNo', 'badgeno', 'badge_no', 'CardNo', 'cardno'
  );
}

function extractLogDate(obj) {
  return getField(obj,
    'LogDate', 'logDate', 'log_date', 'LogDateTime', 'logdatetime',
    'Timestamp', 'timestamp', 'PunchTime', 'punchtime', 'AttendanceTime', 'attendancetime',
    'CheckTime', 'checktime', 'DateTime', 'datetime', 'Time', 'time', 'PunchDateTime'
  );
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Build a local dedup set from existing logs to avoid per-record API calls
async function buildExistingLogSet(base44) {
  const existing = new Set();
  let skip = 0;
  const PAGE_SIZE = 200;
  while (true) {
    const page = await base44.asServiceRole.entities.AttendanceLog.list('-LogDate', PAGE_SIZE, skip);
    if (!page || page.length === 0) break;
    for (const log of page) {
      if (log.EmployeeCode && log.LogDate) {
        existing.add(`${log.EmployeeCode}__${log.LogDate}`);
      }
    }
    if (page.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    await sleep(300);
  }
  return existing;
}

Deno.serve(async (req) => {
  const successResponse = () => new Response('Success', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' }
  });

  try {
    const base44 = createClientFromRequest(req);
    const url = new URL(req.url);
    const contentType = (req.headers.get('content-type') || '').toLowerCase();
    const method = req.method;

    const qParams = Object.fromEntries(url.searchParams.entries());
    console.log(`Method: ${method} | Content-Type: ${contentType} | Query params: ${JSON.stringify(qParams)}`);

    let records = [];

    // PRIORITY 1: Query string params
    if (Object.keys(qParams).length > 0) {
      const empCode = extractEmpCode(qParams);
      const logDate = extractLogDate(qParams);
      if (empCode || logDate) {
        console.log('SOURCE: query params | empCode:', empCode, '| logDate:', logDate);
        records = [qParams];
      }
    }

    // PRIORITY 2: Request body
    if (records.length === 0) {
      const bodyText = await req.text();
      console.log('Body length:', bodyText.length, '| Body (first 500):', bodyText.substring(0, 500));

      if (bodyText && bodyText.trim().length > 2) {
        const trimmed = bodyText.trim();

        if (trimmed.startsWith('{')) {
          try {
            const bodyJson = JSON.parse(trimmed);
            const keys = Object.keys(bodyJson);
            if (typeof bodyJson.data === 'string' && keys.length <= 2 && !extractEmpCode(bodyJson)) {
              console.log('MODE: encrypted payload, decrypting...');
              const password = Deno.env.get('EBIO_WEBHOOK_PASSWORD') || '';
              const decrypted = await decryptAES256CBC(bodyJson.data, password);
              const parsed = JSON.parse(decrypted);
              records = Array.isArray(parsed) ? parsed : [parsed];
            } else {
              console.log('MODE: plain JSON object');
              records = [bodyJson];
            }
          } catch (e) {
            console.error('JSON parse error:', e.message);
          }
        }

        if (records.length === 0 && trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            records = Array.isArray(parsed) ? parsed : [];
            console.log('MODE: JSON array, count:', records.length);
          } catch (e) {
            console.error('JSON array parse error:', e.message);
          }
        }

        if (records.length === 0) {
          try {
            const formObj = Object.fromEntries(new URLSearchParams(trimmed).entries());
            if (extractEmpCode(formObj) || extractLogDate(formObj)) {
              records = [formObj];
            }
          } catch (e) {
            console.error('Form parse error:', e.message);
          }
        }

        if (records.length === 0 && trimmed.includes('=')) {
          try {
            const rawObj = {};
            trimmed.split('&').forEach(pair => {
              const [k, v] = pair.split('=');
              if (k) rawObj[decodeURIComponent(k)] = decodeURIComponent(v || '');
            });
            if (extractEmpCode(rawObj) || extractLogDate(rawObj)) {
              records = [rawObj];
            }
          } catch (e) {
            console.error('Raw KV parse error:', e.message);
          }
        }
      }
    }

    if (records.length === 0) {
      console.warn('No records extracted. This may be a test/ping from eBioServer.');
      return successResponse();
    }

    console.log('Records to process:', records.length);

    // Build dedup set once (avoids N per-record filter calls → prevents rate limiting)
    const existingLogSet = await buildExistingLogSet(base44);

    let saved = 0;
    const savedDates = new Set();
    const toCreate = [];

    // Filter out duplicates locally
    for (const record of records) {
      const empCode = String(extractEmpCode(record) || '').trim();
      const logDateRaw = extractLogDate(record);
      const logDate = normaliseDate(logDateRaw);

      if (!empCode || !logDate) {
        console.error('Skipping record - missing empCode or logDate:', JSON.stringify(Object.keys(record || {})));
        continue;
      }

      const dedupKey = `${empCode}__${logDate}`;
      if (existingLogSet.has(dedupKey)) {
        console.log(`Duplicate skipped: empCode=${empCode}, LogDate=${logDate}`);
        continue;
      }

      toCreate.push({
        EmployeeCode: empCode,
        DownloadDate: normaliseDate(getField(record, 'DownloadDate', 'downloadDate', 'download_date')) || '',
        LogDate: logDate,
        DeviceName: String(getField(record, 'DeviceName', 'deviceName', 'device_name', 'Device', 'MachineName', 'machinename', 'MachineAlias') || ''),
        SerialNumber: String(getField(record, 'SerialNumber', 'serialNumber', 'serial_number', 'SN', 'sn') || ''),
        Direction: String(getField(record, 'Direction', 'direction', 'PunchType', 'punchtype', 'InOutMode', 'inoutmode', 'InOut', 'inout') || ''),
        DeviceDirection: String(getField(record, 'DeviceDirection', 'deviceDirection') || ''),
        WorkCode: String(getField(record, 'WorkCode', 'workCode') || ''),
        VerificationType: String(getField(record, 'VerificationType', 'verificationType', 'VerifyMode', 'verifymode') || ''),
        GPS: String(getField(record, 'GPS', 'gps', 'Location', 'location') || ''),
        ProcessedAt: new Date().toISOString(),
      });

      // Track IST date for auto-processing
      const istDate = new Date(new Date(logDate).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
      savedDates.add(istDate);
    }

    // Batch create in chunks of 20 with a small delay between chunks
    const CHUNK_SIZE = 20;
    for (let i = 0; i < toCreate.length; i += CHUNK_SIZE) {
      const chunk = toCreate.slice(i, i + CHUNK_SIZE);
      for (const rec of chunk) {
        try {
          await base44.asServiceRole.entities.AttendanceLog.create(rec);
          saved++;
        } catch (e) {
          console.error('Failed to save record:', e.message);
        }
      }
      if (i + CHUNK_SIZE < toCreate.length) await sleep(500);
    }

    console.log(`Saved ${saved} of ${records.length} records`);

    // Auto-trigger processEbioLogs for affected dates (fire-and-forget)
    if (saved > 0 && savedDates.size > 0) {
      const dates = [...savedDates].sort();
      const dateFrom = dates[0];
      const dateTo = dates[dates.length - 1];
      console.log(`Auto-processing logs for dates: ${dateFrom} to ${dateTo}`);
      base44.asServiceRole.functions.invoke('processEbioLogs', { date_from: dateFrom, date_to: dateTo })
        .then(r => console.log('Auto-process result:', JSON.stringify(r?.data || r)))
        .catch(e => console.error('Auto-process error:', e.message));
    }

    return successResponse();

  } catch (error) {
    console.error('ebioWebhook fatal error:', error.message, error.stack);
    return successResponse();
  }
});