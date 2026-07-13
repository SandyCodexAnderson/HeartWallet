/**
 * supportScene.js
 * Escena de Soporte Técnico de HeartWallet
 * Permite al usuario enviar texto, imágenes y videos a @sandy_anderson
 */

const { Scenes, Markup } = require('telegraf');
const { logSuccess, logInfo } = require('../utils/logger');

// ID de Telegram de la admin (sandy_anderson) — se puede poner en .env si se desea
const ADMIN_USERNAME = '@sandy_anderson';

const supportWizard = new Scenes.WizardScene(
    'SUPPORT_SCENE',

    // Paso 0: Seleccionar tipo de reporte
    async (ctx) => {
        if (ctx.callbackQuery) await ctx.answerCbQuery();

        ctx.scene.session.mediaItems = [];
        ctx.scene.session.awaitingMedia = false;

        const text =
            `🎧 *Soporte Técnico — HeartWallet*\n\n` +
            `Estamos aquí para ayudarte. Selecciona el tipo de reporte:`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🐛 Reportar un Error/Falla', 'sup_type_bug')],
            [Markup.button.callback('💡 Enviar Sugerencia', 'sup_type_suggestion')],
            [Markup.button.callback('❓ Tengo una Pregunta', 'sup_type_question')],
            [Markup.button.callback('⬅️ Volver al Menú', 'cancel_support')],
        ]);

        try {
            await ctx.editMessageCaption(text, { parse_mode: 'Markdown', ...keyboard });
        } catch(e) {
            try {
                await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
            } catch(e2) {
                await ctx.deleteMessage().catch(() => {});
                const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
                ctx.scene.session.promptId = msg.message_id;
            }
        }

        return ctx.wizard.next();
    },

    // Paso 1: Recibir tipo y pedir descripción
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        if (action === 'cancel_support') {
            await ctx.scene.leave();
            const { handleStart } = require('../handlers/start');
            return handleStart(ctx);
        }

        const types = {
            'sup_type_bug': { emoji: '🐛', label: 'Error/Falla' },
            'sup_type_suggestion': { emoji: '💡', label: 'Sugerencia' },
            'sup_type_question': { emoji: '❓', label: 'Pregunta' },
        };

        const chosen = types[action];
        if (!chosen) return;

        ctx.scene.session.reportType = chosen.label;
        ctx.scene.session.reportEmoji = chosen.emoji;

        const text =
            `${chosen.emoji} *${chosen.label}*\n\n` +
            `Escribe tu mensaje con todos los detalles que consideres importantes.\n\n` +
            `_Puedes incluir todo en un solo mensaje o enviar varios. Cuando termines, presiona_ *✅ Enviar Reporte*.\n\n` +
            `📎 También puedes adjuntar *fotos* o *videos* enviándolos directamente aquí.`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('✅ Enviar Reporte', 'sup_send')],
            [Markup.button.callback('⬅️ Cambiar tipo', 'sup_back')],
            [Markup.button.callback('❌ Cancelar', 'cancel_support')],
        ]);

        try {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        } catch(e) {
            const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
            ctx.scene.session.promptId = msg.message_id;
        }

        ctx.scene.session.messages = [];
        ctx.scene.session.awaitingContent = true;

        return ctx.wizard.next();
    },

    // Paso 2: Acumular mensajes/media y enviar
    async (ctx) => {
        // ── Botones ──────────────────────────────────────────────────
        if (ctx.callbackQuery) {
            const action = ctx.callbackQuery.data;
            await ctx.answerCbQuery();

            if (action === 'cancel_support') {
                await ctx.scene.leave();
                const { handleStart } = require('../handlers/start');
                return handleStart(ctx);
            }

            if (action === 'sup_back') {
                ctx.scene.session.messages = [];
                ctx.scene.session.mediaItems = [];
                return ctx.wizard.selectStep(0);
            }

            if (action === 'sup_send') {
                if (!ctx.scene.session.messages?.length && !ctx.scene.session.mediaItems?.length) {
                    await ctx.answerCbQuery('⚠️ Escribe al menos un mensaje antes de enviar.', { show_alert: true });
                    return;
                }
                return sendReport(ctx);
            }
            return;
        }

        // ── Texto ─────────────────────────────────────────────────────
        if (ctx.message?.text) {
            ctx.scene.session.messages = ctx.scene.session.messages || [];
            ctx.scene.session.messages.push(ctx.message.text);
            await ctx.deleteMessage(ctx.message.message_id).catch(() => {});

            const count = ctx.scene.session.messages.length + (ctx.scene.session.mediaItems?.length || 0);
            const confirmText =
                `${ctx.scene.session.reportEmoji} *${ctx.scene.session.reportType}*\n\n` +
                `✍️ Mensaje recibido. Puedes seguir escribiendo, adjuntar fotos/videos, o presionar *✅ Enviar Reporte*.\n\n` +
                `📦 _Elementos recibidos: ${count}_`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('✅ Enviar Reporte', 'sup_send')],
                [Markup.button.callback('❌ Cancelar', 'cancel_support')],
            ]);

            const pid = ctx.scene.session.promptId;
            if (pid) {
                await ctx.telegram.editMessageText(ctx.chat.id, pid, null, confirmText, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
            }
            return;
        }

        // ── Foto ──────────────────────────────────────────────────────
        if (ctx.message?.photo) {
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            ctx.scene.session.mediaItems = ctx.scene.session.mediaItems || [];
            ctx.scene.session.mediaItems.push({ type: 'photo', fileId: photo.file_id, caption: ctx.message.caption || '' });
            await ctx.deleteMessage(ctx.message.message_id).catch(() => {});

            const count = (ctx.scene.session.messages?.length || 0) + ctx.scene.session.mediaItems.length;
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('✅ Enviar Reporte', 'sup_send')],
                [Markup.button.callback('❌ Cancelar', 'cancel_support')],
            ]);
            const pid = ctx.scene.session.promptId;
            if (pid) {
                await ctx.telegram.editMessageText(ctx.chat.id, pid, null,
                    `${ctx.scene.session.reportEmoji} *${ctx.scene.session.reportType}*\n\n📸 Foto recibida.\n\n📦 _Elementos: ${count}_`,
                    { parse_mode: 'Markdown', ...keyboard }
                ).catch(() => {});
            }
            return;
        }

        // ── Video ─────────────────────────────────────────────────────
        if (ctx.message?.video) {
            ctx.scene.session.mediaItems = ctx.scene.session.mediaItems || [];
            ctx.scene.session.mediaItems.push({ type: 'video', fileId: ctx.message.video.file_id, caption: ctx.message.caption || '' });
            await ctx.deleteMessage(ctx.message.message_id).catch(() => {});

            const count = (ctx.scene.session.messages?.length || 0) + ctx.scene.session.mediaItems.length;
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('✅ Enviar Reporte', 'sup_send')],
                [Markup.button.callback('❌ Cancelar', 'cancel_support')],
            ]);
            const pid = ctx.scene.session.promptId;
            if (pid) {
                await ctx.telegram.editMessageText(ctx.chat.id, pid, null,
                    `${ctx.scene.session.reportEmoji} *${ctx.scene.session.reportType}*\n\n🎥 Video recibido.\n\n📦 _Elementos: ${count}_`,
                    { parse_mode: 'Markdown', ...keyboard }
                ).catch(() => {});
            }
            return;
        }

        // ── Documento/archivo ─────────────────────────────────────────
        if (ctx.message?.document) {
            ctx.scene.session.mediaItems = ctx.scene.session.mediaItems || [];
            ctx.scene.session.mediaItems.push({ type: 'document', fileId: ctx.message.document.file_id, caption: ctx.message.caption || '' });
            await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
            const pid = ctx.scene.session.promptId;
            const count = (ctx.scene.session.messages?.length || 0) + ctx.scene.session.mediaItems.length;
            const keyboard = Markup.inlineKeyboard([[Markup.button.callback('✅ Enviar Reporte', 'sup_send')],[Markup.button.callback('❌ Cancelar', 'cancel_support')]]);
            if (pid) await ctx.telegram.editMessageText(ctx.chat.id, pid, null, `${ctx.scene.session.reportEmoji} *${ctx.scene.session.reportType}*\n\n📎 Archivo recibido.\n\n📦 _Elementos: ${count}_`, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
            return;
        }
    }
);

async function sendReport(ctx) {
    const { reportType, reportEmoji, messages, mediaItems } = ctx.scene.session;
    const user = ctx.from;
    const username = user.username ? `@${user.username}` : user.first_name;
    const userId = user.id;

    const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' });

    // Construir el texto del reporte para la admin
    const adminText =
        `📨 *NUEVO REPORTE — HeartWallet*\n\n` +
        `${reportEmoji} *Tipo:* ${reportType}\n` +
        `👤 *De:* ${username} (\`${userId}\`)\n` +
        `🕐 *Fecha:* ${now}\n\n` +
        `─────────────────────\n` +
        (messages?.length
            ? `💬 *Mensajes:*\n${messages.map((m, i) => `${i + 1}. ${m}`).join('\n\n')}`
            : `_(Sin texto adjunto)_`);

    const bot = global.heartWalletBot;

    try {
        // Buscar el chat ID de la admin por username
        // Usamos el chat ID directamente — sandy_anderson debe haber iniciado el bot
        const { prisma } = require('../db/prisma');
        const adminUser = await prisma.user.findFirst({ where: { username: 'sandy_anderson' } });

        if (adminUser) {
            // Enviar texto del reporte
            await bot.telegram.sendMessage(
                Number(adminUser.telegramId),
                adminText,
                { parse_mode: 'Markdown' }
            );

            // Enviar cada media adjunta
            for (const media of (mediaItems || [])) {
                try {
                    if (media.type === 'photo') {
                        await bot.telegram.sendPhoto(Number(adminUser.telegramId), media.fileId, {
                            caption: media.caption ? `📸 ${media.caption} (de ${username})` : `📸 Foto de ${username}`
                        });
                    } else if (media.type === 'video') {
                        await bot.telegram.sendVideo(Number(adminUser.telegramId), media.fileId, {
                            caption: media.caption ? `🎥 ${media.caption} (de ${username})` : `🎥 Video de ${username}`
                        });
                    } else if (media.type === 'document') {
                        await bot.telegram.sendDocument(Number(adminUser.telegramId), media.fileId, {
                            caption: `📎 Archivo de ${username}`
                        });
                    }
                } catch(mediaErr) { /* Si una media falla, continuar con el resto */ }
            }

            logSuccess('SUPPORT_REPORT_SENT', {
                user: username,
                userId: String(userId),
                type: reportType,
                messages: messages?.length || 0,
                media: mediaItems?.length || 0,
            });
        }

    } catch(err) {
        logSuccess('SUPPORT_REPORT_STORED', { user: username, type: reportType, note: 'Admin no en BD, reporte registrado en logs' });
    }

    // Agradecimiento al usuario
    const thankText =
        `✅ *¡Reporte enviado con éxito!*\n\n` +
        `Gracias por tomarte el tiempo de informar. Tu ${reportType.toLowerCase()} ha sido enviada al equipo de HeartWallet.\n\n` +
        `📬 Nos pondremos en contacto contigo *lo más pronto posible* a través de este mismo chat.\n\n` +
        `💖 _¡Gracias por ayudarnos a mejorar HeartWallet!_`;

    const pid = ctx.scene.session.promptId;
    const returnKb = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Menú', 'cancel_support')]]);

    try {
        if (pid) {
            await ctx.telegram.editMessageText(ctx.chat.id, pid, null, thankText, { parse_mode: 'Markdown', ...returnKb });
        } else {
            await ctx.editMessageText(thankText, { parse_mode: 'Markdown', ...returnKb }).catch(() =>
                ctx.reply(thankText, { parse_mode: 'Markdown', ...returnKb })
            );
        }
    } catch(e) {
        await ctx.reply(thankText, { parse_mode: 'Markdown', ...returnKb });
    }

    return ctx.scene.leave();
}

module.exports = { supportWizard };
