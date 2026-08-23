const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

let pairingCodeDisplay = '';
let connectionStatus = 'جاري الاتصال بسيرفر واتساب...';
let hasRequestedCode = false;

const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (pairingCodeDisplay) {
        res.end(`
            <div style="text-align:center; margin-top:40px; font-family:sans-serif;">
                <h2>رمز ربط بوت الواتساب الخاص بك:</h2>
                <h1 style="font-size: 50px; color: #25D366; background: #f0f0f0; padding: 20px; display: inline-block; border-radius: 10px; letter-spacing: 4px;">${pairingCodeDisplay}</h1>
                <p style="font-size: 18px; color: #333; margin-top: 15px;">1. افتح تطبيق الواتساب في هاتفك.</p>
                <p style="font-size: 18px; color: #333;">2. اذهب إلى: الإعدادات > الأجهزة المرتبطة > ربط جهاز.</p>
                <p style="font-size: 18px; color: #333;">3. اضغط على "ربط باستخدام رقم الهاتف فقط" وأدخل هذه الأرقام.</p>
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
    const { state, saveCreds } = await useMultiFileAuthState('session_pairing_v3');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.macOS('Chrome'), // مُعدل ليتوافق مع توليد الأكواد بدون أخطاء
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // الطريقة الصحيحة لطلب الكود فور جهوزية السوكت واستقبال الـ qr كإشارة للبدء
        if ((qr || connection === 'connecting') && !hasRequestedCode && !sock.authState.creds.registered) {
            hasRequestedCode = true;
            const phoneNumber = "249114662437"; // رقمك بدون علامة + أو مسافات
            
            try {
                connectionStatus = 'جاري طلب رمز الأرقام...';
                console.log('جاري طلب رمز الربط برقم الهاتف...');
                
                // انتظار قصير لضمان استقرار الاتصال قبل الطلب
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                pairingCodeDisplay = code;
                connectionStatus = 'الرمز جاهز!';
                
                console.log(`\n========================================`);
                console.log(`🔐 رمز الربط برقم الهاتف هو: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.error("فشل في طلب رمز الربط:", error);
                connectionStatus = 'فشل الطلب، أعد تحديث الصفحة';
                hasRequestedCode = false;
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'انقطع الاتصال، جاري إعادة المحاولة...';
            hasRequestedCode = false;
            if (shouldReconnect) {
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            pairingCodeDisplay = '';
            connectionStatus = 'متصل بنجاح!';
            console.log('🎉 تم تسجيل الدخول بنجاح والبوت يعمل الآن!');
        }
    });

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
