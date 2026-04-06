-- Brimdex protocol stats (cumulative, updated by settlement-bot after each successful settle)
-- Run in Supabase SQL editor or via migration.
-- USDC amounts are stored in raw 6-decimal units (same as on-chain collateral).

CREATE TABLE IF NOT EXISTS public.protocol_stats (
  network text PRIMARY KEY,
  volume_usdc_raw bigint NOT NULL DEFAULT 0,
  revenue_usdc_raw bigint NOT NULL DEFAULT 0,
  markets_settled bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.protocol_stats IS 'Cumulative stats after each settle: volume += traderPool (totalPool − bootstrap), revenue += fee (traderPool − winnings from MarketSettled), markets_settled += 1.';

-- Atomic increment (called from settlement-bot via supabase.rpc)
CREATE OR REPLACE FUNCTION public.increment_protocol_stats(
  p_network text,
  p_volume_delta bigint,
  p_revenue_delta bigint,
  p_markets_delta bigint DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.protocol_stats (network, volume_usdc_raw, revenue_usdc_raw, markets_settled, updated_at)
  VALUES (p_network, p_volume_delta, p_revenue_delta, COALESCE(p_markets_delta, 1), now())
  ON CONFLICT (network) DO UPDATE SET
    volume_usdc_raw = public.protocol_stats.volume_usdc_raw + EXCLUDED.volume_usdc_raw,
    revenue_usdc_raw = public.protocol_stats.revenue_usdc_raw + EXCLUDED.revenue_usdc_raw,
    markets_settled = public.protocol_stats.markets_settled + EXCLUDED.markets_settled,
    updated_at = now();
END;
$$;

-- Bot should use SUPABASE_SERVICE_ROLE_KEY (do not expose this RPC to anon)
GRANT EXECUTE ON FUNCTION public.increment_protocol_stats(text, bigint, bigint, bigint) TO service_role;

-- Optional: row-level read for dashboards (tighten in production)
ALTER TABLE public.protocol_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "protocol_stats_select_public"
  ON public.protocol_stats FOR SELECT
  TO anon, authenticated
  USING (true);

-- Service role bypasses RLS; bot should use SUPABASE_SERVICE_ROLE_KEY
