"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { Region } from "@/lib/video-staged";

/** A picture (or a frame of a shot) on which the person drags a rectangle over
 * what should change. Works with mouse and finger; no library. */
export function ChangeMarker({ src, region, onChange }: { src: string; region: Region | null; onChange: (r: Region | null) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [from, setFrom] = useState<{ x: number; y: number } | null>(null);
  const at = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const span = (a: { x: number; y: number }, b: { x: number; y: number }): Region =>
    ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  return (
    <div className="space-y-1">
      <div ref={box} data-testid="marker" className="relative inline-block max-w-full cursor-crosshair select-none overflow-hidden rounded-md border"
        style={{ touchAction: "none" }}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setFrom(at(e)); onChange(null); }}
        onPointerMove={e => { if (from) onChange(span(from, at(e))); }}
        onPointerUp={e => {
          if (!from) return;
          const r = span(from, at(e));
          setFrom(null);
          onChange(r.w < 0.02 || r.h < 0.02 ? null : r);
        }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" draggable={false} className="block max-h-[60vh] w-auto" />
        {region && (
          <div className="pointer-events-none absolute border-2 border-electric bg-electric/15"
            style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }} />
        )}
      </div>
      <p className="text-[11px] text-slate-400">
        {region ? "Only the marked area changes. " : "Drag over the area that should change (optional). "}
        {region && <button type="button" className="underline" onClick={() => onChange(null)}>Clear the mark</button>}
      </p>
    </div>
  );
}
