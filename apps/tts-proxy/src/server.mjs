// Minimal proxy for Microsoft's unofficial Edge "Read Aloud" TTS service.
// Plain Node (not Cloudflare Workers) — Workers' egress IP ranges are
// blocked/rate-limited by Microsoft's endpoint (confirmed empirically: the
// exact same handshake succeeds instantly from a plain non-Workers IP and
// fails consistently from every Workers deployment tried). Deployed on
// Render instead, matching how read-aloud.com's own backend actually works
// (self-hosted, not Workers compute) — see ARCHITECTURE.md.
//
// Why this exists at all: Microsoft's WebSocket synthesis endpoint checks
// the connection's Origin header against the real Edge browser extension's
// own origin. A browser's WebSocket implementation always sends the page's
// true Origin and gives page JS no way to override it — in any browser —
// so no amount of client-side code can reach this endpoint directly. A
// server can set Origin freely on an outbound connection, which is the
// entire reason this proxy exists.
//
// Scope is deliberately narrow: no auth, no accounts, no persistence — just
// { text, voice, rate } in, { audio, words, durationMs } out.

import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const VERSION_MS_GEC = '1-143.0.3650';
// The real ID of Microsoft Edge's own built-in "Read Aloud" extension — the
// only Origin Microsoft's endpoint appears to accept.
const EDGE_EXTENSION_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.3650.75 Safari/537.36 Edg/143.0.3650.75';

// Only voices Lingxi actually offers. Keeping this an allowlist (rather than
// passing through whatever the client sends) stops this open, unauthenticated
// endpoint from being usable as a general-purpose free TTS relay for every
// one of Edge's ~300 voices.
const ALLOWED_VOICES = new Set(['en-US-AriaNeural']);

const MAX_TEXT_LENGTH = 2000; // generously covers one sentence/paragraph chunk
const SYNTH_TIMEOUT_MS = 20000; // time to talk to Microsoft once this process is actually running — unrelated to Render's own cold-start wake time, which happens before a request ever reaches this code
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function generateSecMsGec(trustedClientToken) {
  const ticks = Math.floor(Date.now() / 1000) + 11644473600;
  const rounded = ticks - (ticks % 300);
  const windowsTicks = rounded * 10_000_000;
  return createHash('sha256')
    .update(`${windowsTicks}${trustedClientToken}`)
    .digest('hex')
    .toUpperCase();
}

function escapeXML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Lingxi's `rate` is a plain multiplier (0.5-3, 1 = normal — see
// playbackController.ts's MIN_RATE/MAX_RATE), but SSML's prosody rate wants
// a percentage relative to normal: 1.5x -> "+50%", 0.75x -> "-25%".
function rateToSSMLPercent(rate) {
  const percent = Math.round((rate - 1) * 100);
  return percent >= 0 ? `+${percent}%` : `${percent}%`;
}

function buildSSML(text, voice, rate) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${voice}"><prosody rate="${rateToSSMLPercent(rate)}" pitch="+0Hz" volume="+0%">${escapeXML(text)}</prosody></voice></speak>`;
}

function buildConfigMessage() {
  return (
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: true },
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
          },
        },
      },
    })
  );
}

function buildSSMLMessage(requestId, ssml) {
  return `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
}

const AUDIO_DELIM = Buffer.from('Path:audio\r\n');

function extractAudioChunk(buffer) {
  const index = buffer.indexOf(AUDIO_DELIM);
  if (index === -1) return null;
  return buffer.subarray(index + AUDIO_DELIM.length);
}

// Approximate fallback only used when zero WordBoundary entries come back
// (e.g. text with no speakable words) — AUDIO_24KHZ_48KBITRATE_MONO_MP3 is a
// fixed-bitrate format, so duration is directly derivable from byte size.
const MP3_BYTES_PER_MS = 6; // 48,000 bits/s = 6,000 bytes/s = 6 bytes/ms

function parseMetadataMessage(message) {
  const startIndex = message.indexOf('{');
  if (startIndex === -1) return [];
  try {
    const parsed = JSON.parse(message.slice(startIndex));
    const anchors = [];
    for (const entry of parsed.Metadata ?? []) {
      if (entry.Type !== 'WordBoundary' || !entry.Data.text) continue;
      anchors.push({
        offsetMs: entry.Data.Offset / 10_000,
        durationMs: entry.Data.Duration / 10_000,
        text: entry.Data.text.Text,
      });
    }
    return anchors;
  } catch {
    return []; // malformed/unexpected metadata shape — skip rather than fail the whole request
  }
}

function synthesize(text, voice, rate) {
  return new Promise((resolve, reject) => {
    const secMsGec = generateSecMsGec(TRUSTED_CLIENT_TOKEN);
    const requestId = randomUUID().replace(/-/g, '');
    const url =
      `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${VERSION_MS_GEC}&ConnectionId=${requestId}`;

    // Node's `ws` lets the client set arbitrary headers directly, unlike a
    // browser's WebSocket — this is the whole reason this proxy can reach
    // Microsoft's endpoint at all.
    const ws = new WebSocket(url, {
      headers: {
        Origin: EDGE_EXTENSION_ORIGIN,
        'User-Agent': USER_AGENT,
        'Sec-WebSocket-Protocol': 'synthesize',
      },
    });

    const chunks = [];
    const words = [];

    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // already closed — nothing to do
      }
      reject(new Error('Edge TTS upstream timed out.'));
    }, SYNTH_TIMEOUT_MS);

    const finish = (fn) => {
      clearTimeout(timer);
      fn();
    };

    ws.on('open', () => {
      ws.send(buildConfigMessage());
      ws.send(buildSSMLMessage(requestId, buildSSML(text, voice, rate)));
    });

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const message = data.toString();
        if (message.includes('Path:audio.metadata')) {
          words.push(...parseMetadataMessage(message));
          return;
        }
        if (message.includes('Path:turn.end')) {
          finish(() => {
            try {
              ws.close();
            } catch {
              // already closed — nothing to do
            }
            if (chunks.length === 0) {
              reject(new Error('Edge TTS returned no audio.'));
            } else {
              const audio = Buffer.concat(chunks);
              const lastWord = words.at(-1);
              const durationMs = lastWord
                ? lastWord.offsetMs + lastWord.durationMs
                : audio.length / MP3_BYTES_PER_MS;
              resolve({ audio, words, durationMs });
            }
          });
        }
        return;
      }
      const chunk = extractAudioChunk(data);
      if (chunk) chunks.push(chunk);
    });

    ws.on('close', (code) => {
      // A clean finish already resolved/rejected above; a close before
      // turn.end means the upstream connection dropped mid-synthesis.
      finish(() => reject(new Error(`Edge TTS connection closed early (code ${code}).`)));
    });

    ws.on('error', (err) => {
      finish(() => reject(new Error(`Edge TTS upstream WebSocket error: ${err.message}`)));
    });
  });
}

// Best-effort only: a single Render instance has genuinely global in-memory
// state (unlike Workers' per-isolate chaos), so this is a real per-process
// throttle, not just a per-node one — still not a substitute for a real
// abuse-protection layer (e.g. a reverse-proxy rate limit) in front of a
// public endpoint, just a cheap backstop against one misbehaving client.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const requestLog = new Map();

function isRateLimited(key) {
  const now = Date.now();
  const recent = (requestLog.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  requestLog.set(key, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders() });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (url.pathname !== '/api/tts' || req.method !== 'POST') {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    sendJson(res, 429, { error: 'Too many requests.' });
    return;
  }

  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    sendJson(res, 400, { error: 'Request body must be JSON.' });
    return;
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const voice = typeof body.voice === 'string' ? body.voice : 'en-US-AriaNeural';
  // Matches playbackController.ts's MIN_RATE/MAX_RATE clamp — mirrored here
  // rather than imported since this service has no dependency on the app's
  // workspace packages.
  const rawRate = typeof body.rate === 'number' && isFinite(body.rate) ? body.rate : 1;
  const rate = Math.min(3, Math.max(0.5, rawRate));

  if (!text) return sendJson(res, 400, { error: '"text" is required.' });
  if (text.length > MAX_TEXT_LENGTH) {
    return sendJson(res, 400, { error: `"text" exceeds the ${MAX_TEXT_LENGTH} character limit.` });
  }
  if (!ALLOWED_VOICES.has(voice)) {
    return sendJson(res, 400, { error: `Unsupported voice "${voice}".` });
  }

  try {
    const result = await synthesize(text, voice, rate);
    sendJson(res, 200, {
      audio: result.audio.toString('base64'),
      words: result.words,
      durationMs: result.durationMs,
    });
  } catch (error) {
    sendJson(res, 502, { error: error instanceof Error ? error.message : 'Synthesis failed.' });
  }
});

server.listen(PORT, () => {
  console.log(`lingxi-tts-proxy listening on :${PORT}`);
});
