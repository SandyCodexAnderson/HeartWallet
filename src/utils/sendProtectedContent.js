/**
 * Envía todos los archivos de un producto de forma protegida (sin reenvío ni descarga).
 * Soporta productos con un solo archivo o paquetes de múltiples archivos.
 * 
 * @param {object} ctx - Contexto de Telegraf
 * @param {object} product - Objeto DigitalProduct de Prisma
 */
async function sendProtectedContent(ctx, product) {
    const protect = { protect_content: true };

    // Parsear archivos extra si existen
    let extraFiles = [];
    if (product.mediaData) {
        try { extraFiles = JSON.parse(product.mediaData); } catch (e) {}
    }

    // Archivo principal
    const primaryFile = { fileId: product.fileId, fileType: product.type };
    const allFiles = [primaryFile, ...extraFiles.map(f => ({ fileId: f.fileId, fileType: f.fileType }))];

    try {
        if (allFiles.length === 1) {
            // ── Un solo archivo ──────────────────────────────────────────
            await sendSingleFile(ctx, allFiles[0].fileId, allFiles[0].fileType, protect);
        } else {
            // ── Paquete de múltiples archivos ────────────────────────────
            // Telegram sendMediaGroup soporta hasta 10 items de tipo photo/video.
            // Documentos y audios deben enviarse uno a uno.

            const mediaGroupItems = [];
            const soloItems = []; // documentos, audios, voz

            for (const file of allFiles) {
                if (file.fileType === 'photo' || file.fileType === 'video') {
                    mediaGroupItems.push(file);
                } else {
                    soloItems.push(file);
                }
            }

            // Enviar grupo de fotos/videos de a máximo 10
            for (let i = 0; i < mediaGroupItems.length; i += 10) {
                const chunk = mediaGroupItems.slice(i, i + 10);
                const media = chunk.map((f, idx) => {
                    const item = { type: f.fileType === 'photo' ? 'photo' : 'video', media: f.fileId };
                    if (idx === 0) item.caption = `📦 *${product.title}* — ${allFiles.length} archivos`;
                    return item;
                });
                await ctx.telegram.sendMediaGroup(ctx.chat.id, media, { protect_content: true });
            }

            // Enviar documentos/audios sueltos
            for (const file of soloItems) {
                await sendSingleFile(ctx, file.fileId, file.fileType, protect);
            }
        }

        await ctx.reply(
            `📦 Este paquete (${allFiles.length} archivo${allFiles.length !== 1 ? 's' : ''}) se ha guardado en tu *Historial de Compras*.\n` +
            `Puedes volver a descargarlo cuando quieras desde el menú de tu billetera.`,
            { parse_mode: 'Markdown' }
        );

    } catch (e) {
        console.error("Error sending protected content:", e);
        await ctx.reply("❌ Hubo un error al enviarte los archivos. Contacta a soporte.");
    }
}

async function sendSingleFile(ctx, fileId, fileType, extra = {}) {
    switch (fileType) {
        case 'photo':    return ctx.replyWithPhoto(fileId, extra);
        case 'video':    return ctx.replyWithVideo(fileId, extra);
        case 'voice':    return ctx.replyWithVoice(fileId, extra);
        case 'audio':    return ctx.replyWithAudio(fileId, extra);
        default:         return ctx.replyWithDocument(fileId, extra);
    }
}

module.exports = { sendProtectedContent };
