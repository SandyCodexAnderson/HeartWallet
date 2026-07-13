const { Telegraf, session, Scenes, Markup } = require('telegraf');
const { config } = require('./config/env');
const { handleStart } = require('./handlers/start');
const { handleViewWallet, handleCreateWallet, handleSupportProject, handleViewNFTs, handleTxHistory, handleGiftCardsMenu } = require('./handlers/wallet');
const { sendWizard } = require('./scenes/sendScene');
const { receiveWizard } = require('./scenes/receiveScene');
const { createWalletWizard } = require('./scenes/createWalletScene');
const { tonConnectWizard } = require('./scenes/tonConnectScene');
const { deleteWalletWizard } = require('./scenes/deleteWalletScene');
const { backupWalletWizard } = require('./scenes/backupWalletScene');
const { recoverWalletWizard } = require('./scenes/recoverWalletScene');
const { coldWalletWizard } = require('./scenes/coldWalletScene');
const { importWalletWizard } = require('./scenes/importWalletScene');
const { fragmentWizard } = require('./scenes/fragmentScene');
const { customizeWalletWizard } = require('./scenes/customizeWalletScene');
const { renameWalletWizard } = require('./scenes/renameWalletScene');
const { tonPaymentWizard } = require('./scenes/tonPaymentScene');
const { supportWizard } = require('./scenes/supportScene');
const { donateScene } = require('./scenes/donateScene');
const splitScene = require('./scenes/splitScene');
const { createGiftScene } = require('./scenes/createGiftScene');
const { claimPasswordScene } = require('./scenes/claimPasswordScene');
const { stakingScene } = require('./scenes/stakingScene');
const { createProductWizard } = require('./scenes/createProductScene');
const { buyProductWizard } = require('./scenes/buyProductScene');
const { purchasedContentScene } = require('./scenes/purchasedContentScene');
const { sponsorWizard } = require('./scenes/sponsorScene');
const { handleSponsorMenu, handleSponsorCreate, handleSponsorStats } = require('./handlers/sponsor');
const { authMiddleware } = require('./middlewares/auth');
const { prisma } = require('./db/prisma');
const { createSubscriptionScene } = require('./scenes/createSubscriptionScene');
const { buySubscriptionScene } = require('./scenes/buySubscriptionScene');
const { expandWalletScene } = require('./scenes/expandWalletScene');
const { handleMySubscriptions, handleCancelSubscription, handleRenewSubscription } = require('./handlers/subscription');
const { logSuccess, logError, logInfo, telegramLogMiddleware } = require('./utils/logger');

if (!config.botToken) {
    throw new Error("Bot token is required");
}

const bot = new Telegraf(config.botToken);

const stage = new Scenes.Stage([sendWizard, receiveWizard, createWalletWizard, importWalletWizard, tonConnectWizard, deleteWalletWizard, backupWalletWizard, recoverWalletWizard, coldWalletWizard, fragmentWizard, customizeWalletWizard, renameWalletWizard, tonPaymentWizard, supportWizard, donateScene, splitScene, createGiftScene, claimPasswordScene, stakingScene, createProductWizard, buyProductWizard, purchasedContentScene, sponsorWizard, createSubscriptionScene, buySubscriptionScene, expandWalletScene]);
bot.use(session());
bot.use(telegramLogMiddleware()); // Logger global: registra cada acción de usuario
bot.use(authMiddleware);
bot.use(stage.middleware());

bot.start(handleStart);
bot.command('sponsor', handleSponsorMenu);
bot.action('sponsor_menu', handleSponsorMenu);
bot.action('sponsor_create', handleSponsorCreate);
bot.action(/sponsor_stats_(.+)/, handleSponsorStats);


// Iniciar Cron Service para Pagos Recurrentes
const { startCronService } = require('./services/cronService');
startCronService(bot);

bot.action('start_menu', handleStart);
bot.action('create_wallet', handleCreateWallet);
bot.action('start_create_wallet_scene', (ctx) => ctx.scene.enter('CREATE_WALLET_SCENE'));
bot.action('start_import_wallet_scene', (ctx) => ctx.scene.enter('IMPORT_WALLET_SCENE'));
bot.action(/^create_subscription_(.+)$/, (ctx) => {
    ctx.scene.state.walletId = parseInt(ctx.match[1]);
    ctx.scene.enter('CREATE_SUBSCRIPTION_SCENE');
});
bot.action(/^my_subscriptions_(\d+)$/, handleMySubscriptions);
bot.action(/^cancel_sub_(.+)$/, handleCancelSubscription);
bot.action(/^renew_sub_(.+)$/, handleRenewSubscription);
bot.action('request_expansion', (ctx) => ctx.scene.enter('EXPAND_WALLET_SCENE'));
bot.action('support_project', handleSupportProject);
bot.action('start_support', (ctx) => ctx.scene.enter('SUPPORT_SCENE'));
bot.action('cancel_support', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.leave();
    return handleStart(ctx);
});

bot.action('start_terms_1', async (ctx) => {
    const termsPart1 = 
        `🌸 *Bienvenida a HeartWallet* 🌸\n\n` +
        `HeartWallet es un ecosistema híbrido en la red TON (GRAM) diseñado para ser simple, rápido y hermoso.\n\n` +
        `📜 *Términos de Privacidad, Uso y Responsabilidad (Página 1/2):*\n\n` +
        `1️⃣ *Custodia y Cifrado:* Al crear una billetera, encriptamos tus llaves privadas con AES-256. Tú eres el único responsable de la seguridad de tu cuenta de Telegram, que funciona como tu llave maestra.\n\n` +
        `2️⃣ *Cold Wallets:* Si conviertes tu billetera a "fría", destruimos todo acceso a ella desde nuestros servidores. Si pierdes tus 24 palabras, HeartWallet no puede recuperar tus fondos bajo ninguna circunstancia.\n\n` +
        `3️⃣ *Compras de Bienes Digitales (Bitrefill):* Todas las compras son finales y no reembolsables debido a la naturaleza inmutable de la blockchain.\n\n` +
        `4️⃣ *Compra de TON con MoonPay:* HeartWallet NO maneja ni tiene acceso a ningún dato bancario o de tarjeta. Todo es gestionado exclusivamente por MoonPay en su plataforma certificada.\n\n` +
        `5️⃣ *Cero Comisiones Extra:* HeartWallet no cobra porcentaje por transferencias. Solo pagas el "gas" (fee) obligatorio de la red TON.\n\n` +
        `6️⃣ *Uso Responsable:* Nos reservamos el derecho de suspender cuentas ligadas a actividades ilícitas.`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Página Siguiente ➡️', 'start_terms_2')],
        [Markup.button.callback('📥 Ya tengo una cuenta (Recuperar)', 'start_recover_wallet')]
    ]);
    
    try {
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.callbackQuery.message.message_id, null, termsPart1, { parse_mode: 'Markdown', ...keyboard });
    } catch(e) {}
    await ctx.answerCbQuery();
});

bot.action('start_terms_2', async (ctx) => {
    const termsPart2 =
        `📜 *Términos de Privacidad, Uso y Responsabilidad (Página 2/2):*\n\n` +
        `7️⃣ *Venta de Contenido Digital (HeartWallet Store):*\n\n` +
        `HeartWallet permite vender y comprar contenido digital a cambio de GRAM. Al usar esta función aceptas que:\n\n` +
        `• Los fondos del comprador son retenidos *24 horas* en una billetera de seguridad neutral antes de liberarse al vendedor.\n` +
        `• HeartWallet actúa como intermediario técnico y *no modera el contenido*. El vendedor es el único responsable del material.\n` +
        `• Queda prohibido vender contenido ilegal. Las cuentas infractoras serán suspendidas permanentemente.\n` +
        `• Si como comprador tienes un problema, *debes contactar Soporte Técnico dentro de las primeras 24 horas* desde la compra, antes de que los fondos sean liberados.\n` +
        `• HeartWallet hará su mejor esfuerzo para resolver disputas, pero la resolución final queda a criterio del equipo de soporte.\n\n` +
        `🆘 *¿Tuviste algún problema?* Usa el botón de *Soporte Técnico* en el menú.\n\n` +
        `_Al presionar el botón de abajo, confirmas haber leído, entendido y aceptado todos estos términos._`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Aceptar Términos y Comenzar', 'accept_terms')],
        [Markup.button.callback('⬇️ Importar Cold Wallet', 'import_wallet_terms')],
        [Markup.button.callback('⬅️ Página Anterior', 'start_terms_1')]
    ]);

    try {
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.callbackQuery.message.message_id, null, termsPart2, { parse_mode: 'Markdown', ...keyboard });
    } catch(e) {}
    await ctx.answerCbQuery();
});

bot.action('info_project', async (ctx) => {
    await ctx.answerCbQuery();
    
    const infoPart1 =
        `ℹ️ *¿Cómo funciona HeartWallet? (Página 1/2)*\n\n` +
        `🏧 *La mejor analogía: Piensa en un cajero automático*\n\n` +
        `Una *Billetera en HeartWallet* es como un cajero automático: depósitos, envíos, pagos. Todo desde Telegram.\n\n` +
        `Una *Cold Wallet* es como retirar el billete y guardarlo tú mismo. Nadie puede tomarlo porque HeartWallet deja de tener la llave. Es tuyo al 100%.\n\n` +
        `────────────────────────\n\n` +
        `🛡️ *1. Billeteras Custodiales (Nativas)*\n` +
        `Encriptamos tus llaves privadas con cifrado *AES-256*. Tu cuenta de Telegram funciona como la llave maestra. Ni nuestro equipo puede mover tus fondos sin tu autorización.\n\n` +
        `🧊 *2. Sistema Cold Wallet*\n` +
        `Puedes importar una Cold Wallet (Tonkeeper, MyTonWallet) o convertir cualquier cuenta de HeartWallet en fría, proceso que destruye nuestro acceso y te da control absoluto.\n\n` +
        `💳 *3. Comprar TON con MoonPay*\n` +
        `Desde tu billetera presiona *"💳 Comprar TON"* y se abre MoonPay dentro de Telegram. HeartWallet NUNCA ve tu tarjeta ni datos bancarios. Los TON llegan directo a tu billetera.\n\n` +
        `🛒 *4. Gift Cards y Recargas (Bitrefill)*\n` +
        `Compra recargas móviles y Gift Cards mundiales pagando con tus GRAM directamente desde Telegram. Proceso final y no reembolsable.\n\n` +
        `💸 *5. Envíos Mágicos*\n` +
        `Envía fondos usando el \`@usuario\` de Telegram de la otra persona, o crea cheques escribiendo \`@heartwalletbot\` en cualquier chat.`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Página Siguiente ➡️', 'info_project_2')],
        [Markup.button.callback('⬅️ Volver al menú', 'start_menu')]
    ]);

    try {
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.callbackQuery.message.message_id, null, infoPart1, { parse_mode: 'Markdown', ...keyboard });
    } catch(e) {
        // En caso de que venga de un reply nuevo
        try { await ctx.deleteMessage(); } catch(e){}
        await ctx.reply(infoPart1, { parse_mode: 'Markdown', ...keyboard });
    }
});

bot.action('info_project_2', async (ctx) => {
    await ctx.answerCbQuery();
    
    const infoPart2 =
        `ℹ️ *¿Cómo funciona HeartWallet? (Página 2/2)*\n\n` +
        `💼 *6. HeartWallet Store — Venta de Contenido Digital*\n\n` +
        `Vende fotos, videos, audios y documentos a cambio de GRAM, sin comisiones extra.\n\n` +
        `*Para vendedores 📸*\n` +
        `• En tu billetera presiona *"💼 Vender Contenido"*, sube los archivos, ponle título y precio en GRAM.\n` +
        `• El bot genera una vista previa censurada (borrosa) para compartir en grupos vía \`@heartwalletbot\`.\n` +
        `• Tus fondos llegan a tu billetera automáticamente tras *24 horas* de retención (Escrow).\n\n` +
        `*Para compradores 🛍️*\n` +
        `• Los GRAM se descuentan al instante y recibes el archivo en privado.\n` +
        `• Tienes *24 horas* para revisar. Si hay problema, contacta Soporte Técnico antes de que venza el plazo.\n` +
        `• El contenido queda en tu sección *"📦 Contenido Comprado"* para siempre.\n\n` +
        `🔒 *Sistema de Escrow (Retención Segura)*\n` +
        `El pago no va directo al vendedor. Pasa por una *billetera de retención neutral* 24 horas. Si no hay disputa, se libera automáticamente. Así ambas partes están protegidas.\n\n` +
        `🆘 *¿Tienes un problema?*\n` +
        `_Presiona el botón de *Soporte Técnico* en el menú y describe qué pasó, cuándo y con qué producto._\n\n` +
        `_HeartWallet: cripto tan fácil como enviar un mensaje._ 💖`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Página Anterior', 'info_project')],
        [Markup.button.callback('⬅️ Volver al menú', 'start_menu')]
    ]);

    try {
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.callbackQuery.message.message_id, null, infoPart2, { parse_mode: 'Markdown', ...keyboard });
    } catch(e) {}
});
bot.action('start_tonconnect', (ctx) => ctx.scene.enter('TON_CONNECT_SCENE'));
bot.action('start_delete_wallet', (ctx) => ctx.scene.enter('DELETE_WALLET_SCENE'));
bot.action('start_backup_wallet', (ctx) => ctx.scene.enter('BACKUP_WALLET_SCENE'));
bot.action('start_recover_wallet', (ctx) => ctx.scene.enter('RECOVER_WALLET_SCENE'));
bot.action('cancel_scene', async (ctx) => {
    try { await ctx.deleteMessage(); } catch(e) {}
    const { handleStart } = require('./handlers/start');
    await handleStart(ctx);
});

bot.action('accept_terms', async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = BigInt(ctx.from.id);
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;
    const lastName = ctx.from.last_name;

    try {
        await prisma.user.create({
            data: { telegramId, username, firstName, lastName }
        });
        try { await ctx.deleteMessage(); } catch(e) {}
        return ctx.scene.enter('CREATE_WALLET_SCENE');
    } catch (e) {
        return ctx.reply("❌ Hubo un error al registrarte.");
    }
});

bot.action('import_wallet_terms', async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = BigInt(ctx.from.id);
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;
    const lastName = ctx.from.last_name;

    try {
        await prisma.user.create({
            data: { telegramId, username, firstName, lastName }
        });
        try { await ctx.deleteMessage(); } catch(e) {}
        return ctx.scene.enter('IMPORT_WALLET_SCENE');
    } catch (e) {
        return ctx.reply("❌ Hubo un error al registrarte.");
    }
});

bot.action(/view_wallet_(\d+)/, handleViewWallet);
bot.action(/^tx_history_(\d+)(?:_(\d+))?$/, handleTxHistory);
bot.action(/^giftcards_menu_(\d+)$/, handleGiftCardsMenu);
bot.action(/^view_nft_(\d+)_(\d+)$/, handleViewNFTs);
bot.action(/^fragment_market_(\d+)$/, (ctx) => {
    const walletId = parseInt(ctx.match[1]);
    ctx.scene.enter('FRAGMENT_SCENE', { walletId });
});
bot.action(/invest_(\d+)/, (ctx) => {
    const walletId = parseInt(ctx.match[1]);
    ctx.scene.enter('stakingScene', { walletId });
});
bot.action(/set_primary_(\d+)/, async (ctx) => {
    const walletId = parseInt(ctx.match[1]);
    const telegramId = BigInt(ctx.from.id);
    
    try {
        const user = await prisma.user.findUnique({
            where: { telegramId },
            include: { wallets: true }
        });
        
        if (!user) return;
        
        const wallet = user.wallets.find(w => w.id === walletId);
        if (!wallet) return ctx.answerCbQuery("Billetera no encontrada.", { show_alert: true });
        
        // Quitar isPrimary a todas las billeteras del usuario
        await prisma.wallet.updateMany({
            where: { userId: user.id },
            data: { isPrimary: false }
        });
        
        // Hacer primaria esta
        await prisma.wallet.update({
            where: { id: walletId },
            data: { isPrimary: true }
        });
        
        await ctx.answerCbQuery("✅ Billetera marcada como principal.", { show_alert: true });
        
        // Actualizamos la vista de la billetera simulando la llamada original
        const { lastUpdateMap } = require('./handlers/wallet');
        lastUpdateMap.delete(`${telegramId}_${walletId}`);
        ctx.callbackQuery.data = `view_wallet_${walletId}`;
        await handleViewWallet(ctx);
        
    } catch (e) {
        console.error("Error setting primary wallet:", e);
        await ctx.answerCbQuery("Error al marcar como principal.", { show_alert: true });
    }
});

bot.action(/send_ton_(\d+)/, (ctx) => {
    const walletId = parseInt(ctx.match[1]);
    ctx.scene.enter('SEND_TON_SCENE', { walletId });
});

bot.action(/receive_ton_(\d+)/, (ctx) => {
    const walletId = parseInt(ctx.match[1]);
    ctx.scene.enter('RECEIVE_TON_SCENE', { walletId });
});

bot.action('create_smart_gift', (ctx) => ctx.scene.enter('createGiftScene'));

bot.action(/^customize_wallet_(\d+)$/, (ctx) => {
    const walletId = parseInt(ctx.match[1]);
    return ctx.scene.enter('CUSTOMIZE_WALLET_SCENE', { walletId });
});
bot.action(/^cold_wallet_(\d+)$/, (ctx) => {
    const walletId = parseInt(ctx.match[1]);
    ctx.scene.enter('COLD_WALLET_SCENE', { walletId });
});

bot.action(/gift_cards_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    // Bitrefill Mini App: se abre dentro de Telegram como ventana segura
    const bitrefillRef = process.env.BITREFILL_REF || '';
    const refParam = bitrefillRef ? `&ref=${bitrefillRef}` : '';
    const bitrefillUrl = `https://embed.bitrefill.com/?paymentMethod=ton&theme=dark${refParam}`;

    try {
        await ctx.reply(
            `🛒 *Tienda de Tarjetas y Recargas*\n\n` +
            `Presiona el botón de abajo para abrir la tienda de **Bitrefill** directamente aquí en Telegram.\n\n` +
            `Podrás comprar Gift Cards, recargas móviles y más en cientos de marcas de todo el mundo, pagando con tus GRAM/TON.\n\n` +
            `_Bitrefill gestiona el proceso de compra de forma segura e independiente. HeartWallet no maneja ningún pago._`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.webApp('🛍️ Abrir Tienda Bitrefill', bitrefillUrl)],
                    [Markup.button.callback('⬅️ Volver', 'start_menu')]
                ])
            }
        );
    } catch(e) {
        console.error('Error opening Bitrefill:', e.message);
    }
});

bot.action(/sell_product_(\d+)/, (ctx) => {
    const walletId = parseInt(ctx.match[1]);
    ctx.scene.enter('CREATE_PRODUCT_SCENE', { walletId });
});

bot.action('purchased_content', (ctx) => {
    // Escena para ver contenido comprado
    ctx.scene.enter('PURCHASED_CONTENT_SCENE');
});



// Inline Query and Gifts
const { handleInlineQuery } = require('./handlers/inlineQuery');
bot.on('inline_query', handleInlineQuery);

bot.action(/claim_gift_(.+)/, async (ctx) => {
    const giftId = ctx.match[1];
    const telegramId = BigInt(ctx.from.id);

    try {
        const gift = await prisma.giftCheck.findUnique({
            where: { id: giftId },
            include: { sender: { include: { wallets: true } } }
        });

        if (!gift) return ctx.answerCbQuery("Este regalo no existe o ha expirado.", { show_alert: true });
        
        if (gift.status === 'CLAIMED') {
            return ctx.answerCbQuery("❌ ¡Ups! Alguien más ya reclamó este regalo.", { show_alert: true });
        }
        
        if (gift.sender.telegramId === telegramId) {
            return ctx.answerCbQuery("❌ No puedes reclamar tu propio regalo.", { show_alert: true });
        }

        const receiver = await prisma.user.findUnique({
            where: { telegramId },
            include: { wallets: true }
        });

        if (!receiver || receiver.wallets.length === 0) {
            return ctx.answerCbQuery("❌ Necesitas una cuenta y una billetera en HeartWallet para reclamar. Entra al bot y presiona /start.", { show_alert: true });
        }

        const receiverPrimaryWallet = receiver.wallets.find(w => w.isPrimary) || receiver.wallets[0];
        const senderPrimaryWallet = gift.sender.wallets.find(w => w.isPrimary) || gift.sender.wallets[0];

        if (!senderPrimaryWallet) {
            return ctx.answerCbQuery("❌ El remitente ya no tiene una billetera principal válida.", { show_alert: true });
        }

        // Validate Smart Gift Conditions
        if (gift.conditionType === 'TIME' && gift.unlockTime) {
            if (new Date() < new Date(gift.unlockTime)) {
                return ctx.answerCbQuery(`⏳ Aún no puedes abrirlo. Se desbloquea el: ${gift.unlockTime.toLocaleString()}`, { show_alert: true });
            }
        } else if (gift.conditionType === 'PASSWORD') {
            return ctx.answerCbQuery("🔐 Este regalo requiere una contraseña.", { url: `t.me/${ctx.botInfo.username}?start=claimpass_${gift.id}` });
        }

        // Aquí deberíamos enviar los fondos (sendTon)
        // Por seguridad en el UX, lo haremos y luego actualizaremos el status
        await ctx.answerCbQuery("⏳ Reclamando regalo... esto tomará unos segundos.", { show_alert: false });

        const { sendTon, getBalance } = require('./services/tonService');
        
        // Validar que el remitente todavía tenga fondos suficientes
        const senderBalanceNano = await getBalance(senderPrimaryWallet.address);
        const senderBalanceTon = Number(senderBalanceNano) / 1e9;
        const giftAmountTon = Number(gift.amountNano) / 1e9;
        const feeBuffer = 0.03; // Margen para comisiones
        
        if (giftAmountTon + feeBuffer > senderBalanceTon) {
            return ctx.answerCbQuery(`❌ Error: El creador del regalo ya no tiene suficientes fondos en su billetera para cubrir el monto y las comisiones.`, { show_alert: true });
        }
        
        // sendTon espera la llave encriptada y la desencripta internamente
        const result = await sendTon(senderPrimaryWallet.encryptedPrivateKey, receiverPrimaryWallet.address, gift.amountNano);

        if (result.success) {
            await prisma.giftCheck.update({
                where: { id: giftId },
                data: {
                    status: 'CLAIMED',
                    receiverId: receiver.id,
                    claimedAt: new Date()
                }
            });

            // Actualizar el mensaje original si es posible
            try {
                const amountTon = (Number(gift.amountNano) / 1e9).toString();
                await ctx.editMessageText(`✅ **¡Regalo de ${amountTon} GRAM reclamado!**\n\n🎉 Reclamado por: [${ctx.from.first_name}](tg://user?id=${ctx.from.id})`, { parse_mode: 'Markdown' });
            } catch(e) {}
        } else {
            // El usuario que reclama ve el error. 
            // Si falla por balance, es que el remitente no tenía los fondos
            return ctx.answerCbQuery(`❌ Error al reclamar: El remitente no tiene suficientes fondos o hubo un error de red.`, { show_alert: true });
        }

    } catch (e) {
        console.error("Error claiming gift:", e);
        return ctx.answerCbQuery("Ocurrió un error al procesar el regalo.", { show_alert: true });
    }
});

const { startTransactionMonitor } = require('./services/transactionMonitor');
const { startTonConnectListener, registerTonConnectPaymentHandlers } = require('./services/tonConnectListener');

// Referencia global para el listener SSE
global.heartWalletBot = bot;

// Registrar handlers de aprobación/rechazo de pagos TonConnect
registerTonConnectPaymentHandlers(bot);

// Handler global para errores no capturados — loguear sin crashear el bot
process.on('unhandledRejection', (reason) => {
    logError('UNHANDLED_REJECTION', reason instanceof Error ? reason : new Error(String(reason)), {});
});
process.on('uncaughtException', (err) => {
    logError('UNCAUGHT_EXCEPTION', err, {});
    // NO hacer process.exit para mantener el bot activo
});

async function launchBot() {
    // bot.launch(config, onLaunch) — el callback onLaunch se ejecuta cuando el bot
    // está listo y escuchando, SIN bloquear el event loop.
    bot.launch({}, () => {
        logSuccess('BOT_LAUNCHED', { note: 'Bot de Telegram iniciado y escuchando.' });
        console.log("Bot de Telegram iniciado exitosamente. (HeartWallet)");
        // Arrancar servicios en paralelo DESPUÉS de confirmar que el bot está vivo
        startTransactionMonitor(bot);
        startTonConnectListener(bot);
        const { startEscrowService } = require('./services/escrowService');
        startEscrowService();
    });
    // NO hacemos await — bot.launch() corre el polling loop en paralelo
}

process.once('SIGINT', () => { logInfo('BOT_STOP', { note: 'SIGINT recibido, deteniendo bot.' }); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { logInfo('BOT_STOP', { note: 'SIGTERM recibido, deteniendo bot.' }); bot.stop('SIGTERM'); });


module.exports = { bot, launchBot };
