import { Telegraf, Markup } from 'telegraf';
import { createWhatsAppBot, getStoredSessions, deleteSession } from './whatsappBot.js';
import { getDatabase, deleteDatabase } from './lib/database.js';
import telegramDb from './lib/telegramDatabase.js';
import { getTelegramMenu } from './handlers/menu.js';
import config from './config.js';
import fs from 'fs';

const bot = new Telegraf(config.telegram.botToken); 
const whatsAppBots = new Map(); 
const phoneToChatId = new Map(); 
const botStatus = new Map();
const pairingMessages = new Map();

// Initialize developer ID from config
const DEVELOPER_ID = config.telegram.ownerId;

function getUserBotCount(userId) {
    return telegramDb.getUserBots(userId).length;
}

function canAddMoreBots(userId) {
    return telegramDb.canAddMoreBots(userId);
}

function sendPairingCodeToTelegram(phoneNumber, code) {
    const chatId = phoneToChatId.get(phoneNumber);
    if (chatId) {
        // Check if there's an existing pairing message to edit
        const existingMessage = pairingMessages.get(phoneNumber);
        
        const pairingKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback('📋 Copy Pairing Code', `copy_code_${phoneNumber}`)]
        ]);

        const messageText = `🔐 Pairing Code untuk ${phoneNumber}:\n\n` +
                            `\`${code}\`\n\n` +
                            `*Silakan masukkan kode ini di WhatsApp Web/Desktop*\n` +
                            `_Kode akan kadaluarsa dalam beberapa menit_`;

        if (existingMessage) {
            // Edit existing message
            bot.telegram.editMessageText(chatId, existingMessage.message_id, null, messageText, {
                parse_mode: 'Markdown',
                ...pairingKeyboard
            }).catch(console.error);
        } else {
            // Send new message and store its reference
            bot.telegram.sendMessage(chatId, messageText, {
                parse_mode: 'Markdown',
                ...pairingKeyboard
            }).then((sentMessage) => {
                pairingMessages.set(phoneNumber, sentMessage);
            }).catch(console.error);
        }
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

// Add a callback query handler to copy the pairing code
bot.action(/^copy_code_(.+)$/, (ctx) => {
    const phoneNumber = ctx.match[1];
    const existingMessage = pairingMessages.get(phoneNumber);
    
    if (existingMessage) {
        // Extract the code from the message
        const codeMatch = existingMessage.text.match(/`([^`]+)`/);
        if (codeMatch) {
            const code = codeMatch[1];
            
            // Answer the callback query
            ctx.answerCbQuery('Kode telah disalin!');
            
            // Optional: You might want to copy to clipboard, but that's handled client-side
        }
    }
});

bot.command(['start', 'menu'], (ctx) => {
    const userId = ctx.from.id;
    const user = telegramDb.getUser(userId);
    const botCount = getUserBotCount(userId);
    const limit = user.role === 'developer' ? Infinity : telegramDb.getRoleLimit(user.role);
    
    const menu = getTelegramMenu(user.role, botCount, limit);
    ctx.replyWithMarkdown(menu);
});

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

    let processingMessage;
    try {
        // Send an initial "processing" message
        processingMessage = await ctx.reply('⏳ Mempersiapkan bot WhatsApp...');

        getDatabase(phoneNumber);
        
        phoneToChatId.set(phoneNumber, ctx.chat.id); 
        const whatsAppBot = await createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateBotStatus);
        
        if (whatsAppBot) {
            whatsAppBots.set(phoneNumber, whatsAppBot);
            botStatus.set(phoneNumber, 'connecting');
            telegramDb.addUserBot(userId, phoneNumber);
            
            // Edit the previous message
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                processingMessage.message_id, 
                null, 
                `✅ Bot WhatsApp untuk nomor ${phoneNumber} sedang dipersiapkan.\nTunggu pairing code yang akan segera muncul.`
            );
        } else {
            // Edit the previous message with error
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                processingMessage.message_id, 
                null, 
                '❌ Gagal membuat bot WhatsApp. Silakan coba lagi.'
            );
        }
    } catch (error) {
        console.error(`Error creating bot for ${phoneNumber}:`, error);
        if (processingMessage) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                processingMessage.message_id, 
                null, 
                '❌ Terjadi kesalahan saat membuat bot. Silakan coba lagi.'
            );
        } else {
            ctx.reply('❌ Terjadi kesalahan saat membuat bot. Silakan coba lagi.');
        }
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
    let processingMessage;
    
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
        // Send an initial "processing" message
        processingMessage = await ctx.reply(`⏳ Memulai ulang bot WhatsApp ${phoneNumber}...`);

        whatsAppBots.delete(phoneNumber);
        botStatus.set(phoneNumber, 'connecting');
        
        const newBot = await createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateBotStatus);
        
        if (newBot) {
            whatsAppBots.set(phoneNumber, newBot);
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                processingMessage.message_id, 
                null, 
                `✅ Bot WhatsApp ${phoneNumber} telah dimulai ulang.`
            );
        } else {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                processingMessage.message_id, 
                null, 
                `❌ Gagal memulai ulang bot WhatsApp ${phoneNumber}.`
            );
        }
    } catch (error) {
        console.error(`Error restarting bot ${phoneNumber}:`, error);
        if (processingMessage) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                processingMessage.message_id, 
                null, 
                `❌ Terjadi kesalahan saat memulai ulang bot ${phoneNumber}.`
            );
        } else {
            ctx.reply(`❌ Terjadi kesalahan saat memulai ulang bot ${phoneNumber}.`);
        }
    }
});

bot.command('delete', async (ctx) => {
    const userId = ctx.from.id;
    const phoneNumber = ctx.message.text.split(' ')[1];
    let processingMessage;
    
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
        // Send an initial "processing" message
        processingMessage = await ctx.reply(`⏳ Menghapus bot WhatsApp ${phoneNumber}...`);

        whatsAppBots.delete(phoneNumber);
        botStatus.delete(phoneNumber);
        phoneToChatId.delete(phoneNumber);
        
        deleteSession(phoneNumber);
        deleteDatabase(phoneNumber);
        telegramDb.removeUserBot(userId, phoneNumber);
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            processingMessage.message_id, 
            null, 
            `✅ Bot WhatsApp ${phoneNumber} telah dihapus.`
        );
    } catch (error) {
        console.error(`Error deleting bot ${phoneNumber}:`, error);
        if (processingMessage) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                processingMessage.message_id, 
                null, 
                `❌ Terjadi kesalahan saat menghapus bot ${phoneNumber}.`
            );
        } else {
            ctx.reply(`❌ Terjadi kesalahan saat menghapus bot ${phoneNumber}.`);
        }
    }
});

loadStoredSessions();

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
