const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { hashData, decryptPrivateKey } = require('../services/cryptoService');
const { sendTon, generateWallet } = require('../services/tonService');
const { toNano } = require('@ton/ton');

const coldWalletWizard = new Scenes.WizardScene(
    'COLD_WALLET_SCENE',
    async (ctx) => {
        ctx.scene.session.walletId = ctx.scene.state.walletId;
        if (ctx.callbackQuery) {
            await ctx.deleteMessage().catch(() => {});
        }

        const buttons = [
            [Markup.button.callback('⚠️ Sí, entiendo los riesgos y deseo continuar', 'cw_step2')],
            [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
        ];

        const msg = await ctx.reply("❄️ **Convertir a Cartera Fría (Cold Wallet)**\n\nAl convertir esta billetera en una cartera fría, **HeartWallet te entregará las 24 palabras secretas (Semilla)** y eliminará cualquier acceso que el bot tenga a tus fondos.\n\n🚨 **ADVERTENCIA:**\n- Si pierdes estas 24 palabras, **perderás todo tu dinero**.\n- Nadie en HeartWallet podrá recuperar tus fondos si te roban o pierdes la semilla.\n- La billetera será eliminada de tu cuenta de HeartWallet.\n\n¿Estás completamente seguro de asumir esta responsabilidad?", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        
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

        if (ctx.callbackQuery?.data === 'cw_step2') {
            await ctx.answerCbQuery();
            
            const user = await prisma.user.findUnique({
                where: { telegramId: BigInt(ctx.from.id) }
            });
            
            if (user && user.recoveryPinHash) {
                ctx.scene.session.expectedPinHash = user.recoveryPinHash;
                const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
                await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "🔐 **Paso 2: Verificación de Identidad**\n\nPor favor, ingresa tu **PIN de 4 dígitos** para confirmar que eres el dueño legítimo de esta cuenta:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
                return ctx.wizard.next();
            } else {
                // Sin PIN configurado
                return await finalizeColdWallet(ctx);
            }
        }
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
        return await finalizeColdWallet(ctx);
    }
);

async function finalizeColdWallet(ctx) {
    try {
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "⏳ Preparando tu Cartera Fría... No cierres este chat.", { parse_mode: 'Markdown' });
        
        const walletId = ctx.scene.session.walletId;
        const wallet = await prisma.wallet.findUnique({
            where: { id: walletId },
            include: { user: true }
        });

        if (!wallet || wallet.user.telegramId !== BigInt(ctx.from.id)) {
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Billetera no encontrada.");
            return ctx.scene.leave();
        }

        let words = "";

        if (wallet.encryptedMnemonics) {
            // Nueva billetera, tiene las palabras
            words = decryptPrivateKey(wallet.encryptedMnemonics);
            
            // Borrar de la BD
            await prisma.wallet.delete({ where: { id: walletId } });
        } else {
            // Billetera antigua, no tenemos palabras.
            // Hay que crear una nueva, obtener palabras, y decirle al usuario que la use, 
            // pero también transferir el saldo si tiene (o decirle al usuario que envíe el saldo manualmente).
            // Lo mejor y más seguro: decirle que la antigua no se puede convertir directo, y generar una vacía para que él transfiera manualmente.
            // O transferir automáticamente si obtenemos su balance. Dado que balance requiere API y puede tardar/fallar por fees, mejor generarle la nueva y borrar esta.
            
            // Generar nueva billetera
            const newWalletData = await generateWallet();
            words = newWalletData.mnemonics.join(' ');
            
            // Borramos la vieja de la BD
            await prisma.wallet.delete({ where: { id: walletId } });
            
            // Nota: Para transferir los fondos automáticamente se necesitaría saber el balance y dejar un % para el fee. 
            // Como esto es peligroso (puede fallar la transacción en blockchain y la wallet ya fue borrada),
            // lo haremos simple por ahora. Le entregamos la llave privada de la antigua o las palabras de una nueva?
            // Si le entregamos la llave privada en hex, la mayoría de wallets como Tonkeeper permiten importar por Private Key.
            // Esto es mucho más seguro para billeteras antiguas:
            
            const pkHex = decryptPrivateKey(wallet.encryptedPrivateKey);
            words = `(Llave Privada Hexadecimal):\n\`${pkHex}\`\n\n*Nota:* Esta es una billetera antigua de HeartWallet que no guardó semillas. Puedes importar esta Llave Privada directamente en Tonkeeper.`;
        }

        const buttons = [[Markup.button.callback('⬅️ Entendido, volver al Menú', 'start_menu')]];
        
        const successMsg = `✅ **¡Tu billetera ahora es una Cartera Fría!**\n\nHeartWallet ha eliminado cualquier rastro de acceso a tu billetera de sus servidores.\n\nAquí tienes tu acceso secreto. **CÓPIALO AHORA MISMO Y GUÁRDALO EN UN PAPEL**:\n\n\`\`\`\n${words}\n\`\`\`\n\n🚨 *Si cierras este mensaje sin copiar la información, perderás el acceso para siempre.*`;
        
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, successMsg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });

    } catch (e) {
        console.error("Error en cold wallet:", e);
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Ocurrió un error inesperado (o de conexión) al convertir la billetera.").catch(() => {});
    }
    return ctx.scene.leave();
}

module.exports = { coldWalletWizard };
