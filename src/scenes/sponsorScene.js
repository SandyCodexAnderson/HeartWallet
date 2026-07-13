const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { hashData } = require('../services/cryptoService');
const { sendTon } = require('../services/tonService');
const { config } = require('../config/env');
const { toNano } = require('@ton/ton');

const SPONSOR_PRICES = {
    500: '5',
    1000: '9',
    5000: '40',
    10000: '75',
    25000: '175',
    50000: '300'
};

const sponsorWizard = new Scenes.WizardScene(
    'SPONSOR_SCENE',
    // Paso 1: Introducción y subir archivo
    async (ctx) => {
        try { await ctx.deleteMessage(); } catch (e) {}

        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(ctx.from.id) },
            include: { wallets: true }
        });

        const primaryWallet = user?.wallets.find(w => w.isPrimary) || user?.wallets[0];
        if (!primaryWallet) {
            await ctx.reply("❌ No tienes ninguna billetera creada para pagar el anuncio.");
            return ctx.scene.leave();
        }
        ctx.scene.session.walletId = primaryWallet.id;

        const msg = await ctx.reply(
            `📢 **HeartWallet Ads (Sponsors)**\n\n` +
            `Crea una campaña publicitaria que verán todos los usuarios de HeartWallet al realizar transferencias (pantalla de carga de 5 segundos).\n\n` +
            `🔹 **Paso 1:** Envía una **Foto** o **Video corto** (máx 15 seg) para tu anuncio.\n\n` +
            `_(O presiona "Omitir Media" si solo quieres texto)_`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('⏭ Omitir Media', 'skip_media')],
                    [Markup.button.callback('⬅️ Cancelar', 'cancel_scene')]
                ])
            }
        );
        ctx.scene.session.lastMsgId = msg.message_id;
        return ctx.wizard.next();
    },

    // Paso 2: Procesar archivo y pedir texto principal
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);
        
        let mediaId = null;
        let mediaType = null;

        if (ctx.callbackQuery?.data === 'skip_media') {
            await ctx.answerCbQuery();
        } else if (ctx.message) {
            if (ctx.message.photo) {
                mediaId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                mediaType = 'photo';
            } else if (ctx.message.video) {
                mediaId = ctx.message.video.file_id;
                mediaType = 'video';
            } else if (ctx.message.text && ctx.message.text.startsWith('/')) {
                return cancelScene(ctx);
            } else {
                return sendPrompt(ctx, "❌ Formato no soportado. Envía una Foto o Video, o presiona Omitir:", [[Markup.button.callback('⏭ Omitir Media', 'skip_media')], [Markup.button.callback('❌ Cancelar', 'cancel_scene')]]);
            }
            try { await ctx.deleteMessage(); } catch(e){}
        } else {
            return;
        }

        ctx.scene.session.mediaId = mediaId;
        ctx.scene.session.mediaType = mediaType;

        return sendPrompt(ctx, "📝 **Paso 2:** Escribe un texto corto para tu anuncio (máx 150 caracteres):\n\n_Ejemplo: ¡Descubre el mejor canal de señales Crypto! Únete hoy._", [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]);
    },

    // Paso 3: Validar texto y pedir botón
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);

        const text = ctx.message?.text?.trim();
        if (!text) return;
        if (text.startsWith('/')) return cancelScene(ctx);
        if (text.length > 150) {
            return sendPrompt(ctx, `❌ El texto es muy largo (${text.length} caracteres). Máximo 150 caracteres.\n\nIntenta de nuevo:`, [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]);
        }
        
        try { await ctx.deleteMessage(); } catch(e){}
        ctx.scene.session.adText = text;

        return sendPrompt(ctx, "🔘 **Paso 3:** Escribe el texto para el botón (máx 20 caracteres):\n\n_Ejemplos: Jugar Ahora, Ver Canal, Abrir Bot, Entrar..._", [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]);
    },

    // Paso 4: Validar botón y pedir URL
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);

        const text = ctx.message?.text?.trim();
        if (!text) return;
        if (text.startsWith('/')) return cancelScene(ctx);
        if (text.length > 20) {
            return sendPrompt(ctx, `❌ El texto del botón es muy largo. Máximo 20 caracteres.\n\nIntenta de nuevo:`, [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]);
        }

        try { await ctx.deleteMessage(); } catch(e){}
        ctx.scene.session.buttonText = text;

        return sendPrompt(ctx, "🔗 **Paso 4:** Envía la URL o enlace hacia donde dirigirá el botón:\n\n_Ejemplo: https://t.me/TuCanal_", [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]);
    },

    // Paso 5: Validar URL y elegir paquete
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);

        const url = ctx.message?.text?.trim();
        if (!url) return;
        if (url.startsWith('/')) return cancelScene(ctx);
        
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return sendPrompt(ctx, "❌ URL inválida. Debe comenzar con http:// o https://\n\nIntenta de nuevo:", [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]);
        }

        try { await ctx.deleteMessage(); } catch(e){}
        ctx.scene.session.url = url;

        const packagesText = 
            `💰 **Paso 5: Elige un paquete**\n\n` +
            `Los anuncios se mostrarán de forma rotativa en la pantalla de carga de transferencias.\n\n` +
            `• **500 Vistas** -> ${SPONSOR_PRICES[500]} GRAM\n` +
            `• **1,000 Vistas** -> ${SPONSOR_PRICES[1000]} GRAM\n` +
            `• **5,000 Vistas** -> ${SPONSOR_PRICES[5000]} GRAM\n` +
            `• **10,000 Vistas** -> ${SPONSOR_PRICES[10000]} GRAM\n` +
            `• **25,000 Vistas** -> ${SPONSOR_PRICES[25000]} GRAM\n` +
            `• **50,000 Vistas** -> ${SPONSOR_PRICES[50000]} GRAM`;

        const keyboard = [
            [Markup.button.callback(`500 Vistas (${SPONSOR_PRICES[500]} GRAM)`, 'pack_500'), Markup.button.callback(`1,000 Vistas (${SPONSOR_PRICES[1000]} GRAM)`, 'pack_1000')],
            [Markup.button.callback(`5,000 Vistas (${SPONSOR_PRICES[5000]} GRAM)`, 'pack_5000'), Markup.button.callback(`10,000 Vistas (${SPONSOR_PRICES[10000]} GRAM)`, 'pack_10000')],
            [Markup.button.callback(`25,000 Vistas (${SPONSOR_PRICES[25000]} GRAM)`, 'pack_25000'), Markup.button.callback(`50,000 Vistas (${SPONSOR_PRICES[50000]} GRAM)`, 'pack_50000')],
            [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
        ];

        return sendPrompt(ctx, packagesText, keyboard);
    },

    // Paso 6: Confirmación y PIN
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);

        const cbData = ctx.callbackQuery?.data;
        if (!cbData || !cbData.startsWith('pack_')) return;
        await ctx.answerCbQuery();

        const views = parseInt(cbData.split('_')[1]);
        const price = SPONSOR_PRICES[views];
        ctx.scene.session.viewsTarget = views;
        ctx.scene.session.pricePaidNano = price; // store as string before Nano

        const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
        ctx.scene.session.expectedPinHash = user.recoveryPinHash;

        const summary = 
            `📋 **Resumen de tu Campaña:**\n\n` +
            `📝 Texto: ${ctx.scene.session.adText}\n` +
            `🔘 Botón: [${ctx.scene.session.buttonText}](${ctx.scene.session.url})\n` +
            `👁️ Vistas a comprar: **${views.toLocaleString('en-US')}**\n` +
            `💎 Costo total: **${price} GRAM**\n\n` +
            `_Tu anuncio pasará por revisión manual y se activará si cumple con los Términos de Servicio. En caso de rechazo, se te devolverá el dinero._\n\n` +
            `🔐 **Ingresa tu PIN de 4 dígitos** para confirmar el pago:`;

        return sendPrompt(ctx, summary, [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]);
    },

    // Paso 7: Validar PIN y Procesar Pago
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);

        const pin = ctx.message?.text?.trim();
        if (!pin) return;
        if (pin.startsWith('/')) return cancelScene(ctx);
        try { await ctx.deleteMessage(); } catch(e){}

        if (hashData(pin) !== ctx.scene.session.expectedPinHash) {
            return sendPrompt(ctx, "❌ **PIN Incorrecto**. Intenta de nuevo:", [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]);
        }

        // Proceed to payment
        await sendPrompt(ctx, "⏳ Procesando pago a la cuenta central de HeartWallet...", []);

        try {
            const wallet = await prisma.wallet.findUnique({ where: { id: ctx.scene.session.walletId } });
            
            // Payment logic: Send to EscrowWallet or Donation address
            // We use escrowWalletAddress as the central bot wallet for collecting ad revenues
            const destinationAddress = config.escrowWalletAddress;
            const nanoAmount = toNano(ctx.scene.session.pricePaidNano).toString();
            
            const txResult = await sendTon(wallet.encryptedPrivateKey, destinationAddress, nanoAmount, 'HeartWallet Ads Payment');

            if (txResult.success) {
                // Crear Campaña en BD
                const campaign = await prisma.adCampaign.create({
                    data: {
                        sponsorId: wallet.userId,
                        title: `Ad - ${ctx.from.username || 'User'}`,
                        text: ctx.scene.session.adText,
                        mediaId: ctx.scene.session.mediaId,
                        mediaType: ctx.scene.session.mediaType,
                        buttonText: ctx.scene.session.buttonText,
                        url: ctx.scene.session.url,
                        viewsTarget: ctx.scene.session.viewsTarget,
                        pricePaidNano: nanoAmount,
                        status: 'PENDING'
                    }
                });

                const successMsg = 
                    `✅ **¡Campaña Pagada con Éxito!** 💖\n\n` +
                    `Tu anuncio está en estado **PENDING** (Pendiente de Revisión).\n` +
                    `ID: \`${campaign.id}\`\n\n` +
                    `Nuestro equipo de moderación lo revisará pronto. Recibirás una notificación cuando se active.`;
                
                await sendPrompt(ctx, successMsg, [[Markup.button.callback('⬅️ Volver al Menú', 'cancel_scene')]]);
                
                // Notificar Administrador
                // Asumiendo que el config o .env tiene el ID del admin o canal
                try {
                    const adminChatId = 1170726712; // Reemplazar con config.adminChatId si existe
                    await ctx.telegram.sendMessage(adminChatId, `⚠️ **Nuevo Anuncio Pendiente**\nUser: @${ctx.from.username}\nCampaña: ${campaign.id}\nVe al panel de admin para aprobar.`);
                } catch(err) { /* ignore */ }

            } else {
                await sendPrompt(ctx, `❌ **Error al procesar el pago:** ${txResult.error}\nAsegúrate de tener saldo suficiente.`, [[Markup.button.callback('⬅️ Volver al Menú', 'cancel_scene')]]);
            }

        } catch (error) {
            console.error("Sponsor Payment Error:", error);
            await sendPrompt(ctx, "❌ Ocurrió un error inesperado al procesar el anuncio.", [[Markup.button.callback('⬅️ Volver al Menú', 'cancel_scene')]]);
        }

        return ctx.scene.leave();
    }
);

// Helper functions
async function cancelScene(ctx) {
    if (ctx.callbackQuery) await ctx.answerCbQuery();
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
}

async function sendPrompt(ctx, text, keyboard = []) {
    const markup = keyboard.length > 0 ? Markup.inlineKeyboard(keyboard) : undefined;
    if (ctx.scene.session.lastMsgId) {
        try {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                ctx.scene.session.lastMsgId, 
                null, 
                text, 
                { parse_mode: 'Markdown', reply_markup: markup?.reply_markup, disable_web_page_preview: true }
            );
            ctx.wizard.next();
            return;
        } catch(e) {}
    }
    const msg = await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup?.reply_markup, disable_web_page_preview: true });
    ctx.scene.session.lastMsgId = msg.message_id;
    ctx.wizard.next();
}

// Comandos globales
sponsorWizard.command('start', async (ctx) => cancelScene(ctx));
sponsorWizard.command('cancelar', async (ctx) => cancelScene(ctx));

module.exports = { sponsorWizard };
