const { prisma } = require('../db/prisma');
const { Markup } = require('telegraf');
const { v4: uuidv4 } = require('uuid');

let cachedPrice = 0;
let lastFetchTime = 0;

async function getTonPriceUsd() {
    const now = Date.now();
    if (now - lastFetchTime < 60000 && cachedPrice > 0) { // cache por 1 minuto
        return cachedPrice;
    }
    try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd');
        if (res.ok) {
            const data = await res.json();
            if (data['the-open-network'] && data['the-open-network'].usd) {
                cachedPrice = data['the-open-network'].usd;
                lastFetchTime = now;
            }
        }
    } catch (e) {
        console.error("Error fetching TON price:", e);
    }
    return cachedPrice || 5.25; // fallback de seguridad
}

async function handleInlineQuery(ctx) {
    const rawQuery = ctx.inlineQuery.query.trim();
    if (!rawQuery) return;

    const queryLower = rawQuery.toLowerCase();
    let isSplit = false;
    let isSmartGift = false;
    let isShareProduct = false;
    let amountStr = '';
    let smartGiftId = null;
    let productId = null;

    if (queryLower.startsWith('dividir ')) {
        amountStr = queryLower.replace('dividir ', '').trim().replace(',', '.');
        isSplit = true;
    } else if (queryLower.startsWith('gift_')) {
        smartGiftId = rawQuery.replace('gift_', '').trim();
        isSmartGift = true;
    } else if (queryLower.startsWith('share_')) {
        productId = rawQuery.replace('share_', '').trim();
        isShareProduct = true;
    } else {
        amountStr = queryLower.replace(',', '.');
    }

    let amount = 0;
    if (!isSmartGift && !isShareProduct) {
        amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) return;
    }


    const telegramId = BigInt(ctx.from.id);
    
    try {
        const user = await prisma.user.findUnique({
            where: { telegramId },
            include: { wallets: true }
        });

        if (!user || user.wallets.length === 0) {
            return await ctx.answerInlineQuery([], {
                switch_pm_text: '❌ Necesitas una billetera primero.',
                switch_pm_parameter: 'create_wallet',
                cache_time: 0
            });
        }

        const amountNano = (amount * 1e9).toString();
        const tonPriceUsd = await getTonPriceUsd();
        const usdValue = (amount * tonPriceUsd).toFixed(2);
        
        let results = [];
        let balanceTon = 0;
        
        // Validación de balance: solo aplica a cheques de regalo (quien envía sí necesita los fondos)
        // "dividir" y "share" no requieren fondos del creador
        if (!isSmartGift && !isSplit && !isShareProduct) {
            const { getBalance } = require('../services/tonService');
            const primaryWallet = user.wallets.find(w => w.isPrimary) || user.wallets[0];
            const balanceNano = await getBalance(primaryWallet.address);
            balanceTon = Number(balanceNano) / 1e9;
            const feeBuffer = 0.03; // Margen para comisiones
            
            if (amount + feeBuffer > balanceTon) {
                const maxAvailable = Math.max(0, balanceTon - feeBuffer).toFixed(2);
                return await ctx.answerInlineQuery([], {
                    switch_pm_text: `❌ Saldo insuficiente (Máx: ${maxAvailable} GRAM)`,
                    switch_pm_parameter: 'insufficient_funds',
                    cache_time: 0
                });
            }
        }

        if (isShareProduct) {
            const product = await prisma.digitalProduct.findUnique({ where: { id: productId } });
            if (!product || product.sellerId !== user.id) return;

            const productPrice = Number(product.priceNano) / 1e9;
            const usdValue = (productPrice * await getTonPriceUsd()).toFixed(2);
            const deepLinkUrl = `https://t.me/${ctx.botInfo.username}?start=buy_${product.id}`;
            
            // Calcular total de archivos del paquete
            let extraFiles = [];
            if (product.mediaData) {
                try { extraFiles = JSON.parse(product.mediaData); } catch (e) {}
            }
            const totalFiles = 1 + extraFiles.length;

            // Construir texto base
            let messageText = `🏷️ **Título:** ${product.title}\n` +
                              `💎 **Precio:** ${productPrice} GRAM (~$${usdValue} USD)`;

            // Mostrar cantidad de archivos solo si hay más de uno
            if (totalFiles > 1) {
                messageText += `\n📦 **Paquete de ${totalFiles} archivos**`;
            }

            // Añadir metadata si existe (solo para producto de un archivo)
            if (product.description && totalFiles === 1) {
                try {
                    const metadata = JSON.parse(product.description);
                    messageText += `\n\n📄 **Detalles del Archivo:**`;

                    if (product.type === 'video') {
                        messageText += `\n🎥 Formato: Video`;
                        if (metadata.duration) messageText += `\n⏱ Duración: ${metadata.duration}s`;
                        if (metadata.fileName) messageText += `\n📁 Archivo: ${metadata.fileName}`;
                    } else if (product.type === 'document') {
                        messageText += `\n📎 Formato: Documento`;
                        if (metadata.fileName) messageText += `\n📁 Archivo: ${metadata.fileName}`;
                    } else if (product.type === 'audio' || product.type === 'voice') {
                        messageText += `\n🎵 Formato: Audio/Voz`;
                        if (metadata.duration) messageText += `\n⏱ Duración: ${metadata.duration}s`;
                        if (metadata.title) messageText += `\n🎤 Título: ${metadata.title}`;
                        if (metadata.performer) messageText += `\n👤 Artista: ${metadata.performer}`;
                        if (metadata.fileName) messageText += `\n📁 Archivo: ${metadata.fileName}`;
                    }
                } catch (e) {}
            }

            // Si hay imagen borrosa (blurredFileId), la enviamos como photo
            if (product.blurredFileId) {
                results = [{
                    type: 'photo',
                    id: product.id,
                    photo_file_id: product.blurredFileId,
                    title: `Vender: ${product.title}`,
                    description: `Precio: ${productPrice} GRAM`,
                    caption: messageText,
                    parse_mode: 'Markdown',
                    has_spoiler: true,
                    show_caption_above_media: false,
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.url(`💎 Pagar ${productPrice} GRAM y Desbloquear`, deepLinkUrl)]
                    ]).reply_markup
                }];
            } else {
                // Si es un documento/audio sin preview borrosa, enviamos un artículo
                results = [{
                    type: 'article',
                    id: product.id,
                    title: `🔒 Vender: ${product.title} (${productPrice} GRAM)`,
                    description: `Toca para compartir el enlace de venta en este chat.`,
                    thumbnail_url: 'https://em-content.zobj.net/source/apple/354/locked_1f512.png',
                    input_message_content: {
                        message_text: messageText,
                        parse_mode: 'Markdown'
                    },
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.url(`💎 Pagar ${productPrice} GRAM y Desbloquear`, deepLinkUrl)]
                    ]).reply_markup
                }];
            }
        } else if (isSmartGift) {
            const gift = await prisma.giftCheck.findUnique({ where: { id: smartGiftId } });
            if (!gift || gift.senderId !== user.id || gift.status !== 'PENDING') return;

            const giftAmount = Number(gift.amountNano) / 1e9;
            const usdValue = (giftAmount * await getTonPriceUsd()).toFixed(2);
            
            let conditionText = '';
            if (gift.conditionType === 'TIME') conditionText = '⏳ (Cápsula del Tiempo)';
            if (gift.conditionType === 'PASSWORD') conditionText = '🔐 (Acertijo)';

            results = [
                {
                    type: 'article',
                    id: gift.id,
                    title: `💎 Smart Gift de ${giftAmount} GRAM ${conditionText}`,
                    description: `Toca para enviar este Smart Gift al chat.`,
                    thumbnail_url: 'https://ton.org/download/ton_symbol.png',
                    input_message_content: {
                        message_text: `💎 **Smart Gift** ${conditionText}\n\n¡${ctx.from.first_name} ha enviado un regalo condicionado!\n💰 Monto: **${giftAmount} GRAM** (~$${usdValue} USD)\n\n👇 _Presiona el botón para intentar reclamarlo._`,
                        parse_mode: 'Markdown'
                    },
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.callback(`🎁 Reclamar Smart Gift`, `claim_gift_${gift.id}`)]
                    ]).reply_markup
                }
            ];
        } else if (isSplit) {
            const splitId = uuidv4();
            await prisma.splitBill.create({
                data: {
                    id: splitId,
                    creatorId: user.id,
                    totalAmountNano: amountNano,
                    status: 'OPEN'
                }
            });

            results = [
                {
                    type: 'article',
                    id: splitId,
                    title: `🤝 Dividir cuenta de ${amount} GRAM (~$${usdValue} USD)`,
                    description: `Envía para recaudar ${amount} GRAM entre el grupo.`,
                    thumbnail_url: 'https://ton.org/download/ton_symbol.png',
                    input_message_content: {
                        message_text: `🤝 **Dividir Cuenta (Split & Pay)**\n\n¡${ctx.from.first_name} está recaudando fondos!\n🎯 Meta Total: **${amount} GRAM** (~$${usdValue} USD)\n\n👇 _Presiona abajo para pagar tu parte._`,
                        parse_mode: 'Markdown'
                    },
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.url(`💳 Pagar mi parte`, `https://t.me/${ctx.botInfo.username}?start=split_${splitId}`)]
                    ]).reply_markup
                }
            ];
        } else {
            // Gift Check
            const giftId = uuidv4();
            await prisma.giftCheck.create({
                data: {
                    id: giftId,
                    senderId: user.id,
                    amountNano: amountNano,
                    status: 'PENDING'
                }
            });

            results = [
                {
                    type: 'article',
                    id: giftId,
                    title: `💎 Cheque de ${amount} GRAM (~$${usdValue} USD)`,
                    description: `Toca para enviar este cheque al chat.`,
                    thumbnail_url: 'https://ton.org/download/ton_symbol.png',
                    input_message_content: {
                        message_text: `💎 **Cheque de Regalo**\n\n¡${ctx.from.first_name} ha enviado un regalo!\n💰 Monto: **${amount} GRAM** (~$${usdValue} USD)\n\n👇 _El primero en presionar el botón abajo lo reclamará a su billetera._`,
                        parse_mode: 'Markdown'
                    },
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.callback(`🎁 Reclamar ${amount} GRAM`, `claim_gift_${giftId}`)]
                    ]).reply_markup
                }
            ];
        }

        const extraOptions = { cache_time: 0 };
        if (!isSmartGift && !isSplit) {
            extraOptions.switch_pm_text = `✅ Saldo disponible: ${balanceTon.toFixed(2)} GRAM`;
            extraOptions.switch_pm_parameter = 'ok';
        } else if (isSplit) {
            extraOptions.switch_pm_text = `🤝 Modo: Solicitar recaudación grupal`;
            extraOptions.switch_pm_parameter = 'ok';
        }

        return await ctx.answerInlineQuery(results, extraOptions);

    } catch (e) {
        // Ignorar el error de "query is too old" porque es normal si el usuario deja de escribir un rato
        if (e.description && e.description.includes('query is too old')) {
            return;
        }
        console.error("Error en inline query:", e.message);
    }
}

module.exports = { handleInlineQuery };
