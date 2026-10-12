// Gemini client. One place for keys, model fallback, JSON schemas and friendly errors.
const settings = require('./settings');

const BASE = () => (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-2.5-flash'];
let workingModel = null;

class AiError extends Error {
  constructor(message, status = 503, code = 'ai_error') { super(message); this.status = status; this.code = code; }
}

async function config() {
  const cfg = await settings.get('ai');
  const apiKey = cfg.apiKey || process.env.GEMINI_API_KEY || '';
  return { ...cfg, apiKey, model: cfg.model || 'gemini-3.8-flash', ready: !!(cfg.enabled && apiKey) };
}

// Small helpers to write Gemini (OpenAPI-subset) schemas compactly.
const S = {
  str: (description, extra = {}) => ({ type: 'STRING', description, ...extra }),
  int: (description) => ({ type: 'INTEGER', description }),
  num: (description) => ({ type: 'NUMBER', description }),
  bool: (description) => ({ type: 'BOOLEAN', description }),
  enum: (values, description) => ({ type: 'STRING', enum: values, description }),
  arr: (items, description) => ({ type: 'ARRAY', items, description }),
  obj: (properties, required = [], description) => ({ type: 'OBJECT', properties, ...(required.length ? { required } : {}), ...(description ? { description } : {}) }),
};

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  throw new AiError('The AI returned something unreadable. Try again.', 502, 'bad_json');
}

async function call(model, apiKey, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(`${BASE()}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    if (e.name === 'AbortError') throw new AiError('Gemini took too long to answer. Try again.', 504, 'timeout');
    throw new AiError(`Couldn't reach Gemini: ${e.message}`, 502, 'network');
  } finally { clearTimeout(timer); }
}

/**
 * generate({ system, prompt, history, schema, temperature })
 *  - history: [{ role: 'user'|'model', text }]
 *  - schema:  Gemini response schema → returns parsed JSON; otherwise returns text
 */
async function generate({ system, prompt, history = [], schema, temperature = 0.4, maxTokens = 4096 }) {
  const cfg = await config();
  if (!cfg.enabled) throw new AiError('AI is switched off for this workspace. An admin can turn it on in Settings → AI.', 503, 'disabled');
  if (!cfg.apiKey) throw new AiError('AI is not set up yet. Add a Gemini API key in Settings → AI.', 503, 'no_key');
  const contents = [
    ...history.filter((h) => h?.text).map((h) => ({ role: h.role === 'model' || h.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 8000) }] })),
    { role: 'user', parts: [{ text: prompt }] },
  ];
  const body = {
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens, ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}) },
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };
  const models = [...new Set([workingModel, cfg.model, ...FALLBACK_MODELS].filter(Boolean))];
  let last = null;
  for (const model of models) {
    const res = await call(model, cfg.apiKey, body);
    if (res.ok) {
      workingModel = model;
      const text = extractText(res.data);
      if (!text) {
        const reason = res.data?.promptFeedback?.blockReason || res.data?.candidates?.[0]?.finishReason;
        throw new AiError(reason === 'SAFETY' ? 'Gemini declined to answer this one.' : 'Gemini returned an empty answer. Try rephrasing.', 502, 'empty');
      }
      return schema ? parseJson(text) : text.trim();
    }
    last = res;
    const msg = res.data?.error?.message || '';
    if (res.status === 404 || /not found|not supported|is not available|no longer available/i.test(msg)) continue; // try the next model
    break;
  }
  const msg = last?.data?.error?.message || `Gemini returned ${last?.status}`;
  if (last?.status === 429) throw new AiError('Gemini rate limit reached. Wait a minute and try again, or upgrade the API plan.', 429, 'rate_limit');
  if (last?.status === 400 && /api key/i.test(msg)) throw new AiError('The Gemini API key was rejected. Check it in Settings → AI.', 400, 'bad_key');
  if (last?.status === 403) throw new AiError('This Gemini key is not allowed to use the model. Check the key or pick another model in Settings → AI.', 403, 'forbidden');
  throw new AiError(`Gemini error: ${msg.slice(0, 200)}`, 502, 'upstream');
}

async function status() {
  const cfg = await config();
  return { enabled: cfg.enabled, ready: cfg.ready, provider: 'gemini', model: workingModel || cfg.model };
}

module.exports = { generate, status, config, S, AiError };
