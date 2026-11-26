'use client';

import { useEffect, useRef } from 'react';
import { CARD_ART, cardArt, type CardLayout } from '@/components/scene/cardart';

const RANKS = 'AKQJT98765432';
const SUITS = 'shdc';
const CARDS = [...SUITS].flatMap((s) => [...RANKS].map((r) => r + s)).concat('back');

/** One sheet: every card in a layout, each art pixel `scale` CSS pixels. */
function Sheet({ layout, scale }: { layout: CardLayout; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h } = CARD_ART[layout];
  const cols = 13;
  const rows = Math.ceil(CARDS.length / cols);
  const gap = 4;
  useEffect(() => {
    const t = ref.current?.getContext('2d');
    if (!t) return;
    t.imageSmoothingEnabled = false;
    CARDS.forEach((card, i) => {
      const art = cardArt(card as never, layout);
      if (art) t.drawImage(art, (i % cols) * (w + gap) * scale, Math.floor(i / cols) * (h + gap) * scale, art.width * scale, art.height * scale);
    });
  }, [layout, scale, w, h]);
  const width = cols * (w + gap) * scale;
  const height = rows * (h + gap) * scale;
  return <canvas ref={ref} width={width} height={height} style={{ width, height, imageRendering: 'pixelated', display: 'block' }} />;
}

export default function DevCards() {
  return (
    <main style={{ padding: 16, background: '#1f6b45', minHeight: '100vh', overflow: 'auto' }}>
      {([2, 6] as const).map((scale) => (
        <section key={scale}>
          {(['upright', 'flat'] as const).map((layout) => (
            <div key={layout} style={{ marginBottom: 16 }}>
              <h2 style={{ color: '#f4ead5', margin: '8px 0' }}>
                {layout} · {scale === 2 ? 'scene size (2 px an art pixel)' : '3× enlarged'}
              </h2>
              <Sheet layout={layout} scale={scale} />
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
