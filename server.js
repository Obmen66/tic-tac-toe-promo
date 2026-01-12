const path = require('path');
const crypto = require('crypto');
const express = require('express');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { z } = require('zod');
const { validate } = require('@tma.js/init-data-node');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const PROMO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const EVENT_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOW_FALLBACK_CHAT_ID = process.env.ALLOW_FALLBACK_CHAT_ID === 'true';

const RESULT_SCHEMA = z.object({
  result: z.enum(['win', 'loss', 'draw']),
  eventId: z.string().min(6).max(64).optional(),
});

const issuedBySession = new Map();
const issuedCodes = new Map();
const processedEvents = new Map();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://telegram.org'],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'https://t.me', 'https://telegram.org'],
        frameAncestors: ["'self'", 'https://t.me', 'https://web.telegram.org', 'https://telegram.org'],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
  })
);
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

function getBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
}

function parseTelegramUser(initData) {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const userJson = params.get('user');
  if (!userJson) return null;

  try {
    return JSON.parse(userJson);
  } catch (error) {
    return null;
  }
}

function getTelegramUserFromRequest(req, { allowUnverified = false } = {}) {
  const initData = req.get('X-TG-INIT-DATA') || '';
  if (!initData) return null;

  const token = getBotToken();
  if (!token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_TOKEN');
  }

  try {
    validate(initData, token, { expiresIn: 24 * 60 * 60 });
  } catch (error) {
    if (!allowUnverified) {
      throw error;
    }
    return parseTelegramUser(initData);
  }

  return parseTelegramUser(initData);
}

async function sendTelegramMessage(text, chatId) {
  const token = getBotToken();

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
        chat_id: String(chatId),
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

function queueTelegramMessage(text, chatId) {
  if (!text) return;
  if (!chatId) {
    console.warn('Telegram chatId missing; message skipped.');
    return;
  }

  void sendTelegramMessage(text, chatId).catch((error) => {
    console.error('Failed to send Telegram message:', error);
  });
}

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/result', (req, res) => {
  console.log('Result request received', {
    hasInitData: Boolean(req.get('X-TG-INIT-DATA')),
    hasUserId: Boolean(req.get('X-TG-USER-ID')),
    ip: req.ip,
  });

  const parsed = RESULT_SCHEMA.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: 'error', message: 'Invalid payload' });
  }

  const { result, eventId } = parsed.data;
  pruneExpired();

  let tgUser = null;
  const allowFallback = ALLOW_FALLBACK_CHAT_ID || process.env.NODE_ENV !== 'production';
  let validationFailed = false;
  try {
    tgUser = getTelegramUserFromRequest(req, { allowUnverified: allowFallback });
  } catch (error) {
    validationFailed = true;
    console.warn('Invalid Telegram init data:', error.message || error);
    if (!allowFallback) {
      return res.status(401).json({ status: 'error', message: 'Invalid Telegram init data' });
    }
    tgUser = null;
  }

  const fallbackUserIdRaw = allowFallback ? req.get('X-TG-USER-ID') || '' : '';
  const fallbackUserId = /^\d+$/.test(fallbackUserIdRaw.trim()) ? fallbackUserIdRaw.trim() : null;

  const resolvedUserId = tgUser?.id || fallbackUserId;
  if (!resolvedUserId && !allowFallback) {
    return res.status(401).json({ status: 'error', message: 'Telegram init data required' });
  }

  if (!resolvedUserId) {
    console.warn('No Telegram user resolved from init data or fallback header.');
  }

  const sessionId = resolvedUserId ? `tg:${resolvedUserId}` : getSessionId(req, res);
  const chatId = resolvedUserId || (allowFallback ? process.env.TELEGRAM_CHAT_ID : null);

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
      telegramMessage = 'проигрыш. Сыграть ещё раз?';
    }

    if (eventId) {
      processedEvents.set(eventId, { createdAt: Date.now(), response: responsePayload });
    }

    res.json(responsePayload);
    queueTelegramMessage(telegramMessage, chatId);
  } catch (error) {
    console.error('Failed to process result:', error);
    return res.status(500).json({ status: 'error', message: 'Internal error' });
  }
});

app.post('/api/client-log', (req, res) => {
  const payload = req.body || {};
  console.log('Client log', {
    stage: payload.stage,
    hasTelegram: Boolean(payload.hasTelegram),
    hasInitData: Boolean(payload.hasInitData),
    hasUnsafeUser: Boolean(payload.hasUnsafeUser),
    userId: payload.userId || null,
    ua: req.get('user-agent') || '',
  });
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
