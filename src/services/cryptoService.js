const crypto = require('crypto');
const { config } = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const ENCRYPTION_PBKDF2_ITERATIONS = 100000;
const HASH_PBKDF2_ITERATIONS = 310000;
const RECOVERY_LOOKUP_PREFIX = 'lookup-v1:';
const MASTER_KEY_MIN_PASSPHRASE_LENGTH = 32;

function timingSafeStringEqual(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function getMasterKeyBuffer() {
    const rawKey = String(config.masterKey || '').trim();
    if (!rawKey) throw new Error('MASTER_KEY is not defined in .env');

    // Preferred production form: 32 random bytes encoded as 64 hex characters.
    if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
        return Buffer.from(rawKey, 'hex');
    }

    // Backward-compatible passphrase mode, but reject short/operator-name secrets.
    if (rawKey.length < MASTER_KEY_MIN_PASSPHRASE_LENGTH) {
        throw new Error('MASTER_KEY must be a 64-character hex secret or a random passphrase of at least 32 characters.');
    }

    return crypto.createHash('sha256').update(rawKey, 'utf8').digest();
}

function encryptPrivateKey(privateKeyHex) {
    const masterKeyBuf = getMasterKeyBuffer();

    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = crypto.pbkdf2Sync(masterKeyBuf, salt, ENCRYPTION_PBKDF2_ITERATIONS, 32, 'sha512');

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(privateKeyHex, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${salt.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function decryptPrivateKey(encryptedData) {
    const masterKeyBuf = getMasterKeyBuffer();
    const parts = String(encryptedData || '').split(':');

    if (parts.length !== 4) {
        throw new Error('Invalid encrypted data format.');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const salt = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encryptedText = parts[3];

    const key = crypto.pbkdf2Sync(masterKeyBuf, salt, ENCRYPTION_PBKDF2_ITERATIONS, 32, 'sha512');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

function legacyHashData(data) {
    return crypto.createHash('sha256').update(String(data), 'utf8').digest('hex');
}

function normalizeRecoveryWords(words) {
    return String(words || '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

function recoveryLookupHash(words) {
    const hmac = crypto.createHmac('sha256', getMasterKeyBuffer());
    hmac.update(normalizeRecoveryWords(words), 'utf8');
    return `${RECOVERY_LOOKUP_PREFIX}${hmac.digest('hex')}`;
}

function hashData(data) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const derived = crypto.pbkdf2Sync(String(data), salt, HASH_PBKDF2_ITERATIONS, 32, 'sha512');
    return `pbkdf2-sha512:${HASH_PBKDF2_ITERATIONS}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

function verifyHash(data, storedHash) {
    if (!storedHash) return false;
    const hash = String(storedHash);

    if (!hash.startsWith('pbkdf2-sha512:')) {
        return timingSafeStringEqual(legacyHashData(data), hash);
    }

    const parts = hash.split(':');
    if (parts.length !== 4) return false;

    const iterations = Number.parseInt(parts[1], 10);
    if (!Number.isSafeInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;

    const salt = Buffer.from(parts[2], 'hex');
    const expected = Buffer.from(parts[3], 'hex');
    if (salt.length < 16 || expected.length !== 32) return false;

    const actual = crypto.pbkdf2Sync(String(data), salt, iterations, expected.length, 'sha512');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = {
    encryptPrivateKey,
    decryptPrivateKey,
    hashData,
    verifyHash,
    legacyHashData,
    normalizeRecoveryWords,
    recoveryLookupHash,
    getMasterKeyBuffer,
    encryptData: encryptPrivateKey,
    decryptData: decryptPrivateKey,
};
