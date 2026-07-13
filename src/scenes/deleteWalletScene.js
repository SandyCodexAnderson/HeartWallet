const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');

const deleteWalletWizard = new Scenes.WizardScene(
    'DELETE_WALLET_SCENE',
    async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        
        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(ctx.from.id) },
            include: { wallets: true }
        });

        if (!user || user.wallets.length === 0) {
            await ctx.reply("No tienes billeteras para eliminar.");
            return ctx.scene.leave();
        }

        const buttons = user.wallets.map(w => [Markup.button.callback(`❌ ${w.name}`, `del_sel_${w.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Cancelar', 'del_cancel')]);

        const msg = await ctx.reply("🗑 *Eliminar Billetera*\n\nSelecciona la billetera que deseas eliminar. TEN CUIDADO, esto no se puede deshacer:", 
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );
        ctx.scene.session.promptId = msg.message_id;
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'del_cancel') {
            await ctx.answerCbQuery("Cancelado.");
            await ctx.editMessageText("❌ Operación cancelada.");
            return ctx.scene.leave();
        }

        if (action.startsWith('del_sel_')) {
            const walletId = parseInt(action.replace('del_sel_', ''));
            const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
            
            if (!wallet) {
                await ctx.reply("Billetera no encontrada.");
                return ctx.scene.leave();
            }

            ctx.scene.session.walletIdToDelete = walletId;
            ctx.scene.session.walletName = wallet.name;

            await ctx.answerCbQuery("Iniciando eliminación...");
            const msg = `⚠️ *VERIFICACIÓN 1 DE 3*\n\nEstás a punto de eliminar la billetera **${wallet.name}**.\n\nAl eliminarla, todos los fondos (GRAMs) que contenga se PERDERÁN PARA SIEMPRE de forma irrevocable. HeartWallet no guarda copias de respaldo de tus llaves.\n\n¿Deseas continuar?`;
            
            const buttons = [
                [Markup.button.callback('❌ Cancelar', 'del_cancel')],
                [Markup.button.callback('✅ Sí, quiero eliminarla', 'del_v1_yes')]
            ];

            await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'del_cancel') {
            await ctx.answerCbQuery("Cancelado.");
            await ctx.editMessageText(`❌ Operación cancelada. Tu billetera **${ctx.scene.session.walletName}** está a salvo.`, { parse_mode: 'Markdown' });
            return ctx.scene.leave();
        }

        if (action === 'del_v1_yes') {
            await ctx.answerCbQuery("Procesando...");
            const msg = `⚠️ *VERIFICACIÓN 2 DE 3*\n\nEsta acción es PERMANENTE E IRREVOCABLE.\n\n¿Estás absolutamente segura de que deseas DESTRUIR esta billetera y perder el acceso a todos los activos almacenados en ella?`;
            
            const buttons = [
                [Markup.button.callback('❌ Cancelar y mantener a salvo', 'del_cancel')],
                [Markup.button.callback('✅ SÍ, ESTOY SEGURA', 'del_v2_yes')]
            ];

            await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'del_cancel') {
            await ctx.answerCbQuery("Cancelado.");
            await ctx.editMessageText(`❌ Operación cancelada. Tu billetera **${ctx.scene.session.walletName}** está a salvo.`, { parse_mode: 'Markdown' });
            return ctx.scene.leave();
        }

        if (action === 'del_v2_yes') {
            await ctx.answerCbQuery("Última advertencia...");
            const msg = `🚨 *ÚLTIMA ADVERTENCIA 3 DE 3* 🚨\n\nSi borras la billetera **${ctx.scene.session.walletName}**, no habrá vuelta atrás ni soporte técnico que pueda recuperarla.\n\nPor favor confirma por ÚLTIMA vez.`;
            
            const buttons = [
                [Markup.button.callback('❌ CANCELAR TODO', 'del_cancel')],
                [Markup.button.callback('💣 ELIMINAR DEFINITIVAMENTE', 'del_v3_yes')]
            ];

            await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'del_cancel') {
            await ctx.answerCbQuery();
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        if (action === 'del_v3_yes') {
            await ctx.answerCbQuery("Confirmado.");
            const msg = `🚨 *ÚLTIMA ADVERTENCIA 3 DE 3* 🚨\n\nSi borras la billetera **${ctx.scene.session.walletName}**, no habrá vuelta atrás.\n\nPor favor, ingresa tu **PIN de 4 dígitos** de seguridad para autorizar la eliminación definitiva:`;
            
            const buttons = [[Markup.button.callback('❌ CANCELAR TODO', 'del_cancel')]];

            await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'del_cancel') {
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
            const buttons = [[Markup.button.callback('❌ Cancelar', 'del_cancel')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId || ctx.callbackQuery?.message?.message_id, null, "❌ PIN inválido. Debe ser de 4 dígitos. Intenta de nuevo:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return;
        }

        const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
        
        const { hashData } = require('../services/cryptoService');
        if (user.recoveryPinHash && hashData(text) !== user.recoveryPinHash) {
            const buttons = [[Markup.button.callback('❌ Cancelar', 'del_cancel')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId || ctx.callbackQuery?.message?.message_id, null, "❌ **PIN Incorrecto**. Operación bloqueada. Intenta de nuevo:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return;
        }

        // PIN Correcto o el usuario no configuró PIN (antes de la update)
        try {
            await prisma.wallet.delete({
                where: { id: ctx.scene.session.walletIdToDelete }
            });
            
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId || ctx.callbackQuery?.message?.message_id, null, `🗑 La billetera **${ctx.scene.session.walletName}** ha sido eliminada permanentemente de la base de datos.\n\nPresiona el botón para volver al menú.`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al menú', 'del_cancel')]]) }).catch(() => {});
        } catch (error) {
            console.error("Error eliminando billetera:", error);
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId || ctx.callbackQuery?.message?.message_id, null, "❌ Ocurrió un error al intentar eliminar la billetera.").catch(() => {});
        }

        // We don't leave immediately here because we want them to press the return button, or we can just redirect immediately
        // Wait, if we redirect immediately, they don't see the success message.
        // Let's leave scene and just provide a success message that then requires them to click start. Or just let 'del_cancel' button handle returning.
        return ctx.scene.leave();
    }
);

module.exports = { deleteWalletWizard };
