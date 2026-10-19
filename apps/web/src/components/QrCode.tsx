// QR-код (SVG) — собственный кодировщик из @xb/shared (байтовый режим, уровень M).
import { useMemo } from 'react';
import { encodeQr, qrSvgPath } from '@xb/shared';

export function QrCode({ value, size = 128, margin = 4, title, className }: { value: string; size?: number; margin?: number; title?: string; className?: string }) {
  const q = useMemo(() => {
    try {
      return encodeQr(value);
    } catch {
      return null;
    }
  }, [value]);
  if (!q) return null;
  const dim = q.size + margin * 2;
  return (
    <svg
      className={`svc-qr ${className ?? ''}`}
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      role="img"
      aria-label={title ?? value}
      shapeRendering="crispEdges"
      data-qr-version={q.version}
      data-qr-value={value}
    >
      <rect width={dim} height={dim} fill="#fff" />
      <path d={qrSvgPath(q, margin)} fill="#000" />
    </svg>
  );
}
