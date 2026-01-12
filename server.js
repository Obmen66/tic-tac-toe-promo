const path = require('path');
const crypto = require('crypto');
const express = require('express');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { z } = require('zod');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const PROMO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const EVENT_TTL_MS = 24 * 60 * 60 * 1000;

const RESULT_SCHEMA = z.object({
  result: z.enum(['win', 'loss', 'draw']),
  eventId: z.string().min(6).max(64).optional(),
});

const issuedBySession = new Map();
const issuedCodes = new Map();
const processedEvents = new Map();

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);

function pruneExpired() {
  const now = Date.now();

  for (const [eventId, entry] of processedEvents.entries()) {
    if (now - entry.createdAt > EVENT_TTL_MS) {
      processedEvents.delete(eventId);
    }
  }

  for (const [code, entry] of issuedCodes.entries()) {
    if (now - entry.createdAt > PROMO_TTL_MS) {
      issuedCodes.delete(code);
    }
  }

  for (const [sessionId, entry] of issuedBySession.entries()) {
    if (now - entry.createdAt > PROMO_TTL_MS) {
      issuedBySession.delete(sessionId);
    }
  }
}

function getSessionId(req, res) {
  let sid = req.cookies.sid;

  if (!sid) {
    sid = crypto.randomUUID();
    res.cookie('sid', sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: PROMO_TTL_MS,
    });
  }

  return sid;
}

function getSessionPromo(sessionId) {
  const entry = issuedBySession.get(sessionId);
  if (!entry) return null;

  const age = Date.now() - entry.createdAt;
  if (age > PROMO_TTL_MS) {
    issuedBySession.delete(sessionId);
    return null;
  }

  if (age < SESSION_COOLDOWN_MS) {
    return entry.code;
  }

  return null;
}

function generateUniquePromoCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = String(crypto.randomInt(10000, 100000));
    if (!issuedCodes.has(code)) {
      return code;
    }
  }

  throw new Error('Failed to generate unique promo code');
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('Telegram config is missing; message skipped.');
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        chat_id: chatId,
        text,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${body}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function queueTelegramMessage(text) {
  if (!text) return;

  void sendTelegramMessage(text).catch((error) => {
    console.error('Failed to send Telegram message:', error);
  });
}

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/result', (req, res) => {
  const parsed = RESULT_SCHEMA.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: 'error', message: 'Invalid payload' });
  }

  const { result, eventId } = parsed.data;
  pruneExpired();

  const sessionId = getSessionId(req, res);

  if (eventId) {
    const cached = processedEvents.get(eventId);
    if (cached) {
      return res.json(cached.response);
    }
  }

  try {
    const responsePayload = { status: 'ok' };
    let telegramMessage = null;

    if (result === 'win') {
      const existingCode = getSessionPromo(sessionId);
      if (existingCode) {
        responsePayload.code = existingCode;
      } else {
        const code = generateUniquePromoCode();
        const createdAt = Date.now();
        issuedCodes.set(code, { createdAt, sessionId, redeemed: false });
        issuedBySession.set(sessionId, { code, createdAt });
        responsePayload.code = code;
        telegramMessage = `Победа! Промокод выдан:${code}`;
      }
    } else if (result === 'loss') {
      telegramMessage = 'проигрыш';
    }

    if (eventId) {
      processedEvents.set(eventId, { createdAt: Date.now(), response: responsePayload });
    }

    res.json(responsePayload);
    queueTelegramMessage(telegramMessage);
  } catch (error) {
    console.error('Failed to process result:', error);
    return res.status(500).json({ status: 'error', message: 'Internal error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
