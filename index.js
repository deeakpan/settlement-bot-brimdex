#!/usr/bin/env node

/**
 * Settlement Bot Entry Point
 * Runs the settlement bot continuously
 */

require("dotenv").config();
const { exec } = require("child_process");
const path = require("path");

console.log("🚀 Starting Brimdex Settlement Bot...");
console.log("📋 Environment check:");
console.log(`   - DEPLOYER_PRIVATE_KEY: ${process.env.DEPLOYER_PRIVATE_KEY ? "✅ Set" : "❌ Missing"}`);
console.log(`   - SUPABASE_URL: ${process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL ? "✅ Set" : "❌ Missing"}`);
console.log(`   - SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ Set" : "❌ Missing"}`);
console.log("");

// Make sure we're in the right directory
process.chdir(__dirname);

// Run the settle script
const settleScript = path.join(__dirname, "settle-markets.cjs");
const command = `npx hardhat run --network somniaTestnet ${settleScript}`;

console.log("🤖 Starting settlement bot...\n");

const child = exec(command, {
  cwd: __dirname,
  env: process.env,
});

child.stdout.on("data", (data) => {
  process.stdout.write(data);
});

child.stderr.on("data", (data) => {
  process.stderr.write(data);
});

child.on("error", (error) => {
  console.error("❌ Failed to start settlement bot:", error);
  process.exit(1);
});

child.on("exit", (code) => {
  if (code !== 0) {
    console.error(`❌ Settlement bot exited with code ${code}`);
    console.log("🔄 Restarting in 10 seconds...");
    setTimeout(() => {
      process.exit(1); // Let Railway restart the service
    }, 10000);
  } else {
    console.log("✅ Settlement bot stopped gracefully");
    process.exit(0);
  }
});

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully...");
  child.kill("SIGTERM");
});

process.on("SIGINT", () => {
  console.log("🛑 Received SIGINT, shutting down gracefully...");
  child.kill("SIGINT");
});
