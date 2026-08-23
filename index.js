const http = require('http');
const https = require('https');

// سيرفر ويب بسيط للبقاء نشيطاً على Railway
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
        <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
            <h2 style="color: #25D366;">البوت يعمل بنجاح عبر CallMeBot API!</h2>
            <p>متصل وجاهز لإرسال تنبيهات حذف الرسائل.</p>
        </div>
    `);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

// دالة إرسال التنبيه عبر CallMeBot API
function sendWhatsAppAlert(messageText) {
    const phone = "249114662437";
    const apiKey = "5816385";
    const encodedMessage = encodeURIComponent(messageText);
    
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMessage}&apikey=${apiKey}`;

    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            console.log('تم إرسال التنبيه بنجاح عبر CallMeBot:', data);
        });
    }).on("error", (err) => {
        console.error("خطأ في إرسال التنبيه:", err.message);
    });
}

// تجربة إرسال رسالة عند تشغيل البوت لأول مرة للتأكد من أن كل شيء يعمل
setTimeout(() => {
    sendWhatsAppAlert("🚀 تم تشغيل بوت تنبيهات حذف الرسائل بنجاح!");
}, 5000);
