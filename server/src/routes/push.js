// Browser notification subscriptions for the signed-in user.
const router = require('express').Router();
const push = require('../services/push');
const { PushSubscription } = require('../models');

const wrap = (f) => (req, res) => f(req, res).catch((e) => { if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.message }); });

router.get('/key', wrap(async (req, res) => {
  const devices = await PushSubscription.count({ where: { userId: req.user.id } });
  res.json({ publicKey: await push.publicKey(), devices });
}));
router.post('/subscribe', wrap(async (req, res) => {
  await push.subscribe(req.user.id, req.body.subscription, req.get('user-agent'));
  res.json({ ok: true });
}));
router.post('/unsubscribe', wrap(async (req, res) => {
  await push.unsubscribe(req.user.id, req.body.endpoint);
  res.json({ ok: true });
}));
router.post('/test', wrap(async (req, res) => {
  const sent = await push.sendToUser(req.user.id, { title: 'Orbit notifications are on', body: 'You will see task updates here, even when Orbit is closed.', link: '/my-tasks', tag: 'orbit-test' });
  if (!sent) return res.status(400).json({ error: 'No browser is set up yet. Turn notifications on first.' });
  res.json({ ok: true, sent });
}));

module.exports = router;
