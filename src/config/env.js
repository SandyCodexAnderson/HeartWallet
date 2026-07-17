require('dotenv').config();

const config = {
    databaseUrl: process.env.DATABASE_URL || '',
    botToken: process.env.BOT_TOKEN || '',
    masterKey: process.env.MASTER_KEY || '',
    tonNetwork: process.env.TON_NETWORK || '',
    bitrefillRef: process.env.BITREFILL_REF || '',
    toncenterApiKey: process.env.TONCENTER_API_KEY || '',
    donationAddress: process.env.DONATION_ADDRESS || '',
    escrowWalletAddress: process.env.ESCROW_WALLET_ADDRESS || '',
    escrowWalletEncryptedKey: process.env.ESCROW_WALLET_ENCRYPTED_KEY || '',
    tonstakersPoolAddress: process.env.TONSTAKERS_POOL_ADDRESS || '',
    tsTonMasterAddress: process.env.TSTON_MASTER_ADDRESS || ''
};

if (!config.botToken) {
    console.warn("WARNING: BOT_TOKEN is missing from .env");
}

if (!config.masterKey) {
    console.warn("WARNING: MASTER_KEY is missing in .env.");
}

function isTonAddressConfigured(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isStakingConfigured() {
    return isTonAddressConfigured(config.tonstakersPoolAddress) && isTonAddressConfigured(config.tsTonMasterAddress);
}

module.exports = { config, isStakingConfigured };
