const sharp = require('sharp');

/**
 * Aplica un filtro de blur gaussiano profesional a un buffer de imagen.
 * @param {Buffer} imageBuffer - Buffer original de la imagen
 * @param {String} priceText - Ignorado, ya no se pone texto por petición del usuario
 * @returns {Buffer} - Buffer de la nueva imagen procesada
 */
async function createBlurredPreview(imageBuffer, priceText) {
    // Usamos sharp para un desenfoque gaussiano suave y profesional (blur de 60px)
    // También bajamos un poco el brillo para que parezca bloqueado.
    return await sharp(imageBuffer)
        .blur(60)
        .modulate({ brightness: 0.7 }) // Oscurece al 70%
        .png()
        .toBuffer();
}

/**
 * Descarga el archivo desde Telegram y crea una preview borrosa.
 * @param {Object} ctx - El contexto de Telegraf
 * @param {String} fileId - ID del archivo en Telegram
 * @param {String} priceText - El texto de precio (ej. "5 GRAM")
 * @returns {Buffer|null} - El buffer de la imagen borrosa, o null si falla (o si no es imagen)
 */
async function processTelegramImagePreview(ctx, fileId, priceText) {
    try {
        const fileUrl = await ctx.telegram.getFileLink(fileId);
        const response = await fetch(fileUrl.href);
        const arrayBuffer = await response.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);
        
        return await createBlurredPreview(imageBuffer, priceText);
    } catch (e) {
        console.error("Error processing telegram image:", e.message);
        return null;
    }
}

module.exports = {
    createBlurredPreview,
    processTelegramImagePreview
};
