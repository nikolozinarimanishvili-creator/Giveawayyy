// No dependencies. Put ADMIN_PASSWORD and ADMIN_PHONE in .env, then run:  node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load settings from .env (KEY=value per line) without any dependency
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  });
} catch (e) {}

const PORT = process.env.PORT || 3000;
const PHONE = process.env.ADMIN_PHONE || '';
const PASS = process.env.ADMIN_PASSWORD;
if (!PASS) {
  console.error('Set ADMIN_PASSWORD in the .env file (or as an environment variable) first.');
  process.exit(1);
}

const DATA = path.join(__dirname, 'visits.json');
const MAX_VISITS = 10000;
let visits = [];
try { visits = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) {}
const save = () => fs.writeFile(DATA, JSON.stringify(visits), () => {});

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();

function isAdmin(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const decoded = Buffer.from(h.slice(6), 'base64').toString();
  const pass = decoded.split(':').slice(1).join(':');
  return crypto.timingSafeEqual(hash(pass), hash(PASS));
}

function askAuth(res) {
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin"' });
  res.end('Authentication required');
}

function sendFile(res, file, type) {
  fs.readFile(path.join(__dirname, 'public', file), (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
    res.end(buf);
  });
}

function readBody(req, cb) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 4096) req.destroy();
  });
  req.on('end', () => {
    try { cb(JSON.parse(body)); } catch (e) { cb(null); }
  });
}

const num = (v, min, max) => (typeof v === 'number' && v >= min && v <= max ? v : null);

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/') return sendFile(res, 'index.html', 'text/html');

  if (req.method === 'GET' && url === '/admin') {
    if (!isAdmin(req)) return askAuth(res);
    return sendFile(res, 'admin.html', 'text/html');
  }

  if (req.method === 'POST' && url === '/api/visit') {
    return readBody(req, (b) => {
      if (!b || typeof b.id !== 'string' || !/^[\w-]{8,64}$/.test(b.id)) {
        res.writeHead(400); return res.end('Bad request');
      }
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
      const email = typeof b.email === 'string' ? b.email.trim().slice(0, 100) : '';
      const existing = visits.find((v) => v.id === b.id);
      if (existing) {
        if (name) existing.name = name; // later calls only update the name
        if (email) existing.email = email;
      } else {
        const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        visits.push({
          id: b.id,
          time: new Date().toISOString(),
          status: ['granted', 'denied', 'unavailable'].includes(b.status) ? b.status : 'unavailable',
          lat: num(b.lat, -90, 90),
          lon: num(b.lon, -180, 180),
          accuracy: num(b.accuracy, 0, 1e7),
          name,
          email,
          ip: fwd || req.socket.remoteAddress || '',
          device: String(req.headers['user-agent'] || '').slice(0, 200)
        });
        if (visits.length > MAX_VISITS) visits.shift();
      }
      save();
      res.writeHead(204); res.end();
    });
  }

  if (req.method === 'GET' && url === '/api/admin-info') {
    if (!isAdmin(req)) return askAuth(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ phone: PHONE }));
  }

  if (url === '/api/visits') {
    if (!isAdmin(req)) return askAuth(res);
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(visits.slice().reverse()));
    }
    if (req.method === 'DELETE') {
      visits = [];
      save();
      res.writeHead(204); return res.end();
    }
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('Site:   http://localhost:' + PORT + '/');
  console.log('Admin:  http://localhost:' + PORT + '/admin  (any username, your ADMIN_PASSWORD)');
});
