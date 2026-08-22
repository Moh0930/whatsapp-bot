const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

let pairingCodeDisplay = '';

// 1. سيرفر ويب بسيط لعرض حالة البوت أو رمز الربط على المتصفح
const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (pairingCodeDisplay) {
        res.end(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>رمز ربط بوت الواتساب الخاص بك:</h2>
                <h1 style="font-size: 50px; color: #25D366; background: #f0f0f0; padding: 20px; display: inline-block; border-radius: 10px;">${pairingCodeDisplay}</h1>
                <p>ادخل إلى واتساب -> الأجهزة المرتبطة -> ربط جهاز -> ربط برقم الهاتف واكتب هذا الرمز.</p>
            </div>
        `);
    } else {
        res.end(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>البوت يعمل أو تم الاتصال بنجاح!</h2>
                <p>إذا لم يظهر الرمز بعد، انتظر ثوانٍ واعمل تحديث للصفحة.</p>
            </div>
        `);
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

// تخزين مؤقت للرسائل الواردة
const messageStore = new Map();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        // جعل البوت يظهر كمتصفح سطح مكتب لضمان استقرار الاتصال
        browser: Browsers.macOS('Desktop'),
        logger: pino({ level: 'silent' })
    });

    // طلب رمز الربط برقم الهاتف إذا لم يكن الحساب مسجلاً مسبقاً
    if (!sock.authState.creds.registered) {
        // ضع رقم هاتفك هنا مع رمز الدولة (مثال: 249XXXXXXXXX)
        const phoneNumber = "249114662437"; 
        
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                pairingCodeDisplay = code;
                console.log(`\n========================================`);
                console.log(`🔐 رمز الربط الخاص بك هو: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.error("فشل في طلب رمز الربط:", error);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('انقطع الاتصال، جاري إعادة المحاولة...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            pairingCodeDisplay = ''; // مسح الرمز بعد الاتصال الناجح
            console.log('تم تسجيل الدخول بنجاح والبوت يعمل الآن!');
        }
    });

    // 2. حفظ كل رسالة واردة في الذاكرة المؤقتة
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        
        const messageId = msg.key.id;
        const chatJid = msg.key.remoteJid;
        
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        
        if (text) {
            messageStore.set(messageId, {
                chatJid: chatJid,
                sender: msg.key.participant || chatJid,
                text: text
            });
        }
    });

    // 3. مراقبة حدث حذف الرسائل
    sock.ev.on('message.delete', async (item) => {
        const deletedId = item.keys[0].id;
        const cachedMsg = messageStore.get(deletedId);

        if (cachedMsg) {
            const alertText = `⚠️ *تنبيه حذف رسالة!*\n👤 *من:* ${cachedMsg.sender}\n💬 *النص المحذوف:* ${cachedMsg.text}`;
            const myJid = '249114662437@s.whatsapp.net';
            
            await sock.sendMessage(myJid, { text: alertText });
            console.log('تم إرسال تنبيه الحذف بنجاح!');
        }
    });
}

startBot();
