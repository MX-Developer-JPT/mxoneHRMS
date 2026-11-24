// Reads the text of a CV file (PDF, DOCX, TXT, RTF, HTML) from a URL. Shared by CV parsing, screening and candidate intake.
export async function extractResumeText(fileUrl) {
  let resumeText = '';
  let extractionError = '';
  if (!fileUrl) return { resumeText, extractionError: 'No resume file on record' };
  // Older/legacy resume_url values were stored as a bare relative path
  // (/api/upload/file/<id>.pdf) — Node's fetch has no browser base-URL to
  // resolve that against and just throws. Normalize to absolute so both old
  // and newly-uploaded (already-absolute) URLs work.
  const APP_BASE = (process.env.APP_URL || 'https://maxone.maxvoltenergy.com').replace(/\/+$/, '');
  const absoluteUrl = /^https?:\/\//i.test(fileUrl) ? fileUrl : `${APP_BASE}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
  try {
    const fileRes = await fetch(absoluteUrl);
    if (fileRes.ok) {
      const buf = Buffer.from(await fileRes.arrayBuffer());
      const lowerUrl = fileUrl.toLowerCase();
      const contentType = fileRes.headers.get('content-type') || '';
      if (lowerUrl.endsWith('.pdf') || contentType.includes('pdf')) {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buf) });
        const textResult = await parser.getText();
        await parser.destroy();
        resumeText = (textResult.text || '').trim();
      } else if (lowerUrl.endsWith('.docx') || contentType.includes('officedocument.wordprocessingml')) {
        const mammoth = (await import('mammoth')).default;
        const result = await mammoth.extractRawText({ buffer: buf });
        resumeText = (result.value || '').trim();
      } else if (lowerUrl.endsWith('.txt') || contentType.includes('text/plain')) {
        resumeText = buf.toString('utf8').trim();
      } else if (lowerUrl.endsWith('.rtf') || contentType.includes('rtf')) {
        resumeText = buf.toString('latin1').replace(/\\'[0-9a-f]{2}/gi, ' ').replace(/\{\\\*[^}]*\}/g, ' ').replace(/\\[a-z]+-?\d* ?/gi, ' ').replace(/[{}]/g, ' ').replace(/[ \t]+/g, ' ').trim();
      } else if (lowerUrl.endsWith('.html') || lowerUrl.endsWith('.htm') || contentType.includes('text/html')) {
        resumeText = buf.toString('utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      } else if (lowerUrl.endsWith('.doc')) {
        extractionError = 'Old Word (.doc) files cannot be read — please ask for a PDF or DOCX copy';
      } else {
        extractionError = 'Unsupported resume file format for text extraction (PDF, DOCX, TXT, RTF and HTML are supported)';
      }
      if (resumeText && resumeText.length < 150 && !extractionError) extractionError = 'Only a few words could be read — the CV is probably a scanned image (no OCR is available)';
      if (!resumeText && !extractionError) extractionError = 'Resume file contained no extractable text (likely a scanned/image-only document)';
    } else {
      extractionError = `Could not download resume file (HTTP ${fileRes.status})`;
    }
  } catch (e) {
    extractionError = `Resume text extraction failed: ${e.message}`;
    console.error('[extractResumeText] failed:', e.message);
  }
  return { resumeText, extractionError };
}
