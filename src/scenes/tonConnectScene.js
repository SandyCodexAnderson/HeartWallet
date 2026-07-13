const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { decryptPrivateKey } = require('../services/cryptoService');
const { connectToBridge } = require('../utils/tonConnectUtils');

const tonConnectWizard = new Scenes.WizardScene(
    'TON_CONNECT_SCENE',
    async (ctx) => {
        if (ctx.callbackQuery) {
            await ctx.deleteMessage().catch(() => {});
        }
        const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
        const msg = await ctx.reply("🔗 **Conectar Wallet a una Web / DApp**\n\n¿A qué servicio o página web te estás conectando?\n_(Ejemplo: Fragment, GetGems, STON.fi, Dedust, etc.)_\n\nEscribe el nombre del servicio:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        ctx.scene.session.promptId = msg.message_id;
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') {
            await ctx.answerCbQuery();
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});

        if (text === '/cancelar') {
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }
        
        if (!text || text.length > 30) {
            const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Nombre inválido. Por favor escribe un nombre corto para el servicio:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return;
        }

        ctx.scene.session.dappName = text;
        const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `🔗 **Conectar a ${text}**\n\nPor favor, ve a la página de ${text}, selecciona la opción de conectar wallet (Tonkeeper / TON Connect), y pega aquí el enlace URI (\`tc://...\`) que obtienes al presionar el botón 'Copy Link' en el código QR.`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') {
            await ctx.answerCbQuery();
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});

        if (text === '/cancelar') {
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        if (!text || !text.startsWith('tc://')) {
            const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Enlace inválido. Debe empezar con `tc://`. Inténtalo de nuevo pegando el enlace correcto:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            return;
        }

        ctx.scene.session.tcUri = text;

        try {
            const user = await prisma.user.findUnique({
                where: { telegramId: BigInt(ctx.from.id) },
                include: { wallets: true }
            });

            if (!user || user.wallets.length === 0) {
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ No tienes billeteras creadas.");
                return ctx.scene.leave();
            }

            const buttons = user.wallets.map(w => [Markup.button.callback(`Conectar con: ${w.name}`, `tc_connect_${w.id}`)]);
            buttons.push([Markup.button.callback('❌ Cancelar', 'cancel_scene')]);

            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, `🔗 **${ctx.scene.session.dappName}** solicita una conexión. Selecciona qué billetera de HeartWallet deseas usar:`, Markup.inlineKeyboard(buttons));
            return ctx.wizard.next();
        } catch (error) {
            console.error(error);
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Ocurrió un error leyendo tus billeteras.");
            return ctx.scene.leave();
        }
    },
    async (ctx) => {
        if (!ctx.callbackQuery) {
            if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
            return;
        }
        
        const action = ctx.callbackQuery.data;

        if (ctx.callbackQuery?.data === 'cancel_scene') {
            await ctx.answerCbQuery();
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});

        if (text === '/cancelar') {
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        if (action.startsWith('tc_connect_')) {
            await ctx.answerCbQuery("Conectando...");
            const dappName = ctx.scene.session.dappName;
            await ctx.editMessageText(`⏳ Estableciendo conexión criptográfica segura con ${dappName}...`);

            try {
                const uri = ctx.scene.session.tcUri;
                
                // GetGems (y otras dApps) generan tc://?param=... (sin host)
                // Extraemos todo lo que viene despues de "?" independientemente del formato
                const queryStart = uri.indexOf('?');
                if (queryStart === -1) throw new Error("Enlace tc:// inválido: no contiene parámetros.");
                const urlParams = new URLSearchParams(uri.slice(queryStart + 1));
                
                const clientId = urlParams.get('id');
                // 'r' viene URL-encoded por URLSearchParams.get() ya lo decodifica
                const requestPayload = urlParams.get('r');
                
                if (!clientId) throw new Error("Enlace tc:// inválido: falta el parámetro 'id'.");
                
                const walletId = parseInt(action.replace('tc_connect_', ''));
                const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
                
                if (!wallet) throw new Error("Wallet not found");
                
                const privateKeyHex = decryptPrivateKey(wallet.encryptedPrivateKey);
                
                // Efectuar la conexión real enviando el payload HTTP
                // Efectuar la conexión real enviando el payload HTTP y obtener la sesión
                const session = await connectToBridge(clientId, requestPayload, privateKeyHex);
                
                // Marcar en la BD que está conectada y guardar el keypair completo de la sesión
                const updatedWallet = await prisma.wallet.update({
                    where: { id: walletId },
                    data: {
                        connectedDapp: dappName,
                        tcSessionKey: JSON.stringify(session.keypair),
                        tcClientId: clientId
                    },
                    include: { user: true }
                });
                
                // Activar el listener SSE para esta billetera
                const { startListeningForWallet } = require('../services/tonConnectListener');
                startListeningForWallet(updatedWallet, global.heartWalletBot);
                
                const buttons = [[Markup.button.callback('⬅️ Volver al Menú', 'cancel_scene')]];
                await ctx.editMessageText(`✅ **¡Conectado exitosamente con ${dappName}!**\n\n🔔 HeartWallet ya está escuchando en segundo plano. Si ${dappName} te solicita aprobar un pago, recibirás una notificación aquí mismo en el bot.\n\n_Por razones de seguridad, cada pago requiere tu confirmación y PIN antes de ser enviado._`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });

            } catch (e) {
                console.error("Error en TON Connect:", e);
                const buttons = [[Markup.button.callback('⬅️ Volver al Menú', 'cancel_scene')]];
                await ctx.editMessageText(`❌ Hubo un error técnico al intentar validar la conexión criptográfica con el servicio.\n\nSi el servicio es GetGems u otro muy complejo, es posible que el payload sea distinto al soportado actualmente.`, { ...Markup.inlineKeyboard(buttons) });
            }
            return ctx.scene.leave();
        }
    }
);

module.exports = { tonConnectWizard };
