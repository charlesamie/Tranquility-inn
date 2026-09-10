const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const Admin = require('./Admin');
const { generateCaptcha, verifyCaptcha } = require('./captcha');
const { sendPasswordResetEmail } = require('./notify');

const router = express.Router();

// Slow down brute-force attempts on the login endpoint specifically.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Separate, slightly looser limit for reset requests — still prevents
// someone from spamming an inbox with reset emails.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many reset requests. Try again in 15 minutes.' },
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

// POST /api/auth/forgot-password  { email }
// Always responds with the same generic message whether or not the email
// belongs to a real admin account — prevents this endpoint being used to
// enumerate which emails are registered.
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase().trim() });

    if (admin) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      // Store only the hash — matches the same principle as never storing
      // plaintext passwords. A leaked database alone can't be used to
      // forge a valid reset link.
      admin.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      admin.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 min
      await admin.save();

      const baseUrl = process.env.ADMIN_URL || 'https://www.tranquility-inn.com';
      const resetUrl = `${baseUrl}/admin?token=${rawToken}&email=${encodeURIComponent(admin.email)}`;

      sendPasswordResetEmail(admin, resetUrl).catch((err) => {
        console.error('[auth] Failed to send password reset email:', err.message);
      });
    }

    res.json({ message: 'If that email is registered, a password reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not process request.' });
  }
});

// POST /api/auth/reset-password  { email, token, newPassword }
router.post('/reset-password', async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword) {
      return res.status(400).json({ error: 'Email, token, and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const admin = await Admin.findOne({
      email: email.toLowerCase().trim(),
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    }).select('+resetPasswordToken');

    if (!admin) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired.' });
    }

    admin.passwordHash = await bcrypt.hash(newPassword, 12);
    admin.resetPasswordToken = null;
    admin.resetPasswordExpires = null;
    await admin.save();

    res.json({ message: 'Password updated. You can now log in with your new password.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not reset password.' });
  }
});

module.exports = router;
