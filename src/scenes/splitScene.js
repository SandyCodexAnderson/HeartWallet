const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { sendTon } = require('../services/tonService');
const { hashData } = require('../services/cryptoService');
const { toNano, fromNano } = require('@ton/ton');
const { handleStart } = require('../handlers/start');

const splitScene = new Scenes.WizardScene(
    'splitScene',
    async (ctx) => {
        // Step 0: Initial Check
        const splitId = ctx.scene.session.splitId;
        if (!splitId) return cancelScene(ctx);

        const bill = await prisma.splitBill.findUnique({
            where: { id: splitId },
            include: { creator: true, participants: true }
        });

        if (!bill) {
            await ctx.reply("❌ Esta solicitud de pago no existe.");
            return cancelScene(ctx);
        }

        if (bill.status === 'COMPLETED') {
            await ctx.reply("✅ Esta cuenta ya ha sido pagada en su totalidad.");
            return cancelScene(ctx);
        }

        if (bill.creator.telegramId === BigInt(ctx.from.id)) {
            await ctx.reply("❌ No puedes pagarte a ti mismo en este Split.");
            return cancelScene(ctx);
        }

        const totalRequested = Number(fromNano(bill.totalAmountNano));
        let totalPaid = 0;
        bill.participants.forEach(p => {
            if (p.status === 'PAID') {
                totalPaid += Number(fromNano(p.amountNano));
            }
        });

        const remaining = totalRequested - totalPaid;
        
        ctx.scene.session.billId = splitId;
        ctx.scene.session.creatorId = bill.creatorId;
        ctx.scene.session.remaining = remaining;

        const msg = await ctx.reply(
            `🤝 **Pago de Cuenta (Split)**\n\n${bill.creator.firstName || 'El usuario'} está pidiendo ayuda para pagar una cuenta de **${totalRequested} GRAM**.\n\nFalta recaudar: **${remaining} GRAM**.\n\n💰 ¿Cuánto deseas aportar a esta cuenta? (Escribe el número, ej. 5):`,
            {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
                ]).reply_markup
            }
        );
        ctx.scene.session.promptId = msg.message_id;
        return ctx.wizard.next();
    },
    async (ctx) => {
        // Step 1: Amount Input
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);
        
        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
        if (text === '/cancelar') return cancelScene(ctx);
        if (!text) return;

        const amountStr = text.replace(',', '.');
        const amount = parseFloat(amountStr);

        if (isNaN(amount) || amount <= 0) {
            return sendError(ctx, "❌ Por favor ingresa un número válido mayor a 0 (ej. 5):");
        }

        if (amount > ctx.scene.session.remaining) {
            return sendError(ctx, `❌ El monto máximo restante es de **${ctx.scene.session.remaining} GRAM**. Ingresa una cantidad menor o igual a esa:`);
        }

        ctx.scene.session.amount = amount;

        const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
        if (user.recoveryPinHash) {
            ctx.scene.session.expectedPinHash = user.recoveryPinHash;
            const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `🔐 **Confirmación de Seguridad**\n\nVas a enviar **${amount} GRAM** al creador de la cuenta.\nIngresa tu **PIN de 4 dígitos** para confirmar:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return ctx.wizard.next();
        } else {
            return executeSplitPayment(ctx);
        }
    },
    async (ctx) => {
        // Step 2: PIN Validation
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);
        
        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
        if (text === '/cancelar') return cancelScene(ctx);
        
        if (!text || !/^\d{4}$/.test(text)) {
            return sendError(ctx, "❌ PIN inválido. Debe ser de 4 dígitos. Intenta de nuevo:");
        }

        if (hashData(text) !== ctx.scene.session.expectedPinHash) {
            return sendError(ctx, "❌ **PIN Incorrecto**. Tu transacción ha sido bloqueada. Intenta de nuevo:");
        }

        return executeSplitPayment(ctx);
    }
);

async function executeSplitPayment(ctx) {
    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "⏳ Procesando tu aporte en la blockchain. Por favor espera...");
    
    try {
        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(ctx.from.id) },
            include: { wallets: true }
        });
        
        const senderWallet = user.wallets.find(w => w.isPrimary) || user.wallets[0];
        if (!senderWallet) {
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ No tienes una billetera configurada.");
            return cancelScene(ctx);
        }

        const creator = await prisma.user.findUnique({
            where: { id: ctx.scene.session.creatorId },
            include: { wallets: true }
        });
        
        const receiverWallet = creator.wallets.find(w => w.isPrimary) || creator.wallets[0];
        if (!receiverWallet) {
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ El creador de la cuenta no tiene billetera para recibir.");
            return cancelScene(ctx);
        }

        const nanoAmount = toNano(ctx.scene.session.amount).toString();
        
        // Execute blockchain transaction
        const result = await sendTon(senderWallet.encryptedPrivateKey, receiverWallet.address, nanoAmount, "Split & Pay");
        
        const returnButton = [[Markup.button.callback('⬅️ Volver al Menú', 'cancel_scene')]];
        
        if (result.success) {
            // Log the payment
            await prisma.splitBillParticipant.create({
                data: {
                    billId: ctx.scene.session.billId,
                    userId: user.id,
                    amountNano: nanoAmount,
                    status: 'PAID'
                }
            });

            // Check if bill is completed
            const bill = await prisma.splitBill.findUnique({
                where: { id: ctx.scene.session.billId },
                include: { participants: true }
            });
            
            const totalRequested = Number(fromNano(bill.totalAmountNano));
            let totalPaid = 0;
            bill.participants.forEach(p => {
                if (p.status === 'PAID') totalPaid += Number(fromNano(p.amountNano));
            });

            if (totalPaid >= totalRequested) {
                await prisma.splitBill.update({
                    where: { id: bill.id },
                    data: { status: 'COMPLETED' }
                });
                
                // Notify Creator asynchronously
                try {
                    await ctx.telegram.sendMessage(
                        Number(creator.telegramId), 
                        `✅ **¡Cuenta Completada!**\n\nTu Split Bill de **${totalRequested} GRAM** ha sido pagado en su totalidad gracias a las aportaciones de tus amigos.`
                    );
                } catch(e) {}
            }

            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                ctx.scene.session.promptId, 
                null, 
                `✅ **¡Aporte exitoso!** 💖\n\nHas pagado **${ctx.scene.session.amount} GRAM** para la cuenta compartida.\n\n_(La transacción puede tardar unos segundos en reflejarse)._`, 
                { parse_mode: 'Markdown', ...Markup.inlineKeyboard(returnButton) }
            );
        } else {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                ctx.scene.session.promptId, 
                null, 
                `❌ **Falló el pago:** ${result.error}\n\nVerifica que tengas saldo suficiente.`, 
                { parse_mode: 'Markdown', ...Markup.inlineKeyboard(returnButton) }
            );
        }
        return ctx.scene.leave();

    } catch (error) {
        console.error("Error executing split:", error);
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Ocurrió un error inesperado al procesar el pago.");
        return ctx.scene.leave();
    }
}

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
splitScene.command('start', async (ctx) => {
    if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
});
splitScene.command('cancelar', async (ctx) => {
    if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
});
// ───────────────────────────────────────────────────────────────────────────

module.exports = splitScene;
