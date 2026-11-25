import type { Card } from './cards';

export type Phase = 'idle' | 'live' | 'showdown';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export type BotLevel = 'easy' | 'medium' | 'hard';

export type UndoItem = { t: 'bet'; amount: number } | { t: 'fold' };

export interface Player {
  id: string;
  name: string;
  /** Chips in front of the player (not counting what they've put in the pot). */
  stack: number;
  /** Total chips this player has been given (starting chips + rebuys). */
  buyIn: number;
  /** Chips this player has in the pot for the current hand (antes, blinds and every street). */
  bet: number;
  /** Chips put in on the current street. Turn-based tables only; antes don't count. */
  roundBet: number;
  /** Dealt into the current hand. */
  inHand: boolean;
  folded: boolean;
  /** The player's own moves this hand, newest last, so they can take one back. */
  undo: UndoItem[];
  /** Their last move on this street, for display ("Check", "Raise 60"). Not used by the rules. */
  lastAction: string | null;
  /** Set for computer-controlled players (card tables only). They have no seat key. */
  bot?: { level: BotLevel };
  /** Change in stack from the last finished hand they played. */
  lastDelta: number | null;
}

export interface HandRow {
  id: string;
  name: string;
  before: number;
  after: number;
}

export type LogEntry =
  | { kind: 'hand'; n: number; ts: number; pot: number; winners: string[]; rows: HandRow[] }
  | { kind: 'chips'; ts: number; id: string; name: string; amount: number; after: number };

export interface FeedItem {
  id: number;
  ts: number;
  kind: 'bet' | 'fold' | 'win' | 'info';
  text: string;
}

export type Mode = 'cardless' | 'cards';
export type Variant = 'holdem' | 'omaha';
export type Betting = 'no-limit' | 'pot-limit' | 'fixed-limit';
export type ActionTimer = 0 | 15 | 30 | 60;

export interface Settings {
  /** Cardless: real cards at the table, the app tracks chips. Cards: the app deals. Fixed at creation. */
  mode: Mode;
  /** Omaha = Pot-Limit Omaha style, 4 hole cards. */
  variant: Variant;
  betting: Betting;
  /** Cardless only (cards mode always takes turns). false = anyone can bet any time. */
  turnOrder: boolean;
  /** Seconds per action, 0 = off. */
  actionTimer: ActionTimer;
  ante: number;
  maxPlayers: number;
  /** Card tables with one human: start the next hand by itself a few seconds after the last. */
  autoDeal: boolean;
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
}

export interface Party {
  code: string;
  hostId: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  settings: Settings;
  players: Player[];
  phase: Phase;
  handNo: number;
  dealerId: string | null;
  prevDealerId: string | null;
  sbId: string | null;
  bbId: string | null;
  /** Stack of each dealt-in player when the current hand started. */
  handStart: Record<string, number>;
  /** Chips each player has been awarded so far in the current showdown. */
  won: Record<string, number>;
  /** Size of the whole pot when the host started awarding it. */
  potAtShowdown: number;
  log: LogEntry[];
  feed: FeedItem[];
  feedSeq: number;
  /* ----- turn-based tables only (settings.turnOrder, or cards mode) ----- */
  street: Street;
  /** Whose turn it is, or null when nobody can act. */
  toActId: string | null;
  /** Cardless: betting is paused until this street is dealt at the real table. */
  awaitingDeal: Exclude<Street, 'preflop'> | null;
  /** Size of the last full bet or raise this street (sets the minimum raise). */
  lastRaiseSize: number;
  /** Players who have acted since the last full raise. They can't raise again unless someone re-raises. */
  actedThisRound: string[];
  /** When the current player runs out of time (ms), or null with no timer. */
  turnDeadline: number | null;
  undoSnapshot: TurnSnapshot | null;
  /* ----- cards mode only. All public: hole cards and the deck live in PartyRecord. ----- */
  /** Community cards dealt so far. Kept after the hand ends until the next one starts. */
  board: Card[];
  /** Hole cards turned face up: everyone still in at showdown, or a winner who chose to show. */
  shown: Record<string, Card[]>;
  /** How the last showdown went: each shown hand, its name and what it won. */
  handResults: HandResult[];
  /** The player who won the last hand without a showdown and may still show their cards. */
  canShow: string | null;
  /** When the computer player whose turn it is may act (ms). Any human's browser then sends 'bot_step'. */
  botActAt: number | null;
  /** Auto-deal: when the host's browser should start the next hand (ms). */
  nextHandAt: number | null;
}

/** One betting move this hand, for the computer players' view of the action. */
export interface Move {
  id: string;
  type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
  /** The player's street total after the move. */
  to: number;
  street: Street;
}

/** How a player has bet over the whole session, for the hard computer players. */
export interface MoveStats {
  aggressive: number;
  passive: number;
  folds: number;
}

export interface HandResult {
  id: string;
  /** "Flush, Ace high". */
  hand: string;
  /** The five cards that make the hand, to highlight. */
  best: Card[];
  /** Chips won (0 for a losing hand). */
  amount: number;
}

/** The hand just before the last turn-based action, so its maker can take it back. */
export interface TurnSnapshot {
  by: string;
  players: Pick<Player, 'id' | 'stack' | 'bet' | 'roundBet' | 'folded' | 'lastAction'>[];
  toActId: string | null;
  lastRaiseSize: number;
  actedThisRound: string[];
}

/** What a player may do on their turn. Bet and raise ranges are the player's total roundBet after acting. */
export interface LegalActions {
  fold: boolean;
  check: boolean;
  /** Chips needed to call (capped at the stack), or null when there's nothing to call. */
  call: number | null;
  bet: { min: number; max: number } | null;
  raise: { min: number; max: number } | null;
  /** The roundBet an all-in would reach, or null when going all in isn't allowed. */
  allin: number | null;
}

/**
 * What the server stores: the public party plus everything secret. Only `party`
 * (through viewFor) is ever sent to a browser.
 */
export interface PartyRecord {
  party: Party;
  /** Each player's seat key. */
  tokens: Record<string, string>;
  /** Cards mode: the undealt cards, top first. */
  deck: Card[];
  /** Cards mode: each player's hole cards this hand. */
  hole: Record<string, Card[]>;
  /** Every betting move this hand. */
  history: Move[];
  /** Each player's betting habits across hands. */
  moveStats: Record<string, MoveStats>;
}

export type Action =
  | { type: 'start_hand' }
  | { type: 'bet'; amount: number }
  | { type: 'call' }
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'raise'; to: number }
  | { type: 'allin' }
  | { type: 'dealt' }
  | { type: 'timeout' }
  | { type: 'show' }
  | { type: 'add_bot'; level: BotLevel }
  | { type: 'bot_step' }
  | { type: 'auto_deal'; on: boolean }
  | { type: 'undo' }
  | { type: 'award'; winners: string[] }
  | { type: 'void_hand' }
  | { type: 'chips'; playerId: string; amount: number }
  | { type: 'kick'; playerId: string }
  | { type: 'settings'; settings: Partial<Settings> };
