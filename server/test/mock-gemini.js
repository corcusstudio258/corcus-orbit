// Fake Gemini endpoint for tests: answers generateContent with JSON shaped by the request's responseSchema.
const http = require('http');
const PORT = Number(process.env.MOCK_PORT || 5099);
let calls = 0;

function fake(schema, key = '') {
  if (!schema) return 'Orbit AI is connected.';
  const t = String(schema.type).toUpperCase();
  if (schema.enum) return key === 'status' ? 'in_progress' : schema.enum.includes('high') ? 'high' : schema.enum[0];
  if (t === 'OBJECT') return Object.fromEntries(Object.entries(schema.properties || {}).map(([k, v]) => [k, fake(v, k)]));
  if (t === 'ARRAY') return [fake(schema.items, key), fake(schema.items, key)];
  if (t === 'INTEGER') return key === 'assigneeIds' ? 5 : key === 'offsetDays' ? 3 : key === 'userId' ? 5 : key === 'projectId' ? 0 : 2;
  if (t === 'NUMBER') return 2.5;
  if (t === 'BOOLEAN') return true;
  const strings = { projectCode: 'KAS', due: '2026-10-20', startDate: '', taskKey: 'KAS-2', title: 'Design Chhath reel cover', reply: 'You have **2** overdue tasks: **KAS-10** and **ADV-4**.', section: 'Planning', milestone: '', phone: '', tag: '', sectionName: '', text: '*Standup*\n• Done KAS-2' };
  return strings[key] ?? `sample ${key}`;
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls += 1;
    const m = req.url.match(/models\/([^:]+):generateContent/);
    if (!m) { res.writeHead(404); return res.end('{}'); }
    if (req.headers['x-goog-api-key'] !== 'test-key') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'API key not valid' } })); }
    if (m[1].includes('missing')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'model not found' } })); }
    if (m[1].includes('busy')) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', status: 'UNAVAILABLE' } })); }
    const parsed = JSON.parse(body || '{}');
    const schema = parsed.generationConfig?.responseSchema;
    const out = schema ? JSON.stringify(fake(schema)) : '# Weekly summary\n\nAll good.';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: out }] }, finishReason: 'STOP' }] }));
  });
}).listen(PORT, () => console.log(`mock gemini on ${PORT}`));
