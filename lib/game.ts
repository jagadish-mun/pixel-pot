import type { Action, FeedItem, Party, PartyRecord, Player, Settings } from './types';

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

export function cleanSettings(raw: Partial<Record<keyof Settings, unknown>> | undefined): Settings {
  const startingChips = int(raw?.startingChips ?? 1000, 'Starting chips', 1, 1_000_000);
  const smallBlind = int(raw?.smallBlind ?? 0, 'Small blind', 0, 1_000_000);
  const bigBlind = int(raw?.bigBlind ?? 0, 'Big blind', 0, 1_000_000);
  if (smallBlind > bigBlind) throw new GameError("The small blind can't be bigger than the big blind.");
  return { startingChips, smallBlind, bigBlind };
}

function newPlayer(id: string, name: string, chips: number): Player {
  return { id, name, stack: chips, buyIn: chips, bet: 0, inHand: false, folded: false, undo: [], lastDelta: null };
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
  };
  say(party, 'info', `${name} opened the table`, now);
  return { party, tokens: { [hostId]: hostToken } };
}

export function joinParty(rec: PartyRecord, id: string, token: string, rawName: unknown, now: number): void {
  const { party } = rec;
  const name = cleanName(rawName);
  if (party.players.length >= MAX_PLAYERS) throw new GameError(`This table is full (${MAX_PLAYERS} players).`);
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

function postBlind(party: Party, p: Player, blind: number) {
  const amount = Math.min(p.stack, blind);
  p.stack -= amount;
  p.bet += amount;
}

function startHand(party: Party, now: number) {
  if (party.phase !== 'idle') throw new GameError('Finish the current hand first.');
  const withChips = party.players.filter((p) => p.stack > 0);
  if (withChips.length < 2) throw new GameError('You need at least 2 players with chips to start a hand.');

  party.phase = 'live';
  party.handNo += 1;
  party.handStart = {};
  party.won = {};
  party.potAtShowdown = 0;
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

  const { smallBlind, bigBlind } = party.settings;
  if (bigBlind > 0) {
    // Heads-up, the dealer posts the small blind.
    const sb = withChips.length === 2 ? dealer : nextInHand(party, dealer.id);
    const bb = nextInHand(party, sb.id);
    if (smallBlind > 0) {
      postBlind(party, sb, smallBlind);
      party.sbId = sb.id;
    }
    postBlind(party, bb, bigBlind);
    party.bbId = bb.id;
  }
  say(party, 'info', `Hand ${party.handNo} started. ${dealer.name} has the button`, now);
}

function putIn(party: Party, p: Player, amount: number, now: number) {
  const before = highBet(party);
  p.stack -= amount;
  p.bet += amount;
  p.undo.push({ t: 'bet', amount });
  let text: string;
  if (p.stack === 0) text = `${p.name} is all in for ${fmt(p.bet)}`;
  else if (p.bet === before) text = `${p.name} calls ${fmt(amount)}`;
  else if (before === 0) text = `${p.name} bets ${fmt(amount)}`;
  else if (p.bet > before) text = `${p.name} raises to ${fmt(p.bet)}`;
  else text = `${p.name} puts in ${fmt(amount)}`;
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
}

function give(party: Party, p: Player, amount: number) {
  if (amount <= 0) return;
  p.stack += amount;
  party.won[p.id] = (party.won[p.id] ?? 0) + amount;
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
  let slice = 0;
  for (const p of party.players) {
    const part = Math.min(p.bet, level);
    p.bet -= part;
    slice += part;
  }
  const share = Math.floor(slice / winners.length);
  let odd = slice - share * winners.length;
  for (const w of winners) {
    const extra = odd > 0 ? 1 : 0;
    odd -= extra;
    give(party, w, share + extra);
  }
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

function voidHand(party: Party, now: number) {
  if (party.phase === 'idle') throw new GameError('There is no hand to cancel.');
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
}

/** Apply one action from a seated player. Mutates `rec`; throws GameError if it isn't allowed. */
export function applyAction(rec: PartyRecord, actorId: string, action: Action, now: number): void {
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

  switch (action?.type) {
    case 'start_hand':
      hostOnly();
      startHand(party, now);
      break;

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
      if (amount === 0) say(party, 'info', `${actor.name} checks`, now);
      else putIn(party, actor, amount, now);
      break;
    }

    case 'fold':
      requireActing(party, actor);
      if (actor.folded) throw new GameError('You already folded.');
      actor.folded = true;
      actor.undo.push({ t: 'fold' });
      say(party, 'fold', `${actor.name} folds`, now);
      break;

    case 'undo': {
      requireActing(party, actor);
      const last = actor.undo.pop();
      if (!last) throw new GameError('Nothing to take back.');
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
      award(party, action.winners, now);
      break;

    case 'void_hand':
      hostOnly();
      voidHand(party, now);
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

    case 'settings':
      hostOnly();
      betweenHands('change the blinds');
      party.settings = cleanSettings(action.settings);
      say(party, 'info', 'The host changed the table settings', now);
      break;

    default:
      throw new GameError('Unknown action.');
  }
}
