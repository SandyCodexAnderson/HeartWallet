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

/**
 * Genera una imagen PNG con las estadísticas de la campaña publicitaria.
 */
async function generateSponsorStatsImage(campaign, totalCampaignsCount = 1, currentIndex = 1) {
    const width = 800;
    const height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Fondo degradado elegante (Oscuro a Púrpura)
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1E1E2E');
    gradient.addColorStop(1, '#2D2B55');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Decoraciones circulares de fondo
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.beginPath();
    ctx.arc(800, 0, 350, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 400, 250, 0, Math.PI * 2);
    ctx.fill();

    // Contenedor principal de cristal (Glassmorphism)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    roundRect(ctx, 40, 40, 720, 320, 24);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.stroke();

    // Título superior
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('📢 Panel de Patrocinador', 80, 100);

    // Paginación (Campaña X de Y)
    ctx.font = '18px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.textAlign = 'right';
    ctx.fillText(`Campaña ${currentIndex} de ${totalCampaignsCount}`, 720, 95);
    ctx.textAlign = 'left';

    // Línea separadora
    ctx.beginPath();
    ctx.moveTo(80, 125);
    ctx.lineTo(720, 125);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Detalles de la campaña
    const shortId = campaign.id.split('-')[0].toUpperCase();
    
    let statusColor = '#A0AEC0';
    let statusText = campaign.status;
    if (statusText === 'ACTIVE') statusColor = '#48BB78'; // Verde
    if (statusText === 'PENDING') statusColor = '#ECC94B'; // Amarillo
    if (statusText === 'COMPLETED') statusColor = '#4299E1'; // Azul
    if (statusText === 'REJECTED') statusColor = '#F56565'; // Rojo

    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText(`ID: #${shortId}`, 80, 175);

    ctx.font = '22px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`Estado:`, 350, 175);
    ctx.fillStyle = statusColor;
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(statusText, 440, 175);

    // Fecha
    ctx.font = '18px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    const dateStr = new Date(campaign.createdAt).toLocaleDateString('es-ES');
    ctx.fillText(`Creada: ${dateStr}`, 80, 215);

    // Monto Invertido
    ctx.fillText(`Inversión:`, 350, 215);
    ctx.fillStyle = '#E2E8F0';
    ctx.font = 'bold 18px sans-serif';
    const gramPaid = campaign.pricePaidNano ? (Number(campaign.pricePaidNano) / 1e9).toFixed(2) : '0';
    ctx.fillText(`${gramPaid} GRAM`, 440, 215);

    // Barra de Progreso (Vistas)
    const progress = Math.min(1, campaign.viewsCurrent / campaign.viewsTarget);
    
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`Progreso de Vistas (Impresiones)`, 80, 275);

    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${campaign.viewsCurrent.toLocaleString()} / ${campaign.viewsTarget.toLocaleString()}`, 720, 275);
    ctx.textAlign = 'left';

    // Dibujar barra de fondo
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    roundRect(ctx, 80, 290, 640, 20, 10);
    ctx.fill();

    // Dibujar barra rellena
    if (progress > 0) {
        ctx.fillStyle = '#ff758c'; // Rosa HeartWallet
        
        // Evitar que la barra rellena sea menor al radio si hay un poco de progreso
        const fillWidth = Math.max(20, 640 * progress); 
        roundRect(ctx, 80, 290, fillWidth, 20, 10);
        ctx.fill();
    }

    return canvas.toBuffer('image/png');
}

module.exports = { generateSponsorStatsImage };
