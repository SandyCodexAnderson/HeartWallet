const { Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { fromNano } = require('@ton/ton');

async function handleMySubscriptions(ctx) {
    const page = parseInt(ctx.match ? ctx.match[1] : 0) || 0;
    const telegramId = BigInt(ctx.from.id);

    const user = await prisma.user.findUnique({
        where: { telegramId },
        include: {
            subscriptions: {
                include: { plan: { include: { creator: true } } },
                orderBy: { createdAt: 'desc' }
            }
        }
    });

    if (!user || user.subscriptions.length === 0) {
        return ctx.answerCbQuery("No tienes ninguna suscripción activa.", { show_alert: true });
    }

    const subs = user.subscriptions;
    const PAGE_SIZE = 1;
    const totalPages = subs.length;
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const sub = subs[safePage];

    const amountGram = fromNano(sub.plan.priceNano);
    
    let statusEmoji = '✅ Activa';
    if (sub.status === 'CANCELED') statusEmoji = '❌ Cancelada';
    if (sub.status === 'FAILED_FUNDS') statusEmoji = '⚠️ Fallida (Falta de Fondos)';

    let msg = `📅 *Mis Suscripciones* (${safePage + 1}/${totalPages})\n\n`;
    msg += `**Suscripción:** ${sub.plan.name}\n`;
    msg += `**Creador:** ${sub.plan.creator.username ? '@'+sub.plan.creator.username : 'ID: '+sub.plan.creator.telegramId}\n`;
    msg += `**Monto:** ${amountGram} GRAM / Mes\n`;
    msg += `**Estado:** ${statusEmoji}\n`;
    msg += `**Próximo Cobro:** ${sub.nextRunAt.toLocaleDateString()}\n`;

    const buttons = [];
    
    if (sub.status === 'ACTIVE') {
        buttons.push([Markup.button.callback('❌ Cancelar Suscripción', `cancel_sub_${sub.id}`)]);
    } else if (sub.status === 'FAILED_FUNDS') {
        buttons.push([Markup.button.callback('🔄 Renovar / Pagar Ahora', `renew_sub_${sub.id}`)]);
    }

    const navRow = [];
    if (safePage > 0) navRow.push(Markup.button.callback('⬅️ Ant', `my_subscriptions_${safePage - 1}`));
    if (safePage < totalPages - 1) navRow.push(Markup.button.callback('Sig ➡️', `my_subscriptions_${safePage + 1}`));
    if (navRow.length > 0) buttons.push(navRow);

    // Get a walletId to go back to (just grab the first one)
    const walletId = sub.walletId;
    buttons.push([Markup.button.callback('⬅️ Volver a Billetera', `view_wallet_${walletId}`)]);

    if (ctx.callbackQuery) {
        await ctx.editMessageCaption(msg, { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(buttons).reply_markup }).catch(async () => {
            await ctx.deleteMessage().catch(()=>{});
            await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
        });
    } else {
        await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
    }
}

async function handleCancelSubscription(ctx) {
    const subId = ctx.match[1];
    await prisma.subscription.update({
        where: { id: subId },
        data: { status: 'CANCELED' }
    });

    await ctx.answerCbQuery("❌ Suscripción cancelada exitosamente.", { show_alert: true });
    
    // Refresh view
    ctx.match[1] = '0';
    return handleMySubscriptions(ctx);
}

// Optionally implement manual renew (omitted for brevity, could trigger buy flow again or cron process)
async function handleRenewSubscription(ctx) {
    await ctx.answerCbQuery("⚠️ Por favor recarga fondos en tu billetera. El sistema intentará cobrar de nuevo automáticamente en unas horas.", { show_alert: true });
}

module.exports = { handleMySubscriptions, handleCancelSubscription, handleRenewSubscription };
