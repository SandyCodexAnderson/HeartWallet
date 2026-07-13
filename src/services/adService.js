const { prisma } = require('../db/prisma');
const { Markup } = require('telegraf');

/**
 * Muestra un anuncio activo y devuelve el ID del mensaje enviado (o editado).
 * @param {object} ctx Contexto de telegraf
 * @param {string} loadingText Texto de espera a mostrar (ej. "⏳ Procesando...")
 * @param {number} editMessageId Opcional. Si se pasa, intentará editar este mensaje en lugar de enviar uno nuevo (solo funciona si el ad no tiene imagen).
 * @returns {Promise<{adShown: boolean, messageId: number|null}>}
 */
async function displayAd(ctx, loadingText, editMessageId = null) {
    try {
        const activeAds = await prisma.adCampaign.findMany({
            where: { status: 'ACTIVE' }
        });

        if (activeAds.length === 0) {
            return { adShown: false, messageId: editMessageId };
        }

        const activeAd = activeAds[Math.floor(Math.random() * activeAds.length)];

        const adText = 
            `📢 **Mensaje de nuestro Patrocinador:**\n\n` +
            `_${activeAd.text}_\n\n` +
            `*${loadingText}*`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url(activeAd.buttonText, activeAd.url)]
        ]);

        let sentMsgId = editMessageId;

        if (activeAd.mediaId) {
            // Intentar editar la media del mensaje actual si es posible
            if (editMessageId) {
                try {
                    await ctx.telegram.editMessageMedia(
                        ctx.chat.id, 
                        editMessageId, 
                        null, 
                        { type: activeAd.mediaType, media: activeAd.mediaId, caption: adText, parse_mode: 'Markdown' },
                        { reply_markup: keyboard.reply_markup }
                    );
                    sentMsgId = editMessageId;
                } catch (e) {
                    // Fallback: Si no se pudo editar (ej. el mensaje anterior no era media), borramos y mandamos nuevo
                    await ctx.telegram.deleteMessage(ctx.chat.id, editMessageId).catch(() => {});
                    let adMsg;
                    if (activeAd.mediaType === 'photo') {
                        adMsg = await ctx.telegram.sendPhoto(ctx.chat.id, activeAd.mediaId, { caption: adText, parse_mode: 'Markdown', ...keyboard });
                    } else {
                        adMsg = await ctx.telegram.sendVideo(ctx.chat.id, activeAd.mediaId, { caption: adText, parse_mode: 'Markdown', ...keyboard });
                    }
                    sentMsgId = adMsg.message_id;
                }
            } else {
                let adMsg;
                if (activeAd.mediaType === 'photo') {
                    adMsg = await ctx.telegram.sendPhoto(ctx.chat.id, activeAd.mediaId, { caption: adText, parse_mode: 'Markdown', ...keyboard });
                } else {
                    adMsg = await ctx.telegram.sendVideo(ctx.chat.id, activeAd.mediaId, { caption: adText, parse_mode: 'Markdown', ...keyboard });
                }
                sentMsgId = adMsg.message_id;
            }
        } else {
            // Si solo es texto
            if (editMessageId) {
                try {
                    await ctx.telegram.editMessageText(ctx.chat.id, editMessageId, null, adText, { parse_mode: 'Markdown', ...keyboard, disable_web_page_preview: true });
                } catch(e) {
                    // Fallback: si falla la edición (por ejemplo, al intentar editar un mensaje con foto), lo borramos y enviamos uno nuevo
                    await ctx.telegram.deleteMessage(ctx.chat.id, editMessageId).catch(() => {});
                    const adMsg = await ctx.reply(adText, { parse_mode: 'Markdown', ...keyboard, disable_web_page_preview: true });
                    sentMsgId = adMsg.message_id;
                }
            } else {
                const adMsg = await ctx.reply(adText, { parse_mode: 'Markdown', ...keyboard, disable_web_page_preview: true });
                sentMsgId = adMsg.message_id;
            }
        }

        // Registrar la vista
        await prisma.adCampaign.update({
            where: { id: activeAd.id },
            data: { 
                viewsCurrent: { increment: 1 },
                status: (activeAd.viewsCurrent + 1 >= activeAd.viewsTarget) ? 'COMPLETED' : 'ACTIVE'
            }
        });

        return { adShown: true, messageId: sentMsgId };
    } catch (e) {
        console.error("Error showing ad:", e);
        return { adShown: false, messageId: editMessageId };
    }
}

module.exports = { displayAd };
