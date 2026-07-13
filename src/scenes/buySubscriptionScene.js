const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { sendTon, getBalance } = require('../services/tonService');
const { decryptData } = require('../services/cryptoService');
const { fromNano } = require('@ton/ton');

const buySubscriptionScene = new Scenes.WizardScene(
    'BUY_SUBSCRIPTION_SCENE',
    async (ctx) => {
        const planId = ctx.scene.state.planId;
        const plan = await prisma.subscriptionPlan.findUnique({
            where: { id: planId },
            include: { creator: true }
        });

        if (!plan || !plan.active) {
            await ctx.reply("❌ Esta suscripción ya no existe o está inactiva.");
            return ctx.scene.leave();
        }

        ctx.scene.session.plan = plan;

        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(ctx.from.id) },
            include: { wallets: true }
        });

        if (!user || user.wallets.length === 0) {
            await ctx.reply("❌ Debes crear una billetera en HeartWallet primero para poder suscribirte.");
            return ctx.scene.leave();
        }

        ctx.scene.session.user = user;

        const amountGram = fromNano(plan.priceNano);

        let text = `💎 *Confirmar Suscripción*\n\n` +
                   `**Plan:** ${plan.name}\n` +
                   `**Precio:** ${amountGram} GRAM / Mes\n\n` +
                   `_Al confirmar, se descontará el primer mes inmediatamente y autorizas a HeartWallet a realizar cobros automáticos cada 30 días._\n\n` +
                   `Selecciona la billetera que usarás para pagar (debe tener fondos suficientes):`;

        const keyboard = user.wallets.map(w => [Markup.button.callback(`💳 ${w.name} (${w.address.slice(0,6)}...)`, `pay_sub_${w.id}`)]);
        keyboard.push([Markup.button.callback('❌ Cancelar', 'cancel_scene')]);

        const msg = await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(keyboard).reply_markup });
        ctx.scene.session.promptId = msg.message_id;
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const data = ctx.callbackQuery.data;

        if (data === 'cancel_scene') {
            await ctx.answerCbQuery();
            await ctx.deleteMessage().catch(()=>{});
            return ctx.scene.leave();
        }

        if (data.startsWith('pay_sub_')) {
            const walletId = parseInt(data.replace('pay_sub_', ''));
            const wallet = ctx.scene.session.user.wallets.find(w => w.id === walletId);
            const plan = ctx.scene.session.plan;

            if (!wallet) return ctx.answerCbQuery("❌ Billetera inválida.");

            await ctx.answerCbQuery("🔄 Procesando pago...");
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "🔄 **Verificando fondos y procesando pago...**\n_Por favor espera, esto puede tomar unos segundos._", { parse_mode: 'Markdown' });

            try {
                // Check if user is already subscribed
                const existingSub = await prisma.subscription.findFirst({
                    where: { subscriberId: ctx.scene.session.user.id, planId: plan.id, status: 'ACTIVE' }
                });
                if (existingSub) {
                    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Ya tienes una suscripción activa a este plan.");
                    return ctx.scene.leave();
                }

                const creatorWallet = await prisma.wallet.findFirst({
                    where: { userId: plan.creatorId },
                    orderBy: { isPrimary: 'desc' }
                });

                if (!creatorWallet) {
                    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ El creador no tiene billetera para recibir fondos.");
                    return ctx.scene.leave();
                }

                const { config } = require('../config/env');
                if (!config.escrowWalletAddress) {
                    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ El sistema de pagos está en mantenimiento (Escrow no configurado).");
                    return ctx.scene.leave();
                }

                // Execute initial payment to Escrow Wallet
                const privateKey = decryptData(wallet.encryptedPrivateKey);
                const txHash = await sendTon(wallet, config.escrowWalletAddress, plan.priceNano, privateKey, "1er Pago Suscripcion: " + plan.name);

                if (!txHash) {
                    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ **Fondos Insuficientes**\nNo tienes suficientes GRAM en esta billetera para pagar la suscripción y cubrir el costo de red (Gas).", { parse_mode: 'Markdown' });
                    return ctx.scene.leave();
                }

                // Payment Success - Create Subscription and Payment in ESCROW
                const now = new Date();
                const nextDate = new Date(now);
                nextDate.setDate(nextDate.getDate() + plan.intervalDays);
                const unlockTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24 hours

                const subscription = await prisma.subscription.create({
                    data: {
                        subscriberId: ctx.scene.session.user.id,
                        planId: plan.id,
                        walletId: wallet.id,
                        nextRunAt: nextDate,
                        status: 'ACTIVE'
                    }
                });

                await prisma.subscriptionPayment.create({
                    data: {
                        subscriptionId: subscription.id,
                        amountNano: plan.priceNano,
                        status: 'ESCROW',
                        unlockTime: unlockTime
                    }
                });

                // Check if there is a VIP chat linked
                let inviteLinkStr = "";
                if (plan.chatId) {
                    try {
                        const chatId = plan.chatId.toString();
                        // Generate a single-use invite link or unban if they were banned previously
                        await ctx.telegram.unbanChatMember(chatId, Number(ctx.from.id)).catch(()=>{});
                        const inviteLink = await ctx.telegram.createChatInviteLink(chatId, { member_limit: 1 });
                        inviteLinkStr = `\n\n🔗 **Enlace de Acceso al Grupo VIP:**\n${inviteLink.invite_link}`;
                    } catch (e) {
                        inviteLinkStr = `\n\n⚠️ _Nota: No se pudo generar el enlace al grupo VIP. Contacta al creador._`;
                    }
                }

                await ctx.telegram.sendMessage(plan.creator.telegramId.toString(), `💸 *Nueva Suscripción*\nUn usuario se suscribió a *${plan.name}*. Has recibido ${fromNano(plan.priceNano)} GRAM (En retención de seguridad por 24h).`, { parse_mode: 'Markdown' }).catch(()=>{});

                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, 
                    `✅ *¡Suscripción Exitosa!*\n\n` +
                    `Has pagado el primer mes de **${plan.name}**. El próximo cobro automático será el ${nextDate.toLocaleDateString()}.\n_Tus fondos estarán protegidos por 24 horas en retención._` +
                    inviteLinkStr, 
                    { parse_mode: 'Markdown' }
                );

                return ctx.scene.leave();

            } catch (err) {
                console.error("Error in buy subscription:", err);
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Ocurrió un error al procesar el pago. Revisa tu saldo.");
                return ctx.scene.leave();
            }
        }
    }
);

module.exports = { buySubscriptionScene };
