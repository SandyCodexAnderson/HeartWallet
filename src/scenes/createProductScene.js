const { Scenes, Markup } = require('telegraf');
const { prisma } = require('../db/prisma');
const { processTelegramImagePreview } = require('../utils/mediaProcessor');

const MAX_FILES = 10;

const createProductWizard = new Scenes.WizardScene(
    'CREATE_PRODUCT_SCENE',

    // ─── Paso 1: Recibir archivos (acumulador) ─────────────────────────────
    async (ctx) => {
        const walletId = ctx.scene.state?.walletId || ctx.scene.session?.walletId;
        if (!walletId) {
            await ctx.reply("❌ Ocurrió un error. No se encontró la billetera seleccionada.");
            return ctx.scene.leave();
        }

        ctx.scene.session.walletId = walletId;
        ctx.scene.session.files = []; // acumulador

        try { await ctx.deleteMessage(); } catch (e) {}

        const msg = await ctx.reply(
            `💼 *Vender Contenido Digital*\n\n` +
            `Envía los archivos que quieres vender (fotos, videos, documentos, audios).\n` +
            `Puedes enviar hasta *${MAX_FILES} archivos*. Cuando termines presiona ✅ *Listo*.\n\n` +
            `📁 Archivos recibidos: *0 / ${MAX_FILES}*`,
            {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Listo (Continuar)', 'product_files_done')],
                    [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
                ]).reply_markup
            }
        );
        ctx.scene.session.lastMsgId = msg.message_id;
        return ctx.wizard.next();
    },

    // ─── Paso 2: Acumular archivos o avanzar al título ────────────────────
    async (ctx) => {
        // Botón "Cancelar"
        if (ctx.callbackQuery?.data === 'cancel_scene') {
            await ctx.answerCbQuery();
            await ctx.deleteMessage().catch(() => {});
            return ctx.scene.leave();
        }

        // Botón "Listo" → avanzar
        if (ctx.callbackQuery?.data === 'product_files_done') {
            await ctx.answerCbQuery();
            const files = ctx.scene.session.files || [];
            if (files.length === 0) {
                return ctx.answerCbQuery("⚠️ Envía al menos un archivo antes de continuar.", { show_alert: true });
            }
            // Editar el mensaje para pedir el título
            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.lastMsgId, null,
                `✅ *${files.length} archivo(s) recibido(s).*\n\nAhora escribe el *Título o Descripción* de este paquete\n_(ej. "Pack de Wallpapers 4K" o "Tutorial Exclusivo")_`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
                    ]).reply_markup
                }
            );
            return ctx.wizard.next();
        }

        // Es un mensaje con archivo → acumular
        if (ctx.message) {
            let fileId = null, fileType = null, mimeType = null;

            if (ctx.message.photo) {
                // Álbum: Telegram puede enviar varias fotos, tomamos la de mayor resolución
                fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                fileType = 'photo';
                mimeType = 'image/jpeg';
            } else if (ctx.message.video) {
                fileId = ctx.message.video.file_id;
                fileType = 'video';
                mimeType = ctx.message.video.mime_type;
            } else if (ctx.message.document) {
                fileId = ctx.message.document.file_id;
                fileType = 'document';
                mimeType = ctx.message.document.mime_type;
            } else if (ctx.message.voice) {
                fileId = ctx.message.voice.file_id;
                fileType = 'voice';
                mimeType = ctx.message.voice.mime_type;
            } else if (ctx.message.audio) {
                fileId = ctx.message.audio.file_id;
                fileType = 'audio';
                mimeType = ctx.message.audio.mime_type;
            }

            // Borrar el mensaje del usuario para mantener el chat limpio
            try { await ctx.deleteMessage(ctx.message.message_id); } catch (e) {}

            if (!fileId) {
                // No es un archivo válido, ignorar
                return;
            }

            const files = ctx.scene.session.files || [];

            if (files.length >= MAX_FILES) {
                // Notificar brevemente sin spam (editamos el mensaje principal)
                return;
            }

            files.push({ fileId, fileType, mimeType });
            ctx.scene.session.files = files;

            // Actualizar el mensaje principal con el contador
            const count = files.length;
            const doneLabel = count > 0 ? `✅ Listo (${count} archivo${count !== 1 ? 's' : ''})` : '✅ Listo (Continuar)';
            const atMax = count >= MAX_FILES;

            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.lastMsgId, null,
                `💼 *Vender Contenido Digital*\n\n` +
                (atMax
                    ? `⚠️ Has alcanzado el límite de *${MAX_FILES} archivos*. Presiona ✅ Listo para continuar.`
                    : `Envía más archivos o presiona ✅ *Listo* cuando termines.\n\n📁 Archivos recibidos: *${count} / ${MAX_FILES}*`),
                {
                    parse_mode: 'Markdown',
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.callback(doneLabel, 'product_files_done')],
                        [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
                    ]).reply_markup
                }
            ).catch(() => {});
        }
    },

    // ─── Paso 3: Recibir título → pedir precio ────────────────────────────
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') {
            await ctx.answerCbQuery();
            return ctx.scene.leave();
        }
        if (ctx.message) try { await ctx.deleteMessage(); } catch (e) {}
        if (!ctx.message?.text) return; // esperar texto

        ctx.scene.session.title = ctx.message.text.trim();

        await ctx.telegram.editMessageText(
            ctx.chat.id, ctx.scene.session.lastMsgId, null,
            `✅ Título guardado: *${ctx.scene.session.title}*\n\n` +
            `¿Cuál será el *Precio en GRAM* para este paquete?\n` +
            `Escribe solo el número (ej: \`5\` o \`10.5\`).`,
            {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Cancelar', 'cancel_scene')]
                ]).reply_markup
            }
        );
        return ctx.wizard.next();
    },

    // ─── Paso 4: Recibir precio → guardar en DB ───────────────────────────
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_scene') {
            await ctx.answerCbQuery();
            return ctx.scene.leave();
        }
        if (ctx.message) try { await ctx.deleteMessage(); } catch (e) {}
        if (!ctx.message?.text) return;

        const priceTon = parseFloat(ctx.message.text.replace(',', '.'));
        if (isNaN(priceTon) || priceTon <= 0) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.lastMsgId, null,
                `❌ Precio inválido. Escribe solo un número positivo (ej: \`5\` o \`10.5\`):`,
                { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'cancel_scene')]]).reply_markup }
            );
            return;
        }

        const priceNano = (priceTon * 1e9).toString();
        const { files, title, walletId } = ctx.scene.session;
        const telegramId = BigInt(ctx.from.id);

        // Archivo principal = el primero subido
        const primaryFile = files[0];
        const extraFiles = files.slice(1); // el resto

        await ctx.telegram.editMessageText(
            ctx.chat.id, ctx.scene.session.lastMsgId, null,
            `⏳ Generando vista previa y guardando tu tienda...`,
            { parse_mode: 'Markdown' }
        );

        try {
            let blurredFileId = null;

            // Generar blur solo con el primer archivo si es imagen/video
            const isImage = primaryFile.fileType === 'photo' || (primaryFile.fileType === 'document' && primaryFile.mimeType?.startsWith('image/'));
            if (isImage) {
                const blurredBuffer = await processTelegramImagePreview(ctx, primaryFile.fileId, `${priceTon} GRAM`);
                if (blurredBuffer) {
                    const tempMsg = await ctx.replyWithPhoto({ source: blurredBuffer }, { disable_notification: true });
                    blurredFileId = tempMsg.photo[tempMsg.photo.length - 1].file_id;
                    try { await ctx.telegram.deleteMessage(ctx.chat.id, tempMsg.message_id); } catch (e) {}
                }
            }

            const user = await prisma.user.findUnique({ where: { telegramId } });

            // Guardar en DB: archivo principal + JSON con el resto
            const product = await prisma.digitalProduct.create({
                data: {
                    sellerId: user.id,
                    title: title,
                    priceNano: priceNano,
                    fileId: primaryFile.fileId,
                    blurredFileId: blurredFileId,
                    type: primaryFile.fileType,
                    mediaData: extraFiles.length > 0 ? JSON.stringify(extraFiles) : null,
                }
            });

            const deepLink = `https://t.me/${ctx.botInfo.username}?start=buy_${product.id}`;
            const totalFiles = files.length;

            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.lastMsgId, null,
                `🎉 *¡Tu paquete digital está listo!*\n\n` +
                `🏷️ *Título:* ${title}\n` +
                `📁 *Archivos:* ${totalFiles} archivo${totalFiles !== 1 ? 's' : ''}\n` +
                `💰 *Precio:* ${priceTon} GRAM\n\n` +
                `Comparte este enlace para que tus clientes puedan comprarlo:\n\`${deepLink}\``,
                {
                    parse_mode: 'Markdown',
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.switchToChat('📢 Compartir en un grupo', `share_${product.id}`)],
                        [Markup.button.callback('⬅️ Volver al menú', 'start_menu')]
                    ]).reply_markup
                }
            );

        } catch (error) {
            console.error("Error creating product:", error);
            await ctx.telegram.editMessageText(
                ctx.chat.id, ctx.scene.session.lastMsgId, null,
                "❌ Hubo un error al crear tu producto. Por favor intenta de nuevo."
            );
        }

        return ctx.scene.leave();
    }
);

module.exports = { createProductWizard };
