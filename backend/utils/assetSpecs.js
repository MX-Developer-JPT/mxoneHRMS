// Asset specifications — one configurable field schema per asset CATEGORY (mobile, laptop, tablet, ...), plus any custom
// fields HR adds to an Asset Type from the screen (no code change). The same resolved schema drives:
//   • the Add / Edit Asset form (rendered from the schema, not hard-coded per asset),
//   • server-side validation (required on create, IMEI format, unique IMEI / serial / registration numbers),
//   • the handover letter (only the fields that apply to the asset and are filled in are printed).
//
// Field shape: { key, label, type, core?, required?, unique?, show?, col?, options?, placeholder? }
//   type    text | number | date | select | imei | textarea
//   core    true  -> stored on the asset itself (serial_number, model_number, accessories, condition, purchase_date,
//                    warranty_expiry); otherwise stored under asset.specs[key]
//   unique  a group name; two assets may not hold the same value inside one group (imei_1 and imei_2 share 'imei')
//   show    false -> kept on record but never printed on the letter (default: printed when filled in)
//   col     letter column the value is printed in: 'details' (default) | 'item' | 'remarks'
import { createHash } from 'crypto';

const CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'];
const F = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });

const BRAND = F('brand', 'Manufacturer / Brand', { required: true, placeholder: 'e.g., Dell' });
const MODEL = F('model_name', 'Model Name', { required: true, placeholder: 'e.g., Latitude 5430' });
const SERIAL = (req = false) => F('serial_number', 'Serial Number', { core: true, unique: 'serial', required: req });
const MODELNO = F('model_number', 'Model Number', { core: true, col: 'item' });
const ACCESSORIES = F('accessories', 'Accessories issued', { core: true, col: 'accessories', placeholder: 'e.g., Charger, cable, adapter, cover' });
const CONDITION = F('condition', 'Physical Condition', { core: true, type: 'select', options: CONDITIONS, col: 'remarks' });
const PURCHASE = F('purchase_date', 'Date of Purchase', { core: true, type: 'date', show: false });
const WARRANTY = F('warranty_expiry', 'Warranty Expiry', { core: true, type: 'date', show: false });
const REMARKS = F('letter_remarks', 'Remarks for the letter', { col: 'remarks', placeholder: 'Optional note printed in Remarks' });
const COMMON_TAIL = [ACCESSORIES, CONDITION, PURCHASE, WARRANTY, REMARKS];
const STORAGE_TYPES = ['SSD', 'NVMe SSD', 'HDD', 'SSD + HDD', 'eMMC'];

export const CATEGORIES = {
  mobile: { label: 'Mobile Phone', fields: [
    BRAND, MODEL, MODELNO,
    F('imei_1', 'IMEI Number 1', { type: 'imei', unique: 'imei', required: true }),
    F('imei_2', 'IMEI Number 2 (if dual SIM)', { type: 'imei', unique: 'imei' }),
    SERIAL(),
    F('ram', 'RAM', { placeholder: 'e.g., 8 GB' }), F('storage', 'Internal Storage', { placeholder: 'e.g., 256 GB' }),
    F('colour', 'Colour'), F('os', 'Operating System', { placeholder: 'e.g., Android 15' }),
    F('sim_number', 'Mobile Number / SIM Number (if company-issued)', { unique: 'mobile' }),
    ...COMMON_TAIL] },
  laptop: { label: 'Laptop', fields: [
    BRAND, MODEL, MODELNO, SERIAL(true),
    F('device_name', 'Device Name'), F('processor', 'Processor', { placeholder: 'e.g., Intel Core i5-1235U' }),
    F('ram', 'RAM', { placeholder: 'e.g., 16 GB' }), F('storage', 'Storage Capacity', { placeholder: 'e.g., 512 GB' }),
    F('storage_type', 'Storage Type', { type: 'select', options: STORAGE_TYPES }),
    F('graphics', 'Graphics Card (if applicable)'), F('os', 'Operating System', { placeholder: 'e.g., Windows 11 Pro' }),
    F('screen_size', 'Screen Size', { placeholder: 'e.g., 14 inch' }),
    F('device_id', 'Device ID', { col: 'item' }), F('product_id', 'Product ID', { col: 'item' }),
    ...COMMON_TAIL] },
  desktop: { label: 'Desktop Computer', fields: [
    BRAND, MODEL, MODELNO, SERIAL(true),
    F('device_name', 'Device Name'), F('processor', 'Processor'), F('ram', 'RAM'), F('storage', 'Storage Capacity'),
    F('storage_type', 'Storage Type', { type: 'select', options: STORAGE_TYPES }),
    F('graphics', 'Graphics Card (if applicable)'), F('os', 'Operating System'),
    F('device_id', 'Device ID', { col: 'item' }), F('product_id', 'Product ID', { col: 'item' }),
    ...COMMON_TAIL] },
  tablet: { label: 'Tablet', fields: [
    BRAND, MODEL, MODELNO, SERIAL(true),
    F('imei_1', 'IMEI Number (if applicable)', { type: 'imei', unique: 'imei' }),
    F('ram', 'RAM'), F('storage', 'Storage'), F('screen_size', 'Screen Size'), F('os', 'Operating System'),
    F('colour', 'Colour'), ...COMMON_TAIL] },
  monitor: { label: 'Monitor', fields: [
    BRAND, MODEL, MODELNO, SERIAL(true),
    F('screen_size', 'Screen Size', { required: true, placeholder: 'e.g., 24 inch' }),
    F('resolution', 'Resolution', { placeholder: 'e.g., 1920 x 1080' }), F('panel_type', 'Panel Type'),
    F('ports', 'Ports / Connectivity', { placeholder: 'e.g., HDMI, VGA, DisplayPort' }),
    ...COMMON_TAIL] },
  printer: { label: 'Printer / Scanner', fields: [
    BRAND, MODEL, MODELNO, SERIAL(true),
    F('printer_type', 'Type', { type: 'select', options: ['Laser', 'Inkjet', 'Multifunction', 'Thermal', 'Dot Matrix', 'Scanner'] }),
    F('connectivity', 'Connectivity', { placeholder: 'e.g., USB, Wi-Fi, LAN' }),
    ...COMMON_TAIL] },
  network: { label: 'Networking Equipment', fields: [
    BRAND, MODEL, MODELNO, SERIAL(true),
    F('device_type', 'Device Type', { placeholder: 'e.g., Switch, Router, Access Point' }), F('ports', 'Ports'),
    F('mac_address', 'MAC Address', { unique: 'mac' }), F('ip_address', 'IP Address', { show: false }),
    ...COMMON_TAIL] },
  sim: { label: 'SIM Card / Dongle', fields: [
    F('operator', 'Operator / Plan', { required: true, placeholder: 'e.g., Airtel 5G Plus' }),
    F('mobile_number', 'Mobile Number', { required: true, unique: 'mobile', placeholder: '+91 ...' }),
    F('sim_serial', 'SIM Serial (ICCID)', { unique: 'sim' }),
    ACCESSORIES, CONDITION, PURCHASE, REMARKS] },
  office_equipment: { label: 'Office Equipment', fields: [
    BRAND, MODEL, MODELNO, SERIAL(false), F('description', 'Description / Capacity'), ...COMMON_TAIL] },
  furniture: { label: 'Furniture', fields: [
    F('item_description', 'Item Description', { required: true, placeholder: 'e.g., Ergonomic office chair' }),
    F('material', 'Material'), F('colour', 'Colour'), F('dimensions', 'Dimensions'),
    CONDITION, PURCHASE, REMARKS] },
  vehicle: { label: 'Company Vehicle', fields: [
    F('make', 'Make', { required: true }), F('vehicle_model', 'Model / Variant', { required: true }),
    F('registration_number', 'Registration Number', { required: true, unique: 'regno' }),
    F('chassis_number', 'Chassis Number', { unique: 'chassis' }), F('engine_number', 'Engine Number'),
    F('fuel_type', 'Fuel Type', { type: 'select', options: ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'] }),
    F('colour', 'Colour'), F('insurance_expiry', 'Insurance Valid Till', { type: 'date' }), F('puc_expiry', 'PUC Valid Till', { type: 'date', show: false }),
    ACCESSORIES, CONDITION, PURCHASE, REMARKS] },
  other: { label: 'Other / Miscellaneous', fields: [
    F('brand', 'Manufacturer / Brand'), F('model_name', 'Model Name'), MODELNO, SERIAL(false),
    F('description', 'Description'), ...COMMON_TAIL] },
};

// Which category an asset type uses: the one HR picked on the type, else guessed from its name / icon.
export function categoryOf(type) {
  const t = type || {};
  if (t.spec_category && CATEGORIES[t.spec_category]) return t.spec_category;
  const n = String(t.name || '').toLowerCase();
  const icon = String(t.icon || '').toLowerCase();
  if (/\bsim\b|dongle/.test(n) || icon === 'sim') return 'sim';
  if (/mobile|smart ?phone|handset|cell/.test(n) || icon === 'smartphone') return 'mobile';
  if (/tablet|ipad/.test(n) || icon === 'tablet') return 'tablet';
  if (/laptop|notebook/.test(n) || icon === 'laptop') return 'laptop';
  if (/desktop|cpu|tower|computer/.test(n) || icon === 'desktop' || icon === 'cpu') return 'desktop';
  if (/monitor|display|screen|tv|television|projector/.test(n) || ['monitor', 'tv', 'projector'].includes(icon)) return 'monitor';
  if (/printer|scanner/.test(n) || ['printer', 'scanner'].includes(icon)) return 'printer';
  if (/router|switch|network|wifi|wi-fi|modem|access point|server/.test(n) || ['router', 'network_switch', 'wifi', 'server'].includes(icon)) return 'network';
  if (/vehicle|car\b|bike|scooter|truck|van\b/.test(n) || icon === 'vehicle') return 'vehicle';
  if (/chair|desk|table|furniture|cabinet|sofa/.test(n) || ['chair', 'desk'].includes(icon)) return 'furniture';
  if (/phone|landline|ac\b|air condition|coffee|fire|camera|cctv|tool|keyboard|mouse|headphone|cable|drive|usb/.test(n) || ['phone', 'ac', 'coffee_machine', 'fire_extinguisher', 'camera', 'tools', 'keyboard', 'mouse', 'headphones', 'cable', 'hard_drive', 'usb'].includes(icon)) return 'office_equipment';
  return 'other';
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

// Custom fields HR added to the type: sanitised so a bad row can never break the form or the letter.
export function cleanCustomFields(list) {
  const seen = new Set(); const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    const label = String(f?.label || '').trim().slice(0, 60);
    if (!label) continue;
    let key = slug(f.key || label) || 'field';
    key = 'x_' + key.replace(/^x_/, '');
    while (seen.has(key)) key += '_2';
    seen.add(key);
    const type = ['text', 'number', 'date', 'select', 'textarea'].includes(f.type) ? f.type : 'text';
    const options = type === 'select' ? [...new Set((Array.isArray(f.options) ? f.options : String(f.options || '').split(',')).map(o => String(o).trim()).filter(Boolean))].slice(0, 30) : undefined;
    out.push({ key, label, type, required: !!f.required, unique: f.unique ? key : undefined, show: f.show !== false, custom: true, ...(options ? { options } : {}) });
    if (out.length >= 30) break;
  }
  return out;
}

export function resolveSchema(type) {
  const cat = categoryOf(type);
  return { category: cat, category_label: CATEGORIES[cat].label, fields: [...CATEGORIES[cat].fields, ...cleanCustomFields(type?.custom_fields)] };
}

export function allSchemas() {
  return Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, { label: v.label, fields: v.fields }]));
}

export const valueOf = (asset, f) => {
  const v = f.core ? asset?.[f.key] : asset?.specs?.[f.key];
  return v === undefined || v === null ? '' : String(v).trim();
};

const PLACEHOLDERS = new Set(['', 'n/a', 'na', 'nil', 'none', '-', '--', 'null', 'not available', 'not applicable']);
export const isBlank = (v) => PLACEHOLDERS.has(String(v ?? '').trim().toLowerCase());

// Comparable form of a unique identifier: an IMEI written "354845699377594/12" equals "354845699377594".
export function normId(group, v) {
  let s = String(v ?? '').trim().toLowerCase();
  if (group === 'imei') s = s.replace(/\/\d{1,2}$/, '').replace(/[\s-]/g, '');
  else if (group === 'mobile') s = s.replace(/[^\d]/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  else s = s.replace(/[\s-]/g, '');
  return s;
}

export function imeiProblem(v) {
  const s = String(v).trim().replace(/\/\d{1,2}$/, '').replace(/[\s-]/g, '');
  return /^\d{14,16}$/.test(s) ? null : 'must be the 15-digit IMEI number (digits only)';
}

/**
 * What is wrong with this asset record, or null.
 *  data     the asset as it will be stored; current  the stored version (null on create)
 *  type     its AssetType;  others  every OTHER asset (for unique checks)
 * Required fields are enforced by the form (bulk imports and older assets legitimately lack some); the server checks formats
 * and uniqueness whenever a value is new or changed, so a legacy duplicate never blocks an unrelated edit.
 */
export function assetProblem(data, current, type, others) {
  const schema = resolveSchema(type).fields;
  for (const f of schema) {
    const v = valueOf(data, f);
    const was = current ? valueOf(current, f) : '';
    const changed = !current || v !== was;
    if (isBlank(v) || !changed) continue;
    if (f.type === 'imei') { const p = imeiProblem(v); if (p) return `${f.label} ${p}.`; }
    if (f.type === 'select' && f.options && !f.options.map(o => String(o).toLowerCase()).includes(v.toLowerCase())) return `${f.label}: "${v}" is not one of the allowed choices.`;
    if (f.type === 'number' && !Number.isFinite(Number(v))) return `${f.label} must be a number.`;
    if (f.unique) {
      const want = normId(f.unique, v);
      for (const o of others || []) {
        if (o.id === data.id) continue;
        for (const g of schema.filter(x => x.unique === f.unique)) {
          const ov = valueOf(o, g);
          if (!isBlank(ov) && normId(f.unique, ov) === want) return `${f.label} "${v}" is already registered on asset ${o.asset_id || o.id} (${o.asset_name || 'unnamed'}).`;
        }
      }
      // the same value typed into two fields of this very asset (IMEI 1 = IMEI 2)
      for (const g of schema.filter(x => x.unique === f.unique && x.key !== f.key)) {
        const sv = valueOf(data, g);
        if (!isBlank(sv) && normId(f.unique, sv) === want) return `${f.label} and ${g.label} cannot be the same number.`;
      }
    }
  }
  return null;
}

// Only the specs[] keys that belong to the schema survive, trimmed — the form can never inject arbitrary keys.
export function cleanSpecs(specs, type) {
  const keys = new Set(resolveSchema(type).fields.filter(f => !f.core).map(f => f.key));
  const out = {};
  for (const [k, v] of Object.entries(specs && typeof specs === 'object' ? specs : {})) if (keys.has(k)) out[k] = String(v ?? '').trim().slice(0, 500);
  return out;
}

// Fingerprint of everything the letter shows, so the screen can tell a letter is out of date once the asset changed.
export function specFingerprint(asset, type) {
  const fields = resolveSchema(type).fields;
  const parts = [asset.asset_name, asset.asset_id, asset.assigned_to_user_id, asset.specification || '', ...fields.map(f => `${f.key}=${valueOf(asset, f)}`)];
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12);
}

// Which fields changed between two versions of an asset (for the audit trail).
export function specChanges(before, after, type) {
  const out = [];
  const fields = resolveSchema(type).fields;
  for (const f of fields) {
    const a = before ? valueOf(before, f) : ''; const b = valueOf(after, f);
    if (a !== b) out.push({ label: f.label, from: a, to: b });
  }
  return out;
}
