const { prisma } = require('../db/prisma');
const { sendTon } = require('./tonService');
const { decryptData } = require('./cryptoService');
const { logInfo, logError, logSuccess } = require('../utils/logger');
const { fromNano } = require('@ton/ton');

async function processSubscriptions(bot) {
    try {
        logInfo('Iniciando procesamiento de suscripciones...');
        const now = new Date();

        const activeSubs = await prisma.subscription.findMany({
            where: {
                status: 'ACTIVE',
                nextRunAt: { lte: now }
            },
            include: {
                plan: { include: { creator: true } },
                subscriber: true,
                wallet: true
            }
        });

        for (const sub of activeSubs) {
            try {
                // Buscar billetera del creador para enviarle los fondos
                const creatorWallet = await prisma.wallet.findFirst({
                    where: { userId: sub.plan.creatorId },
                    orderBy: { isPrimary: 'desc' }
                });

                if (!creatorWallet) {
                    logError(`El creador del plan ${sub.plan.id} no tiene billeteras. No se puede procesar pago.`);
                    continue;
                }

                const { config } = require('../config/env');
                if (!config.escrowWalletAddress) {
                    logError(`El sistema de Escrow no está configurado. No se puede procesar suscripción ${sub.id}`);
                    continue;
                }

                logInfo(`Procesando suscripción ${sub.id} de ${sub.subscriber.telegramId} a ${sub.plan.creator.telegramId}...`);
                
                const privateKey = decryptData(sub.wallet.encryptedPrivateKey);
                const txHash = await sendTon(sub.wallet, config.escrowWalletAddress, sub.plan.priceNano, privateKey, "Pago recurrente: " + sub.plan.name);

                if (txHash) {
                    // Éxito: reprogramar para el próximo ciclo
                    const nextDate = new Date(now);
                    nextDate.setDate(nextDate.getDate() + sub.plan.intervalDays);
                    const unlockTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24 hours

                    await prisma.subscription.update({
                        where: { id: sub.id },
                        data: { nextRunAt: nextDate }
                    });

                    await prisma.subscriptionPayment.create({
                        data: {
                            subscriptionId: sub.id,
                            amountNano: sub.plan.priceNano,
                            status: 'ESCROW',
                            unlockTime: unlockTime
                        }
                    });

                    // Notificar
                    const amountGram = fromNano(sub.plan.priceNano);
                    await bot.telegram.sendMessage(sub.subscriber.telegramId.toString(), `✅ *Pago Exitoso*\nSe procesó automáticamente el pago de ${amountGram} GRAM para tu suscripción a *${sub.plan.name}*. Los fondos estarán protegidos en retención por 24h.`, { parse_mode: 'Markdown' }).catch(()=>{});
                    await bot.telegram.sendMessage(sub.plan.creator.telegramId.toString(), `💸 *Nuevo Ingreso*\nHas recibido ${amountGram} GRAM por la renovación de suscripción a *${sub.plan.name}* (En retención de seguridad por 24h).`, { parse_mode: 'Markdown' }).catch(()=>{});
                    
                    logSuccess(`Suscripción ${sub.id} pagada exitosamente y puesta en retención.`);
                } else {
                    throw new Error("Transacción fallida al firmar (sendTon retornó null)");
                }
            } catch (err) {
                // Fallo (probablemente fondos insuficientes o error de red)
                logError(`Suscripción ${sub.id} falló: ${err.message}`);
                
                await prisma.subscription.update({
                    where: { id: sub.id },
                    data: { status: 'FAILED_FUNDS' }
                });

                const amountGram = fromNano(sub.plan.priceNano);
                
                // Notificar al cliente
                await bot.telegram.sendMessage(
                    sub.subscriber.telegramId.toString(), 
                    `❌ *Suscripción Fallida*\nNo pudimos procesar el pago de ${amountGram} GRAM para *${sub.plan.name}* (posiblemente por falta de fondos o para cubrir el gas).\nLa suscripción ha sido pausada. Ve a *Mis Suscripciones* para renovarla manualmente.`, 
                    { parse_mode: 'Markdown' }
                ).catch(()=>{});

                // Expulsar del VIP si aplica
                if (sub.plan.chatId) {
                    try {
                        const chatId = sub.plan.chatId.toString();
                        const userId = Number(sub.subscriber.telegramId);
                        await bot.telegram.banChatMember(chatId, userId);
                        await bot.telegram.unbanChatMember(chatId, userId); // Desbanear inmediatamente para que pueda volver a unirse después de pagar
                        await bot.telegram.sendMessage(sub.subscriber.telegramId.toString(), `⚠️ Has sido retirado del grupo *${sub.plan.chatName}* debido a la falta de pago mensual.`, { parse_mode: 'Markdown' }).catch(()=>{});
                    } catch (kickErr) {
                        logError(`No se pudo expulsar al usuario del grupo VIP ${sub.plan.chatId}. ¿El bot es admin?: ${kickErr.message}`);
                    }
                }
            }
        }
    } catch (e) {
        logError(`Error general en processSubscriptions: ${e.message}`);
    }
}

function startCronService(bot) {
    // Revisar cada 1 hora (3600000 ms)
    const HOUR_MS = 60 * 60 * 1000;
    setInterval(() => processSubscriptions(bot), HOUR_MS);
    
    // Ejecutar también apenas inicie el bot (tras 10 segs de gracia)
    setTimeout(() => processSubscriptions(bot), 10000);
}

module.exports = { startCronService, processSubscriptions };
