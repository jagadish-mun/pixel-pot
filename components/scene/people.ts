/*
 * Opponents: a dark-blue pixel person sitting behind the rail, with their face
 * icon printed on like a mask. Drawn procedurally from a 48-pixel-tall design
 * at whatever height the seat's distance calls for, once per pose, and cached.
 */
import { facePattern, hash } from '../../lib/faces';
import type { Party, Player } from '@/lib/types';
import { INK, offscreen } from './glyphs';

export type Pose = 'rest' | 'hold' | 'think' | 'fold' | 'out';

/** What an opponent is doing, from the table's state. */
export function poseOf(party: Party, p: Player, opts: { acting: boolean; showing: boolean }): Pose {
  const playing = party.phase !== 'idle';
  const inHand = playing && p.inHand;
  if (p.stack === 0 && !inHand) return 'out';
  if (inHand && p.folded) return 'fold';
  if (inHand && !opts.showing) return opts.acting ? 'think' : 'hold';
  return 'rest';
}

/** Small per-player timings, from their seed, so the table doesn't move in step. */
export function idle(seed: string, now: number): { bob: number; blink: boolean; tilt: boolean } {
  const h = hash(seed);
  const breath = 1800 + (h % 500);
  const bob = (now + (h % breath)) % breath < breath / 2 ? 0 : 1;
  const blinkEvery = 3200 + ((h >>> 8) % 3000);
  const blink = (now + ((h >>> 4) % blinkEvery)) % blinkEvery < 140;
  const tiltEvery = 9000 + ((h >>> 12) % 7000);
  const tilt = (now + ((h >>> 16) % tiltEvery)) % tiltEvery < 1600;
  return { bob, blink, tilt };
}

/* --------------------------------- palette -------------------------------- */

const BLUE = { hi: '#7489d6', lit: '#5a6fbd', mid: '#435499', shade: '#303d75', deep: '#212a54' };
const SHIRT = { lit: '#5068c0', mid: '#3c4f9a', shade: '#2c3a75', deep: '#1e2852' };
const GREY = { hi: '#8d8996', lit: '#76727f', mid: '#5f5b67', shade: '#48444f', deep: '#35323b' };
const GREY_SHIRT = { lit: '#57535f', mid: '#4a4652', shade: '#3c3943', deep: '#2e2c34' };
const MASK_BG = '#2b2440';

/* --------------------------------- sprites -------------------------------- */

/*
 * Two fixed pixel-art people, 20 × 28 cells, one row per string. Upper-case
 * letters are the body (drawn behind the table, hidden below the rail at row
 * RAIL_ROW); lower-case letters are the arms, hands and held cards (drawn on
 * top of the rail). F is where the face icon goes (7 × 7).
 *   O outline  H hair  L skin lit  S skin  D skin shade  N neck  T shirt lit  M shirt  U shirt shade
 *   o outline  l arm lit  s arm  d arm shade  h hand  k card back
 */
const FRONT_BODY = [
  '......OOOOOOOO......',
  '.....OHHHHHHHHO.....',
  '....OHHHHHHHHHHO....',
  '....OHLHHHHHHHDO....',
  '....OLFFFFFFFSDO....',
  '...OOLFFFFFFFSDOO...',
  '...OLLFFFFFFFSDDO...',
  '...OOLFFFFFFFSDOO...',
  '....OLFFFFFFFSDO....',
  '....OLFFFFFFFSDO....',
  '....OLFFFFFFFSDO....',
  '....OLSSSSSSSDDO....',
  '.....OLSSSSSDDO.....',
  '......OOOOOOOO......',
  '........ONNO........',
  '...OOOOOMNNMOOOOO...',
  '..OTTTTMMNNMMMMUUO..',
  '.OTTTTMMMMMMMMMUUUO.',
  '.OTTTMMMMMMMMMMMUUO.',
  '.OTTTMMMMMMMMMMMUUO.',
  '.OTTMMMMMMMMMMMMUUO.',
  '.OTTMMMMMMMMMMMMUUO.',
  '.OTTMMMMMMMMMMMMUUO.',
  '.OTTMMMMMMMMMMMMUUO.',
  '.OTTMMMMMMMMMMMMUUO.',
  '.OTTMMMMMMMMMMMMUUO.',
  '.OTTMMMMMMMMMMMMUUO.',
  '.OTTMMMMMMMMMMMMUUO.',
];
/** Turned about 35° toward the table's middle (to the right); mirrored for the other end. */
const QUARTER_BODY = [
  '........OOOOOOOO....',
  '.......OHHHHHHHHO...',
  '......OHHHHHHHHHHO..',
  '......OHHHHHHHHLDO..',
  '......OHHFFFFFFFDO..',
  '.....OOHHFFFFFFFDO..',
  '.....OLHHFFFFFFFDO..',
  '.....OOHHFFFFFFFDO..',
  '......OHHFFFFFFFDO..',
  '......OHHFFFFFFFDO..',
  '......OHHFFFFFFFDO..',
  '......OHSSSSSSSDDO..',
  '.......OHSSSSSDDO...',
  '........OOOOOOOO....',
  '..........ONNO......',
  '.....OOOOMNNMOOOOOO.',
  '....OTTTMMNNMMMMMUUO',
  '...OTTTMMMMMMMMMMUUO',
  '...OTTMMMMMMMMMMMUUO',
  '...OTTMMMMMMMMMMMUUO',
  '...OTMMMMMMMMMMMMUUO',
  '...OTMMMMMMMMMMMMUUO',
  '...OTMMMMMMMMMMMMUUO',
  '...OTMMMMMMMMMMMMUUO',
  '...OTMMMMMMMMMMMMUUO',
  '...OTMMMMMMMMMMMMUUO',
  '...OTMMMMMMMMMMMMUUO',
  '...OTMMMMMMMMMMMMUUO',
];
/** Arms for each pose, as rows starting at the given row of the sprite. */
const FRONT_ARMS: Record<'hold' | 'rest' | 'fold', [number, string[]]> = {
  hold: [
    14,
    [
      '.......ooooooo......',
      '.....oobbbbbbbo.....',
      '.....obkkbkkkbo.....',
      '.....obkkbkkkbo.....',
      '.....obkkbkkkbo.....',
      '.....hhbbbbbbhh.....',
      '....shhhoooohhhd....',
      '..lllsh......hddd...',
      '.lllll........ddddd.',
      '.ooooo........ooooo.',
    ],
  ],
  rest: [21, ['..lllllhhhhhhdddd...', '.llllllhhhhhhddddd..', '.ooooooooooooooooo..']],
  fold: [17, ['..llllllllddddddd...', '..ollllllldddddddo..', '...ooooooooooooooo..']],
};
const QUARTER_ARMS: Record<'hold' | 'rest' | 'fold', [number, string[]]> = {
  hold: [
    14,
    [
      '.........ooooooo....',
      '.......oobbbbbbbo...',
      '.......obkkbkkkbo...',
      '.......obkkbkkkbo...',
      '.......obkkbkkkbo...',
      '.......hhbbbbbbhh...',
      '......shhhoooohhhd..',
      '....lllsh......hddd.',
      '...lllll.......dddd.',
      '...ooooo.......oooo.',
    ],
  ],
  rest: [21, ['....llllllhhhhhdddd.', '...lllllllhhhhhdddd.', '...oooooooooooooooo.']],
  fold: [17, ['....llllllldddddddd.', '....olllllldddddddo.', '.....oooooooooooooo.']],
};
const COLS = 20;
const ROWS = 28;
/** The rail's top lies along this row: the body below it is hidden by the table. */
export const RAIL_ROW = 22;
/** One spare row above the head, so a person leaning back stays inside the sprite. */
const HEADROOM = 1;

export interface PersonLook {
  seed: string;
  robot: boolean;
  pose: Pose;
  /** Cards held in the hands (2 or 4) when holding or thinking. */
  cards: number;
  blink: boolean;
  tilt: boolean;
  /** At the rounded ends people sit turned toward the middle: 1 turned right, −1 left. */
  turn: -1 | 0 | 1;
  /** About how tall the person should be, in pixels; the sprite is drawn at the nearest whole-number scale. */
  height: number;
}

/** A person in two layers: the body (behind the table) and the forearms and hands (on the rail, over it). */
export interface PersonSprite {
  body: HTMLCanvasElement;
  arms: HTMLCanvasElement;
}

/** The whole-number scale for a wanted height, the sprite's size, and where the rail lies in it (pixels). */
export function spriteMetrics(height: number): { k: number; w: number; h: number; railY: number } {
  const k = Math.max(1, Math.round(height / ROWS));
  return { k, w: COLS * k, h: (ROWS + HEADROOM) * k, railY: (RAIL_ROW + HEADROOM) * k };
}

export const spriteSize = (height: number) => {
  const { w, h } = spriteMetrics(height);
  return { w, h };
};

const cache = new Map<string, PersonSprite | null>();

/** The person drawn into two small canvases, made once per look and reused. */
export function personSprite(look: PersonLook): PersonSprite | null {
  const { k, w, h } = spriteMetrics(look.height);
  const key = `${look.seed}|${look.robot}|${look.pose}|${look.cards}|${look.blink}|${look.tilt}|${look.turn}|${k}`;
  if (cache.has(key)) return cache.get(key)!;
  if (cache.size > 800) cache.clear();
  const body = offscreen(w, h);
  const arms = offscreen(w, h);
  const sprite = body && arms ? { body, arms } : null;
  if (sprite) paintPerson(sprite.body.getContext('2d')!, sprite.arms.getContext('2d')!, look, k);
  cache.set(key, sprite);
  return sprite;
}

const mirror = (rows: string[]) => rows.map((r) => [...r].reverse().join(''));

function paintPerson(bodyCtx: CanvasRenderingContext2D, armsCtx: CanvasRenderingContext2D, look: PersonLook, k: number) {
  const out = look.pose === 'out';
  const skin = out ? GREY : BLUE;
  const shirt = out ? GREY_SHIRT : SHIRT;
  const colours: Record<string, string> = {
    O: INK,
    H: skin.deep,
    L: skin.lit,
    S: skin.mid,
    D: skin.shade,
    N: skin.shade,
    F: MASK_BG,
    T: shirt.lit,
    M: shirt.mid,
    U: shirt.shade,
    o: INK,
    l: skin.lit,
    s: skin.mid,
    d: skin.shade,
    h: skin.hi,
    k: '#e2483d',
    b: '#f4ead5',
  };
  const quarter = look.turn !== 0;
  const flip = look.turn < 0;
  const body = flip ? mirror(QUARTER_BODY) : quarter ? QUARTER_BODY : FRONT_BODY;
  const armSet = quarter ? QUARTER_ARMS : FRONT_ARMS;
  const holding = (look.pose === 'hold' || look.pose === 'think') && look.cards > 0;
  const [armRow, armRowsRaw] = armSet[look.pose === 'fold' ? 'fold' : holding ? 'hold' : 'rest'];
  const armRows = flip ? mirror(armRowsRaw) : armRowsRaw;
  // Leaning moves the whole body one cell: forward (down) while thinking, back (up) when folded.
  const lean = look.pose === 'think' ? 1 : look.pose === 'fold' ? -1 : 0;
  const tilt = look.tilt ? 1 : 0;

  const paint = (ctx: CanvasRenderingContext2D, rows: string[], top: number, shiftHead: boolean) => {
    rows.forEach((row, r) => {
      // A tilted head moves one cell sideways (rows above the neck only).
      const dx = shiftHead && r <= 13 ? tilt : 0;
      [...row].forEach((c, x) => {
        if (c === '.') return;
        ctx.fillStyle = colours[c] ?? INK;
        ctx.fillRect((x + dx) * k, (top + r) * k, k, k);
      });
    });
  };
  paint(bodyCtx, body, HEADROOM + lean, true);
  // The face icon, printed into the F area.
  const fRow = body.findIndex((r) => r.includes('F'));
  const fCol = body[fRow].indexOf('F');
  paintMask(bodyCtx, look, (fCol + tilt) * k, (fRow + HEADROOM + lean) * k, k);
  paint(armsCtx, armRows, armRow + HEADROOM, false);
}

/** The face icon over the 7 × 7 face area, one sprite cell per icon cell, the shaded side darker. */
function paintMask(ctx: CanvasRenderingContext2D, look: PersonLook, x: number, y: number, k: number) {
  const { size, color, cells } = facePattern(look.seed, look.robot);
  const offset = size === 5 ? 1 : 0;
  ctx.fillStyle = MASK_BG;
  ctx.fillRect(x, y, 7 * k, 7 * k);
  ctx.fillStyle = look.pose === 'out' ? '#9a96a3' : color;
  if (look.blink) ctx.globalAlpha = 0.35;
  for (const [cx, cy] of cells) ctx.fillRect(x + (cx + offset) * k, y + (cy + offset) * k, k, k);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = INK;
  ctx.fillRect(x + 5 * k, y, 2 * k, 7 * k);
  ctx.globalAlpha = 1;
}
