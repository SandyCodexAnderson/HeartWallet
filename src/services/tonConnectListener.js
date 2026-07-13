/**
 * tonConnectListener.js
 * Listener SSE para TON Connect. Recibe solicitudes de pago de DApps (Fragment, etc.)
 * y notifica al usuario en el bot para aprobar o rechazar.
 *
 * FIX: Fragment re-envía sendTransaction si no recibe respuesta. 
 * → Deduplicamos por rpcId y respondemos inmediatamente con "pending" para
 *   evitar el bucle de re-envíos que bloquea el event loop.
 */

const { EventSource } = require('eventsource');
const { prisma } = require('../db/prisma');
const { sendBridgeResponse } = require('../utils/tonConnectUtils');
const { fromNano } = require('@ton/ton');
const { SessionCrypto } = require('@tonconnect/protocol');
const { logSuccess, logError, logInfo } = require('../utils/logger');

// walletId → EventSource activo
const activeSessions = new Map();

// payKey → datos del pago pendiente de aprobación por el usuario
const pendingPayments = new Map();

// Set de rpcIds ya procesados (deduplicación, evita re-envíos de Fragment)
// walletId → Set de rpcIds procesados recientemente
const processedRpcIds = new Map();

function markRpcProcessed(walletId, rpcId) {
    if (!processedRpcIds.has(walletId)) processedRpcIds.set(walletId, new Set());
    const set = processedRpcIds.get(walletId);
    set.add(String(rpcId));
    // Limpiar IDs antiguos si hay más de 100
    if (set.size > 100) {
        const [first] = set;
        set.delete(first);
    }
}

function isRpcProcessed(walletId, rpcId) {
    return processedRpcIds.get(walletId)?.has(String(rpcId)) ?? false;
}

function buildSessionCrypto(keypairData) {
    if (typeof keypairData === 'string' && keypairData.startsWith('{')) {
        return new SessionCrypto(JSON.parse(keypairData));
    }
    if (typeof keypairData === 'string') {
        logInfo('TC_SESSION_OLD_FORMAT', { note: 'El usuario debe reconectar la wallet.' });
        return null;
    }
    return new SessionCrypto(keypairData);
}

async function startListeningForWallet(wallet, bot) {
    // Cerrar conexión previa si existe
    if (activeSessions.has(wallet.id)) {
        try { activeSessions.get(wallet.id).close(); } catch(e) {}
        activeSessions.delete(wallet.id);
    }

    if (!wallet.tcSessionKey || !wallet.tcClientId) return;

    let sc;
    try {
        sc = buildSessionCrypto(wallet.tcSessionKey);
    } catch(e) {
        logError('TC_BUILD_SESSION', e, { walletId: wallet.id, walletName: wallet.name });
        return;
    }

    if (!sc) return;

    const sessionId = sc.sessionId;
    const storedClientId = wallet.tcClientId;

    logInfo('TC_SSE_START', {
        walletId: wallet.id,
        walletName: wallet.name,
        sessionId: sessionId.slice(0, 16) + '...',
    });

    const sseUrl = `https://bridge.tonapi.io/bridge/events?client_id=${sessionId}`;
    const es = new EventSource(sseUrl);

    es.onmessage = async (event) => {
        // Procesar en siguiente tick para no bloquear el event loop
        setImmediate(async () => {
            try {
                const rawData = JSON.parse(event.data);
                const senderPublicKey = rawData.from || storedClientId;

                let decryptedStr;
                try {
                    decryptedStr = sc.decrypt(
                        Buffer.from(rawData.message, 'base64'),
                        Buffer.from(senderPublicKey, 'hex')
                    );
                } catch(decErr) {
                    logError('TC_DECRYPT_FAIL', decErr, { walletId: wallet.id });
                    return;
                }

                const msg = JSON.parse(decryptedStr);

                if (msg.method === 'sendTransaction') {
                    const rpcId = msg.id;

                    // ── DEDUPLICACIÓN ──────────────────────────────────────────
                    // Fragment reenvía el mismo request si no recibe ack.
                    // Si ya lo procesamos, ignorar silenciosamente.
                    if (isRpcProcessed(wallet.id, rpcId)) {
                        return;
                    }
                    markRpcProcessed(wallet.id, rpcId);
                    // ──────────────────────────────────────────────────────────

                    logInfo('TC_SEND_TX_REQUEST', {
                        walletId: wallet.id,
                        walletName: wallet.name,
                        user: wallet.user?.telegramId?.toString(),
                        rpcId,
                    });

                    const params = JSON.parse(msg.params[0]);
                    const messages = params.messages || [];

                    let totalNano = 0n;
                    const destinations = [];
                    for (const m of messages) {
                        const amountBigInt = BigInt(m.amount || 0);
                        totalNano += amountBigInt;
                        destinations.push({ to: m.address, amount: m.amount });
                    }

                    const totalFormatted = parseFloat(fromNano(totalNano.toString())).toFixed(4);
                    const destSummary = destinations.map((d, i) =>
                        `  ${i + 1}. \`${d.to.slice(0, 8)}...${d.to.slice(-8)}\` → *${parseFloat(fromNano(d.amount)).toFixed(4)} GRAM*`
                    ).join('\n');

                    const payKey = `${wallet.userId}_${rpcId}`;
                    pendingPayments.set(payKey, {
                        walletId: wallet.id,
                        messages,
                        keypairJson: wallet.tcSessionKey,
                        senderPublicKey,
                        rpcId,
                        totalFormatted,
                    });

                    const text =
                        `💳 *¡Solicitud de Pago!*\n\n` +
                        `La DApp conectada a *${wallet.name}* solicita enviar fondos:\n\n` +
                        `💰 *Total:* \`${totalFormatted} GRAM\`\n` +
                        `📍 *Destino:*\n${destSummary}\n\n` +
                        `¿Confirmas esta transacción?`;

                    const { Markup } = require('telegraf');
                    try {
                        await bot.telegram.sendMessage(
                            Number(wallet.user.telegramId),
                            text,
                            {
                                parse_mode: 'Markdown',
                                ...Markup.inlineKeyboard([
                                    [Markup.button.callback('✅ Aprobar y Firmar', `tc_approve_${payKey}`)],
                                    [Markup.button.callback('❌ Rechazar', `tc_reject_${payKey}`)]
                                ])
                            }
                        );
                        logSuccess('TC_NOTIFICATION_SENT', {
                            walletId: wallet.id,
                            user: wallet.user?.telegramId?.toString(),
                            amount: totalFormatted,
                            rpcId,
                        });
                    } catch(sendErr) {
                        logError('TC_NOTIFICATION_FAIL', sendErr, {
                            walletId: wallet.id,
                            userId: wallet.user?.telegramId?.toString(),
                        });
                    }
                }
            } catch(e) {
                logError('TC_SSE_EVENT_ERROR', e, { walletId: wallet.id });
            }
        });
    };

    es.onerror = () => {
        logInfo('TC_SSE_RECONNECT', { walletId: wallet.id, walletName: wallet.name, note: 'Reconectando en 20s...' });
        activeSessions.delete(wallet.id);
        setTimeout(() => {
            prisma.wallet.findUnique({ where: { id: wallet.id }, include: { user: true } })
                .then(w => { if (w && w.tcSessionKey) startListeningForWallet(w, bot); })
                .catch(e => logError('TC_SSE_RECONNECT_DB', e, { walletId: wallet.id }));
        }, 20000);
    };

    activeSessions.set(wallet.id, es);
}

async function startTonConnectListener(bot) {
    logInfo('TC_LISTENER_START', { note: 'Iniciando SSE Listener para billeteras conectadas...' });

    const wallets = await prisma.wallet.findMany({
        where: { tcSessionKey: { not: null } },
        include: { user: true }
    });

    logInfo('TC_LISTENER_WALLETS', { count: wallets.length, note: `${wallets.length} billetera(s) con sesión activa.` });

    for (const wallet of wallets) {
        await startListeningForWallet(wallet, bot);
        await new Promise(r => setTimeout(r, 300));
    }
}

function registerTonConnectPaymentHandlers(bot) {
    bot.action(/^tc_approve_(.+)$/, async (ctx) => {
        const payKey = ctx.match[1];
        const pending = pendingPayments.get(payKey);
        if (!pending) return ctx.answerCbQuery('Esta solicitud ya expiró o fue procesada.', { show_alert: true });

        await ctx.answerCbQuery('🔐 Iniciando verificación...');

        const wallet = await require('../db/prisma').prisma.wallet.findUnique({
            where: { id: pending.walletId },
            include: { user: true }
        }).catch(() => null);

        if (!wallet) return ctx.editMessageText('❌ No se encontró la billetera.').catch(() => {});

        // Calcular destinos para mostrar en resumen
        const { fromNano } = require('@ton/ton');
        const destinations = pending.messages.map(m => ({ to: m.address, amount: m.amount }));

        // Guardar el promptId del mensaje actual para que la escena lo edite
        const state = {
            payKey,
            walletId: pending.walletId,
            messages: pending.messages,
            totalFormatted: pending.totalFormatted,
            destinations,
            keypairJson: pending.keypairJson,
            senderPublicKey: pending.senderPublicKey,
            rpcId: pending.rpcId,
            promptId: ctx.callbackQuery?.message?.message_id,
        };

        logInfo('TC_APPROVE_INITIATED', {
            user: ctx.from?.username || ctx.from?.id?.toString(),
            walletId: pending.walletId,
            amount: pending.totalFormatted,
        });

        // Entrar a la escena de pago con PIN
        await ctx.scene.enter('TON_PAYMENT_SCENE', state);
    });

    bot.action(/^tc_reject_(.+)$/, async (ctx) => {
        const payKey = ctx.match[1];
        const pending = pendingPayments.get(payKey);
        if (!pending) return ctx.answerCbQuery('Esta solicitud ya expiró.', { show_alert: true });

        const sc = buildSessionCrypto(pending.keypairJson);
        if (sc) {
            await sendBridgeResponse(sc, pending.senderPublicKey, pending.rpcId, 'User rejected the request', true).catch(() => {});
        }

        logInfo('TC_PAYMENT_REJECTED', {
            user: ctx.from?.username || ctx.from?.id?.toString(),
            payKey,
            amount: pending.totalFormatted,
        });

        pendingPayments.delete(payKey);
        await ctx.answerCbQuery('❌ Pago rechazado.');
        await ctx.editMessageText('❌ Solicitud de pago rechazada. La DApp ha sido notificada.');
    });
}

module.exports = { startTonConnectListener, registerTonConnectPaymentHandlers, startListeningForWallet, pendingPayments };
