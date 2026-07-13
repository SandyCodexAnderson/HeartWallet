const { prisma } = require('../db/prisma');

async function authMiddleware(ctx, next) {
    if (!ctx.from) return next();
    
    try {
        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(ctx.from.id) }
        });
        
        if (user && user.isBanned) {
            if (ctx.callbackQuery) {
                return ctx.answerCbQuery("🚫 Estás baneado de HeartWallet. No puedes usar el servicio.", { show_alert: true });
            }
            return ctx.reply("🚫 Estás baneado de HeartWallet. No puedes usar el servicio.");
        }
        
        return next();
    } catch (error) {
        console.error("Auth Middleware Error:", error);
        return next();
    }
}

module.exports = { authMiddleware };
