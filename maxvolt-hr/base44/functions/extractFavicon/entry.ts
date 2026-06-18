import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { zip_url } = await req.json();
    if (!zip_url) return Response.json({ error: 'zip_url required' }, { status: 400 });

    const zipResp = await fetch(zip_url);
    const zipBuffer = new Uint8Array(await zipResp.arrayBuffer());

    const JSZip = (await import('npm:jszip@3.10.1')).default;
    const zip = await JSZip.loadAsync(zipBuffer);

    const files = [];
    for (const [name, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      const lower = name.toLowerCase();
      if (!lower.endsWith('.svg') && !lower.endsWith('.ico') && !lower.endsWith('.png') && !lower.includes('favicon')) continue;

      const data = await file.async('uint8array');
      const ext = name.split('.').pop().toLowerCase();
      const mimeMap = { svg: 'image/svg+xml', ico: 'image/x-icon', png: 'image/png' };

      // Upload via base44
      const result = await base44.asServiceRole.integrations.Core.UploadFile({
        file: new File([data], name, { type: mimeMap[ext] || 'application/octet-stream' })
      });
      files.push({ name, url: result.file_url });
    }

    return Response.json({ success: true, files });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack?.slice(0, 500) }, { status: 500 });
  }
});