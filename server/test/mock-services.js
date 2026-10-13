// Fake Firebase Auth REST + Zoom API + Web Push endpoint for tests. Port 5098.
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');
const os = require('os');
const fsx = require('fs');
const pathx = require('path');
const log = [];
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const handler = (req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.startsWith('/push/')) { log.push({ method: req.method, path: req.url, encoding: req.headers['content-encoding'] }); return send(res, req.url.includes('gone') ? 410 : 201); }
    const body = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
    const url = new URL(req.url, 'http://x');
    log.push({ method: req.method, path: url.pathname, body });
    if (url.pathname === '/_log') return send(res, 200, log);
    if (url.pathname === '/v1/accounts:sendOobCode') {
      if (url.searchParams.get('key') !== 'fb-key') return send(res, 400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
      return send(res, 200, { email: body.email });
    }
    if (url.pathname === '/v1/accounts:signInWithEmailLink') {
      if (body.oobCode !== `code-${body.email}`) return send(res, 400, { error: { message: 'INVALID_OOB_CODE' } });
      return send(res, 200, { email: body.email, idToken: 'id' });
    }
    if (url.pathname === '/oauth/token') return send(res, 200, { access_token: 'zoom-token', expires_in: 3600 });
    if (req.headers.authorization !== 'Bearer zoom-token' && url.pathname.startsWith('/v2')) return send(res, 401, { message: 'Invalid access token' });
    if (url.pathname === '/v2/users/me') return send(res, 200, { email: 'zoom@corcus.in' });
    if (url.pathname === '/v2/users/me/meetings' && req.method === 'POST') return send(res, 201, { id: 98765, join_url: 'https://zoom.us/j/98765', password: 'z1p2' });
    if (url.pathname.startsWith('/v2/meetings/')) return send(res, 204);
    send(res, 404, { message: 'not found' });
  });
};
http.createServer(handler).listen(5098, () => console.log('mock services on 5098'));
// Web Push always uses HTTPS, so push endpoints get a self-signed HTTPS listener on 5097.
// Start the API with NODE_TLS_REJECT_UNAUTHORIZED=0 in tests.
const dir = fsx.mkdtempSync(pathx.join(os.tmpdir(), 'mockpush-'));
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 2 -subj /CN=localhost 2>/dev/null`);
https.createServer({ key: fsx.readFileSync(`${dir}/k.pem`), cert: fsx.readFileSync(`${dir}/c.pem`) }, handler).listen(5097, () => console.log('mock push (https) on 5097'));
