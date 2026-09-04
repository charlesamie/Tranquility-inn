// Sends booking confirmations by email (SendGrid) and SMS (Twilio), each
// including links to the hotel's WhatsApp and Instagram.
//
// Both providers are optional: if their API keys aren't set in .env, the
// matching send function logs a warning and resolves quietly instead of
// throwing — so booking creation/payment never fails just because a
// notification integration isn't configured yet.

function money(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}
function formatDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function whatsappLink(booking) {
  const number = (process.env.HOTEL_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
  const text = encodeURIComponent(
    `Hi Tranquility Inn! I'd like to ask about my booking ${booking.bookingRef} (${booking.roomName}, ${formatDate(booking.checkIn)} - ${formatDate(booking.checkOut)}).`
  );
  return number ? `https://wa.me/${number}?text=${text}` : null;
}

function instagramLink() {
  return process.env.HOTEL_INSTAGRAM_URL || null;
}

function buildEmailHtml(booking) {
  const wa = whatsappLink(booking);
  const ig = instagramLink();
  return `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#141F1A;">
    <h2 style="font-weight:400;">Booking confirmed — Tranquility Inn</h2>
    <p>Hi ${booking.guestFirstName}, your stay is booked. Here are the details:</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
      <tr><td style="padding:6px 0;color:#666;">Booking reference</td><td style="text-align:right;font-weight:600;">${booking.bookingRef}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Room</td><td style="text-align:right;">${booking.roomName}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Check-in</td><td style="text-align:right;">${formatDate(booking.checkIn)}, 1:00 PM</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Check-out</td><td style="text-align:right;">${formatDate(booking.checkOut)}, 11:00 AM</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Guests</td><td style="text-align:right;">${booking.guests}</td></tr>
      <tr><td style="padding:10px 0;color:#666;border-top:1px solid #eee;font-weight:600;">Total paid</td><td style="text-align:right;border-top:1px solid #eee;font-weight:600;">${money(booking.totalAmount)}</td></tr>
    </table>
    <p style="font-size:13px;color:#666;">Please carry a valid photo ID at check-in. Free cancellation up to 24 hours before check-in.</p>
    <p style="margin-top:24px;">
      ${wa ? `<a href="${wa}" style="display:inline-block;background:#141F1A;color:#fff;text-decoration:none;padding:10px 18px;font-size:13px;margin-right:10px;">Message us on WhatsApp</a>` : ''}
      ${ig ? `<a href="${ig}" style="display:inline-block;border:1px solid #141F1A;color:#141F1A;text-decoration:none;padding:10px 18px;font-size:13px;">Follow on Instagram</a>` : ''}
    </p>
    <p style="font-size:12px;color:#999;margin-top:28px;">Tranquility Inn, Manapakkam, Chennai · +91 98840 32292</p>
  </div>`;
}

async function sendBookingConfirmationEmail(booking) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn(`[notify] SENDGRID_API_KEY not set — skipping confirmation email for ${booking.bookingRef}.`);
    return { sent: false, reason: 'not_configured' };
  }
  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to: booking.guestEmail,
      from: process.env.SENDGRID_FROM_EMAIL || 'reservations@tranquilityinn-chennai.com',
      subject: `Booking confirmed — ${booking.bookingRef} · Tranquility Inn`,
      html: buildEmailHtml(booking),
    });
    return { sent: true };
  } catch (err) {
    console.error(`[notify] Email send failed for ${booking.bookingRef}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

async function sendBookingConfirmationSMS(booking) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn(`[notify] Twilio credentials not set — skipping confirmation SMS for ${booking.bookingRef}.`);
    return { sent: false, reason: 'not_configured' };
  }
  try {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const wa = whatsappLink(booking);

    const body =
      `Tranquility Inn: Booking ${booking.bookingRef} confirmed. ` +
      `${booking.roomName}, ${formatDate(booking.checkIn)}-${formatDate(booking.checkOut)}. ` +
      `Total ${money(booking.totalAmount)}.` +
      (wa ? ` Questions? WhatsApp us: ${wa}` : '');

    await client.messages.create({
      to: booking.guestPhone.startsWith('+') ? booking.guestPhone : `+91${booking.guestPhone.replace(/\D/g, '').slice(-10)}`,
      from: process.env.TWILIO_FROM_NUMBER,
      body,
    });
    return { sent: true };
  } catch (err) {
    console.error(`[notify] SMS send failed for ${booking.bookingRef}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

// Fire both, never let a notification failure affect the booking response.
async function sendBookingConfirmations(booking) {
  const [email, sms] = await Promise.all([
    sendBookingConfirmationEmail(booking).catch((e) => ({ sent: false, reason: e.message })),
    sendBookingConfirmationSMS(booking).catch((e) => ({ sent: false, reason: e.message })),
  ]);
  return { email, sms };
}

module.exports = { sendBookingConfirmations, whatsappLink, instagramLink };
