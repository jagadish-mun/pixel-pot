# Pixel Pot

A pixel-art poker table for your phone. Play with real cards and let the app keep the chips, or let the app deal the cards too. Play with friends, or alone against AI players.

- The host creates a table and gets a four-letter code and a share link.
- Players join by typing the code or opening the link.
- Each hand, players bet, call and fold from their own phone.
- Every finished hand is saved to a log with each player's chip count and how much they won or lost.

## Run it on your computer

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. To try it with several players on one machine, open the table link in a private window or a second browser for each extra player. Phones on the same Wi-Fi can join at `http://<your-computer's-IP>:3000`.

Locally, tables are kept in memory and disappear when the dev server restarts. No database or accounts needed.

## Deploy to Vercel

1. Push this repository to GitHub and import it at [vercel.com/new](https://vercel.com/new). The defaults are right; there is nothing to configure in the build settings.
2. In the Vercel project, open **Storage**, create an **Upstash for Redis** database (the free plan is enough for home games) and connect it to the project.
3. Redeploy so the new environment variables take effect.

Step 2 matters. Vercel runs the app as serverless functions that don't share memory, so without a database each player would see a different table. The app shows a red warning banner on every table until a database is connected.

The integration adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`) to the project. The app reads either pair. To use the same database from your computer, put the values in `.env.local` (see `.env.example`).

## Creating a table

**Host a table** on the home page opens the setup screen. Pick a preset (Home game, Pot-Limit Omaha, Turbo) or set each option yourself. A summary line shows the table you're about to open.

| Setting | Choices |
| --- | --- |
| Mode | **Cardless**: you deal real cards and the app keeps the chips. **Cards**: the app deals and shows each player their own cards. The mode can't be changed once the table is open. |
| Game | Hold'em (2 hole cards) or Omaha (4 hole cards; your hand uses exactly 2 of them with exactly 3 from the board) |
| Betting | No-limit, pot-limit or fixed-limit |
| Blinds and ante | Any amounts. The ante can't be more than the big blind, and fixed-limit needs a big blind. Set the blinds to 0 to post them yourselves. |
| Starting chips | Chips each player gets on sitting down |
| Turns | Cardless only: **Take turns** (the default) or **Anytime**. Card tables always take turns. |
| Action timer | Off, 15, 30 or 60 seconds per turn |
| Max players | 2 to 10 |

Between hands, the host can change everything except the mode from **Menu**. Everyone else can see the settings there.

## Playing a hand

### Taking turns

On tables that take turns (every card table, and cardless tables set to **Take turns**), the app runs the betting:

- **Order.** Before the flop, the player left of the big blind acts first; heads-up, the button acts first. After the flop, the first player still in left of the button acts first. The big blind gets the option to raise when everyone just calls.
- **Your turn.** A banner, a vibration, a short sound (mute it with the speaker button) and the tab title tell you. Fold, Check or Call, or tap **Bet** / **Raise** to choose an amount with the presets (min, ½ pot, ¾ pot, pot, all in), the slider or the chip buttons.
- **Bet sizes.** No-limit: a raise must be at least the size of the last raise. An all-in for less doesn't reopen the betting for players who have already acted. Pot-limit: the most you can raise to is the pot after your call. Fixed-limit: bets go up in big-blind steps on the first two streets and double-big-blind steps on the turn and river, with at most 4 bets a street.
- **Pre-actions.** While waiting, tick **Check/Fold** or **Call any**. They act for you when your turn comes and reset each street.
- **Take back** undoes your last move until the next player acts.
- **Action timer.** When time runs out you check if you can, or fold.
- A hand ends when everyone else folds, or at showdown after the river. When everyone left is all in, the rest of the board is dealt out.

On cardless tables that take turns, the app pauses between streets so the host can deal: tap **Flop is out**, **Turn is out** and **River is out**. At showdown the host taps **Award pot** and picks the winner, or several players to split it. If a winner was all in for less than the others, they only take what they could match; the rest becomes a side pot and the host picks its winner next. Uncalled chips go back automatically.

### Anytime (cardless)

Players act in whatever order the real game dictates. The app doesn't enforce turns; it shows what each player has put in and how much it costs to call. **Take back last move** undoes your own most recent bet or fold. The host awards the pot as above. Tables saved by earlier versions of Pixel Pot open in this mode.

### Card tables

The app shuffles (with a cryptographic random generator), burns and deals like a real dealer. Your cards appear large at the bottom with your current best hand ("You have: Pair of Queens"). At showdown the app turns over the hands still in, finds the best five-card hand for each (Omaha: exactly 2 hole cards plus 3 board cards), pays the main pot and every side pot, splits ties, and highlights the winning cards. When everyone else folds, the winner can **Show** or **Muck**.

## Card privacy

Only your own browser ever receives your hole cards.

- The deck and everyone's hole cards are stored on the server, apart from the table everyone can read.
- Your seat key travels in an `x-seat` request header, never in a URL, and is checked on every request. The server sends your cards only with your own seat key. Anyone else, including someone who only has the table code, gets no hole cards.
- Other players' cards are only sent once they're shown at showdown (or when a winner taps **Show**).
- AI players decide using only what a player in their seat could see: their own cards, the board, bets and the moves so far.
- Cancelling a hand throws away its cards.

## AI players

Tap **Play vs AI** on the home page to play alone against 1–7 AI players at Easy, Medium, Hard or Mixed difficulty. On any card table, the host can also add AI players from **Menu** between hands (up to the table's maximum), and remove them from their **Edit** button.

- **Easy** plays loose and passive: calls a lot and rarely raises.
- **Medium** plays solid starting hands, and after the flop estimates its chance of winning by playing the rest of the hand out several hundred times, then compares that with the price of calling.
- **Hard** adds position, draws and semi-bluffs, bet sizing, and adjusts to how aggressive each opponent has been.

AI players take 1–2.5 seconds to "think" and aren't subject to the action timer. With one human at the table, the next hand starts on its own 3 seconds after the last; the host can pause that from **Menu**. Because the app is serverless and has no background jobs, the browsers at the table move the AI players along: an AI player only acts while someone has the table open.

## Between hands

The host can open **Menu** to add or take chips (rebuys are tracked, so the win/loss column stays right), remove a player, add AI players or change the settings. During a hand the host can cancel it, which returns every chip.

**Move my seat to another device** in the menu copies a private link that carries your seat, for when a phone dies mid-game.

## Limits

- 2 to 10 players per table, AI players included (the host can set a lower maximum).
- A table is deleted 3 days after its last action.
- The log keeps the most recent 300 entries.
- Phones check for updates every 1.5 seconds while the tab is visible, so other players' moves show up within a second or two. When nothing has changed the answer is tiny; otherwise the server sends the table plus only the log entries the phone doesn't have yet.
- Seats are tied to the browser that joined. There are no accounts or passwords; anyone with the table code can sit down, so share it only with your group.

## Project layout

```
app/
  page.tsx                  home: join, host, or play vs AI
  new/page.tsx              table setup
  p/[code]/page.tsx         the table
  dev/table/                layout preview of sample tables (development only; 404 in production)
  api/party/...             create, read, join, act
components/                 table view, action dock, cards, dialogs, pixel art
lib/
  game.ts                   all the rules: settings, turns, betting, showdown (pure functions)
  cards.ts                  cards and the deck
  hand.ts                   hand evaluator (Hold'em and Omaha)
  bot.ts                    AI players
  server.ts                 shuffling, seat checks, what each player may see
  store.ts                  storage: memory locally, Upstash Redis when configured
  client.ts                 polling hook and browser helpers
tests/
  game.test.ts              settings, turn rules, side pots, old saved tables, poll size
  cards.test.ts             hand evaluator, dealing, card privacy, showdowns
  bot.test.ts               thousands of AI-only hands, what AI players can see, auto-deal
  fixtures/old-tables.json  tables saved by the original version
```

```bash
npm test         # run the tests
npm run build    # production build
```

## Credits

Fonts: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) and [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans), both under the SIL Open Font License, bundled via Fontsource.
