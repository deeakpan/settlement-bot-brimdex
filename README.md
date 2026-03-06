# Brimdex Settlement Bot

Minimal settlement bot service for hosting on Railway.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set environment variables:**
   - `DEPLOYER_PRIVATE_KEY` - Private key for settling markets (must have `0x` prefix)
   - `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (for server-side access)
   - `FACTORY_ADDRESS` (optional) - Factory contract address (or use deployments.json)
   - `SOMNIA_TESTNET_RPC_URL` (optional) - Defaults to `https://api.infra.testnet.somnia.network`
   - `SOMNIA_TESTNET_WS_URL` (optional) - Defaults to `wss://api.infra.testnet.somnia.network/ws`

3. **Create deployments.json (optional):**
   If you don't set `FACTORY_ADDRESS`, create a `deployments.json` file:
   ```json
   {
     "somniaTestnet": {
       "factory": "0x..."
     }
   }
   ```

## Running Locally

### Test in settlement-bot directory:

1. **Navigate to the directory:**
   ```bash
   cd settlement-bot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create `.env` file** (copy from parent or create new):
   ```bash
   DEPLOYER_PRIVATE_KEY=0x...
   SUPABASE_URL=https://...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

4. **Run the bot:**
   ```bash
   npm start
   ```
   
   Or directly:
   ```bash
   npx hardhat run settle-markets.cjs --network somniaTestnet
   ```

### Test from root directory:

You can also test from the root by running:
```bash
cd settlement-bot && npm install && npm start
```

## Railway Deployment

1. **Create a new Railway project**
2. **Connect your repository** (or create a new repo with just the `settlement-bot/` folder)
3. **Set root directory** to `settlement-bot/` (if deploying from monorepo)
4. **Add environment variables** in Railway dashboard:
   - `DEPLOYER_PRIVATE_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `FACTORY_ADDRESS` (or create deployments.json)
5. **Set build command:** `npm install`
6. **Set start command:** `npm start`
7. **Deploy!**

The bot will run continuously and automatically settle expired markets.

## What It Does

- Subscribes to `MarketCreated` events (real-time)
- Tracks markets in Supabase
- Checks every 4 seconds for expired markets
- Automatically calls `settle()` on expired markets
- Uses on-chain oracle (BrimdexFeeds) for price resolution
