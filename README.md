# mystery story

A minimalist two-player collaborative story writing game.

Both players write simultaneously, building two separate stories in parallel. Each round, you only see the last sentence to continue from — the full stories are revealed at the end.

## how to play

1. Open the app in two browsers
2. One player creates a lobby, the other joins with the code
3. Pick how many rounds to play
4. Both players ready up
5. Write! Each round you either start a new story or continue the other player's last sentence
6. At the end, both stories are revealed sentence by sentence

## setup

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser.

## hosting

To play over the internet, use ngrok:

```bash
# One-time: claim a free static domain at https://dashboard.ngrok.com/domains
echo "your-domain.ngrok-free.dev" > .ngrok-domain

# Start everything with one command
./bin/start
```

## changelog

### v0.2.0 — 2025-04-23

- Both players now write simultaneously each round
- Two parallel stories are built instead of one shared story
- Players only see the last sentence of the story they're continuing
- Stories are revealed one sentence at a time at the end
- Added ngrok startup script for easy hosting

### v0.1.0 — 2025-04-22

- Initial release
- Turn-based single story mode
- Monkeytype-inspired dark minimal UI
- Real-time lobby with code sharing
