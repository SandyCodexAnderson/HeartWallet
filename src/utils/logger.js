/**
 * logger.js — Sistema de logs persistente de HeartWallet
 * Escribe en 3 archivos JSON: all.json, errors.json, success.json
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');

// Crear directorio si no existe
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
}
try {
    fs.chmodSync(LOG_DIR, 0o700);
} catch(e) {
    console.error('[Logger] Error ajustando permisos del directorio de logs:', e.message);
}

const FILES = {
    all:     path.join(LOG_DIR, 'all.json'),
    errors:  path.join(LOG_DIR, 'errors.json'),
    success: path.join(LOG_DIR, 'success.json'),
};

const SENSITIVE_KEY_RE = /(token|secret|key|password|passphrase|pin|mnemonic|seed|private|recovery|encryptedprivatekey|walletencryptedkey)/i;
const SENSITIVE_TEXT_RE = /([0-9a-f]{64,}|(?:\b[a-z]+\b[\s,;:._-]+){11,23}\b[a-z]+\b|\b\d{4,8}\b)/i;

function redactValue(key, value) {
    if (SENSITIVE_KEY_RE.test(String(key || ''))) return '[REDACTED]';

    if (typeof value === 'string') {
        return SENSITIVE_TEXT_RE.test(value) ? '[REDACTED]' : value;
    }

    if (Array.isArray(value)) return value.map((item) => redactValue(key, item));

    if (value && typeof value === 'object') {
        const redacted = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            redacted[childKey] = redactValue(childKey, childValue);
        }
        return redacted;
    }

    return value;
}

function redactDetails(details = {}) {
    return redactValue('details', details) || {};
}

// Inicializar archivos si no existen o están vacíos
for (const [key, file] of Object.entries(FILES)) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', { encoding: 'utf8', mode: 0o600 });
    try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.chmodSync(file, 0o600);
    } catch(e) {
        fs.writeFileSync(file, '[]', { encoding: 'utf8', mode: 0o600 });
    }
}

function appendToFile(filePath, entry) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const arr = JSON.parse(raw);
        arr.push(entry);
        // Mantener máximo 5000 entradas por archivo
        if (arr.length > 5000) arr.splice(0, arr.length - 5000);
        fs.writeFileSync(filePath, JSON.stringify(arr, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch(e) {
        // Si falla no crashear el bot
        console.error('[Logger] Error escribiendo log:', e.message);
    }
}

function buildEntry(level, action, details = {}) {
    return {
        timestamp: new Date().toISOString(),
        level,
        action,
        ...redactDetails(details),
    };
}

/**
 * Registra un evento exitoso
 * @param {string} action - Nombre de la acción (ej: 'WALLET_VIEW', 'DEPOSIT_RECEIVED')
 * @param {object} details - Detalles adicionales (userId, walletId, amount, etc.)
 */
function logSuccess(action, details = {}) {
    const entry = buildEntry('SUCCESS', action, details);
    const label = `[✅ ${action}]` + (details.user ? ` @${details.user}` : '') + (details.amount ? ` ${details.amount}` : '');
    console.log(label);
    appendToFile(FILES.all, entry);
    appendToFile(FILES.success, entry);
}

/**
 * Registra un error
 * @param {string} action - Nombre de la acción donde ocurrió el error
 * @param {Error|string} err - El error
 * @param {object} details - Detalles adicionales
 */
function logError(action, err, details = {}) {
    const entry = buildEntry('ERROR', action, {
        ...details,
        errorMessage: err?.message || String(err),
        errorStack: err?.stack?.slice(0, 500),
    });
    console.error(`[❌ ${action}]` + (details.user ? ` @${details.user}` : ''), err?.message || err);
    appendToFile(FILES.all, entry);
    appendToFile(FILES.errors, entry);
}

/**
 * Registra un evento informativo (no va a errors ni success, solo a all)
 */
function logInfo(action, details = {}) {
    const entry = buildEntry('INFO', action, details);
    console.log(`[ℹ️  ${action}]` + (details.user ? ` @${details.user}` : '') + (details.note ? ` ${details.note}` : ''));
    appendToFile(FILES.all, entry);
}

/**
 * Middleware para Telegraf: loguea toda acción de usuario
 */
function telegramLogMiddleware() {
    return async (ctx, next) => {
        const user = ctx.from?.username || ctx.from?.first_name || 'unknown';
        const userId = ctx.from?.id;
        const action = ctx.callbackQuery?.data
            || (ctx.message?.text ? '[text-message]' : null)
            || ctx.updateType;

        logInfo('TELEGRAM_UPDATE', {
            user,
            userId,
            action: String(action).slice(0, 80),
            updateType: ctx.updateType,
            chatId: ctx.chat?.id,
        });

        const start = Date.now();
        try {
            await next();
            const ms = Date.now() - start;
            if (ms > 2000) {
                logInfo('SLOW_RESPONSE', { user, userId, action: String(action).slice(0, 80), ms });
            }
        } catch(err) {
            // No lanzar errores de API de Telegram conocidos que no son fatales (ej. message not modified)
            const isIgnorable = err.description && (
                err.description.includes('message is not modified') ||
                err.description.includes('query is too old') ||
                err.description.includes('message to edit not found')
            );

            if (!isIgnorable) {
                logError('TELEGRAM_HANDLER_ERROR', err, { user, userId, action: String(action).slice(0, 80) });
                // Solo propagamos si es un error fatal de la app (ej. Prisma, etc.)
                // Los errores de Telegraf (400) a menudo causan crashes innecesarios.
                if (!err.response) {
                    throw err; 
                }
            }
        }
    };
}

module.exports = { logSuccess, logError, logInfo, telegramLogMiddleware, LOG_DIR, __redactDetails: redactDetails };
