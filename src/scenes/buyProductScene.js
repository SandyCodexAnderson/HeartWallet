const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { sendTon, getBalance } = require('../services/tonService');
const { v4: uuidv4 } = require('uuid');

const buyProductWizard = new Scenes.WizardScene(
    'BUY_PRODUCT_SCENE',
    // Paso 1: Mostrar producto y confirmar pago
    async (ctx) => {
        const { productId } = ctx.scene.session;
        if (!productId) return ctx.scene.leave();

        const telegramId = BigInt(ctx.from.id);
        const buyer = await prisma.user.findUnique({
            where: { telegramId },
            include: { wallets: true }
        });

        if (!buyer || buyer.wallets.length === 0) {
            await ctx.reply("❌ Necesitas una billetera en HeartWallet para comprar contenido. Por favor crea o importa una primero usando /start.");
            return ctx.scene.leave();
        }

        const product = await prisma.digitalProduct.findUnique({
            where: { id: productId },
            include: { seller: { include: { wallets: true } } }
        });

        if (!product) {
            await ctx.reply("❌ El producto ya no existe.");
            return ctx.scene.leave();
        }

        if (product.seller.telegramId === telegramId) {
            await ctx.reply("❌ No puedes comprar tu propio producto.");
            return ctx.scene.leave();
        }

        // Verificar si ya lo compró
        const existingPurchase = await prisma.purchase.findFirst({
            where: { productId: product.id, buyerId: buyer.id }
        });

        if (existingPurchase) {
            await ctx.reply(
                `✅ **Ya compraste este contenido anteriormente.**\n\n` +
                `Te lo enviaré de nuevo ahora mismo...`
            );
            return sendProtectedContent(ctx, product);
        }

        const priceTon = Number(product.priceNano) / 1e9;
        
        ctx.scene.session.product = product;
        ctx.scene.session.buyer = buyer;
        ctx.scene.session.priceTon = priceTon;

        const msgText = 
            `🛒 **Comprar Contenido**\n\n` +
            `🏷️ **Título:** ${product.title}\n` +
            `👤 **Vendedor:** ${product.seller.firstName || 'Anónimo'}\n` +
            `💰 **Precio:** ${priceTon} GRAM\n\n` +
            `¿Deseas confirmar la compra? Se descontará el saldo de tu billetera principal.`;

        if (product.blurredFileId) {
            await ctx.replyWithPhoto(product.blurredFileId, {
                caption: msgText,
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`✅ Pagar ${priceTon} GRAM y Desbloquear`, 'confirm_buy_product')],
                    [Markup.button.callback('❌ Cancelar', 'cancel_buy')]
                ])
            });
        } else {
            await ctx.reply(msgText, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`✅ Pagar ${priceTon} GRAM y Desbloquear`, 'confirm_buy_product')],
                    [Markup.button.callback('❌ Cancelar', 'cancel_buy')]
                ])
            });
        }

        return ctx.wizard.next();
    },

    // Paso 2: Procesar el pago
    async (ctx) => {
        if (!ctx.callbackQuery || (ctx.callbackQuery.data !== 'confirm_buy_product' && ctx.callbackQuery.data !== 'cancel_buy')) {
            return;
        }

        await ctx.answerCbQuery();
        try { await ctx.deleteMessage(); } catch (e) {}

        if (ctx.callbackQuery.data === 'cancel_buy') {
            await ctx.reply("🚫 Compra cancelada.");
            return ctx.scene.leave();
        }

        const { config } = require('../config/env');
        
        const { product, buyer, priceTon } = ctx.scene.session;
        const buyerWallet = buyer.wallets.find(w => w.isPrimary) || buyer.wallets[0];

        const waitMsg = await ctx.reply("⏳ Validando saldo y transfiriendo fondos a la Billetera de Retención Segura...");

        try {
            // 1. Validar Saldo del comprador
            const balanceNano = await getBalance(buyerWallet.address);
            const balanceTon = Number(balanceNano) / 1e9;
            const gasFee = 0.03; // margen para el gas de la transferencia

            if (priceTon + gasFee > balanceTon) {
                await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
                const maxAvailable = Math.max(0, balanceTon - gasFee).toFixed(2);
                await ctx.reply(`❌ **Saldo insuficiente.**\n\nTienes ${balanceTon.toFixed(2)} GRAM, pero necesitas ${priceTon + gasFee} GRAM (incluyendo la comisión de red).\nMáximo disponible para enviar: ${maxAvailable} GRAM.`);
                return ctx.scene.leave();
            }

            // 2. Ejecutar Transferencia On-Chain hacia el Escrow (Bot)
            // sendTon(encryptedPrivateKey, toAddress, amountNanoTon, memo)
            const priceNano = Math.floor(priceTon * 1e9).toString();
            await sendTon(
                buyerWallet.encryptedPrivateKey,
                config.escrowWalletAddress,
                priceNano,
                `Store Escrow: ${product.id}`
            );

            // 3. Registrar Compra en DB en estado ESCROW (Liberación en 24h)
            const unlockTime = new Date();
            unlockTime.setHours(unlockTime.getHours() + 24); // 24 horas de protección al comprador

            await prisma.purchase.create({
                data: {
                    productId: product.id,
                    buyerId: buyer.id,
                    txHash: 'on-chain-pending',
                    status: 'ESCROW',
                    unlockTime: unlockTime
                }
            });

            await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
            await ctx.reply(`✅ **¡Pago retenido exitosamente!**\n\nHas pagado ${priceTon} GRAM. Los fondos están protegidos por 24 horas.\n\nAquí tienes tu contenido:`);

            // 4. Enviar archivo protegido
            await sendProtectedContent(ctx, product);

        } catch (error) {
            console.error("Error processing purchase:", error);
            await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
            await ctx.reply("❌ Hubo un error al procesar el pago. Por favor intenta de nuevo más tarde.");
        }

        return ctx.scene.leave();
    }
);

const { sendProtectedContent } = require('../utils/sendProtectedContent');

module.exports = { buyProductWizard };
