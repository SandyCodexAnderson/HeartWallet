const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { generateWallet } = require('../services/tonService');
const { encryptPrivateKey, hashData } = require('../services/cryptoService');

const createWalletWizard = new Scenes.WizardScene(
    'CREATE_WALLET_SCENE',
    async (ctx) => {
        if (ctx.callbackQuery) {
            await ctx.deleteMessage().catch(() => {});
        }
        const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
        const msg = await ctx.reply("📝 ¿Qué nombre le quieres dar a tu nueva billetera? (ej. Ahorros, Pagos VIP, Personal)", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        ctx.scene.session.promptId = msg.message_id;
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') {
            await ctx.answerCbQuery();
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        const text = ctx.message?.text?.trim();
        if (ctx.message) {
            await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
        }

        if (text === '/cancelar') {
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }
        
        if (!text || text.length > 20) {
            const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ El nombre debe tener entre 1 y 20 caracteres. Intenta de nuevo escribiendo un nombre:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return;
        }

        const walletName = text;
        ctx.scene.session.walletName = walletName;
        const telegramId = BigInt(ctx.from.id);

        try {
            const user = await prisma.user.findUnique({
                where: { telegramId },
                include: { wallets: true }
            });
            
            if (!user) {
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Error: Usuario no registrado. Por favor presiona /start de nuevo.");
                return ctx.scene.leave();
            }

            if (user.wallets.length >= user.maxWallets) {
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Límite de billeteras alcanzado.");
                return ctx.scene.leave();
            }
            
            ctx.scene.session.userId = user.id;
            ctx.scene.session.isFirstWallet = user.wallets.length === 0;

            if (ctx.scene.session.isFirstWallet) {
                const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "🔐 **Paso Final de Seguridad**\n\nComo es tu primera billetera, crea un **PIN numérico de 4 dígitos**. Este PIN te será solicitado para confirmar cualquier envío de fondos en el futuro para mayor seguridad.\n\nEscribe tu PIN de 4 dígitos:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return ctx.wizard.next();
            } else {
                return await createAndSaveWallet(ctx);
            }

        } catch (error) {
            console.error("Error checking user:", error);
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Hubo un error al preparar la billetera.");
            return ctx.scene.leave();
        }
    },
    async (ctx) => {
        // Manejo del PIN (solo se llega aquí si es primera billetera)
        if (ctx.callbackQuery?.data === 'cancel_scene') {
            await ctx.answerCbQuery();
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        const text = ctx.message?.text?.trim();
        if (ctx.message) {
            await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
        }

        if (text === '/cancelar') {
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        if (!text || !/^\d{4}$/.test(text)) {
            const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ El PIN debe ser exactamente **4 números**. Intenta de nuevo escribiendo tu PIN:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return;
        }

        // Guardar el PIN en la DB
        ctx.scene.session.pinHash = hashData(text);
        return await createAndSaveWallet(ctx);
    }
);

async function createAndSaveWallet(ctx) {
    try {
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "⏳ Generando tu nueva billetera de forma segura, por favor espera...", { parse_mode: 'Markdown' });
        
        const walletData = await generateWallet();
        const encryptedKey = encryptPrivateKey(walletData.privateKeyHex);
        const encryptedMnemonics = encryptPrivateKey(walletData.mnemonics.join(' ')); // Usamos la misma clave maestra
        
        if (ctx.scene.session.isFirstWallet && ctx.scene.session.pinHash) {
            await prisma.user.update({
                where: { id: ctx.scene.session.userId },
                data: { recoveryPinHash: ctx.scene.session.pinHash }
            });
        }
        
        await prisma.wallet.create({
            data: {
                userId: ctx.scene.session.userId,
                address: walletData.address,
                encryptedPrivateKey: encryptedKey,
                encryptedMnemonics: encryptedMnemonics,
                name: ctx.scene.session.walletName,
                isPrimary: ctx.scene.session.isFirstWallet
            }
        });
        
        const buttons = [[Markup.button.callback('⬅️ Volver al Menú', 'start_menu')]];
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `✅ Billetera **"${ctx.scene.session.walletName}"** creada con éxito. 💖\n\nPresiona el botón abajo para ver tu menú actualizado.`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } catch (error) {
        console.error("Error creating wallet:", error);
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Hubo un error al crear la billetera.");
    }
    return ctx.scene.leave();
}

module.exports = { createWalletWizard };
