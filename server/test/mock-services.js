// Fake Firebase Auth REST + Zoom API for tests. Port 5098.
const http = require('http');
const log = [];
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
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
}).listen(5098, () => console.log('mock services on 5098'));
