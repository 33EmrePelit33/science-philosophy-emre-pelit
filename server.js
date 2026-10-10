import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Cloud Run'ın atadığı portu al (varsayılan 3000)
const PORT = process.env.PORT || 3000;
// Cloud Run için HOST mutlaka '0.0.0.0' olmalıdır:
const HOST = '0.0.0.0';

// Statik dosyaları (HTML, CSS, JS) sun
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(__dirname));

// Tüm isteklerde index.html sayfasını döndür
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Sunucu başarıyla başlatıldı: http://${HOST}:${PORT}`);
});