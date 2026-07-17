const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { mnemonicNew } = require('@ton/crypto');
const { hashData, normalizeRecoveryWords, recoveryLookupHash } = require('../services/cryptoService');

const backupWalletWizard = new Scenes.WizardScene(
    'BACKUP_WALLET_SCENE',
    async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        
        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(ctx.from.id) }
        });

        if (!user) {
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        if (user.recoveryWordsHash) {
            const buttons = [
                [Markup.button.callback('⚠️ Sí, Sobreescribir Respaldo', 'bck_overwrite')],
                [Markup.button.callback('⬅️ Cancelar', 'bck_cancel')]
            ];
            try {
                await ctx.editMessageText("⚠️ **Ya tienes un respaldo activo.**\n\nSi creas uno nuevo, el anterior quedará **inválido** y no podrás usarlo para recuperar tu cuenta. ¿Deseas sobreescribirlo?", 
                    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
                );
                ctx.scene.session.promptId = ctx.callbackQuery.message.message_id;
            } catch(e) {
                const msg = await ctx.reply("⚠️ **Ya tienes un respaldo activo.**\n\nSi creas uno nuevo, el anterior quedará **inválido**. ¿Deseas sobreescribirlo?", 
                    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
                );
                ctx.scene.session.promptId = msg.message_id;
            }
            return ctx.wizard.next();
        } else {
            return await proceedToBackup(ctx);
        }
    },
    async (ctx) => {
        if (!ctx.callbackQuery) {
            if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
            return;
        }
        
        const action = ctx.callbackQuery.data;
        await ctx.answerCbQuery().catch(() => {});

        if (action === 'bck_cancel') {
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }
        
        if (action === 'bck_overwrite') {
            return await proceedToBackup(ctx);
        }
    },
    async (ctx) => {
        if (ctx.callbackQuery) {
            const action = ctx.callbackQuery.data;
            await ctx.answerCbQuery().catch(() => {});
            if (action === 'bck_cancel') {
                await ctx.scene.leave();
                const { handleStart } = require('../handlers/start');
                return handleStart(ctx);
            }
            return;
        }

        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});

        if (text === '/cancelar') {
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        if (!text || !/^\d{4}$/.test(text)) {
            const buttons = [[Markup.button.callback('⬅️ Cancelar', 'bck_cancel')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ El PIN debe ser **exactamente de 4 números**. Intenta de nuevo escribiendo 4 números:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return;
        }

        const pin = text;
        const words = ctx.scene.session.words;
        
        const wordsString = normalizeRecoveryWords(words.join(' '));
        const wordsHash = hashData(wordsString);
        const wordsLookup = recoveryLookupHash(wordsString);
        const pinHash = hashData(pin);

        try {
            await prisma.user.update({
                where: { telegramId: BigInt(ctx.from.id) },
                data: {
                    recoveryWordsHash: wordsHash,
                    recoveryWordsLookup: wordsLookup,
                    recoveryPinHash: pinHash
                }
            });

            const fileContent = `🌸 HEARTWALLET - CÓDIGO DE RECUPERACIÓN INTERNO 🌸

¡ATENCIÓN! Este archivo te permite recuperar tus fondos si pierdes tu cuenta de Telegram.

Tus 12 Palabras de Respaldo:
${wordsString}

Tu PIN de 4 dígitos: [EL QUE ELEGISTE, NO LO GUARDAMOS AQUÍ POR SEGURIDAD]

⚠️ REGLAS CRÍTICAS:
1. Este es un código interno exclusivo de HeartWallet. NO funcionará en otras aplicaciones como Tonkeeper.
2. Si pierdes tu cuenta de Telegram, crea una nueva, entra al bot, presiona "Recuperar Billetera" e ingresa estas 12 palabras junto con tu PIN.
3. NUNCA compartas este archivo con nadie. Si alguien obtiene este archivo Y adivina tu PIN, perderás todos tus fondos.
`;
            
            const buffer = Buffer.from(fileContent, 'utf-8');
            
            // Editar en lugar de borrar para no perder contexto
            const returnBtn = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Menú', 'bck_cancel')]]);
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "✅ **Respaldo generado y guardado exitosamente.**\n\n📄 Aquí tienes tu archivo seguro. **DESCÁRGALO y guárdalo en un lugar muy seguro** (nota encriptada, impreso, etc.).", { parse_mode: 'Markdown', ...returnBtn });
            await ctx.replyWithDocument({ source: buffer, filename: 'HeartWallet_Recovery.txt' });
            
        } catch (error) {
            console.error("Error guardando respaldo:", error);
            try {
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Ocurrió un error al generar el respaldo.");
            } catch(e) {}
        }

        return ctx.scene.leave();
    }
);

async function proceedToBackup(ctx) {
    const fullMnemonics = await mnemonicNew();
    const words = fullMnemonics.slice(0, 12);
    ctx.scene.session.words = words;

    const msgText = `🔐 *Generando tu Frase de Respaldo Interna...*\n\nPara proteger este respaldo en caso de que alguien robe tu archivo .txt, debes establecer un **PIN de 4 dígitos**.\n\nPor favor, escribe un PIN numérico de 4 dígitos que no vayas a olvidar:`;
    const buttons = [[Markup.button.callback('⬅️ Cancelar', 'bck_cancel')]];

    try {
        // Intentar editar el mensaje existente
        const msgId = ctx.callbackQuery?.message?.message_id || ctx.scene.session.promptId;
        if (msgId) {
            await ctx.telegram.editMessageText(ctx.chat.id, msgId, null, msgText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            ctx.scene.session.promptId = msgId;
        } else {
            throw new Error("No message id to edit");
        }
    } catch(e) {
        // Si no hay mensaje que editar, enviamos uno nuevo
        const msg = await ctx.reply(msgText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        ctx.scene.session.promptId = msg.message_id;
    }

    ctx.wizard.selectStep(2);
}

module.exports = { backupWalletWizard };
