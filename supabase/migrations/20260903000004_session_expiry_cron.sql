-- Enable pg_cron extension (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove any existing job with this name (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'casual_sessions_expiry') THEN
    PERFORM cron.unschedule('casual_sessions_expiry');
  END IF;
END $$;

-- Schedule hourly expiry job
-- 1. Mark running/waiting sessions past expires_at as 'stopped'.
-- 2. Hard-delete sessions in 'stopped' state older than 30 days.
SELECT cron.schedule(
  'casual_sessions_expiry',
  '0 * * * *',
  $$
  UPDATE casual_sessions
    SET status = 'stopped'
  WHERE status IN ('running', 'waiting')
    AND expires_at < now();

  DELETE FROM casual_sessions
  WHERE status = 'stopped'
    AND expires_at < now() - interval '30 days';
  $$
);
