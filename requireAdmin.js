const jwt = require('jsonwebtoken');

// Verifies the Bearer token issued by POST /api/auth/login and attaches the
// decoded payload ({ id, email, role }) to req.admin. Mount on any route
// that should only be reachable from the admin dashboard.
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session — please sign in again.' });
  }
}

module.exports = { requireAdmin };
