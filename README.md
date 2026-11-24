# Pixel Pot

A pixel-art chip counter for poker night. You deal real cards at the table; everyone's chips live on their phones.

- The host creates a table and gets a four-letter code and a share link.
- Players join by typing the code or opening the link.
- Each hand, players bet, call and fold from their own phone. The host starts the hand and awards the pot.
- Every finished hand is saved to a log with each player's chip count and how much they won or lost.

There are no cards in the app. It only tracks chips.

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

## How a hand works

1. The host taps **Start hand**. The dealer button moves one seat and blinds are posted automatically (set both blinds to 0 to post them yourselves).
2. Players act in whatever order the real game dictates. The app doesn't enforce turns or betting rounds; it shows what each player has put in and how much it costs to call.
   - **Fold**, **Check / Call**, or build a bet with the chip buttons (or type an amount) and tap **Bet**.
   - **Take back last move** undoes your own most recent bet or fold.
3. At showdown the host taps **Award pot** and picks the winner, or several players to split it.
   - If a winner was all in for less than the others, they only take what they could match. The rest becomes a side pot and the host picks its winner next. Uncalled chips go back automatically.
4. The hand is written to the log and the host starts the next one.

Between hands the host can open **Menu** to add or take chips (rebuys are tracked, so the win/loss column stays right), remove a player, or change the blinds. During a hand the host can cancel it, which returns every chip.

**Move my seat to another device** in the menu copies a private link that carries your seat, for when a phone dies mid-game.

## Limits

- Up to 10 players per table.
- A table is deleted 3 days after its last action.
- The log keeps the most recent 300 entries.
- Phones check for updates every 1.5 seconds while the tab is visible, so other players' moves show up within a second or two. Each check is one small Redis read.
- Seats are tied to the browser that joined. There are no accounts or passwords; anyone with the table code can sit down, so share it only with your group.

## Project layout

```
app/
  page.tsx                  home: host or join a table
  p/[code]/page.tsx         the table
  api/party/...             create, read, join, act
components/                 table UI, dialogs, pixel-art chips
lib/
  game.ts                   all the chip rules (pure functions)
  store.ts                  storage: memory locally, Upstash Redis when configured
  client.ts                 polling hook and browser helpers
tests/game.test.ts          rule tests, including side pots and a chip-conservation fuzz
```

```bash
npm test         # run the rule tests
npm run build    # production build
```

## Credits

Fonts: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) and [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans), both under the SIL Open Font License, bundled via Fontsource.
