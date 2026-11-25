import { cardText, type Card } from './cards';
import { BOT_NAMES, decide, hashText, seededRandom, type BotView } from './bot';
import { bestHand, withArticle, type Hand } from './hand';
import type { Action, FeedItem, LegalActions, LogEntry, Move, Party, PartyRecord, Player, Settings, Street, TurnSnapshot } from './types';

/** An error that is safe to show to the player as-is. */
export class GameError extends Error {}

export const MAX_PLAYERS = 10;
export const NAME_MAX = 12;
export const MAX_CHIPS = 10_000_000;
const FEED_KEEP = 40;
const LOG_KEEP = 300;

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;

export function normalizeCode(raw: unknown): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, CODE_LENGTH);
}

export function cleanName(raw: unknown): string {
  const name = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  if (!name) throw new GameError('Enter a name first.');
  return name;
}

function int(raw: unknown, label: string, min: number, max: number): number {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new GameError(`${label} must be a whole number.`);
  if (n < min) throw new GameError(`${label} can't be less than ${min.toLocaleString('en-US')}.`);
  if (n > max) throw new GameError(`${label} can't be more than ${max.toLocaleString('en-US')}.`);
  return n;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'cardless',
  variant: 'holdem',
  betting: 'no-limit',
  turnOrder: true,
  actionTimer: 0,
  ante: 0,
  maxPlayers: MAX_PLAYERS,
  autoDeal: false,
  startingChips: 1000,
  smallBlind: 0,
  bigBlind: 0,
};

function oneOf<T>(raw: unknown, options: readonly T[], fallback: T, message: string): T {
  if (raw === undefined) return fallback;
  if (!options.includes(raw as T)) throw new GameError(message);
  return raw as T;
}

/**
 * Validate settings from a client. `seated` is how many players are already at
 * the table, so max players can't be set below it.
 */
export function cleanSettings(raw: Partial<Record<keyof Settings, unknown>> | undefined, seated = 0): Settings {
  const d = DEFAULT_SETTINGS;
  const startingChips = int(raw?.startingChips ?? d.startingChips, 'Starting chips', 1, 1_000_000);
  const smallBlind = int(raw?.smallBlind ?? d.smallBlind, 'Small blind', 0, 1_000_000);
  const bigBlind = int(raw?.bigBlind ?? d.bigBlind, 'Big blind', 0, 1_000_000);
  const ante = int(raw?.ante ?? d.ante, 'The ante', 0, 1_000_000);
  const maxPlayers = int(raw?.maxPlayers ?? d.maxPlayers, 'Max players', 2, MAX_PLAYERS);
  const mode = oneOf(raw?.mode, ['cardless', 'cards'] as const, d.mode, 'Pick Cardless or Cards.');
  const variant = oneOf(raw?.variant, ['holdem', 'omaha'] as const, d.variant, "Pick Hold'em or Omaha.");
  const betting = oneOf(
    raw?.betting,
    ['no-limit', 'pot-limit', 'fixed-limit'] as const,
    d.betting,
    'Pick no-limit, pot-limit or fixed-limit betting.',
  );
  const actionTimer = oneOf(raw?.actionTimer, [0, 15, 30, 60] as const, d.actionTimer, 'The action timer can be off, 15, 30 or 60 seconds.');
  const turnOrder = oneOf(raw?.turnOrder, [true, false] as const, d.turnOrder, 'Turn order must be on or off.');
  const autoDeal = oneOf(raw?.autoDeal, [true, false] as const, d.autoDeal, 'Auto-deal must be on or off.');

  if (smallBlind > bigBlind) throw new GameError("The small blind can't be bigger than the big blind.");
  if (betting === 'fixed-limit' && bigBlind === 0) {
    throw new GameError('Fixed-limit needs a big blind above 0, because bets go up in big-blind steps.');
  }
  if (ante > bigBlind) throw new GameError("The ante can't be bigger than the big blind.");
  if (maxPlayers < seated) {
    throw new GameError(`${seated} players are already seated, so max players can't be lower than ${seated}.`);
  }
  // Cards mode always takes turns.
  return {
    mode,
    variant,
    betting,
    turnOrder: mode === 'cards' || turnOrder,
    actionTimer,
    ante,
    maxPlayers,
    autoDeal,
    startingChips,
    smallBlind,
    bigBlind,
  };
}

/**
 * Fill in settings added after a table was saved. Old tables get turnOrder off,
 * so they keep the free-for-all betting they were created with.
 */
export function normalizeParty(party: Party): Party {
  const saved: Partial<Settings> = party.settings;
  party.settings = { ...DEFAULT_SETTINGS, turnOrder: false, ...saved };
  const old: Partial<Party> = party;
  party.street = old.street ?? 'preflop';
  party.toActId = old.toActId ?? null;
  party.awaitingDeal = old.awaitingDeal ?? null;
  party.lastRaiseSize = old.lastRaiseSize ?? 0;
  party.actedThisRound = old.actedThisRound ?? [];
  party.turnDeadline = old.turnDeadline ?? null;
  party.undoSnapshot = old.undoSnapshot ?? null;
  for (const p of party.players as Partial<Player>[]) {
    p.roundBet ??= 0;
    p.lastAction ??= null;
  }
  party.board = old.board ?? [];
  party.shown = old.shown ?? {};
  party.handResults = old.handResults ?? [];
  party.canShow = old.canShow ?? null;
  party.botActAt = old.botActAt ?? null;
  party.nextHandAt = old.nextHandAt ?? null;
  return party;
}

/** normalizeParty, plus the private card fields of the stored record. */
export function normalizeRecord(rec: PartyRecord): PartyRecord {
  normalizeParty(rec.party);
  rec.deck ??= [];
  rec.hole ??= {};
  rec.history ??= [];
  rec.moveStats ??= {};
  return rec;
}

/**
 * What one browser may see: the public table, plus that seat's own hole cards.
 * Never the deck or anyone else's cards. Every API response goes through here.
 */
export function viewFor(rec: PartyRecord, viewerId: string | null): { party: Party; myCards: Card[] | null } {
  const mine = viewerId ? rec.hole[viewerId] : undefined;
  return { party: rec.party, myCards: mine?.length ? [...mine] : null };
}

/*
 * The hand log (up to LOG_KEEP hands, every player's stack in each) is most of
 * a table's size but only grows when a hand ends. So browsers say which entry
 * they have last, and get just the newer ones instead of the whole log.
 */
export const logKey = (e: LogEntry) => `${e.ts}.${e.kind === 'hand' ? `h${e.n}` : `c${e.id}`}`;

/** Server: the entries after `key`, or null when the browser must take the whole log. */
export function logSince(log: LogEntry[], key: string | null): LogEntry[] | null {
  const i = key ? log.map(logKey).lastIndexOf(key) : -1;
  return i < 0 ? null : log.slice(i + 1);
}

/** Browser: add the newer entries after `after`, or null when it no longer has that entry. */
export function mergeLog(mine: LogEntry[], after: string, newer: LogEntry[]): LogEntry[] | null {
  const i = mine.map(logKey).lastIndexOf(after);
  return i < 0 ? null : [...mine.slice(0, i + 1), ...newer].slice(-LOG_KEEP);
}

const BETTING_SHORT: Record<Settings['betting'], string> = { 'no-limit': 'NL', 'pot-limit': 'PL', 'fixed-limit': 'Limit' };

/** e.g. "NL Hold'em", "PL Omaha". */
export function gameName(s: Pick<Settings, 'variant' | 'betting'>): string {
  return `${BETTING_SHORT[s.betting]} ${s.variant === 'omaha' ? 'Omaha' : "Hold'em"}`;
}

/** e.g. "NL Hold'em · Blinds 5/10 · Ante 1". */
export function tableLine(s: Settings): string {
  const parts = [gameName(s), s.bigBlind > 0 ? `Blinds ${fmt(s.smallBlind)}/${fmt(s.bigBlind)}` : 'No blinds'];
  if (s.ante > 0) parts.push(`Ante ${fmt(s.ante)}`);
  return parts.join(' · ');
}

/** e.g. "Cards · NL Hold'em · 5/10 · 1,000 chips". */
export function settingsSummary(s: Settings): string {
  const parts = [s.mode === 'cards' ? 'Cards' : 'Cardless', gameName(s)];
  parts.push(s.bigBlind > 0 ? `${fmt(s.smallBlind)}/${fmt(s.bigBlind)}` : 'No blinds');
  if (s.ante > 0) parts.push(`Ante ${fmt(s.ante)}`);
  parts.push(`${fmt(s.startingChips)} chips`);
  if (s.actionTimer > 0) parts.push(`${s.actionTimer}s timer`);
  if (s.mode === 'cardless' && !s.turnOrder) parts.push('Bet anytime');
  return parts.join(' · ');
}

function newPlayer(id: string, name: string, chips: number): Player {
  return { id, name, stack: chips, buyIn: chips, bet: 0, roundBet: 0, inHand: false, folded: false, undo: [], lastAction: null, lastDelta: null };
}

function say(party: Party, kind: FeedItem['kind'], text: string, now: number) {
  party.feedSeq += 1;
  party.feed.push({ id: party.feedSeq, ts: now, kind, text });
  if (party.feed.length > FEED_KEEP) party.feed.splice(0, party.feed.length - FEED_KEEP);
}

const fmt = (n: number) => n.toLocaleString('en-US');

export function potOf(party: Party): number {
  return party.players.reduce((sum, p) => sum + p.bet, 0);
}

export function highBet(party: Party): number {
  return party.players.reduce((max, p) => Math.max(max, p.bet), 0);
}

/**
 * The pot split into the main pot and side pots, for display. Each layer is
 * what every player put in up to an all-in level, and who can still win it.
 */
export function potsOf(party: Party): { amount: number; eligible: string[] }[] {
  const contenders = party.players.filter((p) => p.inHand && !p.folded && p.bet > 0);
  const levels = [...new Set(contenders.map((p) => p.bet))].sort((a, b) => a - b);
  const pots: { amount: number; eligible: string[] }[] = [];
  let below = 0;
  for (const level of levels) {
    const amount = party.players.reduce((sum, p) => sum + Math.max(0, Math.min(p.bet, level) - below), 0);
    const eligible = contenders.filter((p) => p.bet >= level).map((p) => p.id);
    // Eligible sets only shrink as the level rises, so the same size means the same players.
    const prev = pots[pots.length - 1];
    if (prev && prev.eligible.length === eligible.length) prev.amount += amount;
    else pots.push({ amount, eligible });
    below = level;
  }
  // Chips folded players put in above the top level still belong to the last pot.
  const counted = pots.reduce((sum, p) => sum + p.amount, 0);
  if (pots.length) pots[pots.length - 1].amount += potOf(party) - counted;
  return pots;
}

/** True once the host has awarded part of the pot and a side pot is left to give out. */
export function awardingSidePot(party: Party): boolean {
  return party.phase === 'showdown' && Object.keys(party.won).length > 0;
}

/** Players who can still be given (part of) the pot. */
export function eligibleWinners(party: Party): Player[] {
  return party.players.filter((p) => p.inHand && !p.folded && p.bet > 0);
}

export function createParty(
  code: string,
  hostId: string,
  hostToken: string,
  hostName: unknown,
  rawSettings: Partial<Record<keyof Settings, unknown>> | undefined,
  now: number,
): PartyRecord {
  const settings = cleanSettings(rawSettings);
  const name = cleanName(hostName);
  const party: Party = {
    code,
    hostId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    settings,
    players: [newPlayer(hostId, name, settings.startingChips)],
    phase: 'idle',
    handNo: 0,
    dealerId: null,
    prevDealerId: null,
    sbId: null,
    bbId: null,
    handStart: {},
    won: {},
    potAtShowdown: 0,
    log: [],
    feed: [],
    feedSeq: 0,
    street: 'preflop',
    toActId: null,
    awaitingDeal: null,
    lastRaiseSize: 0,
    actedThisRound: [],
    turnDeadline: null,
    undoSnapshot: null,
    board: [],
    shown: {},
    handResults: [],
    canShow: null,
    botActAt: null,
    nextHandAt: null,
  };
  say(party, 'info', `${name} opened the table`, now);
  return { party, tokens: { [hostId]: hostToken }, deck: [], hole: {}, history: [], moveStats: {} };
}

export function joinParty(rec: PartyRecord, id: string, token: string, rawName: unknown, now: number): void {
  const { party } = rec;
  const name = cleanName(rawName);
  const max = party.settings.maxPlayers;
  if (party.players.length >= max) throw new GameError(`This table is full (${max} players).`);
  if (party.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new GameError(`Someone at this table is already called ${name}. Pick another name.`);
  }
  party.players.push(newPlayer(id, name, party.settings.startingChips));
  rec.tokens[id] = token;
  say(party, 'info', `${name} sat down with ${fmt(party.settings.startingChips)}`, now);
}

function nextInHand(party: Party, afterId: string | null): Player {
  const n = party.players.length;
  const from = party.players.findIndex((p) => p.id === afterId);
  for (let i = 1; i <= n; i++) {
    const p = party.players[(from + i + n) % n];
    if (p.inHand) return p;
  }
  throw new GameError('No one is in the hand.');
}

function postBlind(p: Player, blind: number) {
  const amount = Math.min(p.stack, blind);
  p.stack -= amount;
  p.bet += amount;
  p.roundBet += amount;
}

/** True when this table plays in turns: cards mode always does, cardless when the host turned it on. */
export function usesTurns(party: Party): boolean {
  return party.settings.mode === 'cards' || party.settings.turnOrder;
}

/** Forget all turn and street state (a hand ended, was cancelled, or is about to start). */
function clearTurns(party: Party) {
  for (const p of party.players) {
    p.roundBet = 0;
    p.lastAction = null;
  }
  party.street = 'preflop';
  party.toActId = null;
  party.awaitingDeal = null;
  party.lastRaiseSize = 0;
  party.actedThisRound = [];
  party.turnDeadline = null;
  party.botActAt = null;
  party.undoSnapshot = null;
}

/** Cards mode: deal each player their hole cards one at a time, starting left of the button. */
function dealHoles(rec: PartyRecord, deck: Card[] | undefined) {
  const { party } = rec;
  if (!deck || deck.length !== 52) throw new Error('Cards mode needs a shuffled 52-card deck to deal.');
  rec.deck = [...deck];
  const first = nextInHand(party, party.dealerId);
  const order = [first];
  for (let p = nextInHand(party, first.id); p !== first; p = nextInHand(party, p.id)) order.push(p);
  for (const p of order) rec.hole[p.id] = [];
  const count = party.settings.variant === 'omaha' ? 4 : 2;
  for (let round = 0; round < count; round++) for (const p of order) rec.hole[p.id].push(rec.deck.shift()!);
}

/** Throw away every card: the next hand, or a cancelled one. */
function clearCards(rec: PartyRecord) {
  rec.deck = [];
  rec.hole = {};
  rec.party.board = [];
  rec.party.shown = {};
  rec.party.handResults = [];
  rec.party.canShow = null;
}

function startHand(rec: PartyRecord, now: number, deck?: Card[]) {
  const { party } = rec;
  if (party.phase !== 'idle') throw new GameError('Finish the current hand first.');
  const withChips = party.players.filter((p) => p.stack > 0);
  if (withChips.length < 2) throw new GameError('You need at least 2 players with chips to start a hand.');

  party.phase = 'live';
  party.handNo += 1;
  party.handStart = {};
  party.won = {};
  party.potAtShowdown = 0;
  clearTurns(party);
  clearCards(rec);
  rec.history = [];
  party.nextHandAt = null;
  for (const p of party.players) {
    p.bet = 0;
    p.folded = false;
    p.undo = [];
    p.inHand = p.stack > 0;
    if (p.inHand) party.handStart[p.id] = p.stack;
  }

  party.prevDealerId = party.dealerId;
  const dealer = nextInHand(party, party.dealerId);
  party.dealerId = dealer.id;
  party.sbId = null;
  party.bbId = null;

  const { smallBlind, bigBlind, ante } = party.settings;
  // Antes go in the pot but don't count toward calling the blinds.
  if (ante > 0) {
    for (const p of party.players) {
      if (!p.inHand) continue;
      const amount = Math.min(p.stack, ante);
      p.stack -= amount;
      p.bet += amount;
    }
  }
  if (bigBlind > 0) {
    // Heads-up, the dealer posts the small blind.
    const sb = withChips.length === 2 ? dealer : nextInHand(party, dealer.id);
    const bb = nextInHand(party, sb.id);
    if (smallBlind > 0) {
      postBlind(sb, smallBlind);
      party.sbId = sb.id;
    }
    postBlind(bb, bigBlind);
    party.bbId = bb.id;
  }
  say(party, 'info', `Hand ${party.handNo} started. ${dealer.name} has the button`, now);

  if (party.settings.mode === 'cards') dealHoles(rec, deck);

  if (usesTurns(party)) {
    party.lastRaiseSize = bigBlind;
    // Preflop, the player left of the big blind acts first (heads-up that's the dealer).
    proceed(rec, party.bbId ?? dealer.id, now);
    if (party.toActId) say(party, 'info', `Preflop: ${nameOf(party, party.toActId)} to act`, now);
  }
}

function putIn(party: Party, p: Player, amount: number, now: number) {
  const before = highBet(party);
  p.stack -= amount;
  p.bet += amount;
  p.undo.push({ t: 'bet', amount });
  let text: string;
  if (p.stack === 0) [text, p.lastAction] = [`${p.name} is all in for ${fmt(p.bet)}`, 'All in'];
  else if (p.bet === before) [text, p.lastAction] = [`${p.name} calls ${fmt(amount)}`, `Call ${fmt(amount)}`];
  else if (before === 0) [text, p.lastAction] = [`${p.name} bets ${fmt(amount)}`, `Bet ${fmt(amount)}`];
  else if (p.bet > before) [text, p.lastAction] = [`${p.name} raises to ${fmt(p.bet)}`, `Raise ${fmt(p.bet)}`];
  else [text, p.lastAction] = [`${p.name} puts in ${fmt(amount)}`, `Bet ${fmt(amount)}`];
  say(party, 'bet', text, now);
}

function requireActing(party: Party, p: Player) {
  if (party.phase === 'showdown') throw new GameError('The host is awarding the pot. Betting is closed.');
  if (party.phase !== 'live') throw new GameError('Wait for the host to start the next hand.');
  if (!p.inHand) throw new GameError("You'll be dealt in next hand.");
}

function finishHand(party: Party, now: number) {
  const rows = party.players
    .filter((p) => p.inHand)
    .map((p) => ({ id: p.id, name: p.name, before: party.handStart[p.id] ?? p.stack, after: p.stack }));
  party.log.push({
    kind: 'hand',
    n: party.handNo,
    ts: now,
    pot: party.potAtShowdown,
    winners: Object.keys(party.won).filter((id) => party.won[id] > 0),
    rows,
  });
  if (party.log.length > LOG_KEEP) party.log.splice(0, party.log.length - LOG_KEEP);
  for (const p of party.players) {
    if (p.inHand) p.lastDelta = p.stack - (party.handStart[p.id] ?? p.stack);
    p.bet = 0;
    p.folded = false;
    p.inHand = false;
    p.undo = [];
  }
  party.phase = 'idle';
  party.won = {};
  party.handStart = {};
  party.sbId = null;
  party.bbId = null;
  clearTurns(party);
  party.nextHandAt = wantsAutoDeal(party) ? now + AUTO_DEAL_MS : null;
}

const AUTO_DEAL_MS = 3000;
const isHuman = (p: Player) => !p.bot;

/** Auto-deal applies to card tables with exactly one human, when there's someone to play. */
function wantsAutoDeal(party: Party): boolean {
  return (
    party.settings.autoDeal &&
    party.settings.mode === 'cards' &&
    party.players.filter(isHuman).length === 1 &&
    party.players.filter((p) => p.stack > 0).length >= 2
  );
}

function give(party: Party, p: Player, amount: number) {
  if (amount <= 0) return;
  p.stack += amount;
  party.won[p.id] = (party.won[p.id] ?? 0) + amount;
}

/** Take up to `level` from every player's bet: one pot slice. Returns its size and who put what in. */
function takeSlice(party: Party, level: number): { total: number; parts: Map<string, number> } {
  let total = 0;
  const parts = new Map<string, number>();
  for (const p of party.players) {
    const part = Math.min(p.bet, level);
    p.bet -= part;
    total += part;
    parts.set(p.id, part);
  }
  return { total, parts };
}

/** Split `amount` between winners; odd chips go one at a time in seat order. Returns what each got. */
function payOut(party: Party, winners: Player[], amount: number): Map<string, number> {
  const share = Math.floor(amount / winners.length);
  let odd = amount - share * winners.length;
  const paid = new Map<string, number>();
  for (const w of winners) {
    const extra = odd > 0 ? 1 : 0;
    odd -= extra;
    give(party, w, share + extra);
    paid.set(w.id, share + extra);
  }
  return paid;
}

const joinNames = (names: string[]) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * Cards mode: turn everyone's cards up and pay each pot slice to the best hand
 * among the players in it, the same slices the host would award by hand.
 */
function showdown(rec: PartyRecord, now: number) {
  const { party } = rec;
  party.phase = 'showdown';
  party.awaitingDeal = null;
  party.potAtShowdown = potOf(party);
  const live = party.players.filter(isLive);
  const hands = new Map<string, Hand>();
  for (const p of live) {
    party.shown[p.id] = rec.hole[p.id] ?? [];
    hands.set(p.id, bestHand(party.shown[p.id], party.board, party.settings.variant));
  }
  const score = (p: Player) => hands.get(p.id)!.score;
  const results = new Map<string, number>(live.map((p) => [p.id, 0]));
  let lastWinners: Player[] = [];

  while (potOf(party) > 0) {
    const contenders = live.filter((p) => p.bet > 0);
    if (contenders.length === 0) {
      // Only folded players' chips are left, above every live player's level: they go with the last pot.
      const { total } = takeSlice(party, Infinity);
      if (lastWinners.length) for (const [id, n] of payOut(party, lastWinners, total)) results.set(id, results.get(id)! + n);
      break;
    }
    const level = Math.min(...contenders.map((p) => p.bet));
    const { total, parts } = takeSlice(party, level);
    const top = Math.max(...contenders.map(score));
    const winners = contenders.filter((p) => score(p) === top);
    const paid = payOut(party, winners, total);

    if (contenders.length === 1 && total === parts.get(winners[0].id)) {
      // Nobody else reached this level: these are the player's own uncalled chips.
      party.won[winners[0].id] -= total;
      say(party, 'info', `${fmt(total)} uncalled goes back to ${winners[0].name}`, now);
      continue;
    }
    for (const [id, n] of paid) results.set(id, results.get(id)! + n);
    const hand = withArticle(hands.get(winners[0].id)!);
    const names = joinNames(winners.map((w) => w.name));
    say(party, 'win', `${names} ${winners.length === 1 ? 'wins' : 'split'} ${fmt(total)} with ${hand}`, now);
    lastWinners = winners;
  }

  party.handResults = live.map((p) => ({
    id: p.id,
    hand: hands.get(p.id)!.name,
    best: hands.get(p.id)!.cards,
    amount: results.get(p.id)!,
  }));
  finishHand(party, now);
}

/**
 * Give the pot (or the next slice of it) to the chosen winners.
 *
 * A winner can only take from each player as much as they put in themselves.
 * Whatever is left over is a side pot: if exactly one player who hasn't folded
 * still has chips in it, they get it automatically; otherwise the host picks
 * again from the players who are still eligible.
 */
function award(party: Party, winnerIds: unknown, now: number) {
  if (party.phase !== 'live' && party.phase !== 'showdown') throw new GameError('There is no hand to award.');
  if (party.phase === 'live') party.potAtShowdown = potOf(party);
  // Awarding ends the betting, even if the host does it mid-street.
  party.toActId = null;
  party.turnDeadline = null;
  party.botActAt = null;
  party.awaitingDeal = null;

  if (potOf(party) === 0) {
    say(party, 'info', `Hand ${party.handNo} ended with an empty pot`, now);
    finishHand(party, now);
    return;
  }

  const ids = Array.isArray(winnerIds) ? [...new Set(winnerIds.map(String))] : [];
  if (ids.length === 0) throw new GameError('Pick who won the pot.');
  const eligible = eligibleWinners(party);
  const winners = party.players.filter((p) => ids.includes(p.id));
  if (winners.length !== ids.length || winners.some((w) => !eligible.includes(w))) {
    throw new GameError("One of those players can't win this pot. They folded or have no chips in it.");
  }

  const level = Math.min(...winners.map((w) => w.bet));
  const { total: slice } = takeSlice(party, level);
  payOut(party, winners, slice);
  const names = winners.map((w) => w.name);
  say(
    party,
    'win',
    winners.length === 1
      ? `${names[0]} wins ${fmt(slice)}`
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} split ${fmt(slice)}`,
    now,
  );

  // Settle anything left that doesn't need a decision.
  const left = party.players.filter((p) => p.bet > 0);
  if (left.length > 0) {
    const stillIn = left.filter((p) => !p.folded);
    if (stillIn.length >= 2) {
      party.phase = 'showdown';
      return;
    }
    if (stillIn.length === 1) {
      const rest = left.reduce((sum, p) => sum + p.bet, 0);
      const own = stillIn[0].bet;
      for (const p of left) p.bet = 0;
      give(party, stillIn[0], rest);
      // Getting your own uncalled chips back isn't a win, so don't count it as one.
      party.won[stillIn[0].id] -= Math.min(own, rest);
      if (rest > own) say(party, 'win', `${stillIn[0].name} takes the ${fmt(rest)} side pot`, now);
      else say(party, 'info', `${fmt(rest)} uncalled goes back to ${stillIn[0].name}`, now);
    } else {
      for (const p of left) {
        p.stack += p.bet;
        p.bet = 0;
      }
    }
  }
  finishHand(party, now);
}

function voidHand(rec: PartyRecord, now: number) {
  const { party } = rec;
  if (party.phase === 'idle') throw new GameError('There is no hand to cancel.');
  clearCards(rec);
  rec.history = [];
  // The host stepped in, so don't deal the next hand by itself.
  party.nextHandAt = null;
  for (const p of party.players) {
    if (p.inHand) p.stack = party.handStart[p.id] ?? p.stack + p.bet;
    p.bet = 0;
    p.folded = false;
    p.inHand = false;
    p.undo = [];
  }
  say(party, 'info', `Hand ${party.handNo} was cancelled. All chips returned`, now);
  party.handNo -= 1;
  party.dealerId = party.prevDealerId;
  party.phase = 'idle';
  party.won = {};
  party.handStart = {};
  party.sbId = null;
  party.bbId = null;
  clearTurns(party);
}

/* ------------------------------- turn-based play ------------------------------ */

const NEXT_STREET: Record<Street, Exclude<Street, 'preflop'> | null> = { preflop: 'flop', flop: 'turn', turn: 'river', river: null };
const STREET_NAME: Record<Street, string> = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };
/** Fixed-limit: the most bets in one round (a bet and three raises; preflop the big blind is the first). */
const LIMIT_CAP = 4;

const nameOf = (party: Party, id: string | null) => party.players.find((p) => p.id === id)?.name ?? 'Someone';

/** Still holding cards. */
const isLive = (p: Player) => p.inHand && !p.folded;
/** Still holding cards and able to put more chips in. */
const canBet = (p: Player) => isLive(p) && p.stack > 0;

function roundHigh(party: Party): number {
  return party.players.reduce((max, p) => Math.max(max, p.roundBet), 0);
}

/** Bet size for this street: the big blind, doubled on the turn and river in fixed-limit. */
function betUnit(party: Party): number {
  const bb = Math.max(1, party.settings.bigBlind);
  const late = party.street === 'turn' || party.street === 'river';
  return party.settings.betting === 'fixed-limit' && late ? bb * 2 : bb;
}

/** The smallest roundBet that counts as a full bet or raise (anything less is a short all-in). */
function minRaiseTo(party: Party, high: number): number {
  const unit = betUnit(party);
  if (party.settings.betting === 'fixed-limit') return (Math.floor(high / unit) + 1) * unit;
  return high + Math.max(unit, party.lastRaiseSize);
}

/** What `playerId` may do right now. Everything is off when it isn't their turn. */
export function legalActions(party: Party, playerId: string): LegalActions {
  const none: LegalActions = { fold: false, check: false, call: null, bet: null, raise: null, allin: null };
  const me = party.players.find((p) => p.id === playerId);
  if (!me || !usesTurns(party) || party.phase !== 'live' || party.awaitingDeal || party.toActId !== playerId) return none;

  const high = roundHigh(party);
  const facing = high - me.roundBet;
  const allInTo = me.roundBet + me.stack;
  const legal: LegalActions = {
    fold: true,
    check: facing === 0,
    call: facing > 0 ? Math.min(facing, me.stack) : null,
    bet: null,
    raise: null,
    allin: null,
  };

  // Betting more needs someone left to answer it, and is closed to players who already
  // acted since the last full raise (a short all-in doesn't reopen it).
  const someoneCanAnswer = party.players.some((p) => p.id !== me.id && canBet(p));
  const reopened = !party.actedThisRound.includes(me.id);
  const capped = party.settings.betting === 'fixed-limit' && Math.floor(high / betUnit(party)) >= LIMIT_CAP;
  if (someoneCanAnswer && reopened && !capped && allInTo > high) {
    const min = minRaiseTo(party, high);
    let max = allInTo;
    if (party.settings.betting === 'fixed-limit') max = min;
    // Pot-limit: the biggest raise is the size of the pot after you call.
    if (party.settings.betting === 'pot-limit') max = high + potOf(party) + facing;
    max = Math.min(max, allInTo);
    if (allInTo >= min) {
      if (high === 0) legal.bet = { min, max };
      else legal.raise = { min, max };
    }
    if (allInTo <= max) legal.allin = allInTo;
  }
  // Going all in for no more than the call is always allowed.
  if (legal.allin === null && me.stack > 0 && me.stack <= facing) legal.allin = allInTo;
  return legal;
}

/**
 * Whenever the turn changes: start the action timer for a human, or give a
 * computer player 0.8–2.5 s of "thinking" before any human's browser asks it
 * to move ('bot_step'). The delay is a hash of the table state, so this stays pure.
 */
function setDeadline(party: Party, now: number) {
  const actor = party.players.find((p) => p.id === party.toActId);
  const seconds = party.settings.actionTimer;
  party.turnDeadline = actor && !actor.bot && seconds > 0 ? now + seconds * 1000 : null;
  party.botActAt = actor?.bot ? now + 800 + (hashText(`${party.code}:${party.handNo}:${party.feedSeq}`) % 1701) : null;
}

/** A round is over when everyone who can still bet has acted since the last full raise and matched the top bet. */
function roundComplete(party: Party): boolean {
  const high = roundHigh(party);
  const active = party.players.filter(canBet);
  return active.every((p) => p.roundBet === high && (party.actedThisRound.includes(p.id) || active.length === 1));
}

/** The next player after `afterId` (in seat order) who still has to act this round. */
function nextToAct(party: Party, afterId: string | null): Player | null {
  const high = roundHigh(party);
  const n = party.players.length;
  const from = party.players.findIndex((p) => p.id === afterId);
  for (let i = 1; i <= n; i++) {
    const p = party.players[(from + i + n) % n];
    if (canBet(p) && (!party.actedThisRound.includes(p.id) || p.roundBet < high)) return p;
  }
  return null;
}

/** After any change to the betting: win by folds, end the round, or pass the turn on. */
function proceed(rec: PartyRecord, afterId: string | null, now: number) {
  const { party } = rec;
  const live = party.players.filter(isLive);
  if (live.length === 1) {
    // Everyone else folded. The last player wins without a showdown, and may show their cards or not.
    party.toActId = null;
    party.turnDeadline = null;
    party.botActAt = null;
    award(party, [live[0].id], now);
    if (party.settings.mode === 'cards') party.canShow = live[0].id;
    return;
  }
  if (roundComplete(party)) {
    advanceStreet(rec, now);
    return;
  }
  party.toActId = nextToAct(party, afterId)?.id ?? null;
  setDeadline(party, now);
}

const BOARD_CARDS: Record<Exclude<Street, 'preflop'>, number> = { flop: 3, turn: 1, river: 1 };

/**
 * Close the current betting round and move to the next street, or to the
 * showdown after the river. Cards mode burns one and deals the board here;
 * cardless waits for the real cards ('dealt').
 */
export function advanceStreet(rec: PartyRecord, now: number) {
  const { party } = rec;
  for (const p of party.players) {
    p.roundBet = 0;
    p.lastAction = null;
  }
  party.actedThisRound = [];
  party.lastRaiseSize = 0;
  party.toActId = null;
  party.turnDeadline = null;
  party.botActAt = null;
  party.undoSnapshot = null;

  const next = NEXT_STREET[party.street];
  if (!next && party.settings.mode === 'cards') {
    showdown(rec, now);
    return;
  }
  if (!next) {
    party.phase = 'showdown';
    party.awaitingDeal = null;
    party.potAtShowdown = potOf(party);
    say(party, 'info', `Showdown. ${nameOf(party, party.hostId)} awards the pot`, now);
    return;
  }
  party.street = next;
  if (party.settings.mode === 'cardless') {
    // The real cards go on the table first; 'dealt' opens the betting.
    party.awaitingDeal = next;
    return;
  }
  rec.deck.shift(); // burn
  const dealt = rec.deck.splice(0, BOARD_CARDS[next]);
  party.board.push(...dealt);
  say(party, 'info', `${STREET_NAME[next]}: ${dealt.map(cardText).join(' ')}`, now);
  openBetting(rec, now);
}

/** Start betting on a fresh street, or keep running the board out if nobody can bet. */
function openBetting(rec: PartyRecord, now: number) {
  const { party } = rec;
  if (party.players.filter(canBet).length <= 1) {
    // Nobody left to bet against: run the rest of the board out.
    advanceStreet(rec, now);
    return;
  }
  // After the flop, the first player left of the button acts first.
  party.toActId = nextToAct(party, party.dealerId)?.id ?? null;
  setDeadline(party, now);
  say(party, 'info', `${STREET_NAME[party.street]}: ${nameOf(party, party.toActId)} to act`, now);
}

function snapshot(party: Party, by: string): TurnSnapshot {
  return {
    by,
    players: party.players.map(({ id, stack, bet, roundBet, folded, lastAction }) => ({ id, stack, bet, roundBet, folded, lastAction })),
    toActId: party.toActId,
    lastRaiseSize: party.lastRaiseSize,
    actedThisRound: [...party.actedThisRound],
  };
}

/** Put `p`'s roundBet up to `to`. Records whether it was a full raise, which reopens betting. */
function betTo(party: Party, p: Player, to: number, now: number) {
  const high = roundHigh(party);
  const full = minRaiseTo(party, high);
  const amount = to - p.roundBet;
  p.stack -= amount;
  p.bet += amount;
  p.roundBet = to;
  if (to >= full) {
    party.lastRaiseSize = to - high;
    party.actedThisRound = [p.id];
  } else if (!party.actedThisRound.includes(p.id)) {
    party.actedThisRound.push(p.id);
  }
  let text: string;
  if (p.stack === 0) [text, p.lastAction] = [`${p.name} is all in for ${fmt(to)}`, 'All in'];
  else if (to <= high) [text, p.lastAction] = [`${p.name} calls ${fmt(amount)}`, `Call ${fmt(amount)}`];
  else if (high === 0) [text, p.lastAction] = [`${p.name} bets ${fmt(to)}`, `Bet ${fmt(to)}`];
  else [text, p.lastAction] = [`${p.name} raises to ${fmt(to)}`, `Raise ${fmt(to)}`];
  say(party, 'bet', text, now);
}

function check(party: Party, p: Player) {
  p.lastAction = 'Check';
  if (!party.actedThisRound.includes(p.id)) party.actedThisRound.push(p.id);
}

function range(what: string, r: { min: number; max: number }): string {
  return r.min === r.max ? `The ${what} is ${fmt(r.min)} here.` : `You can ${what} from ${fmt(r.min)} to ${fmt(r.max)}.`;
}

/** Remember a betting move: this hand's history, and the player's habits for the hard computer players. */
function recordMove(rec: PartyRecord, p: Player, type: Move['type']) {
  rec.history.push({ id: p.id, type, to: p.roundBet, street: rec.party.street });
  const stats = (rec.moveStats[p.id] ??= { aggressive: 0, passive: 0, folds: 0 });
  if (type === 'fold') stats.folds += 1;
  else if (type === 'check' || type === 'call') stats.passive += 1;
  else stats.aggressive += 1;
}

/**
 * What computer player `botId` may know: its own cards, the board, the pot,
 * stacks, bets, position and this hand's moves. Never the deck or anyone else's cards.
 */
export function botView(rec: PartyRecord, botId: string): BotView {
  const { party } = rec;
  const me = party.players.find((p) => p.id === botId);
  if (!me) throw new GameError('That player isn\'t at the table.');
  const inHand = party.players.filter((p) => p.inHand);
  // Live players after me up to the button act after me on every street after the flop.
  const n = party.players.length;
  const myIndex = party.players.indexOf(me);
  let playersAfterMe = 0;
  for (let i = 1; i < n; i++) {
    const p = party.players[(myIndex + i) % n];
    if (p.id === party.dealerId && p !== me) {
      if (isLive(p)) playersAfterMe += 1;
      break;
    }
    if (isLive(p)) playersAfterMe += 1;
    if (p.id === party.dealerId) break;
  }
  if (me.id === party.dealerId) playersAfterMe = 0;
  const stats: BotView['stats'] = {};
  for (const p of inHand) if (p.id !== botId && rec.moveStats[p.id]) stats[p.id] = { ...rec.moveStats[p.id] };
  return {
    id: botId,
    level: me.bot?.level ?? 'medium',
    cards: [...(rec.hole[botId] ?? [])],
    board: [...party.board],
    street: party.street,
    variant: party.settings.variant,
    betting: party.settings.betting,
    bigBlind: party.settings.bigBlind,
    pot: potOf(party),
    high: roundHigh(party),
    roundBet: me.roundBet,
    stack: me.stack,
    players: inHand.map((p) => ({ id: p.id, stack: p.stack, roundBet: p.roundBet, folded: p.folded })),
    playersAfterMe,
    history: rec.history.map((m) => ({ ...m })),
    stats,
  };
}

/** Seat a computer player. Card tables only, between hands. */
export function addBot(rec: PartyRecord, rawLevel: unknown, now: number): Player {
  const { party } = rec;
  if (party.settings.mode !== 'cards') throw new GameError('Computer players can only sit at card tables.');
  if (party.phase !== 'idle') throw new GameError('You can add players between hands.');
  const level = oneOf(rawLevel, ['easy', 'medium', 'hard'] as const, 'medium', 'Pick easy, medium or hard.');
  const max = party.settings.maxPlayers;
  if (party.players.length >= max) throw new GameError(`This table is full (${max} players).`);
  const taken = new Set(party.players.map((p) => p.name.toLowerCase()));
  const name = BOT_NAMES.find((x) => !taken.has(x.toLowerCase())) ?? `Bot ${party.players.length + 1}`;
  let id = `bot-${party.feedSeq + 1}`;
  while (party.players.some((p) => p.id === id)) id += 'x';
  const bot: Player = { ...newPlayer(id, name, party.settings.startingChips), bot: { level } };
  party.players.push(bot);
  say(party, 'info', `${name} (AI, ${level}) sat down with ${fmt(party.settings.startingChips)}`, now);
  return bot;
}

/** Bets, folds and the rest on a turn-based table. */
function turnAction(rec: PartyRecord, actor: Player, action: Action, isHost: boolean, now: number) {
  const { party } = rec;

  switch (action.type) {
    case 'dealt': {
      if (party.phase !== 'live' || !party.awaitingDeal) throw new GameError('There is nothing to deal right now.');
      if (!isHost && actor.id !== party.dealerId) throw new GameError('Only the dealer or the host can say the cards are out.');
      say(party, 'info', `${STREET_NAME[party.awaitingDeal]} is out`, now);
      party.awaitingDeal = null;
      openBetting(rec, now);
      return;
    }

    case 'timeout': {
      if (party.phase !== 'live' || !party.toActId || party.turnDeadline === null || now <= party.turnDeadline) {
        throw new GameError('There is still time left.');
      }
      const slow = party.players.find((p) => p.id === party.toActId)!;
      party.undoSnapshot = null;
      if (legalActions(party, slow.id).check) {
        check(party, slow);
        recordMove(rec, slow, 'check');
        say(party, 'info', `${slow.name} ran out of time and checks`, now);
      } else {
        slow.folded = true;
        slow.lastAction = 'Fold';
        recordMove(rec, slow, 'fold');
        say(party, 'fold', `${slow.name} ran out of time and folds`, now);
      }
      proceed(rec, slow.id, now);
      return;
    }

    case 'undo': {
      const snap = party.undoSnapshot;
      if (party.phase !== 'live' || !snap || snap.by !== actor.id) {
        throw new GameError('You can only take back your own last move, before anyone else acts.');
      }
      for (const saved of snap.players) {
        const p = party.players.find((x) => x.id === saved.id);
        if (p) Object.assign(p, saved);
      }
      party.toActId = snap.toActId;
      party.lastRaiseSize = snap.lastRaiseSize;
      party.actedThisRound = snap.actedThisRound;
      party.undoSnapshot = null;
      if (rec.history[rec.history.length - 1]?.id === actor.id) rec.history.pop();
      setDeadline(party, now);
      say(party, 'info', `${actor.name} took back their move`, now);
      return;
    }
  }

  requireActing(party, actor);
  if (party.awaitingDeal) throw new GameError(`Wait for the ${party.awaitingDeal} to be dealt.`);
  if (party.toActId !== actor.id) throw new GameError(`It's ${nameOf(party, party.toActId)}'s turn.`);
  const legal = legalActions(party, actor.id);
  const before = snapshot(party, actor.id);

  switch (action.type) {
    case 'fold':
      actor.folded = true;
      actor.lastAction = 'Fold';
      say(party, 'fold', `${actor.name} folds`, now);
      break;

    case 'check':
      if (!legal.check) throw new GameError(`You can't check. It's ${fmt(legal.call ?? 0)} to call.`);
      check(party, actor);
      say(party, 'info', `${actor.name} checks`, now);
      break;

    case 'call':
      if (legal.call === null) throw new GameError('There is nothing to call. You can check.');
      betTo(party, actor, actor.roundBet + legal.call, now);
      break;

    case 'bet': {
      if (!legal.bet) {
        throw new GameError(roundHigh(party) > 0 ? 'There is already a bet. Call or raise.' : "You can't bet right now.");
      }
      const amount = int(action.amount, 'Your bet', 1, MAX_CHIPS);
      if (amount < legal.bet.min || amount > legal.bet.max) throw new GameError(range('bet', legal.bet));
      betTo(party, actor, amount, now);
      break;
    }

    case 'raise': {
      if (!legal.raise) {
        throw new GameError(roundHigh(party) === 0 ? 'There is nothing to raise. You can bet.' : "You can't raise right now.");
      }
      const to = int(action.to, 'Your raise', 1, MAX_CHIPS);
      if (to < legal.raise.min || to > legal.raise.max) throw new GameError(range('raise', legal.raise));
      betTo(party, actor, to, now);
      break;
    }

    case 'allin':
      if (legal.allin === null) throw new GameError("You can't go all in here. Check the betting limit.");
      betTo(party, actor, legal.allin, now);
      break;

    default:
      throw new GameError('Unknown action.');
  }

  recordMove(rec, actor, action.type as Move['type']);
  party.undoSnapshot = before;
  proceed(rec, actor.id, now);
}

/**
 * Apply one action from a seated player. Mutates `rec`; throws GameError if it isn't allowed.
 * `deck` is a freshly shuffled deck, used only when a cards-mode hand starts, so
 * this stays pure and tests can pass a fixed one.
 */
export function applyAction(rec: PartyRecord, actorId: string, action: Action, now: number, deck?: Card[]): void {
  const { party } = rec;
  const actor = party.players.find((p) => p.id === actorId);
  if (!actor) throw new GameError("You're not seated at this table any more.");
  const isHost = party.hostId === actorId;
  const hostOnly = () => {
    if (!isHost) throw new GameError('Only the host can do that.');
  };
  const betweenHands = (what: string) => {
    if (party.phase !== 'idle') throw new GameError(`You can ${what} between hands.`);
  };

  const TURN_ACTIONS = ['bet', 'call', 'fold', 'undo', 'check', 'raise', 'allin', 'dealt', 'timeout'];
  if (usesTurns(party) && TURN_ACTIONS.includes(action?.type)) {
    turnAction(rec, actor, action, isHost, now);
    return;
  }

  switch (action?.type) {
    case 'start_hand':
      hostOnly();
      startHand(rec, now, deck);
      break;

    case 'add_bot':
      hostOnly();
      addBot(rec, action.level, now);
      break;

    case 'bot_step': {
      // Any human's browser may ask; only a computer player whose thinking time is up moves, once.
      const bot = party.players.find((p) => p.id === party.toActId);
      if (actor.bot || party.phase !== 'live' || !bot?.bot || party.botActAt === null || now < party.botActAt) {
        throw new GameError('No computer player is ready to act.');
      }
      const rng = seededRandom(hashText(`${party.code}:${party.handNo}:${party.feedSeq}:${bot.id}`));
      turnAction(rec, bot, decide(botView(rec, bot.id), legalActions(party, bot.id), rng), false, now);
      break;
    }

    case 'auto_deal':
      hostOnly();
      party.settings.autoDeal = action.on === true;
      if (party.phase === 'idle') party.nextHandAt = wantsAutoDeal(party) ? now + AUTO_DEAL_MS : null;
      say(party, 'info', party.settings.autoDeal ? 'Hands will deal by themselves' : 'The host paused auto-deal', now);
      break;

    case 'show': {
      const cards = rec.hole[actor.id];
      if (party.canShow !== actor.id || !cards?.length) throw new GameError('There are no cards to show.');
      party.shown[actor.id] = cards;
      party.canShow = null;
      say(party, 'info', `${actor.name} shows ${cards.map(cardText).join(' ')}`, now);
      break;
    }

    case 'bet': {
      requireActing(party, actor);
      if (actor.folded) throw new GameError('You folded this hand.');
      const amount = int(action.amount, 'Your bet', 1, MAX_CHIPS);
      if (amount > actor.stack) throw new GameError(`You only have ${fmt(actor.stack)} chips.`);
      putIn(party, actor, amount, now);
      break;
    }

    case 'call': {
      requireActing(party, actor);
      if (actor.folded) throw new GameError('You folded this hand.');
      const toCall = Math.max(0, highBet(party) - actor.bet);
      const amount = Math.min(toCall, actor.stack);
      if (amount === 0) {
        actor.lastAction = 'Check';
        say(party, 'info', `${actor.name} checks`, now);
      } else putIn(party, actor, amount, now);
      break;
    }

    case 'fold':
      requireActing(party, actor);
      if (actor.folded) throw new GameError('You already folded.');
      actor.folded = true;
      actor.lastAction = 'Fold';
      actor.undo.push({ t: 'fold' });
      say(party, 'fold', `${actor.name} folds`, now);
      break;

    case 'undo': {
      requireActing(party, actor);
      const last = actor.undo.pop();
      if (!last) throw new GameError('Nothing to take back.');
      actor.lastAction = null;
      if (last.t === 'fold') {
        actor.folded = false;
        say(party, 'info', `${actor.name} took back their fold`, now);
      } else {
        actor.stack += last.amount;
        actor.bet -= last.amount;
        say(party, 'info', `${actor.name} took back ${fmt(last.amount)}`, now);
      }
      break;
    }

    case 'award':
      hostOnly();
      if (party.settings.mode === 'cards') throw new GameError('In card mode the app works out who won.');
      award(party, action.winners, now);
      break;

    case 'void_hand':
      hostOnly();
      voidHand(rec, now);
      break;

    case 'chips': {
      hostOnly();
      betweenHands('change stacks');
      const target = party.players.find((p) => p.id === action.playerId);
      if (!target) throw new GameError("That player isn't at the table.");
      const amount = int(action.amount, 'The amount', -MAX_CHIPS, MAX_CHIPS);
      if (amount === 0) throw new GameError('Enter how many chips to add or take away.');
      if (target.stack + amount < 0) throw new GameError(`${target.name} only has ${fmt(target.stack)} chips.`);
      if (target.stack + amount > MAX_CHIPS) throw new GameError('That is too many chips.');
      target.stack += amount;
      target.buyIn += amount;
      party.log.push({ kind: 'chips', ts: now, id: target.id, name: target.name, amount, after: target.stack });
      if (party.log.length > LOG_KEEP) party.log.splice(0, party.log.length - LOG_KEEP);
      say(
        party,
        'info',
        amount > 0 ? `${target.name} got ${fmt(amount)} more chips` : `${fmt(-amount)} chips taken from ${target.name}`,
        now,
      );
      break;
    }

    case 'kick': {
      hostOnly();
      betweenHands('remove players');
      if (action.playerId === party.hostId) throw new GameError("The host can't be removed.");
      const idx = party.players.findIndex((p) => p.id === action.playerId);
      if (idx < 0) throw new GameError("That player isn't at the table.");
      const [gone] = party.players.splice(idx, 1);
      delete rec.tokens[gone.id];
      say(party, 'info', `${gone.name} left the table with ${fmt(gone.stack)}`, now);
      break;
    }

    case 'settings': {
      hostOnly();
      betweenHands('change the table settings');
      const next = action.settings ?? {};
      if (next.mode !== undefined && next.mode !== party.settings.mode) {
        throw new GameError("Cardless or Cards is picked when the table is created and can't be changed.");
      }
      // Merge so a client that sends only some fields doesn't reset the rest.
      party.settings = cleanSettings({ ...party.settings, ...next }, party.players.length);
      say(party, 'info', 'The host changed the table settings', now);
      break;
    }

    case 'check':
    case 'raise':
    case 'allin':
    case 'dealt':
    case 'timeout':
      throw new GameError("This table doesn't take turns. Use Call, Bet or Fold.");

    default:
      throw new GameError('Unknown action.');
  }
}
