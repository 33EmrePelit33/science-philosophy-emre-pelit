// fix.js - catalog.json dosyasını sıfır hatasız hale getiren temizleyici
import fs from 'fs';

try {
  const rawData = fs.readFileSync('./catalog.json', 'utf8');
  const catalog = JSON.parse(rawData);

  console.log(`Toplam ${catalog.posts.length} makale taranıyor...`);

  catalog.posts = catalog.posts.map(post => {
    // 1. Prompt kalıntılarını temizle
    let content = post.content || "";
    content = content.replace(/\s*resmini yap\s*/gi, '');

    // 2. Kırık <img> etiketlerini ve kapanmayan tırnakları onar
    content = content.replace(/src="([^"]*?)(?:\s+width=)/g, 'src="$1" width=');
    content = content.replace(/<span>(?:\s|&nbsp;)+<\/span>/g, '');
    content = content.replace(/\s*data-[a-z0-9\-]+="[^"]*"/gi, '');
    content = content.replace(/<\/?(message-content|response-element|code-block)[^>]*>/gi, '');

    // 3. Excerpt ve Claim alanlarındaki &nbsp; çöplerini temizle
    let excerpt = (post.excerpt || "")
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z0-9]+;?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    let claim = (post.claim || "")
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z0-9]+;?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // 4. Dil kodlarını başlığa göre otomatik düzelt
    let lang = post.language;
    let langName = post.languageName;
    const title = post.title || "";

    if (/^(Die|Der|Das|Ist|Welche|Eigentlich|Sind|Kann|Wo|Über)\b/i.test(title)) {
      lang = "de"; langName = "Deutsch";
    } else if (/^(Le|La|Les|L'|De quelle|Sur|Conséquences|Notre|Dilemme|Billet|En réalité)\b/i.test(title)) {
      lang = "fr"; langName = "Français";
    } else if (/^(¿|El|La|Los|Las|Proyecto|Mis|Si todos|Billete|Consecuencias|Relación)\b/i.test(title)) {
      lang = "es"; langName = "Español";
    } else if (/^(The|Does|Can|Are|How|In Reality|From Which|On the|Building|Space-Time)\b/i.test(title)) {
      lang = "en"; langName = "English";
    }

    return {
      ...post,
      language: lang,
      languageName: langName,
      excerpt: excerpt,
      claim: claim,
      content: content
    };
  });

  catalog.updatedAt = new Date().toISOString();
  fs.writeFileSync('./catalog.json', JSON.stringify(catalog, null, 2), 'utf8');
  console.log("✓ catalog.json başarıyla temizlendi, sözdizimi ve HTML hataları giderildi!");

} catch (err) {
  console.error("Hata oluştu:", err.message);
}