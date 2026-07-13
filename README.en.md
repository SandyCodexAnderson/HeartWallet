<div align="center">

# 💖 HeartWallet

### A non-custodial TON blockchain wallet — living entirely inside Telegram.

![Platform](https://img.shields.io/badge/Platform-Telegram-2CA5E0?logo=telegram&logoColor=white)
![Blockchain](https://img.shields.io/badge/Blockchain-TON-0088CC?logo=data:image/svg+xml;base64,&logoColor=white)
![Node.js](https://img.shields.io/badge/Runtime-Node.js-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-pink)

> **HeartWallet** is a hybrid crypto ecosystem on the TON/GRAM network — designed to be simple, fast, and beautiful. It gives anyone with a Telegram account the power to create a wallet, send & receive crypto, stake, buy Gift Cards, sell digital content, and more — all without leaving the chat.

**[🌐 Versión en Español → README.md](./README.md)**

</div>

---

## 🌟 Key Features

| Feature | Description |
|---|---|
| 🏧 **Custodial Wallets** | Create up to 3 wallets. Private keys are encrypted with **AES-256-GCM**. Your Telegram account is the master key. |
| 🧊 **Cold Wallets** | Import any wallet via 24-word mnemonic, or permanently convert a HeartWallet account to cold — destroying server-side access. |
| 💸 **Send & Receive GRAM** | Transfer funds using a Telegram `@username`, TON address, or shareable QR code. |
| 🎁 **Smart Gifts** | Create on-chain "gift checks" with optional conditions: time-locks or password protection. |
| 🔀 **Split Bills** | Split expenses across multiple Telegram users. Each participant pays their share directly on-chain. |
| 💼 **Digital Content Store** | Sell photos, videos, and documents for GRAM with a built-in 24-hour escrow system. |
| 📅 **Recurring Subscriptions** | Create subscription plans in GRAM to monetize private Telegram groups (paid via a cron-powered auto-charge system). |
| 📈 **Staking (Tonstakers)** | Stake GRAM directly through Tonstakers and receive **tsTON** liquid staking tokens, all from within Telegram. |
| 🛒 **Gift Cards (Bitrefill)** | Buy real-world Gift Cards and mobile top-ups paying with GRAM via the Bitrefill integration. |
| 🔗 **TonConnect** | Connect your HeartWallet to any TON dApp that supports TonConnect 2.0, without leaving Telegram. |
| 📢 **Sponsor Ads** | Creators and businesses can run sponsored ad campaigns visible to all HeartWallet users. |
| 💳 **Buy TON with MoonPay** | Purchase TON with credit/debit card through MoonPay's certified flow — HeartWallet never sees your banking data. |

---

## 🏛 Architecture Overview

HeartWallet is a **Node.js Telegram Bot** built with [Telegraf](https://telegraf.js.org/). It follows a modular, handler/scene pattern and connects to:

- **The TON Blockchain** — via `@ton/ton`, `@ton/crypto` and the [TonCenter API](https://toncenter.com/).
- **TonAPI** — for NFT data, staking history, and token rates.
- **Tonstakers Protocol** — for liquid staking.
- **Prisma ORM** — as the database abstraction layer.
- **TonConnect 2.0** — via Server-Sent Events (SSE) for dApp pairing.

```
┌─────────────────────────────────────────────────────┐
│                   Telegram User                     │
└───────────────────────┬─────────────────────────────┘
                        │ Bot API (Polling / Webhook)
┌───────────────────────▼─────────────────────────────┐
│                  bot.js  (Entry Point)              │
│   Routes commands, actions, inline queries          │
│   Applies session + auth middleware                 │
└──┬──────────┬──────────┬──────────┬─────────────────┘
   │          │          │          │
┌──▼──┐   ┌──▼──┐   ┌───▼───┐  ┌──▼────────┐
│Hdlrs│   │Scene│   │Srvcs  │  │Utils      │
│     │   │Wizrd│   │       │  │           │
│start│   │send │   │ton    │  │canvasWllt │
│wall │   │recv │   │escrow │  │canvasStkg │
│spon │   │stkg │   │cron   │  │logger     │
│subs │   │...  │   │txmon  │  │...        │
└──┬──┘   └──┬──┘   └───┬───┘  └──┬────────┘
   │         │           │         │
┌──▼─────────▼───────────▼─────────▼──────────────────┐
│                    Prisma ORM                        │
│  SQLite (dev) / PostgreSQL (prod)                   │
└─────────────────────────────────────────────────────┘
```

---

## 🔐 Security Model

### Wallet Encryption
When a user creates a wallet, HeartWallet generates a new TON keypair using `@ton/crypto`. The **private key** is encrypted before it ever touches the database:

```
Private Key (hex) ──► AES-256-GCM encrypt(MASTER_KEY) ──► Stored as: iv:ciphertext:authTag
```

The `MASTER_KEY` is a 32-byte secret only you control (configured in `.env`). Without it, the stored encrypted keys are useless.

### Cold Wallets
A wallet can be "frozen" at any time. When this happens:
1. The encrypted private key and mnemonics are **wiped from the database**.
2. HeartWallet loses all ability to sign transactions for that wallet.
3. The user becomes the sole custodian via their 24-word seed phrase.

---

## 💰 Escrow System

All commerce features (digital content purchases and recurring subscriptions) use a **24-hour escrow** to protect both buyers and sellers:

```
Buyer pays GRAM
       │
       ▼
┌─────────────────────┐
│   Escrow Wallet     │  ← Neutral holding wallet
│  (24h lock timer)   │
└─────────┬───────────┘
          │ 24 hours pass (no dispute)
          ▼
┌─────────────────────┐
│  Seller Wallet      │  ← Funds released automatically
└─────────────────────┘
```

The `EscrowService` runs a polling loop (`setInterval`) every 60 seconds, querying the database for any `ESCROW` payments whose `unlockTime` has passed, and automatically releasing them to the seller's primary wallet.

---

## 📈 Staking Flow

HeartWallet integrates with [Tonstakers](https://tonstakers.com/) — a liquid staking protocol on TON — using their official `deposit` opcode:

```
User requests stake
       │
       ▼
HeartWallet signs tx via stored encrypted key
       │
       ▼
Sends GRAM + 1 TON gas to Tonstakers pool contract
       │
       ▼
Contract mints tsTON (liquid staking token) to user's wallet
       │
       ▼
HeartWallet fetches tsTON balance via TonAPI
and calculates real-time APY from the tsTON/TON 30-day price diff
```

---

## 🗄 Database Schema (Summary)

HeartWallet uses **Prisma ORM**. The schema is included in `prisma/schema.prisma`. Here's a high-level overview of the main models:

| Model | Description |
|---|---|
| `User` | One record per Telegram user. Stores `telegramId`, ban status, and wallet limit. |
| `Wallet` | Each user can have multiple wallets. Stores `address`, `encryptedPrivateKey`, and `theme`. |
| `Transaction` | On-chain transaction log (deposit / withdrawal). |
| `GiftCheck` | Smart gift with optional time-lock or password condition. |
| `SplitBill` | Group expense split across multiple participants. |
| `DigitalProduct` | Items for sale in the HeartWallet Store. |
| `Purchase` | A buy record linked to a product; enters `ESCROW` status for 24h. |
| `AdCampaign` | Sponsored ads submitted by users. |
| `SubscriptionPlan` | A recurring billing plan (e.g. for a VIP Telegram group). |
| `Subscription` | A user subscribed to a plan, with `nextRunAt` for cron processing. |
| `SubscriptionPayment` | Individual payment for a subscription cycle; also uses escrow. |

---

## 🗂 Project Structure

```
heartwallet/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── index.js               # Bootstrap / anti-crash entry point
│   ├── bot.js                 # Bot initialization, all routes/actions
│   ├── config/
│   │   └── env.js             # Environment variable loader
│   ├── db/
│   │   └── prisma.js          # Prisma client singleton
│   ├── handlers/              # One-shot command/action handlers
│   │   ├── start.js           # /start command, welcome flow
│   │   ├── wallet.js          # Wallet view, TX history, NFTs
│   │   ├── subscription.js    # User subscription management
│   │   ├── sponsor.js         # Sponsor/ads menu
│   │   └── inlineQuery.js     # Inline mode (gift checks, products)
│   ├── scenes/                # Multi-step Telegraf Wizards
│   │   ├── createWalletScene.js
│   │   ├── sendScene.js
│   │   ├── receiveScene.js
│   │   ├── stakingScene.js
│   │   ├── donateScene.js
│   │   ├── giftCardScene.js
│   │   ├── createProductScene.js
│   │   ├── buyProductScene.js
│   │   ├── createSubscriptionScene.js
│   │   ├── buySubscriptionScene.js
│   │   ├── tonConnectScene.js
│   │   ├── coldWalletScene.js
│   │   ├── backupWalletScene.js
│   │   └── ...                # and more
│   ├── services/              # Background services & blockchain logic
│   │   ├── tonService.js      # Core: generate/import wallets, send TON, NFTs, staking
│   │   ├── cryptoService.js   # AES-256-GCM encrypt/decrypt
│   │   ├── escrowService.js   # Auto-release escrow (runs every 60s)
│   │   ├── cronService.js     # Recurring subscription billing
│   │   ├── transactionMonitor.js # Monitors on-chain deposits in real-time
│   │   ├── tonConnectListener.js # SSE listener for TonConnect dApp pairings
│   │   └── adService.js       # Ad serving for active campaigns
│   ├── middlewares/
│   │   └── auth.js            # Ban check middleware
│   └── utils/
│       ├── canvasWallet.js    # Canvas image renderer for wallet card
│       ├── canvasStaking.js   # Canvas renderer for staking dashboard
│       ├── canvasSponsor.js   # Canvas renderer for sponsored ads
│       ├── logger.js          # Structured JSON logger
│       ├── mediaProcessor.js  # Blur/censor media for product previews
│       ├── sendProtectedContent.js
│       └── tonConnectUtils.js
└── .env.example               # Environment variable template
```

---

## ⚙️ Setup & Installation

### Prerequisites
- Node.js `v18+`
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- A [TonCenter API key](https://toncenter.com/) (optional, but recommended)
- PostgreSQL or SQLite for the database

### 1. Clone & Install

```bash
git clone https://github.com/your-username/heartwallet.git
cd heartwallet
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
DATABASE_URL="file:./dev.db"      # or your PostgreSQL connection string
BOT_TOKEN="your_telegram_bot_token"
MASTER_KEY="your_64_hex_char_key" # generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TON_NETWORK="mainnet"             # or "testnet"
TONCENTER_API_KEY="your_key"
DONATION_ADDRESS="your_ton_address"
ESCROW_WALLET_ADDRESS="your_escrow_ton_address"
ESCROW_WALLET_ENCRYPTED_KEY="your_encrypted_escrow_private_key"
```

### 3. Initialize the Database

```bash
npx prisma migrate dev --name init
npx prisma generate
```

### 4. Run the Bot

```bash
npm start
```

---

## 🔑 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Prisma connection string (SQLite or PostgreSQL) |
| `BOT_TOKEN` | ✅ | Your Telegram bot token from BotFather |
| `MASTER_KEY` | ✅ | 32-byte hex master key for AES-256 encryption |
| `TON_NETWORK` | ✅ | `mainnet` or `testnet` |
| `TONCENTER_API_KEY` | ⚠️ | Free key from toncenter.com (10 req/s vs 1 req/s) |
| `DONATION_ADDRESS` | ⚠️ | TON address to receive voluntary donations |
| `ESCROW_WALLET_ADDRESS` | ⚠️ | TON address of the neutral escrow wallet |
| `ESCROW_WALLET_ENCRYPTED_KEY` | ⚠️ | Encrypted private key of the escrow wallet |
| `BITREFILL_REF` | ➖ | Bitrefill referral code (optional) |

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Bot Framework** | [Telegraf](https://telegraf.js.org/) v4 |
| **Blockchain** | [@ton/ton](https://github.com/ton-org/ton), [@ton/crypto](https://github.com/ton-org/ton), TonCenter API |
| **Staking** | [Tonstakers SDK](https://github.com/tonstakers/tonstakers-sdk) |
| **Database ORM** | [Prisma](https://www.prisma.io/) |
| **Image Rendering** | [Canvas](https://github.com/Automattic/node-canvas), [Sharp](https://sharp.pixelplumbing.com/) |
| **QR Codes** | [qrcode](https://github.com/soldair/node-qrcode) |
| **Encryption** | Node.js built-in `crypto` (AES-256-GCM) |
| **Scheduling** | `setInterval` / `node-cron` |
| **Real-time** | SSE (`eventsource`) for TonConnect listener |

---

## 📜 License

This project is released as open-source for educational and investment review purposes under the **MIT License**.

> ⚠️ **Disclaimer:** This is a reference implementation. If you intend to run your own instance in production, you are responsible for properly securing your `MASTER_KEY`, escrow wallet, and database. HeartWallet contributors are not liable for any loss of funds.

---

<div align="center">

Made with 💖 on the TON blockchain.

</div>
