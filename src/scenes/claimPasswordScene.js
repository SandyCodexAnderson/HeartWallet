const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { sendTon } = require('../services/tonService');
const { handleStart } = require('../handlers/start');

const claimPasswordScene = new Scenes.WizardScene(
    'claimPasswordScene',
    async (ctx) => {
        const giftId = ctx.scene.session.giftId;
        if (!giftId) return cancelScene(ctx);

        const gift = await prisma.giftCheck.findUnique({
            where: { id: giftId },
            include: { sender: { include: { wallets: true } } }
        });

        if (!gift || gift.status !== 'PENDING' || gift.conditionType !== 'PASSWORD') {
            await ctx.reply("❌ Este regalo no es válido, ya fue reclamado o expiró.");
            return cancelScene(ctx);
        }

        ctx.scene.session.gift = gift;

        const msg = await ctx.reply(
            `🔐 **Acertijo de Regalo**\n\nPara reclamar este regalo, debes responder a la siguiente pregunta:\n\n_👉 "${gift.question}"_\n\nEscribe tu respuesta abajo:`,
            { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]).reply_markup }
        );
        ctx.scene.session.promptId = msg.message_id;
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);
        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
        if (!text) return;

        const gift = ctx.scene.session.gift;

        if (text.toLowerCase() !== gift.password.toLowerCase()) {
            return sendError(ctx, `❌ Respuesta incorrecta.\n\n_Pista: "${gift.question}"_\n\nIntenta de nuevo:`);
        }

        // Correct password!
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "✅ **¡Respuesta correcta!** Procesando transferencia...");

        try {
            const telegramId = BigInt(ctx.from.id);
            const receiver = await prisma.user.findUnique({
                where: { telegramId },
                include: { wallets: true }
            });

            if (!receiver || receiver.wallets.length === 0) {
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Necesitas una cuenta y una billetera para reclamar.");
                return cancelScene(ctx);
            }

            const receiverPrimaryWallet = receiver.wallets.find(w => w.isPrimary) || receiver.wallets[0];
            const senderPrimaryWallet = gift.sender.wallets.find(w => w.isPrimary) || gift.sender.wallets[0];

            if (!senderPrimaryWallet) {
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ El remitente ya no tiene una billetera principal válida.");
                return cancelScene(ctx);
            }

            const result = await sendTon(senderPrimaryWallet.encryptedPrivateKey, receiverPrimaryWallet.address, gift.amountNano, "Smart Gift");

            if (result.success) {
                await prisma.giftCheck.update({
                    where: { id: gift.id },
                    data: {
                        status: 'CLAIMED',
                        receiverId: receiver.id,
                        claimedAt: new Date()
                    }
                });
                
                const amountGram = Number(gift.amountNano) / 1e9;
                
                try {
                    await ctx.telegram.sendMessage(
                        Number(gift.sender.telegramId), 
                        `✅ **¡Tu Smart Gift fue descubierto!**\n\nEl usuario ${ctx.from.first_name} resolvió tu acertijo y reclamó exitosamente los **${amountGram} GRAM**.`
                    );
                } catch(e) {}

                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `🎉 **¡Felicidades!**\n\nHas resuelto el acertijo y reclamado **${amountGram} GRAM**.\n\n_(La transacción puede tardar unos segundos en reflejarse)_`);
            } else {
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `❌ Falló la transferencia: ${result.error}`);
            }
            return ctx.scene.leave();

        } catch (e) {
            console.error(e);
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Error al procesar el regalo.");
            return ctx.scene.leave();
        }
    }
);

async function cancelScene(ctx) {
    if (ctx.callbackQuery) await ctx.answerCbQuery();
    await ctx.scene.leave();
    return handleStart(ctx);
}

async function sendError(ctx, msg) {
    const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

// ─── Escape Hatches ────────────────────────────────────────────────────────
claimPasswordScene.command('start', async (ctx) => {
    if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
});
claimPasswordScene.command('cancelar', async (ctx) => {
    if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
});
// ───────────────────────────────────────────────────────────────────────────

module.exports = { claimPasswordScene };
