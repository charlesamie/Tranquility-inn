const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const Admin = require('./Admin');
const { generateCaptcha, verifyCaptcha } = require('./captcha');

const router = express.Router();

// Slow down brute-force attempts on the login endpoint specifically.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/auth/captcha — call before each login attempt
router.get('/captcha', (req, res) => {
  const { svg, token } = generateCaptcha();
  res.json({ svg, token });
});

// POST /api/auth/login  { email, password, captchaToken, captchaText }
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password, captchaToken, captchaText } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (!verifyCaptcha(captchaToken, captchaText)) {
      return res.status(400).json({ error: 'Incorrect CAPTCHA — please try again.', captchaFailed: true });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({ token, admin: { name: admin.name, email: admin.email, role: admin.role } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.', detail: err.message });
  }
});

module.exports = router;
