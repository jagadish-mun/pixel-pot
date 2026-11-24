export type Phase = 'idle' | 'live' | 'showdown';

export type UndoItem = { t: 'bet'; amount: number } | { t: 'fold' };

export interface Player {
  id: string;
  name: string;
  /** Chips in front of the player (not counting what they've put in the pot). */
  stack: number;
  /** Total chips this player has been given (starting chips + rebuys). */
  buyIn: number;
  /** Chips this player has in the pot for the current hand. */
  bet: number;
  /** Dealt into the current hand. */
  inHand: boolean;
  folded: boolean;
  /** The player's own moves this hand, newest last, so they can take one back. */
  undo: UndoItem[];
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

export interface Settings {
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
}

/** What the server stores: the public party plus each player's secret seat key. */
export interface PartyRecord {
  party: Party;
  tokens: Record<string, string>;
}

export type Action =
  | { type: 'start_hand' }
  | { type: 'bet'; amount: number }
  | { type: 'call' }
  | { type: 'fold' }
  | { type: 'undo' }
  | { type: 'award'; winners: string[] }
  | { type: 'void_hand' }
  | { type: 'chips'; playerId: string; amount: number }
  | { type: 'kick'; playerId: string }
  | { type: 'settings'; settings: Settings };
