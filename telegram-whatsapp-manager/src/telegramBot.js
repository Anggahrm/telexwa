import { Telegraf } from 'telegraf';
import { createWhatsAppBot } from './whatsappBot.js';
import fs from 'fs';

const bot = new Telegraf('7196701399:AAGfwUW1PbbVdpHB6JpIO58gsuHB6qWP5ck'); 
const whatsAppBots = new Map(); 
const phoneToChatId = new Map(); 


function sendPairingCodeToTelegram(phoneNumber, code) {
    const chatId = phoneToChatId.get(phoneNumber);
    if (chatId) {
        bot.telegram.sendMessage(chatId, `Pairing code untuk ${phoneNumber}: ${code}`);
    } else {
        console.error(`Tidak menemukan chat ID untuk nomor ${phoneNumber}`);
    }
}


bot.command('add', (ctx) => {
    const phoneNumber = ctx.message.text.split(' ')[1]; 
    if (!phoneNumber) {
        return ctx.reply('Format: /add 62xxxxx');
    }

    if (!phoneNumber.match(/^\d+$/)) {
        return ctx.reply('Format nomor tidak valid. Silakan gunakan format: /add 62xxxxx');
    }

    phoneToChatId.set(phoneNumber, ctx.chat.id); 
    whatsAppBots.set(phoneNumber, createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram));
    ctx.reply(`Bot WhatsApp dengan nomor ${phoneNumber} sedang dipersiapkan. Silakan tunggu pairing code.`);
});


bot.launch();