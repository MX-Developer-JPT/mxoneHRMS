import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PenLine, Loader2, CheckCircle2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

export default function AssetCheckoutDialog({ open, onOpenChange, asset, employee, user, onCheckedOut }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setHasSignature(false);
      setAgreed(false);
      setDone(false);
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [open]);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDraw = (e) => {
    e.preventDefault();
    setIsDrawing(true);
    const ctx = canvasRef.current.getContext('2d');
    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setHasSignature(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopDraw = () => setIsDrawing(false);

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const handleCheckout = async () => {
    if (!hasSignature) { toast.error('Please provide your signature'); return; }
    if (!agreed) { toast.error('Please agree to the terms and conditions'); return; }
    setSaving(true);
    try {
      const canvas = canvasRef.current;
      // Persist the actual signature image (not just a text note) so it can be
      // embedded on the printed asset letter and kept as a real audit record.
      const signatureBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const signedByName = employee?.display_name || user?.display_name || user?.full_name;
      let signatureUrl = null;
      try {
        const uploadRes = await base44.integrations.Core.UploadFile({ file: signatureBlob });
        signatureUrl = uploadRes.file_url;
      } catch (uploadErr) {
        console.error('Signature upload failed:', uploadErr.message);
      }

      const signedAt = new Date().toISOString();
      const signatureNote = `✓ Digitally signed by ${signedByName} on ${format(new Date(), 'dd MMM yyyy \'at\' hh:mm a')}`;
      const existingNotes = asset.notes || '';
      const updatedNotes = existingNotes ? `${existingNotes}\n${signatureNote}` : signatureNote;

      await base44.entities.Asset.update(asset.id, {
        notes: updatedNotes,
        status: 'signed',
        ...(signatureUrl ? { signature_url: signatureUrl } : {}),
        signed_at: signedAt,
        signed_by_name: signedByName,
      });

      // Create activity log for checkout
      await base44.entities.AssetActivityLog.create({
        asset_id: asset.id,
        asset_name: asset.asset_name,
        asset_identifier: asset.asset_id,
        previous_status: asset.status || 'assigned',
        new_status: 'signed',
        assigned_to_user_id: asset.assigned_to_user_id,
        assigned_to_name: employee?.display_name || '',
        changed_by_user_id: user?.id,
        changed_by_name: signedByName,
        field_changed: 'checkout',
        old_value: '',
        new_value: 'Digitally signed & acknowledged',
        notes: `Equipment checkout acknowledged via digital signature.${signatureUrl ? ' Signature image saved.' : ' Signature captured but image upload failed.'}`,
      });

      setDone(true);
      toast.success('Asset acknowledged — checkout complete');
      if (onCheckedOut) onCheckedOut();
    } catch (err) {
      toast.error('Error recording checkout: ' + err.message);
    }
    setSaving(false);
  };

  if (!asset || !open) return null;

  const empName = employee?.display_name || 'Employee';
  const empCode = employee?.employee_code || '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{done ? 'Checkout Complete' : 'Asset Checkout — Digital Signature'}</DialogTitle>
        </DialogHeader>
        {done ? (
          <div className="text-center space-y-4 py-6">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
            <h3 className="text-lg font-semibold">Asset Acknowledged!</h3>
            <p className="text-sm text-muted-foreground">
              {asset.asset_name} ({asset.asset_id}) has been checked out to {empName}.
            </p>
            <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Asset Summary */}
            <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{asset.asset_name}</span>
                <Badge variant="outline">{asset.asset_id}</Badge>
              </div>
              <p className="text-muted-foreground">
                Type: {asset.asset_type_name || '—'} · Model: {asset.model_number || '—'} · SN: {asset.serial_number || '—'}
              </p>
              <p className="text-muted-foreground">
                Assigned to: <span className="font-medium text-foreground">{empName} ({empCode})</span>
              </p>
              {asset.return_date && (
                <p className="text-muted-foreground">
                  Return by: <span className="font-medium">{format(parseISO(asset.return_date), 'dd MMMM yyyy')}</span>
                </p>
              )}
            </div>

            {/* Terms */}
            <div className="text-xs text-muted-foreground space-y-1 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="font-semibold text-foreground text-sm mb-1">Terms of Checkout</p>
              <p>By signing below, you acknowledge receipt of the above asset(s) in the stated condition and agree to:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Use the asset for official business purposes only</li>
                <li>Return the asset upon request, resignation, or end of assignment</li>
                <li>Report any damage, loss, or theft immediately to HR/IT</li>
                <li>Allow periodic inspection by authorized personnel</li>
              </ul>
            </div>

            {/* Signature Pad */}
            <div>
              <Label className="text-sm font-medium flex items-center gap-1 mb-1">
                <PenLine className="w-4 h-4" /> Your Signature
              </Label>
              <div className="border-2 border-dashed rounded-lg bg-white dark:bg-gray-800" style={{ touchAction: 'none' }}>
                <canvas
                  ref={canvasRef}
                  width={400}
                  height={120}
                  className="w-full cursor-crosshair"
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={stopDraw}
                  onMouseLeave={stopDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={stopDraw}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Draw your signature above using mouse or touch
                {hasSignature && (
                  <button onClick={clearSignature} className="ml-2 text-red-500 hover:underline">Clear</button>
                )}
              </p>
            </div>

            {/* Agreement checkbox */}
            <div className="flex items-start gap-2">
              <Checkbox id="agree-terms" checked={agreed} onCheckedChange={setAgreed} className="mt-0.5" />
              <Label htmlFor="agree-terms" className="text-xs cursor-pointer">
                I, <strong>{empName}</strong>, acknowledge receipt of the above asset in the condition stated and agree to the terms and conditions of this checkout.
              </Label>
            </div>

            <Button onClick={handleCheckout} disabled={saving || !hasSignature || !agreed} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PenLine className="w-4 h-4 mr-2" />}
              Sign & Accept Asset
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}