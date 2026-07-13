const { Scenes, Markup } = require('telegraf');
const { Address, toNano } = require('@ton/ton');
const { sendTon } = require('../services/tonService');
const { prisma } = require('../db/prisma');
const { hashData } = require('../services/cryptoService');
const { config } = require('../config/env');

const sendWizard = new Scenes.WizardScene(
    'SEND_TON_SCENE',
    async (ctx) => {
        // Step 0: Initial Menu
        ctx.scene.session.walletId = ctx.scene.state.walletId || ctx.scene.session.walletId;
        if (ctx.callbackQuery) {
            await ctx.deleteMessage().catch(() => { });
        }

        const buttons = [
            [Markup.button.callback('🚀 Enviar a una Billetera o Usuario', 'send_other')],
            [Markup.button.callback('🎓 ¿Cómo realizar un envío?', 'send_help')],
            [Markup.button.callback('⬅️ Cancelar', 'cancel_scene')]
        ];
        const msg = await ctx.reply("💸 **Transferencia de Fondos**\n\n¿Hacia dónde deseas enviar tus GRAM?", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        ctx.scene.session.promptId = msg.message_id;
        return; // stay in step 0, wait for action
    },
    async (ctx) => {
        // Step 1: Address Input
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);

        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => { });
        if (text === '/cancelar') return cancelScene(ctx);
        if (!text) return; // ignore non-text

        let destinationAddress = text;
        if (text.startsWith('@')) {
            const usernameInput = text.substring(1);
            try {
                const targetUser = await prisma.user.findFirst({ where: { username: usernameInput }, include: { wallets: true } });
                if (!targetUser) {
                    return sendError(ctx, `❌ No se encontró ningún usuario con el username **${text}** en HeartWallet.\nPídele que inicie el bot primero o ingresa una dirección TON normal:`);
                }
                const primaryWallet = targetUser.wallets.find(w => w.isPrimary) || targetUser.wallets[0];
                if (!primaryWallet) {
                    return sendError(ctx, `❌ El usuario **${text}** no tiene ninguna billetera creada. Intenta con otro destino:`);
                }
                destinationAddress = primaryWallet.address;
                ctx.scene.session.destUsername = text;
            } catch (e) {
                console.error("Error buscando usuario:", e);
                return;
            }
        } else {
            try {
                Address.parse(text);
            } catch (e) {
                return sendError(ctx, "❌ Dirección inválida. Inténtalo de nuevo ingresando una dirección válida o un @usuario:");
            }
        }

        ctx.scene.session.destAddress = destinationAddress;

        const memoKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback('⏭ Omitir Memo', 'skip_memo')],
            [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
        ]);
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `📝 **Memo / Destination Tag (Opcional)**\n\nSi envías a un exchange (ej. Binance, Bitso, KuCoin), **generalmente necesitas un Memo** o Tag para que no se pierdan tus fondos.\n\nEscribe el Memo en un mensaje, o presiona "Omitir" si envías a una billetera personal:`, { parse_mode: 'Markdown', ...memoKeyboard });

        return ctx.wizard.next(); // Go to Step 2 (Memo)
    },
    async (ctx) => {
        // Step 2: Memo Input
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);

        let memo = null;
        if (ctx.callbackQuery?.data === 'skip_memo') {
            await ctx.answerCbQuery();
            memo = '';
        } else if (ctx.message?.text) {
            memo = ctx.message.text.trim();
            if (memo === '/cancelar') return cancelScene(ctx);
            await ctx.deleteMessage(ctx.message.message_id).catch(() => { });
        } else {
            return;
        }

        ctx.scene.session.memo = memo;

        const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "💎 ¿Cuántos TON deseas enviar? (ej. 1.5):", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });

        return ctx.wizard.next(); // Go to Step 3 (Amount)
    },
    async (ctx) => {
        // Step 3: Amount Input
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);

        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => { });
        if (text === '/cancelar') return cancelScene(ctx);
        if (!text) return;

        const amount = parseFloat(text.replace(',', '.'));
        if (isNaN(amount) || amount <= 0) {
            return sendError(ctx, "❌ Por favor ingresa un número válido mayor a 0 (ej. 1.5):");
        }

        // Validar saldo para cubrir monto + comisiones de red
        const { prisma } = require('../db/prisma');
        const { getBalance } = require('../services/tonService');
        const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) }, include: { wallets: true } });
        const wallet = user.wallets.find(w => w.isPrimary) || user.wallets[0];
        
        const balanceNano = await getBalance(wallet.address);
        const balanceTon = Number(balanceNano) / 1e9;
        const feeBuffer = 0.03; // Margen para comisiones de red y activación de contrato
        
        if (amount + feeBuffer > balanceTon) {
            const maxAvailable = Math.max(0, balanceTon - feeBuffer).toFixed(2);
            return sendError(ctx, `❌ **Saldo insuficiente.**\nTu balance actual es: **${balanceTon} GRAM**.\n\nDebes dejar un pequeño margen (aprox. ${feeBuffer} GRAM) para pagar las comisiones de la red (Gas).\n\nIntenta ingresar un monto menor (ej. ${maxAvailable}):`);
        }

        ctx.scene.session.amount = amount;

        const confirmKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback('✅ Confirmar Envío', 'confirm_send')],
            [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
        ]);

        const safeUsername = ctx.scene.session.destUsername ? ctx.scene.session.destUsername.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&') : null;
        const destDisplay = safeUsername
            ? `**${safeUsername}** (\`${ctx.scene.session.destAddress}\`)`
            : `\`${ctx.scene.session.destAddress}\``;

        let summaryText = `📋 **Resumen de Envío:**\n\n📍 Destino: ${destDisplay}\n💎 Envío exacto: **${ctx.scene.session.amount} GRAM**\n⛽ Comisión de red: **~0.03 GRAM** (Gas)\n\n💰 **Total estimado a descontar:** **~${(ctx.scene.session.amount + 0.03).toFixed(2)} GRAM**\n`;
        if (ctx.scene.session.memo) {
            summaryText += `📝 Memo: \`${ctx.scene.session.memo}\`\n`;
        }
        summaryText += `\n¿Deseas confirmar la transacción?`;

        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, summaryText, { parse_mode: 'Markdown', ...confirmKeyboard });
        return ctx.wizard.next(); // Go to Step 4 (PIN check trigger)
    },
    async (ctx) => {
        // Step 4: PIN Check Trigger
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);
        if (ctx.callbackQuery?.data === 'confirm_send') {
            await ctx.answerCbQuery();
            const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });

            if (user.recoveryPinHash) {
                ctx.scene.session.expectedPinHash = user.recoveryPinHash;
                const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "🔐 **Verificación de Seguridad**\n\nPor favor, ingresa tu **PIN de 4 dígitos** para autorizar esta transacción:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return ctx.wizard.next(); // Go to Step 5 (PIN validation)
            } else {
                return executeTransaction(ctx);
            }
        }
    },
    async (ctx) => {
        // Step 5: PIN Validation
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);

        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => { });
        if (text === '/cancelar') return cancelScene(ctx);

        if (!text || !/^\d{4}$/.test(text)) {
            return sendError(ctx, "❌ PIN inválido. Debe ser de 4 dígitos. Intenta de nuevo:");
        }

        if (hashData(text) !== ctx.scene.session.expectedPinHash) {
            return sendError(ctx, "❌ **PIN Incorrecto**. Tu transacción ha sido bloqueada. Intenta de nuevo:");
        }

        return showAdStep(ctx);
    }
);

async function cancelScene(ctx) {
    if (ctx.callbackQuery) await ctx.answerCbQuery();
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
}

async function sendError(ctx, msg, showSkip = false) {
    const buttons = [];
    if (showSkip) buttons.push([Markup.button.callback('⏭ Omitir donación', 'donate_skip')]);
    buttons.push([Markup.button.callback('❌ Cancelar', 'cancel_scene')]);
    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function showAdStep(ctx) {
    try {
        // 1. Buscar campañas activas y elegir una al azar
        const activeAds = await prisma.adCampaign.findMany({
            where: { status: 'ACTIVE' }
        });

        if (activeAds.length === 0) {
            // Si no hay anuncios, simplemente esperamos 2 segundos por UX y ejecutamos
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "⏳ Procesando transacción segura en la blockchain...");
            setTimeout(() => executeTransaction(ctx), 2000);
            return;
        }

        const activeAd = activeAds[Math.floor(Math.random() * activeAds.length)];

        // 2. Si hay anuncio, lo mostramos
        const adText = 
            `📢 **Mensaje de nuestro Patrocinador:**\n\n` +
            `_${activeAd.text}_\n\n` +
            `⏳ *Procesando transacción... Por favor espera 5 segundos.*`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url(activeAd.buttonText, activeAd.url)]
        ]);

        if (activeAd.mediaId) {
            // Si tiene imagen/video, borramos el mensaje anterior y mandamos uno nuevo con media
            await ctx.telegram.deleteMessage(ctx.chat.id, ctx.scene.session.promptId).catch(() => {});
            
            let adMsg;
            if (activeAd.mediaType === 'photo') {
                adMsg = await ctx.telegram.sendPhoto(ctx.chat.id, activeAd.mediaId, { caption: adText, parse_mode: 'Markdown', ...keyboard });
            } else {
                adMsg = await ctx.telegram.sendVideo(ctx.chat.id, activeAd.mediaId, { caption: adText, parse_mode: 'Markdown', ...keyboard });
            }
            ctx.scene.session.promptId = adMsg.message_id;
        } else {
            // Si solo es texto, editamos el mensaje actual
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, adText, { parse_mode: 'Markdown', ...keyboard, disable_web_page_preview: true });
        }

        // 3. Registrar la vista
        await prisma.adCampaign.update({
            where: { id: activeAd.id },
            data: { 
                viewsCurrent: { increment: 1 },
                status: (activeAd.viewsCurrent + 1 >= activeAd.viewsTarget) ? 'COMPLETED' : 'ACTIVE'
            }
        });

        // 4. Esperar 5 segundos y ejecutar
        setTimeout(() => executeTransaction(ctx), 5000);

    } catch (e) {
        console.error("Error showing ad:", e);
        // Fallback: si falla, ejecuta normal
        executeTransaction(ctx);
    }
}

// ─── Escape Hatches: comandos que siempre salen de la escena ───────────────
// Estos capturan /start y /cancelar desde CUALQUIER paso de la escena
sendWizard.command('start', async (ctx) => {
    if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
});

sendWizard.command('cancelar', async (ctx) => {
    if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    return cancelScene(ctx);
});
// ───────────────────────────────────────────────────────────────────────────






sendWizard.action('send_other', async (ctx) => {
    const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
    await ctx.editMessageText("💸 Ingresa la **dirección TON** de destino o un **@usuario** de Telegram:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    ctx.wizard.selectStep(1); // Set cursor to Address Input
});

sendWizard.action('send_help', async (ctx) => {
    const buttons = [
        [Markup.button.callback('⬅️ Volver', 'send_back')],
        [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
    ];
    await ctx.editMessageText("🎓 **Guía Rápida de Envíos**\n\nEnviar GRAM desde HeartWallet es instantáneo y seguro.\n\n🔹 **A una Billetera:** Solo necesitas la dirección TON del destinatario (ej. `EQB...`). Pégala cuando el bot te la solicite.\n\n🔹 **A un Usuario:** Si el destinatario ya usa HeartWallet, puedes enviarle fondos escribiendo su `@usuario` de Telegram (ej. `@HeartWalletUser`).\n\n💡 _Nota: HeartWallet no cobra ninguna comisión por transferencia, solo pagas la tarifa mínima de gas de la red TON._", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

sendWizard.action('send_back', async (ctx) => {
    const buttons = [
        [Markup.button.callback('🚀 Enviar a una Billetera o Usuario', 'send_other')],
        [Markup.button.callback('🎓 ¿Cómo realizar un envío?', 'send_help')],
        [Markup.button.callback('⬅️ Cancelar', 'cancel_scene')]
    ];
    await ctx.editMessageText("💸 **Transferencia de Fondos**\n\n¿Hacia dónde deseas enviar tus GRAM?", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

sendWizard.action('cancel_scene', async (ctx) => {
    return cancelScene(ctx);
});

async function executeTransaction(ctx) {
    try {
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "⏳ Procesando transacción segura en la blockchain. Por favor espera unos segundos...");
    } catch (e) {
        await ctx.telegram.deleteMessage(ctx.chat.id, ctx.scene.session.promptId).catch(()=>{});
        const newMsg = await ctx.reply("⏳ Procesando transacción segura en la blockchain. Por favor espera unos segundos...");
        ctx.scene.session.promptId = newMsg.message_id;
    }

    try {
        const walletId = ctx.scene.session.walletId;
        const wallet = await prisma.wallet.findUnique({
            where: { id: walletId },
            include: { user: true }
        });

        if (!wallet || wallet.user.telegramId !== BigInt(ctx.from.id)) {
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ No se encontró tu billetera en la base de datos.");
            return ctx.scene.leave();
        }

        // 1. Send the main transaction
        const nanoAmount = toNano(ctx.scene.session.amount).toString();
        const result = await sendTon(wallet.encryptedPrivateKey, ctx.scene.session.destAddress, nanoAmount, ctx.scene.session.memo);

        const returnButton = [[Markup.button.callback('⬅️ Volver al Menú', 'cancel_scene')]];
        if (result.success) {
            let successMsg = `✅ *¡Envío exitoso!* 💖\n\nSe han enviado *${ctx.scene.session.amount} GRAM* a la dirección destino.\n\n_(La transacción puede tardar unos 5 a 10 segundos en reflejarse en la blockchain)._`;
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, successMsg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(returnButton) });

            // ─── Recibo Digital Verificable ────────────────────────────────────
            try {
                const now = new Date();
                const dateStr = now.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });
                const receiptId = `HW-${Date.now().toString(36).toUpperCase()}`;

                const fromAddr = wallet.address;
                const toAddr = ctx.scene.session.destAddress;
                const destLabel = ctx.scene.session.destUsername ? `${ctx.scene.session.destUsername} (${toAddr})` : toAddr;

                // Link al explorador de bloques (tonviewer.com / tonscan.org)
                const isMainnet = process.env.TON_NETWORK === 'mainnet';
                const explorerBase = isMainnet
                    ? `https://tonviewer.com/${toAddr}`
                    : `https://testnet.tonviewer.com/${toAddr}`;

                const escapeMD = (str) => str ? str.replace(/[_*[\]`]/g, '') : '';

                const receiptMsg =
                    `🧾 *RECIBO DIGITAL HEARTWALLET*\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `🆔 *ID de Recibo:* \`${receiptId}\`\n` +
                    `📅 *Fecha y Hora:* ${dateStr}\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `💸 *Monto Enviado:* \`${ctx.scene.session.amount} GRAM\`\n` +
                    `📤 *Desde:* \`${fromAddr}\`\n` +
                    `📥 *Hacia:* \`${escapeMD(destLabel)}\`\n` +
                    (ctx.scene.session.memo ? `📝 *Memo:* \`${escapeMD(ctx.scene.session.memo)}\`\n` : '') +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `🔗 *Verificar en Blockchain:*\n` +
                    `${explorerBase}\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `_Este recibo es generado automáticamente por HeartWallet. El pago puede verificarse públicamente en la red TON._`;

                await ctx.reply(receiptMsg, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: false
                });
            } catch (receiptErr) {
                console.error('Error generando recibo:', receiptErr.message);
            }
            // ───────────────────────────────────────────────────────────────────

        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `❌ *Error al enviar:* No se pudo completar la transacción.\nMotivo posible: Saldo insuficiente o problema de red.\nDetalle técnico: ${result.error}`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(returnButton) });
        }
    } catch (e) {
        console.error(e);
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Ocurrió un error inesperado al enviar.");
    }
    return ctx.scene.leave();
}

module.exports = { sendWizard };
