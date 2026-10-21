"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function InvoicePreviewScale({ children }: Readonly<{ children: ReactNode }>) {
  const frameRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const frame = frameRef.current;
    const sheet = sheetRef.current;
    if (!frame || !sheet) return;

    const updateScale = () => {
      const unscaledWidth = sheet.offsetWidth;
      if (unscaledWidth === 0) return;
      const nextScale = Math.min(1, frame.clientWidth / unscaledWidth);
      setScale((current) => (Math.abs(current - nextScale) < 0.001 ? current : nextScale));
    };

    const observer = new ResizeObserver(updateScale);
    observer.observe(frame);
    updateScale();
    return () => observer.disconnect();
  }, []);

  return (
    <div className="invoice-preview-frame" ref={frameRef} style={{ height: `${297 * scale}mm` }}>
      <div
        className="invoice-preview-scale"
        ref={sheetRef}
        style={{ transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
