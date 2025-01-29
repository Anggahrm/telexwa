import pkg from '@whiskeysockets/baileys';
const { 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    Browsers, 
    makeInMemoryStore, 
    DisconnectReason,
    generateWAMessage,
    getAggregateVotesInPollMessage,
    areJidsSameUser
} = pkg;
import { Boom } from '@hapi/boom';
import chalk from 'chalk';
import fs from 'fs';
import P from 'pino';
import moment from 'moment-timezone';
import axios from 'axios';
import { exec } from 'child_process';
import util from 'util';
import { writeExif } from './lib/sticker.js';
import { uploadImage } from './lib/uploadImage.js';
import { getDatabase } from './lib/database.js';
import makeWASocket from './lib/simple.js';
import serialize from './lib/serialize.js';

const store = makeInMemoryStore({
    logger: P().child({
        level: 'silent',
        stream: 'store'
    })
});

console.log(chalk.green.bold(`
    --------------------------------------
    ☘️ WhatsApp Bot Integration Ready
    --------------------------------------
`));

export async function createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus) {
    const { state, saveCreds } = await useMultiFileAuthState(`sessions/${phoneNumber}`);
    const { version } = await fetchLatestBaileysVersion();
    const db = getDatabase(phoneNumber);

    console.log(chalk.yellow.bold("📁     Initializing modules..."));
    console.log(chalk.cyan.bold("- Baileys API Loaded"));
    console.log(chalk.cyan.bold("- File System Ready"));

    const sock = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu("Edge"),
        getMessage: async (key) => {
            const jid = key.remoteJid;
            const msg = await store.loadMessage(jid, key.id);
            return msg?.message || "";
        }
    }, store);

    store.bind(sock.ev);

    async function handleStoredMessage(m) {
        if (!m.isGroup || m.key.id.startsWith('BAE5')) return;
        
        const chat = db.initChat(m.cht);
        const user = db.initUser(m.sender);
        
        if (chat.isBanned || user.banned) return;
        
        const msgs = chat.listStr;
        const text = m.body.toUpperCase();
        
        if (!(text in msgs)) return;
        
        const storedItem = msgs[text];
        
        try {
            if (storedItem && typeof storedItem === 'object') {
                if (storedItem.image) {
                    await sock.sendMessage(m.cht, {
                        image: { url: storedItem.image },
                        caption: storedItem.text || '',
                        mentions: m.mentions
                    });
                } else if (storedItem.text) {
                    await sock.sendMessage(m.cht, {
                        text: storedItem.text,
                        mentions: m.mentions
                    });
                }
            }
        } catch (error) {
            console.error('Error sending stored message:', error);
            await sock.sendMessage(m.cht, { 
                text: '❌ Error sending stored message' 
            });
        }
    }

    if (!sock.authState.creds.registered) {
        try {
            await sock.waitForConnectionUpdate((up) => !!up.qr);
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(chalk.white.bold(`Pairing code for ${phoneNumber}: ${code}`));
            sendPairingCodeToTelegram(phoneNumber, code);
        } catch (error) {
            console.error(chalk.red.bold(`Failed to request pairing code for ${phoneNumber}:`, error));
            return null;
        }
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        updateStatus(phoneNumber, connection || 'offline');
        
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            console.log(chalk.red.bold("Connection closed due to: "), lastDisconnect.error);

            if (reason === DisconnectReason.badSession) {
                console.log(chalk.red.bold("Bad session file, please delete session and scan again"));
                deleteSession(phoneNumber);
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log(chalk.yellow.bold("Connection closed, reconnecting..."));
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            } else if (reason === DisconnectReason.connectionLost) {
                console.log(chalk.yellow.bold("Connection lost, trying to reconnect..."));
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log(chalk.green.bold("Connection replaced, another session opened"));
                sock.logout();
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(chalk.green.bold("Device logged out, please scan again"));
                deleteSession(phoneNumber);
            } else if (reason === DisconnectReason.restartRequired) {
                console.log(chalk.green.bold("Restart required, restarting..."));
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            } else if (reason === DisconnectReason.timedOut) {
                console.log(chalk.green.bold("Connection timed out, reconnecting..."));
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            }
        } else if (connection === 'connecting') {
            console.log(chalk.blue.bold("Connecting to WhatsApp..."));
        } else if (connection === 'open') {
            console.log(chalk.green.bold("Bot successfully connected."));
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            if (!chatUpdate.messages) return;
            const msg = chatUpdate.messages[0];
            if (!msg.message) return;
            
            const m = await serialize(msg, sock, store);
            if (!m) return;
            
            if (m.isBot) return;
            
            // Handle stored messages
            await handleStoredMessage(m);
            
            // Handle commands
            if (m.body.startsWith('!')) {
                const command = m.command;
                const args = m.args;
                const text = m.text;

                switch (command) {
                    case 'addlist': {
                        if (!m.isGroup) {
                            await m.reply('This command can only be used in groups!');
                            return;
                        }

                        if (!m.isAdmin) {
                            await m.reply('This command can only be used by group admins!');
                            return;
                        }

                        if (!m.quoted) {
                            await m.reply('Reply to a message with !addlist <text>');
                            return;
                        }

                        if (!text) {
                            await m.reply('*🚩 Example:*\n!addlist Test');
                            return;
                        }

                        let msgs = db.data.chats[m.cht].listStr;
                        if (text.toUpperCase() in msgs) {
                            await m.reply(`'${text}' already exists in List store`);
                            return;
                        }

                        if (m.quoted.isMedia) {
                            const media = await m.quoted.download();
                            const link = await uploadImage(media);
                            
                            msgs[text.toUpperCase()] = { 
                                image: link,
                                text: m.quoted.text || ''
                            };
                        } else {
                            msgs[text.toUpperCase()] = {
                                text: m.quoted.text || m.quoted.body || ''
                            };
                        }

                        db.saveDatabase();
                        await m.reply(`Successfully added "${text}" to List Store.\n\nAccess by typing its name`);
                        break;
                    }

                    case 'dellist': {
                        if (!m.isGroup) {
                            await m.reply('This command can only be used in groups!');
                            return;
                        }

                        if (!m.isAdmin) {
                            await m.reply('This command can only be used by group admins!');
                            return;
                        }

                        if (!text) {
                            await m.reply('*🚩 Example:*\n!dellist <name>\n\nUse !liststore to see available items.');
                            return;
                        }

                        const upperText = text.toUpperCase();
                        let msgs = db.data.chats[m.cht].listStr;

                        if (!(upperText in msgs)) {
                            await m.reply(`'${text}' is not registered in the List store`);
                            return;
                        }

                        delete msgs[upperText];
                        db.saveDatabase();
                        await m.reply(`Successfully deleted '${text}' from List Store.`);
                        break;
                    }

                    case 'liststore': {
                        if (!m.isGroup) {
                            await m.reply('This command can only be used in groups!');
                            return;
                        }

                        const items = Object.keys(db.data.chats[m.cht].listStr);
                        
                        if (items.length > 0) {
                            const groupName = m.metadata.subject;
                            const salam = (() => {
                                const time = moment.tz('Asia/Jakarta').format('HH');
                                if (time >= 0 && time < 4) return 'Good Night';
                                if (time >= 4 && time < 11) return 'Good Morning';
                                if (time >= 11 && time < 15) return 'Good Afternoon';
                                if (time >= 15 && time < 18) return 'Good Evening';
                                return 'Good Night';
                            })();

                            let capt = `「 Hello 」@${m.sender.split('@')[0]} ^_^\n`;
                            capt += `*${salam} 🌸*\n\n`;
                            capt += `🚩 List Store *${groupName}*\n┏────✧\n`;

                            items.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
                                 .forEach((item, index) => {
                                capt += `│ ${index + 1}. *${item}*\n`;
                            });
                            capt += `┗──────✧`;

                            await m.reply(capt);
                        } else {
                            await m.reply('No *list store* items in this group.');
                        }
                        break;
                    }

                    case 'brat': {
                        if (!text) {
                            await m.reply('> Reply/Enter message to create brat sticker');
                            return;
                        }

                        await m.reply('⏳ Creating sticker...');

                        try {
                            if (text.includes("--animated")) {
                                const txt = text.replace("--animated", "").trim().split(" ");
                                const array = [];
                                const tmpDir = './tmp';
                                
                                if (!fs.existsSync(tmpDir)) {
                                    fs.mkdirSync(tmpDir, { recursive: true });
                                }

                                for (let i = 0; i < txt.length; i++) {
                                    const word = txt.slice(0, i + 1).join(" ");
                                    const { data } = await axios.get(
                                        `https://aqul-brat.hf.space/api/brat?text=${encodeURIComponent(word)}`,
                                        { responseType: 'arraybuffer' }
                                    );
                                    const tmpFile = `${tmpDir}/brat_${i}-${Date.now()}.mp4`;
                                    fs.writeFileSync(tmpFile, data);
                                    array.push(tmpFile);
                                }

                                const fileTxt = `${tmpDir}/cmd-${Date.now()}.txt`;
                                let content = array.map(file => `file '${file}'\nduration 0.5\n`).join('');
                                content += `file '${array[array.length - 1]}'\nduration 3\n`;
                                fs.writeFileSync(fileTxt, content);

                                const output = `${tmpDir}/output-${Date.now()}.mp4`;
                                await new Promise((resolve, reject) => {
                                    exec(
                                        `ffmpeg -y -f concat -safe 0 -i ${fileTxt} -vf "fps=30" -c:v libx264 -preset veryfast -pix_fmt yuv420p -t 00:00:10 ${output}`,
                                        (error) => {
                                            if (error) reject(error);
                                            else resolve();
                                        }
                                    );
                                });

                                const sticker = await writeExif(
                                    { mimetype: 'video/mp4', data: fs.readFileSync(output) },
                                    { packName: 'WhatsApp Bot', packPublish: 'Bot' }
                                );

                                await sock.sendMessage(m.cht, { sticker });

                                // Cleanup
                                array.forEach(file => fs.existsSync(file) && fs.unlinkSync(file));
                                fs.existsSync(fileTxt) && fs.unlinkSync(fileTxt);
                                fs.existsSync(output) && fs.unlinkSync(output);
                            } else {
                                const { data } = await axios.get(
                                    `https://aqul-brat.hf.space/api/brat?text=${encodeURIComponent(text)}`,
                                    { responseType: 'arraybuffer' }
                                );

                                const sticker = await writeExif(
                                    { mimetype: 'image/jpeg', data },
                                    { packName: 'WhatsApp Bot', packPublish: 'Bot' }
                                );

                                await sock.sendMessage(m.cht, { sticker });
                            }
                        } catch (error) {
                            console.error('Error in brat command:', error);
                            await m.reply('❌ Failed to create brat sticker');
                        }
                        break;
                    }

                    case 'sticker':
                    case 's': {
                        if (!m.quoted) {
                            await m.reply('> Reply to photo or video to create sticker');
                            return;
                        }

                        if (!m.quoted.isMedia) {
                            await m.reply('> Invalid media. Use photo or video.');
                            return;
                        }

                        await m.reply('⏳ Creating sticker...');

                        try {
                            const media = await m.quoted.download();
                            
                            if (m.quoted.msg.mimetype.startsWith('video/') && m.quoted.msg.seconds > 10) {
                                await m.reply('> Video must not be longer than 10 seconds!');
                                return;
                            }

                            const sticker = await writeExif(
                                { mimetype: m.quoted.msg.mimetype, data: media },
                                { packName: 'WhatsApp Bot', packPublish: 'Bot' }
                            );

                            await sock.sendMessage(m.cht, { sticker });
                        } catch (error) {
                            console.error('Error in sticker command:', error);
                            await m.reply('❌ Failed to create sticker');
                        }
                        break;
                    }
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    sock.ev.on('messages.update', async (chatUpdate) => {
        for (const { key, update } of chatUpdate) {
            if (update.pollUpdates && key.fromMe) {
                const pollCreation = await sock.getMessage(key);
                if (pollCreation) {
                    const pollUpdate = await getAggregateVotesInPollMessage({
                        message: pollCreation.message,
                        pollUpdates: update.pollUpdates,
                    });
                    const toCmd = pollUpdate.filter((v) => v.voters.length !== 0)[0]?.name;
                    if (toCmd) {
                        const m = await serialize(pollCreation, sock, store);
                        await m.emit(toCmd);
                        await sock.sendMessage(key.remoteJid, { delete: key });
                    }
                }
            }
        }
    });

    return sock;
}

export function getStoredSessions() {
    const sessionsPath = 'sessions';
    if (!fs.existsSync(sessionsPath)) {
        fs.mkdirSync(sessionsPath, { recursive: true });
        return [];
    }
    
    return fs.readdirSync(sessionsPath)
        .filter(file => fs.statSync(`${sessionsPath}/${file}`).isDirectory());
}

export function deleteSession(phoneNumber) {
    const sessionPath = `sessions/${phoneNumber}`;
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        return true;
    }
    return false;
}