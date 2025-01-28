import { makeWASocket, downloadContentFromMessage, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import fs from 'fs';
import P from 'pino';
import moment from 'moment-timezone';
import { readDatabase, createDatabase } from './utils.js';
import { uploadImage } from './lib/uploadImage.js';

const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` }, P.destination('./logs/whatsapp-logs.txt'));
logger.level = 'trace';

function salam() {
    let wishloc = '';
    const time = moment.tz('Asia/Jakarta').format('HH');
    wishloc = ('Hi');
    if (time >= 0) {
        wishloc = ('Selamat Malam');
    }
    if (time >= 4) {
        wishloc = ('Selamat Pagi');
    }
    if (time >= 11) {
        wishloc = ('Selamat Siang');
    }
    if (time >= 15) {
        wishloc = ('️Selamat Sore');
    }
    if (time >= 18) {
        wishloc = ('Selamat Malam');
    }
    if (time >= 23) {
        wishloc = ('Selamat Malam');
    }
    return wishloc;
}

// Fungsi untuk menampilkan menu
async function showMenu(sock, jid, sender) {
    const menuText = `╭─「 *MENU BOT* 」
│
│ Halo @${sender.split('@')[0]} 👋
│ *${salam()} 🌸*
│
├─「 List Menu 」
│ ▸ !menu
│ ▸ !liststore
│ ▸ !addlist <nama>
│
├─「 Cara Penggunaan 」
│ 1. !addlist <nama>
│    ⤷ Untuk menambah item ke list
│    ⤷ Reply pesan/gambar yang akan
│      ditambahkan
│
│ 2. !liststore
│    ⤷ Untuk melihat semua item
│    ⤷ yang tersedia
│
│ 3. <nama item>
│    ⤷ Ketik nama item untuk
│      mengaksesnya
│
╰────

_Note: Hanya admin yang bisa
menambah/menghapus item_`;

    try {
        const ppUrl = await sock.profilePictureUrl(jid, 'image');
        await sock.sendMessage(jid, {
            text: menuText,
            mentions: [sender],
            contextInfo: {
                externalAdReply: {
                    title: 'Menu Bot',
                    body: salam(),
                    thumbnailUrl: ppUrl,
                    sourceUrl: "",
                    mediaType: 1,
                    renderLargerThumbnail: true,
                    showAdAttribution: true
                }
            }
        });
    } catch (error) {
        // Jika gagal mendapatkan foto profil, kirim tanpa thumbnail
        await sock.sendMessage(jid, {
            text: menuText,
            mentions: [sender]
        });
    }
}

export async function createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus) {
    const { state, saveCreds } = await useMultiFileAuthState(`sessions/${phoneNumber}`);
    const { version } = await fetchLatestBaileysVersion();

    // Inisialisasi database jika belum ada
    if (!readDatabase(phoneNumber)) {
        createDatabase(phoneNumber);
    }

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false, 
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
    });

    if (!sock.authState.creds.registered) {
        try {
            await sock.waitForConnectionUpdate((up) => !!up.qr)
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(`Pairing code untuk ${phoneNumber}: ${code}`);
            sendPairingCodeToTelegram(phoneNumber, code);
        } catch (error) {
            console.error(`Gagal meminta pairing code untuk ${phoneNumber}:`, error);
            return null;
        }
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        updateStatus(phoneNumber, connection || 'offline');
        
        if (connection === 'close') {
            console.log(`Bot WhatsApp ${phoneNumber} terputus. Mencoba menghubungkan kembali...`);
            if (lastDisconnect?.error?.output?.statusCode !== 401) {
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        const jid = msg.key.remoteJid;
        
        if (!jid || !msg.message || !jid.endsWith('@g.us')) return;
        
        const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const db = readDatabase(phoneNumber);
        
        // Handle menu command
        if (messageText.toLowerCase() === '!menu') {
            await showMenu(sock, jid, msg.key.participant);
            return;
        }

        // Handle liststore command
        if (messageText.match(/^!list(store|shop)?$/i)) {
            if (!db[jid]?.listStore || Object.keys(db[jid]?.listStore || {}).length === 0) {
                await sock.sendMessage(jid, { text: 'Belum ada *list store* di grup ini.' });
                return;
            }

            const groupName = (await sock.groupMetadata(jid)).subject;
            const items = Object.keys(db[jid].listStore).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
            
            let caption = `「 Hallo 」@${msg.key.participant.split('@')[0]} ^_^\n`;
            caption += `*${salam()} 🌸*\n\n`;
            caption += `🚩 List Store *${groupName}*\n`;
            caption += `┏────✧\n`;
            
            items.forEach((item, index) => {
                caption += `│ ${index + 1}. *${item}*\n`;
            });
            
            caption += `┗──────✧`;

            try {
                const ppUrl = await sock.profilePictureUrl(jid, 'image');
                await sock.sendMessage(jid, {
                    text: caption,
                    mentions: [msg.key.participant],
                    contextInfo: {
                        externalAdReply: {
                            title: '',
                            body: '',
                            thumbnailUrl: ppUrl,
                            sourceUrl: "",
                            mediaType: 1,
                            renderLargerThumbnail: true,
                            showAdAttribution: true
                        }
                    }
                }, { quoted: msg });
            } catch (error) {
                // Jika gagal mendapatkan foto profil, kirim pesan tanpa thumbnail
                await sock.sendMessage(jid, {
                    text: caption,
                    mentions: [msg.key.participant]
                }, { quoted: msg });
            }
            return;
        }
        
        // Handle addlist command
        if (messageText.startsWith('!addlist ')) {
            // Cek apakah pengirim adalah admin grup
            const groupMetadata = await sock.groupMetadata(jid);
            const isAdmin = groupMetadata.participants
                .filter(p => p.admin)
                .map(p => p.id)
                .includes(msg.key.participant);
                
            if (!isAdmin) {
                await sock.sendMessage(jid, { text: 'Maaf, hanya admin yang bisa menggunakan perintah ini!' });
                return;
            }

            const listName = messageText.slice(9).trim().toUpperCase();
            if (!listName) {
                await sock.sendMessage(jid, { text: 'Format: !addlist <nama>' });
                return;
            }

            // Cek quoted message
            if (!msg.message.extendedTextMessage?.contextInfo?.quotedMessage) {
                await sock.sendMessage(jid, { text: 'Reply pesan yang ingin ditambahkan ke list!' });
                return;
            }

            const quotedMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;

            // Inisialisasi struktur data jika belum ada
            if (!db[jid]) db[jid] = {};
            if (!db[jid].listStore) db[jid].listStore = {};

            // Cek apakah nama list sudah ada
            if (db[jid].listStore[listName]) {
                await sock.sendMessage(jid, { text: `'${listName}' sudah ada dalam List store` });
                return;
            }

            // Handle jika ada gambar
            if (quotedMsg.imageMessage) {
                const buffer = await sock.downloadMediaMessage(msg.message.extendedTextMessage.contextInfo.quotedMessage);
                const imageUrl = await uploadImage(buffer);
                
                db[jid].listStore[listName] = {
                    image: imageUrl,
                    text: quotedMsg.imageMessage.caption || ''
                };
            } else {
                // Simpan teks saja
                db[jid].listStore[listName] = {
                    text: quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || ''
                };
            }

            // Simpan ke database
            fs.writeFileSync(`./databases/database-${phoneNumber}.json`, JSON.stringify(db, null, 2));
            
            await sock.sendMessage(jid, { 
                text: `Berhasil menambahkan "${listName}" ke List Store.\nAkses dengan mengetik namanya` 
            });
            return;
        }
        
        // Handle direct list access (ketik nama item langsung)
        if (db[jid]?.listStore) {
            const upperText = messageText.toUpperCase();
            const item = db[jid].listStore[upperText];
            
            if (item) {
                if (item.image) {
                    // Kirim gambar dengan caption
                    await sock.sendMessage(jid, {
                        image: { url: item.image },
                        caption: item.text || '',
                        quoted: msg
                    });
                } else {
                    // Kirim teks saja
                    await sock.sendMessage(jid, { 
                        text: item.text,
                        quoted: msg
                    });
                }
            }
        }
    });

    return sock;
}

export function getStoredSessions() {
    const sessionsPath = 'sessions';
    if (!fs.existsSync(sessionsPath)) {
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