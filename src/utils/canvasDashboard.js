const { createCanvas, loadImage } = require('canvas');
const path = require('path');

function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    return ctx;
}

function getThemeGradient(theme) {
    const themes = {
        pink: ['#ff758c', '#ff7eb3', '#c471ed'],
        red: ['#ff4b1f', '#ff9068', '#ff4b1f'],
        orange: ['#f12711', '#f5af19', '#f12711'],
        yellow: ['#F2C94C', '#F2994A', '#F2C94C'],
        green: ['#11998e', '#38ef7d', '#11998e'],
        teal: ['#00B4DB', '#0083B0', '#00B4DB'],
        blue: ['#2193b0', '#6dd5ed', '#2193b0'],
        indigo: ['#4776E6', '#8E54E9', '#4776E6'],
        violet: ['#8E2DE2', '#4A00E0', '#8E2DE2'],
        dark: ['#141E30', '#243B55', '#141E30'],
        gold: ['#BF953F', '#FCF6BA', '#B38728'],
        diamond: ['#00d2ff', '#3a7bd5', '#00d2ff']
    };
    return themes[theme] || themes['pink'];
}

async function generateDashboardImage(user, wallets) {
    const width = 800;
    const height = 440;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const primaryWallet = wallets.find(w => w.isPrimary) || wallets[0];
    const themeName = primaryWallet ? primaryWallet.theme : 'pink';
    const themeColors = getThemeGradient(themeName);

    // === FONDO GRADIENTE (mismo estilo que tarjeta de wallet) ===
    if (themeName === 'gold') {
        const bgGrad = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, width);
        bgGrad.addColorStop(0, '#FFF5C3'); 
        bgGrad.addColorStop(0.4, '#D4AF37'); 
        bgGrad.addColorStop(1, '#8A5A19');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.beginPath();
        ctx.moveTo(0, height);
        ctx.lineTo(width, -100);
        ctx.lineTo(width, 100);
        ctx.lineTo(0, height + 200);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fill();
        ctx.restore();
    } else if (themeName === 'diamond') {
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, '#00F2FE');
        bgGrad.addColorStop(0.5, '#4FACFE');
        bgGrad.addColorStop(1, '#001D4A');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.beginPath();
        ctx.moveTo(width * 0.2, -50);
        ctx.lineTo(width * 0.8, -50);
        ctx.lineTo(width + 50, height * 0.5);
        ctx.lineTo(width * 0.5, height + 50);
        ctx.lineTo(-50, height * 0.5);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(width * 0.5, height + 50);
        ctx.lineTo(width * 0.2, -50);
        ctx.lineTo(width * 0.8, -50);
        ctx.stroke();
        ctx.restore();
    } else {
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, themeColors[0]);
        bgGrad.addColorStop(0.5, themeColors[1]);
        bgGrad.addColorStop(1, themeColors[2]);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);
    }

    // Círculos decorativos de fondo
    if (themeName !== 'gold' && themeName !== 'diamond') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.arc(780, -20, 280, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(-30, 440, 200, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(400, 460, 150, 0, Math.PI * 2);
    ctx.fill();

    // === TARJETA CENTRAL GLASSMORPHISM ===
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    roundRect(ctx, 40, 30, 720, 380, 28);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    roundRect(ctx, 40, 30, 720, 380, 28);
    ctx.stroke();

    // === LOGO ===
    const logoPath = path.join(__dirname, '../assets/ChatGPT Image 1 jul 2026, 07_34_38 p.m..png');
    try {
        const logo = await loadImage(logoPath);
        // Dibujamos el logo en círculo recortado
        const logoSize = 90;
        const logoX = 400 - logoSize / 2;
        const logoY = 40;
        ctx.save();
        ctx.beginPath();
        ctx.arc(400, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
        ctx.restore();
    } catch (e) {
        // Fallback si no hay logo
        ctx.font = 'bold 60px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('HW', 400, 100);
    }

    // === NOMBRE DE USUARIO ===
    const displayName = user.username ? `@${user.username}` : (user.firstName || 'Usuario');
    ctx.textAlign = 'center';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 6;
    ctx.fillText(displayName, 400, 165);
    ctx.shadowBlur = 0;

    // Subtítulo "HeartWallet"
    ctx.font = '18px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('Tu dinero, tu libertad', 400, 192);

    // === SEPARADOR ===
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(120, 210);
    ctx.lineTo(680, 210);
    ctx.stroke();

    // === CONTADOR DE WALLETS ===
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`${wallets.length} / ${user.maxWallets} billeteras permitidas`, 400, 235);

    // === WALLETS LISTA ===
    const maxAllowedBottom = 410; // Límite inferior de la tarjeta
    let walletStartY = 255;
    let availableHeight = maxAllowedBottom - walletStartY - 10;
    
    let walletSpacing = 40;
    
    if (wallets.length === 0) {
        ctx.font = '20px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.textAlign = 'center';
        ctx.fillText('Aún no tienes billeteras creadas', 400, walletStartY + 20);
    } else {
        // Cálculo dinámico para escalar si hay más de 4
        if (wallets.length > 4) {
            walletSpacing = Math.min(40, availableHeight / wallets.length);
        }
        
        let rowHeight = Math.max(14, walletSpacing - 4);
        let fontSize = Math.max(10, Math.floor(rowHeight * 0.5));
        
        for (let i = 0; i < wallets.length; i++) {
            const w = wallets[i];
            const y = walletStartY + i * walletSpacing;
            
            // Verificamos no desbordar
            if (y + rowHeight > maxAllowedBottom) break;
            
            // Fondo de la fila
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            roundRect(ctx, 80, y, 640, rowHeight, Math.min(10, rowHeight/2));
            ctx.fill();

            ctx.textAlign = 'center';
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.fillStyle = '#ffffff';

            // Canvas no puede renderizar emojis bien, los eliminamos para una visualización limpia
            const stripEmojis = (str) => str.replace(/[\u{1F000}-\u{1FFFF}\u{2000}-\u{3300}\u{FE00}-\u{FEFF}]/gu, '').trim();
            const safeWalletName = stripEmojis(w.name) || w.name;

            // El text baseline default es 'alphabetic', sumamos algo para centrar
            const centerY = y + (rowHeight / 2) + (fontSize * 0.35);
            ctx.fillText(`${safeWalletName}`, 400, centerY);
        }
    }


    return canvas.toBuffer('image/png');
}

module.exports = { generateDashboardImage };
