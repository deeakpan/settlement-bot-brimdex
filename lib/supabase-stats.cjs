const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Apply cumulative stats after a successful on-chain settlement.
 * Uses DB RPC `increment_protocol_stats` for atomic updates.
 *
 * @param {string} network - e.g. somniaTestnet (one row per network)
 * @param {bigint} volumeDeltaUsdcRaw - USDC 6-decimal raw: traderPool = totalPool − bootstrapAmount
 * @param {bigint} revenueDeltaUsdcRaw - USDC 6-decimal raw: fee = traderPool − winnings (matches contract)
 */
async function incrementProtocolStats(network, volumeDeltaUsdcRaw, revenueDeltaUsdcRaw) {
  if (process.env.DISABLE_SUPABASE_STATS === "1") {
    return;
  }
  if (!supabaseUrl || !supabaseKey) {
    console.warn("   ⚠️  Skipping protocol stats: missing SUPABASE_URL / key");
    return;
  }
  if (!network) {
    console.warn("   ⚠️  Skipping protocol stats: missing network");
    return;
  }

  const vol = typeof volumeDeltaUsdcRaw === "bigint" ? volumeDeltaUsdcRaw.toString() : String(volumeDeltaUsdcRaw);
  const rev =
    typeof revenueDeltaUsdcRaw === "bigint" ? revenueDeltaUsdcRaw.toString() : String(revenueDeltaUsdcRaw);

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { error } = await supabase.rpc("increment_protocol_stats", {
    p_network: network,
    p_volume_delta: vol,
    p_revenue_delta: rev,
    p_markets_delta: 1,
  });

  if (error) {
    console.error("   ⚠️  protocol_stats RPC failed:", error.message || error);
  } else {
    console.log(`   📈 protocol_stats updated (network=${network}, volume+=${vol} raw USDC, revenue+=${rev}, markets+=1)`);
  }
}

module.exports = {
  incrementProtocolStats,
};
