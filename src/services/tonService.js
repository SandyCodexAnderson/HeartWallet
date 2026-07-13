const { TonClient, WalletContractV4, internal, Address, beginCell } = require('@ton/ton');
const { mnemonicNew, mnemonicToPrivateKey, mnemonicValidate } = require('@ton/crypto');
const { config } = require('../config/env');
const { decryptPrivateKey } = require('./cryptoService');

const isMainnet = config.tonNetwork === 'mainnet';
const endpoint = isMainnet
    ? 'https://toncenter.com/api/v2/jsonRPC'
    : 'https://testnet.toncenter.com/api/v2/jsonRPC';

// API key de TonCenter — en .env como TONCENTER_API_KEY
// Sin key: 1 req/s | Con key gratis: 10 req/s | https://toncenter.com/api/v2/#/
const toncenterkApiKey = config.toncenterApiKey || null;

const client = new TonClient({
    endpoint,
    ...(toncenterkApiKey ? { apiKey: toncenterkApiKey } : {})
});

async function generateWallet() {
    const mnemonics = await mnemonicNew();
    const keyPair = await mnemonicToPrivateKey(mnemonics);
    
    const workchain = 0; 
    const wallet = WalletContractV4.create({ workchain, publicKey: keyPair.publicKey });
    
    // Fragment y muchas dApps usan el formato Mainnet Non-Bounceable por defecto (empieza por UQ...)
    const address = wallet.address.toString({ testOnly: false, bounceable: false });
    const privateKeyHex = keyPair.secretKey.toString('hex');
    
    return {
        address,
        privateKeyHex,
        mnemonics 
    };
}

async function importWallet(mnemonicsArray) {
    const isValid = await mnemonicValidate(mnemonicsArray);
    if (!isValid) {
        throw new Error("Invalid mnemonic phrase");
    }
    
    const keyPair = await mnemonicToPrivateKey(mnemonicsArray);
    
    const workchain = 0; 
    const wallet = WalletContractV4.create({ workchain, publicKey: keyPair.publicKey });
    
    const address = wallet.address.toString({ testOnly: false, bounceable: false });
    const privateKeyHex = keyPair.secretKey.toString('hex');
    
    return {
        address,
        privateKeyHex,
        mnemonics: mnemonicsArray 
    };
}

async function getBalance(addressStr) {
    try {
        const address = Address.parse(addressStr);
        const balance = await client.getBalance(address);
        return balance.toString(); 
    } catch (error) {
        console.error("Error al obtener balance para", addressStr, error);
        return "0";
    }
}

async function sendTon(encryptedPrivateKey, toAddress, amountNanoTon, memoOrPayload = null, bounce = false) {
    try {
        const privateKeyHex = decryptPrivateKey(encryptedPrivateKey);
        const secretKey = Buffer.from(privateKeyHex, 'hex');
        
        if (secretKey.length !== 64) {
            throw new Error("Invalid secret key length");
        }
        
        const publicKey = secretKey.subarray(32, 64);
        const wallet = WalletContractV4.create({ workchain: 0, publicKey });
        const contract = client.open(wallet);
        
        let seqno;
        try {
            seqno = await contract.getSeqno();
        } catch(e) {
            seqno = 0;
        }
        if (seqno === undefined || seqno === null) seqno = 0;
        
        let amountBigInt;
        try {
            amountBigInt = BigInt(amountNanoTon);
        } catch(e) {
            throw new Error(`Monto inválido: ${amountNanoTon}`);
        }
        
        let body;
        if (memoOrPayload) {
            if (typeof memoOrPayload === 'string') {
                body = beginCell().storeUint(0, 32).storeStringTail(memoOrPayload).endCell();
            } else {
                body = memoOrPayload; // It's already a Cell
            }
        }

        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                await contract.sendTransfer({
                    seqno,
                    secretKey,
                    messages: [
                        internal({
                            to: toAddress,
                            value: amountBigInt,
                            bounce: bounce,
                            body
                        })
                    ]
                });
                break;
            } catch(sendErr) {
                const is429 = sendErr?.response?.status === 429 ||
                              sendErr?.message?.includes('429') ||
                              sendErr?.status === 429;
                if (is429 && attempt < MAX_RETRIES) {
                    const waitMs = attempt * 2000; // 2s, 4s
                    console.log(`[TonCenter] Rate limit 429, reintentando en ${waitMs}ms (intento ${attempt}/${MAX_RETRIES})...`);
                    await new Promise(r => setTimeout(r, waitMs));
                    continue;
                }
                throw sendErr; // Relanzar si no es 429 o se agotaron los reintentos
            }
        }
        
        return { success: true };
    } catch (error) {
        console.error("Error al enviar TON:", error);
        return { success: false, error: error.message || "Unknown error" };
    }
}

async function getNfts(addressStr) {
    try {
        const url = `https://tonapi.io/v2/accounts/${addressStr}/nfts?limit=100`;
        const response = await fetch(url);
        if (!response.ok) return [];
        const data = await response.json();
        return data.nft_items || [];
    } catch (error) {
        console.error("Error al obtener NFTs para", addressStr, error);
        return [];
    }
}

async function getNftHistoryAndValue(nftAddress) {
    try {
        const url = `https://tonapi.io/v2/nfts/${nftAddress}/history?limit=100`;
        const response = await fetch(url);
        if (!response.ok) return { history: [], estimatedValue: null, hasPurchases: false };
        const data = await response.json();
        
        const history = [];
        let estimatedValue = null;
        let hasPurchases = false;
        
        if (data.events) {
            for (const event of data.events) {
                // Check for NftPurchase
                const purchaseAction = event.actions.find(a => a.type === 'NftPurchase' && a.NftPurchase);
                if (purchaseAction) {
                    const amountNano = purchaseAction.NftPurchase.amount?.value || "0";
                    const amountTon = Number(amountNano) / 1e9;
                    
                    const date = new Date(event.timestamp * 1000);
                    const dateStr = date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    
                    history.push({
                        type: 'purchase',
                        date: dateStr,
                        timestamp: event.timestamp,
                        price: amountTon
                    });
                    
                    if (estimatedValue === null) {
                        estimatedValue = amountTon;
                    }
                    hasPurchases = true;
                    continue;
                }
                
                // If no purchase, check for transfer
                const transferAction = event.actions.find(a => a.type === 'NftItemTransfer');
                if (transferAction) {
                    const date = new Date(event.timestamp * 1000);
                    const dateStr = date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    
                    history.push({
                        type: 'transfer',
                        date: dateStr,
                        timestamp: event.timestamp,
                        price: null
                    });
                }
            }
        }
        
        return { history, estimatedValue, hasPurchases };
    } catch (error) {
        console.error("Error al obtener historial del NFT", nftAddress, error);
        return { history: [], estimatedValue: null, hasPurchases: false };
    }
}

const TON_API_URL = 'https://tonapi.io/v2';
const TSTON_MASTER = 'EQC98_qAmNEptUtPc7W6xdHh_ZHrBUFpw5Ft_IzNU20QAJav';
const TONSTAKERS_POOL = 'EQCkWxfyhAkim3g2DjKQQg8T5P4g-Q1-K_jErGcDJZ4i-vqR';

async function getTsTonPrice() {
    try {
        const url = `${TON_API_URL}/rates?tokens=${TSTON_MASTER}&currencies=ton`;
        const response = await fetch(url);
        if (!response.ok) return 1.13;
        const data = await response.json();
        if (data.rates && data.rates[TSTON_MASTER] && data.rates[TSTON_MASTER].prices.TON) {
            return data.rates[TSTON_MASTER].prices.TON;
        }
    } catch (e) {
        console.error("Error fetching tsTON price:", e.message);
    }
    return 1.13; // Fallback estimate
}

/**
 * Calcula el APY real de Tonstakers usando el cambio de precio de tsTON/TON
 * en los últimos 30 días reportado directamente por TonAPI.
 * Retorna un objeto: { apy, tonUsd, tsTonRatio }
 */
async function getRealStakingApy() {
    try {
        // 1. Obtener datos de tsTON (precio en TON + cambio 30d)
        const rateRes = await fetch(`${TON_API_URL}/rates?tokens=${TSTON_MASTER}&currencies=ton,usd`);
        const rateData = await rateRes.json();
        const tsTonEntry = rateData?.rates?.[TSTON_MASTER];
        const tsTonRatio = tsTonEntry?.prices?.TON || 1.13;

        // diff_30d viene como "+X.XX%" — lo parseamos
        let apy = 3.8; // fallback razonable si TonAPI no da diff
        const diff30dStr = tsTonEntry?.diff_30d?.TON;
        if (diff30dStr) {
            const pct = parseFloat(diff30dStr.replace('%', ''));
            if (!isNaN(pct) && pct > 0) {
                // Anualizamos: APY = ((1 + pct/100)^(365/30) - 1) * 100
                apy = (Math.pow(1 + pct / 100, 365 / 30) - 1) * 100;
            }
        }

        // 2. Obtener precio TON en USD
        const tonRes = await fetch(`${TON_API_URL}/rates?tokens=ton&currencies=usd`);
        const tonData = await tonRes.json();
        const tonUsd = tonData?.rates?.TON?.prices?.USD || 3.0;

        return { apy: parseFloat(apy.toFixed(2)), tonUsd: parseFloat(tonUsd.toFixed(4)), tsTonRatio: parseFloat(tsTonRatio.toFixed(6)) };
    } catch(e) {
        console.error("Error fetching real staking APY:", e.message);
        return { apy: 3.8, tonUsd: 3.0, tsTonRatio: 1.13 };
    }
}

async function getTsTonBalance(addressStr) {
    try {
        const url = `${TON_API_URL}/accounts/${addressStr}/jettons`;
        const response = await fetch(url);
        if (!response.ok) return "0.0000";
        const data = await response.json();
        
        if (data.balances) {
            const tsTonTarget = Address.parse(TSTON_MASTER).toString({ testOnly: false, bounceable: true });
            const tsTon = data.balances.find(b => {
                try {
                    return Address.parse(b.jetton.address).toString({ testOnly: false, bounceable: true }) === tsTonTarget;
                } catch(e) { return false; }
            });
            
            if (tsTon) {
                return (Number(tsTon.balance) / 1e9).toFixed(4); // tsTON has 9 decimals
            }
        }
    } catch (e) {
        console.error("Error fetching tsTON balance:", e.message);
    }
    return "0.0000";
}

async function stakeTon(encryptedPrivateKey, amountNano) {
    // Tonstakers requires 1.0 TON extra to cover internal gas fees.
    // It subtracts 1.0 TON from msg_value for gas, stakes the rest, and refunds the unused gas.
    const GAS_NANO = 1000000000n; // 1.0 TON extra for contract gas
    const stakeNano = BigInt(amountNano);
    const totalNano = stakeNano + GAS_NANO;

    const body = beginCell()
        .storeUint(0x47d54391, 32) // deposit opcode
        .storeUint(0, 64)          // query_id
        .endCell();

    return await sendTon(encryptedPrivateKey, TONSTAKERS_POOL, totalNano.toString(), body, true);
}

async function getStakingHistory(addressStr) {
    try {
        const url = `${TON_API_URL}/accounts/${addressStr}/events?limit=50`;
        const response = await fetch(url);
        if (!response.ok) return [];
        const data = await response.json();
        
        const history = [];
        
        // Helper to normalize address for comparison
        function normalizeAddr(addr) {
            try { return Address.parse(addr).toRawString(); } catch(e) { return addr; }
        }
        
        const tsTonRaw = normalizeAddr(TSTON_MASTER);
        const poolRaw   = normalizeAddr(TONSTAKERS_POOL);
        const walletRaw = normalizeAddr(addressStr);

        if (data.events) {
            for (const event of data.events) {
                let added = false;
                for (const action of event.actions) {
                    if (added) break;

                    // 1) Depósito exitoso: Tonstakers te acuña/minta tsTON → JettonMint
                    if (action.type === 'JettonMint' && action.JettonMint) {
                        try {
                            const jettonRaw    = normalizeAddr(action.JettonMint.jetton?.address || '');
                            const recipientRaw = action.JettonMint.recipient?.address ? normalizeAddr(action.JettonMint.recipient.address) : '';
                            const amountTsTon  = Number(action.JettonMint.amount) / 1e9;

                            if (jettonRaw === tsTonRaw && recipientRaw === walletRaw) {
                                history.push({ type: 'deposit', amount: amountTsTon.toFixed(4) + ' tsTON', timestamp: event.timestamp });
                                added = true;
                            }
                        } catch(e) {}
                    }

                    // 2) Recibir tsTON vía JettonTransfer normal (por si acaso)
                    if (!added && action.type === 'JettonTransfer' && action.JettonTransfer) {
                        try {
                            const jettonRaw    = normalizeAddr(action.JettonTransfer.jetton.address);
                            const senderRaw    = action.JettonTransfer.sender?.address    ? normalizeAddr(action.JettonTransfer.sender.address)    : '';
                            const recipientRaw = action.JettonTransfer.recipient?.address ? normalizeAddr(action.JettonTransfer.recipient.address) : '';
                            const amountTsTon  = Number(action.JettonTransfer.amount) / 1e9;

                            if (jettonRaw === tsTonRaw) {
                                if (recipientRaw === walletRaw) {
                                    history.push({ type: 'deposit', amount: amountTsTon.toFixed(4) + ' tsTON', timestamp: event.timestamp });
                                    added = true;
                                } else if (senderRaw === walletRaw) {
                                    history.push({ type: 'withdraw', amount: amountTsTon.toFixed(4) + ' tsTON', timestamp: event.timestamp });
                                    added = true;
                                }
                            }
                        } catch(e) {}
                    }

                    // 3) Envío de GRAM desde la wallet (hacia cualquier contrato) = inversión enviada
                    if (!added && action.type === 'TonTransfer' && action.TonTransfer) {
                        try {
                            const senderRaw = action.TonTransfer.sender?.address ? normalizeAddr(action.TonTransfer.sender.address) : '';
                            if (senderRaw === walletRaw) {
                                const amountTon = Number(action.TonTransfer.amount) / 1e9;
                                if (amountTon >= 1) {
                                    history.push({ type: 'sent', amount: amountTon.toFixed(2) + ' GRAM', timestamp: event.timestamp });
                                    added = true;
                                }
                            }
                        } catch(e) {}
                    }
                }
            }
        }
        
        return history.sort((a, b) => b.timestamp - a.timestamp);
    } catch (e) {
        console.error("Error fetching staking history:", e.message);
        return [];
    }
}

module.exports = { generateWallet, importWallet, getBalance, sendTon, getNfts, getNftHistoryAndValue, getTsTonPrice, getTsTonBalance, stakeTon, getStakingHistory, getRealStakingApy };
