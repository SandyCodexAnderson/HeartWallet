const { prisma } = require('../db/prisma');
const { sendTon } = require('./tonService');
const { config } = require('../config/env');

const GAS_FEE_NANO = BigInt(20000000); // 0.02 TON en nanoTon para cubrir comisión de red

let isProcessing = false;

async function processEscrows() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        const now = new Date();
        
        // 1. Procesar Compras (Productos)
        const pendingPurchases = await prisma.purchase.findMany({
            where: { status: 'ESCROW', unlockTime: { lte: now } },
            include: { product: { include: { seller: { include: { wallets: true } } } } }
        });

        for (const purchase of pendingPurchases) {
            try {
                const sellerWallet = purchase.product.seller.wallets.find(w => w.isPrimary) || purchase.product.seller.wallets[0];
                if (!sellerWallet) continue;
                const priceNano = BigInt(purchase.product.priceNano);
                const releaseNano = priceNano - GAS_FEE_NANO;

                if (releaseNano <= 0n) {
                    await prisma.purchase.update({ where: { id: purchase.id }, data: { status: 'FAILED_LOW_AMOUNT' } });
                    continue;
                }

                await sendTon(config.escrowWalletEncryptedKey, sellerWallet.address, releaseNano.toString(), `Liberacion de fondos: ${purchase.product.title}`);
                await prisma.purchase.update({ where: { id: purchase.id }, data: { status: 'COMPLETED' } });
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
                console.error(`[EscrowService] Error procesando compra ${purchase.id}:`, err);
            }
        }

        // 2. Procesar Suscripciones
        const pendingSubs = await prisma.subscriptionPayment.findMany({
            where: { status: 'ESCROW', unlockTime: { lte: now } },
            include: { subscription: { include: { plan: { include: { creator: { include: { wallets: true } } } } } } }
        });

        for (const payment of pendingSubs) {
            try {
                const creatorWallet = payment.subscription.plan.creator.wallets.find(w => w.isPrimary) || payment.subscription.plan.creator.wallets[0];
                if (!creatorWallet) continue;

                const priceNano = BigInt(payment.amountNano);
                const releaseNano = priceNano - GAS_FEE_NANO;

                if (releaseNano <= 0n) {
                    await prisma.subscriptionPayment.update({ where: { id: payment.id }, data: { status: 'FAILED_LOW_AMOUNT' } });
                    continue;
                }

                await sendTon(config.escrowWalletEncryptedKey, creatorWallet.address, releaseNano.toString(), `Liberacion Suscripcion: ${payment.subscription.plan.name}`);
                await prisma.subscriptionPayment.update({ where: { id: payment.id }, data: { status: 'COMPLETED' } });
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
                console.error(`[EscrowService] Error procesando pago de suscripcion ${payment.id}:`, err);
            }
        }

    } catch (error) {
        console.error("[EscrowService] Error general:", error);
    }

    isProcessing = false;
}

function startEscrowService() {
    if (!config.escrowWalletAddress || !config.escrowWalletEncryptedKey) {
        console.warn("[EscrowService] Advertencia: Billetera de retención no configurada.");
        return;
    }
    
    // Verificar cada minuto, pero liberar solo los que cumplieron 24h
    setInterval(processEscrows, 60000);
    console.log("[EscrowService] ✅ Servicio de retención de 24h iniciado.");
}

module.exports = { startEscrowService };
