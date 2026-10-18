"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * A finger signature on a canvas, exported as a PNG. Pointer events (touch,
 * pen and mouse alike), crisp on high-density screens, with Clear. The
 * parent asks for the image with `toBlob()`; `empty` says whether anything
 * was drawn.
 */

export interface SignaturePadHandle {
  toBlob(): Promise<Blob | null>;
  clear(): void;
}

export const SignaturePad = forwardRef<SignaturePadHandle, { label: string; onChange?: (empty: boolean) => void }>(function SignaturePad(
  { label, onChange },
  ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  const setup = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * ratio);
    c.height = Math.round(rect.height * ratio);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#14171e";
  }, []);

  useEffect(() => {
    setup();
  }, [setup]);

  const mark = (next: boolean) => {
    setEmpty(next);
    onChange?.(next);
  };

  useImperativeHandle(ref, () => ({
    toBlob: () =>
      new Promise((resolve) => {
        if (empty || !canvas.current) return resolve(null);
        canvas.current.toBlob((b) => resolve(b), "image/png");
      }),
    clear: () => {
      setup();
      mark(true);
    },
  }));

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${label}. Sign with your finger in the box.`}
          className="h-44 w-full touch-none rounded-2xl border-2 border-dashed border-ink-300 bg-white"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            last.current = point(e);
          }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return;
            const ctx = e.currentTarget.getContext("2d");
            const p = point(e);
            if (!ctx) return;
            ctx.beginPath();
            ctx.moveTo(last.current.x, last.current.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            last.current = p;
            if (empty) mark(false);
          }}
          onPointerUp={() => {
            drawing.current = false;
            last.current = null;
          }}
          onPointerCancel={() => {
            drawing.current = false;
            last.current = null;
          }}
        />
        {empty && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-base text-ink-500">Sign here</p>}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => {
            setup();
            mark(true);
          }}
          className="min-h-11 rounded-full px-4 text-sm font-semibold text-ink-700 hover:bg-surface"
        >
          Clear
        </button>
      </div>
    </div>
  );
});
