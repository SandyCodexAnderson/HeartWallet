const crypto = require('crypto');
const nacl = require('tweetnacl');
const { WalletContractV4, beginCell, storeStateInit, Address } = require('@ton/ton');
const { SessionCrypto } = require('@tonconnect/protocol');
const { config } = require('../config/env');

function generateTonProofSignature(privateKeyBuf, workchain, addressHashBuffer, domain, timestamp, payload) {
    const prefix = Buffer.from('ton-proof-item-v2/');
    const wcBuf = Buffer.alloc(4);
    wcBuf.writeInt32BE(workchain, 0);

    const domainBuf = Buffer.from(domain, 'utf8');
    const domainLenBuf = Buffer.alloc(4);
    domainLenBuf.writeUInt32LE(domainBuf.length, 0);

    const tsBuf = Buffer.alloc(8);
    tsBuf.writeBigUInt64LE(BigInt(timestamp), 0);

    const payloadBuf = Buffer.from(payload, 'utf8');

    const message = Buffer.concat([
        prefix, wcBuf, addressHashBuffer,
        domainLenBuf, domainBuf, tsBuf, payloadBuf
    ]);

    const messageHash = crypto.createHash('sha256').update(message).digest();
    const signPrefix = Buffer.from([0xff, 0xff]);
    const signContext = Buffer.from('ton-connect', 'utf8');
    const signPayload = Buffer.concat([signPrefix, signContext, messageHash]);
    const signHash = crypto.createHash('sha256').update(signPayload).digest();
    const signature = nacl.sign.detached(signHash, privateKeyBuf);
    return Buffer.from(signature).toString('base64');
}

async function connectToBridge(clientId, requestPayloadJsonStr, walletPrivateKeyHex) {
    const secretKey = Buffer.from(walletPrivateKeyHex, 'hex');
    const publicKey = secretKey.subarray(32, 64);

    const walletContract = WalletContractV4.create({ workchain: 0, publicKey });
    const addressStr = walletContract.address.toString({ testOnly: false });
    const addr = Address.parse(addressStr);

    const stateInitCell = beginCell().store(storeStateInit(walletContract.init)).endCell();
    const stateInitBase64 = stateInitCell.toBoc().toString('base64');

    let r;
    try {
        r = JSON.parse(requestPayloadJsonStr);
    } catch(e) {
        try {
            r = JSON.parse(decodeURIComponent(requestPayloadJsonStr));
        } catch(e2) {
            console.error("TonConnect: No se pudo parsear el payload de conexión.");
            r = { items: [] };
        }
    }

    const items = [];

    const addrReq = r.items?.find(i => i.name === 'ton_addr');
    if (addrReq) {
        items.push({
            name: "ton_addr",
            address: addr.toRawString(),
            network: config.tonNetwork === 'mainnet' ? "-239" : "-3",
            publicKey: publicKey.toString('hex'),
            walletStateInit: stateInitBase64
        });
    }

    const proofReq = r.items?.find(i => i.name === 'ton_proof');
    if (proofReq && proofReq.payload) {
        let domain = "unknown";
        if (r.manifestUrl) {
            try { domain = new URL(r.manifestUrl).hostname; } catch(e) {}
        }
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = generateTonProofSignature(secretKey, addr.workChain, addr.hash, domain, timestamp, proofReq.payload);
        items.push({
            name: "ton_proof",
            proof: {
                timestamp,
                domain: { lengthBytes: Buffer.byteLength(domain, 'utf8'), value: domain },
                signature,
                payload: proofReq.payload
            }
        });
    }

    const sessionCrypto = new SessionCrypto();

    const event = {
        event: "connect",
        id: Date.now(),
        payload: {
            items,
            device: {
                platform: "iphone",
                appName: "tonkeeper",
                appVersion: "2.8.0",
                maxProtocolVersion: 2,
                features: ["SendTransaction"]
            }
        }
    };

    const encrypted = sessionCrypto.encrypt(JSON.stringify(event), Buffer.from(clientId, 'hex'));
    const base64Encrypted = Buffer.from(encrypted).toString('base64');

    const bridgeUrl = 'https://bridge.tonapi.io/bridge/message';
    const postUrl = `${bridgeUrl}?client_id=${sessionCrypto.sessionId}&to=${clientId}&ttl=300`;
    const res = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: base64Encrypted
    });
    if (!res.ok) console.error(`TonConnect bridge error: ${res.status}`);

    // Devolver el keypair serializado para reconstruir la sesión y escuchar eventos
    return {
        sessionId: sessionCrypto.sessionId,
        keypair: sessionCrypto.stringifyKeypair(),
        clientId
    };
}

/**
 * Envía una respuesta a una solicitud RPC del bridge (aprobación o rechazo de sendTransaction).
 * @param {SessionCrypto} sessionCrypto - Objeto SessionCrypto ya reconstruido
 * @param {string} senderPublicKeyHex - Public key del remitente (dApp)
 * @param {string|number} id - ID del mensaje RPC
 * @param {string} result - Resultado o mensaje de error
 * @param {boolean} isError - Si es true, envía un error al bridge
 */
async function sendBridgeResponse(sessionCrypto, senderPublicKeyHex, id, result, isError = false) {
    const sessionId = sessionCrypto.sessionId;

    const payload = isError
        ? { id: String(id), error: { code: 300, message: result } }
        : { id: String(id), result };

    const encrypted = sessionCrypto.encrypt(JSON.stringify(payload), Buffer.from(senderPublicKeyHex, 'hex'));
    const base64Encrypted = Buffer.from(encrypted).toString('base64');

    const bridgeUrl = 'https://bridge.tonapi.io/bridge/message';
    const postUrl = `${bridgeUrl}?client_id=${sessionId}&to=${senderPublicKeyHex}&ttl=300`;
    await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: base64Encrypted
    });
}

module.exports = { connectToBridge, sendBridgeResponse };
