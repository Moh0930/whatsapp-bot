const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

let pairingCodeDisplay = '';
let connectionStatus = 'جاري الاتصال وتوليد الكود...';

const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (pairingCodeDisplay) {
        res.end(`
            <div style="text-align:center; margin-top:40px; font-family:sans-serif;">
                <h2>رمز ربط بوت الواتساب الخاص بك:</h2>
                <h1 style="font-size: 50px; color: #25D366; background: #f0f0f0; padding: 20px; display: inline-block; border-radius: 10px; letter-spacing: 4px;">${pairingCodeDisplay}</h1>
                <p style="font-size: 18px; color: #333; margin-top: 15px;">انسخ هذه الأرقام واكتبها في خانة "ربط برقم الهاتف" في تطبيق الواتساب.</p>
            </div>
        `);
    } else {
        res.end(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>حالة البوت: ${connectionStatus}</h2>
                <p>انتظر 10 ثوانٍ ثم قم بتحديث الصفحة (Refresh).</p>
            </div>
        `);
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

const messageStore = new Map();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_new');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop'),
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'انقطع الاتصال، جاري إعادة المحاولة...';
            if (shouldReconnect) {
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            pairingCodeDisplay = '';
            connectionStatus = 'متصل بنجاح!';
            console.log('🎉 تم تسجيل الدخول بنجاح!');
        }
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = "249114662437"; 
        
        setTimeout(async () => {
            try {
                console.log('جاري طلب رمز الربط من واتساب...');
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                pairingCodeDisplay = code;
                connectionStatus = 'جاهز في الأسفل';
                console.log(`\n========================================`);
                console.log(`🔐 رمز الربط هو: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.error("فشل في طلب رمز الربط:", error);
                connectionStatus = 'فشل الطلب، أعد تحديث الصفحة';
            }
        }, 5000);
    }

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        const messageId = msg.key.id;
        const chatJid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text) {
            messageStore.set(messageId, { chatJid, sender: msg.key.participant || chatJid, text });
        }
    });

    sock.ev.on('message.delete', async (item) => {
        const deletedId = item.keys[0].id;
        const cachedMsg = messageStore.get(deletedId);
        if (cachedMsg) {
            const alertText = `⚠️ *تنبيه حذف رسالة!*\n👤 *من:* ${cachedMsg.sender}\n💬 *النص المحذوف:* ${cachedMsg.text}`;
            await sock.sendMessage('249114662437@s.whatsapp.net', { text: alertText });
        }
    });
}

startBot();
