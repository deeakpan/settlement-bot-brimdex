# Brimdex Settlement Bot

Minimal service that watches Somnia testnet markets and settles them when they expire. Intended for always-on hosting.

## What it does

- Listens for new markets and keeps state in sync with Supabase.
- Periodically finds markets past expiry and submits settlement on-chain.
- Settlement uses the same oracle flow as the Brimdex contracts (no manual price arguments in normal operation).

## Local use

Install Node dependencies in this folder, configure secrets and RPC settings using your own `.env` (or your process manager’s env), then start the process with the package’s start script. If you deploy from the monorepo root, run everything from this directory so paths and scripts resolve correctly.

## Deploying

Point your host at this directory as the app root, install dependencies, set the required secrets and URLs in the host’s environment UI, and use the provided start command from `package.json`. No extra build step beyond install unless your platform requires one.

## Notes

- The wallet you use must be able to call settle on your deployed factory/markets.
- Keep private keys and service role keys out of git and chat logs.
