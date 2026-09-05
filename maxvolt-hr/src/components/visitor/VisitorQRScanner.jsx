import React, { useRef, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, AlertCircle, RotateCcw } from 'lucide-react';
import jsQR from 'jsqr';

// Camera-based QR scanner for the gate admin's check-in/check-out flow.
// Modeled on AttendanceCameraCapture's camera-lifecycle pattern (start/stop
// on open, explicit permission-error messaging) but reads frames on a
// requestAnimationFrame loop through jsQR instead of taking one still shot.
export default function VisitorQRScanner({ open, onClose, onScan }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setError(''); startCamera(); }
    else stopCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not available in this browser. Please open this page in Safari (iOS) or Chrome (Android) over a secure (https) connection.');
      return;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      setStream(mediaStream);
      setError('');
      if (videoRef.current) videoRef.current.srcObject = mediaStream;
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      console.error('QR scanner camera error:', e);
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' || e.name === 'SecurityError') {
        setError('Please enable camera access in your device Settings to scan a visitor pass.');
      } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        setError('No camera found on this device.');
      } else {
        setError('Unable to start camera. Please try again.');
      }
    }
  };

  const stopCamera = () => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null; });
  };

  const tick = () => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data) {
        stopCamera();
        onScan(code.data);
        return;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle>Scan Visitor QR Pass</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          ) : (
            <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '1/1' }}>
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-10 border-2 border-white/70 rounded-lg pointer-events-none" />
            </div>
          )}
          <div className="flex justify-center gap-3">
            {error ? (
              <>
                <Button variant="outline" onClick={onClose}><X className="w-4 h-4 mr-2" />Close</Button>
                <Button onClick={startCamera}><RotateCcw className="w-4 h-4 mr-2" />Try Again</Button>
              </>
            ) : (
              <Button variant="outline" onClick={onClose}><X className="w-4 h-4 mr-2" />Cancel</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
