const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { getBalance, sendTon } = require('../services/tonService');
const { hashData } = require('../services/cryptoService');
const { config } = require('../config/env');
const { toNano } = require('@ton/ton');

const THEMES = [
    { id: 'pink',   name: '🩷 Rosa Claro' },
    { id: 'red',    name: '❤️ Rojo Fuego' },
    { id: 'orange', name: '🧡 Naranja Atardecer' },
    { id: 'yellow', name: '💛 Amarillo Sol' },
    { id: 'green',  name: '💚 Verde Esmeralda' },
    { id: 'teal',   name: '🩵 Turquesa' },
    { id: 'blue',   name: '💙 Azul Océano' },
    { id: 'indigo', name: '🌌 Índigo Profundo' },
    { id: 'violet', name: '💜 Violeta Místico' },
    { id: 'dark',   name: '🖤 Modo Oscuro' },
    { id: 'gold',   name: '🌟 Oro (Estrella)', isPremium: true },
    { id: 'diamond', name: '💎 Diamante (Gram)', isPremium: true }
];

const PREMIUM_PRICE = 5; // GRAM

// ─── Helpers ────────────────────────────────────────────────────────────────

async function editOrReply(ctx, text, keyboard) {
    const promptId = ctx.scene.session.promptId;
    if (promptId) {
        await ctx.telegram.editMessageText(ctx.chat.id, promptId, null, text, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(keyboard)
        }).catch(() => {});
    } else {
        try { await ctx.deleteMessage(); } catch(e) {}
        const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
        ctx.scene.session.promptId = msg.message_id;
    }
}

async function showMainMenu(ctx) {
    const walletId = ctx.scene.session.walletId;
    const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) return ctx.scene.leave();

    const themeName = THEMES.find(t => t.id === wallet.theme)?.name || wallet.theme;
    const buttons = [
        [Markup.button.callback('✏️ Cambiar Nombre', 'cw_rename')],
        [Markup.button.callback('🌈 Cambiar Color de Fondo', 'cw_color')],
        [Markup.button.callback(`⬅️ Volver a ${wallet.name}`, 'cw_back_wallet')]
    ];
    await editOrReply(ctx,
        `🎨 *Personalización de Billetera*\n\nBilletera: *${wallet.name}*\nTema actual: *${themeName}*\n\nSelecciona qué deseas personalizar:`,
        buttons
    );
}

async function showColorMenu(ctx) {
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
    const isAdmin = ctx.from.username === 'sandy_anderson';
    const hasPremium = isAdmin || (user?.hasPremiumThemes || false);

    const keyboard = [];
    for (let i = 0; i < THEMES.length; i += 2) {
        const theme1 = THEMES[i];
        const label1 = theme1.isPremium && !hasPremium ? `${theme1.name} [5 GRAM]` : theme1.name;
        const row = [Markup.button.callback(label1, `cw_theme_${theme1.id}`)];
        
        if (THEMES[i + 1]) {
            const theme2 = THEMES[i + 1];
            const label2 = theme2.isPremium && !hasPremium ? `${theme2.name} [5 GRAM]` : theme2.name;
            row.push(Markup.button.callback(label2, `cw_theme_${theme2.id}`));
        }
        keyboard.push(row);
    }
    keyboard.push([Markup.button.callback('⬅️ Volver al menú', 'cw_main')]);
    
    let text = '🌈 *Elegir Color de Fondo*\n\nSelecciona un estilo para el fondo de tu billetera:';
    if (!hasPremium) {
        text += '\n\n_Los temas VIP (Oro y Diamante) requieren un pago único de 5 GRAM para desbloquearse en todas tus billeteras._';
    } else {
        text += '\n\n_👑 Paquete VIP Desbloqueado_';
    }

    await editOrReply(ctx, text, keyboard);
}

async function showRenamePrompt(ctx) {
    await editOrReply(ctx,
        '✏️ *Renombrar Billetera*\n\nEscribe el nuevo nombre _(puedes incluir emojis, máximo 20 caracteres)_:',
        [[Markup.button.callback('⬅️ Cancelar', 'cw_main')]]
    );
}

async function applyTheme(ctx, newTheme) {
    await prisma.wallet.update({
        where: { id: ctx.scene.session.walletId },
        data:  { theme: newTheme }
    });
    const themeName = THEMES.find(t => t.id === newTheme)?.name || newTheme;
    const wallet    = await prisma.wallet.findUnique({ where: { id: ctx.scene.session.walletId } });
    ctx.scene.session.mode = 'main';
    await editOrReply(ctx,
        `✅ *¡Color Aplicado!*\n\nBilletera: *${wallet.name}*\nNuevo tema: *${themeName}*\n\n¿Qué más deseas personalizar?`,
        [
            [Markup.button.callback('✏️ Cambiar Nombre', 'cw_rename')],
            [Markup.button.callback('🌈 Cambiar Otro Color', 'cw_color')],
            [Markup.button.callback(`⬅️ Ver ${wallet.name}`, 'cw_back_wallet')]
        ]
    );
}

// ─── Scene ──────────────────────────────────────────────────────────────────

const customizeWalletWizard = new Scenes.WizardScene(
    'CUSTOMIZE_WALLET_SCENE',

    async (ctx) => {
        // ── 1) Inicializar sesión en la primera entrada ──────────────────────
        if (!ctx.scene.session.walletId) {
            const walletId = parseInt(ctx.scene.state?.walletId);
            if (!walletId || isNaN(walletId)) {
                await ctx.reply('❌ Error: billetera no identificada.').catch(() => {});
                return ctx.scene.leave();
            }
            ctx.scene.session.walletId = walletId;
            ctx.scene.session.mode    = 'main';
            ctx.scene.session.promptId = null;

            if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
            return showMainMenu(ctx);
        }

        // ── 2) Responder callbacks entrantes ─────────────────────────────────
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery().catch(() => {});
            const data = ctx.callbackQuery.data;

            if (data === 'cw_back_wallet') {
                const walletId = ctx.scene.session.walletId;
                try { await ctx.deleteMessage(); } catch(e) {}
                await ctx.scene.leave();
                if (ctx.callbackQuery) ctx.callbackQuery.data = `view_wallet_${walletId}`;
                const { handleViewWallet } = require('../handlers/wallet');
                return handleViewWallet(ctx);
            }

            if (data === 'cw_main') {
                ctx.scene.session.mode = 'main';
                return showMainMenu(ctx);
            }

            if (data === 'cw_rename') {
                ctx.scene.session.mode = 'rename';
                return showRenamePrompt(ctx);
            }

            if (data === 'cw_color') {
                ctx.scene.session.mode = 'color';
                return showColorMenu(ctx);
            }
            
            if (data === 'cw_cancel_premium') {
                ctx.scene.session.mode = 'color';
                return showColorMenu(ctx);
            }

            if (data.startsWith('cw_theme_')) {
                const newTheme = data.replace('cw_theme_', '');
                const themeData = THEMES.find(t => t.id === newTheme);
                
                if (themeData && themeData.isPremium) {
                    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
                    const isAdmin = ctx.from.username === 'sandy_anderson';
                    
                    if (!isAdmin && !user.hasPremiumThemes) {
                        ctx.scene.session.mode = 'buy_premium';
                        ctx.scene.session.pendingTheme = newTheme;
                        const wallet = await prisma.wallet.findUnique({ where: { id: ctx.scene.session.walletId } });
                        
                        await editOrReply(ctx,
                            `💎 *Desbloquear Paquete VIP*\n\nEl tema *${themeData.name}* es Premium.\n\nPor un pago único de *${PREMIUM_PRICE} GRAM*, desbloquearás los temas VIP (Oro y Diamante) para **todas tus billeteras de por vida**.\n\nSe descontarán ${PREMIUM_PRICE} GRAM de tu billetera actual (*${wallet.name}*).\n\nIngresa tu *PIN de 4 dígitos* para confirmar la compra:`,
                            [[Markup.button.callback('❌ Cancelar', 'cw_cancel_premium')]]
                        );
                        return;
                    }
                }
                
                // Aplicar tema directamente si no es premium o ya lo tiene
                await applyTheme(ctx, newTheme);
                return;
            }

            return; // ignorar otros callbacks sin bloquear
        }

        // ── 3) Mensajes de texto ─────────────────────────────────────────────
        if (ctx.message?.text) {
            const text = ctx.message.text.trim();
            const mode = ctx.scene.session.mode;
            await ctx.deleteMessage(ctx.message.message_id).catch(() => {});

            // Renombrar
            if (mode === 'rename') {
                if (!text || text.length < 1 || text.length > 20) {
                    await editOrReply(ctx,
                        '❌ Nombre inválido. Debe tener entre 1 y 20 caracteres. Inténtalo de nuevo:',
                        [[Markup.button.callback('⬅️ Cancelar', 'cw_main')]]
                    );
                    return;
                }

                await prisma.wallet.update({
                    where: { id: ctx.scene.session.walletId },
                    data:  { name: text }
                });
                ctx.scene.session.mode = 'main';
                await editOrReply(ctx,
                    `✅ *¡Nombre Actualizado!*\n\nTu billetera ahora se llama: *${text}*\n\n¿Qué más deseas personalizar?`,
                    [
                        [Markup.button.callback('✏️ Cambiar Nombre', 'cw_rename')],
                        [Markup.button.callback('🌈 Cambiar Color de Fondo', 'cw_color')],
                        [Markup.button.callback(`⬅️ Ver ${text}`, 'cw_back_wallet')]
                    ]
                );
                return;
            }

            // Comprar Premium
            if (mode === 'buy_premium') {
                if (!/^\d{4}$/.test(text)) {
                    await editOrReply(ctx,
                        `❌ PIN inválido. Debe ser de 4 dígitos. Intenta de nuevo:`,
                        [[Markup.button.callback('❌ Cancelar', 'cw_cancel_premium')]]
                    );
                    return;
                }

                const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
                if (hashData(text) !== user.recoveryPinHash) {
                    await editOrReply(ctx,
                        `❌ *PIN Incorrecto.* Intenta de nuevo:`,
                        [[Markup.button.callback('❌ Cancelar', 'cw_cancel_premium')]]
                    );
                    return;
                }

                const wallet = await prisma.wallet.findUnique({ where: { id: ctx.scene.session.walletId } });
                
                await editOrReply(ctx,
                    `🔄 Procesando pago de *${PREMIUM_PRICE} GRAM*...`,
                    []
                );

                try {
                    const amountNano = toNano(PREMIUM_PRICE.toString()).toString();
                    const balanceNano = BigInt(await getBalance(wallet.address));
                    const GAS = 20000000n; // ~0.02 TON

                    if (BigInt(amountNano) + GAS > balanceNano) {
                        await editOrReply(ctx,
                            `❌ *Fondos insuficientes.*\nTu billetera *${wallet.name}* no tiene suficientes GRAM para el pago (incluyendo el costo de gas).`,
                            [[Markup.button.callback('⬅️ Volver', 'cw_cancel_premium')]]
                        );
                        return;
                    }

                    if (!config.escrowWalletAddress) throw new Error("Falta escrowWalletAddress");

                    // Enviar fondos al escrow central
                    const result = await sendTon(wallet.encryptedPrivateKey, config.escrowWalletAddress, amountNano, 'Pago Temas Premium');
                    if (!result || !result.success) throw new Error("Tx fallida");

                    // Actualizar BD
                    await prisma.user.update({
                        where: { id: user.id },
                        data: { hasPremiumThemes: true }
                    });

                    // Aplicar el tema inmediatamente
                    await applyTheme(ctx, ctx.scene.session.pendingTheme);

                } catch(e) {
                    console.error("[PREMIUM THEME] Error:", e);
                    await editOrReply(ctx,
                        `❌ Ocurrió un error al procesar el pago. Inténtalo de nuevo más tarde.`,
                        [[Markup.button.callback('⬅️ Volver', 'cw_cancel_premium')]]
                    );
                }
                return;
            }
        }
    }
);

module.exports = { customizeWalletWizard };
