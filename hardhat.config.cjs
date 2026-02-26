require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const SOMNIA_TESTNET_RPC_URL =
  process.env.SOMNIA_TESTNET_RPC_URL || "https://api.infra.testnet.somnia.network";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

/** @type import("hardhat/config").HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { 
      optimizer: { enabled: true, runs: 200 },
      viaIR: true
    },
  },
  networks: {
    somniaTestnet: {
      url: SOMNIA_TESTNET_RPC_URL,
      chainId: 50312,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      timeout: 120000,
      gas: "auto",
      gasPrice: "auto",
    },
  },
};
