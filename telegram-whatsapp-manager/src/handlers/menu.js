import config from '../config.js';

export function getMainMenu(isGroup = false) {
    const menu = `╭─「 *${config.whatsapp.botInfo.name}* 」
│
│ 👋 *Welcome to WhatsApp Bot*
│ 
├─「 Main Menu 」
│ ⭐ !menu - Show this menu
│ 📊 !status - Show bot status
│ 💫 !ping - Test bot response
│
├─「 Sticker 」
│ 🎯 !sticker - Create sticker from media
│ 🎨 !brat - Create brat sticker with text
│
├─「 Group Menu 」${isGroup ? `
│ 📝 !addlist - Add item to list store
│ 🗑️ !dellist - Delete item from list store
│ 📋 !list - Show all items in list store` : `
│ ⚠️ Only available in groups`}
│
├─「 Bot Info 」
│ 🤖 Name: ${config.whatsapp.botInfo.name}
│ 👨‍💻 Developer: ${config.whatsapp.botInfo.author}
│ 🌐 Website: ${config.whatsapp.botInfo.website}
╰────

_Send *!help <command>* for detailed info_`;

    return menu;
}

export function getTelegramMenu(userRole, botCount, botLimit) {
    const menu = `🤖 *Bot Management Commands*

📱 *Basic Commands*
• /start - Start the bot
• /menu - Show this menu
• /list - List all your WhatsApp bots
• /add - Add new WhatsApp bot
• /restart - Restart a WhatsApp bot
• /delete - Delete a WhatsApp bot

ℹ️ *Your Account Info*
• Role: ${userRole}
• Bots: ${botCount}/${botLimit === Infinity ? '∞' : botLimit}

${userRole === 'developer' ? `👨‍💻 *Developer Commands*
• /setrole - Set user role
• /broadcast - Send message to all users` : ''}

📖 *Usage Examples*
• Add bot: /add 62xxx
• Restart bot: /restart 62xxx
• Delete bot: /delete 62xxx

Need help? Contact @${config.whatsapp.botInfo.author}`;

    return menu;
}