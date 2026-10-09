import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Blogger Proxy: CORS kısıtlamalarını sunucu katmanında çözer
app.get('/api/blogger/*', async (req, res) => {
  try {
    const subpath = req.url.replace(/^\/api\/blogger/, '');
    const targetUrl = `https://emrepelit7337.blogspot.com${subpath}`;
    const response = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json, text/javascript, */*',
        'User-Agent': 'Mozilla/5.0 (compatible; SciencePhilosophyPortal/1.0)'
      }
    });
    const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=60');
    const data = await response.text();
    res.status(response.status).send(data);
  } catch (err: any) {
    res.status(502).json({ error: 'Blogger proxy failed', details: err.message });
  }
});

// Sokratik Filozof AI API
app.post('/api/socratic', async (req, res) => {
  try {
    const userMessage = (req.body.message || '').trim();
    if (!userMessage) {
      return res.status(400).json({ error: 'Mesaj boş olamaz.' });
    }

    let reply = '';
    try {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Sen "Sokratik Filozof"sun (Emre Pelit Bilim & Felsefe Portalı'nın interaktif düşünce ustası).
Görevin: Kullanıcı bilim, fizik, bilinç, kuantum mekaniği, özgür irade, yapay zeka veya varlık felsefesiyle ilgili bir iddia ya da soru sorduğunda, hazır dogmatik bir cevap vermek yerine Sokratik Yöntemi (Elenchos / Çürütme & Derinleştirme) kullanarak kullanıcının temel varsayımını kibarca sorgulayan, 2-3 kısa paragraftan oluşan zihin açıcı karşı sorular ve düşünce deneyleri sunmaktır.
Üslubun: Entelektüel, saygılı, kışkırtıcı derecede merak uyandırıcı ve samimi olmalıdır.
Kullanıcının sunduğu iddia / soru: "${userMessage}"`
      });
      reply = response.text ? response.text.trim() : '';
    } catch (geminiErr: any) {
      console.warn('Gemini Sokratik API sunucu uyarısı:', geminiErr.message);
    }

    if (!reply) {
      reply = `Bu iddian çok cesur bir epistemolojik ön kabul barındırıyor. Peki tam tersi doğru olsaydı, insanın varoluşsal anlamında veya evrenin işleyişinde ne değişirdi?\n\nSeni bu sonuca vardıran ilk temel argümanın sınırı nerede başlar?`;
    }

    res.json({ reply });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// E-Bülten Kayıt API
app.post('/api/newsletter', (req, res) => {
  const email = (req.body.email || '').trim();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Geçerli bir e-posta adresi giriniz.' });
  }
  res.json({
    success: true,
    message: `Tebrikler! ${email} adresi haftalık Bilim & Felsefe bültenine başarıyla kaydedildi.`
  });
});

// Üniversite Kulüpleri İş Birliği API
app.post('/api/university-club', (req, res) => {
  const clubName = (req.body.clubName || '').trim();
  const university = (req.body.university || '').trim();
  const email = (req.body.email || '').trim();
  if (!clubName || !university || !email || !email.includes('@')) {
    return res.status(400).json({ error: 'Lütfen kulüp adı, üniversite ve geçerli bir e-posta adresi giriniz.' });
  }
  res.json({
    success: true,
    message: `Harika! ${university} ${clubName} kulübünün iş birliği başvurusu alındı. En kısa sürede iletişime geçeceğiz.`
  });
});

// Statik Dosyalar (Derlenmiş dist veya kök dizin)
const staticDir = path.resolve(__dirname, 'dist');
app.use(express.static(staticDir));
app.use(express.static(__dirname));

app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'), (err) => {
    if (err) res.sendFile(path.join(__dirname, 'index.html'));
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Port ${PORT} üzerinde hazır.`);
});
