import { Telegraf } from 'telegraf';
import { createWhatsAppBot, getStoredSessions, deleteSession } from './whatsappBot.js';
import fs from 'fs';

const bot = new Telegraf('7196701399:AAGfwUW1PbbVdpHB6JpIO58gsuHB6qWP5ck'); 
const whatsAppBots = new Map(); 
const phoneToChatId = new Map(); 
const botStatus = new Map();

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

// Auto-load stored sessions
async function loadStoredSessions() {
    const sessions = getStoredSessions();
    for (const phoneNumber of sessions) {
        whatsAppBots.set(phoneNumber, await createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateBotStatus));
        botStatus.set(phoneNumber, 'connecting');
    }
    console.log(`Loaded ${sessions.length} stored WhatsApp sessions`);
}

bot.command('add', async (ctx) => {
    const phoneNumber = ctx.message.text.split(' ')[1]; 
    if (!phoneNumber) {
        return ctx.reply('Format: /add 62xxxxx');
    }

    if (!phoneNumber.match(/^\d+$/)) {
        return ctx.reply('Format nomor tidak valid. Silakan gunakan format: /add 62xxxxx');
    }

    phoneToChatId.set(phoneNumber, ctx.chat.id); 
    whatsAppBots.set(phoneNumber, await createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateBotStatus));
    botStatus.set(phoneNumber, 'connecting');
    ctx.reply(`Bot WhatsApp dengan nomor ${phoneNumber} sedang dipersiapkan. Silakan tunggu pairing code.`);
});

bot.command('list', (ctx) => {
    if (whatsAppBots.size === 0) {
        return ctx.reply('Tidak ada bot WhatsApp yang terdaftar.');
    }

    let message = 'Daftar Bot WhatsApp:\n\n';
    whatsAppBots.forEach((_, phoneNumber) => {
        const status = botStatus.get(phoneNumber) || 'unknown';
        message += `📱 ${phoneNumber}\n`;
        message += `└─ Status: ${status === 'open' ? '🟢 Online' : status === 'connecting' ? '🟡 Connecting' : '🔴 Offline'}\n\n`;
    });

    ctx.reply(message);
});

bot.command('restart', async (ctx) => {
    const phoneNumber = ctx.message.text.split(' ')[1];
    if (!phoneNumber) {
        return ctx.reply('Format: /restart 62xxxxx');
    }

    if (!whatsAppBots.has(phoneNumber)) {
        return ctx.reply('Bot WhatsApp dengan nomor tersebut tidak ditemukan.');
    }

    ctx.reply(`Memulai ulang bot WhatsApp ${phoneNumber}...`);
    whatsAppBots.delete(phoneNumber);
    botStatus.set(phoneNumber, 'connecting');
    whatsAppBots.set(phoneNumber, await createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateBotStatus));
    ctx.reply(`Bot WhatsApp ${phoneNumber} telah dimulai ulang.`);
});

bot.command('delete', (ctx) => {
    const phoneNumber = ctx.message.text.split(' ')[1];
    if (!phoneNumber) {
        return ctx.reply('Format: /delete 62xxxxx');
    }

    if (!whatsAppBots.has(phoneNumber)) {
        return ctx.reply('Bot WhatsApp dengan nomor tersebut tidak ditemukan.');
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

// Load stored sessions when bot starts
loadStoredSessions();

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));