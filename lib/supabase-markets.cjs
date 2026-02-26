const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function loadMarkets() {
  try {
    const { data, error } = await supabase
      .from('markets_storage')
      .select('market_address, expiry, asset_name, time_left');

    if (error) {
      console.error("Error loading markets from Supabase:", error);
      return {};
    }

    const markets = {};
    if (data) {
      for (const row of data) {
        markets[row.market_address.toLowerCase()] = {
          expiry: row.expiry,
          assetName: row.asset_name,
          timeLeft: row.time_left || undefined
        };
      }
    }

    return markets;
  } catch (error) {
    console.error("Error loading markets:", error);
    return {};
  }
}

async function saveMarkets(markets) {
  try {
    // Get all current market addresses
    const { data: existing } = await supabase
      .from('markets_storage')
      .select('market_address');

    const existingAddresses = new Set(
      (existing || []).map((row) => row.market_address.toLowerCase())
    );

    const toUpsert = [];
    const toDelete = [];

    // Prepare upserts for markets that exist or need updating
    for (const [address, info] of Object.entries(markets)) {
      toUpsert.push({
        market_address: address.toLowerCase(),
        expiry: info.expiry,
        asset_name: info.assetName,
        time_left: info.timeLeft || null,
        updated_at: new Date().toISOString()
      });
    }

    // Find markets to delete (exist in DB but not in current markets)
    for (const existingAddr of existingAddresses) {
      if (!markets[existingAddr]) {
        toDelete.push(existingAddr);
      }
    }

    // Upsert all markets
    if (toUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from('markets_storage')
        .upsert(toUpsert, {
          onConflict: 'market_address'
        });

      if (upsertError) {
        throw upsertError;
      }
    }

    // Delete removed markets
    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('markets_storage')
        .delete()
        .in('market_address', toDelete);

      if (deleteError) {
        throw deleteError;
      }
    }
  } catch (error) {
    console.error("Error saving markets:", error);
    throw error;
  }
}

async function deleteMarket(address) {
  try {
    const { error } = await supabase
      .from('markets_storage')
      .delete()
      .eq('market_address', address.toLowerCase());

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error("Error deleting market:", error);
    throw error;
  }
}

async function loadSubscriptionId(network) {
  try {
    const { data, error } = await supabase
      .from('bot_state')
      .select('subscription_id')
      .eq('id', 'settlement_bot')
      .eq('network', network)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error("Error loading subscription ID from Supabase:", error);
      return null;
    }

    return data?.subscription_id || null;
  } catch (error) {
    console.error("Error loading subscription ID:", error);
    return null;
  }
}

async function saveSubscriptionId(network, subscriptionId) {
  try {
    // First check if record exists
    const { data: existing } = await supabase
      .from('bot_state')
      .select('id, network')
      .eq('id', 'settlement_bot')
      .eq('network', network)
      .single();

    if (existing) {
      // Update existing record
      const { error } = await supabase
        .from('bot_state')
        .update({
          subscription_id: subscriptionId,
          updated_at: new Date().toISOString()
        })
        .eq('id', 'settlement_bot')
        .eq('network', network);

      if (error) {
        throw error;
      }
    } else {
      // Insert new record
      const { error } = await supabase
        .from('bot_state')
        .insert({
          id: 'settlement_bot',
          network: network,
          subscription_id: subscriptionId,
          updated_at: new Date().toISOString()
        });

      if (error) {
        throw error;
      }
    }
  } catch (error) {
    console.error("Error saving subscription ID:", error);
    throw error;
  }
}

async function clearSubscriptionId(network) {
  try {
    const { error } = await supabase
      .from('bot_state')
      .update({ subscription_id: null })
      .eq('id', 'settlement_bot')
      .eq('network', network);

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error("Error clearing subscription ID:", error);
    throw error;
  }
}

module.exports = {
  loadMarkets,
  saveMarkets,
  deleteMarket,
  loadSubscriptionId,
  saveSubscriptionId,
  clearSubscriptionId
};
