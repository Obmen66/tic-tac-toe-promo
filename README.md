# Tic-Tac-Toe Promo

Tic-tac-toe with promo rewards on win and Telegram bot notifications.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env`:

```bash
cp .env.example .env
```

Set `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`.

3. Start the server:

```bash
npm start
```

Open `http://localhost:3000`.

## Game Settings

- Difficulty: Easy (random mistakes), Normal (depth-limited minimax), Hard (full minimax).
- Starting player: you can choose who makes the first move.

## API

`POST /api/result`

Body:

```json
{
  "result": "win",
  "eventId": "optional-id"
}
```

- `win`: generates a 5-digit promo code and sends `Победа! Промокод выдан:[код]` to Telegram.
- `loss`: sends `проигрыш` to Telegram.
- `draw`: accepted but does not send a Telegram message.

Responses:

```json
{
  "status": "ok",
  "code": "12345"
}
```

or

```json
{
  "status": "ok"
}
```

## Anti-Abuse Notes

- Rate limiting is enabled for `/api/*`.
- One promo code per session per day: the same code is returned within 24 hours.
- `eventId` enables idempotency for repeated requests.
- Promo codes and sessions are stored in memory (reset on restart). Use Redis/DB for production.

## Healthcheck

`GET /healthz` returns `{ "status": "ok" }`.

## Tooling

```bash
npm run lint
npm run format
npm test
```

## Docker

```bash
docker build -t tic-tac-toe-promo .
docker run --env-file .env -p 3000:3000 tic-tac-toe-promo
```
