const { Markup } = require('telegraf');
const { prisma } = require('../db/prisma');

async function handleStart(ctx) {
    if (!ctx.from) return;
    
    const telegramId = BigInt(ctx.from.id);
    const firstName = ctx.from.first_name;
    
    if (ctx.startPayload && ctx.startPayload.startsWith('split_')) {
        const splitId = ctx.startPayload.replace('split_', '');
        ctx.scene.session.splitId = splitId;
        return ctx.scene.enter('splitScene');
    }

    if (ctx.startPayload && ctx.startPayload.startsWith('claimpass_')) {
        const giftId = ctx.startPayload.replace('claimpass_', '');
        ctx.scene.session.giftId = giftId;
        return ctx.scene.enter('claimPasswordScene');
    }

    if (ctx.startPayload && ctx.startPayload.startsWith('buy_')) {
        const productId = ctx.startPayload.replace('buy_', '');
        ctx.scene.session.productId = productId;
        return ctx.scene.enter('BUY_PRODUCT_SCENE');
    }

    if (ctx.startPayload && ctx.startPayload.startsWith('subplan_')) {
        const planId = ctx.startPayload.replace('subplan_', '');
        ctx.scene.state.planId = planId;
        return ctx.scene.enter('BUY_SUBSCRIPTION_SCENE');
    }

    try {
        let user = await prisma.user.findUnique({
            where: { telegramId },
            include: { wallets: true }
        });

        if (!user) {
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

            return await ctx.reply(termsPart1, { parse_mode: 'Markdown', ...keyboard });
        }

        const wallets = user.wallets;
        const buttons = [];
        wallets.forEach((w, index) => {
            const prefix = w.isPrimary ? '⭐ ' : '';
            buttons.push([Markup.button.callback(`${prefix}${w.name}`, `view_wallet_${w.id}`)]);
        });
        
        if (wallets.length < user.maxWallets) {
            buttons.push([Markup.button.callback('➕ Crear Nueva Billetera', 'create_wallet')]);
        } else {
            buttons.push([Markup.button.callback('💎 Expandir Límite de Billeteras', 'request_expansion')]);
        }
        
        if (wallets.length > 0) {
            buttons.push([Markup.button.callback('❌ Eliminar Billetera', 'start_delete_wallet')]);
            buttons.push([Markup.button.callback('🔐 Respaldar Cuenta', 'start_backup_wallet')]);
        }
        
        buttons.push([Markup.button.callback('💖 Apoyar Proyecto (Donar)', 'support_project')]);
        buttons.push([Markup.button.callback('🎧 Soporte Técnico', 'start_support')]);
        buttons.push([Markup.button.callback('❓ ¿Cómo funciona esto?', 'info_project')]);
        buttons.push([Markup.button.callback('🔗 Conectar Wallet', 'start_tonconnect')]);

        const { generateDashboardImage } = require('../utils/canvasDashboard');
        const imageBuffer = await generateDashboardImage(user, wallets);
        
        const caption = ``;

        const media = {
            type: 'photo',
            media: { source: imageBuffer },
            caption,
            parse_mode: 'HTML'
        };

        if (ctx.callbackQuery) {
            try {
                await ctx.editMessageMedia(media, Markup.inlineKeyboard(buttons));
                return;
            } catch(e) {
                try { await ctx.deleteMessage(); } catch(e2) {}
            }
        }
        
        await ctx.replyWithPhoto(
            { source: imageBuffer },
            { parse_mode: 'HTML', caption, ...Markup.inlineKeyboard(buttons) }
        );

    } catch (error) {
        console.error("Error in start handler:", error);
        await ctx.reply("❌ Hubo un error al iniciar tu sesión. Por favor, intenta de nuevo más tarde.");
    }
}

module.exports = { handleStart };
