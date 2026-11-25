'use client';

import { useEffect, useRef } from 'react';
import { drawTower } from './draw';
import { chipTowers } from '@/lib/chips';

/** Chip towers for an amount, drawn like the table's chips, for places off the table (home page, award dialog). */
export default function ChipPile({ amount, scale = 3, maxTowers = 6 }: { amount: number; scale?: number; maxTowers?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const towers = chipTowers(amount, { maxChips: 60 }).towers.slice(0, maxTowers);
  const rx = 6;
  const ry = 3;
  const th = 2;
  const w = Math.max(1, towers.length * (2 * rx + 4) + 2);
  const h = Math.max(...towers.map((t) => t.count), 1) * th + 2 * ry + 5;
  const key = towers.map((t) => `${t.value}x${t.count}`).join(',');
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    towers.forEach((t, i) => drawTower(ctx, { x: 2 + rx + 1 + i * (2 * rx + 4), y: h - ry - 2, rx, ry, th, count: t.count, value: t.value }));
    // Redraw only when the towers change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, w, h]);
  if (!towers.length) return null;
  return <canvas ref={ref} className="chipPile" width={w} height={h} style={{ width: w * scale, height: h * scale }} aria-hidden="true" />;
}
