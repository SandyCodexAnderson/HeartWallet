const { prisma } = require('../db/prisma');
const { getBalance, generateWallet, getNftHistoryAndValue } = require('../services/tonService');
const { encryptPrivateKey } = require('../services/cryptoService');
const { generateWalletImage } = require('../utils/canvasWallet');
const { Markup } = require('telegraf');
const { handleStart } = require('./start');

const lastUpdateMap = new Map();

async function handleViewWallet(ctx) {
    if (!ctx.from || !ctx.callbackQuery) return;
    
    const action = ctx.callbackQuery.data;
    const walletId = parseInt(action.replace('view_wallet_', ''));
    const telegramId = BigInt(ctx.from.id);
    const now = Date.now();
    
    // Rate Limiting solo si la accion es estrictamente actualizar (misma vista)
    const cacheKey = `${telegramId}_${walletId}`;
    if (lastUpdateMap.has(cacheKey)) {
        const timeDiff = now - lastUpdateMap.get(cacheKey);
        if (timeDiff < 5000) {
            const secondsLeft = Math.ceil((5000 - timeDiff) / 1000);
            return await ctx.answerCbQuery(`Espera ${secondsLeft} segundos para volver a actualizar esta billetera.`, { show_alert: true });
        }
    }

    try {
        const { displayAd } = require('../services/adService');
        await ctx.answerCbQuery('🔄 Abriendo...').catch(() => {});

        // 1. Mostrar anuncio por 5 segundos
        const adResult = await displayAd(ctx, "⏳ Abriendo billetera... Por favor espera 5 segundos.", ctx.callbackQuery?.message?.message_id);
        if (adResult.adShown) {
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // 2. Continuar cargando billetera
        const wallet = await prisma.wallet.findUnique({
            where: { id: walletId },
            include: { user: true }
        });

        if (!wallet || wallet.user.telegramId !== telegramId) {
            return await ctx.reply("Billetera no encontrada o no te pertenece.");
        }

        const address = wallet.address;
        const balanceNano = await getBalance(address);

        // Consultar escrows pendientes para este vendedor
        let escrowCaption = '';
        try {
            const pendingEscrows = await prisma.purchase.findMany({
                where: {
                    status: 'ESCROW',
                    product: { seller: { telegramId } }
                },
                include: { product: true },
                orderBy: { unlockTime: 'asc' }
            });

            if (pendingEscrows.length > 0) {
                const totalEscrowNano = pendingEscrows.reduce((sum, p) => sum + BigInt(p.product.priceNano), 0n);
                const totalEscrowGram = (Number(totalEscrowNano) / 1e9).toFixed(2);

                // El más antiguo (primero en liberarse)
                const oldest = pendingEscrows[0];
                const now2 = new Date();
                const msLeft = new Date(oldest.unlockTime) - now2;
                const hoursLeft = Math.max(0, Math.floor(msLeft / 3600000));
                const minsLeft = Math.max(0, Math.floor((msLeft % 3600000) / 60000));

                escrowCaption = `\n\n🔒 <b>En Retención (Protección al Comprador):</b>\n` +
                    `💎 Total retenido: <b>${totalEscrowGram} GRAM</b> (${pendingEscrows.length} venta${pendingEscrows.length > 1 ? 's' : ''})\n` +
                    `⏳ Próxima liberación en: <b>${hoursLeft}h ${minsLeft}m</b>`;
            }
        } catch(e) { /* Si falla, simplemente no mostramos escrow info */ }

        // Agregamos el username si lo tiene
        const displayName = ctx.from.username || ctx.from.first_name;
        const imageBuffer = await generateWalletImage(balanceNano, address, displayName, wallet.connectedDapp, wallet.isPrimary, wallet.theme, wallet.name);

        const keyboardButtons = [
            [Markup.button.callback('🔄 Actualizar', `view_wallet_${walletId}`)],
            [
                Markup.button.callback('⬇️ Recibir', `receive_ton_${walletId}`),
                Markup.button.callback('⬆️ Enviar', `send_ton_${walletId}`)
            ],
            [
                Markup.button.callback('🎁 Crear Smart Gift', `create_smart_gift`),
                Markup.button.callback('📈 Inversiones', `invest_${walletId}`)
            ],
            [Markup.button.callback('📜 Historial de Movimientos', `tx_history_${walletId}`)],
            [Markup.button.callback('🖼 Mis NFTs / Coleccionables', `view_nft_${walletId}_0`)],
            [Markup.button.callback('❄️ Convertir a Cartera Fría', `cold_wallet_${walletId}`)],
            [Markup.button.callback('🎨 Personalizar', `customize_wallet_${walletId}`)],
        ];

        const moonpayUrl = `https://buy.moonpay.com/?currencyCode=ton&walletAddress=${wallet.address}&colorCode=%23FFB6C1`;
        const bitrefillUrl = `https://www.bitrefill.com/buy/?paymentMethod=ton`;
        
        keyboardButtons.splice(3, 0, [Markup.button.callback('💼 Vender Contenido', `sell_product_${walletId}`)], [Markup.button.callback('📦 Contenido Comprado', `purchased_content`)]);
        keyboardButtons.splice(5, 0, [
            Markup.button.callback('💎 Crear Club VIP / Suscripción', `create_subscription_${walletId}`),
        ]);
        keyboardButtons.splice(6, 0, [Markup.button.callback('📅 Mis Suscripciones', `my_subscriptions_0`)]);
        keyboardButtons.splice(7, 0, [Markup.button.webApp('💳 Comprar TON (MoonPay)', moonpayUrl)]);
        keyboardButtons.splice(6, 0, [Markup.button.callback('🛒 Gift Cards y Recargas', `giftcards_menu_${walletId}`)]);

        if (!wallet.isPrimary) {
            keyboardButtons.push([Markup.button.callback('⭐ Hacer Principal', `set_primary_${walletId}`)]);
        }

        keyboardButtons.push([Markup.button.callback('⬅️ Volver al menú', 'start_menu')]);
        
        const keyboard = Markup.inlineKeyboard(keyboardButtons);

        const caption = `<b>${wallet.name}</b>\n\nAquí puedes gestionar tus GRAM de forma sencilla.\n\n<i>(Usa el botón "Recibir" para ver tu dirección)</i>${escrowCaption}`;

        // Intentar transición suave editando la media si NO hubo ad
        if (!adResult.adShown && ctx.callbackQuery) {
            try {
                await ctx.editMessageMedia(
                    { type: 'photo', media: { source: imageBuffer }, caption, parse_mode: 'HTML' },
                    Markup.inlineKeyboard(keyboardButtons)
                );
                lastUpdateMap.set(cacheKey, now);
                return;
            } catch (e) {
                // Fallback si falla la edición
            }
        }
        // Si hubo ad, borramos el mensaje del ad (ya que podría ser texto) y enviamos foto nueva
        if (adResult && adResult.messageId) {
            await ctx.telegram.deleteMessage(ctx.chat.id, adResult.messageId).catch(()=>{});
        } else {
            try { await ctx.deleteMessage(); } catch(e) {}
        }
        await ctx.replyWithPhoto(
            { source: imageBuffer },
            { parse_mode: 'HTML', caption, ...keyboard }
        );

        lastUpdateMap.set(cacheKey, now);

    } catch (error) {
        console.error("Error in handleViewWallet:", error);
        await ctx.answerCbQuery("Hubo un error al cargar la billetera.", { show_alert: true });
    }
}

// Global cache for NFTs to avoid hitting the API constantly when paginating
const nftsCache = new Map();

async function handleViewNFTs(ctx) {
    if (!ctx.from || !ctx.callbackQuery) return;
    
    const dataParts = ctx.callbackQuery.data.split('_');
    const walletId = parseInt(dataParts[2]);
    const index = parseInt(dataParts[3] || '0');
    const telegramId = BigInt(ctx.from.id);

    try {
        await ctx.answerCbQuery('🖼 Cargando colección...');
        
        const wallet = await prisma.wallet.findUnique({
            where: { id: walletId },
            include: { user: true }
        });

        if (!wallet || wallet.user.telegramId !== telegramId) {
            return await ctx.answerCbQuery("Billetera no encontrada.", { show_alert: true });
        }

        let nfts = [];
        const cacheKey = `nfts_${walletId}`;
        
        // Use cache if viewing same wallet, else fetch
        if (nftsCache.has(cacheKey) && index > 0) {
            nfts = nftsCache.get(cacheKey);
        } else {
            const { getNfts } = require('../services/tonService');
            nfts = await getNfts(wallet.address);
            nftsCache.set(cacheKey, nfts);
        }

        if (nfts.length === 0) {
            const { generateEmptyNFTsImage } = require('../utils/canvasWallet');
            const emptyBuffer = generateEmptyNFTsImage();
            const media = {
                type: 'photo',
                media: { source: emptyBuffer },
                caption: "🖼 **Galería de Coleccionables**\n\nNo se encontraron NFTs en esta billetera.\n\n🏪 Puedes comprar coleccionables directamente en Fragment con tu HeartWallet.",
                parse_mode: 'Markdown'
            };
            const kb = Markup.inlineKeyboard([
                [Markup.button.webApp('🎪 Fragment Marketplace', 'https://fragment.com')],
                [Markup.button.callback('⬅️ Volver a Billetera', `view_wallet_${walletId}`)]
            ]);
            
            try {
                await ctx.editMessageMedia(media, kb);
            } catch (e) {
                try { await ctx.deleteMessage(); } catch(e2) {}
                await ctx.replyWithPhoto({ source: emptyBuffer }, { parse_mode: 'Markdown', caption: media.caption, ...kb });
            }
            return;
        }

        // Clamp index
        const safeIndex = Math.max(0, Math.min(index, nfts.length - 1));
        const nft = nfts[safeIndex];

        let imageUrl = 'https://ton.org/download/ton_symbol.png'; // fallback
        if (nft.previews && nft.previews.length > 0) {
            // Get highest res preview
            imageUrl = nft.previews[nft.previews.length - 1].url;
        } else if (nft.metadata && nft.metadata.image) {
            imageUrl = nft.metadata.image;
        }
        
        // Transform IPFS to http gateway if needed
        if (imageUrl.startsWith('ipfs://')) {
            imageUrl = imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
        }

        const name = nft.metadata?.name || 'NFT Desconocido';
        const collection = nft.collection?.name ? `\nColección: ${nft.collection.name}` : '';
        const description = nft.metadata?.description ? `\n\n📝 ${nft.metadata.description.substring(0, 150)}...` : '';
        const verified = nft.approved_by && nft.approved_by.length > 0 ? ' ✅' : '';

        const caption = `🖼 <b>${name}</b>${verified}${collection}${description}\n\nNFT ${safeIndex + 1} de ${nfts.length}`;

        const keyboardButtons = [];
        const navRow = [];
        
        if (safeIndex > 0) {
            navRow.push(Markup.button.callback('⬅️ Anterior', `view_nft_${walletId}_${safeIndex - 1}`));
        }
        if (safeIndex < nfts.length - 1) {
            navRow.push(Markup.button.callback('Siguiente ➡️', `view_nft_${walletId}_${safeIndex + 1}`));
        }
        
        if (navRow.length > 0) keyboardButtons.push(navRow);
        keyboardButtons.push([Markup.button.webApp('🎪 Fragment Marketplace', 'https://fragment.com')]);
        keyboardButtons.push([Markup.button.callback('⬅️ Volver a Billetera', `view_wallet_${walletId}`)]);

        const media = {
            type: 'photo',
            media: imageUrl,
            caption,
            parse_mode: 'HTML'
        };

        try {
            await ctx.editMessageMedia(media, Markup.inlineKeyboard(keyboardButtons));
        } catch (e) {
            try { await ctx.deleteMessage(); } catch(e2) {}
            await ctx.replyWithPhoto(imageUrl, { parse_mode: 'HTML', caption, ...Markup.inlineKeyboard(keyboardButtons) });
        }

    } catch (error) {
        console.error("Error in handleViewNFTs:", error);
        await ctx.answerCbQuery("Hubo un error al cargar tus NFTs.", { show_alert: true });
    }
}

async function handleCreateWallet(ctx) {
    if (!ctx.from) return;
    const telegramId = BigInt(ctx.from.id);
    
    await ctx.answerCbQuery('Preparando creación...');
    
    try {
        const user = await prisma.user.findUnique({
            where: { telegramId },
            include: { wallets: true }
        });
        
        if (!user) return;
        
        if (user.wallets.length >= user.maxWallets) {
            return await ctx.answerCbQuery("Has alcanzado tu límite de billeteras.", { show_alert: true });
        }
        
        try { await ctx.deleteMessage(); } catch(e) {}
        
        const msg = "✨ **Nueva Billetera**\n\n¿Deseas crear una billetera nueva y nativa de HeartWallet, o quieres importar una billetera externa usando sus 24 palabras secretas (Cold Wallet)?";
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('➕ Crear Billetera Nueva', 'start_create_wallet_scene')],
            [Markup.button.callback('⬇️ Importar Cold Wallet', 'start_import_wallet_scene')],
            [Markup.button.callback('⬅️ Cancelar', 'start_menu')]
        ]);
        
        return await ctx.reply(msg, { parse_mode: 'Markdown', ...keyboard });
        
    } catch (e) {
        console.error(e);
        await ctx.reply("❌ Ocurrió un error al preparar la billetera.");
    }
}

async function handleRequestExpansion(ctx) {
    await ctx.answerCbQuery();
    const username = ctx.from.username || ctx.from.first_name;
    const msg = `🌟 *¿Quieres más billeteras?*\n\nPara expandir tu límite, envía un **Regalo** con valor mínimo de **100 Telegram Stars** a nuestra administradora: \`@sandy_anderson\`.\n\n📝 En el mensaje del regalo (concepto) debes escribir exactamente:\n\`Expansión de wallets para @${username}\`\n\n_Un administrador revisará el regalo y expandirá tu límite manualmente en unas horas._`;
    
    const media = {
        type: 'photo',
        media: { source: require('path').join(__dirname, '../assets/ChatGPT Image 1 jul 2026, 07_34_38 p.m..png') }, // Fallback to logo or just keep text?
        // Wait, handleRequestExpansion is currently text. If the previous msg is a photo, editMessageText throws an error.
        // Let's just delete and send text, or use editMessageMedia?
        // Let's use delete and send text.
    };
    
    try { await ctx.deleteMessage(); } catch(e) {}
    await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al menú', 'start_menu')]])
    });
}

async function handleSupportProject(ctx) {
    await ctx.answerCbQuery();
    return ctx.scene.enter('DONATE_SCENE');
}

async function handleTxHistory(ctx) {
    if (!ctx.from || !ctx.callbackQuery) return;

    let walletId, page;
    if (ctx.match) {
        walletId = parseInt(ctx.match[1]);
        page = parseInt(ctx.match[2]) || 0;
    } else {
        const parts = ctx.callbackQuery.data.replace('tx_history_', '').split('_');
        walletId = parseInt(parts[0]);
        page = parseInt(parts[1]) || 0;
    }
    
    const telegramId = BigInt(ctx.from.id);

    try {
        await ctx.answerCbQuery('📜 Cargando historial...');

        const wallet = await prisma.wallet.findUnique({
            where: { id: walletId },
            include: { user: true }
        });

        if (!wallet || wallet.user.telegramId !== telegramId) {
            return await ctx.answerCbQuery("Billetera no encontrada.", { show_alert: true });
        }

        const { config } = require('../config/env');
        const fetch = require('node-fetch');
        const { fromNano } = require('@ton/ton');
        const apiBase = config.tonNetwork === 'mainnet'
            ? 'https://toncenter.com/api/v2/getTransactions'
            : 'https://testnet.toncenter.com/api/v2/getTransactions';

        // Fetch up to 100 txs to allow deep pagination
        const resp = await fetch(`${apiBase}?address=${wallet.address}&limit=100`);
        const data = await resp.json();
        const txs = (data.ok && data.result) ? data.result : [];

        if (txs.length === 0) {
            const buttons = [[Markup.button.callback('⬅️ Volver a Billetera', `view_wallet_${walletId}`)]];
            await ctx.editMessageCaption("📜 *Historial de Movimientos*\n\nAún no hay transacciones en esta billetera.", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return;
        }

        const ITEMS_PER_PAGE = 4;
        const totalPages = Math.ceil(txs.length / ITEMS_PER_PAGE);
        const safePage = Math.max(0, Math.min(page, totalPages - 1));
        
        const currentTxs = txs.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

        let msg = `📜 *Transacciones Recientes*\n*${wallet.name}* (Pág. ${safePage + 1}/${totalPages})\n\n`;

        const txButtons = [];
        let txIndex = 1;

        for (const tx of currentTxs) {
            const date = new Date(tx.utime * 1000).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
            const hasIn = tx.in_msg && tx.in_msg.value && BigInt(tx.in_msg.value) > 0n && tx.in_msg.source;
            const hasOut = tx.out_msgs && tx.out_msgs.length > 0;
            
            let hexHash = "";
            if (tx.transaction_id && tx.transaction_id.hash) {
                hexHash = Buffer.from(tx.transaction_id.hash, 'base64').toString('hex');
            }
            
            const txLabel = `Tx ${txIndex}`;
            if (hexHash) {
                txButtons.push(Markup.button.webApp(`🔍 ${txLabel}`, `https://tonviewer.com/transaction/${hexHash}`));
            }

            if (hasIn) {
                const amount = parseFloat(fromNano(tx.in_msg.value)).toFixed(4);
                const from = `${tx.in_msg.source.slice(0,6)}...${tx.in_msg.source.slice(-6)}`;
                const memo = tx.in_msg.message ? ` · _${tx.in_msg.message}_` : '';
                msg += `*${txLabel}* | 📥 *+${amount} GRAM*${memo}\n`;
                msg += `👤 \`${from}\`\n📅 ${date}\n\n`;
            } else if (hasOut) {
                for (const out of tx.out_msgs) {
                    if (!out.value || BigInt(out.value) === 0n) continue;
                    const amount = parseFloat(fromNano(out.value)).toFixed(4);
                    const to = out.destination ? `${out.destination.slice(0,6)}...${out.destination.slice(-6)}` : 'Contrato';
                    msg += `*${txLabel}* | 📤 *-${amount} GRAM*\n`;
                    msg += `👤 \`${to}\`\n📅 ${date}\n\n`;
                }
            } else {
                // Internal/contract call without value
                msg += `*${txLabel}* | ⚙️ *Llamada de Contrato*\n📅 ${date}\n\n`;
            }
            txIndex++;
        }

        const navButtons = [];
        if (safePage > 0) {
            navButtons.push(Markup.button.callback('⬅️ Anterior', `tx_history_${walletId}_${safePage - 1}`));
        }
        if (safePage < totalPages - 1) {
            navButtons.push(Markup.button.callback('Siguiente ➡️', `tx_history_${walletId}_${safePage + 1}`));
        }

        const keyboard = [];
        
        // Arrange txButtons in rows of 2
        for (let i = 0; i < txButtons.length; i += 2) {
            keyboard.push(txButtons.slice(i, i + 2));
        }
        
        if (navButtons.length > 0) keyboard.push(navButtons);
        keyboard.push([Markup.button.callback('⬅️ Volver a Billetera', `view_wallet_${walletId}`)]);

        await ctx.editMessageCaption(msg, { parse_mode: 'Markdown', disable_web_page_preview: true, ...Markup.inlineKeyboard(keyboard) });

    } catch (error) {
        console.error("Error in handleTxHistory:", error);
        await ctx.answerCbQuery("Hubo un error al cargar el historial.", { show_alert: true });
    }
}

async function handleGiftCardsMenu(ctx) {
    if (!ctx.from || !ctx.callbackQuery) return;
    
    const walletId = ctx.callbackQuery.data.split('_')[2];
    
    const caption = `🛒 <b>Gift Cards y Recargas</b>\n\n¿Eres residente de Cuba o de otro país?\n\n<i>Selecciona tu región para ver las opciones disponibles y pagar con tus GRAM.</i>`;
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('🇨🇺 Residente en Cuba (QvaPay)', 'https://www.qvapay.com/register/sandy1bm951')],
        [Markup.button.webApp('🌎 Otros Países (Bitrefill)', 'https://www.bitrefill.com/invite/9mnqhxag')],
        [Markup.button.callback('⬅️ Volver a Billetera', `view_wallet_${walletId}`)]
    ]);

    try {
        await ctx.editMessageCaption(caption, { parse_mode: 'HTML', ...keyboard });
    } catch (e) {
        console.error("Error editing caption for gift cards:", e);
    }
}

async function handleViewWalletById(ctx, walletId) {
    if (!ctx.from) return;
    const id = parseInt(walletId);
    if (!id || isNaN(id)) {
        console.error('[handleViewWalletById] walletId inválido:', walletId);
        return;
    }
    // Sobrescribimos SOLO el .data para que handleViewWallet parsee el walletId correctamente.
    // Preservamos .message si existe (para que displayAd pueda editar en lugar de crear nuevo).
    if (!ctx.callbackQuery) ctx.callbackQuery = {};
    ctx.callbackQuery.data = `view_wallet_${id}`;
    return handleViewWallet(ctx);
}

module.exports = { handleViewWallet, handleCreateWallet, handleRequestExpansion, handleSupportProject, handleViewNFTs, handleTxHistory, handleGiftCardsMenu, lastUpdateMap, handleViewWalletById };
