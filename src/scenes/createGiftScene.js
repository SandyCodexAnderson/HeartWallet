const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { v4: uuidv4 } = require('uuid');
const { handleStart } = require('../handlers/start');

const createGiftScene = new Scenes.WizardScene(
    'createGiftScene',
    async (ctx) => {
        if (ctx.callbackQuery) {
            await ctx.deleteMessage().catch(() => {});
        }
        const msg = await ctx.reply(
            `🎁 **Crear Smart Gift**\n\n¿Cuántos GRAM quieres regalar? (ej. 5):`,
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

        const amountStr = text.replace(',', '.');
        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) return sendError(ctx, "❌ Cantidad inválida. Intenta de nuevo:");

        ctx.scene.session.amountNano = (amount * 1e9).toString();

        const buttons = [
            [Markup.button.callback('⚡ Directo (Sin condición)', 'cond_none')],
            [Markup.button.callback('⏳ Cápsula del Tiempo', 'cond_time')],
            [Markup.button.callback('🔐 Acertijo / Contraseña', 'cond_pass')],
            [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
        ];

        await ctx.telegram.editMessageText(
            ctx.chat.id, ctx.scene.session.promptId, null,
            `🎁 Regalo de **${amount} GRAM**.\n\nSelecciona el tipo de condición:`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const data = ctx.callbackQuery.data;
        if (data === 'cancel_scene') return cancelScene(ctx);

        ctx.scene.session.conditionType = data.replace('cond_', '').toUpperCase();

        if (ctx.scene.session.conditionType === 'NONE') {
            return finalizeGiftCreation(ctx);
        } else if (ctx.scene.session.conditionType === 'TIME') {
            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.promptId, null,
                `⏳ **Cápsula del Tiempo**\n\n¿En cuántas **horas** a partir de ahora se podrá abrir este regalo? (ej. 24):`,
                { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]).reply_markup }
            );
            return ctx.wizard.next();
        } else if (ctx.scene.session.conditionType === 'PASS') {
            ctx.scene.session.conditionType = 'PASSWORD';
            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.promptId, null,
                `🔐 **Acertijo / Contraseña**\n\nEscribe la **pregunta o pista** que verá la persona que intente abrirlo (ej. "¿Cuál es mi color favorito?"):`,
                { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]).reply_markup }
            );
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);
        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
        if (!text) return;

        if (ctx.scene.session.conditionType === 'TIME') {
            const hours = parseFloat(text);
            if (isNaN(hours) || hours <= 0) return sendError(ctx, "❌ Horas inválidas. Intenta de nuevo (ej. 24):");
            
            const unlockDate = new Date();
            unlockDate.setHours(unlockDate.getHours() + hours);
            ctx.scene.session.unlockTime = unlockDate;
            
            return finalizeGiftCreation(ctx);
        } else if (ctx.scene.session.conditionType === 'PASSWORD') {
            ctx.scene.session.question = text;
            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.promptId, null,
                `🔐 Tu pista es: _"${text}"_\n\nAhora, escribe la **Respuesta / Contraseña correcta** para desbloquearlo:`,
                { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]).reply_markup }
            );
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') return cancelScene(ctx);
        const text = ctx.message?.text?.trim();
        if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(()=>{});
        if (!text) return;

        ctx.scene.session.password = text.toLowerCase();
        return finalizeGiftCreation(ctx);
    }
);

async function finalizeGiftCreation(ctx) {
    try {
        const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
        const giftId = uuidv4();
        
        await prisma.giftCheck.create({
            data: {
                id: giftId,
                senderId: user.id,
                amountNano: ctx.scene.session.amountNano,
                status: 'PENDING',
                conditionType: ctx.scene.session.conditionType,
                unlockTime: ctx.scene.session.unlockTime || null,
                password: ctx.scene.session.password || null,
                question: ctx.scene.session.question || null
            }
        });

        const shareBtn = Markup.button.switchToChat('👉 Compartir Regalo en Grupo', `gift_${giftId}`);
        const backBtn = Markup.button.callback('⬅️ Menú Principal', 'cancel_scene');

        await ctx.telegram.editMessageText(
            ctx.chat.id, ctx.scene.session.promptId, null,
            `✅ **¡Smart Gift Creado!**\n\nTu regalo ha sido generado y está listo para ser enviado.\n\n_Nota: Los fondos se deducirán de tu billetera principal únicamente cuando alguien logre reclamarlo._`,
            { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[shareBtn], [backBtn]]).reply_markup }
        );
        return ctx.scene.leave();
    } catch (e) {
        console.error(e);
        await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, "❌ Error al generar el regalo.");
        return ctx.scene.leave();
    }
}

async function cancelScene(ctx) {
    if (ctx.callbackQuery) await ctx.answerCbQuery();
    await ctx.scene.leave();
    return handleStart(ctx);
}

async function sendError(ctx, msg) {
    const buttons = [[Markup.button.callback('❌ Cancelar', 'cancel_scene')]];
    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.promptId, null, msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

// ─── Escape Hatches ────────────────────────────────────────────────────────
createGiftScene.command('start', async (ctx) => {
    if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
});
createGiftScene.command('cancelar', async (ctx) => {
    if (ctx.message) await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    await ctx.scene.leave();
    const { handleStart } = require('../handlers/start');
    return handleStart(ctx);
});
// ───────────────────────────────────────────────────────────────────────────

module.exports = { createGiftScene };
