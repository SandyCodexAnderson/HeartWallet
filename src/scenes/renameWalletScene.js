const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');

const renameWalletWizard = new Scenes.WizardScene(
    'RENAME_WALLET_SCENE',

    // Paso 0: Pedir el nuevo nombre
    async (ctx) => {
        const walletId = ctx.scene.state?.walletId || ctx.scene.session.walletId;
        ctx.scene.session.walletId = walletId;
        if (ctx.callbackQuery) await ctx.answerCbQuery();
        const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_rename')]];
        const msg = await ctx.reply(
            '✏️ *Renombrar Billetera*\n\nEscribe el nuevo nombre para tu billetera _(máximo 20 caracteres)_:',
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );
        ctx.scene.session.promptId = msg.message_id;
        return ctx.wizard.next();
    },

    // Paso 1: Guardar el nuevo nombre
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_rename') {
            await ctx.answerCbQuery();
            await ctx.deleteMessage().catch(() => {});
            return ctx.scene.leave();
        }

        if (!ctx.message?.text) return;
        const newName = ctx.message.text.trim();
        await ctx.deleteMessage(ctx.message.message_id).catch(() => {});

        if (!newName || newName.length > 20 || newName.length < 1) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.promptId, null,
                '❌ Nombre inválido. Debe tener entre 1 y 20 caracteres. Inténtalo de nuevo:',
                { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'cancel_rename')]]) }
            ).catch(() => {});
            return;
        }

        try {
            const wallet = await prisma.wallet.findUnique({
                where: { id: ctx.scene.session.walletId },
                include: { user: true }
            });
            if (!wallet || wallet.user.telegramId !== BigInt(ctx.from.id)) {
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, '❌ Billetera no encontrada.').catch(() => {});
                return ctx.scene.leave();
            }

            await prisma.wallet.update({
                where: { id: ctx.scene.session.walletId },
                data: { name: newName }
            });

            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.promptId, null,
                `✅ *¡Billetera renombrada exitosamente!*\n\nNombre actualizado a: *${newName}*\n\nPuedes volver a tu billetera para ver los cambios.`,
                { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback(`⬅️ Ver ${newName}`, `view_wallet_${ctx.scene.session.walletId}`)]]) }
            ).catch(() => {});
        } catch (err) {
            console.error('Error renaming wallet:', err);
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, '❌ Error al renombrar la billetera.').catch(() => {});
        }

        return ctx.scene.leave();
    }
);

module.exports = { renameWalletWizard };
