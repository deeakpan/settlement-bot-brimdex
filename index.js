#!/usr/bin/env node

/**
 * Settlement Bot Entry Point
 * Runs the settlement bot continuously
 */

const path = require("path");
const { spawn } = require("child_process");

process.chdir(__dirname);
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

console.log("🚀 Starting Brimdex Settlement Bot...");
console.log("📋 Environment check:");
console.log(`   - DEPLOYER_PRIVATE_KEY: ${process.env.DEPLOYER_PRIVATE_KEY ? "✅ Set" : "❌ Missing"}`);
console.log(`   - SUPABASE_URL: ${process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL ? "✅ Set" : "❌ Missing"}`);
console.log(`   - SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ Set" : "❌ Missing"}`);
console.log("");

const missingRailwayHint =
  !process.env.DEPLOYER_PRIVATE_KEY ||
  !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY;
if (missingRailwayHint) {
  console.log(
    "ℹ️  Host platforms (e.g. Railway) inject secrets into process.env per service. If these show Missing but you set variables in the dashboard, confirm they are attached to this same deployment (not only another service like the web app), names match exactly, then redeploy.\n"
  );
}

// Run the settle script
const settleScript = path.join(__dirname, "settle-markets.cjs");
const args = ["hardhat", "run", "--network", "somniaTestnet", settleScript];

console.log("🤖 Starting settlement bot...\n");

const child = spawn("npx", args, {
  cwd: __dirname,
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
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
