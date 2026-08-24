import React, { useRef, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, X, AlertCircle, RotateCcw } from 'lucide-react';

const isIOSDevice = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalonePWA = () =>
  window.navigator?.standalone === true ||
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

export default function AttendanceCameraCapture({ open, onClose, onCapture }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [photoTaken, setPhotoTaken] = useState(false);
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    if (open) {
      setCameraError('');
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [open]);

  const startCamera = async () => {
    // navigator.mediaDevices is undefined outside a secure context (plain
    // http, or some in-app/webview browsers) — calling getUserMedia on it
    // directly throws a raw TypeError instead of the friendly camera error
    // below, so guard it explicitly first.
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not available in this browser. Please open this page in Safari (iOS) or Chrome (Android) over a secure (https) connection.');
      return;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      setStream(mediaStream);
      setCameraError('');
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (error) {
      console.error('Camera error:', error);
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' || error.name === 'SecurityError') {
        setCameraError('Please enable camera access in your device Settings to take a selfie.');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setCameraError('No camera found on this device. Please use a device with a camera.');
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        setCameraError('Your camera is currently in use by another app. Please close other apps using the camera and try again.');
      } else {
        setCameraError('Unable to start camera. Please try again or refresh the page.');
      }
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video && canvas) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      setPhotoTaken(true);
    }
  };

  const retakePhoto = () => {
    setPhotoTaken(false);
  };

  const confirmPhoto = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.error('Canvas not found');
      return;
    }
    
    canvas.toBlob((blob) => {
      if (blob && blob.size > 0) {
        // Convert blob to File object with proper name
        const file = new File([blob], `attendance-${Date.now()}.jpg`, { type: 'image/jpeg' });
        onCapture(file);
        setPhotoTaken(false);
        onClose();
      } else {
        console.error('Failed to create valid blob');
        alert('Failed to capture photo. Please try again.');
      }
    }, 'image/jpeg', 0.95);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Take Attendance Selfie</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {cameraError ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">{cameraError}</p>
                {isIOSDevice() ? (
                  <p className="text-xs text-red-600 mt-1">
                    On iPhone: Settings → Privacy & Security → Camera → enable it for Safari.
                    {isStandalonePWA() && ' Then close this app fully (swipe it away from the App Switcher) and reopen it from your Home Screen — iOS only picks up the new permission after a fresh launch.'}
                  </p>
                ) : (
                  <p className="text-xs text-red-600 mt-1">
                    On Android: tap the lock/site-info icon in the address bar (or Settings → Apps → this app/browser → Permissions) and allow Camera.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '4/3' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${photoTaken ? 'hidden' : 'block'}`}
              />
              <canvas
                ref={canvasRef}
                className={`w-full h-full object-cover ${photoTaken ? 'block' : 'hidden'}`}
              />
            </div>
          )}

          <div className="flex gap-3 justify-center">
            {cameraError ? (
              <>
                <Button variant="outline" onClick={onClose}>
                  <X className="w-4 h-4 mr-2" />
                  Close
                </Button>
                <Button onClick={startCamera} className="bg-blue-600 hover:bg-blue-700">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
              </>
            ) : !photoTaken ? (
              <>
                <Button variant="outline" onClick={onClose}>
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button onClick={capturePhoto} className="bg-blue-600 hover:bg-blue-700">
                  <Camera className="w-4 h-4 mr-2" />
                  Capture Photo
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={retakePhoto}>
                  Retake
                </Button>
                <Button onClick={confirmPhoto} className="bg-green-600 hover:bg-green-700">
                  Confirm & Continue
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}