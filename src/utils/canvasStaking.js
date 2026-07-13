const { createCanvas } = require('canvas');
const path = require('path');

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
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

async function generateStakingImage(tonBalance, tsTonBalance, investedTonValue, investedUsdValue, theme = 'pink', gainTon = null, gainUsd = null) {
    const width = 800;
    const height = 460;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // ─── 1) FONDO PRINCIPAL ───
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

    // ─── 2) GRÁFICO ABSTRACTO (Línea de Inversión) ───
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, height * 0.8);
    ctx.bezierCurveTo(width * 0.3, height * 0.8, width * 0.6, height * 0.4, width, height * 0.3);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    
    const chartGrad = ctx.createLinearGradient(0, height * 0.3, 0, height);
    chartGrad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    chartGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = chartGrad;
    ctx.fill();
    
    ctx.beginPath();
    ctx.moveTo(0, height * 0.8);
    ctx.bezierCurveTo(width * 0.3, height * 0.8, width * 0.6, height * 0.4, width, height * 0.3);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.stroke();
    
    // Punto final del gráfico (indicando crecimiento)
    ctx.beginPath();
    ctx.arc(width, height * 0.3, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    // ─── 3) TARJETA PRINCIPAL (Contenedor de Datos) ───
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    roundRect(ctx, 40, 40, 720, 360, 24);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.stroke();

    // ─── 4) TEXTOS ───
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';

    // Título
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Liquid Staking', 80, 80);
    
    // Subtítulo / Proveedor
    ctx.font = '22px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText('via Tonstakers', 80, 125);

    // Saldo Disponible
    ctx.textAlign = 'right';
    ctx.font = '18px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('Saldo Disponible', 720, 80);
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${tonBalance} GRAM`, 720, 105);

    // Separador
    ctx.beginPath();
    ctx.moveTo(80, 180);
    ctx.lineTo(720, 180);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.stroke();

    // Bloque Inversión (tsTON)
    ctx.textAlign = 'left';
    ctx.font = '20px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('Tokens en Staking', 80, 210);
    
    ctx.font = 'bold 48px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${tsTonBalance} tsTON`, 80, 240);

    // Equivalencia en GRAM
    ctx.font = '22px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(`≈ ${investedTonValue} GRAM`, 80, 298);

    // Equivalencia en USD
    ctx.font = '18px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fillText(`≈ $${investedUsdValue} USD`, 80, 322);

    // Ganancia — flecha blanca + signo correcto
    if (gainTon !== null) {
        const gVal   = parseFloat(gainTon);
        const gUsd   = parseFloat(gainUsd);
        const isPos  = gVal >= 0;
        const arrow  = isPos ? '↑' : '↓';
        const sign   = isPos ? '+' : '';
        const signU  = gUsd >= 0 ? '+' : '';
        ctx.textAlign = 'left';
        ctx.font      = '17px sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
        ctx.fillText(`${arrow} Ganancia: ${sign}${gainTon} GRAM (≈ $${signU}${gainUsd} USD)`, 80, 342);
    }

    // Separador inferior
    ctx.beginPath();
    ctx.moveTo(80, 358);
    ctx.lineTo(720, 358);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Mensaje de interés compuesto
    ctx.font      = 'italic 14px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.textAlign = 'center';
    ctx.fillText('Tus tsTON aumentan de valor automaticamente cada ~18 horas.', 400, 374);

    return canvas.toBuffer('image/png');
}

module.exports = { generateStakingImage };
