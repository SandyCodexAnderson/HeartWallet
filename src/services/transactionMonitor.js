const fetch = require('node-fetch');
const { prisma } = require('../db/prisma');
const { config } = require('../config/env');
const { fromNano } = require('@ton/ton');
const { logSuccess, logError, logInfo } = require('../utils/logger');

const endpoint = config.tonNetwork === 'mainnet'
    ? 'https://toncenter.com/api/v2/getTransactions'
    : 'https://testnet.toncenter.com/api/v2/getTransactions';

async function pollTransactions(bot) {
    try {
        const wallets = await prisma.wallet.findMany({ include: { user: true } });

        for (const wallet of wallets) {
            try {
                let url = `${endpoint}?address=${wallet.address}&limit=10`;
                if (config.toncenterApiKey) {
                    url += `&api_key=${config.toncenterApiKey}`;
                }
                
                const response = await fetch(url);
                if (!response.ok) continue;

                const data = await response.json();
                if (!data.ok || !data.result || data.result.length === 0) continue;

                const transactions = data.result;

                // Primera vez: guardar LT sin spamear historial viejo
                if (!wallet.lastTxLt) {
                    await prisma.wallet.update({
                        where: { id: wallet.id },
                        data: { lastTxLt: transactions[0].transaction_id.lt }
                    });
                    logInfo('MONITOR_INIT_WALLET', { walletId: wallet.id, walletName: wallet.name });
                    continue;
                }

                const lastLt = BigInt(wallet.lastTxLt);
                let highestLt = lastLt;
                const newTxs = transactions.filter(tx => BigInt(tx.transaction_id.lt) > lastLt).reverse();

                for (const tx of newTxs) {
                    const txLt = BigInt(tx.transaction_id.lt);
                    if (txLt > highestLt) highestLt = txLt;

                    // Depósito recibido
                    if (tx.in_msg?.value && BigInt(tx.in_msg.value) > 0n && tx.in_msg.source) {
                        const amountNano = tx.in_msg.value;
                        const source = tx.in_msg.source;
                        const memo = tx.in_msg.message || '';
                        const amountTon = parseFloat(fromNano(amountNano)).toFixed(4);

                        // Guardar en BD
                        await prisma.transaction.create({
                            data: {
                                userId: wallet.userId,
                                txHash: tx.transaction_id.hash,
                                type: 'DEPOSIT',
                                amount: amountNano,
                                status: 'COMPLETED',
                                toAddress: wallet.address
                            }
                        }).catch(() => {}); // Si ya existe el hash, ignorar

                        // Notificar al usuario
                        const msgText =
                            `🔔 *¡NUEVO DEPÓSITO RECIBIDO!*\n\n` +
                            `Recibiste fondos en tu billetera *${wallet.name}*.\n\n` +
                            `💰 *Cantidad:* \`${amountTon} GRAM\`\n` +
                            `📍 *De:* \`${source.slice(0, 10)}...${source.slice(-10)}\`\n` +
                            (memo ? `📝 *Concepto:* ${memo}\n` : '') +
                            `\n_¡Tu saldo ha sido actualizado!_`;

                        await bot.telegram.sendMessage(
                            Number(wallet.user.telegramId),
                            msgText,
                            { parse_mode: 'Markdown' }
                        ).catch(e => logError('MONITOR_NOTIFY_FAIL', e, {
                            walletId: wallet.id,
                            userId: wallet.user.telegramId?.toString()
                        }));

                        logSuccess('DEPOSIT_RECEIVED', {
                            walletId: wallet.id,
                            walletName: wallet.name,
                            user: wallet.user.telegramId?.toString(),
                            amount: amountTon + ' GRAM',
                            from: source.slice(0, 12) + '...',
                            memo,
                        });
                    }
                }

                // Actualizar LT si hubo nuevas txs
                if (highestLt > lastLt) {
                    await prisma.wallet.update({
                        where: { id: wallet.id },
                        data: { lastTxLt: highestLt.toString() }
                    });
                }

                // Pausa para no saturar la API
                await new Promise(r => setTimeout(r, 600));

            } catch (err) {
                // Silenciar errores temporales de red para no llenar los logs
                const isNetworkError = err.code === 'EAI_AGAIN' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || (err.message && err.message.includes('EAI_AGAIN'));
                if (isNetworkError) {
                    continue; // Simplemente ignorar e intentar de nuevo en el próximo ciclo
                }
                
                logError('MONITOR_POLL_WALLET', err, {
                    walletId: wallet.id,
                    walletAddress: wallet.address?.slice(0, 12)
                });
            }
        }
    } catch (e) {
        logError('MONITOR_POLL_ERROR', e, {});
    }
}

function startTransactionMonitor(bot) {
    logInfo('MONITOR_START', { note: 'Iniciando Monitor de Depósitos en Segundo Plano (cada 45s)...' });
    // Primera revisión a los 8 segundos
    setTimeout(() => pollTransactions(bot), 8000);
    // Luego cada 45 segundos
    setInterval(() => pollTransactions(bot), 45000);
}

module.exports = { startTransactionMonitor };
