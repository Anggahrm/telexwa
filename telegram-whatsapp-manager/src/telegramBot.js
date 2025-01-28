import { Telegraf } from 'telegraf';
import { createWhatsAppBot, getStoredSessions, deleteSession } from './whatsappBot.js';
import fs from 'fs';

const bot = new Telegraf('7196701399:AAGfwUW1PbbVdpHB6JpIO58gsuHB6qWP5ck'); 
const whatsAppBots = new Map(); 
const phoneToChatId = new Map(); 
const botStatus = new Map();

// User roles and limits
const userRoles = new Map();
const ROLE_LIMITS = {
    'free': 1,
    'premium': 2,
    'vip': 3,
    'vvip': 5
};

// Initialize developer ID
const DEVELOPER_ID = 6026583608;

// Initialize user roles (in production this should be stored in a database)
function initializeUserRole(userId) {
    if (!userRoles.has(userId)) {
        userRoles.set(userId, 'free'); // Default role
    }
}

function getUserBotCount(userId) {
    let count = 0;
    whatsAppBots.forEach((_, phoneNumber) => {
        if (phoneToChatId.get(phoneNumber) === userId) {
            count++;
        }
    });
    return count;
}

function canAddMoreBots(userId) {
    const role = userRoles.get(userId) || 'free';
    const currentCount = getUserBotCount(userId);
    return currentCount < ROLE_LIMITS[role];
}

function sendPairingCodeToTelegram(phoneNumber, code) {
    const chatId = phoneToChatId.get(phoneNumber);
    if (chatId) {
        bot.telegram.sendMessage(chatId, `Pairing code untuk ${phoneNumber}: ${code}`);
    } else {
        console.error(`Tidak menemukan chat ID untuk nomor ${phoneNumber}`);
    }
}

function updateBotStatus(phoneNumber, status) {
    botStatus.set(phoneNumber, status);
}

async function loadStoredSessions() {
    const sessions = getStoredSessions();
    for (const phoneNumber of sessions) {
        const whatsAppBot = await createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateBotStatus);
        if (whatsAppBot) {
            whatsAppBots.set(phoneNumber, whatsAppBot);
            botStatus.set(phoneNumber, 'connecting');
        }
    }
    console.log(`Loaded ${sessions.length} stored WhatsApp sessions`);
}

bot.command('add', async (ctx) => {
    const userId = ctx.from.id;
    initializeUserRole(userId);

    if (!canAddMoreBots(userId)) {
        const role = userRoles.get(userId);
        return ctx.reply(`Anda telah mencapai batas maksimal bot untuk role ${role} (${ROLE_LIMITS[role]} bot)`);
    }

    const phoneNumber = ctx.message.text.split(' ')[1]; 
    if (!phoneNumber) {
        return ctx.reply('Format: /add 62xxxxx');
    }

    if (!phoneNumber.match(/^\d+$/)) {
        return ctx.reply('Format nomor tidak valid. Silakan gunakan format: /add 62xxxxx');
    }

    phoneToChatId.set(phoneNumber, ctx.chat.id); 
    const whatsAppBot = await createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateBotStatus);
    if (whatsAppBot) {
        whatsAppBots.set(phoneNumber, whatsAppBot);
        botStatus.set(phoneNumber, 'connecting');
        ctx.reply(`Bot WhatsApp dengan nomor ${phoneNumber} sedang dipersiapkan. Silakan tunggu pairing code.`);
    } else {
        ctx.reply('Gagal membuat bot WhatsApp. Silakan coba lagi.');
    }
});

bot.command('list', (ctx) => {
    const userId = ctx.from.id;
    let botsToShow = new Map();

    // If developer, show all bots
    if (userId === DEVELOPER_ID) {
        botsToShow = whatsAppBots;
    } else {
        // Show only user's bots
        whatsAppBots.forEach((bot, phoneNumber) => {
            if (phoneToChatId.get(phoneNumber) === userId) {
                botsToShow.set(phoneNumber, bot);
            }
        });
    }

    if (botsToShow.size === 0) {
        return ctx.reply('Tidak ada bot WhatsApp yang terdaftar.');
    }

    let message = 'Daftar Bot WhatsApp:\n\n';
    botsToShow.forEach((bot, phoneNumber) => {
        const status = bot.user?.connected ? 'open' : 'offline';
        botStatus.set(phoneNumber, status); // Update status based on actual connection
        
        message += `📱 ${phoneNumber}\n`;
        message += `└─ Status: ${status === 'open' ? '🟢 Online' : status === 'connecting' ? '🟡 Connecting' : '🔴 Offline'}\n`;
        if (userId === DEVELOPER_ID) {
            const ownerChatId = phoneToChatId.get(phoneNumber);
            message += `└─ Owner: ${ownerChatId}\n`;
        }
        message += '\n';
    });

    const userRole = userRoles.get(userId) || 'free';
    const botCount = getUserBotCount(userId);
    message += `\nRole Anda: ${userRole}\n`;
    message += `Jumlah bot: ${botCount}/${ROLE_LIMITS[userRole]}`;

    ctx.reply(message);
});

bot.command('restart', async (ctx) => {
    const userId = ctx.from.id;
    const phoneNumber = ctx.message.text.split(' ')[1];
    
    if (!phoneNumber) {
        return ctx.reply('Format: /restart 62xxxxx');
    }

    if (!whatsAppBots.has(phoneNumber)) {
        return ctx.reply('Bot WhatsApp dengan nomor tersebut tidak ditemukan.');
    }

    // Check if user owns this bot or is developer
    if (phoneToChatId.get(phoneNumber) !== userId && userId !== DEVELOPER_ID) {
        return ctx.reply('Anda tidak memiliki akses ke bot ini.');
    }

    ctx.reply(`Memulai ulang bot WhatsApp ${phoneNumber}...`);
    whatsAppBots.delete(phoneNumber);
    botStatus.set(phoneNumber, 'connecting');
    const newBot = await createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateBotStatus);
    if (newBot) {
        whatsAppBots.set(phoneNumber, newBot);
        ctx.reply(`Bot WhatsApp ${phoneNumber} telah dimulai ulang.`);
    } else {
        ctx.reply(`Gagal memulai ulang bot WhatsApp ${phoneNumber}.`);
    }
});

bot.command('delete', (ctx) => {
    const userId = ctx.from.id;
    const phoneNumber = ctx.message.text.split(' ')[1];
    
    if (!phoneNumber) {
        return ctx.reply('Format: /delete 62xxxxx');
    }

    if (!whatsAppBots.has(phoneNumber)) {
        return ctx.reply('Bot WhatsApp dengan nomor tersebut tidak ditemukan.');
    }

    // Check if user owns this bot or is developer
    if (phoneToChatId.get(phoneNumber) !== userId && userId !== DEVELOPER_ID) {
        return ctx.reply('Anda tidak memiliki akses ke bot ini.');
    }

    whatsAppBots.delete(phoneNumber);
    botStatus.delete(phoneNumber);
    phoneToChatId.delete(phoneNumber);
    
    if (deleteSession(phoneNumber)) {
        ctx.reply(`Bot WhatsApp ${phoneNumber} telah dihapus.`);
    } else {
        ctx.reply(`Gagal menghapus sesi bot WhatsApp ${phoneNumber}.`);
    }
});

// Admin command to set user roles
bot.command('setrole', (ctx) => {
    if (ctx.from.id !== DEVELOPER_ID) {
        return ctx.reply('Anda tidak memiliki akses ke perintah ini.');
    }

    const args = ctx.message.text.split(' ');
    if (args.length !== 3) {
        return ctx.reply('Format: /setrole <userId> <role>');
    }

    const targetUserId = parseInt(args[1]);
    const newRole = args[2].toLowerCase();

    if (!ROLE_LIMITS[newRole]) {
        return ctx.reply('Role tidak valid. Role yang tersedia: free, premium, vip, vvip');
    }

    userRoles.set(targetUserId, newRole);
    ctx.reply(`Role user ${targetUserId} telah diubah menjadi ${newRole}`);
});

// Load stored sessions when bot starts
loadStoredSessions();

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));