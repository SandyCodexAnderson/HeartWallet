const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { sendTon, getBalance } = require('../services/tonService');
const { hashData } = require('../services/cryptoService');
const { config } = require('../config/env');
const { toNano } = require('@ton/ton');

const PRESET_AMOUNTS = [
    { label: '☕ 0.5 GRAM  — Un café', value: '0.5' },
    { label: '🌸 1 GRAM  — Un apoyo', value: '1' },
    { label: '💎 5 GRAM  — Un gran gesto', value: '5' },
    { label: '🚀 10 GRAM — Impulso total', value: '10' }
];

const INTRO_TEXT =
`💖 *¡Apoya a HeartWallet!*

HeartWallet es un proyecto 100% independiente, creado con amor para darte control total sobre tus fondos. No cobramos comisiones y cubrimos los costos del servidor con nuestros propios recursos.

Si el bot te ha sido útil y deseas contribuir para que sigamos mejorando, puedes donarnos directamente en GRAM desde cualquiera de tus billeteras. ¡Cada aporte, grande o pequeño, significa muchísimo! 🙏

_Selecciona una cantidad o escribe la que prefieras:_`;

async function showIntro(ctx, promptId = null) {
    const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(ctx.from.id) },
        include: { wallets: true }
    });

    const hasWallets = user && user.wallets.length > 0;

    const preset = PRESET_AMOUNTS.map(a => [Markup.button.callback(a.label, `dn_amt_${a.value}`)]);
    preset.push([Markup.button.callback('✍️ Escribir Otra Cantidad', 'dn_custom')]);
    preset.push([Markup.button.callback('⬅️ Volver al menú', 'dn_cancel')]);

    if (!hasWallets) {
        const text = `💖 *¡Apoya a HeartWallet!*\n\n_Necesitas tener al menos una billetera creada para poder donar GRAM._`;
        if (promptId) {
            await ctx.telegram.editMessageText(ctx.chat.id, promptId, null, text, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al menú', 'dn_cancel')]])
            }).catch(() => {});
        } else {
            try { await ctx.deleteMessage(); } catch(e) {}
            await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al menú', 'dn_cancel')]]) });
        }
        return { user, hasWallets: false };
    }

    if (promptId) {
        await ctx.telegram.editMessageText(ctx.chat.id, promptId, null, INTRO_TEXT, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(preset)
        }).catch(() => {});
    } else {
        try { await ctx.deleteMessage(); } catch(e) {}
        const msg = await ctx.reply(INTRO_TEXT, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(preset) });
        return { user, hasWallets: true, msgId: msg.message_id };
    }

    return { user, hasWallets: true };
}

async function showWalletPicker(ctx, promptId, amount) {
    const user = ctx.scene.session.user;
    const keyboard = user.wallets.map(w => [
        Markup.button.callback(`💳 ${w.name} (${w.address.slice(0, 6)}...)`, `dn_wallet_${w.id}`)
    ]);
    keyboard.push([Markup.button.callback('⬅️ Volver', 'dn_back')]);

    await ctx.telegram.editMessageText(
        ctx.chat.id, promptId, null,
        `💖 *Donar ${amount} GRAM a HeartWallet*\n\n_¡Gracias por tu generosidad! 🙏_\n\nSelecciona desde cuál billetera deseas enviar la donación:`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) }
    ).catch(() => {});
}

async function showPinPrompt(ctx, promptId) {
    await ctx.telegram.editMessageText(
        ctx.chat.id, promptId, null,
        `🔐 *Confirmación de Seguridad*\n\nDonación de *${ctx.scene.session.amount} GRAM* desde *${ctx.scene.session.wallet.name}*.\n\nIngresa tu *PIN de 4 dígitos* para confirmar:`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'dn_cancel')]]) }
    ).catch(() => {});
}

const donateScene = new Scenes.WizardScene(
    'DONATE_SCENE',

    // ── Paso 0: Entrada inicial + elegir monto ───────────────────────────────
    async (ctx) => {
        if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

        // Primera entrada
        if (!ctx.scene.session.initialized) {
            ctx.scene.session.initialized = true;
            ctx.scene.session.mode = 'amount';
            const result = await showIntro(ctx);
            if (!result.hasWallets) return ctx.scene.leave();
            ctx.scene.session.user = result.user;
            ctx.scene.session.promptId = result.msgId;
            return ctx.wizard.next();
        }
    },

    // ── Paso 1: Gestión completa de la escena ────────────────────────────────
    async (ctx) => {
        if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

        const data = ctx.callbackQuery?.data;
        const mode = ctx.scene.session.mode;
        const promptId = ctx.scene.session.promptId;

        // ── Cancelar y salir ──
        if (data === 'dn_cancel') {
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        // ── Volver al selector de montos ──
        if (data === 'dn_back') {
            ctx.scene.session.mode = 'amount';
            await showIntro(ctx, promptId);
            return;
        }

        // ── Preset de monto elegido ──
        if (data?.startsWith('dn_amt_')) {
            const amount = data.replace('dn_amt_', '');
            ctx.scene.session.amount = amount;
            ctx.scene.session.mode = 'wallet';
            await showWalletPicker(ctx, promptId, amount);
            return;
        }

        // ── Pedir monto personalizado ──
        if (data === 'dn_custom') {
            ctx.scene.session.mode = 'custom_amount';
            await ctx.telegram.editMessageText(
                ctx.chat.id, promptId, null,
                `✍️ *Ingresa la cantidad de GRAM que deseas donar*\n\nEscribe un número, por ejemplo: \`2.5\``,
                { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'dn_back')]]) }
            ).catch(() => {});
            return;
        }

        // ── Wallet elegida ──
        if (data?.startsWith('dn_wallet_')) {
            const walletId = parseInt(data.replace('dn_wallet_', ''));
            const wallet = ctx.scene.session.user.wallets.find(w => w.id === walletId);
            if (!wallet) return;
            ctx.scene.session.wallet = wallet;
            ctx.scene.session.mode = 'pin';
            await showPinPrompt(ctx, promptId);
            return;
        }

        // ── Recibir texto: monto personalizado o PIN ──
        if (ctx.message?.text) {
            await ctx.deleteMessage(ctx.message.message_id).catch(() => {});

            // Monto personalizado
            if (mode === 'custom_amount') {
                const raw = ctx.message.text.replace(',', '.');
                const num = parseFloat(raw);
                if (isNaN(num) || num <= 0) {
                    await ctx.telegram.editMessageText(ctx.chat.id, promptId, null,
                        `❌ Cantidad inválida. Escribe un número mayor a 0 (ej: \`1.5\`):`,
                        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'dn_back')]]) }
                    ).catch(() => {});
                    return;
                }
                ctx.scene.session.amount = raw;
                ctx.scene.session.mode = 'wallet';
                await showWalletPicker(ctx, promptId, raw);
                return;
            }

            // PIN
            if (mode === 'pin') {
                const pin = ctx.message.text.trim();
                if (!/^\d{4}$/.test(pin)) {
                    await ctx.telegram.editMessageText(ctx.chat.id, promptId, null,
                        `❌ PIN inválido. Debe ser de 4 dígitos. Intenta de nuevo:`,
                        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'dn_cancel')]]) }
                    ).catch(() => {});
                    return;
                }

                const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
                if (hashData(pin) !== user.recoveryPinHash) {
                    await ctx.telegram.editMessageText(ctx.chat.id, promptId, null,
                        `❌ *PIN Incorrecto.* Intenta de nuevo:`,
                        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'dn_cancel')]]) }
                    ).catch(() => {});
                    return;
                }

                // ── Ejecutar donación ──
                await ctx.telegram.editMessageText(ctx.chat.id, promptId, null,
                    `🔄 Procesando tu donación de *${ctx.scene.session.amount} GRAM*...\n_Gracias de todo corazón_ 💖`,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});

                try {
                    if (!config.escrowWalletAddress) throw new Error("Destino no configurado");

                    const wallet = ctx.scene.session.wallet;
                    const amountNano = toNano(ctx.scene.session.amount).toString();
                    const balanceNano = BigInt(await getBalance(wallet.address));
                    const GAS = 20000000n;
                    if (BigInt(amountNano) + GAS > balanceNano) {
                        await ctx.telegram.editMessageText(ctx.chat.id, promptId, null,
                            `❌ *Fondos insuficientes.*\nNo tienes suficientes GRAM para esta donación (incluye el costo de gas ~0.02).`,
                            { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'dn_back')]]) }
                        ).catch(() => {});
                        return;
                    }

                    const { sendTon } = require('../services/tonService');
                    const result = await sendTon(wallet.encryptedPrivateKey, config.escrowWalletAddress, amountNano, 'Donacion HeartWallet');

                    if (!result || !result.success) throw new Error("Tx fallida");

                    await ctx.telegram.editMessageText(ctx.chat.id, promptId, null,
                        `✅ *¡Donación Enviada con Éxito!*\n\n💖 *${ctx.scene.session.amount} GRAM* han llegado a HeartWallet.\n\nTu apoyo hace posible que sigamos ofreciéndote un servicio sin comisiones. ¡Muchísimas gracias! 🎀`,
                        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al menú', 'dn_cancel')]]) }
                    ).catch(() => {});
                    return ctx.scene.leave();

                } catch(e) {
                    console.error("[DONATE] Error:", e);
                    await ctx.telegram.editMessageText(ctx.chat.id, promptId, null,
                        `❌ Ocurrió un error al procesar la donación. Inténtalo de nuevo más tarde.`,
                        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al menú', 'dn_cancel')]]) }
                    ).catch(() => {});
                    return ctx.scene.leave();
                }
            }
        }
    }
);

module.exports = { donateScene };
