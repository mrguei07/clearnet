import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Réseau public de test (Sepolia)
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || '';
const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY || '';
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';

// Polygon zkEVM (Phase A — migration cible, docs/EXECUTION_PACK_PHASE_A_TECH.md §2)
const POLYGON_ZKEVM_RPC_URL = process.env.POLYGON_ZKEVM_RPC_URL || '';
const POLYGON_ZKEVM_PRIVATE_KEY = process.env.POLYGON_ZKEVM_PRIVATE_KEY || '';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.19',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    localhost: { url: 'http://127.0.0.1:8545' },
    clearnet: {
      url: RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: SEPOLIA_PRIVATE_KEY ? [SEPOLIA_PRIVATE_KEY] : [],
    },
    polygonZkEvm: {
      url: POLYGON_ZKEVM_RPC_URL,
      accounts: POLYGON_ZKEVM_PRIVATE_KEY ? [POLYGON_ZKEVM_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_API_KEY,
    },
  },
};

export default config;
