const { Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { generateSponsorStatsImage } = require('../utils/canvasSponsor');

async function handleSponsorMenu(ctx) {
    if (ctx.message) {
        try { await ctx.deleteMessage(ctx.message.message_id); } catch(e){}
    }

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Crear Nueva Campaña', 'sponsor_create')],
        [Markup.button.callback('📊 Mis Estadísticas', 'sponsor_stats_0')],
        [Markup.button.callback('⬅️ Cerrar', 'cancel_scene')]
    ]);

    const msg = `📢 **Panel de Patrocinadores (Ads)**\n\nBienvenido al centro de anuncios de HeartWallet. Aquí puedes crear nuevas campañas publicitarias que verán todos nuestros usuarios, o revisar el rendimiento de tus campañas activas.`;

    if (ctx.callbackQuery) {
        try {
            await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...keyboard });
        } catch(e) {
            // Si falla (ej. si venimos de una foto de estadísticas), borramos y mandamos nuevo
            try { await ctx.deleteMessage(); } catch(err){}
            await ctx.reply(msg, { parse_mode: 'Markdown', ...keyboard });
        }
    } else {
        await ctx.reply(msg, { parse_mode: 'Markdown', ...keyboard });
    }
}

async function handleSponsorCreate(ctx) {
    await ctx.answerCbQuery();
    return ctx.scene.enter('SPONSOR_SCENE');
}

async function handleSponsorStats(ctx) {
    if (!ctx.from || !ctx.callbackQuery) return;
    
    const dataParts = ctx.callbackQuery.data.split('_');
    const index = parseInt(dataParts[2] || '0');
    const telegramId = BigInt(ctx.from.id);

    try {
        await ctx.answerCbQuery('📊 Cargando estadísticas...');

        const user = await prisma.user.findUnique({
            where: { telegramId }
        });

        if (!user) return ctx.reply("❌ Usuario no encontrado.");

        const campaigns = await prisma.adCampaign.findMany({
            where: { sponsorId: user.id },
            orderBy: { createdAt: 'desc' }
        });

        if (campaigns.length === 0) {
            try {
                await ctx.editMessageText("❌ Aún no has creado ninguna campaña publicitaria.", {
                    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'sponsor_menu')]])
                });
            } catch(e) {
                try { await ctx.deleteMessage(); } catch(err){}
                await ctx.reply("❌ Aún no has creado ninguna campaña publicitaria.", {
                    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'sponsor_menu')]])
                });
            }
            return;
        }

        const campaign = campaigns[index];
        const imageBuffer = await generateSponsorStatsImage(campaign, campaigns.length, index + 1);

        const buttons = [];
        if (index > 0) buttons.push(Markup.button.callback('⬅️ Anterior', `sponsor_stats_${index - 1}`));
        if (index < campaigns.length - 1) buttons.push(Markup.button.callback('Siguiente ➡️', `sponsor_stats_${index + 1}`));

        const keyboard = Markup.inlineKeyboard([
            buttons,
            [Markup.button.callback('⬅️ Volver al Panel', 'sponsor_menu')]
        ]);

        try {
            await ctx.editMessageMedia(
                { type: 'photo', media: { source: imageBuffer } },
                keyboard
            );
        } catch (e) {
            try { await ctx.deleteMessage(); } catch(err){}
            await ctx.replyWithPhoto({ source: imageBuffer }, { ...keyboard });
        }

    } catch (e) {
        console.error("Error cargando estadísticas de sponsor:", e);
        await ctx.reply("❌ Ocurrió un error al cargar el panel de estadísticas.");
    }
}

module.exports = { handleSponsorMenu, handleSponsorCreate, handleSponsorStats };
