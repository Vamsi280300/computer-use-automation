// Mock "bank servicing" web app.
// Server-rendered HTML only. No JSON API - drive it with a browser.

import express from 'express';
import crypto from 'node:crypto';
import {
  sessions,
  subAccounts,
  findMember,
  searchMembers,
  createSubAccount
} from './data.js';
import {
  loginPage,
  searchPage,
  resultsPage,
  memberPage,
  confirmPage,
  notFoundPage,
  errorPage
} from './views.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Redirects to /login when there is no valid session cookie.
function requireSession(req, res, next) {
  const sid = parseCookies(req).sid;
  if (sid && sessions.has(sid)) {
    req.operator = sessions.get(sid);
    return next();
  }
  return res.redirect(302, '/login');
}

const html = (res, code, body) =>
  res.status(code).set('Content-Type', 'text/html; charset=utf-8').send(body);

app.get('/', (_req, res) => res.redirect(302, '/login'));

app.get('/login', (_req, res) => html(res, 200, loginPage(null)));

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return html(res, 200, loginPage('Operator ID and password are required.'));
  }
  const sid = crypto.randomBytes(16).toString('hex');
  sessions.set(sid, { username: String(username), at: Date.now() });
  res.set('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  return res.redirect(302, '/search');
});

app.get('/search', requireSession, (_req, res) => html(res, 200, searchPage()));

app.get('/search/results', requireSession, async (req, res) => {
  // ?simulateSlow=1 delays the response by 3s to exercise wait/timeout handling.
  if (req.query.simulateSlow === '1') {
    await new Promise((r) => setTimeout(r, 3000));
  }
  const q = String(req.query.q || '');
  return html(res, 200, resultsPage(q, searchMembers(q)));
});

app.get('/member/:id', requireSession, (req, res) => {
  const m = findMember(req.params.id);
  if (!m) return html(res, 404, notFoundPage());
  return html(res, 200, memberPage(m, null));
});

app.post('/member/:id/subaccount', requireSession, (req, res) => {
  // ?simulateError=1 forces a hard 500 to exercise failure handling.
  if (req.query.simulateError === '1') return html(res, 500, errorPage());

  const m = findMember(req.params.id);
  if (!m) return html(res, 404, notFoundPage());

  // Frozen members cannot be serviced, even by direct POST.
  if (m.status === 'frozen') return html(res, 403, memberPage(m, null));

  const type = req.body.type === 'savings' ? 'savings' : 'checking';
  const deposit = Number.parseFloat(req.body.deposit);
  if (!Number.isFinite(deposit) || deposit < 0) {
    return html(res, 400, memberPage(m, 'Initial deposit must be a non-negative amount.'));
  }

  const rec = createSubAccount(m.id, type, deposit);
  // Post/Redirect/Get: the confirmation lives at its own URL.
  return res.redirect(302, `/member/${m.id}/subaccount/confirm?ref=${rec.number}`);
});

app.get('/member/:id/subaccount/confirm', requireSession, (req, res) => {
  const m = findMember(req.params.id);
  if (!m) return html(res, 404, notFoundPage());
  const rec = req.query.ref ? subAccounts.get(String(req.query.ref)) : null;
  if (!rec || rec.memberId !== m.id) return html(res, 404, notFoundPage());
  return html(res, 200, confirmPage(m, rec));
});

app.use((_req, res) => html(res, 404, notFoundPage()));

app.use((err, _req, res, _next) => {
  console.error('[mock-app]', err);
  html(res, 500, errorPage());
});

app.listen(PORT, () => {
  console.log(`[mock-app] Meridian servicing terminal on http://localhost:${PORT}`);
  console.log('[mock-app] sign on with any non-empty operator id / password');
});
