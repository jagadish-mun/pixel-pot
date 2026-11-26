/*
 * Hand-drawn overrides: if public/sprites/<name>.png exists, the scene uses it
 * instead of the code-drawn sprite of the same name (same size and anchor; see
 * SPRITES.md). The list of PNGs comes from /api/sprites, built with the app, so
 * nothing missing is ever requested. Caches include `spriteVersion()`, which
 * goes up as each PNG finishes loading.
 */
import { offscreen } from './glyphs';

const images = new Map<string, HTMLImageElement>();
let asked = false;
let version = 0;

export const spriteVersion = () => version;

function ask() {
  if (asked || typeof window === 'undefined') return;
  asked = true;
  fetch('/api/sprites')
    .then((r) => (r.ok ? r.json() : { names: [] }))
    .then(({ names }: { names: string[] }) => {
      for (const name of names) {
        const img = new Image();
        img.onload = () => {
          images.set(name, img);
          version++;
        };
        img.src = `/sprites/${name}.png`;
      }
    })
    .catch(() => {});
}

/** The hand-drawn sprite `name` as a canvas, or null (then the code draws it). */
export function override(name: string): HTMLCanvasElement | null {
  ask();
  const img = images.get(name);
  if (!img) return null;
  const c = offscreen(img.naturalWidth, img.naturalHeight);
  c?.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}
