const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { importWallet } = require('../services/tonService');
const { encryptPrivateKey, hashData } = require('../services/cryptoService');

const importWalletWizard = new Scenes.WizardScene(
    'IMPORT_WALLET_SCENE',
    async (ctx) => {
        if (ctx.callbackQuery) {
            await ctx.deleteMessage().catch(() => {});
        }
        const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
        const msg = await ctx.reply("📝 ¿Qué nombre le quieres dar a tu billetera importada? (ej. Cold Wallet, Ahorros, Principal)", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
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
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "🔐 **Paso de Seguridad**\n\nComo es tu primera billetera en HeartWallet, crea un **PIN numérico de 4 dígitos**. Este PIN te será solicitado para confirmar cualquier envío de fondos en el futuro.\n\nEscribe tu PIN de 4 dígitos:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return ctx.wizard.next();
            } else {
                // Saltar configuración de PIN
                return await promptForMnemonics(ctx);
            }

        } catch (error) {
            console.error("Error checking user:", error);
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Hubo un error al preparar la importación.");
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

        // Guardar el PIN en la sesión
        ctx.scene.session.pinHash = hashData(text);
        return await promptForMnemonics(ctx);
    },
    async (ctx) => {
        // Manejo de las 24 palabras
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

        if (!text) return;

        const wordsArray = text.split(/\s+/);
        if (wordsArray.length !== 24) {
            const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `❌ Has ingresado ${wordsArray.length} palabras. Se requieren exactamente **24 palabras** separadas por espacios.\n\nIntenta de nuevo:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }).catch(()=>{});
            return;
        }

        return await processAndSaveImportedWallet(ctx, wordsArray);
    }
);

async function promptForMnemonics(ctx) {
    const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "🔑 **Importar Semilla de 24 Palabras**\n\nPor favor, ingresa tus **24 palabras secretas** separadas por espacios. Asegúrate de escribirlas correctamente en el orden exacto.\n\n_Esta información será fuertemente encriptada y solo tú podrás acceder a ella._", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    return ctx.wizard.next();
}

async function processAndSaveImportedWallet(ctx, wordsArray) {
    try {
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "⏳ Validando y encriptando tu billetera, por favor espera...", { parse_mode: 'Markdown' });
        
        const walletData = await importWallet(wordsArray);
        
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
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `✅ Billetera **"${ctx.scene.session.walletName}"** importada con éxito y asegurada bajo custodia. 💖\n\nPresiona el botón abajo para ver tu menú actualizado.`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } catch (error) {
        console.error("Error importing wallet:", error);
        const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
        if (error.message === "Invalid mnemonic phrase") {
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Las palabras ingresadas no son válidas o están en el orden incorrecto. Intenta de nuevo escribiéndolas correctamente:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            // Nos mantenemos en este paso para que lo intente de nuevo
            return;
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Hubo un error al importar la billetera. Es posible que el formato no sea compatible.", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return ctx.scene.leave();
        }
    }
    return ctx.scene.leave();
}

module.exports = { importWalletWizard };
