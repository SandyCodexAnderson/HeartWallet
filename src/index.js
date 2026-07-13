const { launchBot } = require('./bot');
const { logError, logInfo } = require('./utils/logger');

// Handler global: Uncaught exceptions
process.on('uncaughtException', (err) => {
    logError('UNCAUGHT_EXCEPTION', err, {});
    console.error(`[AntiCrash] uncaughtException: ${err.message}`);
    // No matar el proceso, el bot sigue
});

// Handler global: Unhandled promise rejections
process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logError('UNHANDLED_REJECTION', err, {});
    console.error(`[AntiCrash] unhandledRejection:`, err.message);
});

async function bootstrap() {
    try {
        console.log("Iniciando HeartWallet...");
        // launchBot() ya NO bloquea — lanza el bot y los servicios en paralelo
        await launchBot();
        // El proceso sigue vivo gracias al polling de Telegraf y los setInterval
    } catch (error) {
        logError('BOT_BOOTSTRAP_FAIL', error, {});
        console.error(`[AntiCrash] Error al iniciar: ${error.message}`);
        console.log('[AntiCrash] Reintentando en 10 segundos...');
        setTimeout(bootstrap, 10000);
    }
}

bootstrap();
