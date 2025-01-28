import { Telegraf } from 'telegraf';
import { createWhatsAppBot, getStoredSessions, deleteSession } from './whatsappBot.js';
import { getDatabase, deleteDatabase } from './lib/database.js';
import telegramDb from './lib/telegramDatabase.js';
import fs from 'fs';

const bot = new Telegraf('7196701399:AAGfwUW1PbbVdpHB6JpIO58gsuHB6qWP5ck'); 
const whatsAppBots = new Map(); 
const phoneToChatId = new Map(); 
const botStatus = new Map();

// Initialize developer ID
const DEVELOPER_ID = 6026583608;

function getUserBotCount(userId) {
    return telegramDb.getUserBots(userId).length;
}

function canAddMoreBots(userId) {
    return telegramDb.canAddMoreBots(userId);
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
        try {
            getDatabase(phoneNumber);
            
            const whatsAppBot = await createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateBotStatus);
            if (whatsAppBot) {
                whatsAppBots.set(phoneNumber, whatsAppBot);
                botStatus.set(phoneNumber, 'connecting');
            }
        } catch (error) {
            console.error(`Error loading session for ${phoneNumber}:`, error);
        }
    }
    console.log(`Loaded ${sessions.length} stored WhatsApp sessions`);
}

bot.command('add', async (ctx) => {
    const userId = ctx.from.id;

    if (!canAddMoreBots(userId)) {
        const user = telegramDb.getUser(userId);
        const limit = user.role === 'developer' ? '∞' : telegramDb.getRoleLimit(user.role);
        return ctx.reply(`Anda telah mencapai batas maksimal bot untuk role ${user.role} (${limit} bot)`);
    }

    const phoneNumber = ctx.message.text.split(' ')[1]; 
    if (!phoneNumber) {
        return ctx.reply('Format: /add 62xxxxx');
    }

    if (!phoneNumber.match(/^\d+$/)) {
        return ctx.reply('Format nomor tidak valid. Silakan gunakan format: /add 62xxxxx');
    }

    try {
        getDatabase(phoneNumber);
        
        phoneToChatId.set(phoneNumber, ctx.chat.id); 
        const whatsAppBot = await createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateBotStatus);
        if (whatsAppBot) {
            whatsAppBots.set(phoneNumber, whatsAppBot);
            botStatus.set(phoneNumber, 'connecting');
            telegramDb.addUserBot(userId, phoneNumber);
            ctx.reply(`Bot WhatsApp dengan nomor ${phoneNumber} sedang dipersiapkan. Silakan tunggu pairing code.`);
        } else {
            ctx.reply('Gagal membuat bot WhatsApp. Silakan coba lagi.');
        }
    } catch (error) {
        console.error(`Error creating bot for ${phoneNumber}:`, error);
        ctx.reply('Terjadi kesalahan saat membuat bot. Silakan coba lagi.');
    }
});

bot.command('list', (ctx) => {
    const userId = ctx.from.id;
    let botsToShow = new Map();

    if (telegramDb.isDeveloper(userId)) {
        botsToShow = whatsAppBots;
    } else {
        const userBots = telegramDb.getUserBots(userId);
        userBots.forEach(phoneNumber => {
            if (whatsAppBots.has(phoneNumber)) {
                botsToShow.set(phoneNumber, whatsAppBots.get(phoneNumber));
            }
        });
    }

    if (botsToShow.size === 0) {
        return ctx.reply('Tidak ada bot WhatsApp yang terdaftar.');
    }

    let message = 'Daftar Bot WhatsApp:\n\n';
    botsToShow.forEach((bot, phoneNumber) => {
        const status = bot.user?.connected ? 'open' : 'offline';
        botStatus.set(phoneNumber, status);
        
        message += `📱 ${phoneNumber}\n`;
        message += `└─ Status: ${status === 'open' ? '🟢 Online' : status === 'connecting' ? '🟡 Connecting' : '🔴 Offline'}\n`;
        
        if (telegramDb.isDeveloper(userId)) {
            const db = getDatabase(phoneNumber);
            const chatCount = Object.keys(db.data.chats).length;
            const userCount = Object.keys(db.data.users).length;
            const ownerChatId = phoneToChatId.get(phoneNumber);
            message += `└─ Chats: ${chatCount}\n`;
            message += `└─ Users: ${userCount}\n`;
            message += `└─ Owner: ${ownerChatId}\n`;
        }
        message += '\n';
    });

    const user = telegramDb.getUser(userId);
    const botCount = getUserBotCount(userId);
    const limit = user.role === 'developer' ? '∞' : telegramDb.getRoleLimit(user.role);
    message += `\nRole Anda: ${user.role}\n`;
    message += `Jumlah bot: ${botCount}/${limit}`;

    ctx.reply(message);
});

bot.command('setrole', (ctx) => {
    if (!telegramDb.isDeveloper(ctx.from.id)) {
        return ctx.reply('Anda tidak memiliki akses ke perintah ini.');
    }

    const args = ctx.message.text.split(' ');
    if (args.length !== 3) {
        return ctx.reply('Format: /setrole <userId> <role>');
    }

    const targetUserId = parseInt(args[1]);
    const newRole = args[2].toLowerCase();

    if (newRole === 'developer' && ctx.from.id !== DEVELOPER_ID) {
        return ctx.reply('Anda tidak dapat mengatur role developer.');
    }

    if (!telegramDb.getRoleLimit(newRole)) {
        return ctx.reply('Role tidak valid. Role yang tersedia: free, premium, vip, vvip');
    }

    telegramDb.setUserRole(targetUserId, newRole);
    ctx.reply(`Role user ${targetUserId} telah diubah menjadi ${newRole}`);
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

    const userBots = telegramDb.getUserBots(userId);
    if (!userBots.includes(phoneNumber) && !telegramDb.isDeveloper(userId)) {
        return ctx.reply('Anda tidak memiliki akses ke bot ini.');
    }

    try {
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
    } catch (error) {
        console.error(`Error restarting bot ${phoneNumber}:`, error);
        ctx.reply(`Terjadi kesalahan saat memulai ulang bot ${phoneNumber}.`);
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

    const userBots = telegramDb.getUserBots(userId);
    if (!userBots.includes(phoneNumber) && !telegramDb.isDeveloper(userId)) {
        return ctx.reply('Anda tidak memiliki akses ke bot ini.');
    }

    try {
        whatsAppBots.delete(phoneNumber);
        botStatus.delete(phoneNumber);
        phoneToChatId.delete(phoneNumber);
        
        deleteSession(phoneNumber);
        deleteDatabase(phoneNumber);
        telegramDb.removeUserBot(userId, phoneNumber);
        
        ctx.reply(`Bot WhatsApp ${phoneNumber} telah dihapus.`);
    } catch (error) {
        console.error(`Error deleting bot ${phoneNumber}:`, error);
        ctx.reply(`Terjadi kesalahan saat menghapus bot ${phoneNumber}.`);
    }
});

loadStoredSessions();

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));