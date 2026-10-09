import { defineConfig } from 'vite';
import { GoogleGenAI } from '@google/genai';

export default defineConfig({
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api/blogger': {
        target: 'https://emrepelit7337.blogspot.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/blogger/, ''),
      },
    },
  },
  plugins: [
    {
      name: 'socratic-and-newsletter-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === '/api/socratic' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
              try {
                const parsed = JSON.parse(body || '{}');
                const userMessage = (parsed.message || '').trim();
                if (!userMessage) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Mesaj boş olamaz.' }));
                  return;
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
                  console.warn('Gemini Sokratik API uyarısı:', geminiErr.message);
                }

                if (!reply) {
                  reply = generateSocraticFallback(userMessage);
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ reply }));
              } catch (err: any) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: err.message }));
              }
            });
            return;
          }

          if (req.url === '/api/newsletter' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const parsed = JSON.parse(body || '{}');
                const email = (parsed.email || '').trim();
                if (!email || !email.includes('@')) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Geçerli bir e-posta adresi giriniz.' }));
                  return;
                }
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  success: true,
                  message: `Tebrikler! ${email} adresi Bilim & Felsefe haftalık düşünce bültenine başarıyla kaydedildi.`
                }));
              } catch (e: any) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: e.message }));
              }
            });
            return;
          }

          if (req.url === '/api/university-club' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const parsed = JSON.parse(body || '{}');
                const clubName = (parsed.clubName || '').trim();
                const university = (parsed.university || '').trim();
                const email = (parsed.email || '').trim();
                if (!clubName || !university || !email || !email.includes('@')) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Lütfen kulüp adı, üniversite ve geçerli bir e-posta adresi giriniz.' }));
                  return;
                }
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({
                  success: true,
                  message: `Harika! ${university} ${clubName} kulübünün iş birliği başvurusu alındı. En kısa sürede iletişime geçeceğiz.`
                }));
              } catch (e: any) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: e.message }));
              }
            });
            return;
          }

          next();
        });
      }
    }
  ]
});

function generateSocraticFallback(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes('özgür irade') || lower.includes('irade')) {
    return `Bu iddian çok cesur bir ön kabul barındırıyor: Kararlarının nöronlarındaki elektrokimyasal tepkimelerin bir sonucu olduğunu kabul edersek, tam şu anda bu soruyu sorma isteğin gerçekten senin miydi, yoksa evrenin başlangıcındaki Büyük Patlama'nın zorunlu bir yankısı mıydı?\n\nPeki eğer özgür irade bir yanılsamaysa, bir insanı eylemlerinden ötürü ahlaken sorumlu veya suçlu tutmanın mantıksal zemini ne olabilir?`;
  }
  if (lower.includes('bilinç') || lower.includes('yapay zeka') || lower.includes('ai') || lower.includes('llm')) {
    return `İlginç bir nokta! Peki bir varlığın 'hissettiğini' veya 'bilince sahip olduğunu' nasıl anlarız? Karşındaki insanın gerçekten bir bilinci olduğunu mu biliyorsun, yoksa sadece öyle davrandığı için mi varsayıyorsun?\n\nEğer bir yapay zeka insan gibi acı çektiğini iddia eder ve bütün nöral tepkileri bunu taklit ederse; onun bir simülasyon olduğunu iddia eden bizler, acaba Platon'un mağarasındaki gölgeleri gerçek sanan tutsaklar gibi mi davranıyoruz?`;
  }
  if (lower.includes('simülasyon') || lower.includes('gerçek')) {
    return `Eğer içinde yaşadığımız evren matematiksel bir simülasyonsa, bu simülasyonu çalıştıran 'üst gerçekliğin' de başka bir simülasyon olmadığını nereden bilebilirsin?\n\nKuantum fiziğinde gözlemcinin dalga fonksiyonunu çökertmesi, evrenin sadece 'bakıldığında render edilen' bir bilgisayar oyunu grafiği olduğunu mu gösterir, yoksa sadece insan algısının sınırını mı?`;
  }
  return `Dile getirdiğin bu fikir büyüleyici bir epistemolojik soru doğuruyor: Bu düşüncenin doğruluğunu kanıtlarken kullandığın mantık kurallarının kendisinin güvenilir olduğunu nasıl temellendiriyorsun?\n\nPeki tam tersi doğru olsaydı, evrenin işleyişinde veya insanın varoluşsal anlamında ne değişirdi? Seni bu sonuca vardıran ilk sarsılmaz temel nedir?`;
}
