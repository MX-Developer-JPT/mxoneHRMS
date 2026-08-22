import React, { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { Eraser } from 'lucide-react';

// Plain <canvas> signature capture — no external dependency. Works with
// mouse (desktop) and touch/pointer events (mobile) via the Pointer Events
// API, which unifies both. Exposes toDataURL()/isEmpty() via ref so the
// parent form can pull the signature only at submit time.
const SignaturePad = forwardRef(function SignaturePad({ height = 160 }, ref) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    // Backing-store scale for crisp lines on high-DPI screens.
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a1a';
  }, []);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasDrawn.current) { hasDrawn.current = true; setIsEmpty(false); }
  };
  const end = () => { drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn.current = false;
    setIsEmpty(true);
  };

  useImperativeHandle(ref, () => ({
    isEmpty: () => !hasDrawn.current,
    clear,
    toDataURL: () => (hasDrawn.current ? canvasRef.current.toDataURL('image/png') : null),
  }));

  return (
    <div>
      <div className="border-2 border-dashed border-gray-300 rounded-lg bg-white relative touch-none" style={{ height }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-crosshair touch-none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        {isEmpty && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 pointer-events-none">
            Sign here
          </p>
        )}
      </div>
      <div className="flex justify-end mt-2">
        <Button type="button" variant="outline" size="sm" onClick={clear} className="gap-1.5">
          <Eraser className="w-3.5 h-3.5" /> Clear
        </Button>
      </div>
    </div>
  );
});

export default SignaturePad;
