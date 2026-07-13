const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { sendTon, getBalance } = require('../services/tonService');
const { hashData } = require('../services/cryptoService');
const { config } = require('../config/env');

const EXPANSION_COST_NANO = '1000000000'; // 1 TON

const expandWalletScene = new Scenes.WizardScene(
    'EXPAND_WALLET_SCENE',
    async (ctx) => {
        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(ctx.from.id) },
            include: { wallets: true }
        });

        if (!user || user.wallets.length === 0) {
            await ctx.reply("❌ Debes crear una billetera en HeartWallet primero.");
            return ctx.scene.leave();
        }

        ctx.scene.session.user = user;

        let text = `💎 *Expandir Límite de Billeteras*\n\n` +
                   `El costo para añadir **+1** al límite máximo de tus billeteras es de **1 TON**.\n\n` +
                   `Por favor, selecciona de cuál de tus billeteras actuales deseas pagar esta tarifa:\n\n` +
                   `_El pago se enviará automáticamente al sistema y tu límite se incrementará al instante._`;

        const keyboard = user.wallets.map(w => [Markup.button.callback(`💳 ${w.name} (${w.address.slice(0,6)}...)`, `pay_exp_${w.id}`)]);
        keyboard.push([Markup.button.callback('❌ Cancelar', 'cancel_scene')]);

        try { await ctx.deleteMessage(); } catch(e){}
        const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
        ctx.scene.session.promptId = msg.message_id;
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const data = ctx.callbackQuery.data;

        if (data === 'cancel_scene') {
            await ctx.answerCbQuery();
            try { await ctx.deleteMessage(); } catch(e){}
            const { handleStart } = require('../handlers/start');
            await handleStart(ctx);
            return ctx.scene.leave();
        }

        if (data.startsWith('pay_exp_')) {
            const walletId = parseInt(data.replace('pay_exp_', ''));
            const wallet = ctx.scene.session.user.wallets.find(w => w.id === walletId);

            if (!wallet) return ctx.answerCbQuery("❌ Billetera inválida.");

            await ctx.answerCbQuery();
            ctx.scene.session.selectedWallet = wallet;

            const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "🔐 **Confirmación de Seguridad**\n\nEstás a punto de pagar **1 TON** para expandir tu límite de billeteras.\n\nPor favor, ingresa tu **PIN de 4 dígitos** para confirmar la transacción:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        // Validation PIN step
        if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_scene') {
            await ctx.answerCbQuery();
            try { await ctx.deleteMessage(); } catch(e){}
            const { handleStart } = require('../handlers/start');
            await handleStart(ctx);
            return ctx.scene.leave();
        }

        if (ctx.message && ctx.message.text) {
            try { await ctx.deleteMessage(); } catch(e){} // borrar el PIN por seguridad

            const text = ctx.message.text.trim();
            const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];

            if (!text || !/^\d{4}$/.test(text)) {
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ PIN inválido. Debe ser de 4 dígitos numéricos. Intenta de nuevo:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return;
            }

            const expectedPinHash = ctx.scene.session.user.recoveryPinHash;
            if (hashData(text) !== expectedPinHash) {
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ **PIN Incorrecto**. Intenta de nuevo:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return;
            }

            // PIN CORRECT - EJECUTAR PAGO
            const wallet = ctx.scene.session.selectedWallet;
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "🔄 **PIN Correcto. Verificando fondos y procesando pago de 1 TON...**\n_Por favor espera unos segundos._", { parse_mode: 'Markdown' });

            try {
                if (!config.escrowWalletAddress) {
                    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ El sistema de pagos está en mantenimiento (Destino no configurado).");
                    return ctx.scene.leave();
                }

                // Verificar saldo antes
                const balance = BigInt(await getBalance(wallet.address));
                const required = BigInt(EXPANSION_COST_NANO) + 20000000n; // 1 TON + gas (aprox 0.02)
                if (balance < required) {
                    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ **Fondos Insuficientes**\nNo tienes suficientes GRAM/TON en esta billetera para pagar la expansión y cubrir el costo de red (Gas).", { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'start_menu')]]) });
                    return ctx.scene.leave();
                }

                const txHash = await sendTon(wallet.encryptedPrivateKey, config.escrowWalletAddress, EXPANSION_COST_NANO, "Expansion de Límite de Billeteras");

                if (!txHash) {
                    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ **Error de Transacción**\nNo se pudo procesar el pago.", { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'start_menu')]]) });
                    return ctx.scene.leave();
                }

                // Payment Success - Incrementar limite
                await prisma.user.update({
                    where: { id: ctx.scene.session.user.id },
                    data: { maxWallets: { increment: 1 } }
                });

                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, 
                    `✅ *¡Límite Expandido!*\n\n` +
                    `Se ha cobrado 1 TON exitosamente.\nTu límite máximo de billeteras ha aumentado en +1.\nYa puedes ir al menú principal y crear tu nueva billetera.`, 
                    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al menú', 'start_menu')]]) }
                );

                return ctx.scene.leave();

            } catch (err) {
                console.error("Error in wallet expansion:", err);
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Ocurrió un error al procesar el pago. Revisa tu saldo e intenta nuevamente.");
                return ctx.scene.leave();
            }
        }
    }
);

module.exports = { expandWalletScene };
