// Saves a base64 file returned by a backend export.
export function downloadBase64(base64, filename, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  if (!base64) throw new Error('The server returned no file');
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'download';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
