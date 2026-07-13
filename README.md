<div align="center">

# 💖 HeartWallet

### Una billetera de blockchain TON — que vive completamente dentro de Telegram.

![Plataforma](https://img.shields.io/badge/Plataforma-Telegram-2CA5E0?logo=telegram&logoColor=white)
![Blockchain](https://img.shields.io/badge/Blockchain-TON-0088CC?logoColor=white)
![Node.js](https://img.shields.io/badge/Runtime-Node.js-339933?logo=node.js&logoColor=white)
![Licencia](https://img.shields.io/badge/Licencia-MIT-pink)

> **HeartWallet** es un ecosistema cripto híbrido sobre la red TON/GRAM — diseñado para ser simple, rápido y hermoso. Le da a cualquier persona con cuenta de Telegram el poder de crear una billetera, enviar y recibir cripto, hacer staking, comprar Gift Cards, vender contenido digital y mucho más, sin salir del chat.

**[🌐 English version → README.en.md](./README.en.md)**

</div>

---

## 🌟 Funcionalidades Principales

| Función | Descripción |
|---|---|
| 🏧 **Billeteras Custodiales** | Crea hasta 3 billeteras. Las llaves privadas se cifran con **AES-256-GCM**. Tu cuenta de Telegram es la llave maestra. |
| 🧊 **Cold Wallets** | Importa cualquier billetera con tus 24 palabras, o convierte una permanentemente en "fría", destruyendo el acceso del servidor. |
| 💸 **Enviar y Recibir GRAM** | Transfiere fondos usando un `@usuario` de Telegram, una dirección TON o un código QR compartible. |
| 🎁 **Regalos Inteligentes** | Crea "cheques regalo" on-chain con condiciones: bloqueos por tiempo o protección con contraseña. |
| 🔀 **Dividir Gastos** | Divide cuentas entre varios usuarios de Telegram. Cada participante paga su parte directamente on-chain. |
| 💼 **Tienda de Contenido Digital** | Vende fotos, videos y documentos a cambio de GRAM con sistema de retención de 24 horas integrado. |
| 📅 **Suscripciones Recurrentes** | Crea planes de suscripción en GRAM para monetizar grupos privados de Telegram, cobrado automáticamente. |
| 📈 **Staking (Tonstakers)** | Haz staking de GRAM a través de Tonstakers y recibe **tsTON**, tokens de staking líquido, todo desde Telegram. |
| 🛒 **Gift Cards (Bitrefill)** | Compra Gift Cards reales y recargas de saldo pagando con GRAM vía Bitrefill. |
| 🔗 **TonConnect** | Conecta tu HeartWallet a cualquier dApp de TON que soporte TonConnect 2.0, sin salir de Telegram. |
| 📢 **Anuncios Patrocinados** | Creadores y negocios pueden publicar campañas de anuncios visibles para todos los usuarios. |
| 💳 **Comprar TON con MoonPay** | Compra TON con tarjeta a través del flujo certificado de MoonPay — HeartWallet nunca ve tus datos bancarios. |

---

## 🏛 Visión General de la Arquitectura

HeartWallet es un **bot de Telegram en Node.js** construido con [Telegraf](https://telegraf.js.org/). Sigue un patrón modular de handlers/escenas y se conecta a:

- **La Blockchain TON** — vía `@ton/ton`, `@ton/crypto` y la [API de TonCenter](https://toncenter.com/).
- **TonAPI** — para datos de NFTs, historial de staking y tasas de tokens.
- **Protocolo Tonstakers** — para staking líquido.
- **Prisma ORM** — como capa de abstracción de base de datos.
- **TonConnect 2.0** — vía Server-Sent Events (SSE) para emparejamiento con dApps.

```
┌──────────────────────────────────────────────────────┐
│                  Usuario de Telegram                 │
└────────────────────────┬─────────────────────────────┘
                         │ Bot API (Polling / Webhook)
┌────────────────────────▼─────────────────────────────┐
│             bot.js  (Punto de Entrada)               │
│  Enruta comandos, acciones y consultas inline        │
│  Aplica middleware de sesión y autenticación         │
└──┬──────────┬──────────┬──────────┬──────────────────┘
   │          │          │          │
┌──▼────┐ ┌──▼────┐ ┌───▼───┐ ┌───▼──────┐
│Handlers│ │Scenes │ │Servicios│ │  Utils  │
│ start  │ │ send  │ │  ton   │ │ canvas  │
│ wallet │ │ recv  │ │ escrow │ │ logger  │
│ sponsor│ │ stkg  │ │  cron  │ │  ...    │
└──┬─────┘ └──┬────┘ └───┬───┘ └───┬──────┘
   └──────────┴───────────┴─────────┘
                     │
          ┌──────────▼──────────┐
          │     Prisma ORM      │
          │  SQLite / PostgreSQL│
          └─────────────────────┘
```

---

## 🔐 Modelo de Seguridad

### Cifrado de Billeteras

Cuando un usuario crea una billetera, HeartWallet genera un nuevo par de llaves TON con `@ton/crypto`. La **llave privada** se cifra antes de tocarse la base de datos:

```
Llave Privada (hex) ──► AES-256-GCM(MASTER_KEY) ──► Almacenada: iv:ciphertext:authTag
```

El `MASTER_KEY` es un secreto de 32 bytes que solo tú controlas (configurado en `.env`). Sin él, las llaves cifradas son inútiles.

### Cold Wallets

Una billetera puede "congelarse" en cualquier momento:
1. La llave privada cifrada y los mnemónicos son **eliminados de la base de datos**.
2. HeartWallet pierde toda capacidad para firmar transacciones de esa billetera.
3. El usuario se convierte en el único custodio mediante sus 24 palabras semilla.

---

## 💰 Sistema de Escrow (Retención Segura)

Todas las funciones de comercio usan un **escrow de 24 horas** para proteger a compradores y vendedores:

```
El comprador paga GRAM
       │
       ▼
┌──────────────────────┐
│  Billetera de Escrow │  ← Retención neutral
│  (temporizador 24h)  │
└──────────┬───────────┘
           │  Pasan 24h sin disputa
           ▼
┌──────────────────────┐
│  Billetera Vendedor  │  ← Fondos liberados automáticamente
└──────────────────────┘
```

El `EscrowService` corre un bucle (`setInterval`) cada 60 segundos, buscando pagos en estado `ESCROW` cuyo `unlockTime` haya vencido y liberándolos automáticamente.

---

## 📈 Flujo de Staking

HeartWallet se integra con [Tonstakers](https://tonstakers.com/) — un protocolo de staking líquido en TON — usando su opcode oficial de depósito:

```
El usuario solicita staking
       │
       ▼
HeartWallet firma la tx con la llave cifrada almacenada
       │
       ▼
Envía GRAM + 1 TON de gas al contrato del pool de Tonstakers
       │
       ▼
El contrato acuña tsTON a la billetera del usuario
       │
       ▼
HeartWallet consulta el balance via TonAPI
y calcula el APY en tiempo real con la variación tsTON/TON de 30 días
```

---

## 🗄 Esquema de Base de Datos

HeartWallet usa **Prisma ORM**. El esquema completo está en `prisma/schema.prisma`.

| Modelo | Descripción |
|---|---|
| `User` | Un registro por usuario de Telegram. Almacena `telegramId`, estado de baneo y límite de billeteras. |
| `Wallet` | Cada usuario puede tener múltiples billeteras. Almacena `address`, `encryptedPrivateKey` y `theme`. |
| `Transaction` | Registro de transacciones on-chain (depósito / retiro). |
| `GiftCheck` | Regalo inteligente con condición de tiempo o contraseña. |
| `SplitBill` | Gasto grupal dividido entre varios participantes. |
| `DigitalProduct` | Artículos en venta en la Tienda de HeartWallet. |
| `Purchase` | Registro de compra; entra en estado `ESCROW` por 24h. |
| `AdCampaign` | Anuncios patrocinados enviados por usuarios. |
| `SubscriptionPlan` | Plan de cobro recurrente para grupos VIP de Telegram. |
| `Subscription` | Un usuario suscrito a un plan, con `nextRunAt` para el cron. |
| `SubscriptionPayment` | Pago individual de un ciclo de suscripción; usa escrow. |

---

## 🗂 Estructura del Proyecto

```
heartwallet/
├── prisma/
│   └── schema.prisma              # Esquema de base de datos
├── src/
│   ├── index.js                   # Bootstrap / anti-crash
│   ├── bot.js                     # Inicialización del bot y todas las rutas
│   ├── config/env.js              # Cargador de variables de entorno
│   ├── db/prisma.js               # Singleton del cliente Prisma
│   ├── handlers/                  # Manejadores de comandos/acciones de un paso
│   │   ├── start.js               # Comando /start y flujo de bienvenida
│   │   ├── wallet.js              # Vista de billetera, historial TX, NFTs
│   │   ├── subscription.js        # Gestión de suscripciones
│   │   ├── sponsor.js             # Menú de anuncios/patrocinadores
│   │   └── inlineQuery.js         # Modo inline (cheques regalo, productos)
│   ├── scenes/                    # Wizards multi-paso de Telegraf
│   │   ├── createWalletScene.js
│   │   ├── sendScene.js
│   │   ├── receiveScene.js
│   │   ├── stakingScene.js
│   │   ├── createProductScene.js
│   │   ├── buyProductScene.js
│   │   ├── createSubscriptionScene.js
│   │   ├── tonConnectScene.js
│   │   ├── coldWalletScene.js
│   │   └── ...
│   ├── services/                  # Lógica blockchain y servicios en background
│   │   ├── tonService.js          # Generar/importar billeteras, enviar TON, staking
│   │   ├── cryptoService.js       # Cifrado/descifrado AES-256-GCM
│   │   ├── escrowService.js       # Liberación automática de escrow (cada 60s)
│   │   ├── cronService.js         # Cobro recurrente de suscripciones
│   │   ├── transactionMonitor.js  # Monitor de depósitos on-chain en tiempo real
│   │   ├── tonConnectListener.js  # Listener SSE para TonConnect
│   │   └── adService.js           # Entrega de anuncios activos
│   ├── middlewares/auth.js        # Middleware de verificación de baneo
│   └── utils/
│       ├── canvasWallet.js        # Renderizador de tarjeta de billetera
│       ├── canvasStaking.js       # Renderizador del dashboard de staking
│       ├── canvasSponsor.js       # Renderizador de anuncios patrocinados
│       ├── logger.js              # Logger JSON estructurado
│       └── mediaProcessor.js     # Difuminado de media para previsualizaciones
└── .env.example                   # Plantilla de variables de entorno
```

---

## ⚙️ Instalación y Configuración

### Requisitos Previos
- Node.js `v18+`
- Token de Bot de Telegram desde [@BotFather](https://t.me/BotFather)
- [Clave API de TonCenter](https://toncenter.com/) (opcional, pero recomendado)
- PostgreSQL o SQLite para la base de datos

### 1. Clonar e Instalar

```bash
git clone https://github.com/tu-usuario/heartwallet.git
cd heartwallet
npm install
```

### 2. Configurar el Entorno

```bash
cp .env.example .env
```

Edita `.env` con tus valores reales.

### 3. Inicializar la Base de Datos

```bash
npx prisma migrate dev --name init
npx prisma generate
```

### 4. Iniciar el Bot

```bash
npm start
```

---

## 🔑 Variables de Entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `DATABASE_URL` | ✅ | Cadena de conexión Prisma (SQLite o PostgreSQL) |
| `BOT_TOKEN` | ✅ | Token de tu bot de Telegram desde BotFather |
| `MASTER_KEY` | ✅ | Clave maestra hex de 32 bytes para cifrado AES-256 |
| `TON_NETWORK` | ✅ | `mainnet` o `testnet` |
| `TONCENTER_API_KEY` | ⚠️ | Clave gratuita de toncenter.com (10 req/s vs 1 req/s) |
| `DONATION_ADDRESS` | ⚠️ | Dirección TON para donaciones voluntarias |
| `ESCROW_WALLET_ADDRESS` | ⚠️ | Dirección TON de la billetera de escrow neutral |
| `ESCROW_WALLET_ENCRYPTED_KEY` | ⚠️ | Llave privada cifrada de la billetera de escrow |
| `BITREFILL_REF` | ➖ | Código de referido de Bitrefill (opcional) |

---

## 🛠 Stack Tecnológico

| Capa | Tecnología |
|---|---|
| **Framework del Bot** | [Telegraf](https://telegraf.js.org/) v4 |
| **Blockchain** | [@ton/ton](https://github.com/ton-org/ton), [@ton/crypto](https://github.com/ton-org/ton), TonCenter API |
| **Staking** | [Tonstakers SDK](https://github.com/tonstakers/tonstakers-sdk) |
| **ORM** | [Prisma](https://www.prisma.io/) |
| **Imágenes** | [Canvas](https://github.com/Automattic/node-canvas), [Sharp](https://sharp.pixelplumbing.com/) |
| **Códigos QR** | [qrcode](https://github.com/soldair/node-qrcode) |
| **Cifrado** | `crypto` de Node.js (AES-256-GCM) |
| **Tiempo Real** | SSE (`eventsource`) para TonConnect |

---

## 📜 Licencia

Este proyecto se publica como código abierto para revisión educativa y de inversión bajo la **Licencia MIT**.

> ⚠️ **Aviso Legal:** Esta es una implementación de referencia. Si ejecutas tu propia instancia en producción, eres responsable de asegurar tu `MASTER_KEY`, la billetera de escrow y la base de datos.

---

<div align="center">

Hecho con 💖 sobre la blockchain TON.

</div>
