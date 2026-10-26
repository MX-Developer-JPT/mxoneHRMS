// Render a pdfmake document definition to a Buffer (Roboto fonts extracted once from pdfmake's bundled VFS).
import { createRequire } from 'module';
import { join } from 'path';

const _require = createRequire(import.meta.url);
let fontsDir = null;

function getFontsDir() {
  if (fontsDir) return fontsDir;
  const { mkdirSync, writeFileSync, existsSync } = _require('fs');
  const os = _require('os');
  const dir = join(os.tmpdir(), 'mx-pdfmake-fonts');
  if (!existsSync(dir) || !existsSync(join(dir, 'Roboto-Regular.ttf'))) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const vfsModule = _require('pdfmake/build/vfs_fonts');
    const vfs = vfsModule.pdfMake?.vfs || vfsModule.vfs || vfsModule;
    for (const [name, b64] of Object.entries(vfs)) writeFileSync(join(dir, name), Buffer.from(b64, 'base64'));
  }
  fontsDir = dir;
  return dir;
}

export function renderPdf(docDef) {
  return new Promise((resolve, reject) => {
    try {
      const PdfPrinter = _require('pdfmake/src/printer');
      const dir = getFontsDir();
      const printer = new PdfPrinter({ Roboto: { normal: join(dir, 'Roboto-Regular.ttf'), bold: join(dir, 'Roboto-Medium.ttf'), italics: join(dir, 'Roboto-Italic.ttf'), bolditalics: join(dir, 'Roboto-MediumItalic.ttf') } });
      const chunks = [];
      const doc = printer.createPdfKitDocument(docDef);
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (e) { reject(e); }
  });
}
