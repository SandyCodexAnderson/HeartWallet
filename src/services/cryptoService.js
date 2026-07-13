const crypto = require('crypto');
const { config } = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;

function getMasterKeyBuffer() {
    let rawKey = config.masterKey;
    if (!rawKey) throw new Error("MASTER_KEY is not defined in .env");
    
    // Si ya es un hash hexadecimal de 64 caracteres, úsalo directamente
    if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
        return Buffer.from(rawKey, 'hex');
    }
    // Si es un texto corto como "sandyanderson", conviértelo a 32 bytes de forma determinista
    return crypto.createHash('sha256').update(rawKey).digest();
}

function encryptPrivateKey(privateKeyHex) {
    const masterKeyBuf = getMasterKeyBuffer();

    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);
    
    const key = crypto.pbkdf2Sync(masterKeyBuf, salt, 100000, 32, 'sha512');

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(privateKeyHex, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${salt.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function decryptPrivateKey(encryptedData) {
    const masterKeyBuf = getMasterKeyBuffer();

    const parts = encryptedData.split(':');
    if (parts.length !== 4) {
        throw new Error("Invalid encrypted data format.");
    }

    const iv = Buffer.from(parts[0], 'hex');
    const salt = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encryptedText = parts[3];

    const key = crypto.pbkdf2Sync(masterKeyBuf, salt, 100000, 32, 'sha512');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

function hashData(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function verifyHash(data, hash) {
    return hashData(data) === hash;
}

module.exports = { encryptPrivateKey, decryptPrivateKey, hashData, verifyHash };
