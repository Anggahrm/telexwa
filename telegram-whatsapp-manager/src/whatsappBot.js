import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import fs from 'fs';
import P from 'pino';

const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` }, P.destination('./logs/whatsapp-logs.txt'));
logger.level = 'trace';

export async function createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus) {
    const { state, saveCreds } = await useMultiFileAuthState(`sessions/${phoneNumber}`);
    const { version } = await fetchLatestBaileysVersion();

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
                createWhatsAppBot(phoneNumber, sendPairingCodeToTelegram, updateStatus); // Reconnect only if not logged out
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0].message?.conversation;
        const jid = m.messages[0].key.remoteJid;

        if (message && jid) {
            console.log(`Pesan dari ${jid}: ${message}`);
            if (message.toLowerCase() === 'ping') {
                await sock.sendMessage(jid, { text: 'Pong!' });
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