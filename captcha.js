const svgCaptcha = require('svg-captcha');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Stateless CAPTCHA: the answer never touches a session store. We hash the
// answer and sign it into a short-lived JWT the client hands back alongside
// its typed answer. This keeps the API horizontally scalable (no sticky
// sessions / Redis needed) while still preventing tampering.

function hashAnswer(text) {
  return crypto.createHash('sha256').update(text.toLowerCase().trim()).digest('hex');
}

function generateCaptcha() {
  const captcha = svgCaptcha.create({ size: 5, noise: 3, color: true, ignoreChars: '0oO1ilI' });
  const token = jwt.sign({ ch: hashAnswer(captcha.text) }, process.env.JWT_SECRET, { expiresIn: '5m' });
  return { svg: captcha.data, token };
}

function verifyCaptcha(token, userAnswer) {
  if (!token || !userAnswer) return false;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.ch === hashAnswer(userAnswer);
  } catch {
    return false; // expired or tampered
  }
}

module.exports = { generateCaptcha, verifyCaptcha };
