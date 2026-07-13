const { createCanvas } = require('canvas');
const { fromNano } = require('@ton/ton');

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

function drawSparkline(ctx, startX, startY, width, height) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(startX, startY + height);
    
    // Curva minimalista ascendente
    ctx.bezierCurveTo(
        startX + width * 0.3, startY + height * 0.8,
        startX + width * 0.6, startY + height * 1.0,
        startX + width * 0.7, startY + height * 0.4
    );
    ctx.bezierCurveTo(
        startX + width * 0.8, startY + height * 0.1,
        startX + width * 0.9, startY + height * 0.2,
        startX + width, startY
    );

    ctx.lineWidth = 4;
    const grad = ctx.createLinearGradient(startX, 0, startX + width, 0);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 1)');
    ctx.strokeStyle = grad;
    
    ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
    ctx.shadowBlur = 12;
    ctx.stroke();
    
    // Relleno suave bajo la línea
    ctx.lineTo(startX + width, startY + height);
    ctx.lineTo(startX, startY + height);
    ctx.closePath();
    
    const fillGrad = ctx.createLinearGradient(0, startY, 0, startY + height);
    fillGrad.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
    fillGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = fillGrad;
    ctx.fill();
    ctx.restore();
}

function getThemeGradient(theme) {
    const themes = {
        pink: ['#ff758c', '#ff7eb3'],
        red: ['#ff4b1f', '#ff9068'],
        orange: ['#f12711', '#f5af19'],
        yellow: ['#F2C94C', '#F2994A'],
        green: ['#11998e', '#38ef7d'],
        teal: ['#00B4DB', '#0083B0'],
        blue: ['#2193b0', '#6dd5ed'],
        indigo: ['#4776E6', '#8E54E9'],
        violet: ['#8E2DE2', '#4A00E0'],
        dark: ['#141E30', '#243B55'],
        gold: ['#BF953F', '#FCF6BA'],
        diamond: ['#00d2ff', '#3a7bd5']
    };
    return themes[theme] || themes['pink'];
}

async function generateWalletImage(balanceNano, address, username = '', connectedDapp = null, isPrimary = false, theme = 'pink', walletName = 'HeartWallet') {
    let tonPriceUsd = 0;
    try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd');
        if (res.ok) {
            const data = await res.json();
            tonPriceUsd = data['the-open-network'].usd;
        }
    } catch (e) {
        tonPriceUsd = 5.25; // Fallback de seguridad
    }

    const width = 800;
    const height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (theme === 'gold') {
        const gradient = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, width);
        gradient.addColorStop(0, '#FFF5C3'); 
        gradient.addColorStop(0.4, '#D4AF37'); 
        gradient.addColorStop(1, '#8A5A19');
        ctx.fillStyle = gradient;
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
    } else if (theme === 'diamond') {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#00F2FE');
        gradient.addColorStop(0.5, '#4FACFE');
        gradient.addColorStop(1, '#001D4A');
        ctx.fillStyle = gradient;
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
        const themeColors = getThemeGradient(theme);
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, themeColors[0]);
        gradient.addColorStop(1, themeColors[1]);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(800, 0, 350, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 400, 250, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    roundRect(ctx, 50, 50, 700, 300, 24);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    
    // Canvas no puede renderizar emojis — los eliminamos para una visualización limpia
    const stripEmojis = (str) => str.replace(/[\u{1F000}-\u{1FFFF}\u{2000}-\u{3300}\u{FE00}-\u{FEFF}]/gu, '').trim();
    const safeWalletName = stripEmojis(walletName) || walletName; // fallback al original si queda vacío

    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(safeWalletName, 90, 110);

    if (username) {
        ctx.font = '24px sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.textAlign = 'right';
        ctx.fillText(`@${username}`, 710, 110);
        ctx.textAlign = 'left';
    }

    ctx.font = '22px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText('Balance Disponible', 90, 180);

    const balanceTon = fromNano(balanceNano);
    ctx.fillStyle = '#ffffff';
    let fontSize = 64;
    ctx.font = `bold ${fontSize}px sans-serif`;
    
    // Limitar a 4 decimales para que se vea más limpio
    const num = parseFloat(balanceTon);
    const formattedBalance = isNaN(num) ? balanceTon : num.toLocaleString('en-US', { maximumFractionDigits: 4 });
    const mainText = `${formattedBalance} GRAM`;

    // Reducir la fuente si el texto es muy largo en vez de aplastarlo
    let textWidth = ctx.measureText(mainText).width;
    while (textWidth > 340 && fontSize > 30) {
        fontSize -= 2;
        ctx.font = `bold ${fontSize}px sans-serif`;
        textWidth = ctx.measureText(mainText).width;
    }
    
    ctx.fillText(mainText, 90, 250);
    
    // (ex TON) justo debajo del balance en tamaño pequeño
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('(ex TON)', 90, 285);
    
    const textWidthExTon = ctx.measureText('(ex TON)').width;
    
    // Total USD value
    const totalUsdValue = (parseFloat(balanceTon) || 0) * tonPriceUsd;
    const usdText = tonPriceUsd > 0 ? `~ $${totalUsdValue.toFixed(2)} USD` : ' $... USD';
    
    ctx.font = '20px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText(usdText, 90 + textWidthExTon + 10, 285);
    
    // Dibujar la gráfica minimalista al lado del balance
    drawSparkline(ctx, 450, 170, 250, 80);

    // Precio unitario debajo de la gráfica
    ctx.font = '16px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.textAlign = 'center';
    const priceText = tonPriceUsd > 0 ? `$${tonPriceUsd.toFixed(2)}` : '$...';
    ctx.fillText(`1 GRAM (ex TON) = ${priceText} USD`, 575, 280);
    ctx.textAlign = 'left';

    ctx.font = '18px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    const shortAddress = `${address.slice(0, 14)}...${address.slice(-14)}`;
    ctx.fillText(`Address: ${shortAddress}`, 90, 340);

    let yOffset = 140;

    if (isPrimary) {
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = '#ffffff'; 
        ctx.textAlign = 'right';
        ctx.fillText(`⭐ Billetera Principal`, 710, yOffset);
        ctx.textAlign = 'left';
        yOffset += 25;
    }

    if (connectedDapp) {
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.fillText(`🔗 Conectada a ${connectedDapp}`, 710, yOffset);
        ctx.textAlign = 'left';
    }

    return canvas.toBuffer('image/png');
}

function generateEmptyNFTsImage() {
    const width = 800;
    const height = 400;
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#ff758c');
    gradient.addColorStop(1, '#ff7eb3');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(400, 200, 150, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🖼', 400, 180);

    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('Galería Vacía', 400, 240);
    
    ctx.font = '22px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText('Aún no tienes NFTs ni coleccionables en esta billetera.', 400, 290);

    return canvas.toBuffer('image/png');
}

module.exports = { generateWalletImage, generateEmptyNFTsImage };
