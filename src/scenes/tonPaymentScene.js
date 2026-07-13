/**
 * tonPaymentScene.js
 *
 * Escena de confirmación de pago vía TonConnect.
 * Flujo: Resumen → PIN (3 intentos, 4 dígitos) → Firma real → Respuesta al bridge
 */

const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { hashData } = require('../services/cryptoService');
const { sendTon } = require('../services/tonService');
const { sendBridgeResponse } = require('../utils/tonConnectUtils');
const { SessionCrypto } = require('@tonconnect/protocol');
const { fromNano } = require('@ton/ton');
const { logSuccess, logError, logInfo } = require('../utils/logger');

const MAX_PIN_ATTEMPTS = 3;

function buildSessionCrypto(keypairData) {
    if (typeof keypairData === 'string' && keypairData.startsWith('{')) {
        return new SessionCrypto(JSON.parse(keypairData));
    }
    return null;
}

const tonPaymentWizard = new Scenes.WizardScene(
    'TON_PAYMENT_SCENE',

    // Paso 0: Mostrar resumen de la transacción
    async (ctx) => {
        const { payKey, walletId, messages, totalFormatted, destinations, keypairJson, senderPublicKey, rpcId, promptId } = ctx.scene.state;

        ctx.scene.session.payKey = payKey;
        ctx.scene.session.walletId = walletId;
        ctx.scene.session.messages = messages;
        ctx.scene.session.totalFormatted = totalFormatted;
        ctx.scene.session.destinations = destinations;
        ctx.scene.session.keypairJson = keypairJson;
        ctx.scene.session.senderPublicKey = senderPublicKey;
        ctx.scene.session.rpcId = rpcId;
        ctx.scene.session.pinAttempts = 0;
        ctx.scene.session.promptId = promptId || ctx.callbackQuery?.message?.message_id;

        if (ctx.callbackQuery) await ctx.answerCbQuery();

        const destSummary = destinations.map((d, i) =>
            `  ${i + 1}. \`${d.to.slice(0, 10)}...${d.to.slice(-8)}\` → *${parseFloat(fromNano(d.amount)).toFixed(4)} GRAM*`
        ).join('\n');

        const text =
            `💳 *Confirmar Pago*\n\n` +
            `💰 *Total a enviar:* \`${totalFormatted} GRAM\`\n` +
            `📍 *Destino(s):*\n${destSummary}\n\n` +
            `⚠️ _Esta acción es irreversible. Asegúrate de que el monto y destino son correctos._\n\n` +
            `Para autorizar, ingresa tu *PIN de 4 dígitos*:`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancelar pago', 'tc_pay_cancel')]
        ]);

        // Editar el mensaje de la notificación original
        try {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        } catch(e) {
            const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
            ctx.scene.session.promptId = msg.message_id;
        }

        return ctx.wizard.next();
    },

    // Paso 1: Recibir PIN, validar, ejecutar
    async (ctx) => {
        const keyboard = Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar pago', 'tc_pay_cancel')]]);

        // Botón cancelar
        if (ctx.callbackQuery?.data === 'tc_pay_cancel') {
            await ctx.answerCbQuery('❌ Pago cancelado.');
            await rejectPayment(ctx, 'USER_CANCELLED');
            await ctx.editMessageText('❌ Pago cancelado. La DApp ha sido notificada.').catch(() => {});
            return ctx.scene.leave();
        }

        if (!ctx.message?.text) return;

        const pin = ctx.message.text.trim();
        // Borrar el mensaje del PIN para seguridad
        await ctx.deleteMessage(ctx.message.message_id).catch(() => {});

        // Validar formato
        if (!/^\d{4}$/.test(pin)) {
            ctx.scene.session.pinAttempts++;
            const remaining = MAX_PIN_ATTEMPTS - ctx.scene.session.pinAttempts;
            if (remaining <= 0) {
                await rejectPayment(ctx, 'TOO_MANY_ATTEMPTS');
                await ctx.telegram.editMessageText(
                    ctx.chat.id, ctx.scene.session.promptId || ctx.callbackQuery?.message?.message_id, null,
                    '🔒 *Demasiados intentos fallidos.*\n\nEl pago fue cancelado por seguridad.',
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
                return ctx.scene.leave();
            }
            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.promptId || ctx.message?.message_id, null,
                `❌ PIN inválido. Debe ser de exactamente 4 dígitos.\n\n🔒 _Intentos restantes: ${remaining}_\n\nIngresa tu PIN:`,
                { parse_mode: 'Markdown', ...keyboard }
            ).catch(() => {});
            return;
        }

        // Verificar PIN contra el hash del usuario
        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(ctx.from.id) }
        });

        if (user?.recoveryPinHash && hashData(pin) !== user.recoveryPinHash) {
            ctx.scene.session.pinAttempts++;
            const remaining = MAX_PIN_ATTEMPTS - ctx.scene.session.pinAttempts;
            if (remaining <= 0) {
                await rejectPayment(ctx, 'TOO_MANY_ATTEMPTS');
                logInfo('TC_PAY_PIN_BLOCKED', { user: ctx.from?.username, note: 'Demasiados intentos de PIN' });
                await ctx.telegram.editMessageText(
                    ctx.chat.id, ctx.scene.session.promptId, null,
                    '🔒 *Demasiados intentos fallidos.*\n\nEl pago fue cancelado automáticamente por seguridad. La DApp ha sido notificada.',
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
                return ctx.scene.leave();
            }
            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.promptId, null,
                `❌ *PIN incorrecto.*\n\n🔒 _Intentos restantes: ${remaining} de ${MAX_PIN_ATTEMPTS}_\n\nIngresa tu PIN de 4 dígitos:`,
                { parse_mode: 'Markdown', ...keyboard }
            ).catch(() => {});
            return;
        }

        // ✅ PIN correcto — ejecutar la transacción
        await executePayment(ctx);
    }
);

async function rejectPayment(ctx, reason = 'USER_REJECTED') {
    const { keypairJson, senderPublicKey, rpcId } = ctx.scene.session;
    try {
        const sc = buildSessionCrypto(keypairJson);
        if (sc) {
            await sendBridgeResponse(sc, senderPublicKey, rpcId, reason, true);
        }
    } catch(e) {
        logError('TC_BRIDGE_REJECT', e, { reason });
    }
    // Limpiar del mapa de pendientes
    const { pendingPayments } = require('../services/tonConnectListener');
    pendingPayments.delete(ctx.scene.session.payKey);
}

async function executePayment(ctx) {
    const { walletId, messages, totalFormatted, keypairJson, senderPublicKey, rpcId, payKey } = ctx.scene.session;
    const promptId = ctx.scene.session.promptId;

    // Mostrar "procesando"
    await ctx.telegram.editMessageText(
        ctx.chat.id, promptId, null,
        '⏳ *Procesando pago...*\n\nFirmando y enviando la transacción a la blockchain. Espera un momento.',
        { parse_mode: 'Markdown' }
    ).catch(() => {});

    try {
        const wallet = await prisma.wallet.findUnique({
            where: { id: walletId },
            include: { user: true }
        });

        if (!wallet) throw new Error('Wallet no encontrada');

        // Ejecutar cada mensaje (normalmente es 1 para una compra en Fragment)
        const results = [];
        for (const msg of messages) {
            const amountNano = msg.amount;
            const toAddress = msg.address;
            const memo = msg.payload ? 'Fragment Purchase' : null;

            const result = await sendTon(wallet.encryptedPrivateKey, toAddress, amountNano, memo);
            results.push(result);
        }

        const allSuccess = results.every(r => r.success);

        if (allSuccess) {
            // Responder al bridge de Fragment que fue exitoso
            const sc = buildSessionCrypto(keypairJson);
            if (sc) {
                // TonConnect espera boc (bag of cells) pero para Fragment,
                // un error controlado permite al usuario confirmar desde el explorer
                await sendBridgeResponse(sc, senderPublicKey, rpcId, 'Transaction sent via HeartWallet', true).catch(() => {});
            }

            logSuccess('TC_PAYMENT_EXECUTED', {
                user: ctx.from?.username || ctx.from?.id?.toString(),
                walletId,
                amount: totalFormatted,
                rpcId,
            });

            await ctx.telegram.editMessageText(
                ctx.chat.id, promptId, null,
                `✅ *¡Pago enviado exitosamente!* 💖\n\n` +
                `💰 *Monto:* \`${totalFormatted} GRAM\`\n` +
                `🔗 La transacción fue firmada y enviada a la blockchain.\n\n` +
                `_Puede tardar unos 5-15 segundos en confirmarse._`,
                { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Ir a mi Billetera', `view_wallet_${walletId}`)]]) }
            ).catch(() => {});
        } else {
            const errMsg = results.find(r => !r.success)?.error || 'Error desconocido';
            throw new Error(errMsg);
        }

    } catch(err) {
        logError('TC_PAYMENT_EXEC_ERROR', err, {
            user: ctx.from?.username,
            walletId,
            amount: totalFormatted,
        });

        await rejectPayment(ctx, 'EXECUTION_ERROR').catch(() => {});

        const is429 = err?.message?.includes('429') || err?.status === 429;
        const errText = is429
            ? `⏱️ *Límite de velocidad de la red (429)*\n\nLa API de TON rechazó la transacción por demasiadas peticiones simultáneas. Esto es temporal.\n\n*Espera 10-15 segundos e inténtalo de nuevo.*\n\n_Tip: Añade tu API key de TonCenter al .env como \`TONCENTER_API_KEY\` para evitar este límite._`
            : `❌ *Error al enviar el pago*\n\n_${err.message}_\n\nPosibles causas: saldo insuficiente o error de red. Intenta desde tu billetera.`;

        await ctx.telegram.editMessageText(
            ctx.chat.id, promptId, null,
            errText,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Ir a mi Billetera', `view_wallet_${walletId}`)]]) }
        ).catch(() => {});
    }

    const { pendingPayments } = require('../services/tonConnectListener');
    pendingPayments.delete(payKey);
    return ctx.scene.leave();
}

module.exports = { tonPaymentWizard };
