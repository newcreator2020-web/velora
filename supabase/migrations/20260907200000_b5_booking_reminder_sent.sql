-- ============================================================
-- TASK B5 · NOTIFICHE EMAIL — BOOKING REMINDER FLAG
-- ============================================================
-- Aggiunge la colonna reminder_sent sulla tabella bookings
-- per tracciare l'invio del promemoria 24h prima dell'appuntamento.
-- Service role GRANT allineato allo standard FASE 10f.
-- ============================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_bookings_reminder_sent_status_starts
  ON public.bookings (reminder_sent, status, starts_at);

-- RLS già abilitata e forzata da FASE 9a.
-- Assicuriamo i grant come da policy service_role esistente (FASE 10f):
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings TO service_role;
