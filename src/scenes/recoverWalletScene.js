const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { hashData, legacyHashData, normalizeRecoveryWords, recoveryLookupHash, verifyHash } = require('../services/cryptoService');

const recoverWalletWizard = new Scenes.WizardScene(
    'RECOVER_WALLET_SCENE',
    async (ctx) => {
        if (ctx.callbackQuery) {
            await ctx.deleteMessage().catch(() => {});
        }
        const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
        const msg = await ctx.reply("📥 *Recuperar Billeteras*\n\nPor favor, pega aquí las **12 palabras** de tu archivo de respaldo de HeartWallet, separadas por espacios.", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
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

        const text = normalizeRecoveryWords(ctx.message?.text);
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});

        if (text === '/cancelar') {
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        if (!text) return;

        const words = text.split(/\s+/);
        if (words.length !== 12) {
            const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Debes ingresar exactamente 12 palabras separadas por espacios. Inténtalo de nuevo pegando las 12 palabras:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return;
        }

        ctx.scene.session.wordsString = normalizeRecoveryWords(words.join(' '));
        const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "🔐 Ahora, por favor ingresa el **PIN de 4 dígitos** que escogiste cuando creaste el respaldo:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
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
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});

        if (text === '/cancelar') {
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        if (!text || !/^\d{4}$/.test(text)) {
            const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ El PIN debe ser de 4 dígitos numéricos. Inténtalo de nuevo escribiendo tu PIN:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return;
        }

        const pin = text;
        const wordsString = ctx.scene.session.wordsString;

        try {
            const lookup = recoveryLookupHash(wordsString);
            const legacyWordsHash = legacyHashData(wordsString);

            const candidates = await prisma.user.findMany({
                where: {
                    OR: [
                        { recoveryWordsLookup: lookup },
                        {
                            recoveryWordsLookup: null,
                            recoveryWordsHash: legacyWordsHash,
                        },
                    ],
                    recoveryPinHash: { not: null },
                },
                include: { wallets: true }
            });

            const oldUser = candidates.find((candidate) =>
                verifyHash(wordsString, candidate.recoveryWordsHash) &&
                verifyHash(pin, candidate.recoveryPinHash)
            );

            if (!oldUser) {
                const buttons = [[Markup.button.callback('⬅️ Volver', 'cancel_scene')]];
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ **Credenciales incorrectas.**\nLas palabras o el PIN no coinciden con ningún respaldo registrado. Asegúrate de escribirlas exactamente igual (sin mayúsculas).", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return ctx.scene.leave();
            }

            if (oldUser.telegramId === BigInt(ctx.from.id)) {
                const buttons = [[Markup.button.callback('⬅️ Volver', 'cancel_scene')]];
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "⚠️ Ya estás usando esta cuenta. Tus billeteras ya te pertenecen aquí.", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return ctx.scene.leave();
            }

            const telegramId = BigInt(ctx.from.id);
            let currentUser = await prisma.user.findUnique({ where: { telegramId } });
            
            if (!currentUser) {
                currentUser = await prisma.user.create({
                    data: {
                        telegramId,
                        username: ctx.from.username,
                        firstName: ctx.from.first_name,
                        lastName: ctx.from.last_name
                    }
                });
            }

            const walletIds = oldUser.wallets.map(w => w.id);
            
            if (walletIds.length > 0) {
                await prisma.wallet.updateMany({
                    where: { userId: oldUser.id },
                    data: { userId: currentUser.id }
                });
            }

            await prisma.user.update({
                where: { id: oldUser.id },
                data: { recoveryWordsHash: null, recoveryPinHash: null }
            });

            const buttons = [[Markup.button.callback('⬅️ Ir al Menú Principal', 'cancel_scene')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `✅ **¡RECUPERACIÓN EXITOSA!** 🎉\n\nSe han migrado **${walletIds.length} billetera(s)** a esta nueva cuenta de Telegram.\n\nPor seguridad, hemos invalidado el respaldo anterior. Te recomendamos generar uno nuevo desde tu panel principal.\n\nPresiona el botón de abajo para ver tus billeteras recuperadas.`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });

        } catch (error) {
            console.error("Error en recuperación:", error);
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Hubo un error procesando tu recuperación.");
        }

        return ctx.scene.leave();
    }
);

module.exports = { recoverWalletWizard };
