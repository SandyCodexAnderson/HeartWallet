require('dotenv').config();

const config = {
    databaseUrl: process.env.DATABASE_URL || '',
    botToken: process.env.BOT_TOKEN || '',
    masterKey: process.env.MASTER_KEY || '',
    tonNetwork: process.env.TON_NETWORK || 'testnet',
    bitrefillRef: process.env.BITREFILL_REF || '',
    toncenterApiKey: process.env.TONCENTER_API_KEY || '',
    donationAddress: process.env.DONATION_ADDRESS || '',
    escrowWalletAddress: process.env.ESCROW_WALLET_ADDRESS || '',
    escrowWalletEncryptedKey: process.env.ESCROW_WALLET_ENCRYPTED_KEY || ''
};

if (!config.botToken) {
    console.warn("WARNING: BOT_TOKEN is missing from .env");
}

if (!config.masterKey) {
    console.warn("WARNING: MASTER_KEY is missing in .env.");
}

module.exports = { config };
