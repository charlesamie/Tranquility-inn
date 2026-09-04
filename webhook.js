const express = require('express');
const crypto = require('crypto');
const Booking = require('./Booking');
const { sendBookingConfirmations, whatsappLink, instagramLink } = require('./notify');

const router = express.Router();

// POST /api/payment/webhook — Razorpay calls this server-to-server the
// moment a payment settles, so a booking still gets confirmed even if the
// guest closes their browser right after paying (before the client-side
// /api/payment/verify call fires).
//
// Configure in the Razorpay dashboard: Settings → Webhooks
//   URL: https://YOUR-BACKEND-URL/api/payment/webhook
//   Events: payment.captured, payment.failed
// Set RAZORPAY_WEBHOOK_SECRET to the secret shown there.
//
// IMPORTANT: this route needs the raw request body to verify the signature,
// so it's mounted in server.js BEFORE the global express.json() parser.
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
      console.error('[webhook] RAZORPAY_WEBHOOK_SECRET not set — rejecting webhook.');
      return res.status(500).json({ error: 'Webhook not configured.' });
    }

    const signature = req.headers['x-razorpay-signature'];
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex');

    if (!signature || signature !== expected) {
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    const event = JSON.parse(req.body.toString('utf8'));

    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity;
      // The paymentStatus !== 'paid' guard makes this idempotent: if
      // /api/payment/verify already marked the booking paid, this update
      // matches nothing and we skip sending a duplicate confirmation.
      const booking = await Booking.findOneAndUpdate(
        { razorpayOrderId: payment.order_id, paymentStatus: { $ne: 'paid' } },
        { paymentStatus: 'paid', razorpayPaymentId: payment.id, status: 'confirmed' },
        { new: true }
      );
      if (booking) {
        sendBookingConfirmations(booking).then((result) => {
          console.log(`[webhook] ${booking.bookingRef} — email: ${result.email.sent}, sms: ${result.sms.sent}`);
        });
      }
    }

    if (event.event === 'payment.failed') {
      const payment = event.payload.payment.entity;
      await Booking.findOneAndUpdate(
        { razorpayOrderId: payment.order_id, paymentStatus: { $ne: 'paid' } },
        { paymentStatus: 'failed' }
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[webhook] error:', err.message);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

module.exports = router;
