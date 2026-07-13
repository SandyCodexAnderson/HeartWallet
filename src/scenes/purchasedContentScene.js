const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { sendProtectedContent } = require('../utils/sendProtectedContent');

const purchasedContentScene = new Scenes.BaseScene('PURCHASED_CONTENT_SCENE');

purchasedContentScene.enter(async (ctx) => {
    const telegramId = BigInt(ctx.from.id);

    const user = await prisma.user.findUnique({
        where: { telegramId },
        include: { purchases: { include: { product: true }, orderBy: { createdAt: 'desc' } } }
    });

    if (!user || user.purchases.length === 0) {
        await ctx.reply("📦 Aún no has comprado ningún contenido digital.", Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Volver al menú', 'start_menu')]
        ]));
        return ctx.scene.leave();
    }

    const buttons = [];
    user.purchases.forEach(purchase => {
        const product = purchase.product;
        let extraFiles = [];
        if (product.mediaData) {
            try { extraFiles = JSON.parse(product.mediaData); } catch (e) {}
        }
        const totalFiles = 1 + extraFiles.length;
        const fileLabel = totalFiles > 1 ? ` (${totalFiles} archivos)` : '';
        const shortTitle = product.title.length > 28 ? product.title.substring(0, 25) + '...' : product.title;
        buttons.push([Markup.button.callback(`📥 ${shortTitle}${fileLabel}`, `view_purchase_${purchase.id}`)]);
    });

    buttons.push([Markup.button.callback('⬅️ Volver al menú', 'start_menu')]);

    await ctx.reply(
        `📦 *Contenido Comprado*\n\n` +
        `Aquí están todos los paquetes y contenidos que has comprado.\n` +
        `Presiona uno para recibir sus archivos de forma privada:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
        }
    );
});

// Handler para ver una compra específica
purchasedContentScene.action(/view_purchase_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const purchaseId = ctx.match[1];

    const purchase = await prisma.purchase.findUnique({
        where: { id: purchaseId },
        include: { product: true }
    });

    if (!purchase) {
        return ctx.reply("❌ No se encontró esta compra.");
    }

    const product = purchase.product;
    let extraFiles = [];
    if (product.mediaData) {
        try { extraFiles = JSON.parse(product.mediaData); } catch (e) {}
    }
    const totalFiles = 1 + extraFiles.length;

    await ctx.reply(
        `📦 Enviando *${product.title}* (${totalFiles} archivo${totalFiles !== 1 ? 's' : ''})...`,
        { parse_mode: 'Markdown' }
    );

    await sendProtectedContent(ctx, product);
});

purchasedContentScene.action('start_menu', async (ctx) => {
    try { await ctx.deleteMessage(); } catch (e) {}
    const { handleStart } = require('../handlers/start');
    await handleStart(ctx);
    return ctx.scene.leave();
});

module.exports = { purchasedContentScene };
