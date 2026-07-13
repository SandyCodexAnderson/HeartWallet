const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { getBalance, getTsTonBalance, getTsTonPrice, stakeTon, getStakingHistory, getRealStakingApy } = require('../services/tonService');
const { hashData } = require('../services/cryptoService');
const { toNano, fromNano } = require('@ton/ton');
const { handleViewWallet } = require('../handlers/wallet');
const { generateStakingImage } = require('../utils/canvasStaking');
const { displayAd } = require('../services/adService');

// Cooldown map: userId -> timestamp of last refresh
const refreshCooldowns = new Map();
const REFRESH_COOLDOWN_MS = 5000; // 5 segundos

const stakingScene = new Scenes.WizardScene(
    'stakingScene',
    async (ctx) => {
        if (ctx.callbackQuery) {
            await ctx.deleteMessage().catch(() => {});
        }
        
        ctx.scene.session.walletId = ctx.scene.state.walletId || ctx.scene.session.walletId;
        const walletId = ctx.scene.session.walletId;
        if (!walletId) return cancelScene(ctx);

        const telegramId = BigInt(ctx.from.id);
        const wallet = await prisma.wallet.findUnique({
            where: { id: walletId, user: { telegramId } }
        });

        if (!wallet) return cancelScene(ctx);
        ctx.scene.session.wallet = wallet;

        const msg = await ctx.reply("🔄 Analizando tus inversiones en la blockchain...", { reply_markup: Markup.removeKeyboard() });
        ctx.scene.session.promptId = msg.message_id;

        const tonBalanceNano = await getBalance(wallet.address);
        const tonBalance = Number(fromNano(tonBalanceNano)).toFixed(2);
        
        const tsTonBalanceStr = await getTsTonBalance(wallet.address);
        const tsTonBalance = Number(tsTonBalanceStr);
        const tsTonPrice = await getTsTonPrice();
        
        const investedTon = (tsTonBalance * tsTonPrice).toFixed(4);
        
        // Precio USD del TON
        let tonUsdPrice = 3.0;
        try {
            const priceRes = await fetch(`https://tonapi.io/v2/rates?tokens=ton&currencies=usd`);
            const priceData = await priceRes.json();
            tonUsdPrice = priceData?.rates?.TON?.prices?.USD || 3.0;
        } catch(e) {}
        const investedUsd = (Number(investedTon) * tonUsdPrice).toFixed(2);

        // ─── Ganancias: JettonWallet → timestamps de mints → corr. con tx raw ───
        let gainTon = null;
        let gainUsd = null;
        try {
            const { Address } = require('@ton/ton');
            const TONSTAKERS_POOL = 'EQCkWxfyhAkim3g2DjKQQg8T5P4g-Q1-K_jErGcDJZ4i-vqR';
            const TSTON_MASTER    = 'EQC98_qAmNEptUtPc7W6xdHh_ZHrBUFpw5Ft_IzNU20QAJav';
            const poolRaw         = Address.parse(TONSTAKERS_POOL).toRawString();

            // 1) Encontrar el Jetton Wallet del usuario para tsTON
            const jRes  = await fetch(`https://tonapi.io/v2/accounts/${wallet.address}/jettons`);
            const jData = await jRes.json();
            const tsMasterRaw = Address.parse(TSTON_MASTER).toRawString();
            const tsEntry = (jData.balances || []).find(b => {
                try { return Address.parse(b.jetton.address).toRawString() === tsMasterRaw; } catch(e) { return false; }
            });

            if (tsEntry && tsEntry.wallet_address?.address) {
                const jwAddr = tsEntry.wallet_address.address;

                // 2) Eventos del Jetton Wallet → capturar timestamps de JettonMint exitosos
                const jwRes  = await fetch(`https://tonapi.io/v2/accounts/${jwAddr}/events?limit=50`);
                const jwData = await jwRes.json();
                const mintTimestamps = [];
                for (const event of jwData.events || []) {
                    for (const action of event.actions || []) {
                        if (action.type === 'JettonMint' && action.JettonMint) {
                            mintTimestamps.push(event.timestamp);
                        }
                    }
                }

                // 3) Transacciones raw del usuario: buscar TON enviado al pool ≤60s ANTES de cada mint
                if (mintTimestamps.length > 0) {
                    const txRes  = await fetch(`https://tonapi.io/v2/blockchain/accounts/${wallet.address}/transactions?limit=100`);
                    const txData = await txRes.json();
                    let totalInvested = 0;

                    for (const mintTs of mintTimestamps) {
                        // Buscar tx del usuario → pool dentro de ±120s antes del mint
                        for (const tx of txData.transactions || []) {
                            const diff = mintTs - tx.utime;
                            if (diff < 0 || diff > 120) continue; // solo txs antes del mint
                            for (const msg of tx.out_msgs || []) {
                                try {
                                    const destRaw = Address.parse(msg.destination?.address || '').toRawString();
                                    if (destRaw === poolRaw) {
                                        const tonSent = Number(msg.value) / 1e9;
                                        if (tonSent > 1.0) {
                                            totalInvested += tonSent - 1.0; // descontar gas requerido
                                        }
                                    }
                                } catch(e2) {}
                            }
                        }
                    }

                    if (totalInvested > 0.1) {
                        const currentValue = Number(investedTon);
                        const rawGain = currentValue - totalInvested;
                        if (Math.abs(rawGain) >= 0.0001) {
                            gainTon = rawGain.toFixed(4);
                            gainUsd = (rawGain * tonUsdPrice).toFixed(3);
                        }
                    }
                }
            }
        } catch(e) { /* no mostramos ganancias si falla */ }

        const dashboardImageBuffer = await generateStakingImage(tonBalance, tsTonBalance.toFixed(4), investedTon, investedUsd, wallet.theme, gainTon, gainUsd);

        const captionText = `📈 **Inversiones (Liquid Staking)**\n\nCrece tus GRAM de forma segura mediante el contrato inteligente de *Tonstakers*.​`;

        const buttons = [
            [Markup.button.callback('💸 Depositar (Invertir GRAM)', 'action_deposit')],
            [Markup.button.callback('📥 Retirar Ganancias', 'action_withdraw')],
            [Markup.button.callback('🧮 Calcular Rendimiento', 'action_calc')],
            [Markup.button.callback('🔄 Actualizar', 'action_refresh'), Markup.button.callback('⬅️ Volver', 'cancel_scene')]
        ];

        try { await ctx.deleteMessage(ctx.scene.session.promptId); } catch(e){}
        const newMsg = await ctx.replyWithPhoto({ source: dashboardImageBuffer }, {
            caption: captionText,
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
            disable_web_page_preview: true
        });
        ctx.scene.session.promptId = newMsg.message_id;

        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;
        if (action === 'cancel_scene') return cancelScene(ctx);
        if (action === 'return_staking') return ctx.scene.reenter();

        // ─── Actualizar con cooldown de 5 segundos ───
        if (action === 'action_refresh') {
            const userId = ctx.from.id;
            const now = Date.now();
            const lastRefresh = refreshCooldowns.get(userId) || 0;
            const remaining = REFRESH_COOLDOWN_MS - (now - lastRefresh);

            if (remaining > 0) {
                await ctx.answerCbQuery(`⏳ Espera ${Math.ceil(remaining / 1000)}s antes de actualizar.`, { show_alert: false });
                return;
            }

            refreshCooldowns.set(userId, now);
            await ctx.answerCbQuery('🔄 Actualizando...');
            return ctx.scene.reenter();
        }

        if (action === 'action_history' || action.startsWith('history_page_')) {
            const page = action.startsWith('history_page_') ? parseInt(action.replace('history_page_', '')) : 0;
            const PAGE_SIZE = 5;

            await ctx.answerCbQuery('🔍 Consultando blockchain...').catch(() => {});

            // Solo fetch en la primera página o si no está cacheado
            if (page === 0 || !ctx.scene.session.historyCache) {
                await ctx.telegram.editMessageCaption(
                    ctx.chat.id, ctx.scene.session.promptId, null,
                    `🔍 Consultando historial directamente en la blockchain...`
                ).catch(() => {});
                ctx.scene.session.historyCache = await getStakingHistory(ctx.scene.session.wallet.address);
                // Restaurar la imagen del dashboard
                const { generateStakingImage } = require('../utils/canvasStaking');
                const wallet = ctx.scene.session.wallet;
                const { getBalance, getTsTonBalance, getTsTonPrice } = require('../services/tonService');
                const { fromNano } = require('@ton/ton');
                const tonBalance = Number(fromNano(await getBalance(wallet.address))).toFixed(2);
                const tsTonBalance = Number(await getTsTonBalance(wallet.address));
                const tsTonPrice = await getTsTonPrice();
                const investedTon = (tsTonBalance * tsTonPrice).toFixed(4);
                let tonUsdPrice = 3.0;
                try { const r = await fetch('https://tonapi.io/v2/rates?tokens=ton&currencies=usd'); const d = await r.json(); tonUsdPrice = d?.rates?.TON?.prices?.USD || 3.0; } catch(e) {}
                const investedUsd = (Number(investedTon) * tonUsdPrice).toFixed(2);
                const img = await generateStakingImage(tonBalance, tsTonBalance.toFixed(4), investedTon, investedUsd, wallet.theme);
                try {
                    await ctx.telegram.deleteMessage(ctx.chat.id, ctx.scene.session.promptId).catch(() => {});
                } catch(e) {}
                const newMsg = await ctx.replyWithPhoto({ source: img }, {
                    caption: `📊 **Historial de Inversiones y Retiros**`,
                    parse_mode: 'Markdown',
                    reply_markup: Markup.inlineKeyboard([[Markup.button.callback('⏳', 'noop')]]).reply_markup
                });
                ctx.scene.session.promptId = newMsg.message_id;
            }

            const history = ctx.scene.session.historyCache || [];
            const totalPages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
            const safePage = Math.max(0, Math.min(page, totalPages - 1));
            const slice = history.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

            let historyText = `📊 **Historial de Inversiones** _(Página ${safePage + 1}/${totalPages})_\n\n`;
            if (history.length === 0) {
                historyText += `_No se encontraron movimientos recientes.\\nSi acabas de invertir, espera unos minutos._`;
            } else {
                for (const h of slice) {
                    const date = new Date(h.timestamp * 1000).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                    let icon, label;
                    if (h.type === 'deposit')       { icon = '🟢'; label = 'Recibiste'; }
                    else if (h.type === 'withdraw') { icon = '🔴'; label = 'Retiraste'; }
                    else                            { icon = '🟡'; label = 'Invertiste'; }
                    historyText += `${icon} *${label}* ${h.amount}\n📅 ${date}\n\n`;
                }
            }

            // Botones de paginación + volver
            const navRow = [];
            if (safePage > 0)             navRow.push(Markup.button.callback('◀️ Anterior', `history_page_${safePage - 1}`));
            if (safePage < totalPages - 1) navRow.push(Markup.button.callback('Siguiente ▶️', `history_page_${safePage + 1}`));
            const navButtons = [];
            if (navRow.length > 0) navButtons.push(navRow);
            navButtons.push([Markup.button.callback('⬅️ Volver', 'return_staking')]);

            await ctx.telegram.editMessageCaption(
                ctx.chat.id, ctx.scene.session.promptId, null,
                historyText,
                { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(navButtons).reply_markup }
            ).catch(() => {});
            return;
        }

        if (action === 'action_calc') {
            await ctx.answerCbQuery('🧮 Calculando...').catch(() => {});
            await ctx.telegram.editMessageCaption(
                ctx.chat.id, ctx.scene.session.promptId, null,
                `🧮 *Calculadora de Rendimiento*\n\n⏳ Obteniendo APY real y precio actual de TON...`
            ).catch(() => {});

            const { apy, tonUsd, tsTonRatio } = await getRealStakingApy();
            const tonBalance = Number(await getBalance(ctx.scene.session.wallet.address)) / 1e9;

            // Preguntar cuánto quiere calcular
            const calcText =
                `🧮 *Calculadora de Rendimiento Real*\n\n` +
                `📊 *Datos en tiempo real (Tonstakers):*\n` +
                `• APY actual: *${apy.toFixed(2)}%* anual\n` +
                `• 1 tsTON = *${tsTonRatio} TON*\n` +
                `• 1 TON = *$${tonUsd} USD*\n\n` +
                `Tu saldo disponible: *${tonBalance.toFixed(4)} GRAM*\n\n` +
                `¿Cuántos GRAM deseas simular? Escribe la cantidad:`;

            await ctx.telegram.editMessageCaption(
                ctx.chat.id, ctx.scene.session.promptId, null,
                calcText,
                { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'return_staking')]]).reply_markup }
            ).catch(() => {});

            // Guardamos los datos para usarlos cuando responda
            ctx.scene.session.calcMode = true;
            ctx.scene.session.calcData = { apy, tonUsd, tsTonRatio };
            return ctx.wizard.next(); // Avanzar al step de texto para recibir la cantidad
        }

        if (action === 'action_withdraw') {
            await ctx.telegram.editMessageCaption(
                ctx.chat.id, ctx.scene.session.promptId, null,
                `📥 **Retirar Inversión**\n\nEl retiro directo desde el bot estará disponible en la próxima actualización.\n\nPor ahora, si deseas retirar tus ganancias al instante, puedes ir a **STON.fi** en el menú de dApps y cambiar tus \`tsTON\` de regreso a \`TON\`.`,
                { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'return_staking')]]).reply_markup }
            ).catch(()=>{});
            return; // Stay in this step to allow them to go back
        }

        if (action === 'action_deposit') {
            const tonBalanceNano = await getBalance(ctx.scene.session.wallet.address);
            const tonBalance = Number(tonBalanceNano) / 1e9;
            await ctx.telegram.editMessageCaption(
                ctx.chat.id, ctx.scene.session.promptId, null,
                `💸 **Depositar a Tonstakers**\n\nTu saldo disponible: **${tonBalance.toFixed(4)} GRAM**\n\n¿Cuántos GRAM deseas **invertir**?\n\n⚠️ **Mínimo: 1 GRAM** (requerido por el contrato de Tonstakers)\n_El contrato inteligente retendrá **1.0 GRAM extra de gas** de tu saldo para garantizar la ejecución, y te **reembolsará automáticamente a tu billetera** lo que no utilice (aprox ~0.9 GRAM devueltos)._`,
                { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]).reply_markup }
            ).catch(()=>{});
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);
        if (ctx.callbackQuery?.data === 'return_staking') {
            await ctx.answerCbQuery().catch(() => {});
            ctx.scene.session.calcMode = false;
            return ctx.scene.reenter();
        }
        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
        if (!text) return;

        const amountStr = text.replace(',', '.');
        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) return sendError(ctx, "❌ Cantidad inválida. Intenta de nuevo:");

        // ─── Modo calculadora ───────────────────────────────────────────────
        if (ctx.scene.session.calcMode && ctx.scene.session.calcData) {
            const { apy, tonUsd } = ctx.scene.session.calcData;
            const dailyRate  = apy / 100 / 365;
            const dailyTon   = amount * dailyRate;
            const monthlyTon = dailyTon * 30;
            const yearlyTon  = amount * (apy / 100);

            const resultText =
                `🧮 *Resultados de tu simulación*\n\n` +
                `💰 Inversión: *${amount} GRAM* a *${apy.toFixed(2)}% APY*\n` +
                `💵 Precio TON hoy: *$${tonUsd}*\n` +
                `────────────────────\n` +
                `📅 *Diario:* ${dailyTon.toFixed(6)} GRAM ≈ *$${(dailyTon * tonUsd).toFixed(4)} USD*\n` +
                `📅 *Semanal:* ${(dailyTon * 7).toFixed(5)} GRAM ≈ *$${(dailyTon * 7 * tonUsd).toFixed(3)} USD*\n` +
                `📅 *Mensual:* ${monthlyTon.toFixed(4)} GRAM ≈ *$${(monthlyTon * tonUsd).toFixed(3)} USD*\n` +
                `📅 *Anual:* ${yearlyTon.toFixed(4)} GRAM ≈ *$${(yearlyTon * tonUsd).toFixed(2)} USD*\n` +
                `────────────────────\n` +
                `_APY obtenido en tiempo real de Tonstakers vía TonAPI_\n\n` +
                `¿Deseas simular otra cantidad? Escríbela, o vuelve al menú:`;

            await ctx.telegram.editMessageCaption(
                ctx.chat.id, ctx.scene.session.promptId, null,
                resultText,
                { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Menú', 'return_staking')]]).reply_markup }
            ).catch(() => {});
            return; // Se queda en calcMode para nuevas simulaciones
        }


        const MIN_STAKE = 1.0; // Tonstakers minimum is 1 TON
        if (amount < MIN_STAKE) {
            return sendError(ctx, `❌ El mínimo para invertir en Tonstakers es **1 GRAM**.\n\nIntenta de nuevo con un valor mayor o igual a 1:`);
        }

        const GAS_RESERVE = 1.0;
        const totalCost = amount + GAS_RESERVE;

        // Validate balance
        const tonBalanceNano = await getBalance(ctx.scene.session.wallet.address);
        const tonBalance = Number(tonBalanceNano) / 1e9;

        if (totalCost > tonBalance) {
            return sendError(ctx, `❌ Saldo insuficiente.\n\nNecesitas **${totalCost.toFixed(4)} GRAM** (${amount} invertidos + 1.0 de gas), pero solo tienes **${tonBalance.toFixed(4)} GRAM**.\n\nIngresa una cantidad menor:`);
        }

        ctx.scene.session.amountNano = (amount * 1e9).toString();
        ctx.scene.session.amountDisplay = amount;

        const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
        ctx.scene.session.expectedPinHash = user.recoveryPinHash;

        if (user.recoveryPinHash) {
            await ctx.telegram.editMessageCaption(
                ctx.chat.id, ctx.scene.session.promptId, null,
                `🔐 Vas a invertir **${amount} GRAM**.\n\nIngresa tu **PIN de 4 dígitos** para confirmar la transacción al contrato inteligente:`,
                { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]).reply_markup }
            ).catch(()=>{});
            return ctx.wizard.next();
        } else {
            return executeStaking(ctx);
        }
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);
        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
        
        if (!text || !/^\d{4}$/.test(text)) return sendError(ctx, "❌ PIN inválido. Debe ser de 4 dígitos. Intenta de nuevo:");
        if (hashData(text) !== ctx.scene.session.expectedPinHash) return sendError(ctx, "❌ PIN Incorrecto. Intenta de nuevo:");

        return executeStaking(ctx);
    }
);

async function executeStaking(ctx) {
    await ctx.telegram.editMessageCaption(ctx.chat.id, ctx.scene.session.promptId, null, "⏳ Transfiriendo tus GRAM al pool de Tonstakers... Por favor espera.").catch(()=>{});
    
    try {
        const wallet = ctx.scene.session.wallet;
        const result = await stakeTon(wallet.encryptedPrivateKey, ctx.scene.session.amountNano);

        const returnButton = [[Markup.button.callback('⬅️ Volver a la Billetera', 'cancel_scene')]];

        if (result.success) {
            await ctx.telegram.editMessageCaption(
                ctx.chat.id, ctx.scene.session.promptId, null, 
                `✅ **¡Inversión Exitosa!** 🚀\n\nHas enviado **${ctx.scene.session.amountDisplay} GRAM** al contrato de Tonstakers.\n\nPronto recibirás tus tokens \`tsTON\` y empezarás a ver ganancias todos los días.`, 
                { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(returnButton).reply_markup }
            ).catch(()=>{});
        } else {
            await ctx.telegram.editMessageCaption(
                ctx.chat.id, ctx.scene.session.promptId, null, 
                `❌ **Falló el depósito:** ${result.error}\n\nVerifica que tengas saldo suficiente para cubrir la red.`, 
                { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(returnButton).reply_markup }
            ).catch(()=>{});
        }
        ctx.scene.session.finished = true;
        return ctx.scene.leave();

    } catch (error) {
        console.error("Error staking:", error);
        await ctx.telegram.editMessageCaption(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Ocurrió un error inesperado al procesar la inversión.").catch(()=>{});
        return ctx.scene.leave();
    }
}

async function cancelScene(ctx) {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    const walletId = ctx.scene.session.walletId;
    const finished  = ctx.scene.session.finished;
    const chatId    = ctx.chat.id;
    const promptId  = ctx.scene.session.promptId;
    await ctx.scene.leave();

    // Borrar el mensaje del panel de inversiones
    if (promptId) {
        await ctx.telegram.deleteMessage(chatId, promptId).catch(() => {});
    }

    if (!finished && walletId) {
        const { handleViewWalletById } = require('../handlers/wallet');
        return handleViewWalletById(ctx, walletId);
    }
}

async function sendError(ctx, msg) {
    const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
    await ctx.telegram.editMessageCaption(ctx.chat.id, ctx.scene.session.promptId, null, msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }).catch(()=>{});
}

// ─── Escape Hatches ────────────────────────────────────────────────────────
stakingScene.command('start', async (ctx) => {
    if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
});
stakingScene.command('cancelar', async (ctx) => {
    if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    if (ctx.callbackQuery) await ctx.answerCbQuery();
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
});
// ───────────────────────────────────────────────────────────────────────────

module.exports = { stakingScene };
