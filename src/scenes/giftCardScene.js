const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { hashData } = require('../services/cryptoService');
const crApi = require('../services/cryptoRefillsService');
const { sendTon } = require('../services/tonService');

const COUNTRIES = [
    { code: 'MX', name: '🇲🇽 México' },
    { code: 'US', name: '🇺🇸 Estados Unidos' },
    { code: 'ES', name: '🇪🇸 España' },
    { code: 'CO', name: '🇨🇴 Colombia' },
    { code: 'AR', name: '🇦🇷 Argentina' },
    { code: 'BR', name: '🇧🇷 Brasil' }
];

const giftCardWizard = new Scenes.WizardScene(
    'GIFT_CARD_SCENE',
    // Paso 0: Menú principal de País / Categoría
    async (ctx) => {
        ctx.scene.session.walletId = ctx.scene.state.walletId;
        // Limpiar email en cada compra nueva para que siempre lo pida
        ctx.scene.session.userEmail = null;
        if (!ctx.scene.session.countryCode) {
            ctx.scene.session.countryCode = 'MX'; // Default
        }
        
        if (ctx.callbackQuery) {
            await ctx.deleteMessage().catch(() => {});
        }

        const countryName = COUNTRIES.find(c => c.code === ctx.scene.session.countryCode)?.name || ctx.scene.session.countryCode;

        const buttons = [
            [Markup.button.callback('📱 Recargas Telefónicas', 'cat_mobile_recharge')],
            [Markup.button.callback('💳 Tarjetas de Regalo', 'cat_giftcard')],
            [Markup.button.callback('🎮 Juegos', 'cat_games')],
            [Markup.button.callback(`🌍 Cambiar País (Actual: ${countryName})`, 'change_country')],
            [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
        ];

        const msg = await ctx.reply("🛒 **Tienda de Tarjetas y Recargas**\n\nBienvenido al catálogo global patrocinado por CryptoRefills. Paga directamente desde tu HeartWallet.\n\nSelecciona una categoría:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        ctx.scene.session.promptId = msg.message_id;
        return ctx.wizard.next();
    },
    // Paso 1: Handler de Categorías / País
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'cancel_scene') {
            await ctx.answerCbQuery();
            return leaveAndStart(ctx);
        }

        if (action === 'change_country') {
            await ctx.answerCbQuery();
            const buttons = [];
            for (let i = 0; i < COUNTRIES.length; i += 2) {
                const row = [Markup.button.callback(COUNTRIES[i].name, `set_country_${COUNTRIES[i].code}`)];
                if (COUNTRIES[i+1]) row.push(Markup.button.callback(COUNTRIES[i+1].name, `set_country_${COUNTRIES[i+1].code}`));
                buttons.push(row);
            }
            buttons.push([Markup.button.callback('⬅️ Volver', 'back_to_main')]);
            
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "🌍 **Selecciona tu país:**", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return; // stay in step 1
        }

        if (action.startsWith('set_country_')) {
            await ctx.answerCbQuery();
            ctx.scene.session.countryCode = action.replace('set_country_', '');
            ctx.wizard.selectStep(0);
            return ctx.wizard.steps[0](ctx);
        }

        if (action === 'back_to_main') {
            await ctx.answerCbQuery();
            ctx.wizard.selectStep(0);
            return ctx.wizard.steps[0](ctx);
        }

        if (action.startsWith('cat_')) {
            await ctx.answerCbQuery();
            const category = action.replace('cat_', '');
            
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "⏳ Cargando catálogo...", { parse_mode: 'Markdown' });
            
            const brands = await crApi.getBrands(ctx.scene.session.countryCode);
            // Filtrar por categoría (approximate)
            let filteredBrands = brands;
            if (category === 'mobile_recharge') {
                filteredBrands = brands.filter(b => b.kind === 'mobile_recharge' || b.category?.includes('mobile'));
            } else if (category === 'giftcard') {
                filteredBrands = brands.filter(b => b.kind === 'giftcard' && !b.category?.includes('game'));
            } else if (category === 'games') {
                filteredBrands = brands.filter(b => b.category?.includes('game') || b.category?.includes('entertainment'));
            }

            ctx.scene.session.filteredBrands = filteredBrands;
            ctx.scene.session.brandPage = 0;
            return renderBrands(ctx);
        }

        // Si ya está paginando marcas:
        if (action === 'prev_brands') {
            await ctx.answerCbQuery();
            ctx.scene.session.brandPage = Math.max(0, ctx.scene.session.brandPage - 1);
            return renderBrands(ctx);
        }
        if (action === 'next_brands') {
            await ctx.answerCbQuery();
            ctx.scene.session.brandPage++;
            return renderBrands(ctx);
        }

        if (action.startsWith('brand_')) {
            await ctx.answerCbQuery();
            const brandId = action.replace('brand_', '');
            const brand = ctx.scene.session.filteredBrands.find(b => b.brand_id === brandId);
            if (!brand) return;

            ctx.scene.session.selectedBrand = brand;
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "⏳ Obteniendo paquetes disponibles...", { parse_mode: 'Markdown' });

            const products = await crApi.getProductsByBrand(ctx.scene.session.countryCode, brand.family);
            ctx.scene.session.products = products;

            if (!products || products.length === 0) {
                const buttons = [[Markup.button.callback('⬅️ Volver', 'back_to_main')]];
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ No hay paquetes disponibles para esta marca actualmente.", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return;
            }

            return renderProducts(ctx);
        }
    },
    // Paso 2: Handler de Paquetes
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'cancel_scene') {
            await ctx.answerCbQuery();
            return leaveAndStart(ctx);
        }

        if (action === 'back_to_brands') {
            await ctx.answerCbQuery();
            ctx.wizard.selectStep(1);
            return renderBrands(ctx);
        }

        if (action.startsWith('pkg_')) {
            await ctx.answerCbQuery();
            const pkgId = action.replace('pkg_', '');
            const product = ctx.scene.session.products.find(p => p.product_id === pkgId);
            if (!product) return;

            ctx.scene.session.selectedProduct = product;
            
            // No leer email de DB aqui — ya se limpio en paso 0 para forzar que siempre lo pida

            if (product.face_value.amount.type === 'range') {
                ctx.scene.session.awaitingAmount = true;
                const min = product.face_value.amount.min;
                const max = product.face_value.amount.max;
                const cur = product.face_value.currency_code;
                const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `✍️ **Monto Variable**\n\nPor favor, **escribe en el chat** la cantidad que deseas comprar (entre **${min}** y **${max} ${cur}**):`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return ctx.wizard.next();
            } else {
                if (!ctx.scene.session.userEmail) {
                    const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
                    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "📧 **Requisito de Email**\n\nCryptoRefills requiere un correo electrónico para enviarte el recibo y soporte en caso de problemas con el código.\n\nPor favor, **escribe tu correo electrónico:**", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                    ctx.scene.session.awaitingEmail = true;
                    return ctx.wizard.next();
                } else {
                    return doValidation(ctx);
                }
            }
        }
    },
    // Paso 3: Handler de Email / Custom Amount / Confirmación de Validación
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') {
            await ctx.answerCbQuery();
            return leaveAndStart(ctx);
        }

        if (ctx.scene.session.awaitingAmount) {
            const text = ctx.message?.text?.trim();
            if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
            if (text === '/cancelar') return leaveAndStart(ctx);

            const amount = parseFloat(text);
            const min = parseFloat(ctx.scene.session.selectedProduct.face_value.amount.min);
            const max = parseFloat(ctx.scene.session.selectedProduct.face_value.amount.max);

            if (isNaN(amount) || amount < min || amount > max) {
                const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `❌ Monto inválido. Debe ser un número entre **${min}** y **${max}**. Intenta de nuevo escribiendo el monto:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return;
            }

            ctx.scene.session.customAmount = amount.toString();
            ctx.scene.session.awaitingAmount = false;

            if (!ctx.scene.session.userEmail) {
                const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "📧 **Requisito de Email**\n\nCryptoRefills requiere un correo electrónico para enviarte el recibo y soporte en caso de problemas con el código.\n\nPor favor, **escribe tu correo electrónico:**", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                ctx.scene.session.awaitingEmail = true;
                return; // se queda en este paso esperando email
            } else {
                return doValidation(ctx);
            }
        }

        if (ctx.scene.session.awaitingEmail) {
            const text = ctx.message?.text?.trim();
            if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
            
            if (text === '/cancelar') return leaveAndStart(ctx);

            if (!text || !/^\S+@\S+\.\S+$/.test(text)) {
                const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Email inválido. Intenta nuevamente escribiendo un correo válido:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return;
            }

            ctx.scene.session.userEmail = text;
            await prisma.user.update({
                where: { telegramId: BigInt(ctx.from.id) },
                data: { email: text }
            });
            ctx.scene.session.awaitingEmail = false;
            return doValidation(ctx);
        }

        if (ctx.callbackQuery?.data === 'confirm_buy') {
            await ctx.answerCbQuery();
            const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
            
            if (user && user.recoveryPinHash) {
                ctx.scene.session.expectedPinHash = user.recoveryPinHash;
                const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "🔐 **Verificación de Seguridad**\n\nPor favor, ingresa tu **PIN de 4 dígitos** para autorizar el pago desde tu billetera:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return ctx.wizard.next();
            } else {
                return executeApiPurchase(ctx);
            }
        }
    },
    // Paso 4: Handler de PIN
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') {
            await ctx.answerCbQuery();
            return leaveAndStart(ctx);
        }

        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});

        if (text === '/cancelar') return leaveAndStart(ctx);

        if (!text || !/^\d{4}$/.test(text)) {
            const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ PIN inválido. Debe ser de 4 dígitos. Intenta de nuevo:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return;
        }

        if (hashData(text) !== ctx.scene.session.expectedPinHash) {
            const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ **PIN Incorrecto**. Transacción bloqueada. Intenta de nuevo:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return;
        }

        // PIN Correcto
        return executeApiPurchase(ctx);
    }
);

// ── Acciones globales de la escena (funcionan desde cualquier paso) ──────────
giftCardWizard.action('back_to_brands', async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.scene.session.filteredBrands || ctx.scene.session.filteredBrands.length === 0) {
        // Si no hay marcas en sesión, volver al inicio
        ctx.wizard.selectStep(0);
        return ctx.wizard.steps[0](ctx);
    }
    ctx.wizard.selectStep(1);
    return renderBrands(ctx);
});

giftCardWizard.action('back_to_main', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.selectStep(0);
    return ctx.wizard.steps[0](ctx);
});

giftCardWizard.action('cancel_scene', async (ctx) => {
    await ctx.answerCbQuery();
    return leaveAndStart(ctx);
});

giftCardWizard.command('start', async (ctx) => {
    if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
});
// ─────────────────────────────────────────────────────────────────────────────

async function renderBrands(ctx) {
    const brands = ctx.scene.session.filteredBrands;
    const page = ctx.scene.session.brandPage;
    const perPage = 10;
    const start = page * perPage;
    const end = start + perPage;
    const slice = brands.slice(start, end);

    const buttons = [];
    for (let i = 0; i < slice.length; i += 2) {
        const row = [Markup.button.callback(slice[i].brand, `brand_${slice[i].brand_id}`)];
        if (slice[i+1]) row.push(Markup.button.callback(slice[i+1].brand, `brand_${slice[i+1].brand_id}`));
        buttons.push(row);
    }

    const navRow = [];
    if (page > 0) navRow.push(Markup.button.callback('⬅️ Anterior', 'prev_brands'));
    navRow.push(Markup.button.callback('🏠 Categorías', 'back_to_main'));
    if (end < brands.length) navRow.push(Markup.button.callback('Siguiente ➡️', 'next_brands'));
    buttons.push(navRow);
    buttons.push([Markup.button.callback('❌ Cancelar', 'cancel_scene')]);

    await ctx.telegram.editMessageText(
        ctx.chat.id, 
        ctx.scene.session.promptId, 
        null, 
        `🏢 **Selecciona una marca**\n*(Página ${page + 1} de ${Math.ceil(brands.length / perPage)})*`, 
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
    );
    // Ensure we are on step 1
    ctx.wizard.selectStep(1);
}

async function renderProducts(ctx) {
    const products = ctx.scene.session.products;
    const brand = ctx.scene.session.selectedBrand;
    
    const buttons = [];
    products.forEach(p => {
        if (!p.face_value || !p.face_value.amount) return;
        let label = '';
        if (p.face_value.amount.type === 'fixed') {
            label = `${p.face_value.amount.price} ${p.face_value.currency_code}`;
        } else {
            label = `Monto variable: ${p.face_value.amount.min} - ${p.face_value.amount.max} ${p.face_value.currency_code}`;
        }
        buttons.push([Markup.button.callback(label, `pkg_${p.product_id}`)]);
    });
    
    buttons.push([Markup.button.callback('⬅️ Volver a Marcas', 'back_to_brands')]);
    buttons.push([Markup.button.callback('❌ Cancelar', 'cancel_scene')]);

    await ctx.telegram.editMessageText(
        ctx.chat.id, 
        ctx.scene.session.promptId, 
        null, 
        `📦 **${brand.brand}**\n\nSelecciona el paquete:`, 
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
    );
    ctx.wizard.selectStep(2);
}

async function doValidation(ctx) {
    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "⏳ Validando disponibilidad y obteniendo tipo de cambio en tiempo real...", { parse_mode: 'Markdown' });
    
    try {
        const product = ctx.scene.session.selectedProduct;
        const brand = ctx.scene.session.selectedBrand;
        const email = ctx.scene.session.userEmail;
        
        let denomination;
        let value = null;
        let displayValue = '';

        if (product.face_value.amount.type === 'fixed') {
            // Para productos fijos, denomination ES el precio (ej: "99", "150")
            denomination = product.face_value.amount.price.toString();
            value = parseFloat(product.face_value.amount.price);
            displayValue = `${value} ${product.face_value.currency_code}`;
        } else {
            denomination = 'range';
            value = parseFloat(ctx.scene.session.customAmount);
            displayValue = `${value} ${product.face_value.currency_code}`;
        }

        const validation = await crApi.validateOrder(
            email, 
            brand.brand, 
            brand.country_code, 
            denomination,
            value
        );

        ctx.scene.session.validation = validation;
        ctx.scene.session.denomination = denomination;
        ctx.scene.session.productValue = value;

        const totalCrypto = validation.summary.coin_amount_to_pay_in_crypto;
        const delivery = validation.deliveries[0].deliverable || validation.deliveries[0];
        const fiatPrice = delivery.product_value || delivery.original_price;
        const fiatCurrency = delivery.currency_code || 'USD';

        const buttons = [
            [Markup.button.callback('✅ Confirmar y Pagar', 'confirm_buy')],
            [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
        ];

        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            ctx.scene.session.promptId, 
            null, 
            `🛒 **Checkout de Compra**\n\n` +
            `Producto: **${brand.brand} ${displayValue}**\n` +
            `Total Fiat: **${fiatPrice} ${fiatCurrency}**\n\n` +
            `A Pagar: **${totalCrypto} GRAM (TON)**\n\n` +
            `¿Autorizas realizar el pago desde tu billetera ahora?`, 
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );
        ctx.wizard.selectStep(3); // Avanzamos al paso 3 (email validation bypass)

    } catch (e) {
        const buttons = [
            [Markup.button.callback('⬅️ Elegir otro producto', 'back_to_brands')],
            [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
        ];

        let errorMsg = `❌ **Error al validar la compra:**\n\n\`${e.message}\``;

        if (e.message.includes('NOT_AVAILABLE_PRODUCT')) {
            errorMsg = `🚫 **Producto no disponible**\n\nEste producto no está disponible para pago con GRAM en este momento.\n\n_Elige otro producto del catálogo._`;
        } else if (e.message.includes('OUT_OF_STOCK')) {
            errorMsg = `😔 **Sin stock**\n\nEste producto está agotado temporalmente.\n\n_Intenta con otro producto o vuelve más tarde._`;
        } else if (e.message.includes('CANT_SETUP_PAYMENT')) {
            errorMsg = `⚠️ **Pago no disponible**\n\nNo se puede configurar el pago con GRAM para este producto en este momento.\n\n_Prueba con otro producto._`;
        }

        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, errorMsg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
}

async function executeApiPurchase(ctx) {
    try {
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "⏳ 1/3 Creando Orden en CryptoRefills...", { parse_mode: 'Markdown' });
        
        const product = ctx.scene.session.selectedProduct;
        const brand = ctx.scene.session.selectedBrand;
        const email = ctx.scene.session.userEmail;

        const order = await crApi.createOrder(
            email,
            brand.brand,
            brand.country_code,
            ctx.scene.session.denomination,
            ctx.scene.session.productValue
        );

        const returnButton = [[Markup.button.callback('⬅️ Volver al Menú Principal', 'cancel_scene')]];

        // Validar respuesta antes de continuar
        if (!order) throw new Error("CryptoRefills no devolvio ninguna respuesta.");

        if (order.status && order.status >= 400) {
            const detail = order.detail || order.message || 'Error desconocido';
            const backButtons = [
                [Markup.button.callback('⬅️ Elegir otro producto', 'back_to_brands')],
                [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
            ];
            const friendlyErrors = {
                'OUT_OF_STOCK':          `😔 **Sin stock**\n\nEste producto está agotado para pago con GRAM.\n\n_Intenta con otro producto._`,
                'NOT_AVAILABLE_PRODUCT': `🚫 **Producto no disponible**\n\nEste producto no está disponible para pago con GRAM.\n\n_Elige otro del catálogo._`,
                'CANT_SETUP_PAYMENT':    `⚠️ **Pago no configurado**\n\nNo se puede procesar el pago con GRAM para este producto ahora.\n\n_Prueba con otro producto._`,
            };
            const friendlyMsg = friendlyErrors[detail];
            if (friendlyMsg) {
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, friendlyMsg,
                    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(backButtons) });
                return; // No salir de la escena — el boton back_to_brands la mantiene activa
            }
            throw new Error(`Error de CryptoRefills (${order.status}): ${detail}`);
        }

        if (!order.payment || !order.payment.address) {
            // ── Estructura real de CryptoRefills v5 USER_WALLET ──
            // La API devuelve: wallet_address, coin_amount, order_id, payment_id
            // (NO usa order.payment.address)
            const paymentAddr = order.wallet_address;
            const coinAmountGram = parseFloat(order.coin_amount || order.summary?.coin_amount_to_pay_in_crypto || '0');
            const orderId = order.order_id;
            const memoToUse = order.payment_id || orderId || '';

            if (!paymentAddr || coinAmountGram <= 0) {
                console.error("Respuesta inesperada de CryptoRefills:", JSON.stringify(order));
                throw new Error("La API no proporcionó dirección de pago válida. Intenta de nuevo.");
            }

            // coin_amount viene en GRAM (ej: "0.86726695"), hay que convertir a nanotons
            const paymentNano = BigInt(Math.round(coinAmountGram * 1e9)).toString();

            // ── Verificar saldo suficiente antes de enviar ──
            const { getBalance } = require('../services/tonService');
            const walletData = await prisma.wallet.findUnique({ where: { id: ctx.scene.session.walletId } });
            if (!walletData) throw new Error("No se encontró tu billetera en la base de datos.");

            const currentBalanceNano = await getBalance(walletData.address);
            const currentBalanceGram = Number(currentBalanceNano) / 1e9;
            const NETWORK_FEE = 0.05; // reserva mínima para fees de red

            if (currentBalanceGram < coinAmountGram + NETWORK_FEE) {
                const buttons = [
                    [Markup.button.callback('⬅️ Elegir otro producto', 'back_to_brands')],
                    [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
                ];
                await ctx.telegram.editMessageText(
                    ctx.chat.id, ctx.scene.session.promptId, null,
                    `❌ **Saldo insuficiente**\n\nNecesitas **${(coinAmountGram + NETWORK_FEE).toFixed(4)} GRAM** para esta compra.\n\nTu saldo actual: **${currentBalanceGram.toFixed(4)} GRAM**\n\n_Recarga tu billetera e inténtalo de nuevo._`,
                    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
                );
                return; // Mantener escena activa
            }
            // ──────────────────────────────────────

            const txResult = await sendTon(walletData.encryptedPrivateKey, paymentAddr, paymentNano, memoToUse);
            if (!txResult.success) {
                throw new Error(txResult.error || "La transacción en la blockchain falló.");
            }

            const buttons = [[Markup.button.callback('⬅️ Volver al Menú Principal', 'cancel_scene')]];
            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.promptId, null,
                `✅ **¡Pago Enviado!** 🚀\n\nTu orden **#${orderId}** ha sido recibida y pagada en la blockchain.\n\n💰 Enviado: **${coinAmountGram.toFixed(6)} GRAM**\n\nCryptoRefills está procesando el pago. **Recibirás tu código por email** en cuanto se confirme la red.\n\n_Puedes cerrar este menú mientras esperas._`,
                { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
            );

            // Iniciar polling asíncrono con el id correcto
            pollOrderStatus(ctx.telegram, ctx.chat.id, orderId);
            return; // ya terminamos
        }

        // Flujo legacy si la API devuelve order.payment (por compatibilidad)
        const paymentAddr = order.payment.address;
        const paymentAmount = order.payment.total_crypto_value;
        const memoToUse = order.payment.memo || order.id?.toString() || '';

        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "⏳ 2/3 Firmando y enviando transacción en TON blockchain...", { parse_mode: 'Markdown' });

        const walletData = await prisma.wallet.findUnique({ where: { id: ctx.scene.session.walletId } });
        if (!walletData) throw new Error("No se encontró tu billetera en la base de datos.");

        const txResult = await sendTon(walletData.encryptedPrivateKey, paymentAddr, paymentAmount.toString(), memoToUse);
        if (!txResult.success) {
            throw new Error(txResult.error || "La transacción en la blockchain falló.");
        }

        const buttons = [[Markup.button.callback('⬅️ Volver al Menú Principal', 'cancel_scene')]];
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            ctx.scene.session.promptId, 
            null, 
            `✅ **¡Pago Enviado!** 🚀\n\nTu orden **#${order.id}** ha sido recibida y pagada en la blockchain.\n\nCryptoRefills está procesando el pago. **Recibirás tu código por mensaje privado aquí en un par de minutos** en cuanto se confirme la red.\n\nPuedes cerrar este menú mientras esperas.`, 
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );

        // Iniciar polling asíncrono
        pollOrderStatus(ctx.telegram, ctx.chat.id, order.id);

    } catch (e) {
        console.error("executeApiPurchase error:", e.message);
        const buttons = [[Markup.button.callback('❌ Cerrar', 'cancel_scene')]];
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `❌ **Error al procesar la compra:**\n\n\`${e.message}\``, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
    
    return ctx.scene.leave();
}

// Background poller
async function pollOrderStatus(telegram, chatId, orderId) {
    let attempts = 0;
    const maxAttempts = 30; // 5 minutos (10s x 30)
    
    const interval = setInterval(async () => {
        attempts++;
        try {
            const orderInfo = await crApi.getOrder(orderId);
            
            if (orderInfo.status === 'DELIVERED' || orderInfo.status === 'COMPLETED') {
                clearInterval(interval);
                let message = `🎉 **¡Tu orden de CryptoRefills ha llegado!**\n\nOrden: #${orderId}\n`;
                
                if (orderInfo.deliveries && orderInfo.deliveries[0] && orderInfo.deliveries[0].pin) {
                    message += `🎁 **Código:** \`${orderInfo.deliveries[0].pin}\`\n`;
                } else {
                    message += `✅ **El saldo ha sido aplicado directamente.**\n`;
                }
                
                await telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            } else if (orderInfo.status === 'REFUNDED' || orderInfo.status === 'CANCELED') {
                clearInterval(interval);
                await telegram.sendMessage(chatId, `⚠️ **Aviso de tu orden #${orderId}:**\nLa orden ha sido cancelada o reembolsada por el proveedor. Por favor revisa tu correo o contacta soporte.`);
            }

            if (attempts >= maxAttempts) {
                clearInterval(interval);
                await telegram.sendMessage(chatId, `⏳ **Tu orden #${orderId} está tomando más de lo esperado.**\n\nEl pago fue enviado, pero la red TON puede estar lenta. El proveedor entregará el código a tu correo electrónico registrado cuando se confirme el pago.`);
            }
        } catch (e) {
            console.error("Polling error:", e);
        }
    }, 10000); // 10 segundos
}

async function leaveAndStart(ctx) {
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
}

module.exports = { giftCardWizard };
