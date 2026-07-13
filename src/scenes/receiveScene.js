const { Scenes, Markup } = require('telegraf');
const QRCode = require('qrcode');
const { createCanvas } = require('canvas');
const { prisma } = require('../db/prisma');

const receiveWizard = new Scenes.WizardScene(
    'RECEIVE_TON_SCENE',
    async (ctx) => {
        ctx.scene.session.walletId = ctx.scene.state.walletId || ctx.scene.session.walletId;
        if (ctx.callbackQuery) {
            await ctx.deleteMessage().catch(() => {});
        }
        const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
        const msg = await ctx.reply("🏷 ¿Bajo qué **concepto** deseas recibir este pago? (ej. 'Donativo' o 'Pago mensual').\n\n_(Envía /omitir si no quieres concepto, o presiona cancelar para salir)_", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        ctx.scene.session.promptId = msg.message_id;
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') {
            await ctx.answerCbQuery();
            const btns = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver a Billetera', `view_wallet_${ctx.scene.session.walletId}`)]]);
            await ctx.editMessageText("❌ Recepción cancelada.", btns);
            return ctx.scene.leave();
        }

        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});

        if (text === '/cancelar') {
            const btns = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver a Billetera', `view_wallet_${ctx.scene.session.walletId}`)]]);
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Cancelado.", btns);
            return ctx.scene.leave();
        }
        
        let concept = text;
        if (text === '/omitir') {
            concept = '';
        }
        
        try {
            const { displayAd } = require('../services/adService');
            // 1. Mostrar anuncio por 5 segundos
            const adResult = await displayAd(ctx, "⏳ Generando código QR... Por favor espera 5 segundos.", ctx.scene.session.promptId);
            if (adResult.adShown) {
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            // Continuar cargando el QR
            // Borrar el anuncio para poner la imagen del QR limpia
            if (adResult && adResult.messageId) {
                await ctx.telegram.deleteMessage(ctx.chat.id, adResult.messageId).catch(()=>{});
            }

            const walletId = ctx.scene.session.state?.walletId || ctx.scene.session.walletId;
            const wallet = await prisma.wallet.findUnique({
                where: { id: walletId },
                include: { user: true }
            });
            
            if (!wallet || wallet.user.telegramId !== BigInt(ctx.from.id)) {
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ No se encontró tu billetera.");
                return ctx.scene.leave();
            }
            
            const address = wallet.address;
            
            // Usar solo la dirección pura para máxima compatibilidad con exchanges
            let uri = address;
            
            // Generar el QR crudo en un canvas temporal
            const qrSize = 340;
            const tempCanvas = createCanvas(qrSize, qrSize);
            await QRCode.toCanvas(tempCanvas, uri, {
                errorCorrectionLevel: 'H',
                margin: 1,
                width: qrSize,
                color: {
                    dark: '#ec4899', // Un color rosado elegante (pink-500)
                    light: '#ffffff'
                }
            });
            
            // Dibujar logo en el centro del tempCanvas
            const tempCtx = tempCanvas.getContext('2d');
            const center = qrSize / 2;
            const size = 70; // tamaño del logo
            
            // Cuadro blanco de fondo para el logo
            tempCtx.fillStyle = '#ffffff';
            function roundRectLocal(ctx, x, y, w, h, r) {
                ctx.beginPath();
                ctx.moveTo(x + r, y);
                ctx.arcTo(x + w, y, x + w, y + h, r);
                ctx.arcTo(x + w, y + h, x, y + h, r);
                ctx.arcTo(x, y + h, x, y, r);
                ctx.arcTo(x, y, x + r, y, r);
                ctx.closePath();
                return ctx;
            }
            roundRectLocal(tempCtx, center - size/2, center - size/2, size, size, 12);
            tempCtx.fill();
            
            try {
                const { loadImage } = require('canvas');
                const path = require('path');
                const logoPath = path.join(__dirname, '../assets/ChatGPT Image 1 jul 2026, 07_34_38 p.m..png');
                const logo = await loadImage(logoPath);
                tempCtx.save();
                tempCtx.beginPath();
                tempCtx.arc(center, center, (size - 8) / 2, 0, Math.PI * 2);
                tempCtx.closePath();
                tempCtx.clip();
                tempCtx.drawImage(logo, center - (size - 8)/2, center - (size - 8)/2, size - 8, size - 8);
                tempCtx.restore();
            } catch (e) {
                tempCtx.font = '36px sans-serif';
                tempCtx.textAlign = 'center';
                tempCtx.textBaseline = 'middle';
                tempCtx.fillStyle = '#ec4899';
                tempCtx.fillText('💖', center, center);
            }

            // === DISEÑO PROFESIONAL DEL CÓDIGO QR ===
            const bgWidth = 500;
            const bgHeight = 650;
            const mainCanvas = createCanvas(bgWidth, bgHeight);
            const ctxCanvas = mainCanvas.getContext('2d');

            // Fondo Gradiente
            const bgGrad = ctxCanvas.createLinearGradient(0, 0, bgWidth, bgHeight);
            bgGrad.addColorStop(0, '#ff758c');
            bgGrad.addColorStop(0.5, '#ff7eb3');
            bgGrad.addColorStop(1, '#c471ed');
            ctxCanvas.fillStyle = bgGrad;
            ctxCanvas.fillRect(0, 0, bgWidth, bgHeight);

            // Círculos Decorativos
            ctxCanvas.fillStyle = 'rgba(255, 255, 255, 0.1)';
            ctxCanvas.beginPath(); ctxCanvas.arc(500, 0, 200, 0, Math.PI * 2); ctxCanvas.fill();
            ctxCanvas.beginPath(); ctxCanvas.arc(0, 650, 150, 0, Math.PI * 2); ctxCanvas.fill();

            // Tarjeta Glassmorphism
            ctxCanvas.fillStyle = 'rgba(255, 255, 255, 0.2)';
            roundRectLocal(ctxCanvas, 30, 40, 440, 570, 24);
            ctxCanvas.fill();
            ctxCanvas.lineWidth = 1.5;
            ctxCanvas.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctxCanvas.stroke();

            // Título
            ctxCanvas.textAlign = 'center';
            ctxCanvas.font = 'bold 28px sans-serif';
            ctxCanvas.fillStyle = '#ffffff';
            ctxCanvas.shadowColor = 'rgba(0,0,0,0.15)';
            ctxCanvas.shadowBlur = 6;
            ctxCanvas.fillText('Recibir GRAM (TON)', 250, 95);
            ctxCanvas.shadowBlur = 0;
            
            // Subtítulo
            ctxCanvas.font = '16px sans-serif';
            ctxCanvas.fillStyle = 'rgba(255,255,255,0.85)';
            ctxCanvas.fillText(concept ? `Concepto: ${concept}` : 'Escanea para enviar fondos', 250, 125);

            // Sombra del contenedor del QR
            ctxCanvas.shadowColor = 'rgba(0,0,0,0.2)';
            ctxCanvas.shadowBlur = 15;
            ctxCanvas.shadowOffsetY = 5;
            ctxCanvas.fillStyle = '#ffffff';
            roundRectLocal(ctxCanvas, 70, 155, 360, 360, 16);
            ctxCanvas.fill();
            ctxCanvas.shadowColor = 'transparent';

            // Dibujar QR final
            ctxCanvas.drawImage(tempCanvas, 80, 165, 340, 340);

            // Dirección Cortada
            ctxCanvas.font = 'bold 16px monospace';
            ctxCanvas.fillStyle = 'rgba(255, 255, 255, 0.9)';
            const shortAddr = `${address.slice(0, 14)}...${address.slice(-14)}`;
            ctxCanvas.fillText(`Dir: ${shortAddr}`, 250, 565);

            const qrBuffer = mainCanvas.toBuffer('image/png');
            
            const caption = `⬇️ <b>Recibir GRAM (ex TON)</b> 💖\n\nCualquier billetera puede escanear este código QR y rellenará automáticamente tus datos.\n\n📍 <b>Tu Dirección (Toca para copiar):</b>\n<span class="tg-spoiler"><code>${address}</code></span>\n\n🏷 <b>Concepto / Etiqueta:</b> ${concept || 'Ninguno'}`;
            
            // Borramos el prompt viejo y mandamos el photo nuevo
            await ctx.telegram.deleteMessage(ctx.chat.id, ctx.scene.session.promptId).catch(()=>{});
            
            const buttons = [[Markup.button.callback('⬅️ Volver al Menú', 'cancel_scene')]];
            await ctx.replyWithPhoto(
                { source: qrBuffer },
                { parse_mode: 'HTML', caption, ...Markup.inlineKeyboard(buttons) }
            );
            
        } catch (e) {
            console.error(e);
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Hubo un error al generar el código QR.");
        }
        
        return ctx.scene.leave();
    }
);

module.exports = { receiveWizard };
