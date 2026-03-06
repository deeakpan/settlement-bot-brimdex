const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const viem = require("viem");
const { SDK } = require("@somnia-chain/reactivity");
const { loadMarkets, saveMarkets, deleteMarket, loadSubscriptionId, saveSubscriptionId, clearSubscriptionId } = require("./lib/supabase-markets.cjs");

/**
 * Settlement Bot - Automatically settles expired markets
 * 
 * How it works:
 * 1. Subscribes to MarketCreated events (free off-chain) to track new markets
 * 2. Polls every 4 seconds: checks stored expiry timestamps against system time
 * 3. When market expires, calls settle() which fetches price from on-chain oracle (BrimdexFeeds)
 * 
 * Usage:
 *   npx hardhat run settle-markets.cjs --network somniaTestnet
 * 
 * Note: settle() now fetches price from on-chain oracle automatically - no off-chain price fetching needed
 */

async function main() {
  console.log("🤖 Starting Settlement Bot (Simple Polling)...\n");
  console.log("=".repeat(60));

  // Get network from Hardhat or environment variable
  const network = hre.network.name !== "hardhat" 
    ? hre.network.name 
    : (process.env.NETWORK || "somniaTestnet");
  
  if (network === "hardhat") {
    console.warn("⚠️  Warning: Running on hardhat network. Set --network flag or NETWORK env var.");
    console.warn("   Using default: somniaTestnet");
  }
  
  // Try to load deployments.json, fallback to environment variables
  let deployments = {};
  const deploymentsPath = path.join(__dirname, "deployments.json");
  
  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  } else {
    // Fallback to environment variables
    const factoryAddress = process.env.FACTORY_ADDRESS;
    if (!factoryAddress) {
      throw new Error("deployments.json not found and FACTORY_ADDRESS env var not set. Please provide one.");
    }
    deployments[network] = {
      factory: factoryAddress,
    };
    console.log("📋 Using factory address from environment variable");
  }
  
  if (!deployments[network]) {
    const availableNetworks = Object.keys(deployments).join(", ");
    throw new Error(
      `No deployments found for network: ${network}\n` +
      `Available networks: ${availableNetworks || "none"}\n` +
      `\n💡 Set FACTORY_ADDRESS environment variable or provide deployments.json`
    );
  }

  const factoryAddress = deployments[network].factory;
  if (!factoryAddress) {
    throw new Error("Factory address not found in deployments.json or FACTORY_ADDRESS env var");
  }

  console.log(`📋 Factory Address: ${factoryAddress}`);
  console.log(`🌐 Network: ${network}`);
  console.log(`🔮 Oracle: On-chain (BrimdexFeeds contract)`);
  console.log(`⏱️  Polling Interval: 4 seconds\n`);

  // Get factory contract
  const factoryABI = [
    {
      type: "function",
      name: "getAllMarkets",
      inputs: [],
      outputs: [{ type: "address[]" }],
      stateMutability: "view"
    },
    {
      type: "event",
      name: "MarketCreated",
      inputs: [
        { name: "market", type: "address", indexed: true },
        { name: "boundToken", type: "address", indexed: true },
        { name: "breakToken", type: "address", indexed: true },
        { name: "name", type: "string", indexed: false },
        { name: "lowerBound", type: "uint256", indexed: false },
        { name: "upperBound", type: "uint256", indexed: false },
        { name: "expiryTimestamp", type: "uint256", indexed: false }
      ]
    }
  ];
  
  const factory = await ethers.getContractAt(factoryABI, factoryAddress);
  
  // Get market contract ABI
  const marketABI = [
    "function marketConfig() external view returns (string name, string feedName, uint256 lowerBound, uint256 upperBound, uint256 expiryTimestamp, uint256 creationTimestamp, uint256 startPrice, bool initialized, bool settled)",
    "function settle() external",
    "event MarketSettled(bool boundWins, uint256 totalPool, uint256 winnings, uint256 resolvedPrice)"
  ];

  const [signer] = await ethers.getSigners();
  const provider = signer.provider || await ethers.getDefaultProvider();
  
  console.log(`👤 Settling as: ${signer.address}\n`);

  // Use Somnia infra testnet endpoints
  const rpcUrl = process.env.SOMNIA_TESTNET_RPC_URL || "https://api.infra.testnet.somnia.network";
  const wsUrl = process.env.SOMNIA_TESTNET_WS_URL || "wss://api.infra.testnet.somnia.network/ws";

  function toWebSocketUrl(httpUrl) {
    if (!httpUrl) throw new Error("Missing RPC URL");
    if (httpUrl.startsWith("ws://") || httpUrl.startsWith("wss://")) return httpUrl;
    const ws = httpUrl.startsWith("https://")
      ? "wss://" + httpUrl.slice("https://".length)
      : httpUrl.startsWith("http://")
        ? "ws://" + httpUrl.slice("http://".length)
        : httpUrl;
    return ws.endsWith("/ws") ? ws : `${ws.replace(/\/$/, "")}/ws`;
  }

  // Setup Somnia Reactivity SDK for MarketCreated events (free off-chain subscription)
  const somniaTestnet = viem.defineChain({
    id: 50312,
    name: "Somnia Testnet",
    nativeCurrency: {
      decimals: 18,
      name: "Somnia Test Token",
      symbol: "STT",
    },
    rpcUrls: {
      default: {
        http: [rpcUrl],
        webSocket: [wsUrl],
      },
    },
  });

  // Initialize SDK with explicit WebSocket URL
  const publicClient = viem.createPublicClient({
    chain: somniaTestnet,
    transport: viem.webSocket(wsUrl),
  });

  const sdk = new SDK({
    public: publicClient,
  });

  // Get network name for Supabase storage
  const networkName = hre.network.name;

  // Track markets that need settlement (load from Supabase)
  let marketsToSettle = await loadMarkets();
  console.log(`📁 Loaded ${Object.keys(marketsToSettle).length} market(s) from storage (Supabase)`);
  if (Object.keys(marketsToSettle).length > 0) {
    console.log(`   Storage markets: ${Object.keys(marketsToSettle).join(", ")}`);
  }
  
  // Get all markets from factory to verify which ones are valid
  console.log(`\n📊 Fetching all markets from factory contract...`);
  const allFactoryMarkets = await factory.getAllMarkets();
  console.log(`   Found ${allFactoryMarkets.length} market(s) in factory`);
  if (allFactoryMarkets.length > 0) {
    console.log(`   Factory markets: ${allFactoryMarkets.map(m => m.toLowerCase()).join(", ")}`);
  }
  
  const validMarketAddresses = new Set(allFactoryMarkets.map(addr => addr.toLowerCase()));
  
  // Remove old markets from storage that aren't in the factory
  let removedCount = 0;
  for (const marketAddress of Object.keys(marketsToSettle)) {
    if (!validMarketAddresses.has(marketAddress.toLowerCase())) {
      console.log(`   ⚠️  Removing old market from storage (not in factory): ${marketAddress}`);
      delete marketsToSettle[marketAddress];
      removedCount++;
    }
  }
  if (removedCount > 0) {
    await saveMarkets(marketsToSettle);
    console.log(`   ✅ Removed ${removedCount} old market(s) from storage\n`);
  } else {
    console.log(`   ✅ All markets in storage are valid\n`);
  }

  // Function to check and settle a market
  async function checkAndSettleMarket(marketAddress) {
    try {
      const marketAddrLower = marketAddress.toLowerCase();
      let market, config, initialized, settled, expiryTimestamp, assetName;
      
      try {
        market = await ethers.getContractAt(marketABI, marketAddress);
        config = await market.marketConfig();
        
        // Parse config tuple (now has feedName as second element)
        initialized = config[7];
        settled = config[8];
        expiryTimestamp = config[4];
        assetName = config[0];
      } catch (decodeError) {
        if (decodeError.message && decodeError.message.includes("could not decode")) {
          console.log(`   ⚠️  Market ${marketAddress} uses old ABI, removing from storage...`);
          delete marketsToSettle[marketAddrLower];
          await saveMarkets(marketsToSettle);
          return;
        }
        throw decodeError;
      }
      
      if (!initialized) {
        console.log(`   ⚠️  Market ${marketAddress} not initialized, skipping...`);
        return;
      }
      if (settled) {
        console.log(`   ✅ Market ${marketAddress} already settled, removing from storage...`);
        delete marketsToSettle[marketAddrLower];
        await saveMarkets(marketsToSettle);
        console.log(`   🗑️  Removed from storage (Supabase)`);
        return;
      }

      // Get current system time (no blockchain call needed!)
      const currentTime = Math.floor(Date.now() / 1000);

      // Check if expired
      if (currentTime >= Number(expiryTimestamp)) {
        console.log(`\n🎯 ========== MARKET EXPIRED ==========`);
        console.log(`   Market Address: ${marketAddress}`);
        console.log(`   Asset Name: ${assetName}`);
        console.log(`   Expiry Time: ${new Date(Number(expiryTimestamp) * 1000).toLocaleString()}`);
        console.log(`   Current Time: ${new Date(currentTime * 1000).toLocaleString()}`);
        console.log(`   Overdue by: ${Math.floor((currentTime - Number(expiryTimestamp)) / 60)} minutes`);

        const normalizedName = assetName ? assetName.trim().toUpperCase() : null;
        if (!normalizedName) {
          throw new Error(`Invalid asset name: ${assetName}`);
        }

        const marketContract = await ethers.getContractAt(marketABI, marketAddress);
        
        console.log(`   🌐 Contract will fetch price from on-chain oracle (BrimdexFeeds)...`);
        console.log(`   👤 Settling as: ${signer.address} (anyone can settle)`);

        let tx;
        try {
          // Try to estimate gas first to catch revert reasons
          try {
            await marketContract.settle.estimateGas();
          } catch (estimateError) {
            console.error(`   ⚠️  Gas estimation failed: ${estimateError.message}`);
            if (estimateError.reason) {
              throw new Error(`Transaction will revert: ${estimateError.reason}`);
            }
            throw estimateError;
          }
          
          // settle() now takes no parameters - contract fetches price from oracle
          tx = await marketContract.settle();
          console.log(`   Transaction: ${tx.hash}`);
          await tx.wait();
          console.log(`   ✅ Settled using on-chain oracle!\n`);
        } catch (txError) {
          // Re-throw with more context
          throw new Error(`Settlement transaction failed: ${txError.message}`);
        }
        
        // Remove from tracking and storage
        delete marketsToSettle[marketAddrLower];
        await saveMarkets(marketsToSettle);
        console.log(`   🗑️  Removed from storage (Supabase)`);
      } else {
        // Not expired yet, update tracking
        const timeLeft = Number(expiryTimestamp) - currentTime;
        marketsToSettle[marketAddrLower] = {
          expiry: Number(expiryTimestamp),
          assetName: assetName,
          timeLeft
        };
        await saveMarkets(marketsToSettle);
      }
    } catch (error) {
      console.error(`   ❌ Error checking market ${marketAddress}: ${error.message}`);
    }
  }

  // Markets will be discovered via subscription events only (no polling)
  console.log("📊 Markets will be discovered via MarketCreated events only\n");

  // Subscribe to MarketCreated events (free off-chain subscription)
  console.log("📡 Setting up MarketCreated event subscription...\n");
  
  const marketCreatedEventSig = "MarketCreated(address,address,address,string,uint256,uint256,uint256)";
  const marketCreatedTopic = viem.keccak256(viem.toHex(marketCreatedEventSig));
  
  console.log(`   MarketCreated topic: ${marketCreatedTopic}`);
  console.log(`   Factory address: ${factoryAddress}\n`);
  
  console.log(`   RPC (HTTP): ${rpcUrl}`);
  console.log(`   RPC (WS):   ${wsUrl}\n`);

  // Check for existing subscription and unsubscribe first
  const existingSubscriptionId = await loadSubscriptionId(networkName);
  if (existingSubscriptionId) {
    console.log(`🔄 Found existing subscription ID: ${existingSubscriptionId}`);
    console.log(`   Attempting to unsubscribe from old subscription...`);
    try {
      const SOMNIA_REACTIVITY_PRECOMPILE = "0x0000000000000000000000000000000000000400";
      const precompileABI = [
        "function unsubscribe(uint256 subscriptionId) external"
      ];
      const precompile = await ethers.getContractAt(precompileABI, SOMNIA_REACTIVITY_PRECOMPILE);
      const tx = await precompile.unsubscribe(existingSubscriptionId);
      await tx.wait();
      console.log(`   ✅ Unsubscribed from old subscription\n`);
      await clearSubscriptionId(networkName);
    } catch (error) {
      console.warn(`   ⚠️  Could not unsubscribe (subscription may have expired): ${error.message}\n`);
      await clearSubscriptionId(networkName);
    }
  }

  // Subscribe to MarketCreated events (required - no polling fallback)
  let marketCreatedSubscription = null;
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 5000; // 5 seconds
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`   ⏳ Retry attempt ${attempt}/${MAX_RETRIES} (waiting ${RETRY_DELAY/1000}s)...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
      
      marketCreatedSubscription = await sdk.subscribe({
        ethCalls: [],
        eventContractSources: [factoryAddress],
        topicOverrides: [marketCreatedTopic],
        onData: async (data) => {
          try {
            console.log("\n📨 ========== MarketCreated EVENT RECEIVED ==========");
            console.log(`   Raw event data:`, JSON.stringify(data, null, 2));
            
            const decoded = viem.decodeEventLog({
              abi: factoryABI,
              topics: data.result.topics,
              data: data.result.data,
            });
            
            const marketAddress = decoded.args.market;
            const boundToken = decoded.args.boundToken;
            const breakToken = decoded.args.breakToken;
            const assetName = decoded.args.name;
            const lowerBound = decoded.args.lowerBound;
            const upperBound = decoded.args.upperBound;
            const expiryTimestamp = decoded.args.expiryTimestamp;
            
            console.log(`🆕 NEW MARKET CREATED:`);
            console.log(`   Market Address: ${marketAddress}`);
            console.log(`   Asset Name: ${assetName}`);
            console.log(`   BOUND Token: ${boundToken}`);
            console.log(`   BREAK Token: ${breakToken}`);
            console.log(`   Lower Bound: $${(Number(lowerBound) / 1e6).toFixed(2)}`);
            console.log(`   Upper Bound: $${(Number(upperBound) / 1e6).toFixed(2)}`);
            console.log(`   Expiry: ${new Date(Number(expiryTimestamp) * 1000).toLocaleString()}`);
            console.log(`   Expires in: ${Math.floor((Number(expiryTimestamp) - Math.floor(Date.now() / 1000)) / 60)} minutes`);
            
            const marketAddrLower = marketAddress.toLowerCase();
            
            // Add to tracking
            marketsToSettle[marketAddrLower] = {
              expiry: Number(expiryTimestamp),
              assetName: assetName,
              timeLeft: Number(expiryTimestamp) - Math.floor(Date.now() / 1000)
            };
            await saveMarkets(marketsToSettle);
            console.log(`   ✅ Added to storage and tracking`);
            console.log(`==========================================\n`);
            
            // Check if already expired
            await checkAndSettleMarket(marketAddress);
          } catch (error) {
            console.error(`⚠️  Error processing MarketCreated event: ${error.message}`);
            console.error(`   Stack: ${error.stack}`);
          }
        },
        onError: (error) => {
          console.error(`⚠️  Subscription error: ${error.message}`);
        },
      });

      if (marketCreatedSubscription instanceof Error) {
        throw marketCreatedSubscription;
      }

      console.log(`   ✅ Subscribed to MarketCreated events`);
      console.log(`   Subscription ID: ${marketCreatedSubscription.subscriptionId}\n`);

      // Save subscription ID for next time
      await saveSubscriptionId(networkName, marketCreatedSubscription.subscriptionId);
      console.log(`   💾 Saved subscription ID to Supabase\n`);
      
      break; // Success, exit retry loop
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        console.error(`❌ Failed to subscribe after ${MAX_RETRIES} attempts: ${error.message}`);
        if (error.message && error.message.includes("Too many subscriptions")) {
          console.error(`\n💡 ERROR: Too many subscriptions for this wallet address.`);
          console.error(`💡 Subscriptions are tied to your wallet address (${signer.address}).`);
          console.error(`💡 Possible solutions:`);
          console.error(`   1. Wait a few minutes for old subscriptions to expire/clear`);
          console.error(`   2. Use a different wallet address`);
          console.error(`   3. Contact Somnia support about subscription limits`);
          console.error(`   4. Check if subscriptions auto-expire after inactivity\n`);
        }
        throw error;
      } else {
        console.warn(`   ⚠️  Attempt ${attempt} failed: ${error.message}`);
      }
    }
  }
  
  if (!marketCreatedSubscription) {
    throw new Error("Failed to create subscription after all retries");
  }

  // Check expiry periodically (only for markets already in storage)
  console.log("⏱️  Starting expiry checker (every 4 seconds)...\n");
  
  const POLL_INTERVAL = 4000; // 4 seconds
  let pollInterval = setInterval(async () => {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Reload markets from storage in case they were updated
      marketsToSettle = await loadMarkets();
      
      if (Object.keys(marketsToSettle).length === 0) {
        return; // No markets to check
      }
      
      // Check all tracked markets for expiry
      const expiredMarkets = [];
      for (const marketAddress of Object.keys(marketsToSettle)) {
        const info = marketsToSettle[marketAddress];
        if (currentTime >= info.expiry) {
          expiredMarkets.push(marketAddress);
        }
      }
      
      if (expiredMarkets.length > 0) {
        console.log(`\n⏰ ========== EXPIRY CHECK: Found ${expiredMarkets.length} expired market(s) ==========`);
        for (const marketAddress of expiredMarkets) {
          console.log(`   Checking: ${marketAddress}`);
          await checkAndSettleMarket(marketAddress);
        }
        console.log(`==========================================\n`);
      }
    } catch (error) {
      console.error(`⚠️  Error in expiry checker: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    }
  }, POLL_INTERVAL);

  console.log("✅ Bot running!");
  console.log("   - MarketCreated events: Real-time (push-based subscription)");
  console.log("   - Expiry checks: Every 4 seconds (for markets in storage)");
  console.log("   - No polling for new markets - subscription only");
  console.log("   Press Ctrl+C to stop\n");

  // Keep process alive
  process.stdin.resume();

  // Handle errors gracefully
  process.on('uncaughtException', (error) => {
    console.error(`⚠️  Uncaught error: ${error.message}`);
  });
  
  process.on('unhandledRejection', (reason) => {
    console.error(`⚠️  Unhandled rejection: ${reason}`);
  });

  // Cleanup on exit
  process.on('SIGINT', async () => {
    console.log("\n\n🛑 Stopping bot...");
    try {
      if (marketCreatedSubscription && typeof marketCreatedSubscription.unsubscribe === 'function') {
        console.log("   Unsubscribing from MarketCreated events...");
        await marketCreatedSubscription.unsubscribe();
        console.log("   ✅ Unsubscribed");
        await clearSubscriptionId(networkName);
      } else {
        const storedId = await loadSubscriptionId(networkName);
        if (storedId) {
          try {
            const SOMNIA_REACTIVITY_PRECOMPILE = "0x0000000000000000000000000000000000000400";
            const precompileABI = ["function unsubscribe(uint256 subscriptionId) external"];
            const precompile = await ethers.getContractAt(precompileABI, SOMNIA_REACTIVITY_PRECOMPILE);
            const tx = await precompile.unsubscribe(storedId);
            await tx.wait();
            console.log(`   ✅ Unsubscribed using stored ID: ${storedId}`);
          } catch (error) {
            console.warn(`   ⚠️  Could not unsubscribe using stored ID: ${error.message}`);
          }
          await clearSubscriptionId(networkName);
        }
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        console.log("   ✅ Stopped expiry checker");
      }
    } catch (error) {
      console.error(`   ⚠️  Error cleaning up: ${error.message}`);
    }
    process.exit(0);
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
