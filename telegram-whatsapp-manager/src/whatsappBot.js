import pkg from '@whiskeysockets/baileys';
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, proto, makeInMemoryStore, DisconnectReason } = pkg;
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
    });

    store.bind(sock.ev);

    async function handleStoredMessage(sock, msg) {
        const from = msg.key.remoteJid;
        const sender = msg.key.fromMe ? sock.user.id : msg.key.participant || msg.key.remoteJid;
        
        // Get chat and user data
        const chat = db.initChat(from);
        const user = db.initUser(sender);
        
        // Skip processing if conditions aren't met
        if (!from.endsWith('@g.us') || from.endsWith('broadcast') || 
            chat.isBanned || user.banned || msg.key.id.startsWith('BAE5')) {
            return;
        }
        
        const text = (msg.message?.conversation || 
                     msg.message?.imageMessage?.caption || 
                     msg.message?.videoMessage?.caption || 
                     msg.message?.extendedTextMessage?.text || '').toLowerCase();
        
        const msgs = chat.listStr;
        
        // Check if message exists in list
        if (!(text.toUpperCase() in msgs)) return;
        
        const storedItem = msgs[text.toUpperCase()];
        
        try {
            if (storedItem.image) {
                // Send image with caption
                await sock.sendMessage(from, {
                    image: { url: storedItem.image },
                    caption: storedItem.text || '',
                    mentions: msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
                });
            } else {
                // Handle stored message object
                const messageContent = typeof storedItem === 'string' ? 
                    JSON.parse(storedItem) : storedItem;
                    
                await sock.sendMessage(from, messageContent);
            }
        } catch (error) {
            console.error('Error sending stored message:', error);
            await sock.sendMessage(from, { 
                text: '❌ Terjadi kesalahan saat mengirim pesan tersimpan' 
            });
        }
    }

    if (!sock.authState.creds.registered) {
        try {
            await sock.waitForConnectionUpdate((up) => !!up.qr);
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(chalk.white.bold(`Pairing code untuk ${phoneNumber}: ${code}`));
            sendPairingCodeToTelegram(phoneNumber, code);
        } catch (error) {
            console.error(chalk.red.bold(`Gagal meminta pairing code untuk ${phoneNumber}:`, error));
            return null;
        }
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        updateStatus(phoneNumber, connection || 'offline');
        
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            console.log(chalk.red.bold("Koneksi ditutup karena: "), lastDisconnect.error);

            if (reason === DisconnectReason.badSession) {
                console.log(chalk.red.bold("File sesi buruk, Harap hapus sesi dan scan ulang"));
                deleteSession(phoneNumber);
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log(chalk.yellow.bold("Koneksi ditutup, sedang mencoba untuk terhubung kembali..."));
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            } else if (reason === DisconnectReason.connectionLost) {
                console.log(chalk.yellow.bold("Koneksi hilang, mencoba untuk terhubung kembali..."));
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log(chalk.green.bold("Koneksi diganti, sesi lain telah dibuka"));
                sock.logout();
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(chalk.green.bold("Perangkat logout, harap scan ulang"));
                deleteSession(phoneNumber);
            } else if (reason === DisconnectReason.restartRequired) {
                console.log(chalk.green.bold("Restart diperlukan, sedang memulai ulang..."));
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            } else if (reason === DisconnectReason.timedOut) {
                console.log(chalk.green.bold("Koneksi waktu habis, sedang mencoba untuk terhubung kembali..."));
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            }
        } else if (connection === 'connecting') {
            console.log(chalk.blue.bold("Menghubungkan ke WhatsApp..."));
        } else if (connection === 'open') {
            console.log(chalk.green.bold("Bot berhasil terhubung."));
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        
        // Handle stored messages first
        await handleStoredMessage(sock, msg);
        
        const content = msg.message;
        if (!content) return;
        
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.fromMe ? sock.user.id : isGroup ? msg.key.participant : from;
        const quoted = msg.quoted || msg;
        const body = (typeof content === 'string' ? content : content.conversation) || 
                    (content.imageMessage && content.imageMessage.caption) || 
                    (content.videoMessage && content.videoMessage.caption) || 
                    (content.extendedTextMessage && content.extendedTextMessage.text) || '';
        
        // Check if sender is owner
        const isOwner = msg.key.fromMe;
        
        // Initialize chat in database if not exists
        if (isGroup) {
            db.initChat(from);
        }

        // Handle eval commands
        if (isOwner) {
            if (body.startsWith('>') || body.startsWith('eval') || body.startsWith('=>')) {
                const code = body.replace(/^>|^eval|^=>/, '').trim();
                let evalCmd;
                try {
                    evalCmd = /await/i.test(code)
                        ? eval(`(async() => { ${code} })()`)
                        : eval(code);
                } catch (e) {
                    evalCmd = e;
                }

                new Promise((resolve, reject) => {
                    try {
                        resolve(evalCmd);
                    } catch (err) {
                        reject(err);
                    }
                })
                    .then((res) => sock.sendMessage(from, { text: util.format(res) }))
                    .catch((err) => sock.sendMessage(from, { text: util.format(err) }));
            } else if (body.startsWith('$') || body.startsWith('exec')) {
                const command = body.replace(/^\$|^exec/, '').trim();
                try {
                    exec(command, async (err, stdout) => {
                        if (err) return sock.sendMessage(from, { text: util.format(err) });
                        if (stdout) return sock.sendMessage(from, { text: util.format(stdout) });
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: util.format(e) });
                }
            }
        }

        // Command handler
        if (body.startsWith('!')) {
            const command = body.slice(1).trim().split(/ +/).shift().toLowerCase();
            const args = body.slice(1).trim().split(/ +/).slice(1);
            const text = args.join(' ');

            switch (command) {
                case 'addlist': {
                    if (!isGroup) {
                        await sock.sendMessage(from, { text: 'Perintah ini hanya dapat digunakan dalam grup!' });
                        return;
                    }

                    // Check if user is admin
                    const groupMetadata = await sock.groupMetadata(from);
                    const isAdmin = groupMetadata.participants.find(p => p.id === sender)?.admin === 'admin';
                    if (!isAdmin) {
                        await sock.sendMessage(from, { text: 'Perintah ini hanya dapat digunakan oleh admin grup!' });
                        return;
                    }

                    if (!quoted) {
                        await sock.sendMessage(from, { text: 'Balas pesan dengan perintah !addlist <teks>' });
                        return;
                    }

                    if (!text) {
                        await sock.sendMessage(from, { text: '*🚩 Contoh penggunaan:*\n!addlist Test' });
                        return;
                    }

                    let msgs = db.data.chats[from].listStr;
                    if (text.toUpperCase() in msgs) {
                        await sock.sendMessage(from, { text: `'${text}' telah terdaftar di List store` });
                        return;
                    }

                    if (quoted.msg?.mimetype?.startsWith('image/')) {
                        const media = await quoted.download();
                        const link = await uploadImage(media);
                        
                        msgs[text.toUpperCase()] = { 
                            image: link,
                            text: quoted.text || ''
                        };
                    } else {
                        msgs[text.toUpperCase()] = proto.WebMessageInfo.fromObject(quoted).toJSON();
                    }

                    db.saveDatabase();
                    await sock.sendMessage(from, { text: `Berhasil menambahkan "${text}" ke List Store.\n\nAkses dengan mengetik namanya` });
                    break;
                }

                case 'liststore': {
                    if (!isGroup) {
                        await sock.sendMessage(from, { text: 'Perintah ini hanya dapat digunakan dalam grup!' });
                        return;
                    }

                    const anu = db.data.chats[from].listStr;
                    const res = Object.keys(anu);
                    
                    if (res.length > 0) {
                        const groupName = (await sock.groupMetadata(from)).subject;
                        const salam = (() => {
                            const time = moment.tz('Asia/Jakarta').format('HH');
                            if (time >= 0 && time < 4) return 'Selamat Malam';
                            if (time >= 4 && time < 11) return 'Selamat Pagi';
                            if (time >= 11 && time < 15) return 'Selamat Siang';
                            if (time >= 15 && time < 18) return 'Selamat Sore';
                            return 'Selamat Malam';
                        })();

                        let capt = `「 Hallo 」@${sender.split('@')[0]} ^_^\n`;
                        capt += `*${salam} 🌸*\n\n`;
                        capt += `🚩 List Store *${groupName}*\n┏────✧\n`;

                        const sortedItems = res.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
                        sortedItems.forEach((item, index) => {
                            capt += `│ ${index + 1}. *${item}*\n`;
                        });
                        capt += `┗──────✧`;

                        try {
                            const ppUrl = await sock.profilePictureUrl(from, 'image');
                            await sock.sendMessage(from, {
                                text: capt,
                                mentions: [sender],
                                contextInfo: {
                                    externalAdReply: {
                                        showAdAttribution: true,
                                        title: '',
                                        body: '',
                                        thumbnailUrl: ppUrl,
                                        sourceUrl: "",
                                        mediaType: 1,
                                        renderLargerThumbnail: true
                                    }
                                }
                            });
                        } catch (error) {
                            // If profile picture fails to load, send without it
                            await sock.sendMessage(from, {
                                text: capt,
                                mentions: [sender]
                            });
                        }
                    } else {
                        await sock.sendMessage(from, { text: 'Belum ada *list store* di grup ini.' });
                    }
                    break;
                }

                case 'brat': {
                    if (!text) {
                        await sock.sendMessage(from, { text: '> Reply/Masukan pesan untuk membuat stiker brat' });
                        return;
                    }

                    await sock.sendMessage(from, { text: '⏳ Sedang membuat stiker...' });

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

                            await sock.sendMessage(from, { sticker });

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

                            await sock.sendMessage(from, { sticker });
                        }
                    } catch (error) {
                        console.error('Error in brat command:', error);
                        await sock.sendMessage(from, { text: '❌ Gagal membuat stiker brat' });
                    }
                    break;
                }

                case 'sticker':
                case 's': {
                    if (!quoted) {
                        await sock.sendMessage(from, { text: '> Reply foto atau video untuk membuat stiker' });
                        return;
                    }

                    const mimetype = quoted.msg?.mimetype || '';
                    
                    if (!mimetype.startsWith('image/') && !mimetype.startsWith('video/')) {
                        await sock.sendMessage(from, { text: '> Media tidak valid. Gunakan foto atau video.' });
                        return;
                    }

                    await sock.sendMessage(from, { text: '⏳ Sedang membuat stiker...' });

                    try {
                        const media = await quoted.download();
                        
                        if (mimetype.startsWith('video/') && quoted.seconds > 10) {
                            await sock.sendMessage(from, { text: '> Video tidak boleh lebih dari 10 detik!' });
                            return;
                        }

                        const sticker = await writeExif(
                            { mimetype, data: media },
                            { packName: 'WhatsApp Bot', packPublish: 'Bot' }
                        );

                        await sock.sendMessage(from, { sticker });
                    } catch (error) {
                        console.error('Error in sticker command:', error);
                        await sock.sendMessage(from, { text: '❌ Gagal membuat stiker' });
                    }
                    break;
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