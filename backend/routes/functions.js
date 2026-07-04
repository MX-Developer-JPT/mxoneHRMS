import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { one, all, run, q } from '../db.js';
import { JWT_SECRET } from './auth.js';
import { callAI, callAIMessages } from '../utils/ai.js';
import { sendEmail, emailTemplates } from '../utils/email.js';
import { buildSessions, computeStatusFromSessions } from './attendancelog.js';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const _require  = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── Shared: extract pdfmake VFS fonts to tmpdir on first call ── */
let _pdfFontsDir = null;
function getPdfmakeFontsDir() {
  if (_pdfFontsDir) return _pdfFontsDir;
  const { mkdirSync, writeFileSync, existsSync } = _require('fs');
  const os = _require('os');
  const dir = join(os.tmpdir(), 'mx-pdfmake-fonts');
  if (!existsSync(dir) || !existsSync(join(dir, 'Roboto-Regular.ttf'))) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const vfsModule = _require('pdfmake/build/vfs_fonts');
    const vfs = vfsModule.pdfMake?.vfs || vfsModule.vfs || vfsModule;
    for (const [name, b64] of Object.entries(vfs)) {
      writeFileSync(join(dir, name), Buffer.from(b64, 'base64'));
    }
  }
  _pdfFontsDir = dir;
  return dir;
}

/* ── Shared: get pdfmake PdfPrinter with Roboto fonts ── */
function getPdfPrinter() {
  const PdfPrinter = _require('pdfmake/src/printer');
  const fontsDir = getPdfmakeFontsDir();
  return new PdfPrinter({
    Roboto: {
      normal:      join(fontsDir, 'Roboto-Regular.ttf'),
      bold:        join(fontsDir, 'Roboto-Medium.ttf'),
      italics:     join(fontsDir, 'Roboto-Italic.ttf'),
      bolditalics: join(fontsDir, 'Roboto-MediumItalic.ttf'),
    },
  });
}

/* ── Shared: render a pdfmake docDef to a Buffer ── */
function renderPdf(docDef) {
  return new Promise((resolve, reject) => {
    try {
      const printer = getPdfPrinter();
      const chunks = [];
      const doc = printer.createPdfKitDocument(docDef);
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (e) { reject(e); }
  });
}

/* ── Shared: parse HTML letter content into pdfmake content nodes ── */
function htmlLetterToPdfContent(html) {
  const decode = s => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  const stripTags = s => s.replace(/<[^>]*>/g, '');

  const parseInline = (s) => {
    const parts = [];
    const re = /(<strong[^>]*>([\s\S]*?)<\/strong>|<b[^>]*>([\s\S]*?)<\/b>|<br\s*\/?>)/gi;
    let last = 0, m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) {
        const text = decode(stripTags(s.slice(last, m.index)));
        if (text) parts.push(text);
      }
      if (/^<br/i.test(m[0])) {
        parts.push('\n');
      } else {
        const inner = decode(stripTags(m[2] ?? m[3] ?? ''));
        if (inner) parts.push({ text: inner, bold: true });
      }
      last = m.index + m[0].length;
    }
    const tail = decode(stripTags(s.slice(last)));
    if (tail) parts.push(tail);
    if (parts.length === 0) return '';
    if (parts.length === 1 && typeof parts[0] === 'string') return parts[0];
    return parts;
  };

  const nodes = [];
  let rem = html.replace(/^<div[^>]*>|<\/div>\s*$/gi, '').trim();

  while (rem.length > 0) {
    rem = rem.trimStart();
    if (!rem) break;

    // TABLE
    const tbl = rem.match(/^<table[^>]*>([\s\S]*?)<\/table>/i);
    if (tbl) {
      const rows = [];
      for (const [, rowHtml] of tbl[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [];
        for (const [, cellHtml] of rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)) {
          cells.push({ text: parseInline(cellHtml.trim()), margin: [0, 3, 12, 3], fontSize: 10.5 });
        }
        if (cells.length) rows.push(cells);
      }
      if (rows.length) {
        nodes.push({ table: { widths: rows[0].map((_, i) => i === 0 ? 'auto' : '*'), body: rows }, layout: 'noBorders', margin: [0, 6, 0, 10] });
      }
      rem = rem.slice(tbl[0].length);
      continue;
    }

    // UL
    const ul = rem.match(/^<ul[^>]*>([\s\S]*?)<\/ul>/i);
    if (ul) {
      const items = [];
      for (const [, liHtml] of ul[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
        const parsed = parseInline(liHtml.trim());
        if (parsed) items.push({ text: parsed, fontSize: 10.5 });
      }
      if (items.length) nodes.push({ ul: items, margin: [0, 4, 0, 10] });
      rem = rem.slice(ul[0].length);
      continue;
    }

    // P
    const p = rem.match(/^<p([^>]*)>([\s\S]*?)<\/p>/i);
    if (p) {
      const attrs = p[1], inner = p[2].trim();
      const isBold = /font-weight\s*:\s*bold/i.test(attrs) || /font-weight\s*:\s*bold/i.test(inner);
      const align  = /text-align\s*:\s*center/i.test(attrs) ? 'center' : /text-align\s*:\s*right/i.test(attrs) ? 'right' : 'justify';
      const parsed = parseInline(inner);
      if (parsed !== '' && !(Array.isArray(parsed) && parsed.length === 0)) {
        nodes.push({ text: parsed, bold: isBold || undefined, alignment: align, margin: isBold ? [0, 12, 0, 3] : [0, 0, 0, 8], fontSize: 10.5, lineHeight: 1.65 });
      }
      rem = rem.slice(p[0].length);
      continue;
    }

    // Skip any other opening tag
    const tag = rem.match(/^<[^>]+>/);
    if (tag) { rem = rem.slice(tag[0].length); continue; }

    // Raw text before next tag
    const next = rem.indexOf('<');
    if (next === -1) { const t = decode(rem.trim()); if (t) nodes.push({ text: t, fontSize: 10.5 }); break; }
    const t = decode(rem.slice(0, next).trim());
    if (t) nodes.push({ text: t, fontSize: 10.5, margin: [0, 0, 0, 6] });
    rem = rem.slice(next);
  }
  return nodes;
}

/* ── Shared: build Maxvolt letterhead PDF with parsed HTML content ── */
async function buildLetterPdf(label, ref, htmlContent) {
  const { readFileSync, existsSync } = _require('fs');
  const logoPath = join(__dirname, '../assets/maxvolt-logo.jpg');
  const logoDataUrl = existsSync(logoPath)
    ? `data:image/jpeg;base64,${readFileSync(logoPath).toString('base64')}`
    : null;

  const content = htmlLetterToPdfContent(htmlContent);

  const headerFn = (currentPage, pageCount, pageSize) => {
    const W = pageSize.width;
    const seg1 = W * (1.6 / 6), seg2 = W * (3.6 / 6), seg3 = W * (0.8 / 6);
    const orangeBar = { canvas: [
      { type: 'rect', x: 0,          y: 0, w: seg1, h: 12, color: '#e87722' },
      { type: 'rect', x: seg1,       y: 0, w: seg2, h: 12, color: '#f4a83a' },
      { type: 'rect', x: seg1 + seg2, y: 0, w: seg3, h: 12, color: '#e87722' },
    ]};
    const logoRow = logoDataUrl
      ? { image: 'logo', width: 120, margin: [36, 10, 0, 6] }
      : { text: 'Maxvolt Energy Industries Limited', fontSize: 14, bold: true, color: '#1e3a5f', margin: [36, 10, 0, 6] };
    return { stack: [orangeBar, logoRow] };
  };

  const footerFn = (currentPage, pageCount, pageSize) => {
    const W = pageSize.width;
    const seg1 = W * (1.6 / 6), seg2 = W * (3.6 / 6), seg3 = W * (0.8 / 6);
    const orangeBar = { canvas: [
      { type: 'rect', x: 0,          y: 0, w: seg1, h: 12, color: '#e87722' },
      { type: 'rect', x: seg1,       y: 0, w: seg2, h: 12, color: '#f4a83a' },
      { type: 'rect', x: seg1 + seg2, y: 0, w: seg3, h: 12, color: '#e87722' },
    ]};
    return {
      stack: [
        { text: 'Maxvolt Energy Industries Limited', alignment: 'center', fontSize: 10, bold: true, color: '#e87722', margin: [36, 6, 36, 4] },
        {
          columns: [
            { text: [{ text: 'Head Office\n', bold: true, fontSize: 7.5 }, { text: 'E-82 Bulandshahr Road Industrial Area,\nGhaziabad, Uttar Pradesh – 201009\nCIN No. L40106DL2019PLC349854', fontSize: 7 }], margin: [36, 0, 10, 0], color: '#333' },
            { text: [{ text: 'Registered Office\n', bold: true, fontSize: 7.5 }, { text: 'F-108, Plot No. 1 F/F United Plaza,\nCommunity Centre, Karkardooma,\nNew Delhi – 110092', fontSize: 7 }], margin: [10, 0, 10, 0], color: '#333' },
            { text: [{ text: 'Contact Details\n', bold: true, fontSize: 7.5 }, { text: 'Phone +91 120 4291595\nEmail: info@maxvoltenergy.com\nWeb: www.maxvoltenergy.com', fontSize: 7 }], margin: [10, 0, 36, 0], color: '#333' },
          ],
          columnGap: 0,
          margin: [0, 2, 0, 5],
        },
        orangeBar,
      ],
    };
  };

  const docDef = {
    pageSize: 'A4',
    pageMargins: [50, 100, 50, 110],
    header: headerFn,
    footer: footerFn,
    ...(logoDataUrl ? { images: { logo: logoDataUrl } } : {}),
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.6 },
  };

  return renderPdf(docDef);
}

/* ── PDF generation helper (salary structure) ──────────────
   Uses pdfmake with bundled Roboto fonts (supports ₹ symbol).
   Returns a Promise<Buffer> of the generated PDF bytes.        */
function buildSalaryStructurePdf({ candidateName, employeeCode, designation, department, dateOfJoining, effectiveFrom, annualCTC, sal }) {
  return new Promise((resolve, reject) => {
    try {
      const printer = getPdfPrinter();
      const L  = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const GRAY = '#d9d9d9', BLUE = '#1d4ed8';

      const cell   = (text, opts = {}) => ({ text: String(text ?? ''), fontSize: 10, margin: [4, 3, 4, 3], ...opts });
      const hCell  = (text) => cell(text, { bold: true, fillColor: GRAY, alignment: 'right' });
      const hLCell = (text) => cell(text, { bold: true, fillColor: GRAY });
      const dRow   = (label, annual, monthly) => [cell(label), cell(L(annual), { alignment:'right' }), cell(L(monthly), { alignment:'right' })];
      const sRow   = (label) => [{ text: label, bold: true, decoration: 'underline', colSpan: 3, fontSize: 10, margin: [4, 5, 4, 3] }, {}, {}];
      const tRow   = (label, annual, monthly, color) => [
        cell(label, { bold:true, fillColor:GRAY, ...(color ? { color } : {}) }),
        cell(L(annual),  { bold:true, fillColor:GRAY, alignment:'right', ...(color ? { color } : {}) }),
        cell(L(monthly), { bold:true, fillColor:GRAY, alignment:'right', ...(color ? { color } : {}) }),
      ];

      const dedRows = [
        dRow('PF Employee Contribution (12% on Basic, max ₹15,000)', sal.pf_emp_annual, sal.pf_emp_monthly),
        ...(sal.isESI ? [dRow('ESI Employee Contribution (0.75% on Basic)', sal.esi_emp_annual, sal.esi_emp_monthly)] : []),
      ];
      const totalDedAnnual  = (sal.pf_emp_monthly + sal.esi_emp_monthly) * 12;
      const totalDedMonthly = sal.pf_emp_monthly + sal.esi_emp_monthly;

      const contRows = [
        dRow('PF Employer Contribution', sal.pf_employer_annual, sal.pf_employer_monthly),
        ...(sal.isESI ? [dRow('ESI Employer Contribution (3.25% on Basic)', sal.esi_employer_annual, sal.esi_employer_monthly)] : []),
        ...(sal.medical_monthly > 0 ? [dRow('Medical Contribution', sal.medical_annual, sal.medical_monthly)] : []),
        dRow(sal.bonusType || 'Bonus / VPP', sal.bonus_annual, sal.bonus_monthly),
      ];

      const docDef = {
        pageSize:    'A4',
        pageMargins: [40, 50, 40, 80],
        defaultStyle:{ font:'Roboto', fontSize:10 },

        content: [
          { text:'SALARY STRUCTURE', bold:true, fontSize:15, decoration:'underline', alignment:'center', margin:[0,0,0,14] },

          // Employee info
          {
            table: {
              widths: ['28%','30%','22%','20%'],
              body: [
                [cell('Employee Name:', {bold:true}), cell(candidateName||''), cell('Employee Code:', {bold:true}), cell(employeeCode||'')],
                [cell('Designation:',   {bold:true}), cell(designation||''),   cell('Department:',    {bold:true}), cell(department||'')],
                [cell('Date of Joining:',{bold:true}),cell(dateOfJoining||''), cell('Effective From:',{bold:true}), cell(effectiveFrom||'')],
                [cell('Annual CTC:',    {bold:true}), { text:`₹${Number(annualCTC||0).toLocaleString('en-IN')}`, bold:true, color:'#e87722', fontSize:13, colSpan:3 }, {}, {}],
              ],
            },
            layout:'noBorders',
            margin:[0,0,0,12],
          },

          // Salary table
          {
            table: {
              headerRows: 1,
              widths:    ['*', 90, 90],
              body: [
                [hLCell('Salary Head'), hCell('Annually'), hCell('Monthly')],
                sRow('Earnings'),
                dRow('Basic (50% of CTC)', sal.basic_annual, sal.basic_monthly),
                dRow('HRA (40% of Basic)', sal.hra_annual, sal.hra_monthly),
                dRow('Conveyance Allowance (Balance)', sal.conveyance_annual, sal.conveyance_monthly),
                tRow('Total Gross Salary (A)', sal.gross_annual, sal.gross_monthly),
                sRow('Deduction'),
                ...dedRows,
                tRow('Total Deduction (B)', totalDedAnnual, totalDedMonthly),
                tRow('Total Net Salary (A-B)', sal.net_annual, sal.net_monthly),
                sRow('Contribution'),
                ...contRows,
                tRow('Total Contribution (C)', sal.contribution_annual, sal.contribution_monthly),
                tRow('Annually CTC (A+C)', annualCTC, annualCTC / 12, BLUE),
              ],
            },
            layout: {
              hLineWidth: () => 0.5,
              vLineWidth: () => 0.5,
              hLineColor: () => '#cccccc',
              vLineColor: () => '#cccccc',
            },
          },

          { text:'Note: This salary structure is subject to statutory deductions and applicable tax regulations.', fontSize:9, color:'#888', margin:[0,10,0,36], italics:true },

          {
            columns: [
              { width:'45%', stack:[{ text:'_________________________', fontSize:10 },{ text:'HR Manager', bold:true, fontSize:10 },{ text:'Maxvolt Energy Industries Limited', fontSize:9 }] },
              { width:'*', text:'' },
              { width:'45%', stack:[{ text:'_________________________', fontSize:10 },{ text:'Employee Signature', bold:true, fontSize:10 },{ text:candidateName||'', fontSize:9 }] },
            ],
          },
        ],

        footer: (page, pages) => ({
          margin: [40, 8, 40, 0],
          table: {
            widths: ['*','*','*'],
            body: [[
              { stack:[{ text:'Head Office', bold:true, fontSize:8 },{ text:'E-82 Bulandshahr Road Industrial Area,\nGhaziabad, Uttar Pradesh – 201009\nCIN No. L40106DL2019PLC349854', fontSize:7.5 }], border:[false,true,false,false] },
              { stack:[{ text:'Registered Office', bold:true, fontSize:8 },{ text:'F-108, Plot No. 1 F/F United Plaza,\nCommunity Centre, Karkardooma,\nNew Delhi – 110092', fontSize:7.5 }], border:[false,true,false,false] },
              { stack:[{ text:'Contact Details', bold:true, fontSize:8 },{ text:'Phone +91 120 4291595\nEmail: info@maxvoltenergy.com\nWeb: www.maxvoltenergy.com', fontSize:7.5 }], border:[false,true,false,false] },
            ]],
          },
          layout:'noBorders',
        }),
      };

      const doc     = getPdfPrinter().createPdfKitDocument(docDef);
      const chunks  = [];
      doc.on('data',  c => chunks.push(c));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (err) { reject(err); }
  });
}

const router = Router();

// In-memory store for long-running background jobs (biometric processing, bulk imports).
// Auto-cleaned after 15 minutes so memory doesn't grow unbounded.
const jobStore = new Map(); // jobId → { status, result?, error?, progress? }

// Short-lived cache for getAllUsers — called on every page load across the app.
// Invalidated automatically on any user create/update (auth routes clear it via clearUsersCache).
let _usersCache = null;
let _usersCacheExp = 0;
export function clearUsersCache() { _usersCache = null; }

const getUser = (req) => {
  const t = req.headers.authorization?.replace('Bearer ', '');
  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
};

// Role guard — checks the JWT role first, then the DB role/custom_role
// (the two are usually kept in sync, but custom_role can differ).
async function hasRole(cu, roles) {
  if (!cu) return false;
  if (roles.includes(cu.role) || roles.includes(cu.custom_role)) return true;
  try {
    const u = await one('SELECT role, custom_role FROM users WHERE id=$1', [cu.id]);
    return !!u && (roles.includes(u.role) || roles.includes(u.custom_role));
  } catch { return false; }
}
const HR_ROLES = ['hr', 'admin'];
const MGR_ROLES = ['hr', 'admin', 'management', 'manager'];

const parseEntities = (rows) => rows.map(r => JSON.parse(r.data));

// Creates an in-app Notification entity for a user
async function notify(userId, { title, message, type = 'info', link = '' }) {
  if (!userId) return;
  try {
    const nid = uuidv4();
    const data = { id: nid, user_id: userId, type, title, message, link, read: false, created_at: new Date().toISOString() };
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Notification',$2,'unread',$3)", [nid, userId, JSON.stringify(data)]);
  } catch {}
}

/* ── Professional Tax: state-wise monthly slab ───────────────── */
function calcProfessionalTax(grossMonthly, state = 'UTTAR PRADESH') {
  const s = String(state || '').toUpperCase().trim();
  // States with no PT:
  if (['UTTAR PRADESH','DELHI','RAJASTHAN','HARYANA','HIMACHAL PRADESH','UTTARAKHAND','JHARKHAND','BIHAR','ODISHA','ASSAM'].includes(s)) return 0;
  // Maharashtra
  if (s === 'MAHARASHTRA') return grossMonthly <= 7500 ? 0 : grossMonthly <= 10000 ? 175 : 200;
  // Karnataka
  if (s === 'KARNATAKA') return grossMonthly < 15000 ? 0 : grossMonthly <= 29999 ? 150 : grossMonthly <= 44999 ? 200 : 200;
  // Tamil Nadu
  if (s === 'TAMIL NADU') return grossMonthly <= 21000 ? 0 : grossMonthly <= 30000 ? 135 : grossMonthly <= 45000 ? 315 : grossMonthly <= 60000 ? 690 : grossMonthly <= 75000 ? 1025 : grossMonthly <= 100000 ? 1250 : 1250;
  // West Bengal
  if (['WEST BENGAL','WESTBENGAL'].includes(s)) return grossMonthly <= 10000 ? 0 : grossMonthly <= 15000 ? 110 : grossMonthly <= 25000 ? 130 : grossMonthly <= 40000 ? 150 : 200;
  // Gujarat
  if (s === 'GUJARAT') return grossMonthly <= 5999 ? 0 : grossMonthly <= 8999 ? 80 : grossMonthly <= 11999 ? 150 : 200;
  // Andhra Pradesh / Telangana
  if (['ANDHRA PRADESH','TELANGANA'].includes(s)) return grossMonthly <= 15000 ? 0 : grossMonthly <= 20000 ? 150 : 200;
  // Kerala
  if (s === 'KERALA') return grossMonthly < 2000 ? 0 : grossMonthly <= 3999 ? 20 : grossMonthly <= 4999 ? 30 : grossMonthly <= 7499 ? 50 : grossMonthly <= 9999 ? 75 : grossMonthly <= 12499 ? 100 : grossMonthly <= 16499 ? 125 : grossMonthly <= 20000 ? 166 : 208;
  // Default: 200 if gross > 10000
  return grossMonthly > 10000 ? 200 : 0;
}

/* ── India income-tax engine (FY 2025-26 / AY 2026-27) ───────── */
const TAX_SLABS = {
  // New regime (Budget 2025, effective FY 2025-26)
  new: [
    [400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15],
    [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30],
  ],
  // Old regime (unchanged) — below-60 individual
  old: [
    [250000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30],
  ],
};

function slabTax(income, slabs) {
  let tax = 0, prev = 0;
  for (const [ceiling, rate] of slabs) {
    if (income > prev) {
      tax += (Math.min(income, ceiling) - prev) * rate;
      prev = ceiling;
    } else break;
  }
  return Math.round(tax);
}

function surcharge(tax, income, regime) {
  let rate = 0;
  if (income > 50000000) rate = regime === 'new' ? 0.25 : 0.37;
  else if (income > 20000000) rate = 0.25;
  else if (income > 10000000) rate = 0.15;
  else if (income > 5000000) rate = 0.10;
  return Math.round(tax * rate);
}

// Returns a full Form-16-style computation for one regime.
function computeRegime(regime, { grossSalary, hraExemption = 0, chapterVIA = 0, profTax = 0, otherExempt = 0 }) {
  const std = regime === 'new' ? 75000 : 50000;
  let taxableIncome;
  if (regime === 'new') {
    // New regime: only standard deduction (no HRA / Chapter VI-A except 80CCD(2))
    taxableIncome = Math.max(0, grossSalary - std);
  } else {
    taxableIncome = Math.max(0, grossSalary - std - hraExemption - otherExempt - profTax - chapterVIA);
  }
  taxableIncome = Math.round(taxableIncome);

  const slabs = TAX_SLABS[regime];
  let tax = slabTax(taxableIncome, slabs);

  // Section 87A rebate
  let rebate = 0;
  if (regime === 'new' && taxableIncome <= 1200000) rebate = Math.min(tax, 60000);
  else if (regime === 'old' && taxableIncome <= 500000) rebate = Math.min(tax, 12500);
  const taxAfterRebate = Math.max(0, tax - rebate);

  const sur = surcharge(taxAfterRebate, taxableIncome, regime);
  const cess = Math.round((taxAfterRebate + sur) * 0.04);
  const totalTax = taxAfterRebate + sur + cess;

  return {
    regime,
    standard_deduction: std,
    hra_exemption: regime === 'new' ? 0 : Math.round(hraExemption),
    chapter_via: regime === 'new' ? 0 : Math.round(chapterVIA),
    professional_tax: regime === 'new' ? 0 : Math.round(profTax),
    taxable_income: taxableIncome,
    tax_before_rebate: tax,
    rebate_87a: rebate,
    surcharge: sur,
    cess,
    total_tax: totalTax,
  };
}

/* ─────────────────────────────────────────────────────── */
router.post('/:name', async (req, res) => {
  const { name } = req.params;
  const p = req.body || {};
  const cu = getUser(req);

  try {
  switch (name) {

    /* ── User management ──────────────────────────────── */
    case 'getAllUsers': {
      if (_usersCache && Date.now() < _usersCacheExp) {
        return res.json({ users: _usersCache });
      }
      const users = await all(
        'SELECT id,email,full_name,first_name,last_name,role,custom_role,display_name FROM users'
      );
      _usersCache = users;
      _usersCacheExp = Date.now() + 60_000; // 60-second cache
      return res.json({ users });
    }

    case 'initNewUser': {
      const { user_id, email, full_name } = p;
      const ex = await one("SELECT id FROM entities WHERE type='Employee' AND user_id=$1", [user_id]);
      if (!ex) {
        const id = uuidv4();
        const d = { id, user_id, email: email||'', display_name: full_name||'',
                    status:'active', employee_status:'probation' };
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Employee',$2,'active',$3)", [id, user_id, JSON.stringify(d)]);
      }
      await run("UPDATE users SET role='employee',custom_role='employee' WHERE id=$1", [user_id]);
      return res.json({ success: true });
    }

    case 'updateUserName': {
      if (!cu) return res.status(401).json({ error:'Unauthorized' });
      const { first_name='', middle_name='', last_name='' } = p;
      const full = [first_name, middle_name, last_name].filter(Boolean).join(' ');
      await run("UPDATE users SET first_name=$1,middle_name=$2,last_name=$3,full_name=$4,display_name=$5,updated_at=NOW()::TEXT WHERE id=$6", [first_name, middle_name, last_name, full, full, cu.id]);
      return res.json({ success: true });
    }

    case 'updateUserDetails': {
      // Called from UserRoleManagement.jsx with { userId, userUpdates, employeeUpdates }
      // Also supports legacy flat params for backward compat
      const uid = p.userId || p.user_id || cu?.id;
      if (!uid) return res.status(400).json({ error: 'userId required' });

      // Update users table
      const uFields = []; const uVals = []; let upi = 0;
      const uUp = p.userUpdates || {};
      const flatFullName  = p.full_name    || uUp.full_name;
      const flatRole      = p.role         || uUp.role;
      const flatCustom    = p.custom_role  || uUp.custom_role || uUp.role;
      const flatDisplay   = p.display_name || uUp.display_name;
      if (flatFullName)  { uFields.push(`full_name=$${++upi}`);    uVals.push(flatFullName); }
      if (flatDisplay)   { uFields.push(`display_name=$${++upi}`); uVals.push(flatDisplay); }
      if (flatRole)      { uFields.push(`role=$${++upi}`);         uVals.push(flatRole); }
      if (flatCustom)    { uFields.push(`custom_role=$${++upi}`);  uVals.push(flatCustom); }
      if (uFields.length) { uVals.push(uid); await run(`UPDATE users SET ${uFields.join(',')} WHERE id=$${++upi}`, uVals); }

      // Update Employee entity
      const empUp = p.employeeUpdates || {};
      const empFields = ['display_name','employee_code','department','designation','designation_tier','phone','personal_email','work_location','reporting_manager_id'];
      const hasEmpUpdate = empFields.some(f => empUp[f] !== undefined && empUp[f] !== null);
      if (hasEmpUpdate || flatDisplay) {
        const empRow = await one("SELECT id,data FROM entities WHERE type='Employee' AND user_id=$1 LIMIT 1", [uid]);
        if (empRow) {
          const empData = JSON.parse(empRow.data);
          const updated = { ...empData };
          for (const f of empFields) {
            if (empUp[f] !== undefined) {
              // treat sentinel _none as empty string (Select "None" option)
              updated[f] = empUp[f] === '_none' ? '' : empUp[f];
            }
          }
          // Sync display_name from user update if provided
          if (flatDisplay && !empUp.display_name) updated.display_name = flatDisplay;
          // Sync display_name to user table if updated via employee fields
          if (empUp.display_name) {
            await run("UPDATE users SET display_name=$1 WHERE id=$2", [empUp.display_name === '_none' ? '' : empUp.display_name, uid]);
          }
          await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(updated), empRow.id]);
        }
      }

      return res.json({ success: true });
    }

    case 'updateUserRole': {
      const { user_id, role, custom_role } = p;
      await run("UPDATE users SET role=$1,custom_role=$2 WHERE id=$3", [role, custom_role||role, user_id]);
      return res.json({ success: true });
    }

    case 'linkUserToEmployee': {
      const { user_id, employee_id } = p;
      const row = await one("SELECT data FROM entities WHERE type='Employee' AND id=$1", [employee_id]);
      if (row) {
        const d = { ...JSON.parse(row.data), user_id };
        await run("UPDATE entities SET data=$1,user_id=$2 WHERE id=$3", [JSON.stringify(d), user_id, employee_id]);
      }
      return res.json({ success: true });
    }

    /* ── Leave ────────────────────────────────────────── */
    case 'validateLeaveApplication': {
      const { leave_policy_id, start_date, end_date, half_day, user_id } = p;
      if (!leave_policy_id || !start_date || !end_date)
        return res.json({ valid:false, errors:['Missing required fields'], warnings:[], adjusted_days:0, available_balance:0 });
      const start = new Date(start_date + 'T00:00:00'); const end = new Date(end_date + 'T00:00:00');
      const diff  = Math.ceil((end - start) / 86400000) + 1;
      const adjusted_days = half_day ? 0.5 : diff;
      const uid = user_id || cu?.id;
      const balRows = await all("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [uid]);
      const bal = balRows.map(r=>JSON.parse(r.data)).find(b=>b.leave_policy_id===leave_policy_id);
      const available_balance = bal?.available ?? 999;
      const errors = [];
      const warnings = [];

      // Check each date in range for holidays or Sundays (week-offs)
      const year = start.getFullYear();
      const holidayRows = await all("SELECT data FROM entities WHERE type='Holiday'");
      const holidays = holidayRows.map(r => JSON.parse(r.data));
      const holidayDates = new Set(
        holidays.filter(h => h.date && new Date(h.date).getFullYear() === year).map(h => h.date.slice(0,10))
      );
      const conflictDates = [];
      for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
        const ds = d.toISOString().slice(0,10);
        const dow = d.getDay();
        if (dow === 0) { conflictDates.push(`${ds} (Sunday/Week-off)`); }
        else if (holidayDates.has(ds)) {
          const h = holidays.find(h => h.date?.slice(0,10) === ds);
          conflictDates.push(`${ds} (Holiday: ${h?.name || 'Public Holiday'})`);
        }
      }
      if (conflictDates.length > 0) {
        errors.push(`Cannot apply leave on: ${conflictDates.join(', ')}`);
      }

      if (adjusted_days > available_balance) errors.push(`Insufficient balance. Available: ${available_balance}, Requested: ${adjusted_days}`);
      if (adjusted_days > 30) errors.push('Cannot exceed 30 days at once');
      return res.json({ valid:errors.length===0, adjusted_days, available_balance, errors, warnings });
    }

    case 'accrueLeaveBalances': {
      const policies  = parseEntities(await all("SELECT data FROM entities WHERE type='LeavePolicy' AND is_active=1"));
      const employees = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      const year = new Date().getFullYear();
      let accrued = 0;
      for (const emp of employees) {
        for (const pol of policies) {
          const monthly = (pol.total_days||0) / 12;
          const existing = parseEntities(await all("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [emp.user_id]))
            .find(b=>b.leave_policy_id===pol.id && b.year===year);
          if (existing) {
            const updated = { ...existing, accrued_this_year:(existing.accrued_this_year||0)+monthly, available:(existing.available||0)+monthly };
            await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(updated), existing.id]);
          } else {
            const id = uuidv4();
            const d  = { id, user_id:emp.user_id, leave_policy_id:pol.id, year, total_allocated:pol.total_days, accrued_this_year:monthly, used:0, pending_approval:0, available:monthly, carried_forward:0 };
            await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'LeaveBalance',$2,'active',$3)", [id,emp.user_id,JSON.stringify(d)]);
          }
          accrued++;
        }
      }
      return res.json({ success:true, accrued });
    }

    /* ── Payroll ──────────────────────────────────────── */
    case 'processPayroll':
    case 'processAdvancedPayroll': {
      const { month, year } = p;
      const employees = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));

      // Date range for the month
      const m_int = parseInt(month), y_int = parseInt(year);
      const startDate = `${y_int}-${String(m_int).padStart(2,'0')}-01`;
      const lastDay   = new Date(y_int, m_int, 0).getDate();
      const endDate   = `${y_int}-${String(m_int).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
      // Pre-batch all data to eliminate N+1 queries
      const existingPayrollRows = await all(
        "SELECT user_id FROM entities WHERE type='Payroll' AND data::jsonb->>'month'=$1 AND data::jsonb->>'year'=$2",
        [String(m_int), String(y_int)]
      );
      const alreadyProcessed = new Set(existingPayrollRows.map(r => r.user_id));

      const ssAllRows = await all("SELECT user_id, data FROM entities WHERE type='SalaryStructure' AND status='active'");
      const ssMap = {};
      for (const r of ssAllRows) ssMap[r.user_id] = JSON.parse(r.data);

      const attAllRows = await all(
        "SELECT user_id, data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2",
        [startDate, endDate]
      );
      // date-keyed map: user_id → dateStr → record (same structure as muster + salary sheet)
      const attByUser = {};
      for (const r of attAllRows) {
        const rec = JSON.parse(r.data);
        if (!rec.date) continue;
        if (!attByUser[r.user_id]) attByUser[r.user_id] = {};
        attByUser[r.user_id][rec.date] = rec;
      }

      // All calendar days (including Sundays) are working days at Maxvolt
      const calendarDays = new Date(y_int, m_int, 0).getDate();
      const payMonthDates = [];
      for (let d = 1; d <= calendarDays; d++) {
        const ds = `${y_int}-${String(m_int).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        payMonthDates.push({ ds });
      }
      const workingDays = calendarDays;  // 30 or 31 — all days are working days

      let processed = 0;
      for (const emp of employees) {
        if (alreadyProcessed.has(emp.user_id)) continue;

        // Salary structure
        const ss    = ssMap[emp.user_id];
        const basic = ss?.basic_salary||0; const hra=ss?.hra||0; const conv=ss?.conveyance||0; const spec=ss?.special_allowance||0;
        const gross = basic+hra+conv+spec;

        // ── Attendance tally: day-by-day; sandwich policy for Sundays ──────────────
        // Sunday is payable only if the employee was present on Saturday OR Monday.
        // If both Saturday and Monday are absent, Sunday is also LOP (sandwich rule).
        const attByDate = attByUser[emp.user_id] || {};
        const isMusterPresent = (r) => {
          if (!r) return false;
          const s = r.status;
          if (s === 'present' || s === 'late' || s === 'on_duty' || s === 'work_from_home' || s === 'half_day') return true;
          if (!s && (r.check_in_time || r.biometric_synced)) return true;
          return false;
        };
        const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        let presentDays = 0, halfDays = 0, absentDays = 0;
        for (const { ds } of payMonthDates) {
          const [yr, mo, dy] = ds.split('-').map(Number);
          if (new Date(yr, mo-1, dy).getDay() === 0) {
            // Sunday: sandwich policy
            const satPresent = isMusterPresent(attByDate[fmtDate(new Date(yr, mo-1, dy-1))]);
            const monPresent = isMusterPresent(attByDate[fmtDate(new Date(yr, mo-1, dy+1))]);
            if (!satPresent && !monPresent) { absentDays++; }  // both sides absent → Sunday LOP
            else { presentDays++; }                             // protected → count as present
            continue;
          }
          const rec = attByDate[ds];
          if (!rec) {
            absentDays++;                                      // no record on any weekday = absent
          } else {
            const s = rec.status;
            if (s === 'half_day')                                              { presentDays += 0.5; halfDays++; }
            else if (['present','late','on_duty','work_from_home'].includes(s)){ presentDays++; }
            else if (['absent','lop'].includes(s))                             { absentDays += 1 + (rec.lop_deduction_days || 0); }
            else if (['week_off','holiday','leave','approved_leave'].includes(s)){ /* paid/off — no LOP */ }
            else if (rec.check_in_time)                                        { presentDays++; }
            else                                                               { absentDays++; }
          }
        }

        // ── LOP: divisor = calendar days (company rule: Gross ÷ calendar days = 1 day rate) ──
        const totalLOPDays = absentDays + halfDays * 0.5;
        const payDays      = calendarDays - totalLOPDays;     // calendar days actually paid
        const lopAmount    = totalLOPDays > 0 ? Math.round(gross * totalLOPDays / calendarDays) : 0;
        const grossAfterLop = Math.max(0, gross - lopAmount);

        // PF: cap basic at ₹15,000 first, then prorate by days worked
        // monthlyPF = 12% × min(basic, 15000);  Final PF = monthlyPF × payDays / calendarDays
        const monthlyPFBase = Math.min(basic, 15000);
        const pf    = Math.round(monthlyPFBase * 0.12 * payDays / calendarDays);
        const empPF = Math.round(monthlyPFBase * 0.13 * payDays / calendarDays);

        // ── ESI: eligibility on full monthly basic; deduction on earned basic ──────
        const earnedBasicForESI = Math.round(basic * payDays / calendarDays);
        const esi    = basic <= 21000 ? Math.round(earnedBasicForESI * 0.0075) : 0;
        const empESI = basic <= 21000 ? Math.round(earnedBasicForESI * 0.0325) : 0;

        // Bonus / VPP based on annual CTC
        const annualCTC = ss?.ctc || (gross * 12);
        let bonusMonthly = 0;
        if (annualCTC <= 1000000) {
          bonusMonthly = Math.round(basic * 0.0833);
        } else {
          let vppRate = annualCTC <= 1500000 ? 0.05 : annualCTC <= 2000000 ? 0.08 : annualCTC <= 2500000 ? 0.12 : 0.15;
          bonusMonthly = Math.round((annualCTC * vppRate) / 12);
        }
        const totalDed = pf + esi + lopAmount;
        const net = Math.max(0, gross - totalDed);

        const id = uuidv4();
        const payrollData = {
          id, user_id: emp.user_id, month, year,
          basic_salary: basic, hra, conveyance: conv, special_allowance: spec,
          gross_salary: gross,
          deductions: { pf, esi, lop: lopAmount },
          employer_contributions: { pf: empPF, esi: empESI },
          total_deductions: totalDed, net_salary: net,
          statutory_bonus: bonusMonthly, vpp: annualCTC > 1000000 ? bonusMonthly : 0,
          calendar_days: calendarDays,
          working_days: workingDays,
          pay_days: payDays,
          present_days: presentDays,
          half_days: halfDays,
          absent_days: absentDays,
          loss_of_pay_days: totalLOPDays,
          loss_of_pay_amount: lopAmount,
          status: 'processed', processed_by: cu?.id,
          processed_at: new Date().toISOString(),
        };
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Payroll',$2,'processed',$3)", [id, emp.user_id, JSON.stringify(payrollData)]);
        processed++;
      }
      return res.json({ success:true, processed, message:`Processed payroll for ${processed} employees` });
    }

    case 'importSalaryStructures': {
      // Bulk import salary structures from the Salary Structure Excel file.
      // Expects: { rows: [...], effective_from: 'yyyy-MM-dd', approved_by: userId }
      // Each row contains Excel columns mapped to salary fields (all values are MONTHLY).
      const { rows = [], effective_from, approved_by } = p;
      if (!rows.length) return res.json({ success: false, error: 'No rows provided' });

      const effDate = effective_from || new Date().toISOString().slice(0, 10);

      // Load all active employees keyed by employee_code (case-insensitive)
      // Select user_id column explicitly — don't rely on it being inside the JSON blob
      const empRows = await all("SELECT id, user_id, data FROM entities WHERE type='Employee' AND status='active'");
      const empByCode = {};
      for (const r of empRows) {
        const d = JSON.parse(r.data);
        if (d.employee_code) empByCode[d.employee_code.trim().toUpperCase()] = { _entityId: r.id, _userId: r.user_id, ...d };
      }

      const results = { created: 0, skipped: 0, errors: [] };

      for (const row of rows) {
        const code = (row.employee_id || '').trim().toUpperCase();
        const emp = empByCode[code];
        if (!emp) {
          results.skipped++;
          results.errors.push(`${code}: employee not found`);
          continue;
        }

        // All salary values from Excel are monthly
        const n = (v) => parseFloat(v) || 0;
        const basicM        = n(row.basic_salary);
        const hraM          = n(row.hra);
        const conveyanceM   = n(row.conveyance);
        const carFuelM      = n(row.car_fuel_maintenance);
        const healthM       = n(row.health_and_wellness);
        const hardFurnishM  = n(row.hard_furnishing);
        const pfEmpM        = n(row.provident_fund);      // employee PF (12% of capped basic)
        const medicalInsM   = n(row.medical_insurance);   // medical insurance (employer)
        const adminChargeM  = n(row.admin_charge);
        const vppM          = n(row.vpp_deduction);       // VPP deduction
        const ctcBonusM     = n(row.ctc_bonus);           // monthly bonus in CTC
        const esiEmpM       = n(row.esi_employer);        // employer ESI
        const npsEmpM       = n(row.nps_employee);        // NPS employee contribution
        const carLeaseM     = n(row.car_lease);
        const totalCTCM     = n(row.total_ctc);           // monthly total CTC
        const annualCTC     = totalCTCM * 12;

        // Derive employer PF (13% on capped basic) and employee ESI (0.75% on basic ≤21000)
        const pfBase          = Math.min(basicM, 15000);
        const employerPFM     = Math.round(pfBase * 0.13);
        const employeeESIM    = basicM <= 21000 ? Math.round(basicM * 0.0075) : 0;
        const performanceBonus = ctcBonusM || vppM; // prefer CTC_BONUS, fallback to VPP

        // Create new salary structure FIRST — if anything fails, employee still has their old one
        const id = uuidv4();
        const structure = {
          id,
          user_id: emp._userId,
          effective_from: effDate,
          ctc: annualCTC,
          is_manual_override: true,
          basic_salary: basicM,
          hra: hraM,
          conveyance: conveyanceM,
          car_fuel_maintenance: carFuelM,
          health_and_wellness: healthM,
          hard_furnishing: hardFurnishM,
          lta: 0,
          special_allowance: 0,
          performance_bonus: performanceBonus,
          pf_contribution: pfEmpM,
          employer_pf_contribution: employerPFM,
          esi_contribution: employeeESIM,
          employer_esi_contribution: esiEmpM,
          medical_contribution: medicalInsM,
          admin_charge: adminChargeM,
          vpp_deduction: vppM,
          ctc_bonus: ctcBonusM,
          nps_employee: npsEmpM,
          car_lease: carLeaseM,
          status: 'active',
          approved_by: approved_by || null,
          revision_reason: 'Imported from Salary Structure Excel',
          source: 'excel_import',
        };

        await run(
          `INSERT INTO entities (id, type, user_id, status, is_active, data)
           VALUES ($1,'SalaryStructure',$2,'active',1,$3)`,
          [id, emp._userId, JSON.stringify(structure)]
        );
        results.created++;
        // Deactivate old structures AFTER the insert — if this fails, two actives exist
        // (detectable/fixable) rather than zero actives (silent data loss).
        // Avoid data::jsonb cast on TEXT column which throws if any row has malformed JSON.
        await run(
          `UPDATE entities SET status='inactive', updated_at=NOW()::TEXT
           WHERE type='SalaryStructure' AND user_id=$1 AND status='active' AND id != $2`,
          [emp._userId, id]
        );
      }

      return res.json({
        success: true,
        created: results.created,
        skipped: results.skipped,
        errors: results.errors,
        message: `Imported ${results.created} salary structures. ${results.skipped} skipped (employee not found).`,
      });
    }

    case 'markAbsentEmployees': {
      const { date } = p;
      const targetDate = date || new Date().toISOString().slice(0, 10);

      // Get all active employees
      const empRows = await all("SELECT data FROM entities WHERE type='Employee' AND status='active'");
      const employees = empRows.map(r => JSON.parse(r.data));

      // Check for approved leaves on this date
      const leaveRows = await all("SELECT data FROM entities WHERE type='Leave' AND status='approved'");
      const onLeaveUserIds = new Set();
      leaveRows.forEach(row => {
        const leave = JSON.parse(row.data);
        if (leave.start_date <= targetDate && leave.end_date >= targetDate) {
          onLeaveUserIds.add(leave.user_id);
        }
      });

      let marked = 0, skipped = 0;
      for (const emp of employees) {
        if (!emp.user_id) { skipped++; continue; }
        if (onLeaveUserIds.has(emp.user_id)) { skipped++; continue; }

        // Direct per-employee check — more robust than a Set built from a separate query.
        // Matches on user_id (DB column OR JSON blob) AND employee_code, because biometric
        // records created via MxOneSync may have the employee_code in the JSON even when
        // the user_id columns don't align (e.g. BiometricCodeMapping pointed to a different
        // user than the Employee entity's own user_id).
        const existingAtt = await one(`
          SELECT id FROM entities
          WHERE type='Attendance'
            AND data::jsonb->>'date' = $1
            AND (
              user_id = $2
              OR data::jsonb->>'user_id' = $2
              OR ($3 <> '' AND data::jsonb->>'employee_code' = $3)
            )
          LIMIT 1
        `, [targetDate, emp.user_id, emp.employee_code || '']);

        if (existingAtt) { skipped++; continue; }

        const attId = uuidv4();
        await run(
          "INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,'absent',$3)",
          [attId, emp.user_id, JSON.stringify({
            id: attId, user_id: emp.user_id, date: targetDate,
            status: 'absent', source: 'auto_marked',
            created_at: new Date().toISOString(),
          })]
        );
        marked++;
      }
      return res.json({ success:true, marked, skipped, date: targetDate, message:`Marked ${marked} employees absent for ${targetDate}` });
    }

    case 'generatePayslip': {
      const { payroll_id } = p;
      const pRow = await one("SELECT data FROM entities WHERE type='Payroll' AND id=$1", [payroll_id]);
      if (!pRow) return res.json({ success:false, error:'Payroll record not found' });
      const payroll = JSON.parse(pRow.data);

      const eRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [payroll.user_id]);
      const employee = eRow ? JSON.parse(eRow.data) : {};

      const uRow = await one("SELECT id,email,full_name,display_name FROM users WHERE id=$1", [payroll.user_id]);
      const empUser = uRow || { full_name: employee.display_name || '' };

      const ssRows = await all("SELECT data FROM entities WHERE type='SalaryStructure' AND user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1", [payroll.user_id]);
      const salaryStructure = ssRows.length ? JSON.parse(ssRows[0].data) : {};

      const bonusRows = await all(
        "SELECT data FROM entities WHERE type='Bonus' AND user_id=$1 AND data::jsonb->>'month'=$2 AND data::jsonb->>'year'=$3",
        [payroll.user_id, String(payroll.month), String(payroll.year)]
      );
      const bonuses = bonusRows.map(r => JSON.parse(r.data));

      // Resolve department code → full name
      let deptName = employee.department || 'N/A';
      if (employee.department) {
        const deptRow = await one(
          "SELECT data FROM entities WHERE type='Department' AND (data::jsonb->>'code'=$1 OR data::jsonb->>'name'=$1) LIMIT 1",
          [employee.department]
        );
        if (deptRow) deptName = JSON.parse(deptRow.data).name || deptName;
      }

      const html = buildPayslipHtml(payroll, employee, deptName);
      return res.json({ success:true, html, payroll, employee, empUser, salaryStructure, bonuses, data:payroll });
    }

    case 'generateBankTransferFile': {
      const { month, year, format = 'csv' } = p;
      const payrolls = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll' AND status='processed'"))
        .filter(r => r.month === month && r.year === year);
      if (payrolls.length === 0) return res.json({ success:false, error:'No processed payroll records for this period' });

      const lines = ['Beneficiary Name,Account Number,IFSC Code,Bank Name,Branch,Amount,Remarks'];
      for (const pr of payrolls) {
        const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [pr.user_id]);
        const emp    = empRow ? JSON.parse(empRow.data) : {};
        const bank   = emp.bank_account_number || '';
        const ifsc   = emp.ifsc_code || '';
        const bankName = emp.bank_name || '';
        const branch = emp.bank_branch || '';
        const name   = emp.display_name || '';
        lines.push(`"${name}","${bank}","${ifsc}","${bankName}","${branch}",${pr.net_salary},"Salary ${month}/${year}"`);
      }

      const csv = lines.join('\n');
      const { writeFileSync, mkdirSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const uploadsDir = process.env.NODE_ENV === 'production' ? '/app/uploads' : './backend/uploads';
      if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
      const filename = `bank_transfer_${year}_${String(month).padStart(2,'0')}.csv`;
      writeFileSync(join(uploadsDir, filename), csv);

      return res.json({ success:true, file_url:`/uploads/${filename}`, records: payrolls.length, total_amount: payrolls.reduce((s,r)=>s+(r.net_salary||0),0) });
    }

    /* ── Attendance Report Export (session time + overtime) ── */
    case 'exportAttendanceReport': {
      const { month, year } = p;
      if (!month || !year) return res.json({ success: false, error: 'month and year required' });
      const m = parseInt(month), y = parseInt(year);
      const monthStart = `${y}-${String(m).padStart(2,'0')}-01`;
      const monthEnd   = new Date(y, m, 0).toISOString().slice(0,10);
      const daysInMonth = new Date(y, m, 0).getDate();

      const employees = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      const attRows   = parseEntities(await all("SELECT data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2", [monthStart, monthEnd]));

      // Build attendance map: user_id → date → record
      const attMap = {};
      for (const a of attRows) {
        if (!attMap[a.user_id]) attMap[a.user_id] = {};
        attMap[a.user_id][a.date] = a;
      }

      // Pre-load all shifts referenced by employees (avoids N+1 queries)
      const shiftCache = {};
      const shiftIds = [...new Set(employees.map(e => e.shift_id).filter(Boolean))];
      if (shiftIds.length > 0) {
        const placeholders = shiftIds.map((_, i) => `$${i+1}`).join(',');
        const shiftRows = await all(`SELECT id,data FROM entities WHERE id IN (${placeholders})`, shiftIds);
        for (const sr of shiftRows) shiftCache[sr.id] = JSON.parse(sr.data);
      }
      const getShift = (shiftId) => shiftId ? (shiftCache[shiftId] || null) : null;

      const defaultShift = parseEntities(await all("SELECT data FROM entities WHERE type='Shift' AND (data::jsonb->>'is_default'='true' OR data::jsonb->>'name' LIKE '%General%') LIMIT 1"))[0] || null;

      const toMinutes = (t) => {
        if (!t) return 0;
        const [h, mi] = String(t).split(':').map(Number);
        return (h||0)*60 + (mi||0);
      };

      const shiftEndMinutes = (shift) => {
        const endTime = shift?.end_time || '18:00';
        return toMinutes(endTime);
      };

      // Build report rows
      const rows = employees.map(emp => {
        const shift  = getShift(emp.shift_id) || defaultShift;
        const shiftHours = shift ? (toMinutes(shift.end_time) - toMinutes(shift.start_time)) / 60 : 8;
        const stdMinutes = shiftHours * 60;
        const isOTEligible = !!emp.overtime_eligible;

        let totalPresent = 0, totalAbsent = 0, totalLeave = 0, totalHoliday = 0, totalOff = 0;
        let totalWorkingMins = 0, totalOvertimeMins = 0;
        const dayDetails = [];

        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const rec  = attMap[emp.user_id]?.[dateStr];
          const dow  = new Date(dateStr).getDay();
          const isWeekend = dow === 0 || dow === 6;

          let cell = '', workedMins = 0, otMins = 0;

          if (!rec) {
            if (isWeekend) { cell = 'OFF'; totalOff++; }
            else { cell = 'A'; totalAbsent++; }
          } else {
            const s = rec.status;
            workedMins = Math.round((rec.working_hours || 0) * 60);

            if (rec.check_in_time && rec.check_out_time) {
              const checkIn  = new Date(rec.check_in_time);
              const checkOut = new Date(rec.check_out_time);
              workedMins = Math.max(0, Math.round((checkOut - checkIn) / 60000));
            }

            if (workedMins > stdMinutes && stdMinutes > 0) {
              otMins = workedMins - stdMinutes;
            }

            if (s === 'week_off') { cell = 'OFF'; totalOff++; }
            else if (s === 'holiday') { cell = 'H'; totalHoliday++; }
            else if (s === 'leave') { cell = 'L'; totalLeave++; }
            else if (s === 'half_day') { cell = 'HD'; totalPresent += 0.5; }
            else if (s === 'present' || s === 'late' || s === 'on_duty' || s === 'work_from_home') {
              cell = s === 'late' ? 'L*' : (s === 'on_duty' ? 'OD' : s === 'work_from_home' ? 'WFH' : 'P');
              totalPresent++;
            }
            else if (s === 'absent') { cell = 'A'; totalAbsent++; }
            else if (rec.check_in_time) { cell = 'P'; totalPresent++; }
            else { cell = 'A'; totalAbsent++; }

            totalWorkingMins += workedMins;
            if (isOTEligible) totalOvertimeMins += otMins;
          }

          const hhmm = (mins) => `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
          dayDetails.push({ cell, workedMins, otMins: isOTEligible ? otMins : 0, hhmm: hhmm(workedMins), othhmm: hhmm(isOTEligible ? otMins : 0) });
        }

        const totalWorkingHrs = (totalWorkingMins / 60).toFixed(2);
        const totalOvertimeHrs = isOTEligible ? (totalOvertimeMins / 60).toFixed(2) : '—';
        const avgDailyHrs = totalPresent > 0 ? (totalWorkingMins / 60 / totalPresent).toFixed(2) : '0.00';

        return { emp, shift, isOTEligible, totalPresent, totalAbsent, totalLeave, totalHoliday, totalOff, totalWorkingHrs, totalOvertimeHrs, avgDailyHrs, dayDetails };
      });

      // Build styled Excel
      const monthLabel = new Date(y, m-1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      const dayNums = Array.from({ length: daysInMonth }, (_, i) => i+1);
      const ExcelJSAR = (await import('exceljs')).default;
      const wbAR = new ExcelJSAR.Workbook();
      wbAR.creator = 'Maxvolt HRMS'; wbAR.created = new Date();
      const wsAR = wbAR.addWorksheet('Attendance Report', { views: [{ state:'frozen', xSplit:6, ySplit:3 }] });

      const arFill = (argb) => ({ type:'pattern', pattern:'solid', fgColor:{argb:`FF${argb}`} });
      const arFont = (bold=false, color='222222', size=9) => ({ name:'Arial', bold, color:{argb:`FF${color}`}, size });
      const arBorder = () => ({ top:{style:'thin',color:{argb:'FFD0D0D0'}}, left:{style:'thin',color:{argb:'FFD0D0D0'}}, bottom:{style:'thin',color:{argb:'FFD0D0D0'}}, right:{style:'thin',color:{argb:'FFD0D0D0'}} });

      const dayStatusColor = (cell) => {
        if (cell === 'P') return 'C8E6C9';
        if (cell === 'L*') return 'FFF9C4';
        if (cell === 'A') return 'FFCDD2';
        if (cell === 'L') return 'B3E5FC';
        if (cell === 'H') return 'E1BEE7';
        if (cell === 'HD') return 'FFE0B2';
        if (cell === 'OFF') return 'ECEFF1';
        if (cell === 'OD' || cell === 'WFH') return 'DCEDC8';
        return 'FFFFFF';
      };

      // Row 1: Title
      const totalInfoCols = 6 + daysInMonth * 2 + 6;
      wsAR.mergeCells(1, 1, 1, totalInfoCols);
      const arTitle = wsAR.getCell('A1');
      arTitle.value = `ATTENDANCE REPORT — ${monthLabel.toUpperCase()}   |   Maxvolt Energy Industries Limited`;
      arTitle.font = { name:'Arial', bold:true, color:{argb:'FFFFFFFF'}, size:13 };
      arTitle.fill = arFill('1A3C5E');
      arTitle.alignment = { horizontal:'center', vertical:'middle' };
      wsAR.getRow(1).height = 30;

      // Row 2: Meta + Legend
      wsAR.mergeCells(2, 1, 2, 6);
      wsAR.getCell('A2').value = `Generated: ${new Date().toLocaleString('en-IN')}   |   Employees: ${rows.length}   |   Days in Month: ${daysInMonth}`;
      wsAR.getCell('A2').font = arFont(false, 'FFFFFF', 9);
      wsAR.getCell('A2').fill = arFill('2D6A9F');
      wsAR.getCell('A2').alignment = { vertical:'middle' };
      wsAR.mergeCells(2, 7, 2, totalInfoCols);
      wsAR.getCell(2, 7).value = 'P=Present  L*=Late  A=Absent  L=Leave  H=Holiday  HD=Half Day  OD=On Duty  WFH=Work from Home  OFF=Week Off';
      wsAR.getCell(2, 7).font = arFont(false, 'FFFFFF', 8);
      wsAR.getCell(2, 7).fill = arFill('2D6A9F');
      wsAR.getCell(2, 7).alignment = { vertical:'middle' };
      wsAR.getRow(2).height = 18;

      // Row 3: Column headers
      const arHeaders = [
        { header:'Emp Code', width:11 }, { header:'Employee Name', width:22 },
        { header:'Department', width:16 }, { header:'Designation', width:18 },
        { header:'Shift', width:12 }, { header:'OT Eligible', width:9 },
        ...dayNums.map(d => ({ header:String(d), width:4 })),
        ...dayNums.map(d => ({ header:`${d}h`, width:6 })),
        { header:'Present', width:8 }, { header:'Absent', width:8 },
        { header:'Leave', width:7 }, { header:'Holiday', width:8 },
        { header:'Off', width:6 }, { header:'Total Hrs', width:10 },
      ];
      wsAR.columns = arHeaders.map(h => ({ width: h.width }));
      const arHdrRow = wsAR.getRow(3);
      arHdrRow.height = 22;
      arHeaders.forEach((h, ci) => {
        const cell = arHdrRow.getCell(ci+1);
        cell.value = h.header;
        cell.font = arFont(true, 'FFFFFF', 9);
        cell.fill = arFill('1A3C5E');
        cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
        cell.border = arBorder();
      });

      // Data rows
      rows.forEach((r, ri) => {
        const { emp, shift, isOTEligible, totalPresent, totalAbsent, totalLeave, totalHoliday, totalOff, totalWorkingHrs, dayDetails } = r;
        const rowNum = 4 + ri;
        const isAlt = ri % 2 === 1;
        const wsRow = wsAR.getRow(rowNum);
        wsRow.height = 16;

        const cellData = [
          emp.employee_code || '', emp.display_name || '',
          emp.department || '', emp.designation || '',
          shift?.name || 'General', isOTEligible ? 'Yes' : 'No',
          ...dayDetails.map(d => d.cell),
          ...dayDetails.map(d => d.hhmm),
          totalPresent, totalAbsent, totalLeave, totalHoliday, totalOff, totalWorkingHrs,
        ];

        cellData.forEach((val, ci) => {
          const cell = wsRow.getCell(ci+1);
          cell.value = val;
          cell.border = arBorder();
          const isDayStatus = ci >= 6 && ci < 6 + daysInMonth;
          const isDayHours  = ci >= 6 + daysInMonth && ci < 6 + daysInMonth * 2;
          const isSummary   = ci >= 6 + daysInMonth * 2;
          if (isDayStatus) {
            const statusColor = dayStatusColor(val);
            cell.fill = arFill(statusColor);
            cell.font = arFont(true, '222222', 8);
            cell.alignment = { horizontal:'center', vertical:'middle' };
          } else if (isDayHours) {
            cell.font = arFont(false, '555555', 8);
            cell.alignment = { horizontal:'center', vertical:'middle' };
            if (isAlt) cell.fill = arFill('F5F9FF');
          } else if (isSummary) {
            cell.font = arFont(true, '1A3C5E', 9);
            cell.fill = arFill('EFF6FF');
            cell.alignment = { horizontal:'center', vertical:'middle' };
          } else {
            cell.font = arFont(false, '222222', 9);
            if (isAlt) cell.fill = arFill('F5F9FF');
            if (ci < 2) cell.alignment = { horizontal:'left', vertical:'middle' };
            else cell.alignment = { horizontal:'center', vertical:'middle' };
          }
        });
      });

      // Totals row
      const arTotRow = wsAR.addRow([
        'TOTAL', '', '', '', '', '',
        ...dayNums.map(() => ''),
        ...dayNums.map(() => ''),
        rows.reduce((s,r)=>s+r.totalPresent,0),
        rows.reduce((s,r)=>s+r.totalAbsent,0),
        rows.reduce((s,r)=>s+r.totalLeave,0),
        rows.reduce((s,r)=>s+r.totalHoliday,0),
        rows.reduce((s,r)=>s+r.totalOff,0),
        '',
      ]);
      arTotRow.height = 20;
      arTotRow.eachCell(cell => {
        cell.font = arFont(true, 'FFFFFF', 9);
        cell.fill = arFill('1A3C5E');
        cell.alignment = { horizontal:'center', vertical:'middle' };
        cell.border = arBorder();
      });
      arTotRow.getCell(1).alignment = { horizontal:'left', vertical:'middle' };

      const arBuffer = await wbAR.xlsx.writeBuffer();
      const arBase64 = Buffer.from(arBuffer).toString('base64');
      return res.json({ success: true, base64: arBase64, filename: `Attendance_Report_${monthLabel.replace(' ','_')}.xlsx`, total_employees: rows.length, format: 'xlsx' });
    }

    /* ── Attendance Muster Export (styled Excel) ─────────── */
    case 'exportAttendanceMuster': {
      const { month, year } = p;
      if (!month || !year) return res.json({ success: false, error: 'month and year required' });
      const m = parseInt(month), y = parseInt(year);
      const monthStart  = `${y}-${String(m).padStart(2,'0')}-01`;
      const monthEnd    = new Date(y, m, 0).toISOString().slice(0,10);
      const daysInMonth = new Date(y, m, 0).getDate();
      const monthLabel  = new Date(y, m-1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

      const mEmps   = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      const mAttRows = parseEntities(await all("SELECT data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2", [monthStart, monthEnd]));

      const mAttMap = {};
      for (const a of mAttRows) {
        if (!mAttMap[a.user_id]) mAttMap[a.user_id] = {};
        mAttMap[a.user_id][String(a.date).slice(0,10)] = a;
      }

      const isMusterWorked = (r) => {
        if (!r) return false;
        const s = r.status;
        return s === 'present' || s === 'late' || s === 'on_duty' || s === 'work_from_home' || s === 'half_day' || (!s && (r.check_in_time || r.biometric_synced));
      };
      const mStatusCode = (rec, dateStr, empRecs) => {
        const dateObj = new Date(dateStr + 'T00:00:00');
        const dow = dateObj.getDay();
        // Sunday sandwich rule: WO only if present on Saturday or Monday
        if (dow === 0) {
          const sat = new Date(dateObj.getTime() - 86400000).toISOString().slice(0,10);
          const mon = new Date(dateObj.getTime() + 86400000).toISOString().slice(0,10);
          if (!isMusterWorked(empRecs[sat]) && !isMusterWorked(empRecs[mon])) return 'A';
          return 'WO';
        }
        if (!rec) return dow === 6 ? 'WO' : 'A';
        const s = rec.status;
        const hasIn = rec.check_in_time || rec.biometric_synced || rec.check_in_selfie_url;
        if (s === 'week_off')  return 'WO';
        if (s === 'holiday')   return 'PH';
        if (s === 'leave')     return 'L';
        if (s === 'on_duty')   return 'OD';
        if (s === 'half_day')  return 'HD';
        if (s === 'short_attendance') return 'SA';
        if (s === 'late' || rec.late_arrival) return 'P*';
        if (hasIn || s === 'present') return 'P';
        return 'A';
      };

      const mStatusFill = (code) => {
        const map = { 'P':'22C55E','P*':'F97316','A':'EF4444','WO':'D1D5DB','PH':'A78BFA','L':'60A5FA','OD':'14B8A6','HD':'FBBF24','SA':'FB923C' };
        return map[code] || 'F3F4F6';
      };
      const mTextDark = (code) => ['WO','HD','SA'].includes(code) ? '1F2937' : 'FFFFFF';

      const ExcelJSm = await import('exceljs');
      const wbM = new ExcelJSm.default.Workbook();
      const wsM = wbM.addWorksheet('Muster Roll', { views: [{ state:'frozen', xSplit:5, ySplit:4 }] });

      const INFO = 5; // Code,Name,Dept,Desig,Location
      const SUMM = 8; // P,A,L,HD,WO,PH,OD,Total
      const totCols = INFO + daysInMonth + SUMM;

      const mF  = (bold=false, col='1A1A1A', sz=9) => ({ name:'Calibri', bold, color:{ argb:'FF'+col }, size:sz });
      const mFl = (hex) => ({ type:'pattern', pattern:'solid', fgColor:{ argb:'FF'+hex } });
      const mBd = () => ({ top:{style:'thin',color:{argb:'FFD1D5DB'}}, left:{style:'thin',color:{argb:'FFD1D5DB'}}, bottom:{style:'thin',color:{argb:'FFD1D5DB'}}, right:{style:'thin',color:{argb:'FFD1D5DB'}} });
      const mCtr = { horizontal:'center', vertical:'middle' };
      const mLft = { horizontal:'left',   vertical:'middle' };

      wsM.getColumn(1).width = 11; wsM.getColumn(2).width = 24; wsM.getColumn(3).width = 16;
      wsM.getColumn(4).width = 16; wsM.getColumn(5).width = 14;
      for (let d=1; d<=daysInMonth; d++) wsM.getColumn(INFO+d).width = 4.2;
      for (let s=1; s<=SUMM;        s++) wsM.getColumn(INFO+daysInMonth+s).width = 5.5;

      // Row 1 — title
      const r1 = wsM.addRow([`ATTENDANCE MUSTER ROLL — ${monthLabel.toUpperCase()}`]);
      r1.height = 28; wsM.mergeCells(1,1,1,totCols);
      Object.assign(r1.getCell(1), { font:mF(true,'FFFFFF',13), fill:mFl('1A3C5E'), alignment:mCtr });

      // Row 2 — meta
      const r2 = wsM.addRow([`Maxvolt Energy Industries Limited  |  Period: ${monthLabel}  |  Employees: ${mEmps.length}  |  Generated: ${new Date().toLocaleDateString('en-IN')}`]);
      r2.height = 16; wsM.mergeCells(2,1,2,totCols);
      Object.assign(r2.getCell(1), { font:mF(false,'475569',8), fill:mFl('F8FAFC'), alignment:{ horizontal:'left', vertical:'middle', indent:1 }, border:mBd() });

      // Row 3 — legend
      const r3 = wsM.addRow(['Legend:  P = Present   P* = Late   A = Absent   HD = Half Day   L = Leave   WO = Week Off   PH = Public Holiday   OD = On Duty   SA = Short Attendance']);
      r3.height = 15; wsM.mergeCells(3,1,3,totCols);
      Object.assign(r3.getCell(1), { font:mF(false,'1E40AF',8), fill:mFl('EFF6FF'), alignment:{ horizontal:'left', vertical:'middle', indent:1 }, border:mBd() });

      // Row 4 — headers
      const dayHdrs = Array.from({length:daysInMonth}, (_,i) => {
        const dow = ['Su','Mo','Tu','We','Th','Fr','Sa'][new Date(y,m-1,i+1).getDay()];
        return `${i+1}\n${dow}`;
      });
      const hRow = wsM.addRow(['Code','Employee Name','Department','Designation','Location',...dayHdrs,'P','A','L','HD','WO','PH','OD','Total']);
      hRow.height = 34;
      hRow.eachCell(cell => Object.assign(cell, { font:mF(true,'FFFFFF',8), fill:mFl('1E40AF'), alignment:{ horizontal:'center', vertical:'middle', wrapText:true }, border:mBd() }));
      for (let d=1; d<=daysInMonth; d++) {
        const dow = new Date(y,m-1,d).getDay();
        if (dow===0||dow===6) hRow.getCell(INFO+d).fill = mFl('1E3A8A');
      }
      for (let s=1; s<=SUMM; s++) hRow.getCell(INFO+daysInMonth+s).fill = mFl('0F172A');

      // Dept colour rotation
      const DEPT_BG = ['F0F9FF','FFF7ED','F0FDF4','FDF4FF','FFFBEB','FFF1F2','F0FDFA','F5F3FF'];
      const deptBgMap = {}; let dci = 0;

      const sortedEmps = [...mEmps].sort((a,b) => (a.department||'').localeCompare(b.department||'') || (a.display_name||'').localeCompare(b.display_name||''));
      for (const emp of sortedEmps) {
        const dept = emp.department || '';
        if (!(dept in deptBgMap)) deptBgMap[dept] = DEPT_BG[dci++ % DEPT_BG.length];
        const bg = deptBgMap[dept];
        const empRecs = mAttMap[emp.user_id] || {};
        let pC=0, aC=0, lC=0, hdC=0, woC=0, phC=0, odC=0;
        const codes = [];

        for (let d=1; d<=daysInMonth; d++) {
          const ds = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const code = mStatusCode(empRecs[ds], ds, empRecs);
          codes.push(code);
          if (code==='P'||code==='P*'||code==='SA') pC++;
          else if (code==='A') aC++;
          else if (code==='L') lC++;
          else if (code==='HD') { hdC++; pC+=0.5; aC+=0.5; }
          else if (code==='WO') woC++;
          else if (code==='PH') phC++;
          else if (code==='OD') odC++;
        }

        const totalWorked = pC + odC + lC + woC; // present (incl. half-days) + on-duty + paid leaves + week-off
        const rowVals = [emp.employee_code||'', emp.display_name||'', dept, emp.designation||'', emp.work_location||'', ...codes, pC, aC, lC, hdC, woC, phC, odC, totalWorked];
        const dr = wsM.addRow(rowVals);
        dr.height = 15;

        [1,2,3,4,5].forEach(c => Object.assign(dr.getCell(c), { font:mF(c===2,c===2?'1E3A8A':'374151',c===2?9:8), fill:mFl(bg), alignment:c<=1?mCtr:mLft, border:mBd() }));

        codes.forEach((code,i) => {
          const cell = dr.getCell(INFO+1+i);
          cell.value = code;
          Object.assign(cell, {
            font:    mF(true, mTextDark(code), 7),
            fill:    mFl(mStatusFill(code)),
            alignment: mCtr,
            border:  { top:{style:'thin',color:{argb:'FFFFFFFF'}}, left:{style:'thin',color:{argb:'FFFFFFFF'}}, bottom:{style:'thin',color:{argb:'FFFFFFFF'}}, right:{style:'thin',color:{argb:'FFFFFFFF'}} },
          });
        });

        [pC,aC,lC,hdC,woC,phC,odC,totalWorked].forEach((v,i) => {
          const cell = dr.getCell(INFO+daysInMonth+1+i);
          const isTotal = i===SUMM-1;
          Object.assign(cell, {
            font:  mF(true, isTotal?'FFFFFF':'1A1A1A', 8),
            fill:  mFl(isTotal?'1A3C5E':bg),
            alignment: mCtr,
            border: mBd(),
          });
        });
      }

      // Totals row
      const lastR = 4 + sortedEmps.length;
      const tRow = wsM.addRow(['TOTALS','','','','', ...Array(daysInMonth).fill(''), ...Array(SUMM).fill('')]);
      wsM.mergeCells(lastR+1,1,lastR+1,INFO);
      tRow.height = 20;
      for (let s=1; s<=SUMM; s++) {
        const colLetter = wsM.getColumn(INFO+daysInMonth+s).letter;
        tRow.getCell(INFO+daysInMonth+s).value = { formula:`SUM(${colLetter}5:${colLetter}${lastR})` };
      }
      tRow.eachCell(cell => Object.assign(cell, { font:mF(true,'FFFFFF',9), fill:mFl('1A3C5E'), alignment:mCtr, border:mBd() }));

      const mBuf = await wbM.xlsx.writeBuffer();
      return res.json({ success:true, base64:Buffer.from(mBuf).toString('base64'), filename:`Attendance_Muster_${monthLabel.replace(' ','_')}.xlsx`, total_employees:sortedEmps.length, format:'xlsx' });
    }

    /* ── Bulk Document Download (ZIP) ───────────────────── */
    case 'bulkDownloadDocuments': {
      const { user_ids, document_types } = body;

      const employees = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      const empMap = Object.fromEntries(employees.map(e => [e.user_id, e]));

      let docs = parseEntities(await all("SELECT data FROM entities WHERE type='Document'"));
      if (user_ids?.length)       docs = docs.filter(d => user_ids.includes(d.user_id));
      if (document_types?.length) docs = docs.filter(d => document_types.includes(d.document_type));
      docs = docs.filter(d => d.document_url);

      if (!docs.length) return res.json({ success: false, error: 'No documents found matching the selected filters' });
      if (docs.length > 80) docs = docs.slice(0, 80);

      // Pure-Node CRC32 (no external dep)
      const _crc32Table = (() => {
        const t = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          let c = i;
          for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
          t[i] = c;
        }
        return t;
      })();
      const crc32 = (buf) => {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ _crc32Table[(crc ^ buf[i]) & 0xFF];
        return (crc ^ 0xFFFFFFFF) >>> 0;
      };

      // Minimal ZIP builder using built-in zlib (no extra package)
      const zlibNode = _require('zlib');
      const buildZip = (files) => {
        const parts = [], centralDir = [];
        let offset = 0;
        for (const { name, data } of files) {
          const nb = Buffer.from(name, 'utf8');
          const comp = zlibNode.deflateRawSync(data, { level: 6 });
          const crc  = crc32(data);
          const lh = Buffer.alloc(30 + nb.length);
          lh.writeUInt32LE(0x04034b50,0); lh.writeUInt16LE(20,4);  lh.writeUInt16LE(0,6);
          lh.writeUInt16LE(8,8);          lh.writeUInt16LE(0,10);  lh.writeUInt16LE(0,12);
          lh.writeUInt32LE(crc,14);       lh.writeUInt32LE(comp.length,18);
          lh.writeUInt32LE(data.length,22); lh.writeUInt16LE(nb.length,26); lh.writeUInt16LE(0,28);
          nb.copy(lh, 30);
          const cd = Buffer.alloc(46 + nb.length);
          cd.writeUInt32LE(0x02014b50,0); cd.writeUInt16LE(20,4);  cd.writeUInt16LE(20,6);
          cd.writeUInt16LE(0,8);          cd.writeUInt16LE(8,10);  cd.writeUInt16LE(0,12);
          cd.writeUInt16LE(0,14);         cd.writeUInt32LE(crc,16);
          cd.writeUInt32LE(comp.length,20); cd.writeUInt32LE(data.length,24);
          cd.writeUInt16LE(nb.length,28); cd.writeUInt16LE(0,30);  cd.writeUInt16LE(0,32);
          cd.writeUInt16LE(0,34);         cd.writeUInt16LE(0,36);  cd.writeUInt32LE(0,38);
          cd.writeUInt32LE(offset,42);    nb.copy(cd, 46);
          parts.push(lh, comp); centralDir.push(cd);
          offset += lh.length + comp.length;
        }
        const cdb  = Buffer.concat(centralDir);
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(0,4);  eocd.writeUInt16LE(0,6);
        eocd.writeUInt16LE(files.length,8); eocd.writeUInt16LE(files.length,10);
        eocd.writeUInt32LE(cdb.length,12);  eocd.writeUInt32LE(offset,16); eocd.writeUInt16LE(0,20);
        return Buffer.concat([...parts, cdb, eocd]);
      };

      // Fetch each document via URL
      const files = [];
      const seen  = {};
      for (const doc of docs) {
        try {
          const resp = await fetch(doc.document_url, { signal: AbortSignal.timeout(15000) });
          if (!resp.ok) continue;
          const buf = Buffer.from(await resp.arrayBuffer());
          const ct  = resp.headers.get('content-type') || '';
          const ext = ct.includes('pdf') ? '.pdf' : ct.includes('png') ? '.png'
            : (ct.includes('jpeg') || ct.includes('jpg')) ? '.jpg'
            : ct.includes('webp') ? '.webp' : '';
          const emp     = empMap[doc.user_id];
          const empName = (emp?.display_name || emp?.employee_code || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
          const docType = (doc.document_type || 'document').replace(/[^a-zA-Z0-9]/g, '_');
          const docName = (doc.document_name || '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
          let fname = `${empName}/${docType}_${docName}${ext}`;
          if (seen[fname]) { seen[fname]++; fname = `${empName}/${docType}_${docName}_${seen[fname]}${ext}`; }
          else seen[fname] = 1;
          files.push({ name: fname, data: buf });
        } catch { /* skip failed/unreachable documents */ }
      }

      if (!files.length) return res.json({ success: false, error: 'Could not fetch any document files. URLs may be unavailable.' });

      const zipBuf = buildZip(files);
      return res.json({ success: true, base64: zipBuf.toString('base64'), filename: `Employee_Documents_${new Date().toISOString().slice(0,10)}.zip`, total: files.length });
    }

    /* ── Salary Structure Export (styled Excel) ──────────── */
    case 'exportSalaryStructures': {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Maxvolt HRMS';

      // Style helpers
      const C = { hdr:'1A3C5E', sub:'2D6A9F', empBg:'EBF5FB', ctcBg:'EAF4EA', earnBg:'E8F5E9', dedBg:'FFEBEE', netBg:'FFF9C4', emprBg:'F3E5F5', altRow:'F8FBFF', totBg:'1A3C5E' };
      const fnt = (bold=false,color='000000',size=10) => ({ name:'Arial', bold, color:{argb:`FF${color}`}, size });
      const fl  = (argb) => ({ type:'pattern', pattern:'solid', fgColor:{argb:`FF${argb}`} });
      const bd  = () => ({ top:{style:'thin',color:{argb:'FFD0D0D0'}}, left:{style:'thin',color:{argb:'FFD0D0D0'}}, bottom:{style:'thin',color:{argb:'FFD0D0D0'}}, right:{style:'thin',color:{argb:'FFD0D0D0'}} });
      const ctr = { horizontal:'center', vertical:'middle' };
      const rgt = { horizontal:'right', vertical:'middle' };
      const lft = { horizontal:'left', vertical:'middle' };

      const employees = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      const ssRows    = parseEntities(await all("SELECT data FROM entities WHERE type='SalaryStructure' AND status='active'"));
      const ssMap = {};
      for (const s of ssRows) { if (s.user_id && !ssMap[s.user_id]) ssMap[s.user_id] = s; }

      const sorted = [...employees].sort((a,b) => (a.department||'').localeCompare(b.department||'') || (a.display_name||'').localeCompare(b.display_name||''));

      // Column definitions
      const cols = [
        // EMPLOYEE DETAILS (6)
        { h:'S.No',         k:'sno',       w:5  },
        { h:'Emp Code',     k:'code',      w:10 },
        { h:'Name',         k:'name',      w:22 },
        { h:'Department',   k:'dept',      w:16 },
        { h:'Designation',  k:'desig',     w:18 },
        { h:'Effective',    k:'effDate',   w:12 },
        // CTC (2)
        { h:'Annual CTC',   k:'annCTC',    w:13 },
        { h:'Monthly CTC',  k:'monCTC',    w:12 },
        // EARNINGS (6)
        { h:'Basic',        k:'basic',     w:12 },
        { h:'HRA',          k:'hra',       w:11 },
        { h:'Conveyance',   k:'conv',      w:12 },
        { h:'Special Allow',k:'special',   w:13 },
        { h:'Bonus/VPP',    k:'bonus',     w:12 },
        { h:'Gross/Month',  k:'gross',     w:13 },
        // EMPLOYEE DEDUCTIONS (3)
        { h:'PF (Emp 12%)', k:'pfEmp',     w:12 },
        { h:'ESI (Emp 0.75%)',k:'esiEmp',  w:14 },
        { h:'Total Deduct.',k:'totalDed',  w:13 },
        // NET PAY (1)
        { h:'Net Take-Home',k:'net',       w:14 },
        // EMPLOYER CONTRIBUTIONS (3)
        { h:'PF (Empr 13%)',k:'pfEmpr',    w:13 },
        { h:'ESI (Empr 3.25%)',k:'esiEmpr',w:15 },
        { h:'Total Empr.',  k:'totalEmpr', w:13 },
      ];
      const sections = [
        { label:'EMPLOYEE DETAILS', cols:6, bg:'1A3C5E' },
        { label:'CTC SUMMARY',      cols:2, bg:'1565C0' },
        { label:'EARNINGS',         cols:6, bg:'1B5E20' },
        { label:'EMPLOYEE DEDUCTIONS', cols:3, bg:'B71C1C' },
        { label:'NET PAY',          cols:1, bg:'F57F17' },
        { label:'EMPLOYER CONTRIBUTIONS', cols:3, bg:'4A148C' },
      ];

      const ws = wb.addWorksheet('Salary Structures', { views:[{ state:'frozen', xSplit:0, ySplit:4 }] });
      cols.forEach((c,i) => { ws.getColumn(i+1).width = c.w; });

      // Row 1: Title
      ws.mergeCells(1,1,1,cols.length);
      Object.assign(ws.getCell('A1'), { value:'SALARY STRUCTURES   |   Maxvolt Energy Industries Limited', font:fnt(true,'FFFFFF',14), fill:fl(C.hdr), alignment:{ horizontal:'center', vertical:'middle' } });
      ws.getRow(1).height = 32;

      // Row 2: Meta
      ws.mergeCells(2,1,2,cols.length);
      Object.assign(ws.getCell('A2'), { value:`Generated: ${new Date().toLocaleString('en-IN')}   |   Employees: ${sorted.length}   |   Active salary structures only`, font:fnt(false,'FFFFFF',9), fill:fl(C.sub), alignment:lft });
      ws.getRow(2).height = 18;

      // Row 3: Section headers
      let sc = 1;
      for (const sec of sections) {
        if (sec.cols > 1) ws.mergeCells(3, sc, 3, sc + sec.cols - 1);
        Object.assign(ws.getCell(3, sc), { value:sec.label, font:fnt(true,'FFFFFF',9), fill:fl(sec.bg), alignment:ctr, border:bd() });
        sc += sec.cols;
      }
      ws.getRow(3).height = 18;

      // Row 4: Column headers
      const hRow = ws.getRow(4);
      hRow.height = 22;
      cols.forEach((c,i) => {
        Object.assign(hRow.getCell(i+1), { value:c.h, font:fnt(true,'FFFFFF',9), fill:fl(C.hdr), alignment:{ horizontal:'center', vertical:'middle', wrapText:true }, border:bd() });
      });

      // Data rows
      const totals = { annCTC:0, monCTC:0, basic:0, hra:0, conv:0, special:0, bonus:0, gross:0, pfEmp:0, esiEmp:0, totalDed:0, net:0, pfEmpr:0, esiEmpr:0, totalEmpr:0 };
      sorted.forEach((emp, idx) => {
        const ss = ssMap[emp.user_id] || {};
        const annCTC = ss.ctc || 0;
        const monCTC = Math.round(annCTC / 12);
        const basic  = ss.basic_salary || Math.round(monCTC * 0.5);
        const hra    = ss.hra || Math.round(basic * 0.4);
        const conv   = ss.conveyance || 0;
        const special= ss.special_allowance || 0;
        const bonus  = ss.performance_bonus || ss.ctc_bonus || Math.round(basic * 0.0833);
        const gross  = basic + hra + conv + special;
        const pfEmp  = ss.pf_contribution || Math.round(Math.min(basic, 15000) * 0.12);
        const esiEmp = ss.esi_contribution || (basic <= 21000 ? Math.round(basic * 0.0075) : 0);
        const totalDed = pfEmp + esiEmp;
        const net    = Math.max(0, gross - totalDed);
        const pfEmpr = ss.employer_pf_contribution || Math.round(Math.min(basic, 15000) * 0.13);
        const esiEmpr= ss.employer_esi_contribution || (basic <= 21000 ? Math.round(basic * 0.0325) : 0);
        const totalEmpr = pfEmpr + esiEmpr;

        const rowVals = { annCTC, monCTC, basic, hra, conv, special, bonus, gross, pfEmp, esiEmp, totalDed, net, pfEmpr, esiEmpr, totalEmpr };
        for (const k of Object.keys(totals)) totals[k] += rowVals[k] || 0;

        const isAlt = idx % 2 === 1;
        const row = [
          idx+1, emp.employee_code||'', emp.display_name||'', emp.department||'', emp.designation||'', ss.effective_from||'',
          annCTC, monCTC, basic, hra, conv, special, bonus, gross, pfEmp, esiEmp, totalDed, net, pfEmpr, esiEmpr, totalEmpr,
        ];
        const wsRow = ws.getRow(5 + idx);
        wsRow.height = 18;
        row.forEach((val, ci) => {
          const key = cols[ci].k;
          const cell = wsRow.getCell(ci+1);
          cell.value = val;
          cell.border = bd();
          cell.font = fnt(false, '222222', 9);
          if (isAlt) cell.fill = fl(C.altRow);
          const isNum = ['annCTC','monCTC','basic','hra','conv','special','bonus','gross','pfEmp','esiEmp','totalDed','net','pfEmpr','esiEmpr','totalEmpr'].includes(key);
          if (ci < 6) cell.alignment = ci < 2 ? ctr : lft;
          if (isNum) { cell.numFmt = '#,##0'; cell.alignment = rgt; }
          // Section colouring
          if (['annCTC','monCTC'].includes(key))         cell.fill = fl(C.ctcBg);
          else if (['basic','hra','conv','special','bonus','gross'].includes(key)) cell.fill = fl(C.earnBg);
          else if (['pfEmp','esiEmp','totalDed'].includes(key)) cell.fill = fl(C.dedBg);
          else if (key === 'net')                         cell.fill = fl(C.netBg);
          else if (['pfEmpr','esiEmpr','totalEmpr'].includes(key)) cell.fill = fl(C.emprBg);
        });
      });

      // Totals row
      const totRow = ws.addRow(['', 'TOTAL', '', '', '', '',
        Math.round(totals.annCTC), Math.round(totals.monCTC),
        Math.round(totals.basic), Math.round(totals.hra), Math.round(totals.conv), Math.round(totals.special), Math.round(totals.bonus), Math.round(totals.gross),
        Math.round(totals.pfEmp), Math.round(totals.esiEmp), Math.round(totals.totalDed),
        Math.round(totals.net),
        Math.round(totals.pfEmpr), Math.round(totals.esiEmpr), Math.round(totals.totalEmpr),
      ]);
      totRow.height = 22;
      totRow.eachCell(cell => { cell.font = fnt(true,'FFFFFF',10); cell.fill = fl(C.totBg); cell.border = bd(); if (typeof cell.value === 'number') { cell.numFmt = '#,##0'; cell.alignment = rgt; } });

      const buf = await wb.xlsx.writeBuffer();
      return res.json({ success:true, base64:Buffer.from(buf).toString('base64'), filename:`Salary_Structures_${new Date().toISOString().slice(0,10)}.xlsx`, total:sorted.length });
    }

    /* ── Employee Directory Export (styled Excel, 2 sheets) ─ */
    case 'exportEmployeeDirectory': {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Maxvolt HRMS';

      const fnt = (bold=false,color='000000',size=10) => ({ name:'Arial', bold, color:{argb:`FF${color}`}, size });
      const fl  = (argb) => ({ type:'pattern', pattern:'solid', fgColor:{argb:`FF${argb}`} });
      const bd  = () => ({ top:{style:'thin',color:{argb:'FFD5D5D5'}}, left:{style:'thin',color:{argb:'FFD5D5D5'}}, bottom:{style:'thin',color:{argb:'FFD5D5D5'}}, right:{style:'thin',color:{argb:'FFD5D5D5'}} });
      const ctr = { horizontal:'center', vertical:'middle' };
      const lft = { horizontal:'left', vertical:'middle' };
      const rgt = { horizontal:'right', vertical:'middle' };

      const employees = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active' ORDER BY data::jsonb->>'department', data::jsonb->>'display_name'"));
      const users     = await all("SELECT id, email, display_name, full_name FROM users");
      const userMap   = Object.fromEntries(users.map(u => [u.id, u]));
      const ssRows    = parseEntities(await all("SELECT data FROM entities WHERE type='SalaryStructure' AND status='active'"));
      const ssMap = {};
      for (const s of ssRows) { if (s.user_id && !ssMap[s.user_id]) ssMap[s.user_id] = s; }

      // ── Sheet 1: Employee Master ─────────────────────────────
      const ws1 = wb.addWorksheet('Employee Directory', { views:[{ state:'frozen', xSplit:0, ySplit:4 }] });
      const dirCols = [
        { h:'S.No',             k:'sno',       w:5,  bg:'1A3C5E', sec:'IDENTITY' },
        { h:'Emp Code',         k:'code',      w:10, bg:'1A3C5E', sec:'' },
        { h:'Full Name',        k:'name',      w:24, bg:'1A3C5E', sec:'' },
        { h:'Department',       k:'dept',      w:16, bg:'1565C0', sec:'EMPLOYMENT' },
        { h:'Designation',      k:'desig',     w:18, bg:'1565C0', sec:'' },
        { h:'Emp Status',       k:'status',    w:12, bg:'1565C0', sec:'' },
        { h:'Employment Type',  k:'empType',   w:14, bg:'1565C0', sec:'' },
        { h:'Date of Joining',  k:'doj',       w:13, bg:'1565C0', sec:'' },
        { h:'Confirmation Date',k:'confDate',  w:15, bg:'1565C0', sec:'' },
        { h:'Work Location',    k:'loc',       w:14, bg:'1565C0', sec:'' },
        { h:'Email',            k:'email',     w:24, bg:'2E7D32', sec:'CONTACT' },
        { h:'Phone',            k:'phone',     w:13, bg:'2E7D32', sec:'' },
        { h:'Personal Email',   k:'persEmail', w:24, bg:'2E7D32', sec:'' },
        { h:'Date of Birth',    k:'dob',       w:13, bg:'00695C', sec:'PERSONAL' },
        { h:'Gender',           k:'gender',    w:9,  bg:'00695C', sec:'' },
        { h:'Blood Group',      k:'blood',     w:10, bg:'00695C', sec:'' },
        { h:'Father/Spouse',    k:'fatherSpouse',w:20,bg:'00695C',sec:'' },
        { h:'Address',          k:'address',   w:30, bg:'00695C', sec:'' },
        { h:'Emergency Name',   k:'ecName',    w:18, bg:'4E342E', sec:'EMERGENCY' },
        { h:'Emergency Phone',  k:'ecPhone',   w:14, bg:'4E342E', sec:'' },
        { h:'Emergency Relation',k:'ecRel',    w:14, bg:'4E342E', sec:'' },
        { h:'PAN',              k:'pan',       w:13, bg:'4527A0', sec:'STATUTORY' },
        { h:'Aadhaar',          k:'aadhar',    w:14, bg:'4527A0', sec:'' },
        { h:'UAN',              k:'uan',       w:14, bg:'4527A0', sec:'' },
        { h:'PF Account',       k:'pfAcc',     w:16, bg:'4527A0', sec:'' },
        { h:'ESI Applicable',   k:'esiApp',    w:12, bg:'4527A0', sec:'' },
        { h:'ESI Number',       k:'esiNo',     w:14, bg:'4527A0', sec:'' },
        { h:'Bank Account',     k:'bankAcc',   w:18, bg:'1565C0', sec:'BANK' },
        { h:'IFSC',             k:'ifsc',      w:12, bg:'1565C0', sec:'' },
        { h:'Bank Name',        k:'bankName',  w:16, bg:'1565C0', sec:'' },
        { h:'Branch',           k:'branch',    w:16, bg:'1565C0', sec:'' },
      ];
      dirCols.forEach((c,i) => { ws1.getColumn(i+1).width = c.w; });

      // Title
      ws1.mergeCells(1,1,1,dirCols.length);
      Object.assign(ws1.getCell('A1'), { value:'EMPLOYEE DIRECTORY   |   Maxvolt Energy Industries Limited', font:fnt(true,'FFFFFF',14), fill:fl('1A3C5E'), alignment:ctr });
      ws1.getRow(1).height = 32;
      ws1.mergeCells(2,1,2,dirCols.length);
      Object.assign(ws1.getCell('A2'), { value:`Generated: ${new Date().toLocaleString('en-IN')}   |   Total Employees: ${employees.length}   |   Active employees only`, font:fnt(false,'FFFFFF',9), fill:fl('2D6A9F'), alignment:lft });
      ws1.getRow(2).height = 18;

      // Section headers row 3
      const dirSections = [
        { label:'IDENTITY', cols:3, bg:'1A3C5E' },
        { label:'EMPLOYMENT DETAILS', cols:7, bg:'1565C0' },
        { label:'CONTACT', cols:3, bg:'2E7D32' },
        { label:'PERSONAL', cols:5, bg:'00695C' },
        { label:'EMERGENCY CONTACT', cols:3, bg:'4E342E' },
        { label:'STATUTORY IDs', cols:6, bg:'4527A0' },
        { label:'BANK DETAILS', cols:4, bg:'1565C0' },
      ];
      let dc = 1;
      for (const sec of dirSections) {
        if (sec.cols > 1) ws1.mergeCells(3, dc, 3, dc + sec.cols - 1);
        Object.assign(ws1.getCell(3, dc), { value:sec.label, font:fnt(true,'FFFFFF',9), fill:fl(sec.bg), alignment:ctr, border:bd() });
        dc += sec.cols;
      }
      ws1.getRow(3).height = 18;

      // Column headers row 4
      const hRow1 = ws1.getRow(4);
      hRow1.height = 22;
      dirCols.forEach((c,i) => Object.assign(hRow1.getCell(i+1), { value:c.h, font:fnt(true,'FFFFFF',9), fill:fl(c.bg), alignment:{ horizontal:'center', vertical:'middle', wrapText:true }, border:bd() }));

      // Status colour
      const statusFill = { probation:'FFA500', confirmation:'1B5E20', trainee:'1565C0', active:'1B5E20' };

      // Data rows
      const sectionFills = ['EBF5FB','EBF5FB','EBF5FB','E8F5E9','E8F5E9','E8F5E9','F3E5F5','F3E5F5','F3E5F5','F3E5F5','F3E5F5','F3F0FF','F3F0FF','F3F0FF','F3F0FF','F3F0FF','F3F0FF','E3F2FD','E3F2FD','E3F2FD','E3F2FD','FFF3E0','FFF3E0','FFF3E0','FFF3E0','FFF3E0','FFF3E0','E8EAF6','E8EAF6','E8EAF6','E8EAF6'];
      employees.forEach((emp, idx) => {
        const user  = userMap[emp.user_id] || {};
        const isAlt = idx % 2 === 1;
        const row   = [
          idx+1, emp.employee_code||'', emp.display_name||user.display_name||user.full_name||'',
          emp.department||'', emp.designation||'', emp.employee_status||'', emp.employment_type||'',
          emp.date_of_joining||'', emp.employee_confirmation_date||'', emp.work_location||'',
          user.email||'', emp.phone||'', emp.personal_email||'',
          emp.date_of_birth||'', emp.gender||'', emp.blood_group||'', emp.father_spouse_name||'', emp.address||'',
          emp.emergency_contact?.name||'', emp.emergency_contact?.phone||'', emp.emergency_contact?.relationship||'',
          emp.pan_number||'', emp.aadhar_number||'', emp.uan_number||'', emp.pf_account_number||'',
          emp.is_esi_applicable ? 'Yes' : 'No', emp.esi_number||'',
          emp.bank_account?.account_number||emp.bank_account_number||'',
          emp.bank_account?.ifsc_code||emp.ifsc_code||'',
          emp.bank_account?.bank_name||emp.bank_name||'',
          emp.bank_account?.branch||'',
        ];
        const wsRow = ws1.getRow(5 + idx);
        wsRow.height = 16;
        row.forEach((val, ci) => {
          const cell = wsRow.getCell(ci+1);
          cell.value = val; cell.border = bd(); cell.font = fnt(false,'222222',9);
          const baseFill = sectionFills[ci] || 'FFFFFF';
          cell.fill = fl(isAlt ? baseFill : 'FFFFFF');
          cell.alignment = (ci === 0) ? ctr : (ci >= 4 ? lft : lft);
          // Highlight status cell
          if (dirCols[ci].k === 'status' && val) {
            const sFill = statusFill[val] || '555555';
            cell.fill = fl(sFill + '22');
            cell.font = fnt(true, sFill, 9);
          }
        });
      });

      // ── Sheet 2: Salary Components ───────────────────────────
      const ws2 = wb.addWorksheet('Salary Components', { views:[{ state:'frozen', xSplit:0, ySplit:4 }] });
      const salCols = [
        { h:'S.No',         k:'sno',    w:5  },
        { h:'Emp Code',     k:'code',   w:10 },
        { h:'Name',         k:'name',   w:24 },
        { h:'Department',   k:'dept',   w:16 },
        { h:'Effective From',k:'eff',   w:13 },
        { h:'Annual CTC',   k:'ctc',    w:13 },
        { h:'Monthly CTC',  k:'monCTC', w:12 },
        { h:'Basic',        k:'basic',  w:12 },
        { h:'HRA',          k:'hra',    w:11 },
        { h:'Conveyance',   k:'conv',   w:12 },
        { h:'Special Allow',k:'special',w:13 },
        { h:'Bonus/VPP',    k:'bonus',  w:12 },
        { h:'Gross/Month',  k:'gross',  w:13 },
        { h:'PF (Emp)',     k:'pfEmp',  w:12 },
        { h:'ESI (Emp)',    k:'esiEmp', w:12 },
        { h:'Net Take-Home',k:'net',    w:13 },
        { h:'PF (Empr)',    k:'pfEmpr', w:12 },
        { h:'ESI (Empr)',   k:'esiEmpr',w:13 },
      ];
      salCols.forEach((c,i) => { ws2.getColumn(i+1).width = c.w; });

      const salSections = [
        { label:'EMPLOYEE',    cols:5, bg:'1A3C5E' },
        { label:'CTC',         cols:2, bg:'1565C0' },
        { label:'EARNINGS',    cols:6, bg:'1B5E20' },
        { label:'DEDUCTIONS',  cols:3, bg:'B71C1C' },
        { label:'EMPR CONTRIB',cols:2, bg:'4A148C' },
      ];
      ws2.mergeCells(1,1,1,salCols.length);
      Object.assign(ws2.getCell('A1'), { value:'SALARY COMPONENTS   |   Maxvolt Energy Industries Limited', font:fnt(true,'FFFFFF',14), fill:fl('1A3C5E'), alignment:ctr });
      ws2.getRow(1).height = 32;
      ws2.mergeCells(2,1,2,salCols.length);
      Object.assign(ws2.getCell('A2'), { value:`Generated: ${new Date().toLocaleString('en-IN')}`, font:fnt(false,'FFFFFF',9), fill:fl('2D6A9F'), alignment:lft });
      ws2.getRow(2).height = 18;
      let sc2 = 1;
      for (const sec of salSections) {
        if (sec.cols > 1) ws2.mergeCells(3, sc2, 3, sc2 + sec.cols - 1);
        Object.assign(ws2.getCell(3, sc2), { value:sec.label, font:fnt(true,'FFFFFF',9), fill:fl(sec.bg), alignment:ctr, border:bd() });
        sc2 += sec.cols;
      }
      ws2.getRow(3).height = 18;
      const hRow2 = ws2.getRow(4);
      hRow2.height = 22;
      salCols.forEach((c,i) => Object.assign(hRow2.getCell(i+1), { value:c.h, font:fnt(true,'FFFFFF',9), fill:fl('1A3C5E'), alignment:{ horizontal:'center', vertical:'middle', wrapText:true }, border:bd() }));

      employees.forEach((emp, idx) => {
        const ss = ssMap[emp.user_id] || {};
        const annCTC = ss.ctc || 0;
        const monCTC = Math.round(annCTC / 12);
        const basic  = ss.basic_salary || Math.round(monCTC * 0.5);
        const hra    = ss.hra || Math.round(basic * 0.4);
        const conv   = ss.conveyance || 0;
        const special= ss.special_allowance || 0;
        const bonus  = ss.performance_bonus || ss.ctc_bonus || Math.round(basic * 0.0833);
        const gross  = basic + hra + conv + special;
        const pfEmp  = ss.pf_contribution || Math.round(Math.min(basic, 15000) * 0.12);
        const esiEmp = ss.esi_contribution || (basic <= 21000 ? Math.round(basic * 0.0075) : 0);
        const net    = Math.max(0, gross - pfEmp - esiEmp);
        const pfEmpr = ss.employer_pf_contribution || Math.round(Math.min(basic, 15000) * 0.13);
        const esiEmpr= ss.employer_esi_contribution || (basic <= 21000 ? Math.round(basic * 0.0325) : 0);

        const isAlt  = idx % 2 === 1;
        const row2   = [ idx+1, emp.employee_code||'', emp.display_name||'', emp.department||'', ss.effective_from||'', annCTC, monCTC, basic, hra, conv, special, bonus, gross, pfEmp, esiEmp, net, pfEmpr, esiEmpr ];
        const wsRow  = ws2.getRow(5 + idx);
        wsRow.height = 16;
        const salSecFills = ['','','','','','E3F2FD','E3F2FD','E8F5E9','E8F5E9','E8F5E9','E8F5E9','E8F5E9','E8F5E9','FFEBEE','FFEBEE','FFF9C4','F3E5F5','F3E5F5'];
        row2.forEach((val, ci) => {
          const cell = wsRow.getCell(ci+1);
          cell.value = val; cell.border = bd(); cell.font = fnt(false,'222222',9);
          const base = salSecFills[ci];
          cell.fill = fl(isAlt && base ? base : (base ? 'FFFFFF' : 'FFFFFF'));
          if (ci < 5) cell.alignment = (ci === 0 ? ctr : lft);
          if (ci >= 5) { cell.numFmt = '#,##0'; cell.alignment = rgt; }
          if (ci >= 5 && base) cell.fill = fl(isAlt ? (base || 'FFFFFF') : 'FFFFFF');
        });
      });

      // Totals row on sheet 2
      const sums = employees.reduce((acc, emp) => {
        const ss = ssMap[emp.user_id] || {};
        const annCTC = ss.ctc || 0;
        const monCTC = Math.round(annCTC / 12);
        const basic  = ss.basic_salary || Math.round(monCTC * 0.5);
        const hra    = ss.hra || Math.round(basic * 0.4);
        const conv   = ss.conveyance || 0;
        const special= ss.special_allowance || 0;
        const bonus  = ss.performance_bonus || ss.ctc_bonus || Math.round(basic * 0.0833);
        const gross  = basic + hra + conv + special;
        const pfEmp  = ss.pf_contribution || Math.round(Math.min(basic, 15000) * 0.12);
        const esiEmp = ss.esi_contribution || (basic <= 21000 ? Math.round(basic * 0.0075) : 0);
        const net    = Math.max(0, gross - pfEmp - esiEmp);
        const pfEmpr = ss.employer_pf_contribution || Math.round(Math.min(basic, 15000) * 0.13);
        const esiEmpr= ss.employer_esi_contribution || (basic <= 21000 ? Math.round(basic * 0.0325) : 0);
        return { annCTC:acc.annCTC+annCTC, monCTC:acc.monCTC+monCTC, basic:acc.basic+basic, hra:acc.hra+hra, conv:acc.conv+conv, special:acc.special+special, bonus:acc.bonus+bonus, gross:acc.gross+gross, pfEmp:acc.pfEmp+pfEmp, esiEmp:acc.esiEmp+esiEmp, net:acc.net+net, pfEmpr:acc.pfEmpr+pfEmpr, esiEmpr:acc.esiEmpr+esiEmpr };
      }, { annCTC:0, monCTC:0, basic:0, hra:0, conv:0, special:0, bonus:0, gross:0, pfEmp:0, esiEmp:0, net:0, pfEmpr:0, esiEmpr:0 });
      const totRow2 = ws2.addRow(['', 'TOTAL', '', '', '', Math.round(sums.annCTC), Math.round(sums.monCTC), Math.round(sums.basic), Math.round(sums.hra), Math.round(sums.conv), Math.round(sums.special), Math.round(sums.bonus), Math.round(sums.gross), Math.round(sums.pfEmp), Math.round(sums.esiEmp), Math.round(sums.net), Math.round(sums.pfEmpr), Math.round(sums.esiEmpr)]);
      totRow2.height = 22;
      totRow2.eachCell(cell => { cell.font = fnt(true,'FFFFFF',10); cell.fill = fl('1A3C5E'); cell.border = bd(); if (typeof cell.value === 'number') { cell.numFmt = '#,##0'; cell.alignment = rgt; } });

      const buf2 = await wb.xlsx.writeBuffer();
      return res.json({ success:true, base64:Buffer.from(buf2).toString('base64'), filename:`Employee_Directory_${new Date().toISOString().slice(0,10)}.xlsx`, total:employees.length });
    }

    /* ── Salary Sheet Export (styled Excel) ─────────────── */
    case 'exportSalarySheet': {
      const { month, year } = p;
      if (!month || !year) return res.json({ success: false, error: 'month and year required' });
      const m = parseInt(month), y = parseInt(year);
      const monthStart = `${y}-${String(m).padStart(2,'0')}-01`;
      const monthEnd   = new Date(y, m, 0).toISOString().slice(0,10);
      const monthLabel = new Date(y, m-1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

      const employees = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      const payrolls  = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll' AND data::jsonb->>'month'=$1 AND data::jsonb->>'year'=$2", [String(m), String(y)]));
      const payrollMap = Object.fromEntries(payrolls.map(pr => [pr.user_id, pr]));

      // Build date-keyed attendance map — same structure the muster uses for day-by-day tally
      const attRows2 = parseEntities(await all("SELECT data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2", [monthStart, monthEnd]));
      const attMapSS = {};   // user_id → dateStr → record
      for (const a of attRows2) {
        if (!a.date) continue;
        if (!attMapSS[a.user_id]) attMapSS[a.user_id] = {};
        attMapSS[a.user_id][a.date] = a;
      }

      // All calendar days (including Sundays) are working days at Maxvolt
      const calendarDaysSS = new Date(y, m, 0).getDate();
      const monthDates = [];
      for (let d = 1; d <= calendarDaysSS; d++) {
        const ds = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        monthDates.push({ ds });
      }
      const workingDays = calendarDaysSS;  // 30 or 31 — all days are working days

      const ssAllRows2 = await all("SELECT user_id,data FROM entities WHERE type='SalaryStructure' AND status='active'");
      const ssMapSS = {};
      for (const r of ssAllRows2) ssMapSS[r.user_id] = JSON.parse(r.data);

      const dataRows = employees.map((emp, idx) => {
        const pr        = payrollMap[emp.user_id];
        const attByDate = attMapSS[emp.user_id] || {};
        const hasAtt    = Object.keys(attByDate).length > 0;
        const ss        = ssMapSS[emp.user_id] || {};

        // ── Attendance tally — day-by-day; sandwich policy for Sundays ─────────────
        // Sunday is payable only if present on Saturday OR Monday (sandwich rule).
        const isMusterPresentSS = (r) => {
          if (!r) return false;
          const s = r.status;
          if (s === 'present' || s === 'late' || s === 'on_duty' || s === 'work_from_home' || s === 'half_day') return true;
          if (!s && (r.check_in_time || r.biometric_synced)) return true;
          return false;
        };
        const fmtDateSS = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        let daysPresent = 0, daysHalfDay = 0, daysAbsent = 0;
        if (hasAtt) {
          for (const { ds } of monthDates) {
            const [yr, mo, dy] = ds.split('-').map(Number);
            if (new Date(yr, mo-1, dy).getDay() === 0) {
              // Sunday: sandwich policy
              const satPresent = isMusterPresentSS(attByDate[fmtDateSS(new Date(yr, mo-1, dy-1))]);
              const monPresent = isMusterPresentSS(attByDate[fmtDateSS(new Date(yr, mo-1, dy+1))]);
              if (!satPresent && !monPresent) { daysAbsent++; }  // both sides absent → Sunday LOP
              else { daysPresent++; }                            // protected → count as present
              continue;
            }
            const rec = attByDate[ds];
            if (!rec) {
              daysAbsent++;                                   // no record on any weekday = absent
            } else {
              const s = rec.status;
              if (s === 'half_day') {
                daysPresent += 0.5; daysHalfDay++;
              } else if (s === 'present' || s === 'late' || s === 'on_duty' || s === 'work_from_home') {
                daysPresent++;
              } else if (s === 'absent' || s === 'lop') {
                daysAbsent += 1 + (rec.lop_deduction_days || 0);
              } else if (s === 'week_off' || s === 'holiday' || s === 'leave' || s === 'approved_leave') {
                // paid/off — no LOP
              } else if (rec.check_in_time) {
                daysPresent++;
              } else {
                daysAbsent++;
              }
            }
          }
        } else if (pr) {
          daysHalfDay = pr.half_days || 0;
          daysPresent = pr.present_days || 0;
          daysAbsent  = pr.absent_days  || pr.loss_of_pay_days || 0;
        }

        const totalLOPDays  = daysAbsent + daysHalfDay * 0.5;
        // payDays = calendar days − LOP days; effectiveDays = calendar days for all
        const payDaysSS     = calendarDaysSS - totalLOPDays;
        const effectiveDays = calendarDaysSS;                 // show calendar days (e.g. 30 or 31)

        // ── Earnings — full monthly amounts; LOP is a separate deduction ─────────
        const grossMonthly = (ss.basic_salary||0)+(ss.hra||0)+(ss.conveyance||0)+(ss.special_allowance||0);
        const basic   = pr?.basic_salary      || (ss.basic_salary||0);
        const hra     = pr?.hra               || (ss.hra||0);
        const conv    = pr?.conveyance        || (ss.conveyance||0);
        const special = pr?.special_allowance || (ss.special_allowance||0);
        const grossCalc = basic + hra + conv + special;

        // ── LOP: Gross ÷ calendar days × absent days ──────────────────────────────
        // Attendance is the single source of truth — always recompute from it.
        const lop = totalLOPDays > 0
          ? Math.round(grossMonthly * totalLOPDays / calendarDaysSS)
          : 0;

        // PF: cap basic at ₹15,000 first, then prorate by days worked
        const monthlyPFBaseSS = Math.min(basic, 15000);
        const pfEmp  = pr?.deductions?.pf               ?? Math.round(monthlyPFBaseSS * 0.12 * payDaysSS / calendarDaysSS);
        const pfEmpr = pr?.employer_contributions?.pf   ?? Math.round(monthlyPFBaseSS * 0.13 * payDaysSS / calendarDaysSS);

        // ── ESI: eligibility on full monthly basic; deduction on earned basic ─────
        const earnedBasicESI = Math.round(basic * payDaysSS / calendarDaysSS);
        const esiEmp  = pr?.deductions?.esi  ?? (basic <= 21000 ? Math.round(earnedBasicESI * 0.0075) : 0);
        const esiEmpr = pr?.employer_contributions?.esi ?? (basic <= 21000 ? Math.round(earnedBasicESI * 0.0325) : 0);

        const totalDed = pfEmp + esiEmp + lop;
        const net = Math.max(0, grossCalc - totalDed);

        return {
          sno: idx + 1,
          code: emp.employee_code||'', name: emp.display_name||'',
          dept: emp.department||'',    desig: emp.designation||'',
          account: emp.bank_account_number||'', ifsc: emp.ifsc_code||'', bank: emp.bank_name||'',
          daysPresent:  daysPresent,
          daysHalfDay,
          daysAbsent:   totalLOPDays,
          effectiveDays,
          gross: pr?.gross_salary || grossCalc, basic, hra, conv, special,
          pfEmp, pfEmpr, esiEmp, esiEmpr, lop, totalDed, net,
          status: pr ? (pr.status === 'paid' ? 'Paid' : 'Processed') : 'Pending',
        };
      });

      const totals = dataRows.reduce((acc, r) => {
        acc.gross += r.gross; acc.net += r.net; acc.pfEmp += r.pfEmp; acc.esiEmp += r.esiEmp;
        return acc;
      }, { gross:0, net:0, pfEmp:0, esiEmp:0 });

      // Build styled Excel with exceljs
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Maxvolt HRMS'; wb.created = new Date();
      const ws = wb.addWorksheet('Salary Sheet', { views: [{ state:'frozen', xSplit:0, ySplit:4 }] });

      // Colour palette
      const C = { headerBg:'1A3C5E', headerFg:'FFFFFF', subBg:'2D6A9F', subFg:'FFFFFF',
        earningBg:'E8F5E9', deductBg:'FFEBEE', sumBg:'FFF9C4', altRow:'F5F9FF',
        processedFg:'1B5E20', pendingFg:'B71C1C', totalBg:'1A3C5E', totalFg:'FFFFFF' };
      const font = (bold=false, color='000000', size=10) => ({ name:'Arial', bold, color:{argb:`FF${color}`}, size });
      const fill = (argb) => ({ type:'pattern', pattern:'solid', fgColor:{argb:`FF${argb}`} });
      const border = () => ({ top:{style:'thin',color:{argb:'FFD0D0D0'}}, left:{style:'thin',color:{argb:'FFD0D0D0'}}, bottom:{style:'thin',color:{argb:'FFD0D0D0'}}, right:{style:'thin',color:{argb:'FFD0D0D0'}} });

      // Column definitions first so cols.length is available for merge calculations
      const cols = [
        { header:'S.No',           key:'sno',          width:5  },
        { header:'Emp Code',       key:'code',          width:10 },
        { header:'Employee Name',  key:'name',          width:24 },
        { header:'Department',     key:'dept',          width:16 },
        { header:'Designation',    key:'desig',         width:18 },
        { header:'Account No',     key:'account',       width:16 },
        { header:'IFSC',           key:'ifsc',          width:12 },
        { header:'Bank',           key:'bank',          width:14 },
        // ATTENDANCE (cols 9-12) — values match the attendance muster
        { header:'Days Present',   key:'daysPresent',   width:10 },  // decimal: 22.5
        { header:'Half Days',      key:'daysHalfDay',   width:9  },  // integer: 1
        { header:'Absent Days',    key:'daysAbsent',    width:10 },  // decimal: 2.5 (= absent + half×0.5)
        { header:'Eff. Days',      key:'effectiveDays', width:9  },  // 26 for all
        // EARNINGS (cols 14-18)
        { header:'Gross Salary',   key:'gross',         width:13 },
        { header:'Basic',          key:'basic',         width:12 },
        { header:'HRA',            key:'hra',           width:11 },
        { header:'Conveyance',     key:'conv',          width:12 },
        { header:'Special Allow.', key:'special',       width:13 },
        // DEDUCTIONS (cols 19-25)
        { header:'PF (Emp 12%)',   key:'pfEmp',         width:12 },
        { header:'PF (Empr 13%)',  key:'pfEmpr',        width:12 },
        { header:'ESI (Emp 0.75%)',key:'esiEmp',        width:13 },
        { header:'ESI (Empr 3.25%)',key:'esiEmpr',      width:14 },
        { header:'LOP Deduct.',    key:'lop',           width:12 },
        { header:'Total Deduct.',  key:'totalDed',      width:13 },
        // NET PAY (cols 26-27)
        { header:'Net Salary',     key:'net',           width:13 },
        { header:'Status',         key:'status',        width:10 },
      ];

      // Set column widths explicitly (avoids ExcelJS auto-inserting a header row)
      cols.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

      // Row 1: Title — span all columns
      ws.mergeCells(1, 1, 1, cols.length);
      const title = ws.getCell('A1');
      title.value = `SALARY SHEET — ${monthLabel.toUpperCase()}   |   Maxvolt Energy Industries Limited`;
      title.font = { name:'Arial', bold:true, color:{argb:'FFFFFFFF'}, size:14 };
      title.fill = fill(C.headerBg);
      title.alignment = { horizontal:'center', vertical:'middle' };
      ws.getRow(1).height = 32;

      // Row 2: Meta — span all columns
      ws.mergeCells(2, 1, 2, cols.length);
      const meta = ws.getCell('A2');
      meta.value = `Generated: ${new Date().toLocaleString('en-IN')}   |   Period: ${monthLabel}   |   Employees: ${dataRows.length}   |   Total Gross: ₹${Math.round(totals.gross).toLocaleString('en-IN')}   |   Total Net: ₹${Math.round(totals.net).toLocaleString('en-IN')}`;
      meta.font = { name:'Arial', color:{argb:'FFFFFFFF'}, size:9 };
      meta.fill = fill(C.subBg);
      meta.alignment = { horizontal:'left', vertical:'middle' };
      ws.getRow(2).height = 20;

      // Row 3: Section group headers
      const sectionHeaders = [
        { label:'EMPLOYEE DETAILS', cols:8 },
        { label:'ATTENDANCE',       cols:4 },
        { label:'EARNINGS',         cols:5 },
        { label:'DEDUCTIONS',       cols:6 },
        { label:'NET PAY',          cols:2 },
      ];
      let secCol = 1;
      for (const sec of sectionHeaders) {
        if (sec.cols > 1) ws.mergeCells(3, secCol, 3, secCol + sec.cols - 1);
        const cell = ws.getCell(3, secCol);
        cell.value = sec.label;
        cell.font = font(true, C.headerFg, 9);
        cell.fill = fill(C.subBg);
        cell.alignment = { horizontal:'center', vertical:'middle' };
        secCol += sec.cols;
      }
      ws.getRow(3).height = 18;

      // Row 4: Column headers — explicitly write values then style
      const hdrRow = ws.getRow(4);
      cols.forEach((col, i) => { hdrRow.getCell(i + 1).value = col.header; });
      hdrRow.height = 22;
      hdrRow.eachCell(cell => {
        cell.font = font(true, C.headerFg, 9);
        cell.fill = fill(C.headerBg);
        cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
        cell.border = border();
      });

      // Data rows
      dataRows.forEach((r, i) => {
        const rowNum = 5 + i;
        const isAlt = i % 2 === 1;
        const rowData = [
          r.sno, r.code, r.name, r.dept, r.desig, r.account, r.ifsc, r.bank,
          r.daysPresent, r.daysHalfDay, r.daysAbsent, r.effectiveDays,
          r.gross, r.basic, r.hra, r.conv, r.special,
          r.pfEmp, r.pfEmpr, r.esiEmp, r.esiEmpr, r.lop, r.totalDed, r.net,
          r.status,
        ];
        const wsRow = ws.getRow(rowNum);
        wsRow.height = 18;
        rowData.forEach((val, ci) => {
          const cell = wsRow.getCell(ci+1);
          cell.value = val;
          cell.font = font(false, '222222', 9);
          cell.border = border();
          // Alternate row background
          if (isAlt) cell.fill = fill(C.altRow);
          // Colour-code sections
          const colKey = cols[ci]?.key;
          if (['gross','basic','hra','conv','special'].includes(colKey)) {
            cell.fill = fill(C.earningBg);
            cell.numFmt = '#,##0'; cell.alignment = { horizontal:'right' };
          } else if (['pfEmp','pfEmpr','esiEmp','esiEmpr','lop','totalDed'].includes(colKey)) {
            cell.fill = fill(C.deductBg);
            cell.numFmt = '#,##0'; cell.alignment = { horizontal:'right' };
          } else if (colKey === 'net') {
            cell.fill = fill(C.sumBg);
            cell.font = font(true, '1A3C5E', 10);
            cell.numFmt = '#,##0'; cell.alignment = { horizontal:'right' };
          } else if (colKey === 'status') {
            cell.font = font(true, r.status==='Processed' ? C.processedFg : C.pendingFg, 9);
            cell.alignment = { horizontal:'center' };
          } else if (['daysPresent','daysHalfDay','daysAbsent','effectiveDays'].includes(colKey)) {
            cell.alignment = { horizontal:'center' };
          } else if (ci < 5) {
            cell.alignment = { horizontal:'left' };
          }
        });
      });

      // Totals row
      const totRow = ws.addRow([
        '', 'TOTAL', '', '', '', '', '', '',
        dataRows.reduce((s,r)=>s+r.daysPresent,0),
        dataRows.reduce((s,r)=>s+r.daysHalfDay,0),
        dataRows.reduce((s,r)=>s+r.daysAbsent,0),
        '',
        Math.round(totals.gross), '', '', '', '',
        Math.round(dataRows.reduce((s,r)=>s+r.pfEmp,0)),
        Math.round(dataRows.reduce((s,r)=>s+r.pfEmpr,0)),
        Math.round(dataRows.reduce((s,r)=>s+r.esiEmp,0)),
        Math.round(dataRows.reduce((s,r)=>s+r.esiEmpr,0)),
        Math.round(dataRows.reduce((s,r)=>s+r.lop,0)),
        Math.round(dataRows.reduce((s,r)=>s+r.totalDed,0)),
        Math.round(totals.net), '',
      ]);
      totRow.height = 22;
      totRow.eachCell(cell => {
        cell.font = font(true, C.totalFg, 10);
        cell.fill = fill(C.totalBg);
        cell.border = border();
        if (typeof cell.value === 'number') { cell.numFmt = '#,##0'; cell.alignment = { horizontal:'right' }; }
      });

      const buf = await wb.xlsx.writeBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      const filename = `Salary_Sheet_${monthLabel.replace(/\s/g,'_')}_${y}.xlsx`;
      return res.json({ success: true, base64, filename, total_employees: employees.length, totals, format: 'xlsx' });
    }

    /* ── API Key Management (for external attendance push) ─ */
    case 'getAttendanceApiInfo': {
      const key = (await one("SELECT value FROM settings WHERE key='attendance_api_key'"))?.value || null;
      const baseUrl = process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://your-app.up.railway.app' : `http://localhost:${process.env.PORT || 3001}`);
      return res.json({
        success: true,
        api_key: key,
        endpoint: `${baseUrl}/api/attendance-log`,
        docs: {
          method: 'POST',
          auth: 'Authorization: Bearer <api_key>',
          single: { employee_code: 'EMP001', punch_time: '2024-06-19T09:00:00.000Z', type: 'in', device_id: 'DEVICE01' },
          batch: { records: [{ employee_code: 'EMP001', punch_time: '2024-06-19T09:00:00.000Z', type: 'in' }] },
        },
      });
    }

    case 'generateAttendanceApiKey': {
      // Only admins may regenerate
      const { randomBytes } = await import('crypto');
      const newKey = randomBytes(32).toString('hex');
      await run("INSERT INTO settings(key,value,updated_at) VALUES('attendance_api_key',$1,NOW()::TEXT) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()::TEXT", [newKey]);
      // Also update env-like value so attendancelog.js picks it up via this DB key
      process.env.ATTENDANCE_API_KEY = newKey;
      return res.json({ success: true, api_key: newKey });
    }

    case 'autoSendPayslips': {
      const { month, year } = p;
      const payrolls = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll'"))
        .filter(r => r.month === month && r.year === year);

      let sent = 0, failed = 0, errors = [];
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const monLabel = `${months[month - 1]} ${year}`;

      for (const pr of payrolls) {
        try {
          const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [pr.user_id]);
          const emp = empRow ? JSON.parse(empRow.data) : {};
          const userRow = await one("SELECT email FROM users WHERE id=$1", [pr.user_id]);
          const email = userRow?.email;
          if (!email) { failed++; errors.push(`No email for ${emp.display_name}`); continue; }

          const html = buildPayslipHtml(pr, emp);
          await sendEmail({
            to: email,
            subject: `Your Payslip for ${monLabel} — Maxvolt Energy`,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px">
              <p>Dear ${emp.display_name || 'Employee'},</p>
              <p>Please find your payslip for <strong>${monLabel}</strong> below.</p>
              ${html}
              <p style="color:#999;font-size:12px;margin-top:20px">This is an auto-generated email. For queries, contact HR.</p>
            </div>`
          });
          sent++;
        } catch (e) {
          failed++;
          errors.push(e.message);
        }
      }
      return res.json({ success: true, sent, failed, errors, message: `Sent ${sent} payslips, ${failed} failed` });
    }

    case 'processFnFSettlement': {
      const { exit_id, employee_id } = p;
      if (!exit_id && !employee_id) return res.json({ success:false, error:'exit_id or employee_id required' });

      const exitRow = exit_id
        ? await one("SELECT data FROM entities WHERE type='Exit' AND id=$1", [exit_id]): await one("SELECT data FROM entities WHERE type='Exit' AND user_id=$1", [employee_id]);
      if (!exitRow) return res.json({ success:false, error:'Exit record not found' });
      const exitData = JSON.parse(exitRow.data);

      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [exitData.user_id || employee_id]);
      const emp    = empRow ? JSON.parse(empRow.data) : {};

      const ssRow = await one("SELECT data FROM entities WHERE type='SalaryStructure' AND user_id=$1 AND status='active'", [emp.user_id || employee_id]);
      const ss    = ssRow ? JSON.parse(ssRow.data) : {};

      const gross        = (ss.basic_salary||0) + (ss.hra||0) + (ss.conveyance||0) + (ss.special_allowance||0);
      const dailySalary  = gross > 0 ? gross / 26 : 0;

      // LOP for notice period shortfall (if employee left without serving full notice)
      const noticePeriodDays = parseInt(emp.notice_period_days) || 30;
      const servedDays       = parseInt(exitData.notice_days_served) || noticePeriodDays;
      const shortfallDays    = Math.max(0, noticePeriodDays - servedDays);
      const noticePeriodDeduction = Math.round(shortfallDays * dailySalary);

      // Leave encashment for pending earned leave
      const leaveBalRows = await all("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [emp.user_id || employee_id]);
      const earnedLeaveBalance = leaveBalRows.map(r => JSON.parse(r.data)).find(lb => lb.balance_type === 'earned' || lb.leave_type === 'earned_leave')?.balance || 0;
      const leaveEncashment = Math.round(earnedLeaveBalance * dailySalary);

      // Pro-rata salary for last partial month
      const lastWorkingDate = exitData.last_working_date ? new Date(exitData.last_working_date) : new Date();
      const daysWorkedInMonth = lastWorkingDate.getDate();
      const proRataSalary = Math.round(daysWorkedInMonth * dailySalary);

      const gratuityEligible = parseInt(emp.years_of_service || emp.tenure_years || 0) >= 5;
      const gratuity = gratuityEligible ? Math.round((ss.basic_salary||0) * 15 / 26 * Math.min(parseInt(emp.years_of_service||0), 30)) : 0;

      const totalPayable = proRataSalary + leaveEncashment + gratuity;
      const totalDeductions = noticePeriodDeduction;
      const netPayable = Math.max(0, totalPayable - totalDeductions);

      const fnf = {
        employee_id: emp.id, user_id: emp.user_id,
        gross_monthly: gross, daily_rate: Math.round(dailySalary),
        pro_rata_salary: proRataSalary, days_worked_last_month: daysWorkedInMonth,
        leave_encashment: leaveEncashment, earned_leave_days: earnedLeaveBalance,
        gratuity, gratuity_eligible: gratuityEligible,
        notice_shortfall_days: shortfallDays, notice_period_deduction: noticePeriodDeduction,
        total_payable: totalPayable, total_deductions: totalDeductions, net_payable: netPayable,
        computed_at: new Date().toISOString(),
      };

      // Save to exit record
      const updatedExit = { ...exitData, fnf_settlement: fnf, fnf_computed_at: new Date().toISOString() };
      await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(updatedExit), exitRow.id]);

      return res.json({ success:true, ...fnf });
    }

    /* ── Attendance ───────────────────────────────────── */
    case 'getAllAttendance': {
      const { date, user_id: uid, date_from, date_to } = p;
      // SQL-level date filtering for performance
      let query = "SELECT data FROM entities WHERE type='Attendance'";
      const params = [];
      if (uid)       { query += ` AND (user_id=$${params.length+1} OR data::jsonb->>'user_id'=$${params.length+1})`; params.push(uid); }
      if (date)      { query += ` AND data::jsonb->>'date'=$${params.length+1}`;                   params.push(date); }
      else {
        if (date_from) { query += ` AND data::jsonb->>'date'>=$${params.length+1}`; params.push(date_from); }
        if (date_to)   { query += ` AND data::jsonb->>'date'<=$${params.length+1}`; params.push(date_to); }
      }
      const rows = await all(query, params);
      const allRecords = rows.map(r => JSON.parse(r.data));

      // Deduplicate per (user_id, date): prefer biometric records over auto-absent records.
      // markAbsentEmployees can create a duplicate absent record when the biometric record's
      // DB user_id column is null but the JSON user_id is populated (code-map mismatch at
      // insert time). Without dedup the absent record (inserted last) would win in the
      // frontend map and hide the real biometric data.
      const dedupKey = (r) => `${r.user_id || ''}__${r.date || ''}`;
      const best = {};
      for (const rec of allRecords) {
        const key = dedupKey(rec);
        if (!rec.user_id) continue; // skip records with no user_id — cannot map to employee
        const prev = best[key];
        if (!prev) { best[key] = rec; continue; }
        // Keep the "better" record:
        //   biometric_synced=true > has check_in_time > not-absent > otherwise keep newer
        const score = (r) =>
          (r.biometric_synced ? 8 : 0) +
          (r.check_in_time    ? 4 : 0) +
          (r.status !== 'absent' && r.status !== 'auto_marked' ? 2 : 0) +
          (r.status === 'regularised' ? 1 : 0);
        if (score(rec) > score(prev)) best[key] = rec;
      }
      return res.json({ records: Object.values(best) });
    }

    case 'syncManagerRoles': {
      // Finds all employees who are listed as a reporting manager for someone else,
      // and upgrades their user role from 'employee'/'onboarding_pending' to 'management'.
      const empRows = await all("SELECT data FROM entities WHERE type='Employee'");
      const mgrEmails = new Set();
      for (const r of empRows) {
        const d = JSON.parse(r.data);
        if (d.reporting_manager_email) mgrEmails.add(d.reporting_manager_email.toLowerCase().trim());
      }
      let promoted = 0, already = 0, notFound = 0;
      for (const email of mgrEmails) {
        const u = await one("SELECT id, role FROM users WHERE LOWER(email)=$1", [email]);
        if (!u) { notFound++; continue; }
        if (['admin','hr','manager','management'].includes(u.role)) { already++; continue; }
        await run("UPDATE users SET role='management', custom_role='management', updated_at=NOW()::TEXT WHERE id=$1", [u.id]);
        promoted++;
      }
      return res.json({
        success: true,
        message: `${promoted} manager(s) promoted to management role. ${already} already at management/higher. ${notFound} not found in users.`,
        promoted, already, not_found: notFound, total_managers: mgrEmails.size,
      });
    }

    case 'fixAttendanceTimestamps': {
      // One-time migration: attendance records created before the IST-digit fix stored
      // check_in_time/check_out_time as real UTC (new Date().toISOString()).
      // The display layer strips Z and treats digits as IST, so "03:30Z" (= 9 AM IST in UTC)
      // shows as "3:30 AM". Detection: UTC hour < 6 for check_in (office 8-11 AM IST = 2:30-5:30 UTC).
      // If check_in is UTC-stored, check_out is too — fix both on the same record.
      const { dry_run = true } = p;
      const IST_MS = 5.5 * 60 * 60 * 1000;

      const rows = await all("SELECT id, data FROM entities WHERE type='Attendance'");
      const toFix = [];

      for (const row of rows) {
        const data = JSON.parse(row.data);
        if (data.biometric_synced) continue;
        if (!data.check_in_time) continue;

        const cin = new Date(data.check_in_time);
        if (isNaN(cin.getTime())) continue;
        if (cin.getUTCHours() >= 6) continue; // already IST-digit or no fix needed

        const newCin = new Date(cin.getTime() + IST_MS).toISOString();
        let newCout = null;
        if (data.check_out_time) {
          const cout = new Date(data.check_out_time);
          newCout = isNaN(cout.getTime()) ? data.check_out_time : new Date(cout.getTime() + IST_MS).toISOString();
        }

        toFix.push({ id: row.id, data, newCin, newCout });
      }

      if (!dry_run) {
        for (const item of toFix) {
          const updated = {
            ...item.data,
            check_in_time: item.newCin,
            ...(item.newCout !== null ? { check_out_time: item.newCout } : {}),
          };
          await run('UPDATE entities SET data=$1 WHERE id=$2', [JSON.stringify(updated), item.id]);
        }
      }

      return res.json({
        success: true,
        dry_run,
        count: toFix.length,
        preview: dry_run ? toFix.slice(0, 20).map(f => ({
          id: f.id,
          date: f.data.date,
          old_check_in: f.data.check_in_time,
          new_check_in: f.newCin,
          old_check_out: f.data.check_out_time || null,
          new_check_out: f.newCout,
        })) : [],
        message: dry_run
          ? `Found ${toFix.length} records with UTC-stored timestamps. Call with dry_run=false to fix.`
          : `Successfully fixed ${toFix.length} attendance records.`,
      });
    }

    case 'fixCheckInOutSwap': {
      // Fixes two related problems:
      //   (A) check_in_time > check_out_time  → classic swap
      //   (B) check_in_time missing but check_out_time has the arrival time
      //       (single punch stored in the wrong field — shown as "— IN → 10:06 AM OUT")
      // Also filters out corrupt raw_punches entries (null/invalid times) before
      // re-running buildSessions, which prevents the "null" string propagating.
      // Safe to run multiple times (idempotent).
      const { dry_run = true } = p;

      const badRows = await all(`
        SELECT id, data FROM entities
        WHERE type='Attendance'
          AND data::jsonb->>'status' != 'regularised'
          AND (
            -- Case A: both times present but IN is later than OUT
            (
              data::jsonb->>'check_in_time'  IS NOT NULL
              AND data::jsonb->>'check_out_time' IS NOT NULL
              AND data::jsonb->>'check_in_time'  > data::jsonb->>'check_out_time'
            )
            OR
            -- Case B: check_in missing but check_out has a real value
            (
              (data::jsonb->>'check_in_time' IS NULL OR data::jsonb->>'check_in_time' = '')
              AND data::jsonb->>'check_out_time' IS NOT NULL
              AND data::jsonb->>'check_out_time' != ''
            )
            OR
            -- Case C: check_in is exactly midnight — biometric device daily-reset / placeholder
            -- row stored as the first punch, pushing the real arrival into check_out position.
            (
              data::jsonb->>'check_in_time' LIKE '%T00:00:00.000Z'
            )
            OR
            -- Case D: check_in and check_out are within 60 seconds of each other.
            -- Before buildSessions had dedup, two punches from the same physical tap
            -- (possibly differing only in milliseconds) became position-0 check_in and
            -- position-1 check_out. The SUBSTRING(…,12,8) trick compares HH:MM:SS only,
            -- ignoring sub-second differences and timezone suffix format variations.
            (
              data::jsonb->>'check_in_time' IS NOT NULL
              AND data::jsonb->>'check_in_time' != ''
              AND data::jsonb->>'check_out_time' IS NOT NULL
              AND data::jsonb->>'check_out_time' != ''
              AND SUBSTRING(data::jsonb->>'check_in_time', 12, 8)
                = SUBSTRING(data::jsonb->>'check_out_time', 12, 8)
            )
          )
      `);

      if (badRows.length === 0) {
        return res.json({ success: true, dry_run, found: 0, fixed: 0, preview: [],
          message: 'No records with swapped, missing, or midnight-ghost IN/OUT times — nothing to fix.' });
      }

      // Pre-fetch employees + shifts to avoid N per-row queries
      const empRows   = await all("SELECT data FROM entities WHERE type='Employee'");
      const shiftRows = await all("SELECT id, data FROM entities WHERE type='Shift'");
      const empMap   = {};
      const shiftMap = {};
      for (const r of empRows)   { const e = JSON.parse(r.data); if (e.user_id) empMap[e.user_id] = e; }
      for (const r of shiftRows) { shiftMap[r.id] = JSON.parse(r.data); }
      const defaultShift = { start_time: '09:30', end_time: '18:30', grace_minutes: 15 };

      // Returns true only for ISO-ish timestamp strings with a valid, non-midnight time.
      // Midnight (00:00:00) is rejected because it is the biometric device's daily-reset /
      // placeholder entry — never a real punch — and is the root cause of the Case C bug.
      const isValidTs = (t) => {
        if (!t) return false;
        const s = String(t).trim();
        if (!s || s === 'null' || s === 'undefined') return false;
        if (/[T ]00:00:00/.test(s)) return false; // midnight = device placeholder
        const ms = new Date(s.replace(' ', 'T')).getTime();
        return !isNaN(ms) && ms > 0 && new Date(ms).getFullYear() > 2000;
      };

      const preview = [];
      const updates = [];

      for (const row of badRows) {
        const d = JSON.parse(row.data);

        // Strip out any corrupt raw_punch entries (null time, "null" string, bad dates)
        const validPunches = (d.raw_punches || []).filter(rp => isValidTs(rp?.time));

        let sd, newStatus, newLateMin;

        if (validPunches.length > 0) {
          // Re-run buildSessions on clean punches — fixed sort handles ordering
          sd = buildSessions(validPunches);
        } else {
          // No valid raw_punches: synthesise one punch from check_out_time
          // (that field holds the actual arrival time in Case B)
          const syntheticTime = d.check_out_time || d.check_in_time;
          sd = buildSessions([{ time: syntheticTime, device_direction: 'IN' }]);
        }

        const emp   = empMap[d.user_id] || {};
        const shift = (emp.shift_id && shiftMap[emp.shift_id]) || defaultShift;
        const { status, late_minutes } = computeStatusFromSessions(sd, shift);
        newStatus  = status;
        newLateMin = late_minutes;

        const newCin  = sd.check_in_time  || null;
        const newCout = sd.check_out_time || null;

        // Nothing changed — skip
        if (newCin === (d.check_in_time || null) && newCout === (d.check_out_time || null)) continue;
        if (!newCin) continue; // rebuild also failed — leave alone

        preview.push({
          date:          d.date,
          employee_code: d.employee_code || '—',
          old_check_in:  d.check_in_time  || null,
          new_check_in:  newCin,
          old_check_out: d.check_out_time || null,
          new_check_out: newCout,
        });

        updates.push([
          newStatus || d.status,
          JSON.stringify({
            ...d,
            ...sd,
            check_in_time:  newCin,
            check_out_time: newCout,
            raw_punches:    validPunches.length > 0 ? validPunches : sd.raw_punches,
            status:         newStatus || d.status,
            late_minutes:   newLateMin ?? d.late_minutes,
          }),
          row.id,
        ]);
      }

      if (!dry_run && updates.length > 0) {
        for (let i = 0; i < updates.length; i += 50) {
          const batch = updates.slice(i, i + 50);
          await Promise.all(batch.map(([s, dat, id]) =>
            run("UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3", [s, dat, id])
          ));
        }
      }

      return res.json({
        success: true,
        dry_run,
        found:   badRows.length,
        fixed:   updates.length,
        preview: preview.slice(0, 50),
        message: dry_run
          ? `Found ${updates.length} record(s) with swapped, missing, or midnight-ghost IN/OUT times. Run without dry_run to fix.`
          : `Fixed ${updates.length} attendance record(s) — midnight ghost punches removed, IN/OUT times corrected.`,
      });
    }

    case 'cleanupAutoAbsent': {
      // Deletes auto-absent records for employees who actually have biometric attendance
      // on that date.  These phantom absents were created by the old markAbsentEmployees
      // bug where the user_id in the Employee JSON differed from the user_id stored on the
      // biometric Attendance record (resolved via BiometricCodeMapping at punch time).
      // Because the user_ids differed they had different dedup keys in getAllAttendance,
      // so both records were returned and the absent one won in the frontend.
      //
      // Matching strategy:  absent.user_id → Employee entity → employee_code
      //                     then check biometric Attendance for same date + employee_code
      const { dry_run = true } = p;

      // All auto-marked absent records
      const absentRows = await all(`
        SELECT id, data FROM entities
        WHERE type='Attendance'
          AND status='absent'
          AND data::jsonb->>'source' = 'auto_marked'
      `);

      // Employee map: user_id → { name, employee_code, biometric_id }
      const empMeta = await all("SELECT data FROM entities WHERE type='Employee'");
      const empByUid = {};
      for (const r of empMeta) {
        const e = JSON.parse(r.data);
        if (e.user_id) empByUid[e.user_id] = e;
      }

      const toDelete = [];
      const preview  = [];

      for (const row of absentRows) {
        const absent = JSON.parse(row.data);
        if (!absent.user_id || !absent.date) continue;

        const emp     = empByUid[absent.user_id] || {};
        const empCode = emp.employee_code || emp.biometric_id || null;

        // Check for a real (non-auto-absent) attendance record for the same employee + date.
        // Match on: same user_id  OR  same employee_code in the biometric record.
        const biometric = await one(`
          SELECT id, data FROM entities
          WHERE type='Attendance'
            AND id != $1
            AND data::jsonb->>'date' = $2
            AND NOT (data::jsonb->>'source' = 'auto_marked' AND status = 'absent')
            AND (
              user_id = $3
              OR data::jsonb->>'user_id' = $3
              OR ($4 <> '' AND data::jsonb->>'employee_code' = $4)
            )
          LIMIT 1
        `, [row.id, absent.date, absent.user_id, empCode || '']);

        if (biometric) {
          const bio = JSON.parse(biometric.data);
          toDelete.push(row.id);
          preview.push({
            date:          absent.date,
            employee:      emp.name || absent.user_id,
            employee_code: empCode || '—',
            real_check_in:  bio.check_in_time  || '—',
            real_check_out: bio.check_out_time || '—',
          });
        }
      }

      if (!dry_run && toDelete.length > 0) {
        for (let i = 0; i < toDelete.length; i += 50) {
          const batch = toDelete.slice(i, i + 50);
          await Promise.all(batch.map(id => run("DELETE FROM entities WHERE id=$1", [id])));
        }
      }

      return res.json({
        success: true,
        dry_run,
        found:   toDelete.length,
        deleted: dry_run ? 0 : toDelete.length,
        preview: preview.slice(0, 50),
        message: dry_run
          ? `Found ${toDelete.length} phantom absent record(s) for employees who have biometric attendance. Click Apply to delete them.`
          : `Deleted ${toDelete.length} phantom absent record(s) — attendance display should now show correct times.`,
      });
    }

    case 'scanAttendanceDiagnostic': {
      // Returns a raw snapshot of attendance records for a given date so we can see
      // exactly what check_in_time / check_out_time / raw_punches look like in the DB.
      // Use this to diagnose why fixCheckInOutSwap reports 0 — the actual field values
      // may differ from what the SQL LIKE pattern expects.
      const { date } = p;
      const targetDate = date || new Date().toISOString().slice(0, 10);

      const rows = await all(`
        SELECT id, user_id, status, data
        FROM entities
        WHERE type='Attendance'
          AND data::jsonb->>'date' = $1
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 200
      `, [targetDate]);

      const empMeta = await all("SELECT user_id, data FROM entities WHERE type='Employee'");
      const empByUid = {};
      for (const r of empMeta) {
        const e = JSON.parse(r.data);
        if (e.user_id) empByUid[e.user_id] = { name: e.name, code: e.employee_code };
      }

      const records = rows.map(r => {
        const d = JSON.parse(r.data);
        const emp = empByUid[r.user_id] || empByUid[d.user_id] || {};
        const punches = d.raw_punches || [];
        return {
          id:             r.id,
          user_id:        r.user_id,
          employee:       emp.name || '—',
          employee_code:  emp.code || d.employee_code || '—',
          db_status:      r.status,
          json_status:    d.status,
          source:         d.source || '—',
          check_in_raw:   d.check_in_time  ?? 'NULL',
          check_out_raw:  d.check_out_time ?? 'NULL',
          punch_count:    punches.length,
          punch_times:    punches.map(p => p?.time ?? 'null').slice(0, 6),
          sessions_count: (d.sessions || []).length,
          biometric_synced: d.biometric_synced || false,
        };
      });

      const summary = {
        total: records.length,
        absent_auto: records.filter(r => r.source === 'auto_marked').length,
        biometric:   records.filter(r => r.biometric_synced).length,
        midnight_checkin: records.filter(r => /T00:00:00/.test(String(r.check_in_raw))).length,
        null_checkin:  records.filter(r => r.check_in_raw === 'NULL' || r.check_in_raw === '').length,
        has_checkout:  records.filter(r => r.check_out_raw !== 'NULL' && r.check_out_raw !== '').length,
      };

      return res.json({ success: true, date: targetDate, summary, records });
    }

    case 'getAttendanceLogs': {
      // Server-side paginated query for biometric punch logs (supports 50k+ records)
      const { date_from, date_to, emp_code, page = 1, limit = 200 } = p;
      const pageNum  = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
      const offset   = (pageNum - 1) * limitNum;

      const whereParts = [];
      const qp = [];
      let idx = 1;
      // LogDate stored as "2026-01-15T09:30:00.000Z" — first 10 chars are the IST date
      if (date_from) { whereParts.push(`SUBSTRING(data::jsonb->>'LogDate', 1, 10) >= $${idx++}`); qp.push(date_from); }
      if (date_to)   { whereParts.push(`SUBSTRING(data::jsonb->>'LogDate', 1, 10) <= $${idx++}`); qp.push(date_to); }
      if (emp_code)  { whereParts.push(`UPPER(data::jsonb->>'EmployeeCode') LIKE UPPER($${idx++})`); qp.push(`%${emp_code.trim()}%`); }

      const baseWhere = `type='AttendanceLog'${whereParts.length ? ' AND ' + whereParts.join(' AND ') : ''}`;
      const todayIST  = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

      const [countRow, logRows, todayCount, todayUnique] = await Promise.all([
        one(`SELECT COUNT(*) as c FROM entities WHERE ${baseWhere}`, qp),
        all(`SELECT data FROM entities WHERE ${baseWhere} ORDER BY data::jsonb->>'LogDate' DESC NULLS LAST LIMIT $${idx} OFFSET $${idx+1}`, [...qp, limitNum, offset]),
        one(`SELECT COUNT(*) as c FROM entities WHERE type='AttendanceLog' AND SUBSTRING(data::jsonb->>'LogDate',1,10)=$1`, [todayIST]),
        one(`SELECT COUNT(DISTINCT data::jsonb->>'EmployeeCode') as c FROM entities WHERE type='AttendanceLog' AND SUBSTRING(data::jsonb->>'LogDate',1,10)=$1`, [todayIST]),
      ]);

      const total = parseInt(countRow.c);
      return res.json({
        success: true,
        logs: logRows.map(r => JSON.parse(r.data)),
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
        today_punches:   parseInt(todayCount.c),
        today_employees: parseInt(todayUnique.c),
      });
    }

    case 'reprocessAttendanceLogs': {
      // Re-reads stored AttendanceLogs for a date range and upserts Attendance records.
      // Uses alternating-position punch model (buildSessions) — same as live punch endpoint.
      const { date_from, date_to } = p;
      if (!date_from) return res.json({ success: false, error: 'date_from is required (yyyy-MM-dd)' });
      const toDate = date_to || date_from;

      // Fetch logs in range (LogDate stored as IST-digits.000Z; slice(0,10) gives the date)
      const logRows = await all("SELECT data FROM entities WHERE type='AttendanceLog'");
      const logsInRange = logRows
        .map(r => JSON.parse(r.data))
        .filter(log => {
          const d = log.LogDate ? String(log.LogDate).slice(0, 10) : null;
          return d && d >= date_from && d <= toDate;
        });

      if (!logsInRange.length) return res.json({ success: true, total_logs: 0, attendance_updated: 0, message: 'No logs found in date range' });

      // Build employee code→user_id map
      const empRows = await all("SELECT user_id, data FROM entities WHERE type='Employee'");
      const codeMap = {};
      empRows.forEach(r => {
        const d = JSON.parse(r.data);
        if (d.employee_code && r.user_id) codeMap[String(d.employee_code).toLowerCase()] = r.user_id;
        if (d.biometric_id  && r.user_id) codeMap[String(d.biometric_id).toLowerCase()]  = r.user_id;
      });
      const mappingRows = await all("SELECT data FROM entities WHERE type='BiometricCodeMapping'");
      mappingRows.forEach(r => { const m = JSON.parse(r.data); if (m.biometric_code && m.user_id) codeMap[String(m.biometric_code).toLowerCase()] = m.user_id; });

      // Group punches by (userId, date) — collect raw punch list per group
      const groups = {};
      for (const log of logsInRange) {
        const codeRaw = String(log.EmployeeCode || log.employee_code || '').trim();
        const userId  = log.user_id || codeMap[codeRaw.toLowerCase()] || null;
        if (!userId) continue;
        const punchDate = String(log.LogDate).slice(0, 10);
        const key = `${userId}_${punchDate}`;
        if (!groups[key]) groups[key] = { userId, date: punchDate, rawPunches: [], empCode: codeRaw };
        if (!groups[key].rawPunches.some(rp => rp.time === log.LogDate))
          groups[key].rawPunches.push({ time: log.LogDate, device_direction: String(log.Direction || log.type || 'IN').toUpperCase() });
      }

      let updated = 0, created = 0, skipped = 0;
      for (const { userId, date, rawPunches, empCode } of Object.values(groups)) {
        if (!rawPunches.length) continue;

        // Load employee + shift
        const empRow2 = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1 LIMIT 1", [userId]);
        const empData = empRow2 ? JSON.parse(empRow2.data) : {};
        let shift = { start_time: '09:00', end_time: '18:00', working_hours: 9, grace_period_minutes: 15 };
        if (empData.shift_id) {
          const sr = await one("SELECT data FROM entities WHERE type='Shift' AND id=$1", [empData.shift_id]);
          if (sr) shift = JSON.parse(sr.data);
        } else {
          const dr = await one("SELECT data FROM entities WHERE type='Shift' AND (data::jsonb->>'is_default'='true' OR data::jsonb->>'is_default'='1') LIMIT 1");
          if (dr) shift = JSON.parse(dr.data);
        }

        // Build sessions using alternating model
        const sd = buildSessions(rawPunches);
        const { status, late_minutes } = computeStatusFromSessions(sd, shift);

        const existing = await one("SELECT id,data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2 LIMIT 1", [userId, date]);
        if (existing) {
          const d = JSON.parse(existing.data);
          if (d.status === 'regularised') { skipped++; continue; }
          const upd = { ...d, biometric_synced: true, employee_code: empData.employee_code || empCode || d.employee_code, ...sd, status, late_minutes };
          await run("UPDATE entities SET status=$1,data=$2,updated_at=NOW()::TEXT WHERE id=$3", [status, JSON.stringify(upd), existing.id]);
          updated++;
        } else {
          const id2 = uuidv4();
          const attData = { id: id2, user_id: userId, date, source: 'biometric', biometric_synced: true, employee_code: empData.employee_code || empCode, ...sd, status, late_minutes };
          await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,$3,$4)", [id2, userId, status, JSON.stringify(attData)]);
          created++;
        }
      }

      return res.json({ success: true, total_logs: logsInRange.length, groups_processed: Object.keys(groups).length, attendance_updated: updated, attendance_created: created, skipped_regularised: skipped });
    }

    case 'closeOpenSessions': {
      // Runs after 5:30 AM IST — closes any session still "in_progress" from the target date.
      // Employees who worked meaningful hours are NOT marked absent — we pick present/half_day/short_attendance.
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
      const nowIST = new Date(Date.now() + IST_OFFSET_MS);
      const todayIST = nowIST.toISOString().slice(0, 10);
      const yesterdayIST = new Date(new Date(todayIST + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
      const targetDate = p?.date || yesterdayIST;

      const rows = await all(
        "SELECT id, data FROM entities WHERE type='Attendance' AND data::jsonb->>'date'=$1",
        [targetDate]
      );

      let closed = 0;
      for (const row of rows) {
        const d = JSON.parse(row.data);
        if (d.status === 'regularised') continue;
        if (!d.is_in_progress && d.status !== 'in_progress') continue;

        // Load shift to determine thresholds
        const empRow   = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [d.user_id]);
        const emp      = empRow ? JSON.parse(empRow.data) : {};
        const shiftRow = emp.shift_id
          ? await one("SELECT data FROM entities WHERE type='Shift' AND id=$1", [emp.shift_id])
          : await one("SELECT data FROM entities WHERE type='Shift' AND data::jsonb->>'is_default'='true' LIMIT 1");
        const shift = shiftRow ? JSON.parse(shiftRow.data) : { start_time:'09:00', end_time:'18:00', working_hours:9, grace_period_minutes:15 };
        const shiftHours = shift.working_hours || 9;

        // If raw_punches are stored, rebuild sessions; otherwise use stored session data
        let working_hours = d.working_hours || 0;
        let updatedSessions = d.sessions || [];
        if (d.raw_punches && d.raw_punches.length > 0) {
          const sd = buildSessions(d.raw_punches);
          working_hours = sd.working_hours || 0;
          updatedSessions = sd.sessions || [];
        } else {
          const completeMins = (d.sessions || []).filter(s => s.is_complete)
            .reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
          if (completeMins > 0) working_hours = Math.round(completeMins / 60 * 100) / 100;
        }

        // Determine status from hours worked — never retroactively mark absent if they worked
        let status;
        if (working_hours >= shiftHours * 0.9)   status = 'present';
        else if (working_hours >= shiftHours / 2) status = 'half_day';
        else if (working_hours > 0)               status = 'short_attendance';
        else                                      status = 'absent';

        const updated = {
          ...d,
          status,
          is_in_progress: false,
          working_hours: Math.round(working_hours * 100) / 100,
          auto_closed_at: new Date().toISOString(),
          auto_closed_reason: 'Auto-closed at 5:30 AM — no check-out punch received',
          sessions: updatedSessions.map(s => s.is_complete ? s : { ...s, auto_closed: true }),
        };
        await run("UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3", [status, JSON.stringify(updated), row.id]);
        closed++;
      }

      return res.json({ success: true, closed, date: targetDate });
    }

    case 'markExemptEmployeesPresent': {
      const { date } = p;
      const exempts = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"))
        .filter(e=>e.is_attendance_exempt);
      let marked = 0;
      for (const emp of exempts) {
        const ex = parseEntities(await all("SELECT data FROM entities WHERE type='Attendance' AND user_id=$1", [emp.user_id]))
          .find(a=>a.date===date);
        if (!ex) {
          const id = uuidv4();
          const d  = { id, user_id:emp.user_id, date, status:'present', auto_marked:true, working_hours:9 };
          await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,'present',$3)", [id,emp.user_id,JSON.stringify(d)]);
          marked++;
        }
      }
      return res.json({ success:true, marked });
    }

    case 'processMonthAttendance': {
      // Reprocess attendance from raw_punches for a month range.
      // Supports single month (month/year) or range (month_from/year_from to month_to/year_to).
      const { month, year, month_from, year_from, month_to, year_to, dry_run = false } = p;
      const mFrom = parseInt(month_from || month), yFrom = parseInt(year_from || year);
      const mTo   = parseInt(month_to   || month), yTo   = parseInt(year_to   || year);
      if (!mFrom || !yFrom) return res.json({ success: false, error: 'month and year required' });

      // Build list of months to process
      const monthsToProcess = [];
      let cm = mFrom, cy = yFrom;
      while (cy < yTo || (cy === yTo && cm <= mTo)) {
        monthsToProcess.push({ m: cm, y: cy });
        cm++; if (cm > 12) { cm = 1; cy++; }
        if (monthsToProcess.length > 24) break; // safety cap: max 24 months
      }

      // Use first month's values for compat (full range built above)
      const mp = mFrom, yp = yFrom;
      const monthStart = `${monthsToProcess[0].y}-${String(monthsToProcess[0].m).padStart(2,'0')}-01`;
      const lastM = monthsToProcess[monthsToProcess.length - 1];
      const monthEnd   = new Date(lastM.y, lastM.m, 0).toISOString().slice(0, 10);

      // Pre-load shifts
      const shiftMap = {};
      const shiftRows = await all("SELECT id, data FROM entities WHERE type='Shift'");
      for (const r of shiftRows) { const s = JSON.parse(r.data); shiftMap[s.id] = s; }
      const defaultShift = shiftRows.map(r => JSON.parse(r.data)).find(s => s.is_default)
        || { start_time: '09:00', end_time: '18:00', working_hours: 9, grace_period_minutes: 15 };

      // Pre-load employees for shift lookup
      const empShiftMap = {};
      const empAllRows = await all("SELECT user_id, data FROM entities WHERE type='Employee'");
      for (const r of empAllRows) { const e = JSON.parse(r.data); empShiftMap[e.user_id] = e.shift_id || null; }

      const attRows = await all(
        "SELECT id, data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2",
        [monthStart, monthEnd]
      );

      let processedCount = 0, skippedRegularised = 0, skippedNoPunches = 0;
      const preview = [];
      const updateQueue = [];

      for (const row of attRows) {
        const d = JSON.parse(row.data);
        if (d.status === 'regularised') { skippedRegularised++; continue; }

        // Build raw punches: use stored raw_punches or synthesise from check_in/check_out
        let punches = d.raw_punches && d.raw_punches.length > 0 ? d.raw_punches : null;
        if (!punches && d.check_in_time) {
          punches = [{ time: d.check_in_time, device_direction: 'IN' }];
          if (d.check_out_time) punches.push({ time: d.check_out_time, device_direction: 'OUT' });
        }
        if (!punches) { skippedNoPunches++; continue; }

        const shiftId = empShiftMap[d.user_id];
        const shift = (shiftId && shiftMap[shiftId]) || defaultShift;
        const sd = buildSessions(punches);
        const { status, late_minutes } = computeStatusFromSessions(sd, shift);

        if (dry_run) {
          preview.push({
            date: d.date, employee_code: d.employee_code,
            old_status: d.status, new_status: status,
            old_check_in: d.check_in_time, new_check_in: sd.check_in_time,
            old_check_out: d.check_out_time, new_check_out: sd.check_out_time,
            punch_count: sd.punch_count,
          });
        } else {
          const updated = { ...d, ...sd, raw_punches: punches, status, late_minutes, reprocessed_at: new Date().toISOString() };
          updateQueue.push([status, JSON.stringify(updated), row.id]);
        }
        processedCount++;
      }

      // Parallel batch updates (50 at a time) to avoid sequential per-record round-trips
      for (let i = 0; i < updateQueue.length; i += 50) {
        const batch = updateQueue.slice(i, i + 50);
        await Promise.all(batch.map(([s, dat, id]) =>
          run("UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3", [s, dat, id])
        ));
      }

      const rangeLabel = monthsToProcess.length === 1
        ? new Date(monthsToProcess[0].y, monthsToProcess[0].m-1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })
        : `${new Date(monthsToProcess[0].y, monthsToProcess[0].m-1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' })} – ${new Date(lastM.y, lastM.m-1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' })}`;
      const skipped = skippedRegularised + skippedNoPunches;
      return res.json({
        success: true, dry_run,
        total_records: attRows.length,
        processed: processedCount,
        skipped,
        skipped_regularised: skippedRegularised,
        skipped_no_punch_data: skippedNoPunches,
        months_processed: monthsToProcess.length,
        preview: dry_run ? preview.slice(0, 50) : undefined,
        message: dry_run
          ? `Preview: ${processedCount} of ${attRows.length} records would be reprocessed for ${rangeLabel} (${skippedRegularised} regularised, ${skippedNoPunches} no punch data)`
          : `Reprocessed ${processedCount} of ${attRows.length} attendance records for ${rangeLabel}`,
      });
    }

    case 'importShiftAssignments': {
      // Assign shifts to employees from Excel rows.
      // Each row: { employee_code, shift_name }
      const { rows: shiftRows = [] } = p;

      const empsForShift = parseEntities(await all("SELECT data FROM entities WHERE type='Employee'"));
      const shiftsAll    = parseEntities(await all("SELECT data FROM entities WHERE type='Shift'"));

      const empByCode = {};
      for (const e of empsForShift) {
        const c = String(e.employee_code || '').trim().toUpperCase();
        if (c) empByCode[c] = e;
      }
      const shiftByName = {};
      for (const s of shiftsAll) {
        shiftByName[String(s.name || '').trim().toUpperCase()] = s;
      }

      let assigned = 0, notFoundEmp = [], notFoundShift = [];
      for (const row of shiftRows) {
        const code      = String(row.employee_code || '').trim().toUpperCase();
        const shiftName = String(row.shift_name || '').trim().toUpperCase();
        const emp   = empByCode[code];
        const shift = shiftByName[shiftName];
        if (!emp)   { notFoundEmp.push(code); continue; }
        if (!shift) { notFoundShift.push(row.shift_name); continue; }
        const upd = { ...emp, shift_id: shift.id };
        await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE type='Employee' AND user_id=$2",
          [JSON.stringify(upd), emp.user_id]);
        assigned++;
      }

      return res.json({
        success: true, assigned,
        not_found_employees: [...new Set(notFoundEmp)],
        not_found_shifts:    [...new Set(notFoundShift)],
        message: `Assigned shifts to ${assigned} employees.`,
      });
    }

    case 'importDepartments': {
      // Create departments and/or assign employees.
      // Supports two row formats:
      //   A) { name, code?, description?, employee_code? }  — create dept + optionally assign one employee
      //   B) { department_name, employee_code }              — assign employee to existing/new dept
      const { rows: deptRows = [] } = p;

      // Select id column explicitly so emp._rowId is the DB row id (not just JSON data's id field)
      const empRawRows  = await all("SELECT id, data FROM entities WHERE type='Employee'");
      const empsForDept = empRawRows.map(r => ({ _rowId: r.id, ...JSON.parse(r.data) }));
      const deptsAll    = parseEntities(await all("SELECT data FROM entities WHERE type='Department'"));

      const empByCode2 = {};
      for (const e of empsForDept) {
        const c = String(e.employee_code || '').trim().toUpperCase();
        if (c) empByCode2[c] = e;
      }
      const deptByName2 = {};
      for (const d of deptsAll) deptByName2[String(d.name || '').trim().toUpperCase()] = d;

      let created = 0, assigned = 0, skipped = 0, deptErrors = [];
      for (const row of deptRows) {
        const rawName = String(row.name || row.department_name || '').trim();
        const rawCode = String(row.code || row.department_code || '').trim().toUpperCase();
        const empCode = String(row.employee_code || '').trim().toUpperCase();
        if (!rawName) { skipped++; continue; }

        let dept = deptByName2[rawName.toUpperCase()];
        if (!dept) {
          const deptId = uuidv4();
          dept = {
            id: deptId, name: rawName,
            code: rawCode || rawName.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 10),
            description: row.description || '',
            ot_applicable: false,
            created_at: new Date().toISOString(),
          };
          await run("INSERT INTO entities(id,type,status,data) VALUES($1,'Department','active',$2)",
            [deptId, JSON.stringify(dept)]);
          deptByName2[rawName.toUpperCase()] = dept;
          created++;
        }

        if (empCode) {
          const emp = empByCode2[empCode];
          if (!emp) { deptErrors.push(`Employee ${empCode} not found`); skipped++; continue; }
          // Store dept.name (not raw string) so it exactly matches the Department entity's name field
          const { _rowId, ...empData } = emp;
          const upd = { ...empData, department: dept.name };
          const updResult = await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2",
            [JSON.stringify(upd), _rowId]);
          if (updResult.rowCount > 0) assigned++;
          else deptErrors.push(`Employee ${empCode}: update failed (entity not found)`);
        }
      }

      return res.json({
        success: true, created, assigned, skipped,
        errors: deptErrors.slice(0, 20),
        message: `Created ${created} departments, assigned ${assigned} employees.`,
      });
    }

    case 'receiveMxOneAttendanceSync': case 'fetchBiometricAttendance': case 'ebioWebhook': {
      // Accepts eBio-format records from MxOneSync (PascalCase keys)
      // Each punch arrives as a single JSON object (not a batch) from WebhookClient
      // Also accepts { records: [...] } batch from any caller

      // ── API key check (same key stored in settings) ────────────────────────
      const storedKey = (await one("SELECT value FROM settings WHERE key='attendance_api_key'"))?.value || process.env.ATTENDANCE_API_KEY || null;
      if (storedKey) {
        const authHeader = req.headers['authorization'] || req.headers['x-api-key'] || '';
        const qKey = req.query?.key || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        if (token !== storedKey && qKey !== storedKey) {
          return res.status(401).json({ success: false, error: 'Invalid API key' });
        }
      }

      // Normalise: if body has EmployeeCode it's a single eBio record; if records[] it's a batch
      let rawRecords = [];
      if (Array.isArray(p.records)) {
        rawRecords = p.records;
      } else if (p.EmployeeCode || p.employee_code) {
        rawRecords = [p];
      } else {
        return res.json({ success: true, processed: 0, message: 'No records in payload' });
      }

      // Load employee code → user_id mapping
      const empRows = await all("SELECT data FROM entities WHERE type='Employee'");
      const emps = empRows.map(r => JSON.parse(r.data));
      const mappingRows = await all("SELECT data FROM entities WHERE type='BiometricCodeMapping'");
      const codeMap = {};
      mappingRows.forEach(r => { const m = JSON.parse(r.data); if (m.biometric_code && m.user_id) codeMap[String(m.biometric_code).toLowerCase()] = m.user_id; });
      emps.forEach(e => { if (e.employee_code) codeMap[String(e.employee_code).toLowerCase()] = e.user_id; });

      // Read IST clock digits from stored timestamp — stored values are "IST digits + Z"
      // Do NOT add any IST offset; the digits already represent IST time.
      const readIST = (raw) => {
        if (!raw) return null;
        const s = String(raw).trim().replace(' ', 'T');
        const naive = s.replace(/Z$|[+-]\d{2}:?\d{2}$/, '');
        const d = new Date(naive + 'Z');
        if (isNaN(d.getTime())) return null;
        const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
        const timeStr = `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
        return { dateStr, timeStr, iso: naive + '.000Z' };
      };

      let stored = 0, processed = 0, skipped = 0, unmatched = 0;
      const byDate = {}; // key: userId_date → { userId, date, punches }

      for (const rec of rawRecords) {
        // Support both eBio PascalCase and internal lowercase
        const empCodeRaw = String(rec.EmployeeCode || rec.employee_code || rec.EnrollNo || rec.pin || '').trim();
        const empCode    = empCodeRaw.toLowerCase();
        const logDateRaw = rec.LogDate || rec.log_date || rec.punch_time || rec.datetime || '';
        const direction  = String(rec.Direction || rec.type || 'in').toUpperCase();

        if (!empCodeRaw || !logDateRaw) { skipped++; continue; }

        const ist = readIST(logDateRaw);
        if (!ist) { skipped++; continue; }

        const punchType = (direction === 'IN' || direction === 'in') ? 'in' : 'out';
        const { dateStr, timeStr, iso: punchIso } = ist;
        const userId    = codeMap[empCode] || null;

        // Always store the raw log so it's visible on the Biometric Logs page,
        // even when the employee code isn't mapped yet
        const existingLog = await one("SELECT id FROM entities WHERE type='AttendanceLog' AND data::jsonb->>'EmployeeCode'=$1 AND data::jsonb->>'LogDate'=$2", [empCodeRaw, logDateRaw]);
        if (!existingLog) {
          const logId = uuidv4();
          const logData = { ...rec, id: logId, EmployeeCode: empCodeRaw, LogDate: logDateRaw, Direction: direction, user_id: userId, punch_type: punchType, punch_iso: punchIso, imported_at: new Date().toISOString() };
          try {
            await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AttendanceLog',$2,'active',$3)", [logId, userId, JSON.stringify(logData)]);
            stored++;
          } catch {}
        }

        // Only create Attendance records when employee is matched
        if (!userId) { unmatched++; continue; }

        // Group by employee+date for attendance record creation
        const key = `${userId}_${dateStr}`;
        if (!byDate[key]) byDate[key] = { userId, date: dateStr, punches: [] };
        byDate[key].punches.push({ iso: punchIso, type: punchType });
        processed++;
      }

      // Upsert Attendance records — build sessions for proper status computation
      for (const { userId, date, punches } of Object.values(byDate)) {
        if (punches.length === 0) continue;

        // Load shift for this employee
        const empRowS  = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [userId]);
        const empS     = empRowS ? JSON.parse(empRowS.data) : {};
        const shiftRowS = empS.shift_id
          ? await one("SELECT data FROM entities WHERE type='Shift' AND id=$1", [empS.shift_id])
          : await one("SELECT data FROM entities WHERE type='Shift' AND data::jsonb->>'is_default'='true' LIMIT 1");
        const shiftS = shiftRowS ? JSON.parse(shiftRowS.data) : { start_time:'09:00', end_time:'18:00', working_hours:9, grace_period_minutes:15 };

        // Build sessions from ISO punch list
        const rawPunches = punches.map(p2 => ({ time: p2.iso, device_direction: p2.type === 'in' ? 'IN' : 'OUT' }));
        const sd = buildSessions(rawPunches);
        const { status, late_minutes } = computeStatusFromSessions(sd, shiftS);

        const existing = await one("SELECT id,data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2", [userId, date]);
        if (existing) {
          const d = JSON.parse(existing.data);
          if (d.status === 'regularised') continue;

          // Merge raw_punches: combine existing + new, then rebuild
          const prevPunches = d.raw_punches || [];
          const mergedPunches = [...prevPunches, ...rawPunches]
            .filter((v, i, a) => a.findIndex(x => x.time === v.time) === i);
          mergedPunches.sort((a, b) => a.time.localeCompare(b.time));
          const sdMerged = buildSessions(mergedPunches);
          const { status: mergedStatus, late_minutes: mergedLate } = computeStatusFromSessions(sdMerged, shiftS);

          const updated = {
            ...d,
            check_in_time:  sdMerged.check_in_time,
            check_out_time: sdMerged.check_out_time,
            sessions:       sdMerged.sessions,
            raw_punches:    mergedPunches,
            working_hours:  sdMerged.working_hours,
            is_in_progress: sdMerged.is_in_progress,
            late_minutes:   mergedLate,
            status:         mergedStatus,
            biometric_synced: true,
          };
          await run("UPDATE entities SET status=$1,data=$2,updated_at=NOW()::TEXT WHERE id=$3", [mergedStatus, JSON.stringify(updated), existing.id]);
        } else {
          const attId = uuidv4();
          const attData = {
            id: attId, user_id: userId, date,
            check_in_time:  sd.check_in_time,
            check_out_time: sd.check_out_time,
            sessions:       sd.sessions,
            raw_punches:    rawPunches,
            working_hours:  sd.working_hours,
            is_in_progress: sd.is_in_progress,
            late_minutes,
            status,
            source: 'biometric', biometric_synced: true,
          };
          await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,$3,$4)", [attId, userId, status, JSON.stringify(attData)]);
        }
      }

      return res.json({ success: true, received: rawRecords.length, stored, processed, skipped, unmatched, attendance_records: Object.keys(byDate).length });
    }

    case 'receiveBiometricAttendance':
    case 'processEbioLogs': {
      const { date_from, date_to, raw_records = [], job_id: pollJobId } = p;

      // ── Poll existing background job ──
      if (pollJobId) {
        const job = jobStore.get(pollJobId);
        if (!job) return res.json({ status: 'not_found', success: false, error: 'Job not found or expired' });
        return res.json(job);
      }

      if (raw_records.length === 0 && !date_from) {
        return res.json({ success:false, error:'Provide raw_records or date_from/date_to' });
      }

      // ── Start background job — respond immediately so proxy doesn't time out ──
      const jobId = uuidv4();
      jobStore.set(jobId, { status: 'processing', progress: 'Loading reference data…', startedAt: new Date().toISOString() });
      setTimeout(() => jobStore.delete(jobId), 15 * 60 * 1000); // auto-clean after 15 min

      // Fire-and-forget — must not be awaited
      (async () => {
        try {

          // ── Bulk pre-load all reference data (avoids N+1 per-record queries) ──
          const empRows = await all("SELECT data FROM entities WHERE type='Employee'");
          const employees = empRows.map(r => JSON.parse(r.data));
          const codeMap = {};
          const empByUserId = {};
          employees.forEach(e => {
            if (e.employee_code) codeMap[String(e.employee_code).toLowerCase()] = e.user_id;
            if (e.user_id) empByUserId[e.user_id] = e;
          });
          const mappingRows = await all("SELECT data FROM entities WHERE type='BiometricCodeMapping'");
          mappingRows.forEach(r => {
            const m = JSON.parse(r.data);
            if (m.biometric_code && m.user_id) codeMap[String(m.biometric_code).toLowerCase()] = m.user_id;
          });

          const shiftRows = await all("SELECT data FROM entities WHERE type='Shift'");
          const allShifts = shiftRows.map(r => JSON.parse(r.data));
          const shiftById = Object.fromEntries(allShifts.map(s => [s.id, s]));
          const defaultShift = allShifts.find(s => s.is_default === true || s.is_default === 'true')
            || { start_time:'09:00', end_time:'18:00', working_hours:9, grace_period_minutes:15 };

          jobStore.get(jobId) && jobStore.set(jobId, { ...jobStore.get(jobId), progress: 'Loading punch logs…' });

          const existingLogKeys = new Set(
            (await all("SELECT data::jsonb->>'EmployeeCode' AS code, data::jsonb->>'LogDate' AS logdate FROM entities WHERE type='AttendanceLog'"))
              .map(r => `${r.code}|${r.logdate}`)
          );

          const attQuery = date_from
            ? "SELECT id, data FROM entities WHERE type='Attendance' AND data::jsonb->>'date'>=$1 AND data::jsonb->>'date'<=$2"
            : "SELECT id, data FROM entities WHERE type='Attendance'";
          const attParams = date_from ? [date_from, date_to || '9999-12-31'] : [];
          const existingAttRows = await all(attQuery, attParams);
          const existingAttMap = {};
          existingAttRows.forEach(r => {
            const d = JSON.parse(r.data);
            if (d.user_id && d.date) existingAttMap[`${d.user_id}_${d.date}`] = { id: r.id, data: d };
          });

          // ── Helper ──
          const readIST = (raw) => {
            if (!raw) return null;
            const s = String(raw).trim().replace(' ', 'T');
            const naive = s.replace(/Z$|[+-]\d{2}:?\d{2}$/, '');
            const d = new Date(naive + 'Z');
            if (isNaN(d.getTime())) return null;
            const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
            return { dateStr, iso: naive + '.000Z' };
          };

          const byEmployeeDate = {};
          const addPunch = (userId, logDateRaw, directionRaw) => {
            const ist = readIST(logDateRaw);
            if (!ist) return;
            const dir = (String(directionRaw || 'IN').toUpperCase() === 'OUT' || String(directionRaw || 'IN').toUpperCase() === 'EXIT') ? 'OUT' : 'IN';
            const key = `${userId}_${ist.dateStr}`;
            if (!byEmployeeDate[key]) byEmployeeDate[key] = { userId, date: ist.dateStr, punches: [] };
            byEmployeeDate[key].punches.push({ time: ist.iso, device_direction: dir });
          };

          // ── Process incoming raw_records ──
          const newLogs = [];
          let storedCount = 0;

          for (const record of raw_records) {
            const empCode = String(record.EmployeeCode || record.emp_code || record.employee_code || record.EnrollNo || record.pin || '').toLowerCase();
            const logDateRaw = record.LogDate || record.log_date || record.punch_time || record.datetime || '';
            if (!empCode || !logDateRaw) continue;
            const userId = codeMap[empCode];
            if (!userId) continue;
            const dedupeKey = `${record.EmployeeCode || empCode}|${logDateRaw}`;
            if (!existingLogKeys.has(dedupeKey)) {
              existingLogKeys.add(dedupeKey);
              const logId = uuidv4();
              newLogs.push([logId, userId, JSON.stringify({ ...record, id: logId,
                EmployeeCode: record.EmployeeCode || empCode, LogDate: logDateRaw,
                user_id: userId, imported_at: new Date().toISOString() })]);
              storedCount++;
            }
            addPunch(userId, logDateRaw, record.Direction || record.direction || record.type);
          }

          if (newLogs.length > 0) {
            jobStore.get(jobId) && jobStore.set(jobId, { ...jobStore.get(jobId), progress: `Storing ${newLogs.length} punch log(s)…` });
            const BATCH = 50;
            for (let i = 0; i < newLogs.length; i += BATCH) {
              await Promise.all(
                newLogs.slice(i, i + BATCH).map(([id, uid, data]) =>
                  run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AttendanceLog',$2,'active',$3)", [id, uid, data]).catch(() => {})
                )
              );
            }
          }

          // Reprocess stored logs for date range (no raw upload)
          if (date_from && raw_records.length === 0) {
            jobStore.get(jobId) && jobStore.set(jobId, { ...jobStore.get(jobId), progress: 'Reading stored punch logs for date range…' });
            const logRows = await all("SELECT data FROM entities WHERE type='AttendanceLog'");
            for (const row of logRows) {
              const log = JSON.parse(row.data);
              if (!log.LogDate) continue;
              const userId = log.user_id || codeMap[String(log.EmployeeCode || '').toLowerCase()];
              if (!userId) continue;
              const ist = readIST(log.LogDate);
              if (!ist) continue;
              if (date_from && ist.dateStr < date_from) continue;
              if (date_to   && ist.dateStr > date_to)   continue;
              addPunch(userId, log.LogDate, log.Direction || log.direction || log.type);
            }
          }

          // ── Build / update Attendance records ──
          const totalEntries = Object.keys(byEmployeeDate).length;
          jobStore.get(jobId) && jobStore.set(jobId, { ...jobStore.get(jobId), progress: `Building attendance for ${totalEntries} employee-day(s)…` });
          let records_synced = 0;

          for (const entry of Object.values(byEmployeeDate)) {
            const { userId, date, punches } = entry;
            if (!punches.length) continue;

            const uniquePunches = punches.filter((v, i, a) => a.findIndex(x => x.time === v.time) === i);
            uniquePunches.sort((a, b) => a.time.localeCompare(b.time));

            const emp   = empByUserId[userId] || {};
            const shift = (emp.shift_id && shiftById[emp.shift_id]) || defaultShift;

            const sd = buildSessions(uniquePunches);
            const { status, late_minutes } = computeStatusFromSessions(sd, shift);

            const attData = {
              user_id: userId, date, employee_code: emp.employee_code || '',
              check_in_time: sd.check_in_time, check_out_time: sd.check_out_time,
              sessions: sd.sessions, raw_punches: uniquePunches,
              working_hours: sd.working_hours, is_in_progress: sd.is_in_progress,
              late_minutes, status, punch_count: uniquePunches.length,
              source: 'biometric', updated_at: new Date().toISOString(),
            };

            const attKey   = `${userId}_${date}`;
            const existAtt = existingAttMap[attKey];

            if (existAtt) {
              if (existAtt.data.status === 'regularised') continue;
              const prevPunches = existAtt.data.raw_punches || [];
              const merged = [...prevPunches, ...uniquePunches]
                .filter((v, i, a) => a.findIndex(x => x.time === v.time) === i);
              merged.sort((a, b) => a.time.localeCompare(b.time));
              const sdM = buildSessions(merged);
              const { status: mStatus, late_minutes: mLate } = computeStatusFromSessions(sdM, shift);
              await run("UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3",
                [mStatus, JSON.stringify({ ...existAtt.data, ...attData,
                  raw_punches: merged, sessions: sdM.sessions,
                  check_in_time: sdM.check_in_time, check_out_time: sdM.check_out_time,
                  working_hours: sdM.working_hours, is_in_progress: sdM.is_in_progress,
                  late_minutes: mLate, status: mStatus, id: existAtt.id }), existAtt.id]);
              records_synced++;
            } else {
              const attId = uuidv4();
              await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,$3,$4)",
                [attId, userId, status, JSON.stringify({ ...attData, id: attId, created_at: new Date().toISOString() })]);
              existingAttMap[attKey] = { id: attId, data: { ...attData, id: attId } };
              records_synced++;
            }
          }

          jobStore.set(jobId, {
            status: 'done', success: true,
            records_synced, logs_stored: storedCount,
            employees_processed: totalEntries,
            message: `Processed ${raw_records.length || totalEntries + ' employee-day(s) from stored logs'} → ${records_synced} attendance records updated`,
          });
        } catch (err) {
          console.error('[processEbioLogs background]', err);
          jobStore.set(jobId, { status: 'error', success: false, error: err.message,
            message: `Processing failed: ${err.message}` });
        }
      })();

      return res.json({ status: 'processing', job_id: jobId,
        message: 'Processing started in background. Poll with job_id to check completion.' });
    }

    case 'processRegularisation': {
      const { regularisation_id, action, comment = '', role = 'manager' } = p;
      if (!regularisation_id || !action) return res.status(400).json({ error: 'regularisation_id and action required' });

      const row = await one("SELECT data FROM entities WHERE type='AttendanceRegularisation' AND id=$1", [regularisation_id]);
      if (!row) return res.status(404).json({ error: 'Regularisation request not found' });
      const reg = JSON.parse(row.data);

      let newStatus = reg.status;
      const update  = { updated_at: new Date().toISOString() };

      // admin / hr / management can fully approve (→ completed); manager does step-1 only
      const isFullApprover = ['hr', 'admin', 'management'].includes(role);

      if (!isFullApprover && role === 'manager') {
        if (action === 'approve') {
          newStatus = 'manager_approved';
          update.manager_approved_at = new Date().toISOString();
          update.manager_comment = comment;
        } else if (action === 'reject') {
          newStatus = 'rejected';
          update.manager_comment = comment;
          update.rejected_at = new Date().toISOString();
        } else if (action === 'send_back') {
          newStatus = 'sent_back';
          update.manager_comment = comment;
        }
      } else if (isFullApprover) {
        if (action === 'approve') {
          newStatus = 'completed';
          update.hr_approved_at = new Date().toISOString();
          update.hr_comment = comment;

          // Update the actual Attendance record for that date
          try {
            const attRow = await one(
              "SELECT id, data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2"
            , [reg.user_id, reg.date]);

            if (attRow) {
              const att = JSON.parse(attRow.data);
              const updAtt = {
                ...att,
                status: reg.requested_status || 'present',
                regularised: true,
                regularisation_id,
                check_in_time:  reg.requested_check_in  || att.check_in_time,
                check_out_time: reg.requested_check_out || att.check_out_time,
              };
              await run("UPDATE entities SET status=$1, data=$2 WHERE id=$3", [updAtt.status, JSON.stringify(updAtt), attRow.id]);
            } else {
              // Create attendance record if it doesn't exist
              const newAttId = uuidv4();
              const newAtt = {
                id: newAttId,
                user_id: reg.user_id,
                date: reg.date,
                status: reg.requested_status || 'present',
                regularised: true,
                regularisation_id,
                check_in_time:  reg.requested_check_in  || null,
                check_out_time: reg.requested_check_out || null,
                created_at: new Date().toISOString(),
              };
              await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,'present',$3)", [newAttId, reg.user_id, JSON.stringify(newAtt)]);
            }
          } catch (e) { console.warn('Attendance update on regularisation approval failed:', e.message); }

        } else if (action === 'reject') {
          newStatus = 'rejected';
          update.hr_comment = comment;
          update.rejected_at = new Date().toISOString();
        }
      }

      const updReg = { ...reg, ...update, status: newStatus };
      await run("UPDATE entities SET status=$1, data=$2 WHERE id=$3", [newStatus, JSON.stringify(updReg), regularisation_id]);

      // In-app notification to employee
      try {
        const notifId = uuidv4();
        const notifData = {
          id: notifId, user_id: reg.user_id, type: newStatus === 'completed' ? 'success' : newStatus === 'rejected' ? 'error' : 'info',
          title: `Regularisation ${newStatus === 'completed' ? 'Approved' : newStatus === 'rejected' ? 'Rejected' : 'Updated'}`,
          message: `Your regularisation request for ${reg.date} has been ${newStatus.replace('_', ' ')}.${comment ? ' Comment: ' + comment : ''}`,
          read: false, created_at: new Date().toISOString(),
        };
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Notification',$2,'unread',$3)", [notifId, reg.user_id, JSON.stringify(notifData)]);
      } catch {}

      return res.json({ success: true, status: newStatus });
    }

    case 'calculateLOP': {
      const { employee_id, month, year } = p;
      if (!employee_id) return res.json({ success:true, lop_days:0, lop_amount:0 });

      const startDate = `${year || new Date().getFullYear()}-${String(month || new Date().getMonth()+1).padStart(2,'0')}-01`;
      const endDate   = new Date(year || new Date().getFullYear(), month || new Date().getMonth()+1, 0).toISOString().slice(0,10);

      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND id=$1", [employee_id]);
      const emp    = empRow ? JSON.parse(empRow.data) : {};

      const attRows = await all(
        "SELECT data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date' BETWEEN $2 AND $3"
      , [emp.user_id || employee_id, startDate, endDate]);
      const records = attRows.map(r => JSON.parse(r.data));

      const lop_days = records.filter(r => r.status === 'absent' || r.status === 'lop').length;

      // Basic CTC-based LOP calculation (per-day salary = monthly CTC / 26 working days)
      const ctc = parseFloat(emp.ctc || emp.current_ctc || 0);
      const daily = ctc > 0 ? ctc / 12 / 26 : 0;
      const lop_amount = Math.round(lop_days * daily);

      return res.json({ success:true, lop_days, lop_amount, total_records: records.length });
    }

    case 'computeAttendanceStatus': {
      const { attendance_id, employee_id, date } = p;

      // Get attendance record
      let attData;
      if (attendance_id) {
        const row = await one("SELECT data FROM entities WHERE type='Attendance' AND id=$1", [attendance_id]);
        if (!row) return res.json({ success:false, error:'Attendance record not found' });
        attData = JSON.parse(row.data);
      } else if (employee_id && date) {
        const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND id=$1", [employee_id]);
        const emp    = empRow ? JSON.parse(empRow.data) : {};
        const row    = await one(
          "SELECT data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2"
        , [emp.user_id || employee_id, date]);
        if (!row) return res.json({ success:false, error:'No attendance record for that employee/date' });
        attData = JSON.parse(row.data);
      } else {
        return res.json({ success:false, error:'Provide attendance_id OR (employee_id + date)' });
      }

      // Get shift — fixed: use ='true' (text comparison) not =1 (integer, always false in Postgres)
      const empRow   = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [attData.user_id]);
      const emp      = empRow ? JSON.parse(empRow.data) : {};
      const shiftRow = emp.shift_id
        ? await one("SELECT data FROM entities WHERE type='Shift' AND id=$1", [emp.shift_id])
        : await one("SELECT data FROM entities WHERE type='Shift' AND data::jsonb->>'is_default'='true' LIMIT 1");
      const shift = shiftRow ? JSON.parse(shiftRow.data) : { start_time:'09:00', end_time:'18:00', working_hours:9, grace_period_minutes:15 };

      const grace = shift.grace_period_minutes || 15;

      // toMins handles both HH:MM and ISO strings (IST digits stored as .000Z)
      const isoToMins = (ts) => {
        if (!ts) return null;
        const s = String(ts);
        // ISO format: extract HH:MM from position 11
        const hhmm = s.length > 5 ? s.slice(11, 16) : s;
        const [h, m] = hhmm.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) return null;
        return h * 60 + m;
      };

      let status = 'absent', working_hours = 0, late_minutes = 0, overtime_minutes = 0;

      // Prefer raw_punches path (canonical sessions) when available
      if (attData.raw_punches && attData.raw_punches.length > 0) {
        const sd = buildSessions(attData.raw_punches);
        const result = computeStatusFromSessions(sd, shift);
        status = result.status;
        late_minutes = result.late_minutes || 0;
        working_hours = sd.working_hours || 0;
        // Overtime: minutes worked beyond shift end
        const checkOutMinsR = isoToMins(sd.check_out_time);
        const shiftEndMinsR = isoToMins(shift.end_time);
        if (checkOutMinsR !== null && shiftEndMinsR !== null && checkOutMinsR > shiftEndMinsR + grace) {
          overtime_minutes = checkOutMinsR - shiftEndMinsR - grace;
        }
      } else {
        // Fall back to stored check_in/check_out (manually entered or legacy records)
        const checkInMins    = isoToMins(attData.check_in_time);
        const checkOutMins   = isoToMins(attData.check_out_time);
        const shiftStartMins = isoToMins(shift.start_time);
        const shiftEndMins   = isoToMins(shift.end_time);

        if (checkInMins !== null) {
          if (checkOutMins !== null && checkOutMins > checkInMins) {
            working_hours = (checkOutMins - checkInMins) / 60;
            const halfDay = (shift.working_hours || 9) / 2;
            if      (working_hours >= (shift.working_hours || 9) * 0.9) status = 'present';
            else if (working_hours >= halfDay)                           status = 'half_day';
            else                                                         status = 'short_attendance';
          } else {
            status = 'in_progress';
          }

          if (shiftStartMins !== null && checkInMins > shiftStartMins + grace) {
            late_minutes = checkInMins - shiftStartMins - grace;
            if (status === 'present') status = 'late';
          }

          if (checkOutMins !== null && shiftEndMins !== null && checkOutMins > shiftEndMins + grace) {
            overtime_minutes = checkOutMins - shiftEndMins - grace;
          }
        }
      }

      const updated = {
        ...attData,
        status,
        working_hours: Math.round(working_hours * 100) / 100,
        late_minutes,
        overtime_minutes,
        computed_at: new Date().toISOString(),
      };

      const idToUpdate = attData.id || attendance_id;
      if (idToUpdate) {
        await run("UPDATE entities SET status=$1, data=$2 WHERE type='Attendance' AND id=$3", [status, JSON.stringify(updated), idToUpdate]);
      }

      return res.json({ success:true, status, working_hours: updated.working_hours, late_minutes, overtime_minutes, shift_name: shift.name });
    }

    /* ── Performance ─────────────────────────────────── */
    case 'pmsGetDashboard': {
      const { target_user_id, mode = 'employee' } = p;

      const [goalRows, reviewRows, pipRows, empRows] = await Promise.all([
        all("SELECT data FROM entities WHERE type='Goal'"),
        all("SELECT data FROM entities WHERE type='PerformanceReview'"),
        all("SELECT data FROM entities WHERE type='PIPPlan'"),
        all("SELECT data FROM entities WHERE type='Employee' AND status='active'"),
      ]);

      const allGoals   = parseEntities(goalRows);
      const allReviews = parseEntities(reviewRows);
      const allPIPs    = parseEntities(pipRows);
      const employees  = parseEntities(empRows);

      let goals, reviews, active_pip = null, team_data = null;

      if (mode === 'hr') {
        goals   = allGoals;
        reviews = allReviews;
      } else if (mode === 'manager') {
        const teamUserIds = new Set(
          employees.filter(e => e.reporting_manager_id === target_user_id).map(e => e.user_id)
        );
        goals   = allGoals.filter(g => g.manager_user_id === target_user_id || teamUserIds.has(g.user_id));
        reviews = allReviews.filter(r => r.manager_user_id === target_user_id || teamUserIds.has(r.employee_user_id));
      } else {
        if (!target_user_id) return res.json({ success: false, error: 'target_user_id required' });
        goals   = allGoals.filter(g => g.employee_user_id === target_user_id || g.user_id === target_user_id);
        reviews = allReviews.filter(r => r.employee_user_id === target_user_id);
        const myPIPs = allPIPs.filter(pip => pip.employee_user_id === target_user_id && pip.status === 'active');
        active_pip = myPIPs[0] || null;
      }

      if (mode !== 'employee') {
        const completed = reviews.filter(r => r.status === 'completed');
        const avg_score = completed.length
          ? completed.reduce((s, r) => s + (r.final_score || 0), 0) / completed.length
          : 0;
        const ratingMap = {};
        for (const r of completed) {
          const rating = r.rating || 'Unrated';
          ratingMap[rating] = (ratingMap[rating] || 0) + 1;
        }
        const rating_distribution = Object.entries(ratingMap).map(([rating, count]) => ({ rating, count }));
        const sorted = [...completed].sort((a, b) => (b.final_score || 0) - (a.final_score || 0));
        team_data = {
          total_reviews: reviews.length,
          avg_score,
          rating_distribution,
          top_performers:  sorted.slice(0, 5),
          low_performers:  sorted.slice(-5).filter(r => (r.final_score || 0) < 45).reverse(),
        };
      }

      const now = new Date().toISOString().split('T')[0];
      const stats = {
        total_goals:     goals.length,
        completed_goals: goals.filter(g => g.status === 'completed').length,
        overdue_goals:   goals.filter(g => g.status !== 'completed' && g.target_date && g.target_date < now).length,
        avg_progress:    goals.length
          ? Math.round(goals.reduce((s, g) => s + (g.progress_percentage || g.progress || 0), 0) / goals.length)
          : 0,
      };

      return res.json({ success: true, goals, reviews, active_pip, team_data, stats });
    }

    case 'pmsCalculateScore': {
      const { review_id } = p;
      if (!review_id) return res.json({ score:0, rating:'Pending' });
      const rRow = await one("SELECT data FROM entities WHERE type='PerformanceReview' AND id=$1", [review_id]);
      if (!rRow) return res.json({ score:0, rating:'Not Found' });
      const review = JSON.parse(rRow.data);

      // Calculate weighted score from KPIs/goals if available
      const goals = review.goals || review.kpis || [];
      let score = 0;
      if (goals.length > 0) {
        const total = goals.reduce((sum, g) => {
          const weight  = g.weight || (100 / goals.length);
          const achieved = Math.min(100, g.achieved_percentage || g.score || 0);
          return sum + (achieved * weight / 100);
        }, 0);
        score = Math.round(total);
      } else if (review.self_assessment_score || review.manager_assessment_score) {
        // Ratings are stored on 0-5 scale → convert to 0-100
        const selfScore    = (review.self_assessment_score    || 0) * 20;
        const managerScore = (review.manager_assessment_score || 0) * 20;
        score = selfScore && managerScore ? Math.round((selfScore + managerScore) / 2) : selfScore || managerScore;
      }

      const rating = score >= 90 ? 'Outstanding' : score >= 75 ? 'Exceeds Expectations' : score >= 60 ? 'Meets Expectations' : score >= 45 ? 'Needs Improvement' : 'Below Expectations';

      // Persist the score
      const updated = { ...review, final_score: score, rating, score_computed_at: new Date().toISOString() };
      await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(updated), review_id]);

      return res.json({ score, rating });
    }

    case 'pmsRecommendTraining': {
      const { review_id, employee_id } = p;
      const rRow = review_id ? await one("SELECT data FROM entities WHERE type='PerformanceReview' AND id=$1", [review_id]): null;
      const review = rRow ? JSON.parse(rRow.data) : {};
      const gap = review.rating === 'Below Expectations' || review.rating === 'Needs Improvement';

      // Return appropriate training recommendations based on score gaps
      const recommendations = [];
      if (gap) {
        recommendations.push({ area: 'Core Skills Development', priority: 'high', description: 'Focus on fundamentals for the current role' });
        recommendations.push({ area: 'Communication & Collaboration', priority: 'medium', description: 'Improve team communication effectiveness' });
      }
      const goals = review.goals || [];
      goals.filter(g => (g.achieved_percentage || 0) < 60).forEach(g => {
        recommendations.push({ area: g.name || 'Performance Gap', priority: 'high', description: `Achieve at least 80% on: ${g.name}` });
      });
      return res.json({ success: true, recommendations });
    }

    /* ── Compliance ────────────────────────────────────── */
    case 'computeCompliance': {
      // Auto-generate compliance records based on payroll data (PF, ESI, PT)
      const { month, year } = p;
      const payrolls = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll' AND data::jsonb->>'month'=$1 AND data::jsonb->>'year'=$2", [month, year]));
      const pfTotal  = payrolls.reduce((s,r)=>s+(r.pf_employee||0)+(r.pf_employer||0),0);
      const esiTotal = payrolls.reduce((s,r)=>s+(r.esi_employee||0)+(r.esi_employer||0),0);
      const ptTotal  = payrolls.reduce((s,r)=>s+(r.professional_tax||0),0);

      const dueDate = `${year}-${String(parseInt(month)+1).padStart(2,'0')}-15`;
      for (const { name, amount, type } of [
        { name:`PF – ${month}/${year}`, amount:pfTotal, type:'pf' },
        { name:`ESI – ${month}/${year}`, amount:esiTotal, type:'esi' },
        { name:`Professional Tax – ${month}/${year}`, amount:ptTotal, type:'pt' },
      ]) {
        const existing = await one("SELECT id FROM entities WHERE type='ComplianceRecord' AND data::jsonb->>'compliance_type'=$1 AND data::jsonb->>'month'=$2 AND data::jsonb->>'year'=$3", [type, month, year]);
        if (!existing) {
          const id = uuidv4();
          await run("INSERT INTO entities(id,type,status,data) VALUES($1,'ComplianceRecord','pending',$2)", [id, JSON.stringify({ id, compliance_type:type, name, amount, month, year, due_date:dueDate, status:'pending' })]);
        }
      }
      return res.json({ success:true });
    }

    case 'updateComplianceStatus': {
      const { record_id, status, paid_date, reference } = p;
      const row = await one("SELECT id,data FROM entities WHERE id=$1", [record_id]);
      if (!row) return res.json({ success:false, error:'Record not found' });
      const updated = { ...JSON.parse(row.data), status, paid_date, reference };
      await run("UPDATE entities SET data=$1,status=$2 WHERE id=$3", [JSON.stringify(updated), status, record_id]);
      return res.json({ success:true });
    }

    case 'getComplianceSummary': {
      const { month, year } = p;
      const allRecs = parseEntities(await all("SELECT data FROM entities WHERE type='ComplianceRecord'"));
      const recs = month && year ? allRecs.filter(r => String(r.month)===String(month) && String(r.year)===String(year)) : allRecs;

      const today = new Date().toISOString().slice(0,10);
      const deadlines = recs.map(r => ({
        ...r, daysLeft: r.due_date ? Math.ceil((new Date(r.due_date) - new Date(today)) / 86400000) : 999,
      }));

      const summary = {
        total:       recs.length,
        compliant:   recs.filter(r=>r.status==='compliant'||r.status==='paid').length,
        non_compliant: recs.filter(r=>r.status==='non_compliant'||r.status==='overdue').length,
        pending:     recs.filter(r=>r.status==='pending').length,
        total_pf:    recs.filter(r=>r.compliance_type==='pf').reduce((s,r)=>s+(r.amount||0),0),
        total_esi:   recs.filter(r=>r.compliance_type==='esi').reduce((s,r)=>s+(r.amount||0),0),
        total_pt:    recs.filter(r=>r.compliance_type==='pt').reduce((s,r)=>s+(r.amount||0),0),
      };

      return res.json({ summary, deadlines, records: recs });
    }

    case 'getComplianceInsights': {
      const today = new Date();
      const compRows = await all("SELECT data FROM entities WHERE type='Compliance'");
      const records = compRows.map(r => JSON.parse(r.data));
      const empRows2 = await all("SELECT data FROM entities WHERE type='Employee'");
      const activeEmps = empRows2.map(r => JSON.parse(r.data)).filter(e => e.employee_status === 'active' || !e.employee_status);

      const insights = [], recommendations = [];

      const overdue = records.filter(r => r.status !== 'paid' && r.due_date && new Date(r.due_date) < today);
      if (overdue.length) {
        insights.push({ type: 'error', title: `${overdue.length} overdue compliance payment(s)`, detail: overdue.map(r => `${r.compliance_type} – ₹${(r.amount||0).toLocaleString('en-IN')} (due ${r.due_date})`).join('; ') });
        recommendations.push({ priority: 'high', action: `Process ${overdue.length} overdue payment(s) immediately to avoid statutory penalties`, types: overdue.map(r => r.compliance_type) });
      }

      const sevenDays = new Date(today.getTime() + 7*24*60*60*1000);
      const upcoming7 = records.filter(r => r.status !== 'paid' && r.due_date && new Date(r.due_date) >= today && new Date(r.due_date) <= sevenDays);
      if (upcoming7.length) {
        insights.push({ type: 'warning', title: `${upcoming7.length} payment(s) due in next 7 days`, detail: upcoming7.map(r => `${r.compliance_type} – ₹${(r.amount||0).toLocaleString('en-IN')} (due ${r.due_date})`).join('; ') });
        recommendations.push({ priority: 'high', action: `Schedule payment for ${upcoming7.map(r=>r.compliance_type).join(', ')}`, types: upcoming7.map(r => r.compliance_type) });
      }

      const noPF = activeEmps.filter(e => !e.uan_number && !e.pf_account_number);
      if (noPF.length) {
        insights.push({ type: 'info', title: `${noPF.length} active employee(s) missing UAN/PF account number`, detail: `Employees: ${noPF.slice(0,5).map(e=>e.display_name||e.email||e.user_id).join(', ')}${noPF.length>5?' and more':''}` });
        recommendations.push({ priority: 'medium', action: `Register ${noPF.length} employee(s) with EPFO and update UAN numbers` });
      }

      const esiEligible = activeEmps.filter(e => Number(e.ctc||0)/12 <= 21000 && Number(e.ctc||0) > 0);
      if (esiEligible.length) insights.push({ type: 'info', title: `${esiEligible.length} employee(s) may be ESI eligible (gross ≤ ₹21,000/month)`, detail: 'Verify ESI coverage for these employees' });

      const totalLiability = records.filter(r => r.status !== 'paid').reduce((s,r) => s + Number(r.amount||0), 0);
      if (totalLiability > 0) insights.push({ type: 'info', title: `Total pending compliance liability: ₹${totalLiability.toLocaleString('en-IN')}`, detail: `${records.filter(r=>r.status!=='paid').length} unpaid records across PF, ESI, PT` });

      return res.json({ success: true, insights, recommendations, generated_at: new Date().toISOString() });
    }

    /* ── AI: Recruitment ─────────────────────────────── */
    case 'parseResume': {
      const { candidate_id, resume_url } = p;
      const cRow = await one("SELECT data FROM entities WHERE type='Candidate' AND id=$1", [candidate_id]);
      const cand = cRow ? JSON.parse(cRow.data) : {};

      const prompt = `You are an expert resume parser. Based on the following candidate profile information, generate a detailed parsed resume JSON. Be realistic and infer reasonable details.

Candidate Profile:
Name: ${cand.full_name || cand.name || 'Not provided'}
Position Applied: ${cand.position_applied || 'Not specified'}
Department: ${cand.department || 'Not specified'}
Experience Years: ${cand.experience_years || 'Not specified'}
Current Company: ${cand.current_company || 'Not specified'}
Current CTC: ${cand.current_ctc ? '₹' + cand.current_ctc : 'Not specified'}
Expected CTC: ${cand.expected_ctc ? '₹' + cand.expected_ctc : 'Not specified'}
Notice Period: ${cand.notice_period || 'Not specified'}
Source: ${cand.source || 'Not specified'}
Email: ${cand.email || 'Not specified'}
Phone: ${cand.phone || 'Not specified'}

Return ONLY a valid JSON object (no markdown, no explanation) with these exact fields:
{
  "resume_headline": "one-line professional headline",
  "professional_summary": "2-3 sentence professional summary",
  "current_location": "city",
  "preferred_location": "city or 'Open to relocation'",
  "total_experience_years": number,
  "relevant_experience_years": number,
  "notice_period_days": number (0 for immediate, 30/60/90 for others),
  "current_designation": "job title",
  "current_company": "company name",
  "previous_companies": ["company1", "company2"],
  "previous_designations": ["title1", "title2"],
  "primary_skills": ["skill1", "skill2", "skill3"],
  "secondary_skills": ["skill1", "skill2"],
  "tools_and_platforms": ["tool1", "tool2"],
  "certifications": ["cert1"],
  "degree": "degree name",
  "university": "university name",
  "specialization": "field",
  "passing_year": 2018,
  "gpa_percentage": "75%",
  "projects": [{"name": "project", "description": "desc", "technologies": "tech stack"}],
  "achievements": ["achievement1", "achievement2"],
  "linkedin_url": null,
  "github_url": null,
  "portfolio_url": null,
  "ats_score": number (0-100),
  "profile_completeness_score": number (0-100),
  "ats_issues": ["issue1"],
  "keyword_density_flag": false
}`;

      let parsed;
      try {
        parsed = await callAI(prompt, { json: true });
      } catch(e) {
        return res.json({ success:false, error:`AI parsing failed: ${e.message}` });
      }

      if (!parsed) return res.json({ success:false, error:'AI returned invalid JSON' });

      const parsedId = uuidv4();
      const parsedData = {
        id: parsedId,
        candidate_id,
        resume_url,
        parse_status: 'completed',
        parsed_at: new Date().toISOString(),
        ...parsed,
      };
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ParsedResume',$2,'completed',$3)", [parsedId, candidate_id, JSON.stringify(parsedData)]);

      // Link parsed resume to candidate
      if (cRow) {
        const updCand = { ...cand, parsed_resume_id: parsedId };
        await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(updCand), candidate_id]);
      }

      const skills_extracted = (parsed.primary_skills?.length||0) + (parsed.secondary_skills?.length||0) + (parsed.tools_and_platforms?.length||0);
      return res.json({ success:true, parsed_resume_id:parsedId, skills_extracted });
    }

    case 'scoreAndSummariseCv': {
      const { candidate_id, position_applied, department, experience_years, current_company, current_ctc, expected_ctc, notice_period } = p;

      const prompt = `You are an expert HR recruiter. Analyse this candidate profile and provide a comprehensive CV score and summary.

Position Applied: ${position_applied || 'General'}
Department: ${department || 'Not specified'}
Experience: ${experience_years || 0} years
Current Company: ${current_company || 'Not specified'}
Current CTC: ${current_ctc ? '₹' + current_ctc : 'Not specified'}
Expected CTC: ${expected_ctc ? '₹' + expected_ctc : 'Not specified'}
Notice Period: ${notice_period || 'Not specified'}

Return ONLY a valid JSON object (no markdown) with:
{
  "score": number (0-100, overall profile quality),
  "recommendation": "Strongly Recommend" | "Recommend" | "Maybe" | "Not Recommend",
  "summary": "2-3 sentence professional assessment",
  "key_strengths": ["strength1", "strength2", "strength3"],
  "areas_for_improvement": ["area1", "area2"],
  "experience_assessment": "brief assessment of experience",
  "compensation_analysis": "brief analysis of CTC expectations"
}`;

      let result;
      try { result = await callAI(prompt, { json: true }); }
      catch(e) { return res.json({ success:false, error:`AI failed: ${e.message}` }); }

      if (!result) return res.json({ success:false, error:'AI returned invalid response' });
      return res.json({ success:true, result });
    }

    case 'scoreCandidate': {
      if (!(await hasRole(cu, MGR_ROLES))) return res.status(403).json({ error: 'Recruiter/HR access required' });
      const { candidate_id, job_requisition_id } = p;
      const cRow  = await one("SELECT data FROM entities WHERE type='Candidate' AND id=$1", [candidate_id]);
      const jdRow = await one("SELECT data FROM entities WHERE type='JobRequisition' AND id=$1", [job_requisition_id]);
      const cand  = cRow  ? JSON.parse(cRow.data)  : {};
      const jd    = jdRow ? JSON.parse(jdRow.data) : {};

      const prompt = `You are an expert technical recruiter. Score this candidate against the job requisition using weighted criteria.

JOB REQUISITION:
Title: ${jd.position_title || 'Not specified'}
Department: ${jd.department || 'Not specified'}
Required Skills: ${Array.isArray(jd.required_skills) ? jd.required_skills.join(', ') : jd.required_skills || 'Not specified'}
Experience Required: ${jd.experience_required || 'Not specified'}
Salary Range: ₹${jd.salary_range_min||0} – ₹${jd.salary_range_max||0} per annum
Employment Type: ${jd.employment_type || 'Not specified'}
Location: ${jd.location || 'Not specified'}

CANDIDATE:
Name: ${cand.full_name || cand.name || 'Not specified'}
Experience: ${cand.experience_years || 0} years
Current Company: ${cand.current_company || 'Not specified'}
Skills: ${Array.isArray(cand.skills) ? cand.skills.join(', ') : cand.skills || 'Not specified'}
Expected CTC: ${cand.expected_ctc ? '₹' + cand.expected_ctc : 'Not specified'}
Notice Period: ${cand.notice_period || 'Not specified'}
Education: ${cand.education || 'Not specified'}

Score using these weights: Skills Match (35%), Experience (25%), Salary Fit (15%), Notice Period (10%), Education (15%).

Return ONLY a valid JSON object (no markdown):
{
  "overall_score": number (0-100),
  "recommendation": "Strongly Recommend" | "Recommend" | "Maybe" | "Not Recommend",
  "summary": "2-3 sentence assessment",
  "skills_score": number (0-100),
  "experience_score": number (0-100),
  "salary_score": number (0-100),
  "notice_score": number (0-100),
  "education_score": number (0-100),
  "matched_skills": ["skill1", "skill2"],
  "missing_skills": ["skill1", "skill2"],
  "bonus_skills": ["skill1"],
  "strengths": ["strength1", "strength2"],
  "gaps": ["gap1", "gap2"]
}`;

      let result;
      try { result = await callAI(prompt, { json: true }); }
      catch(e) { return res.json({ success:false, error:`AI scoring failed: ${e.message}` }); }

      if (!result) return res.json({ success:false, error:'AI returned invalid response' });

      // Persist the score as a CandidateScore entity (upsert by candidate + requisition)
      // so rankings survive page reload and power the leaderboard.
      try {
        const scoredAt = new Date().toISOString();
        const existingScore = await one(
          "SELECT id FROM entities WHERE type='CandidateScore' AND data::jsonb->>'candidate_id'=$1 AND data::jsonb->>'job_requisition_id'=$2 LIMIT 1",
          [candidate_id, job_requisition_id]
        );
        const scoreData = { ...result, candidate_id, job_requisition_id, scored_at: scoredAt };
        if (existingScore) {
          scoreData.id = existingScore.id;
          await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(scoreData), existingScore.id]);
        } else {
          const scoreId = uuidv4();
          scoreData.id = scoreId;
          await run("INSERT INTO entities(id,type,status,data) VALUES($1,'CandidateScore','active',$2)", [scoreId, JSON.stringify(scoreData)]);
        }
        // Mirror a quick summary onto the candidate record for at-a-glance display
        if (cRow) {
          const updCand = { ...cand, ai_score: result.overall_score, ai_recommendation: result.recommendation, ai_scored_at: scoredAt };
          await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE type='Candidate' AND id=$2", [JSON.stringify(updCand), candidate_id]);
        }
      } catch (persistErr) {
        console.warn('[scoreCandidate] persist failed:', persistErr.message);
      }

      return res.json({ success:true, data: result });
    }

    /* ── Offer Letter ────────────────────────────────── */
    case 'generateOfferLetter': {
      const { candidate_id, joining_date, designation, department, ctc, probation_months = 6, reporting_to, location, salary_overrides } = p;
      if (!candidate_id) return res.json({ success:false, error:'candidate_id required' });

      const cRow = await one("SELECT data FROM entities WHERE type='Candidate' AND id=$1", [candidate_id]);
      if (!cRow) return res.json({ success:false, error:'Candidate not found' });
      const cand = JSON.parse(cRow.data);

      const name          = cand.full_name || cand.name || 'Candidate';
      const position      = designation   || cand.position_applied || 'Position';
      const dept          = department    || cand.department        || 'Department';
      const jDate         = joining_date  || '';
      const annualCTC     = ctc           || cand.expected_ctc || 0;
      const monthlyCTC    = annualCTC > 0 ? Math.round(annualCTC / 12) : 0;
      const probation     = probation_months;
      const reportingTo   = reporting_to || 'Reporting Manager';
      const workLocation  = location     || 'Ghaziabad, Uttar Pradesh';
      const todayDate     = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' });
      const offerRef      = `MEIL/HR/OL/${new Date().getFullYear()}/${String(Math.floor(Math.random()*9000)+1000)}`;

      const letterHtml = `
<div style="font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;line-height:1.6;">
  <div style="text-align:right;margin-bottom:14px;">
    <strong>Ref:</strong> ${offerRef}<br/>
    <strong>Date:</strong> ${todayDate}
  </div>

  <p style="margin-bottom:10px;">To,<br/>
  <strong>${name}</strong><br/>
  ${cand.address || cand.email || ''}</p>

  <p style="font-weight:bold;text-align:center;font-size:13px;text-decoration:underline;margin:14px 0;">
    APPOINTMENT LETTER / OFFER OF EMPLOYMENT
  </p>

  <p>Dear <strong>${name}</strong>,</p>

  <p>We are pleased to offer you the position of <strong>${position}</strong> in the <strong>${dept}</strong> department at <strong>Maxvolt Energy Industries Limited</strong>, subject to the terms and conditions stated herein.</p>

  <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:10.5px;">
    <tr style="background:#f9f9f9;">
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;width:40%;">Designation</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${position}</td>
    </tr>
    <tr>
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Department</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${dept}</td>
    </tr>
    <tr style="background:#f9f9f9;">
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Date of Joining</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${jDate ? new Date(jDate).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' }) : 'As mutually agreed'}</td>
    </tr>
    <tr>
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Reporting To</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${reportingTo}</td>
    </tr>
    <tr style="background:#f9f9f9;">
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Work Location</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${workLocation}</td>
    </tr>
    <tr>
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Annual CTC</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">₹${annualCTC.toLocaleString('en-IN')} per annum</td>
    </tr>
    <tr style="background:#f9f9f9;">
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Monthly Gross</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">₹${monthlyCTC.toLocaleString('en-IN')} per month</td>
    </tr>
    <tr>
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Probation Period</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${probation} months</td>
    </tr>
  </table>

  <p><strong>Terms and Conditions:</strong></p>
  <ol style="padding-left:18px;margin:8px 0;">
    <li>Your employment will be subject to the rules and regulations of the company, as may be amended from time to time.</li>
    <li>During the probation period, either party may terminate the contract by giving 7 days' written notice. After confirmation, 1 month's notice is required from both parties.</li>
    <li>You will not engage in any business activity that is in conflict with the interests of the company.</li>
    <li>You are required to maintain the confidentiality of company information during and after employment.</li>
    <li>This offer is conditional upon successful verification of your educational qualifications, previous employment records, and medical fitness.</li>
    <li>Please confirm your acceptance of this offer by signing and returning a copy of this letter within <strong>7 days</strong> of receipt.</li>
  </ol>

  <p style="margin-top:14px;">We look forward to welcoming you to the Maxvolt Energy family and are confident that your skills and experience will be a valuable addition to our team.</p>

  <div style="margin-top:40px;display:flex;justify-content:space-between;">
    <div>
      <p style="border-top:1px solid #333;padding-top:5px;min-width:180px;">Authorised Signatory<br/><strong>For Maxvolt Energy Industries Limited</strong></p>
    </div>
    <div>
      <p style="border-top:1px solid #333;padding-top:5px;min-width:180px;">Candidate Acceptance<br/><strong>${name}</strong><br/>Date: _______________</p>
    </div>
  </div>
</div>`;

      // Update candidate status to 'offered'
      try {
        const updated = { ...cand, status: 'offered', offer_letter_date: new Date().toISOString(), offer_ctc: annualCTC, joining_date };
        await run("UPDATE entities SET status='offered', data=$1 WHERE id=$2", [JSON.stringify(updated), candidate_id]);
      } catch {}

      return res.json({ success:true, html: letterHtml, ref: offerRef });
    }

    /* ── Send Offer Letter (email to candidate) ─────── */
    case 'sendOfferLetter': {
      const { candidate_id, joining_date, designation, department, location, reporting_to, annual_ctc, probation_months = 6, offer_valid_days = 7, notes, medical_contribution = 0, salary_overrides } = p;
      if (!candidate_id) return res.json({ success: false, error: 'candidate_id required' });

      const cRow = await one("SELECT data FROM entities WHERE type='Candidate' AND id=$1", [candidate_id]);
      if (!cRow) return res.json({ success: false, error: 'Candidate not found' });
      const cand = JSON.parse(cRow.data);

      if (!cand.email) return res.json({ success: false, error: 'Candidate has no email address' });

      const name       = cand.full_name || cand.name || 'Candidate';
      const pos        = designation || cand.position_applied || 'Position';
      const dept       = department || cand.department || 'Department';
      const loc        = location || 'Ghaziabad, Uttar Pradesh';
      const ctc        = annual_ctc || cand.expected_ctc || 0;
      const monthlyCTC = ctc / 12; // keep float for accuracy
      const jDate      = joining_date || '';
      const probation  = probation_months;
      const validTill  = new Date(Date.now() + (offer_valid_days || 7) * 24 * 60 * 60 * 1000);

      // Salary breakdown — PF for ALL employees; ESI when basic ≤ ₹21,000 on basic salary
      const PF_CEIL = 15000, ESI_CEIL = 21000;
      const autoBasicM = Math.round(monthlyCTC * 0.5);
      const basicM  = salary_overrides?.basic      ? Number(salary_overrides.basic)      : autoBasicM;
      const autoHraM  = Math.round(autoBasicM * 0.4);
      const hraM    = salary_overrides?.hra        ? Number(salary_overrides.hra)        : autoHraM;
      const pfBase       = Math.min(basicM, PF_CEIL);
      const pfEmpM       = Math.round(pfBase * 0.12);
      const pfEmployerM  = Math.round(pfBase * 0.13);
      const isESI        = basicM <= ESI_CEIL;
      const esiEmpM      = isESI ? Math.round(basicM * 0.0075) : 0;
      const esiEmployerM = isESI ? Math.round(basicM * 0.0325) : 0;
      const medicalM     = Number(medical_contribution) || 0;
      let bonusM, bonusType;
      if (ctc <= 1000000) { bonusM = Math.round(basicM * 0.0833); bonusType = 'Bonus (8.33% of Basic)'; }
      else { const vp = ctc <= 1500000 ? 0.05 : ctc <= 2000000 ? 0.08 : ctc <= 2500000 ? 0.12 : 0.15; bonusM = Math.round(ctc * vp / 12); bonusType = `VPP (${Math.round(vp*100)}% of CTC)`; }
      const contribM     = pfEmployerM + esiEmployerM + bonusM + medicalM;
      const autoGrossM   = Math.round(monthlyCTC - contribM);
      const autoConvM    = Math.max(autoGrossM - autoBasicM - autoHraM, 0);
      const convM        = salary_overrides?.conveyance ? Number(salary_overrides.conveyance) : autoConvM;
      const grossM       = salary_overrides ? (basicM + hraM + convM) : autoGrossM;
      const totalDedM    = pfEmpM + esiEmpM;
      const netM         = grossM - totalDedM;

      const sal = {
        monthly_ctc: Math.round(monthlyCTC), annual_ctc: ctc,
        basic_monthly: basicM,        basic_annual: basicM * 12,
        hra_monthly: hraM,            hra_annual: hraM * 12,
        conveyance_monthly: convM,    conveyance_annual: convM * 12,
        gross_monthly: grossM,        gross_annual: grossM * 12,
        pf_emp_monthly: pfEmpM,       pf_emp_annual: pfEmpM * 12,
        esi_emp_monthly: esiEmpM,     esi_emp_annual: esiEmpM * 12,
        pf_employer_monthly: pfEmployerM,   pf_employer_annual: pfEmployerM * 12,
        esi_employer_monthly: esiEmployerM, esi_employer_annual: esiEmployerM * 12,
        medical_monthly: medicalM,    medical_annual: medicalM * 12,
        bonus_monthly: bonusM,        bonus_annual: bonusM * 12, bonusType,
        contribution_monthly: contribM, contribution_annual: contribM * 12,
        net_monthly: netM,            net_annual: netM * 12,
        isESI,
      };

      const offerRef    = `MEIL/HR/OL/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 9000) + 1000)}`;
      const acceptToken = uuidv4();
      const todayStr    = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
      const jDateStr    = jDate ? new Date(jDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : 'As mutually agreed';
      const validTillStr = validTill.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
      const fmtIN       = n => Number(n || 0).toLocaleString('en-IN');

      const appBase = process.env.APP_URL || 'https://hr.maxvolt-one.co.in';
      const acceptLink = `${appBase}/offer-accept/${acceptToken}`;

      // PF deduction row always shown (all employees); ESI shown when applicable
      const td   = (v) => `<td style="padding:6px 8px;border:1px solid #ddd;">${v}</td>`;
      const tdr  = (v) => `<td style="padding:6px 8px;border:1px solid #ddd;text-align:right;">${v}</td>`;
      const trow = (cells) => `<tr>${cells.join('')}</tr>`;
      const totalDedAnnual  = sal.pf_emp_annual  + sal.esi_emp_annual;
      const totalDedMonthly = sal.pf_emp_monthly + sal.esi_emp_monthly;
      const dedRows = [
        trow([td('PF Employee Contribution (12% on Basic, max ₹15,000)'), tdr(fmtIN(sal.pf_emp_annual)), tdr(fmtIN(sal.pf_emp_monthly))]),
        isESI ? trow([td('ESI Employee Contribution (0.75% on Basic)'), tdr(fmtIN(sal.esi_emp_annual)), tdr(fmtIN(sal.esi_emp_monthly))]) : '',
      ].join('');
      const empRows = [
        trow([td('PF Employer Contribution'), tdr(fmtIN(sal.pf_employer_annual)), tdr(fmtIN(sal.pf_employer_monthly))]),
        isESI ? trow([td('ESI Employer Contribution (3.25% on Basic)'), tdr(fmtIN(sal.esi_employer_annual)), tdr(fmtIN(sal.esi_employer_monthly))]) : '',
        medicalM > 0 ? trow([td('Medical Contribution'), tdr(fmtIN(sal.medical_annual)), tdr(fmtIN(sal.medical_monthly))]) : '',
        trow([td(bonusType), tdr(fmtIN(sal.bonus_annual)), tdr(fmtIN(sal.bonus_monthly))]),
      ].join('');

      const th  = (t, right) => `<th style="padding:8px;border:1px solid #ccc;${right?'text-align:right;':''}">${t}</th>`;
      const sub = (label, annual, monthly) => `<tr style="background:#d9d9d9;font-weight:700;"><td style="padding:6px 10px;border:1px solid #ccc;">${label}</td><td style="padding:6px 10px;border:1px solid #ccc;text-align:right;">${fmtIN(annual)}</td><td style="padding:6px 10px;border:1px solid #ccc;text-align:right;">${fmtIN(monthly)}</td></tr>`;
      const sec = (label) => `<tr><td colspan="3" style="padding:5px 10px;border:1px solid #ccc;font-weight:bold;text-decoration:underline;font-size:11px;">${label}</td></tr>`;
      const salaryTableHtml = `
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:11px;border:1px solid #ccc;">
  <thead>
    <tr style="background:#d9d9d9;">${th('Salary Head')}${th('Annually (₹)',true)}${th('Monthly (₹)',true)}</tr>
  </thead>
  <tbody>
    ${sec('Earnings')}
    ${[[salary_overrides?.basic?'Basic Salary':'Basic (50% of CTC)',sal.basic_annual,sal.basic_monthly],[salary_overrides?.hra?'House Rent Allowance':'HRA (40% of Basic)',sal.hra_annual,sal.hra_monthly],[salary_overrides?.conveyance?'Conveyance Allowance':'Conveyance Allowance (Balance)',sal.conveyance_annual,sal.conveyance_monthly]].map(([l,a,m])=>trow([td(l),tdr(fmtIN(a)),tdr(fmtIN(m))])).join('')}
    ${sub('Total Gross Salary (A)', sal.gross_annual, sal.gross_monthly)}
    ${sec('Deduction')}
    ${dedRows}
    ${sub('Total Deduction (B)', totalDedAnnual, totalDedMonthly)}
    ${sub('Total Net Salary (A-B)', sal.net_annual, sal.net_monthly)}
    ${sec('Contribution')}
    ${empRows}
    ${sub('Total Contribution (C)', sal.contribution_annual, sal.contribution_monthly)}
    <tr style="background:#d9d9d9;font-weight:700;font-size:12px;"><td style="padding:8px 10px;border:1px solid #ccc;">Annually CTC (A+C)</td><td style="padding:8px 10px;border:1px solid #ccc;text-align:right;color:#1d4ed8;">${fmtIN(ctc)}</td><td style="padding:8px 10px;border:1px solid #ccc;text-align:right;color:#1d4ed8;">${fmtIN(sal.monthly_ctc)}</td></tr>
  </tbody>
</table>`;

      const emailHtml = `
<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#ea580c;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">Offer Letter</h1>
    <p style="margin:4px 0 0;opacity:.9;font-size:13px;">Maxvolt Energy Industries Limited</p>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;">
    <p style="margin:0 0 8px;"><strong>Ref:</strong> ${offerRef}</p>
    <p style="margin:0 0 20px;"><strong>Date:</strong> ${todayStr}</p>
    <p style="margin:0 0 6px;">Dear <strong>${name}</strong>,</p>
    <p style="margin:0 0 16px;"><strong>Congratulations!</strong></p>
    <p style="margin:0 0 16px;">We are pleased to offer you the position of <strong>${pos}</strong> in the <strong>${dept}</strong> department at <strong>Maxvolt Energy Industries Limited</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
      <tr style="background:#f9fafb;"><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;width:40%;">Designation</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${pos}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Department</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${dept}</td></tr>
      <tr style="background:#f9fafb;"><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Date of Joining</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${jDateStr}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Work Location</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${loc}</td></tr>
      ${reporting_to ? `<tr style="background:#f9fafb;"><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Reporting To</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${reporting_to}</td></tr>` : ''}
      <tr style="background:#f9fafb;"><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Probation Period</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${probation} months</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Annual CTC</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;color:#ea580c;">₹${fmtIN(ctc)} per annum</td></tr>
    </table>
    <h3 style="margin:20px 0 8px;font-size:14px;">Salary Structure</h3>
    ${salaryTableHtml}
    ${notes ? `<div style="background:#f9fafb;border-left:4px solid #ea580c;padding:12px;margin:16px 0;font-size:13px;"><strong>Additional Note:</strong> ${notes}</div>` : ''}
    <p style="margin:16px 0;font-size:13px;">This offer is valid until <strong>${validTillStr}</strong>.</p>
    <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="margin:0 0 8px;font-weight:600;font-size:14px;">Action Required: Accept Your Offer</p>
      <p style="margin:0 0 12px;font-size:13px;">Please click the button below to review the complete offer, sign the background verification consent form, and formally accept this offer digitally.</p>
      <a href="${acceptLink}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Accept Offer Letter</a>
    </div>
    <p style="font-size:13px;">Documents required at joining:</p>
    <ul style="font-size:12px;color:#555;padding-left:16px;">
      <li>Proof of address &amp; ID (Local &amp; Permanent)</li>
      <li>Five color recent passport-size photos</li>
      <li>10th, 12th &amp; highest degree certificates</li>
      <li>Offer, Appointment &amp; Increment Letters (last 3)</li>
      <li>Experience/Relieving letters (last 3)</li>
      <li>Last 3 months salary slips &amp; 6 months bank statement</li>
    </ul>
    <p style="margin-top:20px;font-size:13px;">We look forward to welcoming you to the Maxvolt Energy family!</p>
    <p style="font-size:13px;">Warm regards,<br/><strong>Human Resources</strong><br/>Maxvolt Energy Industries Limited</p>
    <div style="margin-top:20px;padding:10px 14px;background:#fef9f0;border:1px solid #fcd34d;border-radius:6px;font-size:11px;color:#92400e;">
      <strong>Important:</strong> Please do not reply to this email. This is an automated notification. To accept your offer, use the button above. For any queries, contact us at <a href="mailto:hr@maxvoltenergy.com" style="color:#ea580c;">hr@maxvoltenergy.com</a>
    </div>
  </div>
  <div style="background:#f9fafb;padding:12px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;text-align:center;font-size:11px;color:#999;">
    E-82 Bulandshahr Road Industrial Area, Ghaziabad, UP – 201009 &nbsp;|&nbsp; CIN: U40106DL2019PLC349854
  </div>
</div>`;

      // Store offer in candidate
      const offerData = {
        ...cand,
        status: 'offered',
        offer_ref: offerRef,
        offer_accept_token: acceptToken,
        offer_letter_date: new Date().toISOString(),
        offer_ctc: ctc,
        offer_ctc_annual: ctc,
        joining_date: jDate,
        designation: pos,
        department: dept,
        location: loc,
        reporting_to: reporting_to || '',
        probation_months: probation,
        salary: sal,
        offer_valid_till: validTill.toISOString(),
        offer_status: 'sent',
      };
      await run("UPDATE entities SET status='offered', data=$1 WHERE id=$2", [JSON.stringify(offerData), candidate_id]);

      // Generate salary structure PDF attachment
      let pdfBuffer = null;
      try {
        const jDateFmt = jDate ? new Date(jDate).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' }) : '';
        pdfBuffer = await buildSalaryStructurePdf({
          candidateName: name,
          employeeCode:  cand.employee_code || '',
          designation:   pos,
          department:    dept,
          dateOfJoining: jDateFmt,
          effectiveFrom: todayStr,
          annualCTC:     ctc,
          sal,
        });
      } catch (pdfErr) {
        console.error('[pdf] salary structure generation failed:', pdfErr.message);
      }

      let emailError = null;
      try {
        await sendEmail({
          to:      cand.email,
          subject: `Offer Letter – ${pos} at Maxvolt Energy Industries Limited`,
          html:    emailHtml,
          attachments: pdfBuffer ? [{
            filename: `Salary_Structure_${name.replace(/\s+/g, '_')}.pdf`,
            content:  pdfBuffer,
          }] : [],
        });
      } catch (emailErr) {
        console.error('sendOfferLetter email failed:', emailErr.message);
        emailError = emailErr.message;
      }

      return res.json({ success: true, accept_link: acceptLink, offer_ref: offerRef, email_error: emailError });
    }

    /* ── Get Offer by Accept Token (public) ─────────── */
    case 'getOfferByToken': {
      const { token } = p;
      if (!token) return res.json({ error: 'Token required' });
      const row = await one("SELECT data FROM entities WHERE type='Candidate' AND data::jsonb->>'offer_accept_token'=$1", [token]);
      if (!row) return res.json({ error: 'Offer not found or link has expired.' });
      const cand = JSON.parse(row.data);
      if (cand.offer_status === 'accepted') return res.json({ error: 'This offer has already been accepted.' });
      if (cand.offer_valid_till && new Date(cand.offer_valid_till) < new Date()) {
        return res.json({ error: 'This offer link has expired. Please contact HR.' });
      }
      return res.json({ offer: {
        full_name: cand.full_name,
        email: cand.email,
        designation: cand.designation || cand.position_applied,
        department: cand.department,
        location: cand.location,
        joining_date: cand.joining_date,
        reporting_to: cand.reporting_to,
        probation_months: cand.probation_months,
        offer_ref: cand.offer_ref,
        salary: cand.salary,
      }});
    }

    /* ── Accept Offer Letter (public, token-based) ───── */
    case 'acceptOfferLetter': {
      const { token, full_name, parent_name, contact_no } = p;
      if (!token) return res.json({ success: false, error: 'Token required' });

      const row = await one("SELECT id,data FROM entities WHERE type='Candidate' AND data::jsonb->>'offer_accept_token'=$1", [token]);
      if (!row) return res.json({ success: false, error: 'Offer not found.' });
      const cand = JSON.parse(row.data);
      if (cand.offer_status === 'accepted') return res.json({ success: false, error: 'Already accepted.' });

      const updated = {
        ...cand,
        status: 'offer_accepted',
        offer_status: 'accepted',
        offer_accepted_at: new Date().toISOString(),
        offer_accepted_name: full_name || cand.full_name,
        offer_parent_name: parent_name,
        offer_contact: contact_no,
      };
      await run("UPDATE entities SET status='offer_accepted', data=$1 WHERE id=$2", [JSON.stringify(updated), row.id]);

      // Notify HR
      const hrEmail = process.env.HR_EMAIL || 'hr@maxvoltenergy.com';
      await sendEmail({
        to: hrEmail,
        subject: `Offer Accepted: ${updated.full_name} – ${updated.designation || updated.position_applied}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#16a34a;color:#fff;padding:20px;border-radius:8px;text-align:center;">
            <h2 style="margin:0;">Offer Accepted!</h2>
          </div>
          <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;">
            <p><strong>${updated.full_name}</strong> has accepted the offer letter.</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;">
              <tr><td style="padding:6px 12px;border:1px solid #e5e7eb;font-weight:600;width:40%;">Position</td><td style="padding:6px 12px;border:1px solid #e5e7eb;">${updated.designation || updated.position_applied}</td></tr>
              <tr><td style="padding:6px 12px;border:1px solid #e5e7eb;font-weight:600;">Joining Date</td><td style="padding:6px 12px;border:1px solid #e5e7eb;">${updated.joining_date || '—'}</td></tr>
              <tr><td style="padding:6px 12px;border:1px solid #e5e7eb;font-weight:600;">Contact</td><td style="padding:6px 12px;border:1px solid #e5e7eb;">${updated.email} · ${contact_no}</td></tr>
              <tr><td style="padding:6px 12px;border:1px solid #e5e7eb;font-weight:600;">Accepted On</td><td style="padding:6px 12px;border:1px solid #e5e7eb;">${new Date().toLocaleString('en-IN')}</td></tr>
            </table>
          </div>
        </div>`,
      }).catch(() => {});

      return res.json({ success: true });
    }

    /* ── Invite Joiner to App ─────────────────────────── */
    case 'inviteJoinerToApp': {
      if (!cu) return res.status(401).json({ error: 'Unauthorised' });
      const { candidate_id } = p;
      const cRow = await one("SELECT data FROM entities WHERE type='Candidate' AND id=$1", [candidate_id]);
      if (!cRow) return res.json({ success: false, error: 'Candidate not found' });
      const cand = JSON.parse(cRow.data);
      if (!cand.email) return res.json({ success: false, error: 'Candidate has no email' });

      const appBase = process.env.APP_URL || 'https://hr.maxvolt-one.co.in';
      const registerLink = `${appBase}/register`;

      await sendEmail({
        to: cand.email,
        subject: `Welcome to Maxvolt HR System – Your Account Awaits!`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
          <div style="background:#ea580c;color:#fff;padding:28px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="margin:0;font-size:24px;">Welcome to Maxvolt Energy!</h1>
            <p style="margin:8px 0 0;opacity:.9;">We're excited to have you join us today.</p>
          </div>
          <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;">
            <p>Dear <strong>${cand.full_name}</strong>,</p>
            <p>Today is your joining date and we are thrilled to welcome you to the <strong>Maxvolt Energy</strong> family!</p>
            <p>As part of our digital onboarding, please register on our HR system using the button below. Your onboarding formalities, documents submission, and attendance will all be managed through this portal.</p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${registerLink}" style="display:inline-block;background:#ea580c;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Register on HR Portal</a>
            </div>
            <p style="font-size:13px;color:#555;">Please register using your official email address: <strong>${cand.email}</strong></p>
            <p style="font-size:13px;color:#555;">If you have any questions, please reach out to HR at <a href="mailto:hr@maxvoltenergy.com">hr@maxvoltenergy.com</a> or call +91 120 4291595.</p>
            <p style="margin-top:24px;">Once again, welcome aboard! We are glad to have you with us.</p>
            <p style="margin-top:4px;">Warm regards,<br/><strong>Human Resources Team</strong><br/>Maxvolt Energy Industries Limited</p>
          </div>
          <div style="background:#f9fafb;padding:12px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;text-align:center;font-size:11px;color:#999;">
            E-82 Bulandshahr Road Industrial Area, Ghaziabad, UP – 201009 &nbsp;|&nbsp; CIN: U40106DL2019PLC349854
          </div>
        </div>`,
      });

      // Mark candidate as joined
      const updCand = { ...cand, status: 'joined', app_invite_sent_at: new Date().toISOString() };
      await run("UPDATE entities SET status='joined', data=$1 WHERE id=$2", [JSON.stringify(updCand), candidate_id]);

      return res.json({ success: true });
    }

    /* ── AI: HR Letter Generation ────────────────────── */
    case 'generateEmployeeLetter': {
      if (!(await hasRole(cu, MGR_ROLES))) return res.status(403).json({ error: 'HR/Management access required' });
      const letterUid = p.user_id;
      const letterType = p.letter_type;
      const extra = p.extra || {};
      if (!letterUid || !letterType) return res.json({ success: false, error: 'user_id and letter_type are required' });

      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [letterUid]);
      if (!empRow) return res.json({ success: false, error: 'Employee not found' });
      const emp = JSON.parse(empRow.data);
      const uRow = await one("SELECT email,full_name FROM users WHERE id=$1", [letterUid]);

      const ssRow = await one("SELECT data,created_at FROM entities WHERE type='SalaryStructure' AND user_id=$1 ORDER BY created_at DESC LIMIT 1", [letterUid]);
      const ss = ssRow ? JSON.parse(ssRow.data) : {};
      const annualCTC = ss.annualCTC || (ss.grossMonthly ? Math.round(ss.grossMonthly * 12) : 0);

      const todayDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
      const refPrefix = { confirmation: 'CONF', experience: 'EXP', relieving: 'REL', appointment: 'APPT', salary_revision: 'SAL', address_proof: 'ADDR', warning: 'WARN', promotion: 'PROMO' }[letterType] || 'LTR';
      const ref = `MEIL/HR/${refPrefix}/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 9000) + 1000)}`;

      const empName    = emp.display_name || uRow?.full_name || '[Employee Name]';
      const designation = emp.designation || '[Designation]';
      const department  = emp.department || '[Department]';
      const location    = emp.work_location || 'Ghaziabad, Uttar Pradesh';
      const doj         = emp.date_of_joining || '[Date of Joining]';
      const empCode     = emp.employee_code || '[Employee Code]';
      const isFemale    = (emp.gender || '').toLowerCase() === 'female';
      const sal         = isFemale ? 'Ms.' : 'Mr.';
      const pronoun     = isFemale ? 'her' : 'him';
      const pronoun2    = isFemale ? 'she' : 'he';

      const fmt = n => n ? '₹' + Number(n).toLocaleString('en-IN') : '[____]';
      // Allow HR to override CTC components via extra.ctc_override
      const ctcOvr  = extra.ctc_override || {};
      const basic   = Number(ctcOvr.basic)             || ss.basic || 0;
      const hra     = Number(ctcOvr.hra)               || ss.hra || 0;
      const conv    = Number(ctcOvr.conveyance)        || ss.conveyance || 0;
      const special = Number(ctcOvr.special_allowance) || ss.special_allowance || 0;
      const otherAl = Number(ctcOvr.other_allowance)   || ss.other_allowance || 0;
      const gross   = basic + hra + conv + special + otherAl || ss.grossMonthly || 0;
      const pfEmp   = ss.pf_employee || (basic ? Math.round(basic * 0.12) : 0);
      const net     = gross ? gross - pfEmp : ss.netPay || 0;
      const overrideAnnualCTC = Number(ctcOvr.annual_ctc) || annualCTC;

      const chosenSignatory = extra.signatory || '';

      const wrap = body => `<div style="font-family:Arial,sans-serif;font-size:13.5px;line-height:1.75;color:#111;max-width:700px;">${body}</div>`;
      const P    = t   => `<p style="margin:0 0 12px;text-align:justify;">${t}</p>`;
      const H    = t   => `<p style="margin:18px 0 6px;font-weight:bold;">${t}</p>`;
      const sig  = (close, _defaultSigner, role) => {
        const nameBlock = chosenSignatory
          ? `<p style="margin:4px 0 2px;font-weight:bold;">${chosenSignatory}</p><p style="margin:0;font-size:12px;color:#555;">For Maxvolt Energy Industries Limited</p>`
          : `<p style="margin:54px 0 2px;font-weight:bold;">For Maxvolt Energy Industries Limited</p>${role ? `<p style="margin:0;">${role}</p>` : ''}`;
        return `<p style="margin:36px 0 0;">${close}</p>${nameBlock}`;
      };

      const docList = `<ul style="margin:6px 0 14px 24px;line-height:1.85;">
  <li>Proof of address &amp; ID (Local &amp; Permanent).</li>
  <li>Five colour recent passport-size photographs (not older than three months).</li>
  <li>Photocopies of 10th, 12th certificate &amp; highest degree certificates.</li>
  <li>Offer, Appointment &amp; Increment Letters (Past 3).</li>
  <li>Proof of work experience – Experience / Relieving letters (Past 3).</li>
  <li>Last 3 months salary slips &amp; 6 months bank statement.</li>
</ul>`;

      const salaryRows = [
        basic   && ['Basic Pay',                              basic,   basic * 12],
        hra     && ['House Rent Allowance (HRA)',             hra,     hra * 12],
        conv    && ['Conveyance Allowance',                   conv,    conv * 12],
        special && ['Special Allowance',                      special, special * 12],
        otherAl && ['Other Allowance',                        otherAl, otherAl * 12],
        gross   && ['<strong>Gross Monthly</strong>',         gross,   gross * 12],
        pfEmp   && ['Less: PF – Employee (12%)',              pfEmp,   pfEmp * 12],
        net     && ['<strong>Net Monthly Take-Home</strong>', net,     net * 12],
      ].filter(Boolean);

      const salaryTable = salaryRows.length ? `
<div style="margin-top:36px;page-break-before:always;">
<p style="text-align:center;font-weight:bold;font-size:15px;margin:0 0 2px;">Annexure – A</p>
<p style="text-align:center;font-size:14px;margin:0 0 14px;">Salary Structure</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;">
  <thead><tr style="background:#222;color:#fff;">
    <th style="padding:8px 12px;text-align:left;font-weight:normal;">Component</th>
    <th style="padding:8px 12px;text-align:right;font-weight:normal;">Monthly (₹)</th>
    <th style="padding:8px 12px;text-align:right;font-weight:normal;">Annual (₹)</th>
  </tr></thead>
  <tbody>${salaryRows.map(([label, m, a], i) =>
    `<tr style="background:${i % 2 === 0 ? '#f7f7f7' : '#fff'};">
      <td style="padding:7px 12px;border-bottom:1px solid #ddd;">${label}</td>
      <td style="padding:7px 12px;text-align:right;border-bottom:1px solid #ddd;">${fmt(m)}</td>
      <td style="padding:7px 12px;text-align:right;border-bottom:1px solid #ddd;">${fmt(a)}</td>
    </tr>`).join('')}
  </tbody>
</table>
<p style="margin:10px 0 2px;font-size:12px;">* Annual CTC: <strong>${overrideAnnualCTC ? fmt(overrideAnnualCTC) + '/-' : '[____]'}</strong></p>
<p style="font-size:12px;margin:2px 0;">* TDS deducted as per applicable provisions. Gross salary is subject to TDS.</p>
<p style="font-size:12px;margin:2px 0;">* Statutory benefits (PF, ESI, Gratuity, Bonus) as per applicable labour laws.</p>
</div>` : '';

      const joinDate = extra.joining_date || doj;

      const templateLetters = {

        appointment: () => wrap(`
<p style="font-weight:bold;font-size:12px;margin:0 0 16px;">PRIVATE &amp; STRICTLY CONFIDENTIAL</p>
<p style="margin:0 0 4px;">${todayDate}</p>
<p style="margin:0 0 20px;">To ${sal} ${empName},</p>
<p style="text-align:center;font-weight:bold;font-size:17px;letter-spacing:2px;text-decoration:underline;margin:0 0 6px;">APPOINTMENT LETTER</p>
<p style="text-align:right;font-size:12px;color:#555;margin:0 0 24px;"><strong>Ref:</strong> ${ref}</p>
${P(`Dear ${sal} ${empName},`)}
${P(`With reference to your application and subsequent interview with us, we are pleased to appoint you as <strong>${designation}</strong> in <strong>${department}</strong> in Our Company <strong>Maxvolt Energy Industries Limited</strong>, on the following terms and conditions:`)}
${P(`<strong>Date of joining:</strong> ${joinDate}`)}
${P(`Your employment with Our Company shall be effective from <strong>${joinDate}</strong>. This offer shall automatically stand revoked in the event of your not joining the Company on or before the date mentioned under this letter.`)}
${H('Employment:')}
${P('Your position is a full-time employment with Our Company and you shall devote yourself exclusively to the business and vision of Our Company. You will not take up any other work for remuneration (part time or otherwise) or work in an advisory capacity, or be interested directly or indirectly, in any other trade or business during your employment with Our Company, without permission in writing of Our Company.')}
${P('Your employment with Our Company is subject to you being medically fit. You may be required to undergo a medical examination, if desired by Our Company. You shall be entitled to such Leaves in accordance with the Leave policy of the Company.')}
${P('This letter of appointment is based on the information furnished in your application for employment and during the interviews you had with us. If, at any time in future, it comes to light that any of this information is incorrect or any relevant information has been withheld, then your employment is liable to be terminated without notice.')}
${P('During your employment, you must devote your full time and professional abilities exclusively to the company’s business. You are prohibited from participating in any other employment, consulting, or commercial activity — whether for profit or not — without prior written permission, particularly if it creates a conflict of interest or impacts your productivity.')}
${H('Place of Posting and Transfer:')}
${P(`Your initial posting will be at <strong>${location}</strong>. However, your employment may be transferred, at the sole discretion of Our Company, to any department / section, location, associate, sister concern or subsidiary, at any place in India or abroad, whether existing today or which may come up in future. Your remuneration will depend on the place of posting and may vary based on decision of the Management.`)}
${H('Probation:')}
${P('You will be on probation for a period of <strong>Six months</strong> from the date of your joining. Subject to your efficiency, punctuality, conduct, maintenance of discipline and in accordance with the performance criteria as decided by the management / Our Company, being found satisfactory, your confirmation will be communicated to you in writing or can be extended beyond 6 (Six) months at the discretion of the management / Our Company.')}
${P('During the probation period, you are entitled to avail <strong>03 Casual Leave</strong> on pro rata basis. Approval for Casual Leave must be sought from your reporting manager in advance.')}
${H('Compensation:')}
${P(`Your annual CTC will be as detailed in <strong>Annexure – A</strong> as annexed to this letter <strong>INR ${overrideAnnualCTC ? Number(overrideAnnualCTC).toLocaleString('en-IN') : '[____]'}/-</strong>. The Salary shall be payable on a monthly basis and arrears within 7th day of each calendar month.`)}
${P('All payments shall be made in accordance with the relevant policies of Our Company in effect from time to time, including payroll practices, and shall be subject to income tax deductions at source, as applicable.')}
${P('Statutory benefits such as Provident Fund, Employees’ State Insurance (ESI), Gratuity, Bonus and any other applicable benefits shall be governed by and provided in accordance with the applicable provisions of the prevailing labor laws in force in India.')}
${H('Performance of Duties:')}
${P('You shall be assigned with all the duties and responsibilities by your Head of Department from time to time. You shall, at all times, carry out the duties and responsibilities assigned to you faithfully and diligently, endeavouring to the best of your ability to protect and promote the interests of Our Company.')}
${P('You are expected to attend office during the working hours / shifts as may be decided by the Company. The Company practices a minimum of <strong>48-hour workweek</strong> for all staff and management employees. You shall strictly refrain from using any of Our Company resources for personal use.')}
${H('Confidentiality:')}
${P('During the course of your employment with Our Company, you may have access to confidential / proprietary information about Our Company, its clients, its business transactions, and associated companies. You will not during the course of your employment with the company or at any time thereafter divulge or disclose to any person whomsoever, or make any use of any information or knowledge obtained by you during your employment as to the business or affairs of Our Company. Your salary details are strictly confidential; any breach will invite disciplinary action and may result in termination of your services.')}
${H('Intellectual Property:')}
${P('You agree to assign to the Company any and all rights, title and interest, including but not limited to copyrights, trade secrets and proprietary rights to the inventions, information, materials, products, software, programs, websites, databases and deliverables developed or acquired during your employment with Our Company. You agree to abide by the Intellectual Property Policy and procedures of Our Company.')}
${H('Termination:')}
${P('During the period of probation, Our Company may at any time terminate your employment by giving <strong>15 Days</strong> written notice to you, whereas you may terminate the employment by giving a notice of <strong>15 Days</strong> in writing to Our Company.')}
${P('Upon confirmation, either party may at any time terminate the employment, without cause, by giving in writing to the other party a notice period of <strong>30 Days</strong>. The payment of salary during such notice period would be on the basis of cost to Our Company.')}
${P('The full and final settlement of the employee’s salary account is done after <strong>45 days</strong> of the employee’s last working day of services. The company will provide full and final settlement only in the condition that the employee has served Maxvolt Energy Industries Limited with the notice period mentioned in appointment letter.')}
${H('Non-Solicitation:')}
${P('During your employment with Our Company and for a period of <strong>3 (Three) months</strong> thereafter, you shall not, directly or indirectly, induce, persuade or endeavour to induce any person who was an employee of Our Company to leave the employment of Our Company, nor carry on, engage in or be concerned or interested in any business or activity which competes with the business and activities of Our Company.')}
${P('You are required to sign and submit a copy of this letter of appointment as a token of your acceptance of our terms and conditions, failing which this letter of appointment will be treated as withdrawn. Please submit the following documents on your joining date:')}
${docList}
${P('We welcome you to our organization and look forward to your contribution to the growth of the organization and yourself.')}
${sig('Yours faithfully,', 'For Maxvolt Energy Industries Limited', 'Authorised Signatory')}
<p style="margin:64px 0 6px;">Employee Signature: _________________________________&nbsp;&nbsp;&nbsp;&nbsp; Date: _______________</p>
<p>Name: _________________________________</p>
${salaryTable}`),

        confirmation: () => wrap(`
<p style="text-align:center;font-weight:bold;font-size:17px;text-decoration:underline;margin:0 0 22px;">Letter of Confirmation</p>
<p style="margin:0 0 4px;">${todayDate}</p>
<p style="margin:0 0 22px;font-size:12px;color:#555;"><strong>Ref:</strong> ${ref}</p>
${P(`Dear ${sal} ${empName},`)}
<p style="font-weight:bold;margin:0 0 10px;">Congratulation!!</p>
${P(`<strong>Subject: Service Confirmation Letter to the Designation of ‘${designation}’</strong>`)}
${P('Following completion of your six months’ probation period at Maxvolt Energy Industries Limited. We have reviewed your performance and found the same to be satisfactory.')}
${P(`In view of the above, we are pleased to inform you that you have been confirmed to the position of <strong>‘${designation}’</strong> at Maxvolt Energy Industries Limited with effect from <strong>${extra.effective_date || '[Effective Date]'}</strong>.`)}
${P('Your salary will be reviewed every 12 months from the date of joining or as decided by company and increases will be based upon satisfactory performance in the position.')}
${P('All other terms and conditions of your appointment will remain the same except the following.')}
${H('Notice Period –')}
${P('Either party may at any time terminate the employment, without cause by giving in writing to the other party a notice period of <strong>30 Days</strong>. You may alternatively, exercise the option of buying out your notice period per the terms and conditions of this employment letter. The payment of salary during such notice period would be on the basis of cost to Our Company.')}
${H('Leave Credit –')}
${P(`As a gesture of appreciation for your hard work and dedication, we are pleased to inform you that you are now eligible to earn and take advantage of annual leave benefits. Starting <strong>${extra.effective_date || '[Effective Date]'}</strong>, you will be entitled to accrue and utilize earned leave days as per our company’s leave policy. We believe that providing earned leave is a valuable component of our commitment to the well-being and work-life balance of our employees. We encourage you to plan and utilize your earned leave in a manner that supports your personal and professional needs.`)}
${H('Salary Settlement (Full &amp; Final) –')}
${P('The full and final settlement of the employee’s salary account is done after <strong>45 days</strong> of the employee’s last working day of services. The company will provide full and final settlement only in the condition that the employee has served Maxvolt Energy Industries Limited with the notice period mentioned in appointment letter and worked fruitfully during the notice been served and has facilitated in the smooth transition. Employee’s last salary and other benefits will be provided once the employee has been issued clearance letter from HR, IT, Accounts &amp; Administration department.')}
${P('Please signify your acceptance to terms and conditions, mentioned above &amp; in company’s policy handbook, by signing this letter and returning it to me at an earliest convenient time.')}
${P('In case you have any queries, do not hesitate to reach your manager / supervisor / HR Department.')}
${P('Maxvolt Energy Industries Limited, congratulates you on your confirmation and wishes you well in your position.')}
${sig('Sincerely,', 'HR Head', 'Maxvolt Energy Industries Limited')}
<p style="margin-top:52px;">Employee Signature: _________________________________&nbsp;&nbsp;&nbsp;&nbsp; Date: _______________</p>`),

        relieving: () => wrap(`
<p style="text-align:center;font-weight:bold;font-size:17px;letter-spacing:1px;text-decoration:underline;margin:0 0 22px;">RELIEVING CUM EXPERIENCE LETTER</p>
<p style="margin:0 0 4px;">${todayDate}</p>
<p style="margin:0 0 22px;font-size:12px;color:#555;"><strong>Ref:</strong> ${ref}</p>
${P('<strong>Subject: Relieving Cum Experience Letter</strong>')}
${P(`Dear ${sal} ${empName},`)}
${P(`This is to inform you that you hereby stand relieved from the services of MaxVolt Energy Industries Limited, in the closing hours of <strong>${extra.last_working_day || '[Last Working Date]'}</strong>. Your full and final account has been processed and settled.`)}
${P('Please note your Basic Information as maintained in the HR records at the time of your separation is as follows:')}
<table style="margin:8px 0 20px;font-size:13.5px;border-collapse:collapse;">
  <tr><td style="padding:6px 20px 6px 0;font-weight:bold;">Name:</td><td style="padding:6px 0;">${empName}</td></tr>
  <tr><td style="padding:6px 20px 6px 0;font-weight:bold;">Employee Code:</td><td style="padding:6px 0;">${empCode}</td></tr>
  <tr><td style="padding:6px 20px 6px 0;font-weight:bold;">Period Served:</td><td style="padding:6px 0;">From <strong>${doj}</strong> To <strong>${extra.last_working_day || '[Last Working Date]'}</strong></td></tr>
  <tr><td style="padding:6px 20px 6px 0;font-weight:bold;">Last Designation Held:</td><td style="padding:6px 0;">${designation}</td></tr>
  <tr><td style="padding:6px 20px 6px 0;font-weight:bold;">Department:</td><td style="padding:6px 0;">${department}</td></tr>
</table>
${P('We wish you all the best in all your future endeavors.')}
${sig('Warm Regards,', 'MaxVolt Energy Industries Limited', '(Authorized Signatory)')}
<p style="margin-top:52px;">Employee Signature: _________________________________&nbsp;&nbsp;&nbsp;&nbsp; Date: _______________</p>`),

        promotion: () => {
          const newDesig = extra.new_designation || '[New Designation]';
          const effDate  = extra.effective_date  || '[Effective Date]';
          return wrap(`
<p style="font-weight:bold;font-size:12px;margin:0 0 16px;">PRIVATE &amp; STRICTLY CONFIDENTIAL</p>
<p style="margin:0 0 4px;">${todayDate}</p>
<p style="margin:0 0 20px;">To ${sal} ${empName},</p>
<p style="text-align:center;font-weight:bold;font-size:17px;letter-spacing:2px;text-decoration:underline;margin:0 0 6px;">PROMOTION LETTER</p>
<p style="text-align:right;font-size:12px;color:#555;margin:0 0 24px;"><strong>Ref:</strong> ${ref}</p>
${P(`Dear ${sal} ${empName},`)}
${P('We are pleased to inform you that based on your sustained performance, contribution and dedication towards the growth of <strong>Maxvolt Energy Industries Limited</strong>, the Management has decided to promote you.')}
${P(`You are hereby promoted to the designation of <strong>${newDesig}</strong> in the <strong>${department}</strong> department, with effect from <strong>${effDate}</strong>.`)}
${P(`Your revised annual CTC will be <strong>INR ${overrideAnnualCTC ? Number(overrideAnnualCTC).toLocaleString('en-IN') : '[____]'}/-</strong> as detailed in <strong>Annexure – A</strong>. All other terms and conditions of your appointment shall remain unchanged.`)}
${H('Performance of Duties:')}
${P(`In your new role as <strong>${newDesig}</strong>, you will be expected to take on greater responsibilities and continue to uphold the values and work ethics that have earned you this recognition. You shall diligently carry out all duties assigned by your Head of Department and contribute proactively to the team's objectives.`)}
${H('Confidentiality:')}
${P('Your salary and promotion details are strictly confidential. Any disclosure to unauthorised persons will be treated as a disciplinary offence and may result in termination of employment.')}
${P('Please sign and return a copy of this letter as your acceptance of the promotion and its terms.')}
${P('We congratulate you on this well-deserved promotion and wish you continued success at Maxvolt Energy Industries Limited.')}
${sig('Yours faithfully,', 'For Maxvolt Energy Industries Limited', 'Authorised Signatory')}
<p style="margin:64px 0 6px;">Employee Signature: _________________________________&nbsp;&nbsp;&nbsp;&nbsp; Date: _______________</p>
<p>Name: _________________________________</p>
${salaryTable}`);
        },

        salary_revision: () => {
          const newCTC = Number(extra.revised_annual_ctc) || overrideAnnualCTC || 0;
          const effDate = extra.effective_date || '[Effective Date]';
          // Old CTC from ss (before override)
          const oldAnnualCTC = annualCTC || 0;
          const oldBasic   = ss.basic || 0;
          const oldHRA     = ss.hra || 0;
          const oldConv    = ss.conveyance || 0;
          const oldSpecial = ss.special_allowance || 0;
          const oldOther   = ss.other_allowance || 0;
          const oldGross   = ss.grossMonthly || (oldBasic + oldHRA + oldConv + oldSpecial + oldOther);
          const oldPF      = ss.pf_employee || (oldBasic ? Math.round(oldBasic * 0.12) : 0);
          const oldNet     = ss.netPay || (oldGross ? oldGross - oldPF : 0);

          const revRows = [
            ['Basic Pay',                              oldBasic,   basic,   basic * 12],
            hra || oldHRA ? ['House Rent Allowance (HRA)',         oldHRA,     hra,     hra * 12] : null,
            conv || oldConv ? ['Conveyance Allowance',             oldConv,    conv,    conv * 12] : null,
            special || oldSpecial ? ['Special Allowance',          oldSpecial, special, special * 12] : null,
            otherAl || oldOther ? ['Other Allowance',              oldOther,   otherAl, otherAl * 12] : null,
            oldGross || gross ? [`<strong>Gross Monthly</strong>`, oldGross,   gross,   gross * 12] : null,
            oldPF || pfEmp ? [`Less: PF – Employee (12%)`,         oldPF,      pfEmp,   pfEmp * 12] : null,
            oldNet || net  ? [`<strong>Net Monthly Take-Home</strong>`, oldNet, net,    net * 12] : null,
          ].filter(Boolean);

          const revTable = revRows.length ? `
<div style="margin-top:20px;">
<p style="font-weight:bold;margin:0 0 8px;">Salary Revision – Comparative Statement</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;">
  <thead><tr style="background:#222;color:#fff;">
    <th style="padding:8px 12px;text-align:left;font-weight:normal;">Component</th>
    <th style="padding:8px 12px;text-align:right;font-weight:normal;">Previous Monthly (₹)</th>
    <th style="padding:8px 12px;text-align:right;font-weight:normal;">Revised Monthly (₹)</th>
    <th style="padding:8px 12px;text-align:right;font-weight:normal;">Revised Annual (₹)</th>
  </tr></thead>
  <tbody>${revRows.map(([label, old, nw, ann], i) =>
    `<tr style="background:${i % 2 === 0 ? '#f7f7f7' : '#fff'};">
      <td style="padding:7px 12px;border-bottom:1px solid #ddd;">${label}</td>
      <td style="padding:7px 12px;text-align:right;border-bottom:1px solid #ddd;">${old ? fmt(old) : '—'}</td>
      <td style="padding:7px 12px;text-align:right;border-bottom:1px solid #ddd;">${nw ? fmt(nw) : '—'}</td>
      <td style="padding:7px 12px;text-align:right;border-bottom:1px solid #ddd;">${ann ? fmt(ann) : '—'}</td>
    </tr>`).join('')}
  </tbody>
</table>
<p style="margin:10px 0 2px;font-size:12px;">* Previous Annual CTC: <strong>${oldAnnualCTC ? fmt(oldAnnualCTC) + '/-' : '[____]'}</strong> &nbsp;|&nbsp; Revised Annual CTC: <strong>${newCTC ? fmt(newCTC) + '/-' : overrideAnnualCTC ? fmt(overrideAnnualCTC) + '/-' : '[____]'}</strong></p>
<p style="font-size:12px;margin:2px 0;">* TDS deducted as per applicable provisions. * Statutory benefits as per applicable labour laws.</p>
</div>` : '';

          return wrap(`
<p style="font-weight:bold;font-size:12px;margin:0 0 16px;">PRIVATE &amp; STRICTLY CONFIDENTIAL</p>
<p style="margin:0 0 4px;">${todayDate}</p>
<p style="margin:0 0 20px;">To ${sal} ${empName},</p>
<p style="text-align:center;font-weight:bold;font-size:17px;letter-spacing:2px;text-decoration:underline;margin:0 0 6px;">SALARY REVISION LETTER</p>
<p style="text-align:right;font-size:12px;color:#555;margin:0 0 24px;"><strong>Ref:</strong> ${ref}</p>
${P(`Dear ${sal} ${empName},`)}
${P('We are pleased to inform you that the Management has reviewed your performance and contribution to <strong>Maxvolt Energy Industries Limited</strong> and has decided to revise your compensation.')}
${P(`Effective <strong>${effDate}</strong>, your revised annual CTC will be <strong>INR ${newCTC ? Number(newCTC).toLocaleString('en-IN') : overrideAnnualCTC ? Number(overrideAnnualCTC).toLocaleString('en-IN') : '[____]'}/-</strong>. The detailed salary breakup is as follows:`)}
${revTable}
${P('All other terms and conditions of your employment remain unchanged. Your salary is strictly confidential and any disclosure will invite disciplinary action.')}
${P('Please sign and return a copy of this letter as acknowledgement of the revised compensation.')}
${sig('Yours faithfully,', 'For Maxvolt Energy Industries Limited', 'Authorised Signatory')}
<p style="margin:64px 0 6px;">Employee Signature: _________________________________&nbsp;&nbsp;&nbsp;&nbsp; Date: _______________</p>`);
        },

        experience: () => wrap(`
<p style="text-align:center;font-weight:bold;font-size:17px;text-decoration:underline;margin:0 0 22px;">EXPERIENCE / SERVICE CERTIFICATE</p>
<p style="margin:0 0 4px;">${todayDate}</p>
<p style="margin:0 0 22px;font-size:12px;color:#555;"><strong>Ref:</strong> ${ref}</p>
${P('<strong>To Whomsoever It May Concern</strong>')}
${P(`This is to certify that <strong>${empName}</strong> (Employee Code: <strong>${empCode}</strong>) was associated with <strong>Maxvolt Energy Industries Limited</strong> as <strong>${designation}</strong> in the <strong>${department}</strong> Department.`)}
${P(`<strong>Period of Service:</strong> From <strong>${doj}</strong> To <strong>${extra.last_working_day || '[Last Working Date]'}</strong>`)}
${P(`During ${pronoun} tenure, ${pronoun2} demonstrated commendable work ethic, professional integrity and dedication. ${pronoun2.charAt(0).toUpperCase() + pronoun2.slice(1)} maintained a satisfactory record of performance and conduct throughout ${pronoun} association with our organization.`)}
${P(`This certificate is issued at ${pronoun} request and for whatever purpose it may serve.`)}
${sig('Yours faithfully,', 'For Maxvolt Energy Industries Limited', 'Authorised Signatory – Human Resources Department')}
<p style="margin-top:52px;">Employee Signature: _________________________________&nbsp;&nbsp;&nbsp;&nbsp; Date: _______________</p>`),

      };

      let letter, isHtml = false;

      if (templateLetters[letterType]) {
        letter = templateLetters[letterType]();
        isHtml = true;
      } else {
        const aiTypeInstructions = {
          address_proof: `an employment / address verification letter addressed to ${extra.addressed_to || 'Whom It May Concern'} for purpose: ${extra.purpose || 'general verification'}.`,
          warning: `a formal written warning letter. Subject: ${extra.subject || '[subject]'}. Details: ${extra.details || '[details]'}.`,
        };
        const extraLines = Object.entries(extra).filter(([, v]) => v !== '' && v != null)
          .map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`).join('\n');

        const aiPrompt = `You are an HR officer at Maxvolt Energy Industries Limited, India. Write ${aiTypeInstructions[letterType] || 'a professional HR letter.'}

Employee: ${empName} | Code: ${empCode} | Designation: ${designation} | Dept: ${department} | Location: ${location} | DOJ: ${doj}
Ref: ${ref} | Date: ${todayDate}
${extraLines ? 'Additional:\n' + extraLines : ''}

Return an HTML fragment only (no <html>/<body> tags). Wrap in:
<div style="font-family:Arial,sans-serif;font-size:13.5px;line-height:1.75;color:#111;max-width:700px;">

Structure: date (plain paragraph), ref (small, right-aligned), salutation, title (centered bold underlined 17px), body paragraphs (justify, key values in <strong>), section headings (bold own paragraph), closing + company name + Authorised Signatory. No colors, no backgrounds, no borders. Plain clean business letter only.`;

        try { letter = await callAI(aiPrompt); isHtml = true; }
        catch (e) { return res.json({ success: false, error: `AI failed: ${e.message}` }); }
        if (!letter) return res.json({ success: false, error: 'AI returned an empty letter' });
      }

      return res.json({ success: true, letter, ref, letter_type: letterType, isHtml });
    }

    /* ── AI: HR Assistant ────────────────────────────── */
    case 'askMax': {
      const { question = '', conversationHistory = [] } = p;
      const uid = cu?.id || p.user_id;

      // ── Build personalised HR context grounded in the user's real data ──
      let contextBlock = '';
      try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const now = new Date();
        const currentFY = now.getMonth() >= 3
          ? `${now.getFullYear()}-${now.getFullYear() + 1}`
          : `${now.getFullYear() - 1}-${now.getFullYear()}`;

        const parts = [];

        if (uid) {
          // Employee record
          const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [uid]);
          const emp = empRow ? JSON.parse(empRow.data) : null;
          if (emp) {
            parts.push(`EMPLOYEE PROFILE:
- Name: ${emp.display_name || cu?.email || 'Employee'}
- Employee Code: ${emp.employee_code || 'N/A'}
- Department: ${emp.department || 'N/A'} | Designation: ${emp.designation || 'N/A'}
- Status: ${emp.employee_status || 'N/A'} | Date of Joining: ${emp.date_of_joining || 'N/A'}
- Work Location: ${emp.work_location || 'N/A'} | Employment Type: ${emp.employment_type || 'N/A'}`);
          }

          // Leave balances with policy names
          const balRows = (await all("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [uid])).map(r => JSON.parse(r.data));
          const polRows = (await all("SELECT id,data FROM entities WHERE type='LeavePolicy'")).map(r => ({ id: r.id, ...JSON.parse(r.data) }));
          const polName = (pid) => polRows.find(pp => pp.id === pid)?.name || pid;
          const thisYearBals = balRows.filter(b => !b.year || b.year === now.getFullYear());
          if (thisYearBals.length) {
            parts.push(`LEAVE BALANCES (${now.getFullYear()}):\n` + thisYearBals.map(b =>
              `- ${polName(b.leave_policy_id)}: ${b.available ?? 0} available (allocated ${b.total_allocated ?? 0}, used ${b.used ?? 0}, pending ${b.pending_approval ?? 0})`
            ).join('\n'));
          }

          // Recent + upcoming leaves
          const recentLeaves = (await all("SELECT data FROM entities WHERE type='Leave' AND user_id=$1 ORDER BY created_at DESC LIMIT 5", [uid])).map(r => JSON.parse(r.data));
          if (recentLeaves.length) {
            parts.push(`RECENT LEAVE REQUESTS:\n` + recentLeaves.map(l =>
              `- ${l.start_date} to ${l.end_date} (${l.total_days || '?'} day(s)) — ${polName(l.leave_policy_id) || l.leave_type || 'Leave'} — status: ${l.status}`
            ).join('\n'));
          }

          // Latest payslip
          const payRow = await one("SELECT data FROM entities WHERE type='Payroll' AND user_id=$1 ORDER BY created_at DESC LIMIT 1", [uid]);
          if (payRow) {
            const ps = JSON.parse(payRow.data);
            parts.push(`LATEST PAYSLIP: ${ps.month || ''} ${ps.year || ''} — Gross ₹${ps.gross_salary ?? ps.gross ?? 'N/A'}, Net ₹${ps.net_salary ?? 'N/A'}, Deductions ₹${ps.total_deductions ?? 'N/A'} (status: ${ps.status || 'N/A'})`);
          }

          // Pending items
          const pendingRegs = (await all("SELECT id FROM entities WHERE type='AttendanceRegularisation' AND user_id=$1 AND status='pending'", [uid])).length;
          const openTickets = (await all("SELECT id FROM entities WHERE type='HelpdeskTicket' AND user_id=$1 AND status NOT IN ('resolved','closed')", [uid])).length;
          const activeLoans = (await all("SELECT data FROM entities WHERE type='Loan' AND user_id=$1 AND status IN ('approved','active')", [uid])).map(r => JSON.parse(r.data));
          const pendingBits = [];
          if (pendingRegs) pendingBits.push(`${pendingRegs} pending regularisation(s)`);
          if (openTickets) pendingBits.push(`${openTickets} open helpdesk ticket(s)`);
          if (activeLoans.length) pendingBits.push(`${activeLoans.length} active loan(s) (outstanding ₹${activeLoans.reduce((s, l) => s + (l.outstanding_amount || l.remaining_amount || 0), 0)})`);
          if (pendingBits.length) parts.push(`OPEN ITEMS: ${pendingBits.join(', ')}.`);

          // This month's attendance summary
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
          const attRows = (await all("SELECT data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date' >= $2", [uid, monthStart])).map(r => JSON.parse(r.data));
          if (attRows.length) {
            const present = attRows.filter(a => a.status === 'present').length;
            const half = attRows.filter(a => a.status === 'half_day').length;
            const absent = attRows.filter(a => a.status === 'absent').length;
            parts.push(`THIS MONTH ATTENDANCE: ${present} present, ${half} half-day, ${absent} absent (${attRows.length} days recorded).`);
          }
        }

        // Active company policies (grounding documents)
        const policyRows = (await all("SELECT data FROM entities WHERE type='CompanyPolicy'")).map(r => JSON.parse(r.data)).filter(pp => pp.is_active !== false);
        if (policyRows.length) {
          parts.push(`COMPANY POLICIES (official):\n` + policyRows.slice(0, 40).map(pp =>
            `- [${pp.category || 'general'}] ${pp.title}: ${(pp.description || '').slice(0, 400)}`
          ).join('\n'));
        }

        // Upcoming holidays
        const holRows = (await all("SELECT data FROM entities WHERE type='Holiday'")).map(r => JSON.parse(r.data))
          .filter(h => h.date >= todayStr).sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(0, 5);
        if (holRows.length) {
          parts.push(`UPCOMING HOLIDAYS:\n` + holRows.map(h => `- ${h.date}: ${h.name || h.holiday_name || 'Holiday'}`).join('\n'));
        }

        parts.unshift(`Today's date: ${todayStr}. Current financial year: ${currentFY}.`);
        contextBlock = parts.join('\n\n');
      } catch (ctxErr) {
        console.warn('[askMax] context build failed:', ctxErr.message);
      }

      const systemMsg = {
        role: 'system',
        content: `You are AskMax, the AI HR copilot for Maxvolt Energy Industries Limited (India, Manufacturing/Energy sector).
You help employees with HR policies, leave, payroll, attendance, benefits, and procedures.

You have access to the CURRENT EMPLOYEE'S REAL HR DATA below. Use it to give specific, personalised answers (e.g. quote their actual leave balance, payslip figures, or pending items). When the user asks about "my" anything, answer from this data.

Rules:
- Be concise, friendly, professional. Use bullet points for lists.
- Prefer the official COMPANY POLICIES text when answering policy questions; quote specifics.
- If the data needed isn't in the context, say so and suggest contacting HR — never invent figures.
- For numbers (leave balance, salary), only state values present in the context.
- Never reveal another employee's personal data.

──────── EMPLOYEE CONTEXT ────────
${contextBlock || 'No employee context available — answer from general policy knowledge and suggest contacting HR for specifics.'}
──────────────────────────────────`
      };

      const history = [
        systemMsg,
        ...(conversationHistory || []).slice(-8).map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        })),
        { role: 'user', content: question }
      ];

      let answer;
      try {
        answer = await callAIMessages(history);
        if (!answer) answer = "I'm unable to respond right now. Please try again.";
      } catch(e) {
        answer = `I'm currently unavailable (${e.message}). Please contact HR directly.`;
      }
      return res.json({ success:true, answer });
    }

    case 'getAIStatus': {
      const { checkAI } = await import('../utils/ai.js');
      return res.json(await checkAI());
    }

    case 'testAI': {
      // Actually calls the LLM to validate key + model
      const { callAI } = await import('../utils/ai.js');
      try {
        await callAI('Say "ok" and nothing else.');
        return res.json({ ok: true });
      } catch (e) {
        return res.json({ ok: false, error: e.message });
      }
    }

    /* ── Email ────────────────────────────────────────── */
    case 'sendCustomEmail': {
      const { to, subject, body: textBody, html } = p;
      if (!to || !subject) return res.json({ success:false, error:'to and subject are required' });
      try {
        const result = await sendEmail({ to, subject, html: html || `<p>${(textBody || '').replace(/\n/g, '<br/>')}</p>`, text: textBody });
        return res.json({ success:true, ...result });
      } catch(e) {
        return res.json({ success:false, error: e.message });
      }
    }

    case 'sendInterviewEmail': {
      // Accept either direct fields or candidate_id (from InterviewManagement.jsx)
      let candidateEmail = p.candidate_email;
      let candidateName  = p.candidate_name || 'Candidate';
      let position       = p.position || 'the position';
      let interviewDate  = p.interview_date;
      let interviewTime  = p.interview_time;
      let mode           = p.mode || p.interview_mode;
      let location       = p.location;
      let interviewerName = p.interviewer_name;

      // Look up candidate by ID if direct email not provided
      if (p.candidate_id && !candidateEmail) {
        const cRow = await one("SELECT data FROM entities WHERE type='Candidate' AND id=$1", [p.candidate_id]);
        if (cRow) {
          const cand = JSON.parse(cRow.data);
          candidateEmail  = cand.email;
          candidateName   = cand.full_name || cand.name || 'Candidate';
          position        = cand.position_applied || position;
        }
      }

      // Parse scheduled_date → date + time
      if (p.scheduled_date && !interviewDate) {
        const dt = new Date(p.scheduled_date);
        interviewDate = dt.toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
        interviewTime = dt.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
      }

      // Look up interviewer name if ID provided
      if (p.interviewer_id && !interviewerName) {
        const iUser = await one("SELECT full_name FROM users WHERE id=$1", [p.interviewer_id]);
        if (iUser) interviewerName = iUser.full_name;
        const iEmp = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [p.interviewer_id]);
        if (iEmp) {
          const empData = JSON.parse(iEmp.data);
          interviewerName = `${iUser?.full_name || empData.display_name}${empData.designation ? `, ${empData.designation}` : ''}`;
        }
      }

      // Use meeting_link as location for video interviews
      if (!location && p.meeting_link) location = p.meeting_link;

      if (!candidateEmail) return res.json({ success:false, error:'Candidate email not found' });

      const tpl = emailTemplates.interviewInvite({
        candidateName,
        position,
        interviewDate,
        interviewTime,
        mode: mode === 'in_person' ? 'In-Person' : mode === 'video' ? 'Video Call' : mode || 'In-Person',
        location,
        interviewerName
      });
      const result = await sendEmail({ to: candidateEmail, ...tpl });
      return res.json({ success:true, ...result });
    }

    case 'notifyTrainingScheduled': {
      const { user_ids = [], training_title, start_date, end_date, trainer, location: loc } = p;
      let sent = 0;
      for (const uid of user_ids) {
        const uRow = await one("SELECT email,full_name FROM users WHERE id=$1", [uid]);
        if (!uRow?.email) continue;
        const tpl = emailTemplates.trainingNotification({
          employeeName: uRow.full_name,
          trainingTitle: training_title,
          startDate: start_date, endDate: end_date,
          trainer, location: loc
        });
        try { await sendEmail({ to: uRow.email, ...tpl }); sent++; } catch {}
      }
      return res.json({ success:true, sent, message:`Notified ${sent} participants` });
    }

    /* ── Recruitment other ───────────────────────────── */
    case 'submitJobApplication': {
      const { jobId, job_id, candidateData, jobTitle, jobDepartment } = p;
      const id = uuidv4();
      const d = {
        id,
        job_id: job_id || jobId,
        position_applied: jobTitle,
        department: jobDepartment,
        ...(candidateData || {}),
        status: 'applied',
        applied_date: new Date().toISOString(),
      };
      await run("INSERT INTO entities(id,type,status,data) VALUES($1,'Candidate','applied',$2)", [id, JSON.stringify(d)]);
      return res.json({ success: true, application_id: id, candidate_id: id });
    }

    case 'getPublishedJob': {
      const jobId = p.job_id || p.jobId;
      const row = await one("SELECT data FROM entities WHERE type='JobRequisition' AND id=$1", [jobId]);
      return res.json(row ? { job: JSON.parse(row.data) } : { job: null });
    }

    case 'saveSaturdaySettings': {
      const { year, location, saturdays_working } = body;
      if (!year || !location) return res.status(400).json({ error: 'year and location required' });
      const key = `saturday_settings_${year}_${location}`;
      await run(
        `INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW()::TEXT)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()::TEXT`,
        [key, JSON.stringify({ year, location, saturdays_working })]
      );
      return res.json({ success: true });
    }

    /* ── MIS & Reporting ─────────────────────────────── */
    case 'getMISData': {
      const today      = new Date().toISOString().slice(0, 10);
      const now        = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const yr12Ago    = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString().slice(0, 10);

      // ── Core headcount ──────────────────────────────────────────────────────
      const totalActive  = (await one("SELECT COUNT(*) as c FROM entities WHERE type='Employee' AND status='active'")).c;
      const presentToday = (await one("SELECT COUNT(DISTINCT user_id) as c FROM entities WHERE type='Attendance' AND data::jsonb->>'date'=$1 AND data::jsonb->>'check_in_time' IS NOT NULL", [today])).c;
      const absentToday  = Math.max(0, totalActive - presentToday);
      const newJoineesThisMonth = (await one("SELECT COUNT(*) as c FROM entities WHERE type='Employee' AND data::jsonb->>'date_of_joining' >= $1", [monthStart])).c;
      const exitedLast12m = (await one("SELECT COUNT(*) as c FROM entities WHERE type='Exit' AND data::jsonb->>'last_working_date' >= $1", [yr12Ago])).c;
      const attritionRate = totalActive > 0 ? parseFloat(((exitedLast12m / totalActive) * 100).toFixed(1)) : 0;

      // ── Leave ───────────────────────────────────────────────────────────────
      const pendingLeaveRequests = (await one("SELECT COUNT(*) as c FROM entities WHERE type='Leave' AND status='pending'")).c;
      const activeLeaves         = (await one("SELECT COUNT(*) as c FROM entities WHERE type='Leave' AND status='approved' AND data::jsonb->>'start_date' <= $1 AND data::jsonb->>'end_date' >= $2", [today, today])).c;

      // ── Payroll ─────────────────────────────────────────────────────────────
      const payrollRows      = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll' AND data::jsonb->>'year'=$1 AND data::jsonb->>'month'=$2", [now.getFullYear(), now.getMonth()+1]));
      const totalPayrollCost = payrollRows.reduce((s, r) => s + (r.net_salary || 0), 0);

      // ── Recruitment ─────────────────────────────────────────────────────────
      const allCandidates = parseEntities(await all("SELECT data FROM entities WHERE type='Candidate'"));
      const recruitment = {
        totalCandidates: allCandidates.length,
        hired:      allCandidates.filter(c => ['hired','joined'].includes(c.status)).length,
        inPipeline: allCandidates.filter(c => ['applied','screening','interview_scheduled','interview_done','selected'].includes(c.status)).length,
        rejected:   allCandidates.filter(c => c.status === 'rejected').length,
        offered:    allCandidates.filter(c => c.status === 'offered').length,
        hiringBySource: Object.entries(allCandidates.reduce((acc, c) => { const src = c.source || 'Direct'; acc[src] = (acc[src]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count })),
      };

      // ── Reimbursements ──────────────────────────────────────────────────────
      const allReimb = parseEntities(await all("SELECT data FROM entities WHERE type='Reimbursement'"));
      const reimbursements = {
        total:   allReimb.reduce((s, r) => s + (r.amount || 0), 0),
        pending: allReimb.filter(r => r.status === 'pending').reduce((s, r) => s + (r.amount || 0), 0),
        byCategory: Object.entries(allReimb.reduce((acc, r) => { const t = r.expense_type || 'Other'; acc[t] = (acc[t]||0)+(r.amount||0); return acc; }, {})).map(([name, amount]) => ({ name, amount })),
      };

      // ── Helpdesk ────────────────────────────────────────────────────────────
      const allTickets = parseEntities(await all("SELECT data FROM entities WHERE type='Ticket'"));
      const tickets = {
        openTickets:     allTickets.filter(t => t.status === 'open').length,
        resolvedTickets: allTickets.filter(t => ['resolved','closed'].includes(t.status)).length,
        byCategory: Object.entries(allTickets.reduce((acc, t) => { const c = t.category||'General'; acc[c]=(acc[c]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count })),
      };

      // ── Assets ──────────────────────────────────────────────────────────────
      const allAssets = parseEntities(await all("SELECT data FROM entities WHERE type='Asset'"));
      const assets = {
        total:        allAssets.length,
        assigned:     allAssets.filter(a => a.status === 'assigned').length,
        available:    allAssets.filter(a => ['available','in_stock'].includes(a.status)).length,
        underRepair:  allAssets.filter(a => ['under_repair','repair'].includes(a.status)).length,
        discarded:    allAssets.filter(a => ['discarded','retired'].includes(a.status)).length,
        commonAssets: allAssets.filter(a => a.is_common || a.assignment_type === 'shared').length,
        overdueReturns: allAssets.filter(a => a.expected_return_date && a.expected_return_date < today && a.status === 'assigned').length,
        totalValue:   allAssets.reduce((s, a) => s + (a.purchase_cost || 0), 0),
        byType: Object.entries(allAssets.reduce((acc, a) => { const t = a.asset_type||a.category||'Other'; acc[t]=(acc[t]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count })),
      };

      // ── Exits ───────────────────────────────────────────────────────────────
      const allExits = parseEntities(await all("SELECT data FROM entities WHERE type='Exit'"));
      const exits = {
        total:     allExits.length,
        pending:   allExits.filter(e => !['completed','fnf_done'].includes(e.status)).length,
        completed: allExits.filter(e => ['completed','fnf_done'].includes(e.status)).length,
        byType: Object.entries(allExits.reduce((acc, e) => { const t = e.exit_type||'Unknown'; acc[t]=(acc[t]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count })),
      };

      // ── Attendance trends (last 7 days) ─────────────────────────────────────
      const attendanceTrends = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const present = (await one("SELECT COUNT(DISTINCT user_id) as c FROM entities WHERE type='Attendance' AND data::jsonb->>'date'=$1 AND data::jsonb->>'check_in_time' IS NOT NULL", [dateStr])).c;
        attendanceTrends.push({ date: dateStr, day: d.toLocaleDateString('en-IN',{weekday:'short'}), present, absent: Math.max(0, totalActive - present) });
      }

      // ── Department breakdown ────────────────────────────────────────────────
      const allEmps = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      const departmentBreakdown = Object.entries(allEmps.reduce((acc, e) => { const d = e.department||'Unknown'; acc[d]=(acc[d]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count }));

      // ── Biometric / attendance stats ────────────────────────────────────────
      const attLogs      = parseEntities(await all("SELECT data FROM entities WHERE type='AttendanceLog' AND data::jsonb->>'punch_date' >= $1", [monthStart]));
      const attThisMonth = parseEntities(await all("SELECT data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1", [monthStart]));
      const workedRecs   = attThisMonth.filter(a => a.working_hours > 0);
      const avgWorkingHours   = workedRecs.length > 0 ? parseFloat((workedRecs.reduce((s,a)=>s+(a.working_hours||0),0)/workedRecs.length).toFixed(1)) : 0;
      const biometricSyncedCount = attLogs.length;
      const avgDailyPunches      = biometricSyncedCount > 0 && totalActive > 0 ? parseFloat((biometricSyncedCount / totalActive / 20).toFixed(1)) : 0;

      // ── Performance rating distribution ─────────────────────────────────────
      const allReviews = parseEntities(await all("SELECT data FROM entities WHERE type='PerformanceReview'"));
      const ratingDist = Object.entries(allReviews.reduce((acc, r) => { const rt = r.rating||'Pending'; acc[rt]=(acc[rt]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count }));

      // ── Metrics (camelCase — consumed by MetricCard via m.xxx) ──────────────
      const metrics = {
        totalActive, presentToday, absentToday, activeLeaves,
        pendingLeaveRequests, totalPayrollCost, attritionRate,
        openTickets: tickets.openTickets, newJoineesThisMonth,
        biometricSyncedCount, avgWorkingHours, avgBreakHours: 0, avgDailyPunches,
      };

      return res.json({
        metrics, recruitment, reimbursements, tickets, assets, exits,
        attendanceTrends, departmentBreakdown, ratingDist,
        insights: [], leaveTrend: [], headcountGrowth: [], attritionTrend: [], payrollTrend: [],
        salarByDept: (() => {
          const empDeptMap = {};
          allEmps.forEach(e => { if (e.user_id) empDeptMap[e.user_id] = e.department || 'Unknown'; });
          const deptSalary = {};
          payrollRows.forEach(pr => {
            const dept = empDeptMap[pr.user_id] || 'Unknown';
            deptSalary[dept] = (deptSalary[dept] || 0) + (pr.net_salary || 0);
          });
          return Object.entries(deptSalary).map(([name, amount]) => ({ name, amount })).sort((a,b) => b.amount - a.amount);
        })(),
      });
    }

    case 'getMISInsights': {
      const { metrics = {}, context = {} } = p;
      const { callAI } = await import('../utils/ai.js');

      const prompt = `You are an HR analytics expert. Analyze the following HRMS metrics and provide 6-8 actionable insights for the HR team.

METRICS:
- Total Active Employees: ${metrics.totalActive ?? 'N/A'}
- Present Today: ${metrics.presentToday ?? 'N/A'} (Absent: ${metrics.absentToday ?? 'N/A'})
- Attendance Rate: ${metrics.totalActive ? (((metrics.presentToday || 0) / metrics.totalActive) * 100).toFixed(1) : 'N/A'}%
- Attrition Rate (annualized): ${metrics.attritionRate ?? 'N/A'}%
- Monthly Payroll Cost: ₹${(metrics.totalPayrollCost || 0).toLocaleString('en-IN')}
- Pending Leave Requests: ${metrics.pendingLeaveRequests ?? 'N/A'}
- Active Leaves Today: ${metrics.activeLeaves ?? 'N/A'}
- Open Helpdesk Tickets: ${metrics.openTickets ?? 'N/A'}

ADDITIONAL CONTEXT:
- Exits in notice period: ${context.exits?.inNotice ?? 0}
- Exits pending clearance: ${context.exits?.clearancePending ?? 0}
- F&F pending: ${context.exits?.fnfPending ?? 0}
- Candidates in pipeline: ${context.recruitment?.inPipeline ?? 0}
- Hired (all time): ${context.recruitment?.hired ?? 0}
- Compliance overdue deadlines: ${context.compliance?.overdueDeadlines ?? 0}
- KYC missing employees: ${context.compliance?.kycMissing ?? 0}
- Asset overdue returns: ${context.assets?.overdueReturns ?? 0}
- Assets under repair: ${context.assets?.underRepair ?? 0}
- Open helpdesk tickets: ${context.tickets?.openTickets ?? 0}

Respond with a JSON object containing an "insights" array. Each insight must have:
- "type": one of "positive", "warning", "critical", "info"
- "title": short title (5-8 words)
- "detail": one sentence explaining the finding
- "action": one sentence recommended action (what HR should do)

Focus on actionable, specific insights. Flag critical issues first, then warnings, then positives and info.`;

      try {
        const result = await callAI(prompt, { json: true });
        const insights = result?.insights || [];
        return res.json({ success: true, insights });
      } catch (e) {
        return res.json({ success: false, error: e.message, insights: [] });
      }
    }

    case 'getTeamCalendar': {
      const { month, year, manager_id } = p;
      const m = parseInt(month) || new Date().getMonth() + 1;
      const y = parseInt(year)  || new Date().getFullYear();
      const monthStart = `${y}-${String(m).padStart(2,'0')}-01`;
      const monthEnd   = new Date(y, m, 0).toISOString().slice(0, 10); // last day of month

      // Employees list — filter to manager's team when manager_id provided
      let allEmps = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      if (manager_id) allEmps = allEmps.filter(e => e.reporting_manager_id === manager_id);
      const employees = allEmps.map(e => ({ user_id: e.user_id, display_name: e.display_name, department: e.department, employee_code: e.employee_code }));

      // Approved leaves for the month
      const leaves = {};
      const leaveRows = parseEntities(await all("SELECT data FROM entities WHERE type='Leave' AND status='approved'"))
        .filter(l => l.end_date >= monthStart && l.start_date <= monthEnd);
      for (const lv of leaveRows) {
        if (!leaves[lv.user_id]) leaves[lv.user_id] = {};
        // Mark each day of the leave
        const start = new Date(Math.max(new Date(lv.start_date), new Date(monthStart)));
        const end   = new Date(Math.min(new Date(lv.end_date),   new Date(monthEnd)));
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          leaves[lv.user_id][d.toISOString().slice(0,10)] = 'leave';
        }
      }

      // Attendance records for the month
      const attendance = {};
      const attRows = parseEntities(await all("SELECT data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2", [monthStart, monthEnd]));
      for (const att of attRows) {
        if (!attendance[att.user_id]) attendance[att.user_id] = {};
        attendance[att.user_id][att.date] = att.status || (att.check_in_time ? 'present' : 'absent');
      }

      // Holidays
      const holidays = parseEntities(await all("SELECT data FROM entities WHERE type='Holiday'"))
        .filter(h => h.date >= monthStart && h.date <= monthEnd)
        .map(h => ({ date: h.date, name: h.name, type: h.holiday_type || 'public' }));

      return res.json({ success: true, data: { employees, holidays, attendance, leaves } });
    }

    /* ── Onboarding ──────────────────────────────────── */
    case 'approveUserOnboarding': {
      // Accept both userId (frontend) and user_id (legacy)
      const uid = p.user_id || p.userId;
      const role = p.custom_role || p.newUserRole || 'employee';
      const employeeData = p.employeeData || {};
      if (!uid) return res.status(400).json({ error: 'user_id required' });

      await run("UPDATE users SET role=$1,custom_role=$2 WHERE id=$3", [role, role, uid]);

      const eRow = await one("SELECT id,data FROM entities WHERE type='Employee' AND user_id=$1", [uid]);
      if (eRow) {
        const d = { ...JSON.parse(eRow.data), ...employeeData, status:'active' };
        await run("UPDATE entities SET data=$1,status='active' WHERE id=$2", [JSON.stringify(d), eRow.id]);
      } else {
        const empId = uuidv4();
        const d = { id:empId, user_id:uid, ...employeeData, status:'active' };
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Employee',$2,'active',$3)", [empId, uid, JSON.stringify(d)]);
      }

      // Send approval email + create new-joiner announcement
      try {
        const uRow = await one("SELECT email,full_name FROM users WHERE id=$1", [uid]);
        if (uRow?.email) {
          const tpl = emailTemplates.onboardingApprovedEmail({
            name: uRow.full_name,
            role,
            department: employeeData.department || ''
          });
          sendEmail({ to: uRow.email, ...tpl }).catch(e =>
            console.error('[email] Onboarding approval email failed:', e.message)
          );
        }
        // Create new-joiner announcement visible to all employees
        if (uid) {
          const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [uid]);
          const empData = empRow ? JSON.parse(empRow.data) : {};
          const njAnnId = uuidv4();
          const empName = empData.display_name || uRow?.full_name || employeeData.display_name || 'New Team Member';
          await run(
            "INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Announcement',$2,'active',$3)",
            [njAnnId, uid, JSON.stringify({
              id: njAnnId,
              title: `Welcome ${empName}!`,
              content: `Please join us in welcoming ${empName} to the ${empData.department || employeeData.department || 'team'} as ${empData.designation || employeeData.designation || 'a new team member'}. We look forward to working together!`,
              category: 'new_joiner',
              status: 'published',
              target_audience: 'all',
              display_name: empName,
              department: empData.department || employeeData.department,
              designation: empData.designation || employeeData.designation,
              date_of_joining: empData.date_of_joining || employeeData.date_of_joining,
              profile_picture_url: empData.profile_picture_url || null,
              created_date: new Date().toISOString(),
            })]
          );
        }
      } catch(e) { console.error('[email/ann] Onboarding approval error:', e.message); }

      return res.json({ success:true });
    }

    case 'rejectUserOnboarding': {
      const uid = p.user_id || p.userId;
      const reason = p.reason || '';
      if (!uid) return res.status(400).json({ error: 'user_id required' });

      const eRow = await one("SELECT id,data FROM entities WHERE type='Employee' AND user_id=$1", [uid]);
      if (eRow) {
        const d = { ...JSON.parse(eRow.data), onboarding_submitted:false, onboarding_rejection_reason:reason };
        await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(d), eRow.id]);
      }

      try {
        const uRow = await one("SELECT email,full_name FROM users WHERE id=$1", [uid]);
        if (uRow?.email) {
          const tpl = emailTemplates.onboardingRejectedEmail({ name: uRow.full_name, reason });
          sendEmail({ to: uRow.email, ...tpl }).catch(e =>
            console.error('[email] Onboarding rejection email failed:', e.message)
          );
        }
      } catch(e) { console.error('[email] Onboarding rejection email error:', e.message); }

      return res.json({ success:true });
    }

    case 'handleNewUserSignup': case 'autoCreateEmployee': {
      const { user_id, email, full_name } = p;
      if (!user_id) return res.json({ success: true });
      const existingEmp = await one("SELECT id FROM entities WHERE type='Employee' AND user_id=$1", [user_id]);
      if (!existingEmp) {
        const empId = uuidv4();
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Employee',$2,'pending',$3)", [empId, user_id, JSON.stringify({ id: empId, user_id, display_name: full_name, email, employee_status: 'pending_onboarding', created_at: new Date().toISOString() })]);
      }
      try {
        const smtpCfg = await one("SELECT value FROM settings WHERE key='smtp_config'");
        if (smtpCfg?.value) {
          const smtp = JSON.parse(smtpCfg.value);
          if (smtp.host && smtp.user) {
            const { default: nodemailer } = await import('nodemailer');
            const t = nodemailer.createTransporter({ host: smtp.host, port: smtp.port||587, secure: smtp.port==465, auth: { user: smtp.user, pass: smtp.pass } });
            await t.sendMail({ from: smtp.from||smtp.user, to: email, subject: 'Welcome to MaxVolt Energy HRMS',
              html: `<div style="font-family:Arial,sans-serif;max-width:600px"><h2 style="color:#2563eb">Welcome, ${full_name}!</h2><p>Your account has been created on the MaxVolt Energy HR Management System.</p><p>Please complete your onboarding form. Your HR team will review and activate your account.</p></div>` });
          }
        }
      } catch(e) { console.error('[welcome-email]', e.message); }
      return res.json({ success: true, message: 'Employee record initialized' });
    }

    /* ── Employee import ─────────────────────────────── */
    case 'extractFileData': {
      // Generic CSV extractor — reads uploaded file and maps columns to schema output
      const { file_url, json_schema } = p;
      if (!file_url) return res.json({ output: [] });
      try {
        const uploadsDir = process.env.NODE_ENV === 'production' ? '/app/uploads' : './backend/uploads';
        const filename   = file_url.startsWith('/uploads/') ? file_url.slice(9) : file_url.split('/').pop();
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const csvText = readFileSync(join(uploadsDir, filename), 'utf8');
        const lines   = csvText.trim().split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return res.json({ output: [] });

        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,'').toLowerCase().replace(/\s+/g,'_').replace(/-/g,'_'));
        const output  = lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g,''));
          const obj  = {};
          headers.forEach((h, i) => { if (vals[i] !== undefined) obj[h] = vals[i]; });
          return obj;
        });
        return res.json({ output });
      } catch(e) {
        return res.json({ output: [], error: e.message });
      }
    }

    case 'generateEmployeeTemplate': {
      const csv = [
        'full_name,email,employee_code,department,designation,mobile,date_of_joining,date_of_birth,gender,ctc',
        'John Doe,john.doe@company.com,EMP001,Engineering,Software Engineer,9876543210,2024-01-15,1995-06-20,Male,600000',
        'Jane Smith,jane.smith@company.com,EMP002,HR,HR Executive,9876543211,2024-02-01,1997-03-10,Female,480000',
      ].join('\n');

      const { writeFileSync, mkdirSync, existsSync } = await import('fs');
      const uploadsDir = process.env.NODE_ENV === 'production' ? '/app/uploads' : './backend/uploads';
      if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
      writeFileSync(`${uploadsDir}/employee_import_template.csv`, csv);
      return res.json({ success:true, file_url:'/uploads/employee_import_template.csv', csv });
    }

    case 'importEmployeeData': {
      const { fileUrl, mode = 'validate' } = p;
      if (!fileUrl) return res.json({ success: false, error: 'fileUrl is required' });

      // Fetch file buffer from storage (R2 or DB)
      let fileBuffer;
      try {
        const fileId = String(fileUrl).match(/\/api\/upload\/file\/([^.]+)/)?.[1];
        if (!fileId) throw new Error('Cannot parse file ID from URL');
        const fileRow = await one("SELECT data, storage, r2_key FROM files WHERE id=$1", [fileId]);
        if (!fileRow) throw new Error('File not found in storage');
        if (fileRow.storage === 'r2' && fileRow.r2_key) {
          const { presignGet } = await import('../utils/r2.js');
          const signedUrl = await presignGet(fileRow.r2_key, { expiresIn: 300 });
          const resp = await fetch(signedUrl);
          fileBuffer = Buffer.from(await resp.arrayBuffer());
        } else {
          fileBuffer = Buffer.from(fileRow.data);
        }
      } catch (e) {
        return res.json({ success: false, error: `Failed to fetch file: ${e.message}` });
      }

      // Parse XLSX workbook
      const XLSX = await import('xlsx');
      let wb;
      try {
        wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
      } catch (e) {
        return res.json({ success: false, error: `Failed to parse Excel file: ${e.message}` });
      }

      // Normalise header key: remove trailing *, replace spaces/dots with _, lowercase
      const normKey = (k) => String(k).trim().replace(/\*$/, '').replace(/[\s.]+/g, '_').toLowerCase();

      // Parse sheet → array of objects with normalised keys.
      // Uses raw:true so Date objects come through intact (cellDates:true was set on workbook load).
      // Matches sheet names case-insensitively and ignores spaces/underscores/parentheses for flexibility.
      const parseSheet = (sheetName) => {
        let ws = wb.Sheets[sheetName];
        if (!ws) {
          const normTarget = sheetName.replace(/[\s_()\-]+/g, '').toLowerCase();
          const match = wb.SheetNames.find(n => n.replace(/[\s_()\-]+/g, '').toLowerCase() === normTarget);
          if (match) ws = wb.Sheets[match];
        }
        if (!ws) return [];
        return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true }).map(row => {
          const out = {};
          for (const [k, v] of Object.entries(row)) {
            if (v instanceof Date) {
              // Date object from cellDates:true — convert to YYYY-MM-DD immediately
              out[normKey(k)] = isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
            } else {
              out[normKey(k)] = (v === null || v === undefined) ? '' : String(v).trim();
            }
          }
          return out;
        });
      };

      // Strip ".0" suffix from numeric IDs stored as floats by Excel
      const cleanInt = (v) => { const s = String(v || '').trim(); return s.endsWith('.0') ? s.slice(0,-2) : s; };

      // Parse multiple date formats → YYYY-MM-DD
      const parseDate = (v) => {
        if (!v || v === '') return '';
        if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
        const s = String(v).trim();
        if (!s || s === 'Invalid Date') return '';
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);           // ISO YYYY-MM-DD
        if (/^\d{1,2}-[A-Za-z]+-\d{4}/.test(s)) {                          // "09-May-2019"
          const d = new Date(s); return isNaN(d) ? '' : d.toISOString().slice(0,10);
        }
        const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);     // DD/MM/YYYY or MM/DD/YYYY
        if (slashMatch) {
          const [, a, b, yr] = slashMatch;
          // Prefer DD/MM/YYYY (Indian standard); if day > 12 it must be day first
          const day = parseInt(a) > 12 ? a : a;  // treat first number as day
          const mon = parseInt(a) > 12 ? b : b;
          const iso = `${yr}-${mon.padStart(2,'0')}-${day.padStart(2,'0')}`;
          const d = new Date(iso); return isNaN(d) ? '' : iso;
        }
        // Excel numeric serial number (days since 1899-12-30)
        if (/^\d+(\.\d+)?$/.test(s)) {
          const n = parseFloat(s);
          if (n > 10000 && n < 100000) {
            const epoch = new Date(Date.UTC(1899, 11, 30));
            epoch.setUTCDate(epoch.getUTCDate() + Math.floor(n));
            return epoch.toISOString().slice(0, 10);
          }
        }
        const d = new Date(s);
        return isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10);
      };

      const profiles  = parseSheet('Employee_Profile');
      const salaries  = parseSheet('Salary_Structure (2)');
      const statutory = parseSheet('Statutory_Info');
      const bankSheet = parseSheet('Bank_Details');
      const leaveCL   = parseSheet('Leave_Balances');
      const leaveEL   = parseSheet('Leave_Balances (2)');

      if (!profiles.length) return res.json({ success: false, error: 'Employee_Profile sheet is empty or missing' });

      // ── Lookup maps ────────────────────────────────────────────────────────
      // Salary_Structure keyed by EMPLOYEE ID (= employee_code, e.g. MVE00002)
      const salByCode = {};
      const salByName = {};
      for (const r of salaries) {
        const code = String(r['employee_id'] || r['employee_code'] || r['emp_id'] || r['emp_code'] || '').trim().toUpperCase();
        const name = String(r['employee_name'] || r['full_name'] || r['name'] || '').trim().toLowerCase();
        if (code) salByCode[code] = r;
        if (name) salByName[name] = r;
      }

      // Statutory_Info keyed by personal_email
      const statByEmail = {};
      for (const r of statutory)
        statByEmail[String(r['personal_email'] || '').toLowerCase()] = r;

      // Bank_Details keyed by employee_code (most reliable key)
      const bankByCode = {};
      // Also build code → work-email map: the "personal_email" column in Bank_Details
      // actually contains work/company emails (e.g. vishal@maxvoltenergy.com).
      // Leave_Balances are keyed by those same work emails, so we use this to cross-link.
      const codeToWorkEmail = {};
      for (const r of bankSheet) {
        const code = String(r['employee_code'] || '').trim().toUpperCase();
        const wem  = String(r['personal_email'] || '').toLowerCase();
        if (code) { bankByCode[code] = r; if (wem) codeToWorkEmail[code] = wem; }
      }

      // Leave balances keyed by email (work or personal)
      const leaveByEmail = {};
      for (const r of [...leaveCL, ...leaveEL]) {
        const em = String(r['personal_email'] || '').toLowerCase();
        if (!leaveByEmail[em]) leaveByEmail[em] = [];
        leaveByEmail[em].push(r);
      }

      const DEFAULT_PASSWORD = 'Maxvolt@1234';
      const errors = [], warnings = [];

      // ── Validate all profiles ──────────────────────────────────────────────
      const validated = profiles.map((row, idx) => {
        const rowNum = idx + 2;
        const email  = String(row['personal_email'] || '').toLowerCase().trim();
        const name   = String(row['full_name'] || '').trim();
        const code   = String(row['employee_code'] || '').trim().toUpperCase();

        if (!email) errors.push({ row: rowNum, field: 'personal_email', message: `Row ${rowNum}: Email is missing` });
        if (!name)  errors.push({ row: rowNum, field: 'full_name',      message: `Row ${rowNum}: Name is missing` });
        if (!code)  errors.push({ row: rowNum, field: 'employee_code',  message: `Row ${rowNum}: Employee code is missing` });

        const sal  = salByCode[code] || salByName[name.toLowerCase()] || null;
        const stat = statByEmail[email] || null;
        const bank = bankByCode[code] || null;
        // Leave_Balances use work email; fall back to personal email
        const workEmail = codeToWorkEmail[code] || '';
        const leave = leaveByEmail[workEmail] || leaveByEmail[email] || [];

        if (!sal)        warnings.push({ row: rowNum, message: `${name} (${code}): No salary data — payroll needs manual entry` });
        if (!bank && !sal?.bank_account) warnings.push({ row: rowNum, message: `${name} (${code}): No bank details found` });
        if (!leave.length) warnings.push({ row: rowNum, message: `${name} (${code}): No leave balances found` });

        return {
          rowNum, email, name, code,
          department:              row['department']               || '',
          designation:             row['designation']              || '',
          designation_tier:        row['designation_tier']         || '',
          employee_status:         row['employee_status'] || row['status'] || 'active',
          work_location:           row['work_location']            || '',
          date_of_joining:         parseDate(row['date_of_joining']),
          confirmation_date:       parseDate(row['employee_confirmation_date']),
          date_of_birth:           parseDate(row['date_of_birth']),
          gender:                  row['gender']                   || '',
          phone:                   cleanInt(row['phone'])          || '',
          blood_group:             row['blood_group']              || '',
          employment_type:         row['employment_type']          || 'full_time',
          father_spouse_name:      row['father_spouse_name']       || '',
          reporting_manager_email: row['reporting_manager_email']  || '',
          address:                 row['address']                  || '',
          is_attendance_exempt: row['is_attendance_exempt'] === 'True' || row['is_attendance_exempt'] === 'true',
          sal, stat, bank, leave,
          valid: !errors.find(e => e.row === rowNum),
        };
      });

      if (mode === 'validate') {
        return res.json({
          success: true,
          total_employees: profiles.length,
          salary_structure: salaries,
          leave_balances: [...leaveCL, ...leaveEL],
          insurance_policies: [],
          errors, warnings,
          employees: validated.slice(0, 20).map(r => ({
            name: r.name, code: r.code, email: r.email,
            department: r.department, designation: r.designation,
            date_of_joining: r.date_of_joining,
            has_salary: !!r.sal, has_bank: !!(r.bank || r.sal?.bank_account),
            has_statutory: !!(r.stat || r.sal?.pan), leave_records: r.leave.length,
          })),
        });
      }

      // ── Import mode — bulk optimised (O(10) DB calls total, not O(N×10)) ──
      const results = [];
      const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
      const toNum = (v) => { const n = parseFloat(String(v || '0').replace(/,/g, '')); return isNaN(n) ? 0 : n; };
      const now = new Date().toISOString();

      // Phase 1: bulk pre-load existing users
      const allEmails = validated.filter(v => v.valid).map(v => v.email.toLowerCase());
      const existingUserRows = allEmails.length
        ? await all("SELECT id, email, role FROM users WHERE LOWER(email) = ANY($1)", [allEmails])
        : [];
      const existingUserMap = Object.fromEntries(existingUserRows.map(u => [u.email.toLowerCase(), u]));

      // Phase 2: resolve/generate userId for each valid row
      const userIdMap = {}; // email → userId
      const newUserRows = []; // [id, email, hash, name]
      for (const row of validated) {
        if (!row.valid) { results.push({ name: row.name, code: row.code, status: 'skipped', reason: 'Validation error' }); continue; }
        const existing = existingUserMap[row.email.toLowerCase()];
        if (existing) {
          userIdMap[row.email] = existing.id;
        } else {
          const uid = uuidv4();
          userIdMap[row.email] = uid;
          newUserRows.push([uid, row.email, hash, row.name]);
        }
      }

      // Bulk INSERT new users (100 rows per batch — 4 cols × 100 = 400 params)
      const USER_BATCH = 100;
      for (let i = 0; i < newUserRows.length; i += USER_BATCH) {
        const batch = newUserRows.slice(i, i + USER_BATCH);
        const ph = batch.map((_, ri) => `($${ri*4+1},$${ri*4+2},$${ri*4+3},$${ri*4+4},'employee','employee',TRUE)`).join(',');
        await run(`INSERT INTO users(id,email,password,full_name,role,custom_role,must_change_password) VALUES ${ph} ON CONFLICT(email) DO NOTHING`, batch.flat());
      }

      // Phase 3: bulk load all existing entity data for these users (4 queries in parallel)
      const allUserIds = Object.values(userIdMap).filter(Boolean);
      const [existingEmpRows, existingSalRows, existingBankRows, existingLeaveRows] = allUserIds.length
        ? await Promise.all([
            all("SELECT user_id, id, data FROM entities WHERE type='Employee' AND user_id = ANY($1)", [allUserIds]),
            all("SELECT user_id FROM entities WHERE type='SalaryStructure' AND user_id = ANY($1) AND status='active'", [allUserIds]),
            all("SELECT user_id FROM entities WHERE type='BankDetails' AND user_id = ANY($1)", [allUserIds]),
            all("SELECT user_id, data FROM entities WHERE type='LeaveBalance' AND user_id = ANY($1)", [allUserIds]),
          ])
        : [[], [], [], []];

      const existingEmpMap  = Object.fromEntries(existingEmpRows.map(e => [e.user_id, { id: e.id, data: JSON.parse(e.data) }]));
      const existingSalSet  = new Set(existingSalRows.map(r => r.user_id));
      const existingBankSet = new Set(existingBankRows.map(r => r.user_id));
      const existingLeaveSet = new Set(existingLeaveRows.map(r => {
        try { const d = JSON.parse(r.data); return `${r.user_id}:${d.leave_policy_code}:${d.year}`; } catch { return ''; }
      }));

      // Phase 4: compute all inserts/updates in-memory (zero DB calls)
      const empInserts   = []; // [id, userId, dataJson]
      const empUpdates   = []; // [dataJson, entityId]
      const salInserts   = []; // [id, userId, dataJson]
      const bankInserts  = []; // [id, userId, dataJson]
      const leaveInserts = []; // [id, userId, dataJson]

      for (const row of validated) {
        if (!row.valid) continue;
        const userId = userIdMap[row.email];
        if (!userId) continue;
        const isNewUser = !existingUserMap[row.email.toLowerCase()];

        const sal  = row.sal  || {};
        const stat = row.stat || {};
        const panNumber    = stat['pan_number']        || sal['pan']        || '';
        const aadharNumber = stat['aadhar_number']     || '';
        const uanNumber    = cleanInt(stat['uan_number']    || sal['uan']        || '');
        const pfNumber     = stat['pf_account_number'] || sal['pf_number']  || '';
        const esiNumber    = cleanInt(stat['esi_number']    || sal['esi_number'] || '');

        // Employee entity
        const existingEmp = existingEmpMap[userId];
        let empId;
        if (existingEmp) {
          empId = existingEmp.id;
          const ex = existingEmp.data;
          empUpdates.push([JSON.stringify({
            ...ex,
            employee_code: row.code || ex.employee_code,
            full_name: row.name || ex.full_name, display_name: row.name || ex.display_name,
            department: row.department || ex.department,
            designation: row.designation || ex.designation,
            designation_tier: row.designation_tier || ex.designation_tier,
            employee_status: row.employee_status || ex.employee_status,
            work_location: row.work_location || ex.work_location,
            date_of_joining: row.date_of_joining || ex.date_of_joining,
            date_of_birth: row.date_of_birth || ex.date_of_birth,
            confirmation_date: row.confirmation_date || ex.confirmation_date,
            gender: row.gender || ex.gender, phone: row.phone || ex.phone,
            blood_group: row.blood_group || ex.blood_group,
            employment_type: row.employment_type || ex.employment_type,
            father_spouse_name: row.father_spouse_name || ex.father_spouse_name,
            reporting_manager_email: row.reporting_manager_email || ex.reporting_manager_email,
            address: row.address || ex.address,
            is_attendance_exempt: row.is_attendance_exempt,
            pan_number: panNumber || ex.pan_number, aadhar_number: aadharNumber || ex.aadhar_number,
            uan_number: uanNumber || ex.uan_number, pf_account_number: pfNumber || ex.pf_account_number,
            esi_number: esiNumber || ex.esi_number,
          }), empId]);
        } else {
          empId = uuidv4();
          empInserts.push([empId, userId, JSON.stringify({
            id: empId, user_id: userId,
            employee_code: row.code, full_name: row.name, display_name: row.name,
            department: row.department, designation: row.designation,
            designation_tier: row.designation_tier, employee_status: row.employee_status,
            work_location: row.work_location, date_of_joining: row.date_of_joining,
            date_of_birth: row.date_of_birth, confirmation_date: row.confirmation_date,
            gender: row.gender, phone: row.phone, blood_group: row.blood_group,
            employment_type: row.employment_type, father_spouse_name: row.father_spouse_name,
            reporting_manager_email: row.reporting_manager_email, address: row.address,
            is_attendance_exempt: row.is_attendance_exempt,
            pan_number: panNumber, aadhar_number: aadharNumber,
            uan_number: uanNumber, pf_account_number: pfNumber, esi_number: esiNumber,
            status: 'active', created_at: now,
          })]);
        }

        // Salary structure
        if (row.sal && !existingSalSet.has(userId)) {
          const s = row.sal;
          const salId = uuidv4();
          const effectiveFrom = row.date_of_joining || parseDate(s['joining_date']) || now.slice(0, 10);
          salInserts.push([salId, userId, JSON.stringify({
            id: salId, user_id: userId, employee_id: empId, employee_code: row.code,
            employee_name: row.name, effective_from: effectiveFrom,
            basic_monthly:        toNum(s['basic_salary']),
            hra_monthly:          toNum(s['hra']),
            conveyance_monthly:   toNum(s['conveyance']),
            car_fuel_maintenance: toNum(s['car_fuel_maintenance']),
            health_and_wellness:  toNum(s['health_and_wellness']),
            hard_furnishing:      toNum(s['hard_furnishing']),
            pf_employee:          toNum(s['provident_fund']),
            medical_insurance:    toNum(s['medical_insurance']),
            admin_charge:         toNum(s['admin_charge']),
            vpp_deduction:        toNum(s['vpp_deduction']),
            ctc_bonus:            toNum(s['ctc_bonus']),
            esi_employer:         toNum(s['esi_employer']),
            nps_employee:         toNum(s['nps_employee']),
            car_lease:            toNum(s['car_lease']),
            total_ctc:            toNum(s['totalctc']),
            status: 'active', created_at: now,
          })]);
        }

        // Bank details
        const bk = row.bank || {};
        const accountNum = cleanInt(bk['account_number'] || sal['bank_account'] || '');
        const ifscCode   = bk['ifsc_code']  || sal['ifsc_code'] || '';
        const bankName   = bk['bank_name']  || sal['bank']      || '';
        const branchName = bk['branch']     || '';
        if (accountNum && ifscCode && !existingBankSet.has(userId)) {
          const bankId = uuidv4();
          bankInserts.push([bankId, userId, JSON.stringify({
            id: bankId, user_id: userId, employee_id: empId,
            account_number: accountNum, ifsc_code: ifscCode,
            bank_name: bankName, branch: branchName,
            account_type: 'savings', is_primary: true, created_at: now,
          })]);
        }

        // Leave balances
        for (const lb of row.leave) {
          const policy = lb['leave_policy_code'] || '';
          const year   = cleanInt(lb['year'] || String(new Date().getFullYear()));
          if (!policy) continue;
          const leaveKey = `${userId}:${policy}:${year}`;
          if (existingLeaveSet.has(leaveKey)) continue;
          existingLeaveSet.add(leaveKey); // prevent duplicates within the same import
          const lbId = uuidv4();
          leaveInserts.push([lbId, userId, JSON.stringify({
            id: lbId, user_id: userId, employee_id: empId,
            leave_policy_code: policy, year,
            total_allocated:    parseFloat(lb['total_allocated'])   || 0,
            accrued_this_year:  parseFloat(lb['accrued_this_year']) || 0,
            used:               parseFloat(lb['used'])              || 0,
            carried_forward:    parseFloat(lb['carried_forward'])   || 0,
            last_accrual_month: cleanInt(lb['last_accrual_month'])  || '',
            last_accrual_year:  cleanInt(lb['last_accrual_year'])   || '',
            created_at: now,
          })]);
        }

        results.push(isNewUser
          ? { name: row.name, code: row.code, status: 'created', email: row.email,
              has_salary: !!row.sal, has_bank: !!(accountNum && ifscCode), leave_records: row.leave.length }
          : { name: row.name, code: row.code, status: 'existing_user', email: row.email });
      }

      // Phase 5: bulk execute — multi-row INSERTs + parallel UPDATEs
      const ENT_BATCH  = 100; // 3 cols × 100 = 300 params, well within PG limit
      const UPDT_BATCH = 50;

      const bulkInsertEntities = async (type, rows) => {
        for (let i = 0; i < rows.length; i += ENT_BATCH) {
          const batch = rows.slice(i, i + ENT_BATCH);
          const ph = batch.map((_, ri) => `($${ri*3+1},'${type}',$${ri*3+2},'active',$${ri*3+3})`).join(',');
          await run(`INSERT INTO entities(id,type,user_id,status,data) VALUES ${ph}`, batch.flat());
        }
      };
      const bulkUpdateEntities = async (rows) => {
        for (let i = 0; i < rows.length; i += UPDT_BATCH) {
          await Promise.all(rows.slice(i, i + UPDT_BATCH).map(([data, id]) =>
            run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [data, id])
          ));
        }
      };

      await Promise.all([
        bulkInsertEntities('Employee', empInserts),
        bulkInsertEntities('SalaryStructure', salInserts),
        bulkInsertEntities('BankDetails', bankInserts),
        bulkInsertEntities('LeaveBalance', leaveInserts),
        bulkUpdateEntities(empUpdates),
      ]);

      // Phase 6: post-import — promote managers & wire reporting_manager_id (bulk)
      let managersPromoted = 0;
      const mgrEmails = [...new Set(validated.map(v => (v.reporting_manager_email || '').toLowerCase().trim()).filter(Boolean))];
      if (mgrEmails.length) {
        const mgrResults = await Promise.all(mgrEmails.map(e =>
          run("UPDATE users SET role='management', custom_role='management' WHERE LOWER(email)=$1 AND role IN ('employee','onboarding_pending')", [e])
        ));
        managersPromoted = mgrResults.reduce((s, r) => s + (r.rowCount || 0), 0);
      }

      // Wire reporting_manager_id — one query for all managers, one for all employees
      if (mgrEmails.length) {
        const mgrUserRows = await all("SELECT id, LOWER(email) AS email FROM users WHERE LOWER(email) = ANY($1)", [mgrEmails]);
        const mgrUserMap  = Object.fromEntries(mgrUserRows.map(u => [u.email, u.id]));
        const needsWiring = validated.filter(v => v.valid && v.reporting_manager_email);
        if (needsWiring.length) {
          const wireEmails = needsWiring.map(v => v.email.toLowerCase());
          const wireEmpRows = await all(
            "SELECT e.id, e.data, LOWER(u.email) AS email FROM entities e JOIN users u ON u.id=e.user_id WHERE e.type='Employee' AND LOWER(u.email) = ANY($1)",
            [wireEmails]
          );
          const needsWiringByEmail = new Map(needsWiring.map(v => [v.email.toLowerCase(), v]));
          const wireUpdates = [];
          for (const empRow of wireEmpRows) {
            const vRow = needsWiringByEmail.get(empRow.email);
            if (!vRow) continue;
            const mgrId = mgrUserMap[(vRow.reporting_manager_email || '').toLowerCase().trim()];
            if (!mgrId) continue;
            const ed = JSON.parse(empRow.data);
            if (ed.reporting_manager_id === mgrId) continue;
            wireUpdates.push([JSON.stringify({ ...ed, reporting_manager_id: mgrId }), empRow.id]);
          }
          await bulkUpdateEntities(wireUpdates);
        }
      }

      const created  = results.filter(r => r.status === 'created').length;
      const existing = results.filter(r => r.status === 'existing_user').length;
      const failed   = results.filter(r => r.status === 'error').length;
      return res.json({ success: true, created, existing, failed, total: validated.length, results,
        managers_promoted: managersPromoted,
        default_password: DEFAULT_PASSWORD,
        message: `Imported ${created} new employees (${existing} already existed, ${failed} errors). ${managersPromoted} managers auto-promoted to management role. Default password: ${DEFAULT_PASSWORD}` });
    }

    case 'updateEmployeeConfirmation': {
      const { user_id, confirmation_date } = p;
      const eRow = await one("SELECT id,data FROM entities WHERE type='Employee' AND user_id=$1", [user_id]);
      if (eRow) {
        const d = { ...JSON.parse(eRow.data), employee_status:'confirmation', confirmation_date };
        await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(d), eRow.id]);
      }
      return res.json({ success:true });
    }

    /* ── Business Cards ──────────────────────────────── */
    case 'getBusinessCard': {
      const row = await one("SELECT data FROM entities WHERE type='DigitalBusinessCard' AND user_id=$1", [p.user_id||cu?.id]);
      return res.json(row ? JSON.parse(row.data) : null);
    }

    case 'generatePrintableCards':
      return res.json({ success:true, pdf_url:null, message:'PDF generation requires additional setup' });

    /* ── Lifecycle events ────────────────────────────── */
    case 'onNewEmployeeJoined': {
      const { user_id: njUserId, employee_name, department: njDept, designation: njDesig, date_of_joining: njDoj, profile_picture_url: njPic } = p;
      if (njUserId) {
        const annId = uuidv4();
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Announcement',$2,'active',$3)", [annId, njUserId,
          JSON.stringify({
            id: annId,
            title: `Welcome ${employee_name || 'New Team Member'}!`,
            content: `Please join us in welcoming ${employee_name || 'our new colleague'} to the ${njDept||'team'} as ${njDesig||'a new team member'}. We look forward to working together!`,
            category: 'new_joiner',
            status: 'published',
            target_audience: 'all',
            display_name: employee_name,
            department: njDept,
            designation: njDesig,
            date_of_joining: njDoj,
            profile_picture_url: njPic || null,
            created_date: new Date().toISOString(),
          })]);
      }
      return res.json({ success: true });
    }

    case 'onAssetChanged': {
      const { asset_id: auditAssetId, changed_by: auditBy, change_type, old_data: oldD, new_data: newD } = p;
      const auditId = uuidv4();
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AuditLog',$2,'active',$3)", [auditId, auditBy||null,
        JSON.stringify({ id: auditId, entity_type: 'Asset', entity_id: auditAssetId, changed_by: auditBy, change_type: change_type||'update', old_data: oldD, new_data: newD, timestamp: new Date().toISOString() })]);
      return res.json({ success: true });
    }

    case 'extractFavicon':
      return res.json({ success:true });

    /* ── Audit Log ────────────────────────────────────── */
    case 'getAuditLog': {
      const { entity_type: alType, entity_id: alId, limit: alLim = 200 } = p;
      let q = "SELECT data FROM entities WHERE type='AuditLog'";
      const qp = [];
      if (alType) { q += ` AND data::jsonb->>'entity_type'=$${qp.push(alType)}`; }
      if (alId)   { q += ` AND data::jsonb->>'entity_id'=$${qp.push(alId)}`; }
      q += ` ORDER BY created_at DESC LIMIT $${qp.push(Number(alLim))}`;
      const alRows = await all(q, [...qp]);
      const alUserMap = {};
      (await all("SELECT id,full_name FROM users")).forEach(u => { alUserMap[u.id] = u.full_name; });
      const logs = alRows.map(r => { const d = JSON.parse(r.data); return { ...d, changed_by_name: alUserMap[d.changed_by] || d.changed_by }; });
      return res.json({ success: true, logs, total: logs.length });
    }

    case 'addAuditLog': {
      const { entity_type: aType, entity_id: aId, changed_by: aBy, change_type: aCt, summary: aSummary, old_data: aOld, new_data: aNew } = p;
      const aLogId = uuidv4();
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AuditLog',$2,'active',$3)", [aLogId, aBy||null,
        JSON.stringify({ id: aLogId, entity_type: aType, entity_id: aId, changed_by: aBy, change_type: aCt||'update', summary: aSummary, old_data: aOld, new_data: aNew, timestamp: new Date().toISOString() })]);
      return res.json({ success: true });
    }

    /* ── Upcoming Events (dashboard widget) ──────────── */
    case 'getUpcomingEvents': {
      const today = new Date();
      const todayMD = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const events = [];

      const ueEmpRows = await all("SELECT data FROM entities WHERE type='Employee'");
      const ueUserMap = {};
      (await all("SELECT id,full_name FROM users")).forEach(u => { ueUserMap[u.id] = u.full_name; });

      for (const row of ueEmpRows) {
        const emp = JSON.parse(row.data);
        if (!emp.user_id) continue;
        const name = ueUserMap[emp.user_id] || emp.display_name || emp.email || 'Unknown';

        // Birthday
        if (emp.date_of_birth) {
          const dob = new Date(emp.date_of_birth);
          const dobMD = `${String(dob.getMonth()+1).padStart(2,'0')}-${String(dob.getDate()).padStart(2,'0')}`;
          const diffDays = (() => { const next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate()); if (next < today) next.setFullYear(today.getFullYear()+1); return Math.ceil((next-today)/(1000*60*60*24)); })();
          if (diffDays <= 30) events.push({ type: 'birthday', label: `${name}'s Birthday`, date: `${today.getFullYear()}-${dobMD}`, days_away: diffDays, user_id: emp.user_id, department: emp.department });
        }

        // Work anniversary
        if (emp.date_of_joining) {
          const doj = new Date(emp.date_of_joining);
          const dojMD = `${String(doj.getMonth()+1).padStart(2,'0')}-${String(doj.getDate()).padStart(2,'0')}`;
          const years = today.getFullYear() - doj.getFullYear();
          const diffDays = (() => { const next = new Date(today.getFullYear(), doj.getMonth(), doj.getDate()); if (next < today) next.setFullYear(today.getFullYear()+1); return Math.ceil((next-today)/(1000*60*60*24)); })();
          if (diffDays <= 30 && years > 0) events.push({ type: 'anniversary', label: `${name}'s Work Anniversary (${years} yr${years>1?'s':''})`, date: `${today.getFullYear()}-${dojMD}`, days_away: diffDays, user_id: emp.user_id, department: emp.department });
        }

        // Probation ending
        if (emp.employee_status === 'probation') {
          const probEnd = emp.probation_end_date ? new Date(emp.probation_end_date) : (emp.date_of_joining ? new Date(new Date(emp.date_of_joining).getTime() + 90*24*60*60*1000) : null);
          if (probEnd) {
            const diffDays = Math.ceil((probEnd-today)/(1000*60*60*24));
            if (diffDays >= 0 && diffDays <= 30) events.push({ type: 'probation', label: `${name}'s Probation Ends`, date: probEnd.toISOString().slice(0,10), days_away: diffDays, user_id: emp.user_id, department: emp.department });
            else if (diffDays < 0) events.push({ type: 'probation_overdue', label: `${name}'s Probation Overdue (${Math.abs(diffDays)} days)`, date: probEnd.toISOString().slice(0,10), days_away: diffDays, user_id: emp.user_id, department: emp.department });
          }
        }
      }

      // Employees returning from leave today/this week
      const leaveReturnRows = await all("SELECT data FROM entities WHERE type='Leave' AND status='approved'");
      for (const row of leaveReturnRows) {
        const lv = JSON.parse(row.data);
        if (!lv.end_date) continue;
        const endDate = new Date(lv.end_date);
        const diffDays = Math.ceil((endDate-today)/(1000*60*60*24));
        if (diffDays >= -1 && diffDays <= 3) {
          const name = ueUserMap[lv.user_id] || 'Employee';
          events.push({ type: 'leave_return', label: `${name} returns from leave`, date: new Date(endDate.getTime()+24*60*60*1000).toISOString().slice(0,10), days_away: diffDays+1, user_id: lv.user_id });
        }
      }

      events.sort((a,b) => a.days_away - b.days_away);
      return res.json({ success: true, events });
    }

    /* ── Bulk leave operations ────────────────────────── */
    case 'bulkApproveLeave': {
      const { leave_ids, approved_by: blApprover, comment: blComment } = p;
      if (!Array.isArray(leave_ids) || !leave_ids.length) return res.json({ success: false, error: 'No leave IDs provided' });
      let approved = 0, failed = 0;
      for (const lid of leave_ids) {
        try {
          const row = await one("SELECT id,data FROM entities WHERE type='Leave' AND id=$1", [lid]);
          if (!row) { failed++; continue; }
          const lv = JSON.parse(row.data);
          if (lv.status === 'approved') { approved++; continue; }
          const upd = { ...lv, status: 'approved', approved_by: blApprover, approved_at: new Date().toISOString(), approval_note: blComment||'Bulk approved' };
          await run("UPDATE entities SET data=$1,status='approved',updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(upd), row.id]);
          // Notify employee
          const nid = uuidv4();
          await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [nid, lv.user_id, 'Leave Approved', `Your leave request (${lv.start_date} – ${lv.end_date}) has been approved.`, 'leave', '/leave']);
          approved++;
        } catch { failed++; }
      }
      return res.json({ success: true, approved, failed, total: leave_ids.length });
    }

    case 'bulkRejectLeave': {
      const { leave_ids: rlIds, rejected_by: rlBy, reason: rlReason } = p;
      if (!Array.isArray(rlIds) || !rlIds.length) return res.json({ success: false, error: 'No leave IDs provided' });
      let rejected = 0, failed = 0;
      for (const lid of rlIds) {
        try {
          const row = await one("SELECT id,data FROM entities WHERE type='Leave' AND id=$1", [lid]);
          if (!row) { failed++; continue; }
          const lv = JSON.parse(row.data);
          if (['approved','rejected'].includes(lv.status)) { rejected++; continue; }
          const upd = { ...lv, status: 'rejected', rejected_by: rlBy, rejected_at: new Date().toISOString(), rejection_reason: rlReason||'Bulk rejected' };
          await run("UPDATE entities SET data=$1,status='rejected',updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(upd), row.id]);
          const nid = uuidv4();
          await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [nid, lv.user_id, 'Leave Rejected', `Your leave request (${lv.start_date} – ${lv.end_date}) has been rejected.${rlReason?' Reason: '+rlReason:''}`, 'leave', '/leave']);
          rejected++;
        } catch { failed++; }
      }
      return res.json({ success: true, rejected, failed, total: rlIds.length });
    }

    /* ── Probation Management ────────────────────────── */
    case 'getProbationEmployees': {
      const today2 = new Date();
      const pbEmpRows = await all("SELECT data FROM entities WHERE type='Employee'");
      const pbUserMap = {};
      (await all("SELECT id,full_name,email FROM users")).forEach(u => { pbUserMap[u.id] = u; });
      const result = pbEmpRows.map(r => JSON.parse(r.data)).filter(e => e.employee_status === 'probation' || e.employee_status === 'active').map(e => {
        const u = pbUserMap[e.user_id] || {};
        const doj = e.date_of_joining ? new Date(e.date_of_joining) : null;
        const probEnd = e.probation_end_date ? new Date(e.probation_end_date) : (doj ? new Date(doj.getTime() + 90*24*60*60*1000) : null);
        const daysLeft = probEnd ? Math.ceil((probEnd - today2)/(1000*60*60*24)) : null;
        return { ...e, full_name: u.full_name, email: u.email, probation_end_date: probEnd?.toISOString().slice(0,10), days_left: daysLeft, probation_flag: daysLeft !== null && daysLeft <= 30 ? (daysLeft < 0 ? 'overdue' : 'due_soon') : 'active' };
      }).filter(e => e.employee_status === 'probation' || (e.days_left !== null && e.days_left <= 60));
      return res.json({ success: true, employees: result });
    }

    case 'notifyLeaveStatusChange': {
      const { leave_id: nlsLeaveId, action: nlsAction, note: nlsNote, manager_id: nlsMgrId, employee_id: nlsEmpId, start_date: nlsStart, end_date: nlsEnd } = p;
      try {
        const actorName = cu?.full_name || 'HR';
        if (nlsAction === 'submitted') {
          // Notify manager about new leave request
          const nlsEmpUser = nlsEmpId ? await one("SELECT full_name FROM users WHERE id=$1", [nlsEmpId]) : null;
          const nlsEmpName = nlsEmpUser?.full_name || 'An employee';
          if (nlsMgrId) await notify(nlsMgrId, { title: 'Leave Request', message: `${nlsEmpName} has applied for leave from ${nlsStart || '?'} to ${nlsEnd || '?'}.`, type: 'info', link: '/leave-management' });
          const hrRows = await all("SELECT id FROM users WHERE role IN ('hr','admin')");
          for (const hr of hrRows) await notify(hr.id, { title: 'New Leave Request', message: `${nlsEmpName} has submitted a leave request (${nlsStart || '?'} – ${nlsEnd || '?'}).`, type: 'info', link: '/leave-management' });
          return res.json({ success: true });
        }
        if (!nlsLeaveId) return res.json({ success: false });
        const nlsRow = await one("SELECT data FROM entities WHERE type='Leave' AND id=$1", [nlsLeaveId]);
        if (!nlsRow) return res.json({ success: false });
        const nlsLv = JSON.parse(nlsRow.data);
        if (nlsAction === 'approved') {
          await notify(nlsLv.user_id, { title: 'Leave Approved', message: `Your leave (${nlsLv.start_date} – ${nlsLv.end_date}) has been approved by ${actorName}.`, type: 'success', link: '/leave' });
        } else if (nlsAction === 'rejected') {
          await notify(nlsLv.user_id, { title: 'Leave Rejected', message: `Your leave (${nlsLv.start_date} – ${nlsLv.end_date}) has been rejected${nlsNote ? ': ' + nlsNote : ''}.`, type: 'error', link: '/leave' });
        } else if (nlsAction === 'level1_approved') {
          await notify(nlsLv.user_id, { title: 'Leave Partially Approved', message: `Your leave (${nlsLv.start_date} – ${nlsLv.end_date}) is approved at Level 1 and awaiting final HR approval.`, type: 'info', link: '/leave' });
          const hrRows = await all("SELECT id FROM users WHERE role IN ('hr','admin')");
          for (const hr of hrRows) await notify(hr.id, { title: 'Leave Awaiting Final Approval', message: `${nlsLv.employee_name || 'An employee'}'s leave (${nlsLv.start_date} – ${nlsLv.end_date}) requires your final approval.`, type: 'info', link: '/leave-management' });
        }
      } catch {}
      return res.json({ success: true });
    }

    case 'notifyExitStatusChange': {
      const { action: nesAction, employee_id: nesEmpId, employee_name: nesEmpName, actor_name: nesActor, manager_id: nesMgrId } = p;
      try {
        const empName = nesEmpName || 'An employee';
        const hrRows = await all("SELECT id FROM users WHERE role IN ('hr','admin')");
        if (nesAction === 'submitted') {
          if (nesMgrId) await notify(nesMgrId, { title: 'Resignation Submitted', message: `${empName} has submitted a resignation and requires your approval.`, type: 'warning', link: '/exit-management' });
          for (const hr of hrRows) await notify(hr.id, { title: 'New Resignation', message: `${empName} has submitted a resignation request.`, type: 'info', link: '/exit-management' });
        } else if (nesAction === 'hr_initiated') {
          await notify(nesEmpId, { title: 'Exit Process Initiated', message: `HR has initiated an exit process for your account. Please log in to review the details and complete required steps.`, type: 'warning', link: '/my-exit' });
        } else if (nesAction === 'manager_approved') {
          await notify(nesEmpId, { title: 'Resignation Approved by Manager', message: `Your resignation has been approved by your manager and forwarded to HR.`, type: 'info', link: '/my-exit' });
          for (const hr of hrRows) await notify(hr.id, { title: 'Resignation Awaiting HR Approval', message: `${empName}'s resignation has been approved by manager and requires HR review.`, type: 'info', link: '/exit-management' });
        } else if (nesAction === 'manager_rejected') {
          await notify(nesEmpId, { title: 'Resignation Rejected', message: `Your resignation has been rejected by your manager. Please contact HR for assistance.`, type: 'error', link: '/my-exit' });
        } else if (nesAction === 'hr_approved') {
          await notify(nesEmpId, { title: 'Resignation Accepted — Notice Period Started', message: `Your resignation has been accepted by HR. Your notice period is now in progress.`, type: 'success', link: '/my-exit' });
        } else if (nesAction === 'hr_rejected') {
          await notify(nesEmpId, { title: 'Resignation Rejected by HR', message: `Your resignation has been rejected by HR. Please contact HR for further details.`, type: 'error', link: '/my-exit' });
        } else if (nesAction === 'clearance_started') {
          await notify(nesEmpId, { title: 'Clearance Process Started', message: `Your exit clearance has been initiated. Please complete all department clearances before your last working day.`, type: 'info', link: '/my-exit' });
        } else if (nesAction === 'fnf_pending') {
          await notify(nesEmpId, { title: 'F&F Settlement Initiated', message: `Your Full & Final settlement process has been initiated by HR.`, type: 'info', link: '/my-exit' });
          for (const hr of hrRows) await notify(hr.id, { title: 'F&F Settlement Required', message: `${empName}'s clearance is complete. F&F settlement needs to be processed.`, type: 'info', link: '/exit-management' });
        } else if (nesAction === 'completed') {
          await notify(nesEmpId, { title: 'Exit Process Completed', message: `Your exit process has been completed. Your relieving and experience letters will be shared shortly.`, type: 'success', link: '/my-exit' });
        }
      } catch {}
      return res.json({ success: true });
    }

    case 'getEmployeeSalaryForFnF': {
      const { user_id: gesfUserId } = p;
      if (!gesfUserId) return res.json({ success: false, error: 'user_id required' });
      try {
        const gesfEmpRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [gesfUserId]);
        const gesfEmp = gesfEmpRow ? JSON.parse(gesfEmpRow.data) : {};
        const gesfSalRows = await all("SELECT data FROM entities WHERE type='SalaryStructure' AND user_id=$1 ORDER BY created_at DESC LIMIT 1", [gesfUserId]);
        const gesfSal = gesfSalRows[0] ? JSON.parse(gesfSalRows[0].data) : {};
        const gesfLbRows = await all("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [gesfUserId]);
        const gesfLeaveBalance = gesfLbRows.map(r => JSON.parse(r.data));
        const earnedLeave = gesfLeaveBalance.find(lb => (lb.leave_type || '').toLowerCase().includes('earn') || (lb.leave_policy_name || '').toLowerCase().includes('earn'));
        const monthlyGross = Number(gesfSal.monthly_gross || gesfSal.gross_salary || gesfEmp.monthly_salary || 0);
        const perDaySalary = monthlyGross > 0 ? Math.round(monthlyGross / 26) : 0;
        const doj = gesfEmp.date_of_joining || gesfEmp.joining_date || null;
        const yearsOfService = doj ? Math.floor((new Date() - new Date(doj)) / (365.25 * 24 * 3600 * 1000)) : 0;
        const gratuityEligible = yearsOfService >= 5;
        const gratuityAmount = gratuityEligible ? Math.round((monthlyGross * 15 * yearsOfService) / 26) : 0;
        return res.json({
          success: true,
          monthly_gross: monthlyGross,
          per_day_salary: perDaySalary,
          leave_balance: earnedLeave?.available || 0,
          years_of_service: yearsOfService,
          gratuity_eligible: gratuityEligible,
          gratuity_amount: gratuityAmount,
          salary_structure: gesfSal,
          employee: gesfEmp,
        });
      } catch (e) {
        return res.json({ success: false, error: e.message });
      }
    }

    case 'generateExitDocument': {
      const { exit_id: gedExitId, doc_type: gedDocType, employee_name: gedEmpName, designation: gedDesignation, department: gedDept, joining_date: gedJoining, last_working_date: gedLwd, fnf_data: gedFnf } = p;
      if (!gedExitId || !gedDocType) return res.json({ success: false, error: 'exit_id and doc_type required' });
      try {
        const gedExitRow = await one("SELECT data FROM entities WHERE type='Exit' AND id=$1", [gedExitId]);
        if (!gedExitRow) return res.json({ success: false, error: 'Exit record not found' });
        const gedExit = JSON.parse(gedExitRow.data);
        const gedUserRow = await one("SELECT full_name, email FROM users WHERE id=$1", [gedExit.user_id]);
        const gedEmpRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [gedExit.user_id]);
        const gedEmp = gedEmpRow ? JSON.parse(gedEmpRow.data) : {};

        const empName = gedEmpName || gedUserRow?.full_name || 'Employee';
        const designation = gedDesignation || gedEmp.designation || 'Employee';
        const department = gedDept || gedEmp.department || '';
        const employeeCode = gedEmp.employee_code || '';
        const joiningDate = gedJoining || gedEmp.date_of_joining || '';
        const lwd = gedLwd || gedExit.last_working_date || '';

        const ordinalDate = (d) => {
          if (!d) return '';
          const date = new Date(d + 'T00:00:00');
          const day = date.getDate();
          const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
          const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          return `${day}${suffix} ${months[date.getMonth()]} ${date.getFullYear()}`;
        };

        const todayStr = new Date().toISOString().slice(0,10);
        const gender = (gedEmp.gender || '').toLowerCase();
        const prefix = gender === 'female' ? 'Ms.' : 'Mr.';

        let htmlContent = '';

        if (gedDocType === 'relieving_letter') {
          htmlContent = `
<p style="font-weight:bold;text-align:center;">Relieving Letter</p>
<p style="text-align:right;">${ordinalDate(todayStr)}</p>
<p>To Whomsoever It May Concern,</p>
<p>This is to certify that <strong>${prefix} ${empName}</strong>${employeeCode ? ` (Employee Code: ${employeeCode})` : ''} was employed with Maxvolt Energy Industries Limited as <strong>${designation}</strong>${department ? ` in the ${department} department` : ''} from <strong>${ordinalDate(joiningDate)}</strong> to <strong>${ordinalDate(lwd)}</strong>.</p>
<p>${prefix} ${empName} has been formally relieved from the services of Maxvolt Energy Industries Limited with effect from <strong>${ordinalDate(lwd)}</strong>.</p>
<p>During ${gender === 'female' ? 'her' : 'his'} tenure, ${gender === 'female' ? 'she' : 'he'} has discharged all ${gender === 'female' ? 'her' : 'his'} duties and responsibilities assigned to ${gender === 'female' ? 'her' : 'him'} diligently and sincerely.</p>
<p>We wish ${gender === 'female' ? 'her' : 'him'} all the best in ${gender === 'female' ? 'her' : 'his'} future endeavors.</p>
<p style="margin-top:40px;">Sincerely,<br/><br/><br/>HR Department<br/><strong>Maxvolt Energy Industries Limited</strong></p>`;

          await run("UPDATE entities SET data=jsonb_set(data::jsonb,'{relieving_letter_generated}','true')::text,updated_at=NOW()::TEXT WHERE type='Exit' AND id=$1", [gedExitId]);

        } else if (gedDocType === 'experience_letter') {
          htmlContent = `
<p style="font-weight:bold;text-align:center;">Experience Certificate</p>
<p style="text-align:right;">${ordinalDate(todayStr)}</p>
<p>To Whomsoever It May Concern,</p>
<p>This is to certify that <strong>${prefix} ${empName}</strong>${employeeCode ? ` (Employee Code: ${employeeCode})` : ''} was employed with <strong>Maxvolt Energy Industries Limited</strong> from <strong>${ordinalDate(joiningDate)}</strong> to <strong>${ordinalDate(lwd)}</strong>.</p>
<p>During ${gender === 'female' ? 'her' : 'his'} association with the company, ${gender === 'female' ? 'she' : 'he'} served as <strong>${designation}</strong>${department ? ` in the <strong>${department}</strong> department` : ''}.</p>
<p>We found ${gender === 'female' ? 'her' : 'him'} to be hardworking, dedicated, and a team player with good interpersonal skills. ${gender === 'female' ? 'She' : 'He'} handled all ${gender === 'female' ? 'her' : 'his'} responsibilities with sincerity and professionalism.</p>
<p>We wish ${gender === 'female' ? 'her' : 'him'} all the best in ${gender === 'female' ? 'her' : 'his'} future career.</p>
<p style="margin-top:40px;">Sincerely,<br/><br/><br/>HR Department<br/><strong>Maxvolt Energy Industries Limited</strong></p>`;

          await run("UPDATE entities SET data=jsonb_set(data::jsonb,'{experience_letter_generated}','true')::text,updated_at=NOW()::TEXT WHERE type='Exit' AND id=$1", [gedExitId]);

        } else if (gedDocType === 'fnf_letter') {
          const fnf = gedFnf || gedExit.fnf_data || {};
          const earnings = fnf.earnings || {};
          const deductions = fnf.deductions || {};
          const totalEarnings = Object.values(earnings).reduce((s, v) => s + Number(v || 0), 0);
          const totalDeductions = Object.values(deductions).reduce((s, v) => s + Number(v || 0), 0);
          const netPayable = totalEarnings - totalDeductions;
          const fmt2 = (n) => Number(n || 0).toLocaleString('en-IN');

          htmlContent = `
<p style="font-weight:bold;text-align:center;">Full & Final Settlement Letter</p>
<p style="text-align:right;">${ordinalDate(todayStr)}</p>
<p>Dear ${prefix} ${empName},</p>
<p>With reference to your resignation and relieving from the services of Maxvolt Energy Industries Limited on <strong>${ordinalDate(lwd)}</strong>, please find below the details of your Full & Final Settlement:</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;">
  <tr style="background:#f3f4f6;"><td colspan="2" style="padding:8px;font-weight:bold;border:1px solid #d1d5db;">Earnings</td></tr>
  ${earnings.last_month_salary ? `<tr><td style="padding:6px 8px;border:1px solid #d1d5db;">Last Month Salary</td><td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(earnings.last_month_salary)}</td></tr>` : ''}
  ${earnings.leave_encashment ? `<tr><td style="padding:6px 8px;border:1px solid #d1d5db;">Leave Encashment</td><td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(earnings.leave_encashment)}</td></tr>` : ''}
  ${earnings.gratuity ? `<tr><td style="padding:6px 8px;border:1px solid #d1d5db;">Gratuity</td><td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(earnings.gratuity)}</td></tr>` : ''}
  ${earnings.bonus ? `<tr><td style="padding:6px 8px;border:1px solid #d1d5db;">Bonus</td><td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(earnings.bonus)}</td></tr>` : ''}
  ${earnings.incentives ? `<tr><td style="padding:6px 8px;border:1px solid #d1d5db;">Incentives</td><td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(earnings.incentives)}</td></tr>` : ''}
  ${earnings.reimbursements ? `<tr><td style="padding:6px 8px;border:1px solid #d1d5db;">Reimbursements</td><td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(earnings.reimbursements)}</td></tr>` : ''}
  <tr style="background:#f0fdf4;font-weight:bold;"><td style="padding:8px;border:1px solid #d1d5db;">Total Earnings</td><td style="padding:8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(totalEarnings)}</td></tr>
  <tr style="background:#f3f4f6;"><td colspan="2" style="padding:8px;font-weight:bold;border:1px solid #d1d5db;">Deductions</td></tr>
  ${deductions.loan_recovery ? `<tr><td style="padding:6px 8px;border:1px solid #d1d5db;">Loan Recovery</td><td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(deductions.loan_recovery)}</td></tr>` : ''}
  ${deductions.advance_recovery ? `<tr><td style="padding:6px 8px;border:1px solid #d1d5db;">Advance Recovery</td><td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(deductions.advance_recovery)}</td></tr>` : ''}
  ${deductions.notice_period_recovery ? `<tr><td style="padding:6px 8px;border:1px solid #d1d5db;">Notice Period Recovery</td><td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(deductions.notice_period_recovery)}</td></tr>` : ''}
  ${deductions.buyout_recovery ? `<tr><td style="padding:6px 8px;border:1px solid #d1d5db;">Buyout Recovery</td><td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(deductions.buyout_recovery)}</td></tr>` : ''}
  ${deductions.tds ? `<tr><td style="padding:6px 8px;border:1px solid #d1d5db;">TDS</td><td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(deductions.tds)}</td></tr>` : ''}
  <tr style="background:#fef2f2;font-weight:bold;"><td style="padding:8px;border:1px solid #d1d5db;">Total Deductions</td><td style="padding:8px;border:1px solid #d1d5db;text-align:right;">₹${fmt2(totalDeductions)}</td></tr>
  <tr style="background:#1e3a5f;color:white;font-weight:bold;"><td style="padding:10px;border:1px solid #1e3a5f;">Net Amount Payable</td><td style="padding:10px;border:1px solid #1e3a5f;text-align:right;font-size:1.1em;">₹${fmt2(netPayable)}</td></tr>
</table>
<p>The above amount of <strong>₹${fmt2(netPayable)}</strong> shall be credited to your registered bank account within 45 days of your last working day.</p>
<p>Please acknowledge receipt of this letter.</p>
<p style="margin-top:40px;">Sincerely,<br/><br/><br/>HR / Finance Department<br/><strong>Maxvolt Energy Industries Limited</strong></p>`;
        } else {
          return res.json({ success: false, error: 'Unknown doc_type. Use: relieving_letter, experience_letter, fnf_letter' });
        }

        return res.json({ success: true, html: htmlContent, doc_type: gedDocType });
      } catch (e) {
        return res.json({ success: false, error: e.message });
      }
    }

    case 'processLeaveAction': {
      const { leave_id: plaLeaveId, action: plaAction, note: plaNote, level: plaLevel } = p;
      if (!plaLeaveId || !plaAction) return res.status(400).json({ error: 'leave_id and action required' });
      const plaRow = await one("SELECT id,data FROM entities WHERE type='Leave' AND id=$1", [plaLeaveId]);
      if (!plaRow) return res.json({ success: false, error: 'Leave not found' });
      const plaLv = JSON.parse(plaRow.data);
      const plaActorId = cu?.id;
      const plaActorName = cu?.full_name || 'HR';
      const now = new Date().toISOString();

      if (plaAction === 'approve') {
        const isLevel1 = plaLevel === 1 && !['hr','admin','management'].includes(cu?.role || cu?.custom_role);
        if (isLevel1) {
          const upd = { ...plaLv, current_approval_level: 2, approval_history: [...(plaLv.approval_history || []), { level: 1, action: 'approved', by: plaActorId, by_name: plaActorName, at: now, note: plaNote || '' }] };
          await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(upd), plaRow.id]);
          await notify(plaLv.user_id, { title: 'Leave Partially Approved', message: `Your leave (${plaLv.start_date} – ${plaLv.end_date}) has been approved at Level 1 and sent to HR for final approval.`, type: 'info', link: '/leave' });
          const hrRows = await all("SELECT id FROM users WHERE role IN ('hr','admin')");
          for (const hr of hrRows) await notify(hr.id, { title: 'Leave Approval Required', message: `${plaLv.employee_name || 'An employee'}'s leave request (${plaLv.start_date} – ${plaLv.end_date}) requires your approval.`, type: 'info', link: '/leave-management' });
          return res.json({ success: true, status: 'level1_approved' });
        } else {
          const upd = { ...plaLv, status: 'approved', approved_by: plaActorId, approved_by_name: plaActorName, approved_date: now, approval_note: plaNote || '', approval_history: [...(plaLv.approval_history || []), { action: 'approved', by: plaActorId, by_name: plaActorName, at: now, note: plaNote || '' }] };
          await run("UPDATE entities SET data=$1,status='approved',updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(upd), plaRow.id]);
          // Update leave balance
          try {
            const balRows = await all("SELECT id,data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [plaLv.user_id]);
            const lb = balRows.map(r => JSON.parse(r.data)).find(b => b.leave_policy_id === plaLv.leave_policy_id);
            if (lb) {
              const lbUpd = { ...lb, used: (lb.used || 0) + plaLv.total_days, pending_approval: Math.max((lb.pending_approval || 0) - plaLv.total_days, 0) };
              await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(lbUpd), balRows.find(r => JSON.parse(r.data).id === lb.id)?.id]);
            }
          } catch {}
          await notify(plaLv.user_id, { title: 'Leave Approved', message: `Your leave request (${plaLv.start_date} – ${plaLv.end_date}) has been approved by ${plaActorName}.`, type: 'success', link: '/leave' });
          return res.json({ success: true, status: 'approved' });
        }
      } else if (plaAction === 'reject') {
        const upd = { ...plaLv, status: 'rejected', rejected_by: plaActorId, rejected_by_name: plaActorName, rejected_at: now, rejection_reason: plaNote || '', approval_history: [...(plaLv.approval_history || []), { action: 'rejected', by: plaActorId, by_name: plaActorName, at: now, note: plaNote || '' }] };
        await run("UPDATE entities SET data=$1,status='rejected',updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(upd), plaRow.id]);
        // Restore pending balance
        try {
          const balRows = await all("SELECT id,data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [plaLv.user_id]);
          const lb = balRows.map(r => JSON.parse(r.data)).find(b => b.leave_policy_id === plaLv.leave_policy_id);
          if (lb) {
            const lbUpd = { ...lb, pending_approval: Math.max((lb.pending_approval || 0) - plaLv.total_days, 0), available: (lb.available || 0) + plaLv.total_days };
            await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(lbUpd), balRows.find(r => JSON.parse(r.data).id === lb.id)?.id]);
          }
        } catch {}
        await notify(plaLv.user_id, { title: 'Leave Rejected', message: `Your leave request (${plaLv.start_date} – ${plaLv.end_date}) has been rejected${plaNote ? ': ' + plaNote : ''}.`, type: 'error', link: '/leave' });
        return res.json({ success: true, status: 'rejected' });
      }
      return res.json({ success: false, error: 'Unknown action' });
    }

    case 'submitProbationReview': {
      const { employee_user_id: sprEmpUid, action: sprAction, extended_until: sprExtUntil, manager_scores: sprScores, manager_comments: sprMgrComments } = p;
      const sprEmpRow = await one("SELECT id,data FROM entities WHERE type='Employee' AND user_id=$1", [sprEmpUid]);
      if (!sprEmpRow) return res.json({ success: false, error: 'Employee not found' });
      const sprEmp = JSON.parse(sprEmpRow.data);
      const sprEmpUser = await one("SELECT full_name FROM users WHERE id=$1", [sprEmpUid]);
      const sprEmpName = sprEmpUser?.full_name || sprEmp.display_name || 'Employee';
      const sprMgrId = cu?.id;
      const sprMgrName = cu?.full_name || 'Manager';
      const sprExisting = await one("SELECT id FROM entities WHERE type='ProbationReview' AND user_id=$1 AND (data::jsonb->>'status'='manager_submitted' OR data::jsonb->>'status'='hr_approved')", [sprEmpUid]);
      if (sprExisting) return res.json({ success: false, error: 'Review already in progress' });
      const sprId = uuidv4();
      const sprData = {
        id: sprId, user_id: sprEmpUid, employee_name: sprEmpName,
        department: sprEmp.department || '',
        manager_id: sprMgrId, manager_name: sprMgrName,
        probation_end_date: sprEmp.probation_end_date || null,
        action: sprAction, extended_until: sprExtUntil || null,
        manager_scores: sprScores || {},
        manager_comments: sprMgrComments || '',
        status: 'manager_submitted',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ProbationReview',$2,'manager_submitted',$3)", [sprId, sprEmpUid, JSON.stringify(sprData)]);
      const sprHrRows = await all("SELECT id FROM users WHERE role IN ('admin','hr')");
      for (const sprHr of sprHrRows) {
        const sprNid = uuidv4();
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [sprNid, sprHr.id, 'Probation Review Submitted', `${sprEmpName}'s probation review submitted by ${sprMgrName}.`, 'probation', '/admin-panel']);
      }
      return res.json({ success: true, review_id: sprId });
    }

    case 'getProbationReviews': {
      const { status: gprStatus, employee_user_id: gprEmpUid } = p;
      let gprSql = "SELECT data FROM entities WHERE type='ProbationReview'";
      const gprP = [];
      if (gprStatus) { gprSql += ` AND data::jsonb->>'status'=$${gprP.push(gprStatus)}`; }
      if (gprEmpUid) { gprSql += ` AND user_id=$${gprP.push(gprEmpUid)}`; }
      gprSql += " ORDER BY created_at DESC";
      const gprUserMap = {};
      (await all("SELECT id,full_name FROM users")).forEach(u => { gprUserMap[u.id] = u.full_name; });
      const gprReviews = (await all(gprSql, gprP)).map(r => {
        const d = JSON.parse(r.data);
        return { ...d, employee_full_name: gprUserMap[d.user_id] || d.employee_name };
      });
      return res.json({ success: true, reviews: gprReviews });
    }

    case 'processProbationHRReview': {
      const { review_id: phrRevId, hr_action: phrAction, hr_comments: phrComments } = p;
      const phrRow = await one("SELECT id,data FROM entities WHERE type='ProbationReview' AND id=$1", [phrRevId]);
      if (!phrRow) return res.json({ success: false, error: 'Review not found' });
      const phrRev = JSON.parse(phrRow.data);
      const phrHrId = cu?.id;
      const phrHrName = cu?.full_name || 'HR';
      if (phrAction === 'reject') {
        const phrUpd = { ...phrRev, status: 'rejected', hr_comments: phrComments || '', hr_reviewed_by: phrHrId, hr_reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        await run("UPDATE entities SET data=$1,status='rejected',updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(phrUpd), phrRow.id]);
        const phrNid = uuidv4();
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [phrNid, phrRev.user_id, 'Probation Review Rejected', 'Your probation review has been rejected by HR. Please contact your manager for details.', 'probation', '/profile']);
      } else {
        const phrUpd = { ...phrRev, status: 'hr_approved', hr_comments: phrComments || '', hr_reviewed_by: phrHrId, hr_reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        await run("UPDATE entities SET data=$1,status='hr_approved',updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(phrUpd), phrRow.id]);
        const phrMgmtRows = await all("SELECT id FROM users WHERE custom_role='management' OR role='management'");
        for (const phrMgmt of phrMgmtRows) {
          const phrMNid = uuidv4();
          await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [phrMNid, phrMgmt.id, 'Probation Review Awaiting Approval', `${phrRev.employee_name}'s probation review has been approved by HR and requires your final decision.`, 'probation', '/admin-panel']);
        }
      }
      return res.json({ success: true });
    }

    case 'processProbationManagementApproval': {
      const { review_id: pmaRevId, final_action: pmaFinalAction, management_comments: pmaMgmtComments, extended_until: pmaExtUntil } = p;
      const pmaRow = await one("SELECT id,data FROM entities WHERE type='ProbationReview' AND id=$1", [pmaRevId]);
      if (!pmaRow) return res.json({ success: false, error: 'Review not found' });
      const pmaRev = JSON.parse(pmaRow.data);
      const pmaMgmtId = cu?.id;
      const pmaMgmtName = cu?.full_name || 'Management';
      const pmaToday = new Date().toISOString().slice(0,10);
      const pmaUpd = { ...pmaRev, final_action: pmaFinalAction, status: pmaFinalAction, management_comments: pmaMgmtComments || '', management_reviewed_by: pmaMgmtId, management_reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      await run("UPDATE entities SET data=$1,status=$2,updated_at=NOW()::TEXT WHERE id=$3", [JSON.stringify(pmaUpd), pmaFinalAction, pmaRow.id]);
      const pmaEmpRow = await one("SELECT id,data FROM entities WHERE type='Employee' AND user_id=$1", [pmaRev.user_id]);
      if (pmaEmpRow) {
        const pmaEmp = JSON.parse(pmaEmpRow.data);
        const pmaEmpUpd = { ...pmaEmp };
        if (pmaFinalAction === 'confirmed') { pmaEmpUpd.employee_status = 'active'; pmaEmpUpd.confirmation_date = pmaToday; }
        else if (pmaFinalAction === 'extended') { pmaEmpUpd.employee_status = 'probation'; pmaEmpUpd.probation_end_date = pmaExtUntil || pmaRev.extended_until; }
        else if (pmaFinalAction === 'rejected') { pmaEmpUpd.employee_status = 'terminated'; pmaEmpUpd.termination_date = pmaToday; pmaEmpUpd.termination_reason = 'Probation not confirmed'; }
        await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(pmaEmpUpd), pmaEmpRow.id]);
      }
      const pmaEmpMsgs = { confirmed: 'Congratulations! Your probation period is complete and your employment has been confirmed.', extended: `Your probation period has been extended to ${pmaExtUntil || pmaRev.extended_until}.`, rejected: 'Your probation review has concluded. Please contact HR for further information.' };
      const pmaNid1 = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [pmaNid1, pmaRev.user_id, 'Probation Decision', pmaEmpMsgs[pmaFinalAction] || 'Your probation status has been updated.', 'probation', '/profile']);
      if (pmaRev.manager_id) {
        const pmaMgrMsgs = { confirmed: `${pmaRev.employee_name}'s probation has been confirmed by management.`, extended: `${pmaRev.employee_name}'s probation has been extended by management.`, rejected: `${pmaRev.employee_name}'s probation review has resulted in rejection by management.` };
        const pmaNid2 = uuidv4();
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [pmaNid2, pmaRev.manager_id, 'Probation Review Result', pmaMgrMsgs[pmaFinalAction] || `${pmaRev.employee_name}'s probation status has been updated.`, 'probation', '/admin-panel']);
      }
      return res.json({ success: true, final_action: pmaFinalAction });
    }

    case 'hrInitiateConfirmation': {
      const { employee_user_id: hicEmpUid, action: hicAction, extended_until: hicExtUntil, scores: hicScores, comments: hicComments } = p;
      const hicEmpRow = await one("SELECT id,data FROM entities WHERE type='Employee' AND user_id=$1", [hicEmpUid]);
      if (!hicEmpRow) return res.json({ success: false, error: 'Employee not found' });
      const hicEmp = JSON.parse(hicEmpRow.data);
      const hicEmpUser = await one("SELECT full_name FROM users WHERE id=$1", [hicEmpUid]);
      const hicEmpName = hicEmpUser?.full_name || hicEmp.display_name || 'Employee';
      const hicExisting = await one("SELECT id FROM entities WHERE type='ProbationReview' AND user_id=$1 AND (data::jsonb->>'status'='manager_submitted' OR data::jsonb->>'status'='hr_approved')", [hicEmpUid]);
      if (hicExisting) return res.json({ success: false, error: 'Review already in progress' });
      const hicId = uuidv4();
      const hicData = {
        id: hicId, user_id: hicEmpUid, employee_name: hicEmpName,
        department: hicEmp.department || '',
        manager_id: cu?.id, manager_name: cu?.full_name || 'HR',
        probation_end_date: hicEmp.probation_end_date || null,
        action: hicAction, extended_until: hicExtUntil || null,
        manager_scores: hicScores || {},
        manager_comments: hicComments || '',
        hr_comments: 'HR initiated review',
        hr_reviewed_by: cu?.id,
        hr_reviewed_at: new Date().toISOString(),
        status: 'hr_approved',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ProbationReview',$2,'hr_approved',$3)", [hicId, hicEmpUid, JSON.stringify(hicData)]);
      const hicMgmtRows = await all("SELECT id FROM users WHERE custom_role='management' OR role='management'");
      for (const hicMgmt of hicMgmtRows) {
        const hicNid = uuidv4();
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [hicNid, hicMgmt.id, 'Confirmation Review Ready', `HR has submitted ${hicEmpName}'s confirmation review for your decision.`, 'probation', '/admin-panel']);
      }
      return res.json({ success: true, review_id: hicId });
    }

    case 'sendConfirmationLetter': {
      const { review_id: sclRevId } = p;
      if (!sclRevId) return res.json({ success: false, error: 'review_id required' });

      const sclRevRow = await one("SELECT id,data FROM entities WHERE type='ProbationReview' AND id=$1", [sclRevId]);
      if (!sclRevRow) return res.json({ success: false, error: 'Review not found' });
      const sclRev = JSON.parse(sclRevRow.data);
      if (!['confirmed','extended'].includes(sclRev.status)) return res.json({ success: false, error: 'Letter can only be sent for confirmed or extended reviews' });

      const sclEmpRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [sclRev.user_id]);
      const sclEmp = sclEmpRow ? JSON.parse(sclEmpRow.data) : {};
      const sclUser = await one("SELECT email, full_name FROM users WHERE id=$1", [sclRev.user_id]);
      if (!sclUser?.email) return res.json({ success: false, error: 'Employee has no email address on record' });

      const ordinalDate = (d) => {
        if (!d) return '';
        const date = new Date(d + 'T00:00:00');
        const day = date.getDate();
        const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        return `${day}${suffix} ${months[date.getMonth()]} ${date.getFullYear()}`;
      };

      const todayStr = new Date().toISOString().slice(0,10);
      const empName = sclUser.full_name || sclRev.employee_name || 'Employee';
      const gender = (sclEmp.gender || '').toLowerCase();
      const prefix = gender === 'female' ? 'Ms.' : 'Mr.';
      const designation = sclEmp.designation || sclRev.department || 'Employee';
      const todayFmt = ordinalDate(todayStr);

      let label, htmlContent;

      if (sclRev.status === 'confirmed') {
        const effectiveDate = sclEmp.confirmation_date || todayStr;
        const effectiveFmt = ordinalDate(effectiveDate);
        label = 'Confirmation Letter';
        htmlContent = `
<p style="font-weight:bold;text-align:center;">Letter of Confirmation</p>
<p style="text-align:right;">${todayFmt}</p>
<p>Dear ${prefix} ${empName},</p>
<p><strong>Congratulation!!</strong></p>
<p><strong>Subject: Service Confirmation Letter to the Designation of "${designation}"</strong></p>
<p>Following completion of your six months' probation period at Maxvolt Energy Industries Limited. We have reviewed your performance and found the same to be satisfactory.</p>
<p>In view of the above, we are pleased to inform you that you have been confirmed to the position of "<strong>${designation}</strong>" at Maxvolt Energy Industries Limited with effect from <strong>${effectiveFmt}</strong>.</p>
<p>Your salary will be reviewed every 12 months from the date of joining or as decided by company and increases will be based upon satisfactory performance in the position.</p>
<p>All other terms and conditions of your appointment will remain the same except the following.</p>
<p><strong>Notice Period</strong> – Either party may at any time terminate the employment, without cause by giving in writing to the other party a notice period of 30 Days. You may alternatively, exercise the option of buying out your notice period per the terms and conditions of this employment letter. The payment of salary during such notice period would be on the basis of cost to Our Company.</p>
<p><strong>Leave Credit</strong> – As a gesture of appreciation for your hard work and dedication, we are pleased to inform you that you are now eligible to earn and take advantage of annual leave benefits. Starting <strong>${effectiveFmt}</strong>, you will be entitled to accrue and utilize earned leave days as per our company's leave policy. We believe that providing earned leave is a valuable component of our commitment to the well-being and work-life balance of our employees. We encourage you to plan and utilize your earned leave in a manner that supports your personal and professional needs.</p>
<p><strong>Salary Settlement (Full & Final)</strong> – The full and final settlement of the employee's salary account is done after 45 days of the employee's last working day of services. The company will provide full and final settlement only in the condition that the employee has served Maxvolt Energy Industries Ltd. with the notice period mentioned in appointment letter and worked fruitfully during the notice been served and has facilitated in the smooth transition. Employee's last salary and other benefits will be provided once the employee has been issued clearance letter from HR, IT, Accounts & Administration department.</p>
<p>Please signify your acceptance to terms and conditions, mentioned above & in company's policy handbook, by signing this letter and returning it to me at an earliest convenient time.</p>
<p>In case you have any queries, do not hesitate to reach your manager/supervisor/HR Department.</p>
<p>Maxvolt Energy Industries Limited congratulates you on your confirmation and wishes you well in your position.</p>
<p>Sincerely,<br/><br/><br/>HR Head<br/><strong>Maxvolt Energy Industries Limited</strong></p>
<p>_______________________________<br/><strong>${empName}</strong> &nbsp;&nbsp; Date: _______________</p>`;

      } else {
        // Extended
        const extDate = sclRev.extended_until || sclRev.management_reviewed_at?.slice(0,10) || todayStr;
        const extFmt = ordinalDate(extDate);
        label = 'Probation Extension Letter';
        htmlContent = `
<p style="font-weight:bold;text-align:center;">Probation Extension Letter</p>
<p style="text-align:right;">${todayFmt}</p>
<p>Dear ${prefix} ${empName},</p>
<p><strong>Subject: Extension of Probation Period – "${designation}"</strong></p>
<p>With reference to your appointment at Maxvolt Energy Industries Limited as "<strong>${designation}</strong>", we wish to inform you that after reviewing your performance during the initial probation period, the management has decided to extend your probation period.</p>
<p>Your extended probation period will continue up to <strong>${extFmt}</strong>. During this period, you will continue to be governed by the same terms and conditions as mentioned in your appointment letter.</p>
<p>We encourage you to utilize this time to demonstrate your full potential and align with the performance expectations of the role. Your reporting manager and the HR department will continue to provide you with guidance and support during this period.</p>
<p>A fresh performance review will be conducted at the end of the extended probation period to determine further confirmation or any other appropriate action.</p>
<p>Please feel free to reach out to the HR Department or your reporting manager in case of any queries or clarifications.</p>
<p>We wish you the best and hope to see improvement in the upcoming period.</p>
<p>Sincerely,<br/><br/><br/>HR Head<br/><strong>Maxvolt Energy Industries Limited</strong></p>
<p>_______________________________<br/><strong>${empName}</strong> &nbsp;&nbsp; Date: _______________</p>`;
      }

      let pdfBuffer = null;
      try {
        pdfBuffer = await buildLetterPdf(label, '', htmlContent);
      } catch (pdfErr) {
        console.error('Confirmation letter PDF failed:', pdfErr.message);
      }

      const attachments = pdfBuffer
        ? [{ filename: `${label.replace(/\s+/g,'_')}_${empName.replace(/\s+/g,'_')}.pdf`, content: pdfBuffer }]
        : [];

      await sendEmail({
        to: sclUser.email,
        subject: `${label} – Maxvolt Energy Industries Limited`,
        html: `<div style="font-family:Arial,sans-serif;color:#111;font-size:14px;line-height:1.7">
          <p>Dear ${empName},</p>
          <p>Please find your <strong>${label}</strong> attached to this email from Maxvolt Energy Industries Limited.</p>
          ${!pdfBuffer ? '<p style="color:#c00">Note: PDF could not be generated — please request it from HR.</p>' : ''}
          <p style="color:#666;font-size:12px;margin-top:20px;">This is a system-generated letter from Maxvolt HR. For any queries, please contact the HR Department.</p>
          </div>`,
        text: `Dear ${empName},\n\nPlease find your ${label} attached.\n\nMaxvolt Energy Industries Limited`,
        attachments,
      });

      // Upload PDF to R2 so document_url is set and View/Download work in employee docs
      const sclDocId = uuidv4();
      let sclDocUrl = null;
      if (pdfBuffer) {
        try {
          const { isR2Configured, buildKey, putToR2, presignGet } = await import('../utils/r2.js');
          if (isR2Configured()) {
            const r2Key = buildKey(`letters/${sclDocId}`, '.pdf');
            await putToR2(r2Key, pdfBuffer, 'application/pdf');
            sclDocUrl = await presignGet(r2Key, {
              expiresIn: 31536000,
              filename: `${label.replace(/\s+/g,'_')}_${empName.replace(/\s+/g,'_')}.pdf`,
            });
          }
        } catch (r2Err) {
          console.warn('[sendConfirmationLetter] R2 upload failed:', r2Err.message);
        }
      }

      const sclDocData = {
        id: sclDocId, user_id: sclRev.user_id,
        document_type: 'hr_letter', letter_type: sclRev.status === 'confirmed' ? 'confirmation' : 'probation_extension',
        document_name: `${label} — ${todayStr}`, letter_content: htmlContent,
        ...(sclDocUrl ? { document_url: sclDocUrl } : {}),
        employee_name: empName, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Document',$2,'verified',$3)", [sclDocId, sclRev.user_id, JSON.stringify(sclDocData)]);

      // Mark letter as sent on review
      const sclUpdRev = { ...sclRev, letter_sent: true, letter_sent_at: new Date().toISOString() };
      await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(sclUpdRev), sclRevRow.id]);

      return res.json({ success: true, email_sent_to: sclUser.email });
    }

    case 'processProbationAction': {
      const { user_id: pbUid, action: pbAction, probation_end_date: pbEnd, note: pbNote } = p;
      const pbRow = await one("SELECT id,data FROM entities WHERE type='Employee' AND user_id=$1", [pbUid]);
      if (!pbRow) return res.json({ success: false, error: 'Employee not found' });
      const pbEmp = JSON.parse(pbRow.data);
      const pbUpd = { ...pbEmp };
      if (pbAction === 'confirm') { pbUpd.employee_status = 'active'; pbUpd.confirmation_date = new Date().toISOString().slice(0,10); }
      else if (pbAction === 'extend') { pbUpd.employee_status = 'probation'; pbUpd.probation_end_date = pbEnd; pbUpd.probation_extension_note = pbNote; }
      else if (pbAction === 'terminate') { pbUpd.employee_status = 'terminated'; pbUpd.termination_date = new Date().toISOString().slice(0,10); pbUpd.termination_reason = pbNote||'Probation not cleared'; }
      await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(pbUpd), pbRow.id]);
      const pbMsg = { confirm: 'Congratulations! Your probation is complete and employment is confirmed.', extend: `Your probation period has been extended to ${pbEnd}.`, terminate: 'Your probation review has resulted in termination. Please contact HR.' };
      const pbNid = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [pbNid, pbUid, 'Probation Status Update', pbMsg[pbAction]||'Your probation status was updated.', 'probation', '/profile']);
      return res.json({ success: true, action: pbAction, status: pbUpd.employee_status });
    }

    /* ── Shift Swap ──────────────────────────────────── */
    case 'createShiftSwapRequest': {
      const { requester_id: ssReqId, target_user_id: ssTgtId, requester_date: ssReqDate, target_date: ssTgtDate, reason: ssReason } = p;
      const ssId = uuidv4();
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ShiftSwap',$2,'pending',$3)", [ssId, ssReqId,
        JSON.stringify({ id: ssId, requester_id: ssReqId, target_user_id: ssTgtId, requester_date: ssReqDate, target_date: ssTgtDate||ssReqDate, reason: ssReason, status: 'pending', created_at: new Date().toISOString() })]);
      const ssReqName = (await one("SELECT full_name FROM users WHERE id=$1", [ssReqId]))?.full_name || 'An employee';
      const ssNid = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [ssNid, ssTgtId, 'Shift Swap Request', `${ssReqName} has requested a shift swap with you for ${ssReqDate}.`, 'shift_swap', '/shift-management']);
      return res.json({ success: true, swap_id: ssId });
    }

    case 'approveShiftSwap': case 'rejectShiftSwap': {
      const { swap_id: ssSwapId, processed_by: ssProcBy } = p;
      const ssRow = await one("SELECT id,data FROM entities WHERE type='ShiftSwap' AND id=$1", [ssSwapId]);
      if (!ssRow) return res.json({ success: false, error: 'Swap request not found' });
      const ss = JSON.parse(ssRow.data);
      const ssIsApprove = name === 'approveShiftSwap';
      await run("UPDATE entities SET data=$1,status=$2,updated_at=NOW()::TEXT WHERE id=$3", [JSON.stringify({ ...ss, status: ssIsApprove?'approved':'rejected', processed_by: ssProcBy, processed_at: new Date().toISOString() }), ssIsApprove?'approved':'rejected', ssRow.id]);
      const ssNid2 = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [ssNid2, ss.requester_id, `Shift Swap ${ssIsApprove?'Approved':'Rejected'}`, `Your shift swap request for ${ss.requester_date} has been ${ssIsApprove?'approved':'rejected'}.`, 'shift_swap', '/shift-management']);
      return res.json({ success: true });
    }

    case 'getShiftSwapRequests': {
      const { user_id: ssUid, status: ssStatus } = p;
      let ssQ = "SELECT data FROM entities WHERE type='ShiftSwap'";
      const ssP = [];
      if (ssUid) { const p1 = ssP.push(ssUid), p2 = ssP.push(ssUid); ssQ += ` AND (data::jsonb->>'requester_id'=$${p1} OR data::jsonb->>'target_user_id'=$${p2})`; }
      if (ssStatus) { ssQ += ` AND data::jsonb->>'status'=$${ssP.push(ssStatus)}`; }
      ssQ += " ORDER BY created_at DESC";
      const ssUserMap = {};
      (await all("SELECT id,full_name FROM users")).forEach(u => { ssUserMap[u.id] = u.full_name; });
      const swaps = (await all(ssQ, [...ssP])).map(r => { const d = JSON.parse(r.data); return { ...d, requester_name: ssUserMap[d.requester_id], target_name: ssUserMap[d.target_user_id] }; });
      return res.json({ success: true, swaps });
    }

    /* ── Tax Declarations (Form 12BB) ────────────────── */
    case 'submitTaxDeclaration': {
      const { user_id: tdUid, financial_year: tdFY, declarations: tdDecl } = p;
      const existTD = await one("SELECT id,data FROM entities WHERE type='TaxDeclaration' AND user_id=$1 AND data::jsonb->>'financial_year'=$2", [tdUid, tdFY]);
      const tdTotal = Object.values(tdDecl||{}).reduce((s,v) => s + Number(v||0), 0);
      const tdData = { user_id: tdUid, financial_year: tdFY, declarations: tdDecl, total_declared: tdTotal, status: 'submitted', submitted_at: new Date().toISOString() };
      if (existTD) {
        await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify({ ...JSON.parse(existTD.data), ...tdData, id: existTD.id }), existTD.id]);
      } else {
        const tdId = uuidv4();
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'TaxDeclaration',$2,'submitted',$3)", [tdId, tdUid, JSON.stringify({ ...tdData, id: tdId })]);
      }
      // Notify HR
      const hrRows2 = await all("SELECT id FROM users WHERE role IN ('admin','hr')");
      for (const hr of hrRows2) {
        const tdNid = uuidv4();
        const tdName = (await one("SELECT full_name FROM users WHERE id=$1", [tdUid]))?.full_name || 'An employee';
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [tdNid, hr.id, 'Tax Declaration Submitted', `${tdName} submitted tax declaration for FY ${tdFY}.`, 'tax', '/admin-panel']);
      }
      return res.json({ success: true, total_declared: tdTotal });
    }

    case 'getTaxDeclaration': {
      const { user_id: tdGetUid, financial_year: tdGetFY } = p;
      const tdParams = [tdGetUid]; if (tdGetFY) tdParams.push(tdGetFY);
      const tdRow = await one("SELECT data FROM entities WHERE type='TaxDeclaration' AND user_id=$1" + (tdGetFY ? " AND data::jsonb->>'financial_year'=$2" : ""), tdParams);
      return res.json({ success: true, declaration: tdRow ? JSON.parse(tdRow.data) : null });
    }

    case 'getTaxDeclarationSummary': {
      const { financial_year: tdsFY } = p;
      let tdsSql = "SELECT data FROM entities WHERE type='TaxDeclaration'";
      const tdsP = [];
      if (tdsFY) { tdsSql += ` AND data::jsonb->>'financial_year'=$${tdsP.push(tdsFY)}`; }
      const tdsUserMap = {};
      (await all("SELECT id,full_name,email FROM users")).forEach(u => { tdsUserMap[u.id] = u; });
      const decls = (await all(tdsSql, [...tdsP])).map(r => { const d = JSON.parse(r.data); const u = tdsUserMap[d.user_id]||{}; return { ...d, full_name: u.full_name, email: u.email }; });
      return res.json({ success: true, declarations: decls, total: decls.length, pending_approval: decls.filter(d=>d.status==='submitted').length });
    }

    case 'approveTaxDeclaration': {
      const { user_id: tdaUid, financial_year: tdaFY, approved_by: tdaBy, notes: tdaNotes } = p;
      const tdaParams = [tdaUid]; if (tdaFY) tdaParams.push(tdaFY);
      const tdaRow = await one("SELECT id,data FROM entities WHERE type='TaxDeclaration' AND user_id=$1" + (tdaFY ? " AND data::jsonb->>'financial_year'=$2" : ""), tdaParams);
      if (!tdaRow) return res.json({ success: false, error: 'Declaration not found' });
      const tdaData = { ...JSON.parse(tdaRow.data), status: 'approved', approved_by: tdaBy, approved_at: new Date().toISOString(), hr_notes: tdaNotes };
      await run("UPDATE entities SET data=$1,status='approved',updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(tdaData), tdaRow.id]);
      const tdaNid = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [tdaNid, tdaUid, 'Tax Declaration Approved', `Your tax declaration for FY ${tdaFY} has been approved.`, 'tax', '/profile']);
      return res.json({ success: true });
    }

    /* ── Loan Management ─────────────────────────────── */
    case 'applyForLoan': {
      const { user_id: lnUid, loan_type, amount: lnAmt, tenure_months, purpose, requested_disbursement_date } = p;
      const lnId = uuidv4();
      const emi = lnAmt && tenure_months ? Math.ceil(Number(lnAmt) / Number(tenure_months)) : 0;
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Loan',$2,'pending',$3)", [lnId, lnUid,
        JSON.stringify({ id: lnId, user_id: lnUid, loan_type: loan_type||'personal', amount: Number(lnAmt||0), tenure_months: Number(tenure_months||0), emi_amount: emi, purpose, requested_disbursement_date, status: 'pending', applied_at: new Date().toISOString(), outstanding_amount: Number(lnAmt||0) })]);
      const hrRows3 = await all("SELECT id FROM users WHERE role IN ('admin','hr')");
      const lnName = (await one("SELECT full_name FROM users WHERE id=$1", [lnUid]))?.full_name||'Employee';
      for (const hr of hrRows3) {
        const nid = uuidv4();
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [nid, hr.id, 'Loan Application', `${lnName} applied for a ₹${Number(lnAmt||0).toLocaleString('en-IN')} ${loan_type||'personal'} loan.`, 'loan', '/loan-management']);
      }
      return res.json({ success: true, loan_id: lnId, emi_amount: emi });
    }

    case 'approveLoan': case 'rejectLoan': {
      const { loan_id: lnActId, approved_by: lnActBy, disbursement_date, rejection_reason } = p;
      const lnRow = await one("SELECT id,data FROM entities WHERE type='Loan' AND id=$1", [lnActId]);
      if (!lnRow) return res.json({ success: false, error: 'Loan not found' });
      const lnData = JSON.parse(lnRow.data);
      const isLnApprove = name === 'approveLoan';
      const lnUpd = { ...lnData, status: isLnApprove?'approved':'rejected', processed_by: lnActBy, processed_at: new Date().toISOString(), ...(isLnApprove ? { disbursement_date, repayment_start_date: disbursement_date } : { rejection_reason }) };
      await run("UPDATE entities SET data=$1,status=$2,updated_at=NOW()::TEXT WHERE id=$3", [JSON.stringify(lnUpd), lnUpd.status, lnRow.id]);
      const lnNid = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [lnNid, lnData.user_id, `Loan ${isLnApprove?'Approved':'Rejected'}`, isLnApprove?`Your loan of ₹${lnData.amount?.toLocaleString('en-IN')} has been approved. Disbursement: ${disbursement_date||'TBD'}.`:`Your loan application was rejected. ${rejection_reason||''}`, 'loan', '/loan-management']);
      return res.json({ success: true });
    }

    case 'getLoanDetails': {
      const { user_id: lnGetUid, loan_id: lnGetId } = p;
      let lnQ = "SELECT data FROM entities WHERE type='Loan'";
      const lnP2 = [];
      if (lnGetId) { lnQ += ` AND id=$${lnP2.push(lnGetId)}`; }
      else if (lnGetUid) { lnQ += ` AND user_id=$${lnP2.push(lnGetUid)}`; }
      lnQ += " ORDER BY created_at DESC";
      const lnUserMap2 = {};
      (await all("SELECT id,full_name FROM users")).forEach(u => { lnUserMap2[u.id] = u.full_name; });
      const loans = (await all(lnQ, [...lnP2])).map(r => { const d = JSON.parse(r.data); return { ...d, employee_name: lnUserMap2[d.user_id] }; });
      return res.json({ success: true, loans });
    }

    case 'processLoanRepayment': {
      const { loan_id: lnRepId, amount: lnRepAmt, repayment_date, notes: lnRepNotes } = p;
      const lnRepRow = await one("SELECT id,data FROM entities WHERE type='Loan' AND id=$1", [lnRepId]);
      if (!lnRepRow) return res.json({ success: false, error: 'Loan not found' });
      const lnRep = JSON.parse(lnRepRow.data);
      const newOutstanding = Math.max(0, Number(lnRep.outstanding_amount||lnRep.amount||0) - Number(lnRepAmt||0));
      const repHistory = [...(lnRep.repayment_history||[]), { amount: Number(lnRepAmt||0), date: repayment_date||new Date().toISOString().slice(0,10), notes: lnRepNotes }];
      const lnRepUpd = { ...lnRep, outstanding_amount: newOutstanding, repayment_history: repHistory, status: newOutstanding <= 0 ? 'closed' : lnRep.status };
      await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(lnRepUpd), lnRepRow.id]);
      return res.json({ success: true, outstanding_amount: newOutstanding, status: lnRepUpd.status });
    }

    /* ── Helpdesk SLA ────────────────────────────────── */
    case 'getHelpdeskStats': {
      const tktRows = await all("SELECT data FROM entities WHERE type='HelpdeskTicket'");
      const tickets = tktRows.map(r => JSON.parse(r.data));
      const now = new Date();
      const stats = { total: tickets.length, open: 0, in_progress: 0, resolved: 0, closed: 0, overdue: 0, avg_resolution_hours: 0 };
      let totalResolvedHours = 0, resolvedCount = 0;
      for (const t of tickets) {
        const s = (t.status||'open').toLowerCase().replace(/\s+/g,'_');
        if (s === 'open') stats.open++;
        else if (s === 'in_progress') stats.in_progress++;
        else if (s === 'resolved') { stats.resolved++; if (t.created_at && t.resolved_at) { totalResolvedHours += (new Date(t.resolved_at)-new Date(t.created_at))/(1000*60*60); resolvedCount++; } }
        else if (s === 'closed') stats.closed++;
        // SLA: tickets open > 24h are overdue
        if (['open','in_progress'].includes(s) && t.created_at) {
          const hoursOpen = (now - new Date(t.created_at))/(1000*60*60);
          const slaHours = t.priority === 'high' ? 4 : t.priority === 'medium' ? 24 : 72;
          if (hoursOpen > slaHours) stats.overdue++;
        }
      }
      stats.avg_resolution_hours = resolvedCount ? Math.round(totalResolvedHours/resolvedCount) : 0;
      return res.json({ success: true, stats });
    }

    case 'escalateHelpdeskTicket': {
      const { ticket_id: tktId, escalated_to, reason: tktReason } = p;
      const tktRow = await one("SELECT id,data FROM entities WHERE type='HelpdeskTicket' AND id=$1", [tktId]);
      if (!tktRow) return res.json({ success: false, error: 'Ticket not found' });
      const tkt = JSON.parse(tktRow.data);
      const tktUpd = { ...tkt, status: 'escalated', escalated_to, escalation_reason: tktReason, escalated_at: new Date().toISOString() };
      await run("UPDATE entities SET data=$1,status='escalated',updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(tktUpd), tktRow.id]);
      if (escalated_to) {
        const tktNid = uuidv4();
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [tktNid, escalated_to, 'Ticket Escalated to You', `Helpdesk ticket #${tktId.slice(0,8)} has been escalated. Reason: ${tktReason||'SLA breach'}`, 'helpdesk', '/helpdesk']);
      }
      return res.json({ success: true });
    }

    /* ── Insurance Claims ────────────────────────────── */
    case 'fileInsuranceClaim': {
      const { user_id: icUid, policy_id, claim_amount, claim_type, description: icDesc, incident_date } = p;
      const icId = uuidv4();
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'InsuranceClaim',$2,'pending',$3)", [icId, icUid,
        JSON.stringify({ id: icId, user_id: icUid, policy_id, claim_amount: Number(claim_amount||0), claim_type, description: icDesc, incident_date, status: 'pending', filed_at: new Date().toISOString() })]);
      const icName = (await one("SELECT full_name FROM users WHERE id=$1", [icUid]))?.full_name||'Employee';
      const hrRows4 = await all("SELECT id FROM users WHERE role IN ('admin','hr')");
      for (const hr of hrRows4) {
        const nid = uuidv4();
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [nid, hr.id, 'Insurance Claim Filed', `${icName} filed an insurance claim for ₹${Number(claim_amount||0).toLocaleString('en-IN')}.`, 'insurance', '/insurance-management']);
      }
      return res.json({ success: true, claim_id: icId });
    }

    case 'processInsuranceClaim': {
      const { claim_id: icActId, action: icAct, approved_amount, rejection_reason: icRej, processed_by: icProcBy } = p;
      const icRow = await one("SELECT id,data FROM entities WHERE type='InsuranceClaim' AND id=$1", [icActId]);
      if (!icRow) return res.json({ success: false, error: 'Claim not found' });
      const icData = JSON.parse(icRow.data);
      const icUpd = { ...icData, status: icAct==='approve'?'approved':'rejected', processed_by: icProcBy, processed_at: new Date().toISOString(), ...(icAct==='approve' ? { approved_amount: Number(approved_amount||icData.claim_amount||0) } : { rejection_reason: icRej }) };
      await run("UPDATE entities SET data=$1,status=$2,updated_at=NOW()::TEXT WHERE id=$3", [JSON.stringify(icUpd), icUpd.status, icRow.id]);
      const icNid = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [icNid, icData.user_id, `Insurance Claim ${icAct==='approve'?'Approved':'Rejected'}`, icAct==='approve'?`Your claim for ₹${icData.claim_amount} has been approved. Approved amount: ₹${approved_amount||icData.claim_amount}.`:`Your claim was rejected. ${icRej||''}`, 'insurance', '/insurance-management']);
      return res.json({ success: true });
    }

    case 'getInsuranceClaims': {
      const { user_id: icGetUid } = p;
      let icQ = "SELECT data FROM entities WHERE type='InsuranceClaim'";
      const icQP = [];
      if (icGetUid) { icQ += ` AND user_id=$${icQP.push(icGetUid)}`; }
      icQ += " ORDER BY created_at DESC";
      const icUMap = {};
      (await all("SELECT id,full_name FROM users")).forEach(u => { icUMap[u.id] = u.full_name; });
      const claims = (await all(icQ, [...icQP])).map(r => { const d = JSON.parse(r.data); return { ...d, employee_name: icUMap[d.user_id] }; });
      return res.json({ success: true, claims });
    }

    /* ── Employee Dashboard (self-service) ───────────── */
    case 'getEmployeeDashboard': {
      const { user_id: edUid } = p;
      if (!edUid) return res.json({ success: false, error: 'user_id required' });

      const edEmp = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [edUid]);
      const emp = edEmp ? JSON.parse(edEmp.data) : {};

      // Recent leaves
      const edLeaves = (await all("SELECT data FROM entities WHERE type='Leave' AND user_id=$1 ORDER BY created_at DESC LIMIT 5", [edUid])).map(r=>JSON.parse(r.data));

      // Pending regularisations
      const edRegs = (await all("SELECT data FROM entities WHERE type='AttendanceRegularisation' AND user_id=$1 AND status='pending'", [edUid])).map(r=>JSON.parse(r.data));

      // Active loans
      const edLoans = (await all("SELECT data FROM entities WHERE type='Loan' AND user_id=$1 AND status IN ('approved','active')", [edUid])).map(r=>JSON.parse(r.data));

      // Latest payslip
      const edPayroll = await one("SELECT data FROM entities WHERE type='Payroll' AND user_id=$1 ORDER BY created_at DESC LIMIT 1", [edUid]);
      const latestPayslip = edPayroll ? JSON.parse(edPayroll.data) : null;

      // Open helpdesk tickets
      const edTickets = (await all("SELECT data FROM entities WHERE type='HelpdeskTicket' AND user_id=$1 AND status NOT IN ('resolved','closed')", [edUid])).map(r=>JSON.parse(r.data));

      // Tax declaration status
      const currentFY = new Date().getMonth() >= 3 ? `${new Date().getFullYear()}-${new Date().getFullYear()+1}` : `${new Date().getFullYear()-1}-${new Date().getFullYear()}`;
      const edTax = await one("SELECT data FROM entities WHERE type='TaxDeclaration' AND user_id=$1 ORDER BY created_at DESC LIMIT 1", [edUid]);

      // Upcoming leaves (approved, future)
      const todayStr = new Date().toISOString().slice(0,10);
      const edUpcomingLeaves = (await all("SELECT data FROM entities WHERE type='Leave' AND user_id=$1 AND status='approved' AND end_date>=$2", [edUid, todayStr])).map(r=>JSON.parse(r.data));

      return res.json({ success: true, employee: emp, recent_leaves: edLeaves, pending_regularisations: edRegs.length, active_loans: edLoans, latest_payslip: latestPayslip, open_tickets: edTickets.length, upcoming_leaves: edUpcomingLeaves, tax_declaration: edTax ? JSON.parse(edTax.data) : null, current_fy: currentFY });
    }

    /* ── Anomaly Detection (attendance + payroll) ────── */
    case 'getAnomalies': {
      if (!(await hasRole(cu, HR_ROLES))) return res.status(403).json({ error: 'HR access required' });
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const d60 = new Date(now.getTime() - 60 * 864e5).toISOString().slice(0, 10);

      const empRows = (await all("SELECT user_id,data FROM entities WHERE type='Employee' AND status='active'")).map(r => JSON.parse(r.data));
      const empByUser = {};
      for (const e of empRows) empByUser[e.user_id] = e;
      const nameOf = (uid) => empByUser[uid]?.display_name || empByUser[uid]?.full_name || 'Employee';
      const activeSet = new Set(empRows.map(e => e.user_id));

      const anomalies = [];
      const add = (category, severity, user_id, when, description) =>
        anomalies.push({ category, severity, user_id, name: nameOf(user_id), department: empByUser[user_id]?.department || '', when, description });

      // ── Attendance (last 60 days) ──
      const att = (await all("SELECT user_id,data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1", [d60])).map(r => ({ user_id: r.user_id, ...JSON.parse(r.data) }));
      for (const a of att) {
        if (!activeSet.has(a.user_id)) continue;
        const ci = a.check_in_time ? new Date(a.check_in_time) : null;
        const co = a.check_out_time ? new Date(a.check_out_time) : null;
        if (ci && co) {
          const hrs = (co - ci) / 3600000;
          if (hrs < 0) add('attendance', 'high', a.user_id, a.date, `Check-out is before check-in on ${a.date}`);
          else if (hrs > 16) add('attendance', 'medium', a.user_id, a.date, `Implausibly long workday (${hrs.toFixed(1)}h) on ${a.date}`);
        }
        if (ci && !co && a.date < today && a.status === 'present') {
          add('attendance', 'low', a.user_id, a.date, `Missing check-out on ${a.date}`);
        }
        const punches = Array.isArray(a.punch_sessions) ? a.punch_sessions.length : 0;
        if (punches > 10) add('attendance', 'low', a.user_id, a.date, `Unusually high punch count (${punches}) on ${a.date}`);
      }

      // Present while on approved leave
      const approvedLeaves = (await all("SELECT user_id,data FROM entities WHERE type='Leave' AND status='approved' AND data::jsonb->>'end_date' >= $1", [d60])).map(r => ({ user_id: r.user_id, ...JSON.parse(r.data) }));
      const attByKey = new Set(att.filter(a => a.check_in_time).map(a => `${a.user_id}|${a.date}`));
      for (const lv of approvedLeaves) {
        if (!lv.start_date || !lv.end_date) continue;
        for (let d = new Date(lv.start_date); d <= new Date(lv.end_date); d.setDate(d.getDate() + 1)) {
          const ds = d.toISOString().slice(0, 10);
          if (ds < d60 || ds > today) continue;
          if (attByKey.has(`${lv.user_id}|${ds}`)) add('attendance', 'medium', lv.user_id, ds, `Marked present on ${ds} while on approved leave`);
        }
      }

      // ── Payroll ──
      const payrolls = (await all("SELECT user_id,data FROM entities WHERE type='Payroll'")).map(r => ({ user_id: r.user_id, ...JSON.parse(r.data) }));
      // Duplicates + invalid values
      const seen = {};
      const byUser = {};
      for (const pr of payrolls) {
        const key = `${pr.user_id}|${pr.year}|${pr.month}`;
        if (seen[key]) add('payroll', 'high', pr.user_id, `${pr.month}/${pr.year}`, `Duplicate payroll record for ${pr.month}/${pr.year}`);
        seen[key] = true;

        const net = Number(pr.net_salary || 0), gross = Number(pr.gross_salary ?? pr.gross ?? 0);
        if (activeSet.has(pr.user_id)) {
          if (gross > 0 && net > gross) add('payroll', 'high', pr.user_id, `${pr.month}/${pr.year}`, `Net salary (₹${net}) exceeds gross (₹${gross})`);
          if (net <= 0) add('payroll', 'medium', pr.user_id, `${pr.month}/${pr.year}`, `Zero / negative net salary for ${pr.month}/${pr.year}`);
        }
        if (!byUser[pr.user_id]) byUser[pr.user_id] = [];
        byUser[pr.user_id].push(pr);
      }
      // Month-over-month deviation > 30%
      for (const uid of Object.keys(byUser)) {
        if (!activeSet.has(uid)) continue;
        const list = byUser[uid].filter(p => p.net_salary).sort((a, b) => (a.year - b.year) || (a.month - b.month));
        for (let i = 1; i < list.length; i++) {
          const prev = Number(list[i - 1].net_salary), cur = Number(list[i].net_salary);
          if (prev > 0) {
            const dev = ((cur - prev) / prev) * 100;
            if (Math.abs(dev) >= 30) {
              add('payroll', 'medium', uid, `${list[i].month}/${list[i].year}`, `Net salary ${dev > 0 ? 'jumped' : 'dropped'} ${Math.abs(dev).toFixed(0)}% vs previous month (₹${prev} → ₹${cur})`);
            }
          }
        }
      }

      const order = { high: 0, medium: 1, low: 2 };
      anomalies.sort((a, b) => order[a.severity] - order[b.severity]);
      const summary = {
        total: anomalies.length,
        high: anomalies.filter(a => a.severity === 'high').length,
        medium: anomalies.filter(a => a.severity === 'medium').length,
        low: anomalies.filter(a => a.severity === 'low').length,
        attendance: anomalies.filter(a => a.category === 'attendance').length,
        payroll: anomalies.filter(a => a.category === 'payroll').length,
        as_of: today,
      };
      return res.json({ success: true, summary, anomalies });
    }

    /* ── Attrition Risk (predictive) ─────────────────── */
    case 'getAttritionRisk': {
      if (!(await hasRole(cu, MGR_ROLES))) return res.status(403).json({ error: 'Manager/HR access required' });
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const d90 = new Date(now.getTime() - 90 * 864e5).toISOString().slice(0, 10);
      const d60 = new Date(now.getTime() - 60 * 864e5).toISOString().slice(0, 10);

      // Batch-load everything once (avoid N+1)
      const employees = (await all("SELECT id,user_id,data,created_at FROM entities WHERE type='Employee' AND status='active'"))
        .map(r => ({ ...JSON.parse(r.data), _id: r.id, _created: r.created_at }));
      const exits = (await all("SELECT user_id FROM entities WHERE type='Exit'")).map(r => r.user_id);
      const exitedSet = new Set(exits.filter(Boolean));

      const pips = (await all("SELECT user_id,status FROM entities WHERE type='PerformanceImprovementPlan'"))
        .reduce((m, r) => { if (['active', 'in_progress', 'open'].includes((r.status || '').toLowerCase())) m.add(r.user_id); return m; }, new Set());

      const reviews = (await all("SELECT user_id,data,created_at FROM entities WHERE type='PerformanceReview'")).map(r => ({ user_id: r.user_id, ...JSON.parse(r.data), _created: r.created_at }));
      const latestReview = {};
      for (const rv of reviews) {
        if (!latestReview[rv.user_id] || (rv._created || '') > (latestReview[rv.user_id]._created || '')) latestReview[rv.user_id] = rv;
      }

      const recentLeaves = (await all("SELECT user_id,data FROM entities WHERE type='Leave' AND status='approved' AND data::jsonb->>'start_date' >= $1", [d90])).map(r => ({ user_id: r.user_id, ...JSON.parse(r.data) }));
      const leaveDaysByUser = recentLeaves.reduce((m, l) => { m[l.user_id] = (m[l.user_id] || 0) + (Number(l.total_days) || 1); return m; }, {});

      const recentAtt = (await all("SELECT user_id,data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1", [d60])).map(r => ({ user_id: r.user_id, ...JSON.parse(r.data) }));
      const absentByUser = recentAtt.reduce((m, a) => { if (['absent', 'half_day'].includes(a.status)) m[a.user_id] = (m[a.user_id] || 0) + 1; return m; }, {});

      const openTix = (await all("SELECT user_id FROM entities WHERE type='HelpdeskTicket' AND status NOT IN ('resolved','closed')"))
        .reduce((m, r) => { m[r.user_id] = (m[r.user_id] || 0) + 1; return m; }, {});

      // Latest salary structure per user → compensation staleness
      const salStructs = (await all("SELECT user_id,created_at FROM entities WHERE type='SalaryStructure'"));
      const lastSalaryDate = {};
      for (const s of salStructs) {
        if (!lastSalaryDate[s.user_id] || (s.created_at || '') > lastSalaryDate[s.user_id]) lastSalaryDate[s.user_id] = s.created_at;
      }

      const monthsBetween = (fromStr) => {
        if (!fromStr) return null;
        const f = new Date(fromStr);
        if (isNaN(f.getTime())) return null;
        return (now.getFullYear() - f.getFullYear()) * 12 + (now.getMonth() - f.getMonth());
      };

      const results = [];
      for (const emp of employees) {
        const uid = emp.user_id;
        if (!uid || exitedSet.has(uid)) continue;

        let score = 0;
        const factors = [];

        // Resignation / notice period
        const st = (emp.employee_status || '').toLowerCase();
        if (['resigned', 'notice', 'serving_notice', 'absconding'].some(s => st.includes(s))) {
          score += 45; factors.push({ label: 'Serving notice / resigned', weight: 45, severity: 'high' });
        }

        // Active PIP
        if (pips.has(uid)) { score += 30; factors.push({ label: 'On active performance improvement plan', weight: 30, severity: 'high' }); }

        // Performance rating (0–5)
        const rating = latestReview[uid]?.overall_rating;
        if (typeof rating === 'number') {
          if (rating < 2.5) { score += 22; factors.push({ label: `Low performance rating (${rating.toFixed(1)}/5)`, weight: 22, severity: 'high' }); }
          else if (rating < 3.2) { score += 11; factors.push({ label: `Below-par performance rating (${rating.toFixed(1)}/5)`, weight: 11, severity: 'medium' }); }
          else if (rating >= 4.5) { score += 6; factors.push({ label: `Top performer (${rating.toFixed(1)}/5) — high-value retention target`, weight: 6, severity: 'low' }); }
        }

        // Tenure sweet-spot (12–30 months is peak flight window)
        const tenure = monthsBetween(emp.date_of_joining);
        if (tenure !== null) {
          if (tenure >= 12 && tenure <= 30) { score += 12; factors.push({ label: `In peak attrition window (${tenure} months tenure)`, weight: 12, severity: 'medium' }); }
          else if (tenure > 48) { score += 8; factors.push({ label: `Long tenure without recent change (${Math.floor(tenure / 12)}+ yrs)`, weight: 8, severity: 'low' }); }
        }

        // Compensation staleness
        const salMonths = monthsBetween(lastSalaryDate[uid]);
        if (salMonths !== null && salMonths >= 18) { score += 14; factors.push({ label: `No salary revision in ${salMonths} months`, weight: 14, severity: 'medium' }); }

        // Recent leave spike
        const ld = leaveDaysByUser[uid] || 0;
        if (ld > 8) { score += 14; factors.push({ label: `High recent leave (${ld} days / 90d)`, weight: 14, severity: 'medium' }); }
        else if (ld >= 5) { score += 7; factors.push({ label: `Elevated recent leave (${ld} days / 90d)`, weight: 7, severity: 'low' }); }

        // Absenteeism
        const ab = absentByUser[uid] || 0;
        if (ab >= 4) { score += 14; factors.push({ label: `Frequent absence/half-days (${ab} in 60d)`, weight: 14, severity: 'medium' }); }
        else if (ab >= 2) { score += 7; factors.push({ label: `Some absence/half-days (${ab} in 60d)`, weight: 7, severity: 'low' }); }

        // Unresolved grievances
        const tix = openTix[uid] || 0;
        if (tix >= 2) { score += 8; factors.push({ label: `${tix} open helpdesk grievances`, weight: 8, severity: 'low' }); }

        score = Math.min(100, score);
        const band = score >= 60 ? 'High' : score >= 32 ? 'Medium' : 'Low';

        results.push({
          user_id: uid,
          employee_id: emp._id,
          name: emp.display_name || emp.full_name || 'Employee',
          employee_code: emp.employee_code || '',
          department: emp.department || '',
          designation: emp.designation || '',
          tenure_months: tenure,
          risk_score: score,
          risk_band: band,
          factors: factors.sort((a, b) => b.weight - a.weight),
        });
      }

      results.sort((a, b) => b.risk_score - a.risk_score);
      const summary = {
        total: results.length,
        high: results.filter(r => r.risk_band === 'High').length,
        medium: results.filter(r => r.risk_band === 'Medium').length,
        low: results.filter(r => r.risk_band === 'Low').length,
        as_of: today,
      };
      return res.json({ success: true, summary, employees: results });
    }

    case 'getRetentionPlan': {
      if (!(await hasRole(cu, MGR_ROLES))) return res.status(403).json({ error: 'Manager/HR access required' });
      const ruid = p.user_id;
      if (!ruid) return res.json({ success: false, error: 'user_id required' });
      const rEmpRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [ruid]);
      const rEmp = rEmpRow ? JSON.parse(rEmpRow.data) : {};
      const factors = Array.isArray(p.factors) ? p.factors : [];

      const prompt = `You are a senior HR business partner at Maxvolt Energy (India, manufacturing/energy).
Create a concise, practical retention plan for this at-risk employee.

EMPLOYEE: ${rEmp.display_name || 'Employee'} — ${rEmp.designation || 'N/A'}, ${rEmp.department || 'N/A'} dept.
Tenure: ${p.tenure_months ?? 'N/A'} months. Risk score: ${p.risk_score ?? 'N/A'}/100 (${p.risk_band || 'N/A'}).
DETECTED RISK FACTORS: ${factors.map(f => f.label).join('; ') || 'general flight risk'}.

Return ONLY valid JSON (no markdown):
{
  "summary": "2-sentence assessment of why this person may leave",
  "immediate_actions": ["action manager should take this week", "..."],
  "medium_term_actions": ["action over next 1-3 months", "..."],
  "talking_points": ["specific thing the manager should say in a 1:1", "..."],
  "retention_levers": ["lever like compensation review / growth path / workload", "..."]
}`;

      let plan;
      try { plan = await callAI(prompt, { json: true }); }
      catch (e) { return res.json({ success: false, error: `AI failed: ${e.message}` }); }
      if (!plan) return res.json({ success: false, error: 'AI returned invalid response' });
      return res.json({ success: true, plan });
    }

    /* ── Employee Experience: Pulse Surveys / eNPS ───── */
    case 'createPulseSurvey': {
      if (!(await hasRole(cu, HR_ROLES))) return res.status(403).json({ error: 'HR access required' });
      const { title, description = '', type = 'pulse', questions = [], closes_at = null } = p;
      if (!title || !Array.isArray(questions) || questions.length === 0) return res.json({ success: false, error: 'Title and at least one question are required' });
      const sid = uuidv4();
      const sData = {
        id: sid, title, description, type, // 'pulse' | 'enps'
        questions: questions.map((q, i) => ({ id: q.id || `q${i + 1}`, text: q.text, type: q.type || 'rating' })),
        status: 'active', anonymous: true, created_by: cu.id, created_at: new Date().toISOString(), closes_at,
      };
      await run("INSERT INTO entities(id,type,status,data) VALUES($1,'PulseSurvey','active',$2)", [sid, JSON.stringify(sData)]);

      // Notify all active employees
      try {
        const targets = await all("SELECT user_id FROM entities WHERE type='Employee' AND status='active'");
        const { sendPushToUser } = await import('../utils/push.js');
        for (const t of targets) {
          if (!t.user_id) continue;
          await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)",
            [uuidv4(), t.user_id, '📋 New survey', `Please share your feedback: ${title}`, 'info', '/PulseSurveys']);
          sendPushToUser(t.user_id, { title: '📋 New survey', message: title, type: 'info', link: '/PulseSurveys' });
        }
      } catch (ne) { console.warn('[createPulseSurvey] notify failed:', ne.message); }

      return res.json({ success: true, survey: sData });
    }

    case 'getPulseSurveys': {
      if (!cu) return res.status(401).json({ error: 'Unauthorized' });
      const isHR = ['hr', 'admin'].includes(cu.role);
      const surveys = (await all("SELECT id,data,status,created_at FROM entities WHERE type='PulseSurvey' ORDER BY created_at DESC"))
        .map(r => ({ ...JSON.parse(r.data), status: r.status }));
      // Which surveys has the current user responded to?
      const myResp = (await all("SELECT data FROM entities WHERE type='SurveyResponse' AND user_id=$1", [cu.id]))
        .map(r => JSON.parse(r.data).survey_id);
      const mySet = new Set(myResp);
      // Response counts
      const counts = {};
      (await all("SELECT data FROM entities WHERE type='SurveyResponse'")).forEach(r => {
        const sid = JSON.parse(r.data).survey_id; counts[sid] = (counts[sid] || 0) + 1;
      });
      const out = surveys.map(s => ({
        ...s,
        completed: mySet.has(s.id),
        response_count: counts[s.id] || 0,
      }));
      return res.json({ success: true, surveys: out, is_hr: isHR });
    }

    case 'submitSurveyResponse': {
      if (!cu) return res.status(401).json({ error: 'Unauthorized' });
      const { survey_id, answers } = p;
      if (!survey_id || !answers) return res.json({ success: false, error: 'survey_id and answers required' });
      const sRow = await one("SELECT data,status FROM entities WHERE type='PulseSurvey' AND id=$1", [survey_id]);
      if (!sRow) return res.json({ success: false, error: 'Survey not found' });
      if (sRow.status !== 'active') return res.json({ success: false, error: 'This survey is closed' });
      const dup = await one("SELECT id FROM entities WHERE type='SurveyResponse' AND user_id=$1 AND data::jsonb->>'survey_id'=$2", [cu.id, survey_id]);
      if (dup) return res.json({ success: false, error: 'You have already responded to this survey' });
      const rid = uuidv4();
      // user_id stored only for dedup; never returned in aggregation
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'SurveyResponse',$2,'submitted',$3)",
        [rid, cu.id, JSON.stringify({ id: rid, survey_id, answers, submitted_at: new Date().toISOString() })]);
      return res.json({ success: true });
    }

    case 'closePulseSurvey': {
      if (!(await hasRole(cu, HR_ROLES))) return res.status(403).json({ error: 'HR access required' });
      const { survey_id } = p;
      const sRow = await one("SELECT data FROM entities WHERE type='PulseSurvey' AND id=$1", [survey_id]);
      if (!sRow) return res.json({ success: false, error: 'Survey not found' });
      const sd = { ...JSON.parse(sRow.data), status: 'closed', closed_at: new Date().toISOString() };
      await run("UPDATE entities SET status='closed', data=$1 WHERE id=$2", [JSON.stringify(sd), survey_id]);
      return res.json({ success: true });
    }

    case 'getSurveyResults': {
      if (!(await hasRole(cu, HR_ROLES))) return res.status(403).json({ error: 'HR access required' });
      const { survey_id } = p;
      const sRow = await one("SELECT data,status FROM entities WHERE type='PulseSurvey' AND id=$1", [survey_id]);
      if (!sRow) return res.json({ success: false, error: 'Survey not found' });
      const survey = { ...JSON.parse(sRow.data), status: sRow.status };

      const responses = (await all("SELECT data FROM entities WHERE type='SurveyResponse' AND data::jsonb->>'survey_id'=$1", [survey_id]))
        .map(r => JSON.parse(r.data).answers || {}); // identity intentionally dropped

      const totalActive = (await one("SELECT COUNT(*) as c FROM entities WHERE type='Employee' AND status='active'"))?.c || 0;
      const responseCount = responses.length;
      const responseRate = totalActive > 0 ? Math.round((responseCount / Number(totalActive)) * 100) : 0;

      // Per-question aggregation
      const questionStats = survey.questions.map(q => {
        const vals = responses.map(a => a[q.id]).filter(v => v !== undefined && v !== '');
        if (q.type === 'text') {
          return { id: q.id, text: q.text, type: 'text', comments: vals.map(String).slice(0, 200) };
        }
        const nums = vals.map(Number).filter(v => !isNaN(v));
        const avg = nums.length ? parseFloat((nums.reduce((s, v) => s + v, 0) / nums.length).toFixed(2)) : 0;
        // distribution
        const dist = {};
        nums.forEach(v => { dist[v] = (dist[v] || 0) + 1; });
        return { id: q.id, text: q.text, type: q.type, average: avg, count: nums.length, distribution: dist };
      });

      // eNPS — find an 'nps' (0-10) question
      let enps = null;
      const npsQ = survey.questions.find(q => q.type === 'nps');
      if (npsQ) {
        const scores = responses.map(a => Number(a[npsQ.id])).filter(v => !isNaN(v));
        if (scores.length) {
          const promoters = scores.filter(v => v >= 9).length;
          const detractors = scores.filter(v => v <= 6).length;
          const passives = scores.length - promoters - detractors;
          enps = {
            score: Math.round(((promoters - detractors) / scores.length) * 100),
            promoters, passives, detractors, total: scores.length,
            promoter_pct: Math.round((promoters / scores.length) * 100),
            passive_pct: Math.round((passives / scores.length) * 100),
            detractor_pct: Math.round((detractors / scores.length) * 100),
          };
        }
      }

      return res.json({ success: true, survey, response_count: responseCount, response_rate: responseRate, questions: questionStats, enps });
    }

    /* ── Statutory: Gratuity (Payment of Gratuity Act) ─ */
    case 'getGratuityReport': {
      if (!(await hasRole(cu, HR_ROLES))) return res.status(403).json({ error: 'HR access required' });
      const GRATUITY_CAP = 2000000; // ₹20,00,000 statutory ceiling
      const now = new Date();
      const today = now.toISOString().slice(0, 10);

      const employees = (await all("SELECT id,user_id,data FROM entities WHERE type='Employee' AND status='active'"))
        .map(r => ({ ...JSON.parse(r.data), _id: r.id }));

      // Latest salary structure per user (for last-drawn basic + DA)
      const ssRows = (await all("SELECT user_id,data,created_at FROM entities WHERE type='SalaryStructure'"))
        .map(r => ({ user_id: r.user_id, _created: r.created_at, ...JSON.parse(r.data) }));
      const latestSS = {};
      for (const s of ssRows) {
        if (!latestSS[s.user_id] || (s._created || '') > (latestSS[s.user_id]._created || '')) latestSS[s.user_id] = s;
      }

      const yearsBetween = (fromStr) => {
        const f = new Date(fromStr);
        if (isNaN(f.getTime())) return null;
        return (now - f) / (365.25 * 864e5);
      };
      // Payment of Gratuity Act rounding: >6 months rounds up, else down
      const completedYearsForPayout = (yrs) => {
        const whole = Math.floor(yrs);
        const frac = yrs - whole;
        return frac > 0.5 ? whole + 1 : whole;
      };

      const rows = [];
      let totalLiability = 0, totalPayableNow = 0;
      for (const emp of employees) {
        if (!emp.date_of_joining) continue;
        const yrs = yearsBetween(emp.date_of_joining);
        if (yrs === null || yrs < 0) continue;
        const ss = latestSS[emp.user_id] || {};
        const monthlyBasic = (ss.basic_salary || 0) + (ss.dearness_allowance || ss.da || 0);
        if (!monthlyBasic) continue; // no salary structure → can't compute

        // Accrued accounting liability (from day one, on exact tenure)
        const accrued = Math.min(GRATUITY_CAP, Math.round((15 / 26) * monthlyBasic * yrs));
        // Payable if exit today (only if eligible ≥5 yrs, statutory rounding)
        const eligible = yrs >= 5;
        const payableNow = eligible ? Math.min(GRATUITY_CAP, Math.round((15 / 26) * monthlyBasic * completedYearsForPayout(yrs))) : 0;

        totalLiability += accrued;
        totalPayableNow += payableNow;

        rows.push({
          user_id: emp.user_id,
          name: emp.display_name || emp.full_name || 'Employee',
          employee_code: emp.employee_code || '',
          department: emp.department || '',
          date_of_joining: emp.date_of_joining,
          years_of_service: parseFloat(yrs.toFixed(2)),
          monthly_basic: Math.round(monthlyBasic),
          eligible,
          near_eligible: !eligible && yrs >= 4,
          accrued_liability: accrued,
          payable_if_exit_today: payableNow,
        });
      }

      rows.sort((a, b) => b.accrued_liability - a.accrued_liability);
      const summary = {
        as_of: today,
        cap: GRATUITY_CAP,
        employees_with_structure: rows.length,
        eligible_count: rows.filter(r => r.eligible).length,
        near_eligible_count: rows.filter(r => r.near_eligible).length,
        total_accrued_liability: totalLiability,
        total_payable_if_exit: totalPayableNow,
      };
      return res.json({ success: true, summary, employees: rows });
    }

    /* ── Statutory: PF ECR + ESI registers ───────────── */
    case 'getStatutoryRegisters': {
      if (!(await hasRole(cu, HR_ROLES))) return res.status(403).json({ error: 'HR access required' });
      const PF_WAGE_CEILING = 15000;
      const ESI_GROSS_CEILING = 21000;
      const now = new Date();
      const month = Number(p.month) || (now.getMonth() + 1); // 1-12
      const year = Number(p.year) || now.getFullYear();
      const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const monthEnd = `${year}-${String(month).padStart(2, '0')}-31`;

      const emps = (await all("SELECT user_id,data FROM entities WHERE type='Employee' AND status='active'")).map(r => JSON.parse(r.data));
      const ssAll = (await all("SELECT user_id,data,created_at FROM entities WHERE type='SalaryStructure'"));
      const latestSS = {};
      for (const s of ssAll) { if (!latestSS[s.user_id] || (s.created_at || '') > (latestSS[s.user_id]._c || '')) latestSS[s.user_id] = { ...JSON.parse(s.data), _c: s.created_at }; }

      // Non-contributory (LOP/absent) days per user this month
      const attMonth = (await all("SELECT user_id,data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2", [monthStart, monthEnd])).map(r => ({ user_id: r.user_id, ...JSON.parse(r.data) }));
      const ncpByUser = attMonth.reduce((m, a) => { if (a.status === 'absent') m[a.user_id] = (m[a.user_id] || 0) + 1; else if (a.status === 'half_day') m[a.user_id] = (m[a.user_id] || 0) + 0.5; return m; }, {});

      const pfRows = [], esiRows = [];
      let pfTot = { gross: 0, epfWages: 0, ee: 0, erEPS: 0, erEPF: 0, total: 0 };
      let esiTot = { gross: 0, ee: 0, er: 0, total: 0 };

      for (const emp of emps) {
        const ss = latestSS[emp.user_id];
        if (!ss) continue;
        const basic = (ss.basic_salary || 0) + (ss.dearness_allowance || ss.da || 0);
        const gross = Math.round(ss.grossMonthly || 0);
        const name = emp.display_name || emp.full_name || 'Employee';
        const ncp = ncpByUser[emp.user_id] || 0;

        // ── PF ──
        const epfWages = Math.round(Math.min(basic, PF_WAGE_CEILING));
        if (epfWages > 0) {
          const ee = Math.round(epfWages * 0.12);
          const erEPS = Math.round(epfWages * 0.0833);
          const erEPF = Math.round(epfWages * 0.12) - erEPS;
          pfRows.push({
            uan: emp.uan_number || '', name,
            gross_wages: gross, epf_wages: epfWages, eps_wages: epfWages, edli_wages: epfWages,
            ee_epf: ee, er_eps: erEPS, er_epf: erEPF, ncp_days: ncp, refund: 0,
          });
          pfTot.gross += gross; pfTot.epfWages += epfWages; pfTot.ee += ee; pfTot.erEPS += erEPS; pfTot.erEPF += erEPF; pfTot.total += ee + erEPS + erEPF;
        }

        // ── ESI (gross ≤ 21000 and applicable) ──
        if (gross > 0 && gross <= ESI_GROSS_CEILING && emp.is_esi_applicable !== false) {
          const ee = Math.round(gross * 0.0075);
          const er = Math.round(gross * 0.0325);
          esiRows.push({ esi_number: emp.esi_number || '', name, gross_wages: gross, ee_esi: ee, er_esi: er, total: ee + er });
          esiTot.gross += gross; esiTot.ee += ee; esiTot.er += er; esiTot.total += ee + er;
        }
      }

      // EPFO ECR v2.0 text — 11 fields, #~# delimited, one member per line
      const ecrText = pfRows.map(r =>
        [r.uan, r.name, r.gross_wages, r.epf_wages, r.eps_wages, r.edli_wages, r.ee_epf, r.er_eps, r.er_epf, r.ncp_days, r.refund].join('#~#')
      ).join('\n');

      return res.json({
        success: true,
        period: { month, year, label: new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }) },
        pf: { rows: pfRows, totals: pfTot, ecr_text: ecrText, member_count: pfRows.length },
        esi: { rows: esiRows, totals: esiTot, member_count: esiRows.length },
      });
    }

    /* ── Statutory: Form 16 / TDS (Income Tax) ───────── */
    case 'getForm16Data': {
      const f16Uid = p.user_id;
      // HR can view anyone; an employee may view only their own
      if (!(await hasRole(cu, HR_ROLES)) && cu?.id !== f16Uid) return res.status(403).json({ error: 'Access denied' });
      const fy = p.financial_year || (() => { const n = new Date(); return n.getMonth() >= 3 ? `${n.getFullYear()}-${n.getFullYear() + 1}` : `${n.getFullYear() - 1}-${n.getFullYear()}`; })();
      if (!f16Uid) return res.json({ success: false, error: 'user_id required' });

      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [f16Uid]);
      if (!empRow) return res.json({ success: false, error: 'Employee not found' });
      const emp = JSON.parse(empRow.data);
      const uRow = await one("SELECT email,full_name FROM users WHERE id=$1", [f16Uid]);

      const ssRow = await one("SELECT data,created_at FROM entities WHERE type='SalaryStructure' AND user_id=$1 ORDER BY created_at DESC LIMIT 1", [f16Uid]);
      const ss = ssRow ? JSON.parse(ssRow.data) : {};
      const basicAnnual = (ss.basic_salary || 0) * 12;
      const hraReceivedAnnual = (ss.hra || 0) * 12;
      const grossSalary = Math.round((ss.grossMonthly || 0) * 12);

      // Declared investments
      const tdRow = await one("SELECT data FROM entities WHERE type='TaxDeclaration' AND user_id=$1 AND data::jsonb->>'financial_year'=$2", [f16Uid, fy]);
      const decl = tdRow ? (JSON.parse(tdRow.data).declarations || {}) : {};
      const num = (k) => Number(decl[k] || 0);

      // Chapter VI-A
      const sec80C = Math.min(150000,
        num('life_insurance_premium') + num('ppf') + num('elss') + num('nsc') + num('home_loan_principal') +
        num('tuition_fees') + num('sukanya_samriddhi') + num('five_yr_fd') + num('nps_80c'));
      const sec80D = Math.min(75000, num('health_insurance_self') + num('health_insurance_parents') + Math.min(5000, num('preventive_checkup')));
      const sec80CCD1B = Math.min(50000, num('nps_additional'));
      const sec80E = num('education_loan_interest'); // no cap
      const sec80G = num('donations_100pct') + Math.round(num('donations_50pct') * 0.5);
      const chapterVIA = sec80C + sec80D + sec80CCD1B + sec80E + sec80G;

      // HRA exemption (old regime) = least of: actual HRA, rent − 10% basic, 50%/40% basic
      const rentPaid = num('hra_rent_paid');
      const isMetro = (decl.hra_city || '').toLowerCase() === 'metro';
      let hraExemption = 0;
      if (rentPaid > 0 && hraReceivedAnnual > 0) {
        hraExemption = Math.max(0, Math.min(
          hraReceivedAnnual,
          rentPaid - 0.10 * basicAnnual,
          (isMetro ? 0.50 : 0.40) * basicAnnual
        ));
      }
      const profTax = 2400; // standard annual professional tax

      const oldCalc = computeRegime('old', { grossSalary, hraExemption, chapterVIA, profTax });
      const newCalc = computeRegime('new', { grossSalary });
      const recommended = newCalc.total_tax <= oldCalc.total_tax ? 'new' : 'old';
      const chosen = (decl.regime === 'old' || decl.regime === 'new') ? decl.regime : recommended;
      const annualTax = chosen === 'new' ? newCalc.total_tax : oldCalc.total_tax;

      return res.json({
        success: true,
        financial_year: fy,
        assessment_year: (() => { const [a, b] = fy.split('-').map(Number); return `${b}-${b + 1}`; })(),
        employee: {
          name: emp.display_name || uRow?.full_name || 'Employee',
          employee_code: emp.employee_code || '',
          pan: emp.pan_number || emp.pan || '',
          designation: emp.designation || '',
          department: emp.department || '',
          date_of_joining: emp.date_of_joining || '',
        },
        income: {
          gross_salary: grossSalary,
          basic_annual: basicAnnual,
          hra_received_annual: hraReceivedAnnual,
        },
        deductions: { sec80C, sec80D, sec80CCD1B, sec80E, sec80G, hra_exemption: Math.round(hraExemption), professional_tax: profTax, chapter_via_total: chapterVIA },
        old_regime: oldCalc,
        new_regime: newCalc,
        recommended_regime: recommended,
        chosen_regime: chosen,
        annual_tax: annualTax,
        monthly_tds: Math.round(annualTax / 12),
        declaration_status: tdRow ? (JSON.parse(tdRow.data).status || 'none') : 'none',
      });
    }

    case 'getTDSSummary': {
      if (!(await hasRole(cu, HR_ROLES))) return res.status(403).json({ error: 'HR access required' });
      const fy2 = p.financial_year || (() => { const n = new Date(); return n.getMonth() >= 3 ? `${n.getFullYear()}-${n.getFullYear() + 1}` : `${n.getFullYear() - 1}-${n.getFullYear()}`; })();
      const emps = (await all("SELECT user_id,data FROM entities WHERE type='Employee' AND status='active'")).map(r => JSON.parse(r.data));
      const ssAll = (await all("SELECT user_id,data,created_at FROM entities WHERE type='SalaryStructure'"));
      const latestSS = {};
      for (const s of ssAll) { if (!latestSS[s.user_id] || (s.created_at || '') > (latestSS[s.user_id]._c || '')) latestSS[s.user_id] = { ...JSON.parse(s.data), _c: s.created_at }; }
      const tds = (await all("SELECT user_id,data FROM entities WHERE type='TaxDeclaration' AND data::jsonb->>'financial_year'=$1", [fy2]));
      const declByUser = {};
      for (const t of tds) { const d = JSON.parse(t.data); declByUser[t.user_id] = d.declarations || {}; }

      const rows = [];
      let totalTDS = 0;
      for (const emp of emps) {
        const ss = latestSS[emp.user_id];
        if (!ss) continue;
        const grossSalary = Math.round((ss.grossMonthly || 0) * 12);
        if (!grossSalary) continue;
        const decl = declByUser[emp.user_id] || {};
        const num = (k) => Number(decl[k] || 0);
        const sec80C = Math.min(150000, num('life_insurance_premium') + num('ppf') + num('elss') + num('nsc') + num('home_loan_principal') + num('tuition_fees') + num('sukanya_samriddhi') + num('five_yr_fd') + num('nps_80c'));
        const sec80D = Math.min(75000, num('health_insurance_self') + num('health_insurance_parents') + Math.min(5000, num('preventive_checkup')));
        const chapterVIA = sec80C + sec80D + Math.min(50000, num('nps_additional')) + num('education_loan_interest') + num('donations_100pct') + Math.round(num('donations_50pct') * 0.5);
        const basicAnnual = (ss.basic_salary || 0) * 12;
        const rentPaid = num('hra_rent_paid');
        const isMetro = (decl.hra_city || '').toLowerCase() === 'metro';
        const hraReceived = (ss.hra || 0) * 12;
        let hraExemption = 0;
        if (rentPaid > 0 && hraReceived > 0) hraExemption = Math.max(0, Math.min(hraReceived, rentPaid - 0.10 * basicAnnual, (isMetro ? 0.50 : 0.40) * basicAnnual));
        const oldCalc = computeRegime('old', { grossSalary, hraExemption, chapterVIA, profTax: 2400 });
        const newCalc = computeRegime('new', { grossSalary });
        const chosen = (decl.regime === 'old' || decl.regime === 'new') ? decl.regime : (newCalc.total_tax <= oldCalc.total_tax ? 'new' : 'old');
        const annualTax = chosen === 'new' ? newCalc.total_tax : oldCalc.total_tax;
        totalTDS += annualTax;
        rows.push({
          user_id: emp.user_id, name: emp.display_name || 'Employee', employee_code: emp.employee_code || '',
          department: emp.department || '', pan: emp.pan_number || emp.pan || '',
          gross_salary: grossSalary, regime: chosen, annual_tax: annualTax, monthly_tds: Math.round(annualTax / 12),
          declared: !!declByUser[emp.user_id],
        });
      }
      rows.sort((a, b) => b.annual_tax - a.annual_tax);
      return res.json({
        success: true, financial_year: fy2,
        summary: { employees: rows.length, total_annual_tds: totalTDS, total_monthly_tds: Math.round(totalTDS / 12), taxable_employees: rows.filter(r => r.annual_tax > 0).length, not_declared: rows.filter(r => !r.declared).length },
        employees: rows,
      });
    }

    /* ── Employee Experience: Recognition (Kudos) ────── */
    case 'giveKudos': {
      if (!cu) return res.status(401).json({ error: 'Unauthorized' });
      const { receiver_id, value, message } = p;
      if (!receiver_id || !value) return res.json({ success: false, error: 'receiver_id and value are required' });
      if (receiver_id === cu.id) return res.json({ success: false, error: 'You cannot recognise yourself' });

      // Resolve names
      const giverEmpRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [cu.id]);
      const giverName = giverEmpRow ? (JSON.parse(giverEmpRow.data).display_name || cu.email) : cu.email;
      const recvEmpRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [receiver_id]);
      const recv = recvEmpRow ? JSON.parse(recvEmpRow.data) : {};

      const kid = uuidv4();
      const kData = {
        id: kid,
        giver_id: cu.id, giver_name: giverName,
        receiver_id, receiver_name: recv.display_name || 'Colleague',
        receiver_dept: recv.department || '',
        value, message: (message || '').slice(0, 500),
        created_at: new Date().toISOString(),
      };
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Kudos',$2,'active',$3)", [kid, receiver_id, JSON.stringify(kData)]);

      // Notify the receiver (in-app + push)
      try {
        const notifMsg = `${giverName} recognised you for ${value}${message ? ': ' + message.slice(0, 120) : ''}`;
        await run(
          "INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)",
          [uuidv4(), receiver_id, `🎉 You received recognition!`, notifMsg, 'success', '/Recognition']
        );
        const { sendPushToUser } = await import('../utils/push.js');
        sendPushToUser(receiver_id, { title: '🎉 You received recognition!', message: notifMsg, type: 'success', link: '/Recognition' });
      } catch (ne) { console.warn('[giveKudos] notify failed:', ne.message); }

      return res.json({ success: true, kudos: kData });
    }

    case 'getRecognitionData': {
      const now = new Date();
      const curMonth = now.getMonth(); // 0-based
      const monthStart = new Date(now.getFullYear(), curMonth, 1).toISOString();

      // Feed — most recent kudos
      const feed = (await all("SELECT data,created_at FROM entities WHERE type='Kudos' ORDER BY created_at DESC LIMIT 60"))
        .map(r => ({ ...JSON.parse(r.data), _created: r.created_at }));

      // Leaderboard — kudos received this month
      const monthKudos = feed.filter(k => (k.created_at || k._created || '') >= monthStart);
      const lbMap = {};
      for (const k of monthKudos) {
        if (!lbMap[k.receiver_id]) lbMap[k.receiver_id] = { user_id: k.receiver_id, name: k.receiver_name, dept: k.receiver_dept, count: 0, values: {} };
        lbMap[k.receiver_id].count++;
        lbMap[k.receiver_id].values[k.value] = (lbMap[k.receiver_id].values[k.value] || 0) + 1;
      }
      const leaderboard = Object.values(lbMap).sort((a, b) => b.count - a.count).slice(0, 10);

      // Celebrations — birthdays & work anniversaries this month
      const emps = (await all("SELECT user_id,data FROM entities WHERE type='Employee' AND status='active'")).map(r => JSON.parse(r.data));
      const birthdays = [], anniversaries = [];
      const dayOf = (s) => { const d = new Date(s); return isNaN(d.getTime()) ? null : d; };
      for (const e of emps) {
        const dob = dayOf(e.date_of_birth);
        if (dob && dob.getMonth() === curMonth) {
          birthdays.push({ user_id: e.user_id, name: e.display_name || 'Employee', dept: e.department || '', day: dob.getDate(), profile_picture_url: e.profile_picture_url || null });
        }
        const doj = dayOf(e.date_of_joining);
        if (doj && doj.getMonth() === curMonth && doj.getFullYear() < now.getFullYear()) {
          anniversaries.push({ user_id: e.user_id, name: e.display_name || 'Employee', dept: e.department || '', day: doj.getDate(), years: now.getFullYear() - doj.getFullYear(), profile_picture_url: e.profile_picture_url || null });
        }
      }
      birthdays.sort((a, b) => a.day - b.day);
      anniversaries.sort((a, b) => a.day - b.day);

      // Totals
      const totalThisMonth = monthKudos.length;
      return res.json({ success: true, feed, leaderboard, birthdays, anniversaries, total_this_month: totalThisMonth, month: now.toLocaleString('en-US', { month: 'long' }) });
    }

    /* ── Training ────────────────────────────────────── */

    /* ── Auto-grant 1 EL per 40 present days ────────── */
    case 'grantEarnedLeaveFor40Days': {
      // Every 40 actual present days (non-consecutive) → credit 1 EL.
      // "Present" = attendance status in (present, late, on_duty, work_from_home, half_day).
      // Sundays and holidays are NOT counted — only actual attendance records.
      const now        = new Date();
      const empRows    = await all("SELECT id,user_id,data FROM entities WHERE type='Employee' AND status='active'");
      const employees  = empRows.map(r => ({ id: r.id, user_id: r.user_id, ...JSON.parse(r.data) }));

      // Resolve EL leave policy (code='EL' or name contains 'Earned')
      const elPolicyRow = await one(
        "SELECT id FROM entities WHERE type='LeavePolicy' AND (data::jsonb->>'code'='EL' OR data::jsonb->>'name' ILIKE '%earned%') LIMIT 1"
      );
      const elPolicyId = elPolicyRow?.id || null;
      const currentYear = now.getFullYear();

      let granted = 0;
      const results = [];

      for (const emp of employees) {
        const startDate = emp.date_of_joining || emp.joining_date || '2020-01-01';
        // Use data::jsonb cast — entities.data is TEXT, not JSONB
        const attRows = await all(
          "SELECT data::jsonb->>'date' as d, data::jsonb->>'status' as s FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date' >= $2",
          [emp.user_id, startDate]
        );

        // Count only actual present-like attendance records (no Sundays/holidays)
        let presentCount = 0;
        for (const r of attRows) {
          if (!r.d || !r.s) continue;
          if (['present', 'late', 'on_duty', 'work_from_home', 'half_day'].includes(r.s)) {
            presentCount++;
          }
        }

        const elEntitledCount = Math.floor(presentCount / 40);
        if (elEntitledCount <= 0) continue;

        // How many EL grants have already been credited (tracked in ELAutoGrant entities)
        const grantCountRow = await one(
          "SELECT COUNT(*) as c FROM entities WHERE type='ELAutoGrant' AND user_id=$1",
          [emp.user_id]
        );
        const alreadyGranted = parseInt(grantCountRow?.c || 0);
        const toGrant = elEntitledCount - alreadyGranted;
        if (toGrant <= 0) continue;

        // Credit EL balance (look up by leave_policy_id + year; fall back to creating a new record)
        if (elPolicyId) {
          const lbRow = await one(
            "SELECT id,data FROM entities WHERE type='LeaveBalance' AND user_id=$1 AND data::jsonb->>'leave_policy_id'=$2 AND data::jsonb->>'year'=$3 LIMIT 1",
            [emp.user_id, elPolicyId, String(currentYear)]
          );
          if (lbRow) {
            const lb = JSON.parse(lbRow.data);
            await run("UPDATE entities SET data=$1 WHERE id=$2", [
              JSON.stringify({
                ...lb,
                available:       (parseFloat(lb.available)       || 0) + toGrant,
                total_allocated: (parseFloat(lb.total_allocated) || 0) + toGrant,
                updated_at: now.toISOString(),
              }),
              lbRow.id,
            ]);
          } else {
            const newId = uuidv4();
            await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'LeaveBalance',$2,'active',$3)", [
              newId, emp.user_id,
              JSON.stringify({ id: newId, user_id: emp.user_id, leave_policy_id: elPolicyId, year: currentYear, total_allocated: toGrant, available: toGrant, used: 0, pending_approval: 0, created_at: now.toISOString(), updated_at: now.toISOString() }),
            ]);
          }
        }

        // Record each grant so we never double-credit
        for (let i = 0; i < toGrant; i++) {
          const grantId = uuidv4();
          await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ELAutoGrant',$2,'active',$3)", [
            grantId, emp.user_id,
            JSON.stringify({ id: grantId, user_id: emp.user_id, days: 1, present_count_at_grant: presentCount, el_policy_id: elPolicyId, granted_at: now.toISOString() }),
          ]);
        }

        granted += toGrant;
        results.push({ employee: emp.display_name || emp.user_id, granted: toGrant, presentCount, elEntitledCount, alreadyGranted });
      }
      return res.json({ success: true, total_granted: granted, results, el_policy_found: !!elPolicyId });
    }

    /* ── Save generated letter to employee Documents ─── */
    case 'approveAndSendLetter': {
      const { user_id, letter_type, letter_content, ref, employee_name, cc } = p;
      if (!user_id || !letter_content) return res.status(400).json({ error: 'user_id and letter_content required' });

      const LETTER_LABELS = {
        appointment: 'Appointment Letter', confirmation: 'Confirmation Letter',
        promotion: 'Promotion Letter', salary_revision: 'Salary Revision Letter',
        experience: 'Experience Certificate', relieving: 'Relieving Letter',
        address_proof: 'Employment / Address Proof', warning: 'Warning Letter',
      };
      const label   = LETTER_LABELS[letter_type] || 'HR Letter';
      const today   = new Date().toISOString().slice(0, 10);
      const docId   = uuidv4();

      // Email to employee with PDF attachment (proper Maxvolt letterhead)
      let email_error = null;
      let aslDocUrl = null;
      try {
        const empUser = await one("SELECT email, full_name FROM users WHERE id=$1", [user_id]);
        if (!empUser?.email) throw new Error('Employee has no email address on record');

        const pdfBuffer = await buildLetterPdf(label, ref || '', letter_content).catch(err => {
          console.error('Letter PDF generation failed:', err.message);
          return null;
        });

        // Upload to R2 for viewable document_url
        if (pdfBuffer) {
          try {
            const { isR2Configured, buildKey, putToR2, presignGet } = await import('../utils/r2.js');
            if (isR2Configured()) {
              const r2Key = buildKey(`letters/${docId}`, '.pdf');
              await putToR2(r2Key, pdfBuffer, 'application/pdf');
              aslDocUrl = await presignGet(r2Key, { expiresIn: 31536000, filename: `${label.replace(/\s+/g,'_')}.pdf` });
            }
          } catch (r2Err) { console.warn('[approveAndSendLetter] R2 upload failed:', r2Err.message); }
        }

        const attachments = pdfBuffer
          ? [{ filename: `${label.replace(/[^a-z0-9]/gi, '_')}.pdf`, content: pdfBuffer }]
          : [];

        await sendEmail({
          to: empUser.email,
          ...(cc ? { cc } : {}),
          subject: `${label} — Maxvolt Energy Industries Limited`,
          html: `<div style="font-family:Arial,sans-serif;color:#111">
                 <p>Dear ${empUser.full_name || employee_name || 'Employee'},</p>
                 <p>Please find your <strong>${label}</strong> attached to this email as a PDF. This document has also been saved in your HR Documents section on the HRMS portal.</p>
                 ${!pdfBuffer ? '<p style="color:#c00;font-size:12px;">Note: PDF attachment could not be generated this time. Please use Print / PDF from the portal instead.</p>' : ''}
                 <p style="color:#666;font-size:12px;margin-top:20px;">This is a system-generated letter from Maxvolt HR. Please contact HR for any queries.</p>
                 </div>`,
          text: `Dear ${empUser.full_name || employee_name},\n\nPlease find your ${label} attached to this email.\n\nThis is a system-generated letter from Maxvolt HR.`,
          attachments,
        });
      } catch (e) {
        email_error = e.message;
      }

      const aslDocData = {
        id: docId, user_id,
        document_type: 'hr_letter',
        document_name: `${label}${ref ? ` (${ref})` : ''} — ${today}`,
        letter_type, letter_content, ref: ref || '',
        ...(aslDocUrl ? { document_url: aslDocUrl } : {}),
        employee_name: employee_name || '',
        status: 'verified',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Document',$2,'verified',$3)", [docId, user_id, JSON.stringify(aslDocData)]);

      return res.json({ success: true, document_id: docId, email_error });
    }

    case 'saveLetterAsDocument': {
      const { user_id, letter_type, letter_content, ref, employee_name } = p;
      if (!user_id || !letter_content) return res.status(400).json({ error: 'user_id and letter_content required' });

      const LETTER_LABELS = {
        appointment: 'Appointment Letter', confirmation: 'Confirmation Letter',
        promotion: 'Promotion Letter', salary_revision: 'Salary Revision Letter',
        experience: 'Experience Certificate', relieving: 'Relieving Letter',
        address_proof: 'Employment / Address Proof', warning: 'Warning Letter',
      };
      const docId   = uuidv4();
      const label   = LETTER_LABELS[letter_type] || 'HR Letter';
      const today   = new Date().toISOString().slice(0, 10);

      // Generate PDF and upload to R2 so the doc is viewable/downloadable
      let sldDocUrl = null;
      try {
        const pdfBuf = await buildLetterPdf(label, ref || '', letter_content);
        const { isR2Configured, buildKey, putToR2, presignGet } = await import('../utils/r2.js');
        if (pdfBuf && isR2Configured()) {
          const r2Key = buildKey(`letters/${docId}`, '.pdf');
          await putToR2(r2Key, pdfBuf, 'application/pdf');
          sldDocUrl = await presignGet(r2Key, { expiresIn: 31536000, filename: `${label.replace(/\s+/g,'_')}.pdf` });
        }
      } catch (pdfErr) { console.warn('[saveLetterAsDocument] PDF/R2 failed:', pdfErr.message); }

      const docData = {
        id: docId, user_id,
        document_type: 'hr_letter',
        document_name: `${label}${ref ? ` (${ref})` : ''} — ${today}`,
        letter_type, letter_content, ref: ref || '',
        ...(sldDocUrl ? { document_url: sldDocUrl } : {}),
        employee_name: employee_name || '',
        status: 'verified',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Document',$2,'verified',$3)", [docId, user_id, JSON.stringify(docData)]);
      return res.json({ success: true, document_id: docId });
    }

    /* ── HR Reports ─────────────────────────────────── */
    case 'generateReport': {
      const { report_type, from_date, to_date, department } = p;
      const now   = new Date();
      const fd    = from_date || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const td    = to_date   || now.toISOString().slice(0, 10);
      const byDept = (rows) => department && department !== 'all'
        ? rows.filter(e => e.department === department)
        : rows;

      switch (report_type) {

        case 'employee_master': {
          const rows = byDept(parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'")));
          rows.sort((a, b) => (a.employee_code || '').localeCompare(b.employee_code || ''));
          return res.json({
            report_type,
            columns: ['Emp Code','Name','Department','Designation','Date of Joining','Email','Mobile','Location','PF Number','ESI Number','Bank Account','IFSC'],
            rows: rows.map(e => [
              e.employee_code||'', e.display_name||e.full_name||'',
              e.department||'', e.designation||'',
              e.date_of_joining||'', e.email||'', e.mobile||e.phone||'',
              e.location||'', e.pf_number||'', e.esi_number||'',
              e.bank_account_number||'', e.ifsc_code||'',
            ]),
            total: rows.length,
          });
        }

        case 'attendance_monthly': {
          const emps    = byDept(parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'")));
          const attRows = parseEntities(await all(
            "SELECT data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2",
            [fd, td]
          ));
          const byUser = {};
          for (const a of attRows) {
            if (!byUser[a.user_id]) byUser[a.user_id] = { present: 0, absent: 0, leave: 0, half_day: 0, hours: 0 };
            const s = a.status || (a.check_in_time ? 'present' : 'absent');
            if (s === 'present')  { byUser[a.user_id].present++;  byUser[a.user_id].hours += (a.working_hours || 0); }
            else if (s === 'absent')   byUser[a.user_id].absent++;
            else if (s === 'leave')    byUser[a.user_id].leave++;
            else if (s === 'half_day') { byUser[a.user_id].half_day++; byUser[a.user_id].hours += (a.working_hours || 0); }
          }
          return res.json({
            report_type,
            columns: ['Emp Code','Name','Department','Present','Absent','Leave','Half Day','Avg Work Hrs'],
            rows: emps.map(e => {
              const a = byUser[e.user_id] || { present:0, absent:0, leave:0, half_day:0, hours:0 };
              return [
                e.employee_code||'', e.display_name||'', e.department||'',
                a.present, a.absent, a.leave, a.half_day,
                a.present > 0 ? (a.hours / a.present).toFixed(1) : '0.0',
              ];
            }),
            total: emps.length,
          });
        }

        case 'leave_balance': {
          const emps   = byDept(parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'")));
          const leaves = parseEntities(await all("SELECT data FROM entities WHERE type='Leave' AND status='approved'"));
          const usedByUser = {};
          for (const l of leaves) {
            if (!usedByUser[l.user_id]) usedByUser[l.user_id] = { cl: 0, sl: 0, el: 0, other: 0 };
            const t = (l.leave_type || '').toLowerCase();
            const d = parseFloat(l.days || l.total_days || 0);
            if (t.includes('casual') || t === 'cl')              usedByUser[l.user_id].cl += d;
            else if (t.includes('sick') || t.includes('medical') || t === 'sl') usedByUser[l.user_id].sl += d;
            else if (t.includes('earn') || t.includes('annual') || t === 'el') usedByUser[l.user_id].el += d;
            else usedByUser[l.user_id].other += d;
          }
          return res.json({
            report_type,
            columns: ['Emp Code','Name','Department','Casual Used','Sick Used','Earned Used','Other','Total Used'],
            rows: emps.map(e => {
              const u = usedByUser[e.user_id] || { cl:0, sl:0, el:0, other:0 };
              return [e.employee_code||'', e.display_name||'', e.department||'', u.cl, u.sl, u.el, u.other, +(u.cl+u.sl+u.el+u.other).toFixed(1)];
            }),
            total: emps.length,
          });
        }

        case 'payroll_summary': {
          const payRows = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll'"))
            .filter(r => {
              const d = `${r.year}-${String(r.month||1).padStart(2,'0')}-01`;
              return d >= fd && d <= td;
            });
          const filtered = department && department !== 'all'
            ? payRows.filter(r => r.department === department)
            : payRows;
          filtered.sort((a, b) => (a.year - b.year) || (a.month - b.month) || (a.employee_code||'').localeCompare(b.employee_code||''));
          return res.json({
            report_type,
            columns: ['Emp Code','Name','Department','Month','Year','Basic','HRA','Gross','TDS','PF','PT','LOP','Net Pay'],
            rows: filtered.map(r => [
              r.employee_code||'', r.employee_name||r.display_name||'', r.department||'',
              r.month, r.year,
              r.basic_salary||0, r.hra||0, r.gross_salary||0,
              r.deductions?.tds||0, r.deductions?.pf||0, r.deductions?.pt||0,
              r.loss_of_pay_amount||0, r.net_salary||0,
            ]),
            total: filtered.length,
          });
        }

        case 'new_joiners': {
          const rows = byDept(parseEntities(await all(
            "SELECT data FROM entities WHERE type='Employee' AND data::jsonb->>'date_of_joining' >= $1 AND data::jsonb->>'date_of_joining' <= $2",
            [fd, td]
          )));
          rows.sort((a, b) => (a.date_of_joining||'').localeCompare(b.date_of_joining||''));
          return res.json({
            report_type,
            columns: ['Emp Code','Name','Department','Designation','Date of Joining','Email','Mobile','Location'],
            rows: rows.map(e => [
              e.employee_code||'', e.display_name||'', e.department||'',
              e.designation||'', e.date_of_joining||'', e.email||'', e.mobile||e.phone||'', e.location||'',
            ]),
            total: rows.length,
          });
        }

        case 'exit_report': {
          const rows = parseEntities(await all(
            "SELECT data FROM entities WHERE type='Exit' AND data::jsonb->>'resignation_date' >= $1 AND data::jsonb->>'resignation_date' <= $2",
            [fd, td]
          ));
          const filtered = byDept(rows);
          filtered.sort((a, b) => (a.resignation_date||'').localeCompare(b.resignation_date||''));
          return res.json({
            report_type,
            columns: ['Name','Department','Designation','Resignation Date','Last Working Day','Exit Type','Status','Reason'],
            rows: filtered.map(r => [
              r.employee_name||'', r.department||'', r.designation||'',
              r.resignation_date||'', r.last_working_date||'',
              r.exit_type||'', r.status||'', r.reason||'',
            ]),
            total: filtered.length,
          });
        }

        case 'training_status': {
          const trainings   = parseEntities(await all("SELECT data FROM entities WHERE type='Training'"));
          const enrollments = parseEntities(await all("SELECT data FROM entities WHERE type='TrainingEnrollment'"));
          const emps        = byDept(parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'")));
          const trMap = Object.fromEntries(trainings.map(t => [t.id, t]));
          const enrollByUser = {};
          for (const en of enrollments) {
            if (!enrollByUser[en.user_id]) enrollByUser[en.user_id] = [];
            const tr = trMap[en.training_id];
            if (tr) enrollByUser[en.user_id].push({ title: tr.title, status: en.completion_status || en.status || 'enrolled', score: en.score || '' });
          }
          const rows = [];
          for (const e of emps) {
            const enList = enrollByUser[e.user_id] || [];
            if (enList.length === 0) {
              rows.push([e.employee_code||'', e.display_name||'', e.department||'', '—', 'Not enrolled', '']);
            } else {
              for (const en of enList) {
                rows.push([e.employee_code||'', e.display_name||'', e.department||'', en.title, en.status, String(en.score)]);
              }
            }
          }
          return res.json({
            report_type,
            columns: ['Emp Code','Name','Department','Training','Status','Score'],
            rows,
            total: rows.length,
          });
        }

        case 'asset_assignment': {
          const assets = parseEntities(await all("SELECT data FROM entities WHERE type='Asset' AND data::jsonb->>'status'='assigned'"));
          const emps   = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
          const empMap = Object.fromEntries(emps.map(e => [e.user_id, e]));
          const filtered = department && department !== 'all'
            ? assets.filter(a => empMap[a.assigned_to]?.department === department)
            : assets;
          return res.json({
            report_type,
            columns: ['Asset ID','Asset Name','Type','Brand','Serial No','Assigned To','Department','Assigned Date','Expected Return'],
            rows: filtered.map(a => {
              const e = empMap[a.assigned_to] || {};
              return [
                a.asset_id||a.id||'', a.asset_name||a.name||'', a.asset_type||a.category||'',
                a.brand||'', a.serial_number||'',
                e.display_name||a.assigned_to_name||'', e.department||'',
                a.assigned_date||'', a.expected_return_date||'—',
              ];
            }),
            total: filtered.length,
          });
        }

        default:
          return res.status(400).json({ error: `Unknown report type: ${report_type}` });
      }
    }

    case 'getOvertimeData': {
      const { month, year } = p;
      const startDate = `${year}-${String(month).padStart(2,'0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

      const empRows = await all("SELECT data FROM entities WHERE type='Employee' AND status='active'");
      const employees = empRows.map(r => JSON.parse(r.data));

      const overtimeData = [];
      for (const emp of employees) {
        const attRows = await all(
          "SELECT data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date' BETWEEN $2 AND $3",
          [emp.user_id, startDate, endDate]
        );
        const records = attRows.map(r => JSON.parse(r.data));
        const shiftHrs = 8; // default shift hours; actual OT = worked beyond shift
        const otRecords = records.filter(a => (a.working_hours || 0) > shiftHrs);
        const totalOTHours = otRecords.reduce((sum, a) => sum + Math.max(0, (a.working_hours || 0) - shiftHrs), 0);
        if (totalOTHours > 0) {
          const ssRow = await one("SELECT data FROM entities WHERE type='SalaryStructure' AND user_id=$1 AND status='active'", [emp.user_id]);
          const ss = ssRow ? JSON.parse(ssRow.data) : {};
          const dailyRate = (ss.basic_salary || ss.basic_monthly || 0) / 26;
          const hourlyRate = dailyRate / 8;
          const otAmount = Math.round(hourlyRate * 2 * totalOTHours); // 2x rate
          overtimeData.push({
            employee_id: emp.id, user_id: emp.user_id,
            name: emp.display_name, code: emp.employee_code, department: emp.department,
            total_ot_hours: Math.round(totalOTHours * 10) / 10,
            ot_amount: otAmount, dates: otRecords.map(a => ({ date: a.date, ot_hours: Math.max(0, (a.working_hours || 0) - shiftHrs) }))
          });
        }
      }
      const records = overtimeData.map(r => ({
        employee_name: r.name, employee_code: r.code, department: r.department,
        ot_hours: r.total_ot_hours, ot_amount: r.ot_amount, dates: r.dates,
      }));
      return res.json({
        success: true, month, year, records,
        total_ot_hours: Math.round(overtimeData.reduce((s, r) => s + r.total_ot_hours, 0) * 10) / 10,
        total_ot_amount: overtimeData.reduce((s, r) => s + r.ot_amount, 0),
        employees_with_ot: overtimeData.length,
      });
    }

    case 'getWFHReport': {
      const { month, year } = p;
      const startDate = `${year}-${String(month).padStart(2,'0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

      const wfhRows = await all(
        "SELECT e.user_id, e.data FROM entities e WHERE e.type='Attendance' AND e.data::jsonb->>'status'='work_from_home' AND e.data::jsonb->>'date' BETWEEN $1 AND $2",
        [startDate, endDate]
      );

      const byUser = {};
      for (const row of wfhRows) {
        const d = JSON.parse(row.data);
        if (!byUser[row.user_id]) byUser[row.user_id] = [];
        byUser[row.user_id].push(d.date);
      }

      const wfhResult = [];
      for (const [uid, dates] of Object.entries(byUser)) {
        const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [uid]);
        const emp = empRow ? JSON.parse(empRow.data) : {};
        wfhResult.push({ user_id: uid, employee_name: emp.display_name, employee_code: emp.employee_code, department: emp.department, wfh_days: dates.length, dates: dates.sort() });
      }
      wfhResult.sort((a, b) => b.wfh_days - a.wfh_days);

      const deptMap = {};
      for (const r of wfhResult) {
        const dept = r.department || 'Unknown';
        deptMap[dept] = (deptMap[dept] || 0) + r.wfh_days;
      }
      const department_summary = Object.entries(deptMap)
        .map(([department, total_wfh_days]) => ({ department, total_wfh_days }))
        .sort((a, b) => b.total_wfh_days - a.total_wfh_days);

      return res.json({
        success: true, month, year,
        records: wfhResult,
        total_wfh_days: wfhResult.reduce((s, r) => s + r.wfh_days, 0),
        unique_employees: wfhResult.length,
        department_summary,
      });
    }

    case 'getTallyExport': {
      const { month, year } = p;
      const payrolls = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll'"))
        .filter(r => r.month === month && r.year === year);

      if (!payrolls.length) return res.json({ success: false, error: 'No payroll records found for this period' });

      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const monLabel = `${months[month - 1]} ${year}`;

      let totalBasic = 0, totalHRA = 0, totalConv = 0, totalSpecial = 0, totalGross = 0;
      let totalPF = 0, totalPT = 0, totalESI = 0, totalLOP = 0, totalNet = 0;

      for (const pr of payrolls) {
        totalBasic += pr.basic_salary || 0;
        totalHRA += pr.hra || 0;
        totalConv += pr.conveyance || 0;
        totalSpecial += pr.special_allowance || 0;
        totalGross += pr.gross_salary || 0;
        totalPF += pr.deductions?.pf || 0;
        totalPT += pr.deductions?.pt || 0;
        totalESI += pr.deductions?.esi || 0;
        totalLOP += pr.loss_of_pay_amount || 0;
        totalNet += pr.net_salary || 0;
      }

      // Tally XML journal voucher format
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Journal" ACTION="Create">
            <DATE>${year}${String(month).padStart(2,'0')}28</DATE>
            <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
            <NARRATION>Salary for ${monLabel} — ${payrolls.length} employees</NARRATION>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Salary — Basic</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${totalBasic}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Salary — HRA</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${totalHRA}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Salary — Conveyance</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${totalConv}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Salary — Special Allowance</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${totalSpecial}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>PF Payable</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${totalPF}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Professional Tax Payable</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${totalPT}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>ESI Payable</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${totalESI}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Salary Payable</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${totalNet}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

      // Build improved CSV with title, company name, headers, data rows, and totals
      const csvLines = [
        `"MAXVOLT ENERGY INDUSTRIES LIMITED"`,
        `"Salary Register — ${monLabel}"`,
        `"Generated: ${new Date().toLocaleDateString('en-IN')}"`,
        `""`,
        `"#","Employee Name","Emp Code","Gross Salary","Basic","HRA","Conveyance","Special Allowance","PF","PT","ESI","LOP","Net Salary"`,
      ];
      let idx = 1;
      let totGross=0, totBasic=0, totHRA=0, totConv=0, totSpecial=0, totPF=0, totPT=0, totESI=0, totLOP=0, totNet=0;
      for (const pr of payrolls) {
        const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [pr.user_id]);
        const emp = empRow ? JSON.parse(empRow.data) : {};
        const gross=pr.gross_salary||0, basic=pr.basic_salary||0, hra=pr.hra||0, conv=pr.conveyance||0,
          special=pr.special_allowance||0, pf=pr.deductions?.pf||0, pt=pr.deductions?.pt||0,
          esi=pr.deductions?.esi||0, lop=pr.loss_of_pay_amount||0, net=pr.net_salary||0;
        totGross+=gross; totBasic+=basic; totHRA+=hra; totConv+=conv; totSpecial+=special;
        totPF+=pf; totPT+=pt; totESI+=esi; totLOP+=lop; totNet+=net;
        csvLines.push(`"${idx++}","${emp.display_name||''}","${emp.employee_code||''}",${gross},${basic},${hra},${conv},${special},${pf},${pt},${esi},${lop},${net}`);
      }
      csvLines.push(`""`);
      csvLines.push(`"","TOTAL","",${totGross},${totBasic},${totHRA},${totConv},${totSpecial},${totPF},${totPT},${totESI},${totLOP},${totNet}`);
      const csv = csvLines.join('\n');

      return res.json({ success: true, month, year, employee_count: payrolls.length, totals: { gross: totalGross, pf: totalPF, pt: totalPT, esi: totalESI, lop: totalLOP, net: totalNet }, tally_xml: xml, csv });
    }

    case 'getAttendanceNarrative': {
      const { user_id, month, year } = p;
      const targetUser = user_id || cu?.id;
      const m = month || new Date().getMonth() + 1;
      const y = year || new Date().getFullYear();
      const startDate = `${y}-${String(m).padStart(2,'0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const endDate = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [targetUser]);
      const emp = empRow ? JSON.parse(empRow.data) : {};

      const attRows = await all(
        "SELECT data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date' BETWEEN $2 AND $3",
        [targetUser, startDate, endDate]
      );
      const records = attRows.map(r => JSON.parse(r.data));

      const present = records.filter(a => ['present','late','on_duty','work_from_home'].includes(a.status)).length;
      const absent = records.filter(a => ['absent','lop'].includes(a.status)).length;
      const late = records.filter(a => a.status === 'late').length;
      const wfh = records.filter(a => a.status === 'work_from_home').length;
      const halfDay = records.filter(a => a.status === 'half_day').length;

      const monthsArr = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const monLabel = monthsArr[m - 1];

      const Groq = (await import('groq-sdk')).default;
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'user',
          content: `Write a 3-4 sentence professional attendance summary for ${emp.display_name || 'this employee'} for ${monLabel} ${y}.
Data: Present: ${present} days, Absent: ${absent} days, Late arrivals: ${late}, WFH: ${wfh} days, Half days: ${halfDay}.
Be specific about patterns, mention if late arrivals are a concern, if WFH is high, if absences seem high for the month. Be constructive.`
        }],
        temperature: 0.6, max_tokens: 200
      });

      return res.json({ success: true, narrative: completion.choices[0].message.content, stats: { present, absent, late, wfh, half_day: halfDay, month: m, year: y } });
    }

    case 'getWeeklyHRDigest': {
      const now = new Date();
      const m = now.getMonth() + 1;
      const y = now.getFullYear();
      const startDate = `${y}-${String(m).padStart(2,'0')}-01`;

      const [empCount, newJoinees, pendingLeaves, payrollCount, openPositions] = await Promise.all([
        one("SELECT COUNT(*) as cnt FROM entities WHERE type='Employee' AND status='active'"),
        all(`SELECT data FROM entities WHERE type='Employee' AND data::jsonb->>'date_of_joining' >= $1`, [startDate]),
        all("SELECT COUNT(*) as cnt FROM entities WHERE type='Leave' AND status='pending'"),
        one(`SELECT COUNT(*) as cnt FROM entities WHERE type='Payroll' AND data::jsonb->>'month'=$1 AND data::jsonb->>'year'=$2`, [String(m), String(y)]),
        one("SELECT COUNT(*) as cnt FROM entities WHERE type='JobRequisition' AND status='active'"),
      ]);

      // Attrition this month
      const exitRows = await all(`SELECT data FROM entities WHERE type='ExitRequest' AND status='approved' AND data::jsonb->>'exit_date' >= $1`, [startDate]);

      // High-risk attrition employees
      const highRiskRows = await all("SELECT data FROM entities WHERE type='AttritionRisk' AND data::jsonb->>'risk_level'='High'");

      const Groq = (await import('groq-sdk')).default;
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'user',
          content: `You are an AI HR assistant. Write a professional weekly HR digest summary (5-7 sentences) based on this data:
- Total active employees: ${empCount?.cnt || 0}
- New joiners this month: ${newJoinees.length}
- Pending leave approvals: ${pendingLeaves[0]?.cnt || 0}
- Payroll processed for ${payrollCount?.cnt || 0} employees this month
- Open job positions: ${openPositions?.cnt || 0}
- Exits/resignations this month: ${exitRows.length}
- Employees flagged as high attrition risk: ${highRiskRows.length}

Be actionable and highlight anything that needs HR attention. Professional tone.`
        }],
        temperature: 0.7, max_tokens: 350
      });

      return res.json({
        success: true,
        digest: completion.choices[0].message.content,
        stats: {
          headcount: parseInt(empCount?.cnt || 0),
          new_joiners: newJoinees.length,
          pending_leaves: parseInt(pendingLeaves[0]?.cnt || 0),
          payroll_processed: parseInt(payrollCount?.cnt || 0),
          open_positions: parseInt(openPositions?.cnt || 0),
          exits: exitRows.length,
          high_risk_employees: highRiskRows.length,
        }
      });
    }

    case 'getSurveySentiment': {
      const { survey_id } = p;
      const responseRows = await all(
        "SELECT data FROM entities WHERE type='SurveyResponse' AND data::jsonb->>'survey_id'=$1",
        [survey_id]
      );
      const responses = responseRows.map(r => JSON.parse(r.data));
      const openTexts = responses.flatMap(r => Object.values(r.answers || {}).filter(v => typeof v === 'string' && v.length > 10));

      if (openTexts.length === 0) return res.json({ success: true, sentiment: 'neutral', themes: [], summary: 'No open text responses to analyze.' });

      const Groq = (await import('groq-sdk')).default;
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'user',
          content: `Analyze these anonymous employee survey responses and provide: 1) Overall sentiment (positive/neutral/negative), 2) Top 3-5 recurring themes, 3) A brief 2-3 sentence summary for HR.
Responses: ${openTexts.slice(0, 50).join(' | ')}
Reply as JSON: { "sentiment": "positive|neutral|negative", "themes": ["theme1","theme2",...], "summary": "..." }`
        }],
        temperature: 0.4, max_tokens: 300
      });

      let parsed = { sentiment: 'neutral', themes: [], summary: completion.choices[0].message.content };
      try { parsed = JSON.parse(completion.choices[0].message.content); } catch {}

      return res.json({ success: true, survey_id, response_count: responses.length, open_text_count: openTexts.length, ...parsed });
    }

    case 'getDIMetrics': {
      const empRows = await all("SELECT data FROM entities WHERE type='Employee' AND status='active'");
      const employees = empRows.map(r => JSON.parse(r.data));

      const genderCounts = { male: 0, female: 0, other: 0, unknown: 0 };
      const deptGender = {};
      const levelGender = {};
      const salaryByGender = { male: [], female: [] };

      for (const emp of employees) {
        const g = (emp.gender || '').toLowerCase();
        const key = ['male','female'].includes(g) ? g : g ? 'other' : 'unknown';
        genderCounts[key]++;

        if (!deptGender[emp.department]) deptGender[emp.department] = { male: 0, female: 0, other: 0 };
        deptGender[emp.department][key === 'unknown' ? 'other' : key]++;

        const tier = emp.designation_tier || 'other';
        if (!levelGender[tier]) levelGender[tier] = { male: 0, female: 0 };
        if (['male','female'].includes(key)) levelGender[tier][key]++;

        const ssRow = await one("SELECT data FROM entities WHERE type='SalaryStructure' AND user_id=$1 AND status='active'", [emp.user_id]);
        if (ssRow) {
          const ss = JSON.parse(ssRow.data);
          const salary = ss.total_ctc || (ss.basic_salary || 0) * 12 || 0;
          if (key === 'male') salaryByGender.male.push(salary);
          else if (key === 'female') salaryByGender.female.push(salary);
        }
      }

      const avgSalary = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
      const genderPayGap = salaryByGender.male.length && salaryByGender.female.length
        ? Math.round(((avgSalary(salaryByGender.male) - avgSalary(salaryByGender.female)) / avgSalary(salaryByGender.male)) * 100)
        : 0;

      return res.json({
        success: true,
        total_employees: employees.length,
        gender_distribution: genderCounts,
        gender_by_department: deptGender,
        gender_by_level: levelGender,
        pay_equity: { avg_male_salary: avgSalary(salaryByGender.male), avg_female_salary: avgSalary(salaryByGender.female), pay_gap_percent: genderPayGap },
      });
    }

    case 'getRecruitmentFunnel': {
      const { days = 90 } = p;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const [reqRows, candRows, interviewRows, offerRows] = await Promise.all([
        all("SELECT data FROM entities WHERE type='JobRequisition'"),
        all(`SELECT data FROM entities WHERE type='Candidate' AND created_at >= $1`, [since]),
        all(`SELECT data FROM entities WHERE type='Interview'`),
        all("SELECT data FROM entities WHERE type='OfferLetter'"),
      ]);

      const reqs = reqRows.map(r => JSON.parse(r.data));
      const candidates = candRows.map(r => JSON.parse(r.data));
      const interviews = interviewRows.map(r => JSON.parse(r.data));
      const offers = offerRows.map(r => JSON.parse(r.data));

      const byStatus = {};
      for (const c of candidates) {
        byStatus[c.status || 'applied'] = (byStatus[c.status || 'applied'] || 0) + 1;
      }

      const byDept = {};
      for (const r of reqs) {
        byDept[r.department || 'Other'] = (byDept[r.department || 'Other'] || 0) + 1;
      }

      const sourceCount = {};
      for (const c of candidates) {
        const src = c.source || 'Walk-in';
        sourceCount[src] = (sourceCount[src] || 0) + 1;
      }

      // Time to fill (days between req created and offer accepted)
      const filledReqs = reqs.filter(r => r.status === 'filled' && r.created_at && r.filled_date);
      const avgTimeToFill = filledReqs.length
        ? Math.round(filledReqs.reduce((sum, r) => sum + (new Date(r.filled_date) - new Date(r.created_at)) / 86400000, 0) / filledReqs.length)
        : null;

      return res.json({
        success: true,
        period_days: days,
        funnel: {
          job_requisitions: reqs.length,
          total_candidates: candidates.length,
          interviews_scheduled: interviews.length,
          offers_sent: offers.length,
          offers_accepted: offers.filter(o => o.status === 'accepted').length,
        },
        by_status: byStatus,
        by_department: byDept,
        by_source: sourceCount,
        avg_time_to_fill_days: avgTimeToFill,
        open_positions: reqs.filter(r => r.status === 'active' || r.status === 'open').length,
      });
    }

    case 'getRecruitmentMIS': {
      const { days = 180, department: misDept, requisition_id: misReqId } = p;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const [reqRows, candRows, intRows, offerRows] = await Promise.all([
        all("SELECT id,data,created_at FROM entities WHERE type='JobRequisition'"),
        all("SELECT id,data,created_at FROM entities WHERE type='Candidate'"),
        all("SELECT id,data,created_at FROM entities WHERE type='Interview'"),
        all("SELECT id,data,created_at FROM entities WHERE type='OfferLetter'"),
      ]);

      const allReqs    = reqRows.map(r  => ({ ...JSON.parse(r.data),  _created: r.created_at }));
      const allCands   = candRows.map(r => ({ ...JSON.parse(r.data),  _created: r.created_at }));
      const allInts    = intRows.map(r  => ({ ...JSON.parse(r.data),  _created: r.created_at }));
      const allOffers  = offerRows.map(r=> ({ ...JSON.parse(r.data),  _created: r.created_at }));

      // Period filter for candidates
      const cands = allCands.filter(c => (c.created_at || c._created || '') >= since);
      const reqs  = allReqs;

      // ── Stage funnel ─────────────────────────────────────────────
      const STAGES = ['applied','screening','interview_scheduled','interviewed','selected','offered','offer_accepted','joined'];
      const stageCounts = {};
      for (const s of STAGES) stageCounts[s] = 0;
      for (const c of cands) { const st = c.status || 'applied'; if (stageCounts[st] !== undefined) stageCounts[st]++; }

      // cumulative funnel (everyone at or past each stage)
      const stageOrder = { applied:0, screening:1, interview_scheduled:2, interviewed:3, selected:4, offered:5, offer_accepted:6, joined:7, rejected:-1, offer_declined:-1 };
      const funnelCounts = {};
      for (const s of STAGES) {
        funnelCounts[s] = cands.filter(c => (stageOrder[c.status] ?? -1) >= stageOrder[s]).length;
      }

      // Conversion rates between adjacent stages
      const conversions = [];
      for (let i = 1; i < STAGES.length; i++) {
        const from = funnelCounts[STAGES[i-1]] || 0;
        const to   = funnelCounts[STAGES[i]]   || 0;
        conversions.push({ from: STAGES[i-1], to: STAGES[i], from_count: from, to_count: to, rate: from > 0 ? Math.round(to/from*100) : 0 });
      }

      // ── Source quality matrix ─────────────────────────────────────
      const sourceMap = {};
      for (const c of cands) {
        const src = c.source || 'walk_in';
        if (!sourceMap[src]) sourceMap[src] = { source: src, applied: 0, screened: 0, interviewed: 0, selected: 0, offered: 0, joined: 0 };
        const order = stageOrder[c.status] ?? 0;
        sourceMap[src].applied++;
        if (order >= 1) sourceMap[src].screened++;
        if (order >= 3) sourceMap[src].interviewed++;
        if (order >= 4) sourceMap[src].selected++;
        if (order >= 5) sourceMap[src].offered++;
        if (order >= 7) sourceMap[src].joined++;
      }

      // ── Department pipeline ───────────────────────────────────────
      const deptMap = {};
      for (const c of cands) {
        const dept = c.department || 'General';
        if (!deptMap[dept]) deptMap[dept] = { department: dept, applied: 0, in_progress: 0, selected: 0, offered: 0, joined: 0, rejected: 0 };
        deptMap[dept].applied++;
        const order = stageOrder[c.status] ?? 0;
        if (order >= 1 && order < 4) deptMap[dept].in_progress++;
        if (order === 4) deptMap[dept].selected++;
        if (order >= 5) deptMap[dept].offered++;
        if (order >= 7) deptMap[dept].joined++;
        if (c.status === 'rejected') deptMap[dept].rejected++;
      }

      // ── Monthly hiring trend (last 12 months) ────────────────────
      const monthMap = {};
      for (let m = 11; m >= 0; m--) {
        const d = new Date(); d.setMonth(d.getMonth() - m);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        monthMap[key] = { month: key, applied: 0, selected: 0, joined: 0 };
      }
      for (const c of allCands) {
        const dt = c.created_at || c._created || '';
        const key = dt.slice(0,7);
        if (monthMap[key]) {
          monthMap[key].applied++;
          const order = stageOrder[c.status] ?? -1;
          if (order >= 4) monthMap[key].selected++;
          if (order >= 7) monthMap[key].joined++;
        }
      }

      // ── Requisition health (open positions aging) ─────────────────
      const reqHealth = reqs
        .filter(r => ['approved','published','on_hold'].includes(r.status))
        .map(r => {
          const createdAt = r.created_at || r._created || '';
          const daysOpen = createdAt ? Math.floor((Date.now() - new Date(createdAt)) / 86400000) : 0;
          const relCands = allCands.filter(c => c.requisition_id === r.id || c.position_applied === r.position_title);
          const intCount = allInts.filter(i => relCands.some(c => c.id === i.candidate_id)).length;
          return {
            id: r.id, position: r.position_title, department: r.department,
            priority: r.priority, status: r.status,
            days_open: daysOpen, target_hire_date: r.target_hire_date,
            positions: r.number_of_positions || 1,
            candidates: relCands.length,
            interviews: intCount,
            offers: relCands.filter(c => ['offered','offer_accepted','joined'].includes(c.status)).length,
            joined: relCands.filter(c => c.status === 'joined').length,
          };
        })
        .sort((a, b) => b.days_open - a.days_open);

      // ── Offer analytics ───────────────────────────────────────────
      const totalOffers  = cands.filter(c => ['offered','offer_accepted','offer_declined','joined'].includes(c.status)).length;
      const accepted     = cands.filter(c => ['offer_accepted','joined'].includes(c.status)).length;
      const declined     = cands.filter(c => c.status === 'offer_declined').length;
      const joined       = cands.filter(c => c.status === 'joined').length;

      // ── Avg time in stages (using status_updated_at if available) ─
      const avgDaysToSelect = (() => {
        const vals = cands.filter(c => c.selected_at && c.created_at)
          .map(c => (new Date(c.selected_at) - new Date(c.created_at)) / 86400000);
        return vals.length ? Math.round(vals.reduce((s,v) => s+v,0)/vals.length) : null;
      })();

      // ── Key KPIs ──────────────────────────────────────────────────
      const openRequisitions  = reqs.filter(r => ['approved','published'].includes(r.status)).length;
      const closedThisPeriod  = reqs.filter(r => r.status === 'closed' && (r.closed_date || '') >= since).length;
      const offerAcceptRate   = totalOffers > 0 ? Math.round(accepted/totalOffers*100) : 0;
      const totalCandidates   = cands.length;
      const inPipeline        = cands.filter(c => !['joined','rejected','offer_declined'].includes(c.status)).length;

      return res.json({
        success: true,
        period_days: days,
        kpis: {
          total_requisitions: reqs.length,
          open_requisitions: openRequisitions,
          closed_this_period: closedThisPeriod,
          total_candidates: totalCandidates,
          in_pipeline: inPipeline,
          total_offers: totalOffers,
          offer_accepted: accepted,
          offer_declined: declined,
          joined,
          offer_accept_rate: offerAcceptRate,
          avg_days_to_select: avgDaysToSelect,
        },
        stage_funnel: STAGES.map(s => ({ stage: s, count: funnelCounts[s] || 0, at_stage: stageCounts[s] || 0 })),
        stage_conversions: conversions,
        by_source: Object.values(sourceMap).sort((a,b) => b.applied - a.applied),
        by_department: Object.values(deptMap).sort((a,b) => b.applied - a.applied),
        monthly_trend: Object.values(monthMap),
        requisition_health: reqHealth.slice(0, 30),
        offer_breakdown: { offered: totalOffers, accepted, declined, joined, pending: totalOffers - accepted - declined },
      });
    }

    case 'saveInterviewScorecard': {
      const { candidate_id: sisCandId, scorecard: sisCard } = p;
      if (!sisCandId) return res.json({ success: false, error: 'candidate_id required' });
      const sisCandRow = await one("SELECT id,data FROM entities WHERE type='Candidate' AND id=$1", [sisCandId]);
      if (!sisCandRow) return res.json({ success: false, error: 'Candidate not found' });
      const sisCand = JSON.parse(sisCandRow.data);
      const now = new Date().toISOString();
      const updatedCard = { ...sisCard, recorded_by: cu?.full_name, recorded_at: now };
      const newStatus = sisCard.recommendation === 'select' ? 'selected' : sisCard.recommendation === 'reject' ? 'rejected' : 'interviewed';
      await run("UPDATE entities SET data=$1,updated_at=$2 WHERE id=$3", [JSON.stringify({ ...sisCand, interview_scorecard: updatedCard, status: newStatus, interviewed_at: now }), now, sisCandRow.id]);
      // Notify HR
      const hrUsers = await all("SELECT id FROM users WHERE role IN ('hr','admin')");
      const empName = sisCand.full_name || 'Candidate';
      const recLabel = sisCard.recommendation === 'select' ? 'SELECTED' : sisCard.recommendation === 'reject' ? 'REJECTED' : 'On Hold';
      for (const hr of hrUsers) {
        await notify(hr.id, { title: 'Interview Scorecard Submitted', message: `${empName} — ${recLabel} for ${sisCand.position_applied || 'position'}`, type: sisCard.recommendation === 'select' ? 'success' : 'info', link: '/recruitment' });
      }
      return res.json({ success: true, new_status: newStatus });
    }

    case 'getMinimumWagesReport': {
      // Central minimum wages (unskilled) — approximate for 2025 (₹ per month)
      const MINIMUM_WAGES = {
        'unskilled': 9360, 'semi_skilled': 10296, 'skilled': 11334,
        'highly_skilled': 12126, 'default': 9360
      };

      const empRows = await all("SELECT data FROM entities WHERE type='Employee' AND status='active'");
      const employees = empRows.map(r => JSON.parse(r.data));

      const violations = [];
      const compliant = [];

      for (const emp of employees) {
        const ssRow = await one("SELECT data FROM entities WHERE type='SalaryStructure' AND user_id=$1 AND status='active'", [emp.user_id]);
        if (!ssRow) continue;
        const ss = JSON.parse(ssRow.data);
        const gross = (ss.basic_salary || ss.basic_monthly || 0) + (ss.hra || ss.hra_monthly || 0) + (ss.conveyance || ss.conveyance_monthly || 0);
        const minWage = MINIMUM_WAGES[emp.skill_category || 'default'];

        if (gross < minWage) {
          violations.push({ name: emp.display_name, code: emp.employee_code, department: emp.department, gross_monthly: gross, minimum_wage: minWage, shortfall: minWage - gross });
        } else {
          compliant.push({ name: emp.display_name, code: emp.employee_code });
        }
      }

      return res.json({ success: true, total: employees.length, violations: violations.length, compliant: compliant.length, violation_list: violations });
    }

    case 'savePOSHRecord': {
      const { id, record_type, date, description, parties, action_taken, status, outcome } = p;
      const recordId = id || uuidv4();
      const data = { id: recordId, record_type, date, description, parties: parties || [], action_taken: action_taken || '', status: status || 'open', outcome: outcome || '', created_by: cu?.id, created_at: new Date().toISOString() };
      if (id) {
        await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2 AND type='POSHRecord'", [JSON.stringify(data), id]);
      } else {
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'POSHRecord',$2,$3,$4)", [recordId, cu?.id, status || 'open', JSON.stringify(data)]);
      }
      return res.json({ success: true, id: recordId });
    }

    case 'getPOSHData': {
      const rows = await all("SELECT data FROM entities WHERE type='POSHRecord' ORDER BY created_at DESC");
      const records = rows.map(r => JSON.parse(r.data));
      const summary = {
        total: records.length,
        open: records.filter(r => r.status === 'open').length,
        closed: records.filter(r => r.status === 'closed').length,
        by_type: records.reduce((acc, r) => { acc[r.record_type || 'other'] = (acc[r.record_type || 'other'] || 0) + 1; return acc; }, {}),
      };
      return res.json({ success: true, records, summary });
    }

    case 'submit360Feedback': {
      const { subject_user_id, relationship, answers, period } = p;
      const feedbackId = uuidv4();
      const data = { id: feedbackId, subject_user_id, reviewer_user_id: cu?.id, relationship, answers: answers || {}, period: period || `${new Date().getFullYear()}-H1`, submitted_at: new Date().toISOString() };
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Feedback360',$2,'submitted',$3)", [feedbackId, subject_user_id, JSON.stringify(data)]);
      return res.json({ success: true, feedback_id: feedbackId });
    }

    case 'get360FeedbackData': {
      const { subject_user_id, period } = p;
      const targetUser = subject_user_id || cu?.id;
      const rows = await all("SELECT data FROM entities WHERE type='Feedback360' AND user_id=$1", [targetUser]);
      const feedbacks = rows.map(r => JSON.parse(r.data)).filter(f => !period || f.period === period);

      if (!feedbacks.length) return res.json({ success: true, feedbacks: [], aggregate: null });

      // Aggregate scores
      const allScores = {};
      for (const fb of feedbacks) {
        for (const [k, v] of Object.entries(fb.answers || {})) {
          if (typeof v === 'number') {
            if (!allScores[k]) allScores[k] = [];
            allScores[k].push(v);
          }
        }
      }
      const aggregate = Object.fromEntries(Object.entries(allScores).map(([k, vals]) => [k, Math.round((vals.reduce((a,b) => a+b, 0)/vals.length)*10)/10]));

      // Anonymize: don't return reviewer IDs
      const anonymized = feedbacks.map(f => ({ relationship: f.relationship, answers: f.answers, period: f.period }));
      return res.json({ success: true, feedbacks: anonymized, aggregate, total_reviewers: feedbacks.length });
    }

    case 'getSkillMatrix': {
      const { user_id } = p;
      const rows = await all("SELECT data FROM entities WHERE type='SkillEntry'");
      const entries = rows.map(r => JSON.parse(r.data));

      // User-scoped request (My Skills tab)
      if (user_id) {
        const my_skills = entries.filter(e => e.user_id === user_id);
        return res.json({ success: true, my_skills });
      }

      // Org view — enrich with employee data
      const empRows = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      const empMap = {};
      for (const e of empRows) empMap[e.user_id] = e;

      const allSkills = [...new Set(entries.map(e => e.skill_name))];

      // skill_coverage as array for frontend .map()
      const skill_coverage = allSkills.map(skill_name => {
        const matching = entries.filter(e => e.skill_name === skill_name);
        return {
          skill_name,
          employee_count: matching.length,
          top_level: matching.length ? Math.max(...matching.map(e => e.proficiency_level || 1)) : 1,
        };
      }).sort((a, b) => b.employee_count - a.employee_count);

      // Group by employee with enriched data
      const byEmployee = {};
      for (const e of entries) {
        if (!byEmployee[e.user_id]) {
          const emp = empMap[e.user_id] || {};
          byEmployee[e.user_id] = { user_id: e.user_id, name: emp.display_name || emp.full_name || e.user_id, department: emp.department || '—', skills: [] };
        }
        byEmployee[e.user_id].skills.push({ skill: e.skill_name, level: e.proficiency_level, validated: e.validated });
      }

      const employees_list = Object.values(byEmployee)
        .map(emp => ({ ...emp, skill_count: emp.skills.length }))
        .sort((a, b) => b.skill_count - a.skill_count);

      return res.json({ success: true, employee_count: employees_list.length, all_skills: allSkills, skill_coverage, employees: employees_list, matrix: employees_list });
    }

    case 'saveSkillEntry': {
      const { skill_name, proficiency_level, validated, target_user_id } = p;
      const userId = target_user_id || cu?.id;
      const existing = await one("SELECT id FROM entities WHERE type='SkillEntry' AND user_id=$1 AND data::jsonb->>'skill_name'=$2", [userId, skill_name]);
      const entryId = existing?.id || uuidv4();
      const data = { id: entryId, user_id: userId, skill_name, proficiency_level: proficiency_level || 1, validated: validated || false, updated_at: new Date().toISOString() };
      if (existing) {
        await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(data), entryId]);
      } else {
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'SkillEntry',$2,'active',$3)", [entryId, userId, JSON.stringify(data)]);
      }
      return res.json({ success: true, id: entryId });
    }

    case 'getWorkforcePlan': {
      const rows = await all("SELECT data FROM entities WHERE type='WorkforcePlan' ORDER BY created_at DESC");
      const plans = rows.map(r => JSON.parse(r.data));

      // Current headcount by dept
      const empRows = await all("SELECT data FROM entities WHERE type='Employee' AND status='active'");
      const employees = empRows.map(r => JSON.parse(r.data));
      const headcountByDept = {};
      for (const emp of employees) {
        const d = emp.department || 'Other';
        headcountByDept[d] = (headcountByDept[d] || 0) + 1;
      }

      return res.json({ success: true, plans, current_headcount: headcountByDept, total_employees: employees.length });
    }

    case 'saveWorkforcePlan': {
      const { id, department, current_count, planned_count, planned_date, notes, status } = p;
      const planId = id || uuidv4();
      const data = { id: planId, department, current_count, planned_count, planned_date, notes: notes || '', status: status || 'draft', created_by: cu?.id, created_at: new Date().toISOString() };
      if (id) {
        await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2 AND type='WorkforcePlan'", [JSON.stringify(data), id]);
      } else {
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'WorkforcePlan',$2,'active',$3)", [planId, cu?.id, JSON.stringify(data)]);
      }
      return res.json({ success: true, id: planId });
    }

    default:
      console.warn(`[functions] Unknown function: ${name}`);
      return res.status(404).json({ error: `Function '${name}' not implemented` });
  }
  } catch (err) {
    console.error(`[functions/${name}]`, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/* ── payslip HTML ──────────────────────────────────────── */
function buildPayslipHtml(payroll, emp, deptName) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const mon   = months[(payroll.month||1)-1];
  const dept  = deptName || emp.department || 'N/A';

  const earn = [
    ['Basic Salary',        payroll.basic_salary        || 0],
    ['HRA',                 payroll.hra                 || 0],
    ['Conveyance Allowance',payroll.conveyance           || 0],
    ['Performance Bonus',   payroll.performance_bonus    || 0],
    ['Special Allowance',   payroll.special_allowance    || 0],
    ['Other Allowances',    payroll.other_allowances     || 0],
  ].filter(([,v]) => v > 0);

  const ded = [
    ['PF Deduction (12%)',  payroll.deductions?.pf       || payroll.pf_contribution  || 0],
    ['ESI Deduction (0.75%)',payroll.deductions?.esi     || payroll.esi_contribution || 0],
    ['Professional Tax',    payroll.deductions?.pt       || payroll.deductions?.professional_tax || 0],
    ['TDS',                 payroll.deductions?.tds      || 0],
    ['Loan Deduction',      payroll.deductions?.loan     || 0],
    ['LOP Deduction',       payroll.loss_of_pay_amount   || 0],
  ].filter(([,v]) => v > 0);

  const gross    = payroll.gross_salary   || 0;
  const totalDed = payroll.total_deductions || (payroll.deductions ? Object.values(payroll.deductions).reduce((s,v)=>s+(v||0),0) : 0);
  const net      = gross - totalDed;

  const rows = Array.from({ length: Math.max(earn.length, ded.length) }, (_, i) => `
    <tr>
      <td style="padding:8px;border:1px solid #ddd">${earn[i]?.[0] || ''}</td>
      <td style="padding:8px;text-align:right;border:1px solid #ddd">${earn[i] ? earn[i][1].toLocaleString('en-IN') : ''}</td>
      <td style="padding:8px;border:1px solid #ddd">${ded[i]?.[0] || ''}</td>
      <td style="padding:8px;text-align:right;border:1px solid #ddd">${ded[i] ? ded[i][1].toLocaleString('en-IN') : ''}</td>
    </tr>`).join('');

  return `<div style="font-family:Arial,sans-serif;max-width:820px;margin:0 auto;padding:20px;border:1px solid #ddd;border-radius:8px">
  <div style="background:#1e3a5f;color:#fff;padding:20px;border-radius:6px 6px 0 0;margin-bottom:0;display:flex;justify-content:space-between;align-items:center">
    <div>
      <h2 style="margin:0;font-size:18px">Maxvolt Energy Industries Limited</h2>
      <p style="margin:4px 0 0;opacity:.75;font-size:12px">E-82 Bulandshahr Road Industrial Area, Ghaziabad, UP – 201009</p>
    </div>
    <div style="text-align:right">
      <p style="margin:0;font-size:15px;font-weight:700">Pay Slip</p>
      <p style="margin:2px 0 0;opacity:.85;font-size:13px">${mon} ${payroll.year||''}</p>
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;border:1px solid #ddd;border-top:3px solid #f97316">
    <tr style="background:#f8fafc">
      <td style="padding:8px 10px;width:50%;border-right:1px solid #ddd"><b>Employee Name:</b> ${emp.display_name || 'N/A'}</td>
      <td style="padding:8px 10px"><b>Employee Code:</b> ${emp.employee_code || 'N/A'}</td>
    </tr>
    <tr>
      <td style="padding:8px 10px;border-right:1px solid #ddd"><b>Designation:</b> ${emp.designation || 'N/A'}</td>
      <td style="padding:8px 10px"><b>Department:</b> ${dept}</td>
    </tr>
    <tr style="background:#f8fafc">
      <td style="padding:8px 10px;border-right:1px solid #ddd"><b>Working Days:</b> ${payroll.working_days || 26}</td>
      <td style="padding:8px 10px"><b>Present Days:</b> ${payroll.present_days || 26}</td>
    </tr>
  </table>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead>
      <tr style="background:#1e3a5f;color:#fff">
        <th style="padding:8px 10px;text-align:left;width:35%">Earnings</th>
        <th style="padding:8px 10px;text-align:right;width:15%">Amount (₹)</th>
        <th style="padding:8px 10px;text-align:left;width:35%">Deductions</th>
        <th style="padding:8px 10px;text-align:right;width:15%">Amount (₹)</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr style="font-weight:bold;background:#f1f5f9">
        <td style="padding:9px 10px;border-top:2px solid #ddd">Gross Salary</td>
        <td style="padding:9px 10px;text-align:right;border-top:2px solid #ddd">${gross.toLocaleString('en-IN')}</td>
        <td style="padding:9px 10px;border-top:2px solid #ddd">Total Deductions</td>
        <td style="padding:9px 10px;text-align:right;border-top:2px solid #ddd">${totalDed.toLocaleString('en-IN')}</td>
      </tr>
    </tbody>
  </table>
  <div style="margin-top:12px;padding:14px 18px;background:#eff6ff;border-radius:6px;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:13px;color:#64748b">Net Pay = Gross Salary − Total Deductions</span>
    <span style="font-size:19px;font-weight:bold;color:#1e40af">Net Pay: ₹${net.toLocaleString('en-IN')}</span>
  </div>
  <p style="color:#aaa;font-size:11px;margin-top:14px;text-align:center">This is a computer-generated document and does not require a signature.</p>
</div>`;
}

export default router;
