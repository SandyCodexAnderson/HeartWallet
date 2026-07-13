const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const fetch = require('node-fetch');
const { config } = require('../config/env');
const { fromNano } = require('@ton/ton');

async function fetchUserNfts(address) {
    const url = `https://tonapi.io/v2/accounts/${address}/nfts?limit=30&indirect_ownership=false`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.nft_items || [];
}

// Categorías de Fragment como links directos
const FRAGMENT_CATEGORIES = [
    [Markup.button.url('🎁 Gifts / Coleccionables', 'https://fragment.com/gifts')],
    [Markup.button.url('👤 Usernames de Telegram', 'https://fragment.com/usernames')],
    [Markup.button.url('📱 Números de Teléfono', 'https://fragment.com/numbers')],
    [Markup.button.url('⭐ Paquetes de Stars', 'https://fragment.com/stars')],
    [Markup.button.url('💎 Telegram Premium', 'https://fragment.com/premium')],
];

const fragmentWizard = new Scenes.WizardScene(
    'FRAGMENT_SCENE',

    // Paso 0: Menú principal Fragment — edita el mensaje existente
    async (ctx) => {
        const walletId = ctx.scene.state?.walletId || ctx.scene.session.walletId;
        ctx.scene.session.walletId = walletId;
        if (ctx.callbackQuery) await ctx.answerCbQuery('🏪 Fragment Marketplace...');

        const buttons = [
            [Markup.button.callback('🎁 Mis Coleccionables / NFTs en Fragment', 'frag_my_nfts')],
            [Markup.button.callback('🏪 Explorar Fragment (Comprar)', 'frag_explore')],
            [Markup.button.callback('⬅️ Volver a Mis NFTs', `view_nft_${walletId}_0`)],
        ];

        const text = '🎪 *Fragment Marketplace*\n\n' +
            'Fragment es el marketplace oficial de Telegram para Coleccionables, Usernames, Números y más.\n\n' +
            '¿Qué deseas hacer?';

        // Editar caption si es mensaje con foto, o editar texto si es texto
        try {
            await ctx.editMessageCaption(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        } catch(e) {
            try {
                await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            } catch(e2) {
                await ctx.deleteMessage().catch(() => {});
                const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                ctx.scene.session.promptId = msg.message_id;
            }
        }

        return ctx.wizard.next();
    },

    // Paso 1: Handlers del menú
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        const walletId = ctx.scene.session.walletId;

        const backToMainButtons = [
            [Markup.button.callback('🎁 Mis Coleccionables / NFTs en Fragment', 'frag_my_nfts')],
            [Markup.button.callback('🏪 Explorar Fragment (Comprar)', 'frag_explore')],
            [Markup.button.callback('⬅️ Volver a Mis NFTs', `view_nft_${walletId}_0`)],
        ];
        const mainText = '🎪 *Fragment Marketplace*\n\n¿Qué deseas hacer?';

        if (action === 'frag_explore') {
            const urlButtons = [
                ...FRAGMENT_CATEGORIES,
                [Markup.button.callback('⬅️ Volver', 'frag_back')],
            ];
            const text = '🏪 *Explorar Fragment*\n\n' +
                'Toca una categoría para abrirla en Fragment.\n' +
                '_Para comprar, conecta tu wallet usando el menú principal y paga con tu HeartWallet._';
            try {
                await ctx.editMessageCaption(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(urlButtons) });
            } catch(e) {
                await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(urlButtons) }).catch(() => {});
            }
            return;
        }

        if (action === 'frag_back') {
            try {
                await ctx.editMessageCaption(mainText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(backToMainButtons) });
            } catch(e) {
                await ctx.editMessageText(mainText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(backToMainButtons) }).catch(() => {});
            }
            return;
        }

        if (action === 'frag_my_nfts') {
            const loadingText = '🔍 _Buscando tus coleccionables en la blockchain..._';
            try {
                await ctx.editMessageCaption(loadingText, { parse_mode: 'Markdown' });
            } catch(e) {
                await ctx.editMessageText(loadingText, { parse_mode: 'Markdown' }).catch(() => {});
            }

            const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
            if (!wallet) {
                await ctx.editMessageText('❌ Billetera no encontrada.').catch(() => {});
                return ctx.scene.leave();
            }

            let nfts = [];
            try { nfts = await fetchUserNfts(wallet.address); } catch(e) {}

            if (nfts.length === 0) {
                const emptyButtons = [
                    ...FRAGMENT_CATEGORIES.slice(0, 1), // solo Gifts
                    [Markup.button.callback('⬅️ Volver', 'frag_back')],
                ];
                const emptyText = '🎁 *Mis Coleccionables*\n\n' +
                    'No se encontraron NFTs en esta billetera.\n\n' +
                    '¿Quieres ir a Fragment a comprar tu primer coleccionable?';
                try {
                    await ctx.editMessageCaption(emptyText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(emptyButtons) });
                } catch(e) {
                    await ctx.editMessageText(emptyText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(emptyButtons) }).catch(() => {});
                }
                return;
            }

            ctx.scene.session.nfts = nfts;
            ctx.scene.session.nftIndex = 0;
            await showFragmentNft(ctx, 0);
            return;
        }

        // Navegar entre NFTs
        if (action === 'frag_nft_prev' || action === 'frag_nft_next') {
            const delta = action === 'frag_nft_next' ? 1 : -1;
            const nfts = ctx.scene.session.nfts || [];
            ctx.scene.session.nftIndex = Math.max(0, Math.min(
                (ctx.scene.session.nftIndex || 0) + delta,
                nfts.length - 1
            ));
            await showFragmentNft(ctx, ctx.scene.session.nftIndex);
            return;
        }

        // Salir hacia la vista de NFTs del wallet
        if (action.startsWith('view_nft_')) {
            ctx.scene.leave();
            const { handleViewNFTs } = require('../handlers/wallet');
            return handleViewNFTs(ctx);
        }
    }
);

async function showFragmentNft(ctx, index) {
    const nfts = ctx.scene.session.nfts;
    const walletId = ctx.scene.session.walletId;
    const nft = nfts[index];
    if (!nft) return;

    const total = nfts.length;
    const name = nft.metadata?.name || nft.dns || `NFT #${index + 1}`;
    const collection = nft.collection?.name || '';
    const imageUrl = nft.previews?.find(p => p.resolution === '500x500')?.url
        || nft.previews?.[nft.previews.length - 1]?.url
        || null;

    let saleInfo = '';
    if (nft.sale?.price?.value) {
        const price = parseFloat(fromNano(nft.sale.price.value)).toFixed(2);
        saleInfo = `\n💰 *En venta por:* \`${price} GRAM\``;
    }

    const fragUrl = nft.dns
        ? `https://fragment.com/${nft.dns}`
        : `https://tonviewer.com/${nft.address}`;

    const caption =
        `🎁 *${name}*\n` +
        (collection ? `📦 ${collection}\n` : '') +
        `_(${index + 1} de ${total})_` +
        saleInfo;

    const navRow = [];
    if (index > 0) navRow.push(Markup.button.callback('◀️ Ant.', 'frag_nft_prev'));
    if (index < total - 1) navRow.push(Markup.button.callback('Sig. ▶️', 'frag_nft_next'));

    const keyboard = Markup.inlineKeyboard([
        navRow.length > 0 ? navRow : [],
        [Markup.button.url('🔗 Ver en Fragment/Explorer', fragUrl)],
        [Markup.button.callback('⬅️ Volver', 'frag_back')],
    ].filter(r => r.length > 0));

    // Intentar editar con foto, si no funciona, eliminar y enviar nueva
    if (imageUrl) {
        try {
            await ctx.editMessageMedia(
                { type: 'photo', media: imageUrl, caption, parse_mode: 'Markdown' },
                keyboard
            );
            return;
        } catch(e) {
            // Intentar borrar y reenviar con foto
            try {
                await ctx.deleteMessage();
                const sent = await ctx.replyWithPhoto(imageUrl, { caption, parse_mode: 'Markdown', ...keyboard });
                return;
            } catch(e2) { /* caer a texto */ }
        }
    }

    // Sin imagen: editar como texto
    try {
        await ctx.editMessageCaption(caption, { parse_mode: 'Markdown', ...keyboard });
    } catch(e) {
        await ctx.editMessageText(caption, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
    }
}

module.exports = { fragmentWizard };
