// server/services/adminSession.js — the admin's login session (a JWT in a cookie)
//
// Responsibilities
//   The cookie's name and options, and signing, checking and clearing the token. Existing logins
//   must keep working across updates, so none of these may change: the name nb_admin_token, the
//   secret config.jwtSecret, and the payload { role: 'admin' } valid for 7 days.
//
// Provides
//   COOKIE_NAME                 'nb_admin_token'
//   issue(res)                  signs a new token and sets the cookie (httpOnly, sameSite strict,
//                               7 days, secure only with SECURE_COOKIES=true in .env)
//   verifyToken(token)          → the payload; throws if it's missing, expired or forged
//   tokenOf(req)                → the cookie's token, or undefined
//   isLoggedIn(req)             → boolean
//   clear(res)                  removes the cookie
//
// Used by
//   routes/api/auth.js (login, logout, status), middleware/access.js (requireAdmin)
//
// Uses
//   jsonwebtoken, configService (jwtSecret)
const jwt = require('jsonwebtoken');
const configService = require('./configService');

const COOKIE_NAME = 'nb_admin_token';
const LIFETIME = '7d';
// SECURE_COOKIES=true only if serving over HTTPS; installed Servers run HTTP, so leave false
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.SECURE_COOKIES === 'true',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function issue(res) {
  const token = jwt.sign({ role: 'admin' }, configService.get('jwtSecret'), { expiresIn: LIFETIME });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
}

function verifyToken(token) {
  return jwt.verify(token, configService.get('jwtSecret'));
}

function tokenOf(req) {
  return req.cookies[COOKIE_NAME];
}

function isLoggedIn(req) {
  const token = tokenOf(req);
  if (!token) return false;
  try {
    verifyToken(token);
    return true;
  } catch {
    return false;
  }
}

function clear(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict' });
}

module.exports = { COOKIE_NAME, issue, verifyToken, tokenOf, isLoggedIn, clear };
