const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const qrcode = require('qrcode'); // سنستخدم مكتبة qrcode لتحويل الرمز لصورة ويب (أو سنعرضه كنص)

let latestQR = '';

// 1. فتح سيرفر ويب يعرض QR Code أو حالة البوت للمستخدم عبر المتصفح
const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (latestQR) {
        try {
            // توليد صورة QR كـ Data URL لعرضها بشكل جميل جداً على هاتف المحمول
            const qrImage = await qrcode.toDataURL(latestQR);
            res.end(`
                <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                    <h2>امسح الرمز أدناه لربط بوت الواتساب:</h2>
                    <img src="${qrImage}" alt="WhatsApp QR Code" style="width:300px;height:300px;"/>
                    <p>قم بتحديث الصفحة إذا لم يظهر الرمز بوضوح.</p>
                </div>
            `);
        } catch (err) {
            res.end(`<h2>حدث خطأ أثناء توليد الرمز، يرجى إعادة التشغيل.</h2>`);
        }
    } else {
        res.end(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>البوت يعمل أو تم الاتصال بنجاح!</h2>
                <p>إذا لم يتم الربط، انتظر قليلاً أو قم بإعادة تشغيل الخدمة.</p>
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
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // التقاط الرمز وتخزينه ليعرض في صفحة الويب
        if (qr) {
            latestQR = qr;
            console.log('تم توليد QR Code جديد، افتح رابط المشروع لرؤيته!');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('انقطع الاتصال، جاري إعادة المحاولة...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            latestQR = ''; // مسح الرمز بعد الاتصال الناجح
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
