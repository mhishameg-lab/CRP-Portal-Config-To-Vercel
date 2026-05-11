// pages/api/cron/change-detection.js
// Called by Vercel Cron every 10 minutes (configure in vercel.json).
// Replaces: ScriptApp.newTrigger('runChangeDetectionTrigger').timeBased().everyMinutes(10)

import { runChangeDetectionInternal } from '../../../services/data.js';

export default async function handler(req, res) {
  // Vercel Cron sends a secret header to prevent unauthorized invocations.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await runChangeDetectionInternal();
    console.log('[cron/change-detection]', result);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[cron/change-detection] error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
