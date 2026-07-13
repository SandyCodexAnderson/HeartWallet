const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { handleStart } = require('../handlers/start');

const createSubscriptionScene = new Scenes.WizardScene(
    'CREATE_SUBSCRIPTION_SCENE',
    async (ctx) => {
        if (ctx.callbackQuery) await ctx.deleteMessage().catch(() => {});
        
        ctx.scene.session.walletId = ctx.scene.state.walletId;
        
        const msg = await ctx.reply(
            `💎 *Crear Club VIP / Suscripción*\n\n¿Qué nombre tendrá tu suscripción?\n_(Ej: VIP Trading Signals, Apoyo Mensual, etc.)_`,
            { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]).reply_markup }
        );
        ctx.scene.session.promptId = msg.message_id;
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);
        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
        if (!text) return;

        ctx.scene.session.subName = text;

        await ctx.telegram.editMessageText(
            ctx.chat.id, ctx.scene.session.promptId, null,
            `💎 *Precio Mensual*\n\n¿Cuántos GRAM cobrarás al mes por **${text}**?\n_(Ej: 5, 10.5, 50)_`,
            { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]).reply_markup }
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);
        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
        if (!text) return;

        const price = parseFloat(text.replace(',', '.'));
        if (isNaN(price) || price <= 0) {
            return sendError(ctx, "❌ Precio inválido. Ingresa un número (Ej: 5):");
        }

        ctx.scene.session.priceNano = (price * 1e9).toString();

        const skipBtn = Markup.button.callback('⏭ Omitir (Sin Grupo)', 'skip_group');
        const cancelBtn = Markup.button.callback('❌ Cancelar', 'cancel_scene');

        await ctx.telegram.editMessageText(
            ctx.chat.id, ctx.scene.session.promptId, null,
            `🔗 *Vincular Grupo Privado (Opcional)*\n\nSi quieres que el bot expulse automáticamente a quienes no paguen su mes, necesitamos vincular el grupo VIP.\n\n1️⃣ Añade a este bot como **Administrador** en tu grupo.\n2️⃣ **Reenvía** cualquier mensaje de ese grupo a este chat.\n\nSi solo quieres recibir dinero recurrente sin grupo, presiona **Omitir**.`,
            { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[skipBtn], [cancelBtn]]).reply_markup }
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);
        if (ctx.callbackQuery?.data === 'skip_group') {
            await ctx.answerCbQuery();
            return finalizeSubscriptionPlan(ctx);
        }

        if (ctx.message && ctx.message.forward_origin) {
            const origin = ctx.message.forward_origin;
            await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});

            let chatId, chatTitle;
            if (origin.type === 'chat' && origin.chat) {
                chatId = origin.chat.id;
                chatTitle = origin.chat.title;
            } else if (origin.type === 'channel' && origin.chat) {
                chatId = origin.chat.id;
                chatTitle = origin.chat.title;
            } else {
                return sendError(ctx, "❌ No pude identificar el chat original. Asegúrate de reenviar un mensaje desde el grupo/canal directamente.");
            }

            // Verify bot is admin
            try {
                const memberInfo = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
                if (memberInfo.status !== 'administrator' && memberInfo.status !== 'creator') {
                    return sendError(ctx, `❌ El bot NO es administrador en "${chatTitle}". Hazlo administrador y reenvía otro mensaje.`);
                }
            } catch (err) {
                return sendError(ctx, `❌ No puedo acceder a "${chatTitle}". ¿Seguro que el bot está en el grupo y es administrador?`);
            }

            ctx.scene.session.chatId = chatId;
            ctx.scene.session.chatTitle = chatTitle;

            return finalizeSubscriptionPlan(ctx);
        } else if (ctx.message) {
            await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
            return sendError(ctx, "❌ Ese no parece ser un mensaje reenviado. Reenvía un mensaje del grupo o presiona Omitir.");
        }
    }
);

async function finalizeSubscriptionPlan(ctx) {
    try {
        const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
        
        const plan = await prisma.subscriptionPlan.create({
            data: {
                creatorId: user.id,
                name: ctx.scene.session.subName,
                priceNano: ctx.scene.session.priceNano,
                intervalDays: 30, // Default a mensual
                chatId: ctx.scene.session.chatId ? BigInt(ctx.scene.session.chatId) : null,
                chatName: ctx.scene.session.chatTitle || null
            }
        });

        const botUsername = ctx.botInfo.username;
        const subLink = `https://t.me/${botUsername}?start=subplan_${plan.id}`;

        let text = `✅ *¡Suscripción / Club VIP Creado!*\n\n` +
                   `**Nombre:** ${plan.name}\n` +
                   `**Precio:** ${(Number(plan.priceNano) / 1e9).toLocaleString()} GRAM / Mes\n`;
        
        if (plan.chatId) {
            text += `**Grupo Vinculado:** ${plan.chatName}\n`;
        }

        text += `\n🔗 *Tu enlace de venta (Compártelo):*\n\`${subLink}\`\n\n` +
                `Los usuarios que paguen a través de este enlace autorizarán el cobro mensual automático.`;

        const backBtn = Markup.button.callback('⬅️ Volver a Billetera', `view_wallet_${ctx.scene.session.walletId}`);

        await ctx.telegram.editMessageText(
            ctx.chat.id, ctx.scene.session.promptId, null,
            text,
            { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[backBtn]]).reply_markup }
        );
        return ctx.scene.leave();

    } catch (e) {
        console.error("Error finalizing subscription plan:", e);
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Hubo un error al guardar. Intenta de nuevo.");
        return ctx.scene.leave();
    }
}

async function cancelScene(ctx) {
    if (ctx.callbackQuery) await ctx.answerCbQuery();
    await ctx.scene.leave();
    return handleStart(ctx);
}

async function sendError(ctx, msg) {
    const skipBtn = Markup.button.callback('⏭ Omitir (Sin Grupo)', 'skip_group');
    const cancelBtn = Markup.button.callback('❌ Cancelar', 'cancel_scene');
    // We only show skip if we are on the step that expects it, but for safety just show cancel
    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, msg, { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[cancelBtn]]).reply_markup });
}

module.exports = { createSubscriptionScene };
