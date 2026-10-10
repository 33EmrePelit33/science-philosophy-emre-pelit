/**
 * Science & Philosophy | Emre Pelit
 * Blogger Canlı Süzgeç & Otomatik Senkronizasyon Motoru
 * 
 * 1. 289 makalenin tamamını anında katalogdan ve canlı Blogger API'sinden çeker.
 * 2. Blogger'da yeni bir yazı yayınlandığında otomatik tespit eder,
 *    anında süzgeçten geçirir (HTML temizleme, iddia özeti, neyin kanıt olmadığı notu,
 *    dil ve kategori tespiti, okuma süresi hesabı) ve sitede canlı yayına alır.
 * 3. Tüm sayaçları ve metinleri güncel sayıya (289, 290...) bağlar.
 */

const SITE_URL = "https://science-philosophy-emre-pelit.ai.studio";
const BLOGGER_URL = "https://emrepelit7337.blogspot.com";
const LANG_NAME = { tr: "Türkçe", en: "English", de: "Deutsch", fr: "Français", es: "Español" };

const TOPIC_RULES = [
  ["Yapay Zeka", /llm|yapay zeka|artificial intelligence|chatgpt|othello|intelligence|künstliche intelligenz|ia /i],
  ["Zihin Felsefesi", /qualia|zihin|mind|chinese room|çin odası|mary|şuur|consciousness|bewusstsein|conscience|conciencia/i],
  ["Kuantum", /kuantum|quantum|dolanık|entangle|schrödinger|schrodinger/i],
  ["Kozmoloji", /big bang|büyük patlama|kozmolog|evren|universe|holograf|kosmos/i],
  ["Zaman", /zaman|time|entropi|entropy|zeit|temps|tiempo/i],
  ["Özgür İrade", /özgür irade|free will|determin|freier wille|libre arbitre|libre albedrío/i],
  ["Simülasyon", /simülasyon|simulation|simulacion/i],
  ["Kelâm", /kur'an|kuran|quran|allah|kelam|kelâm|ayet|coran|yaratıcı/i],
  ["Etik", /etik|trolley|tramvay|ahlak|ethic|moral/i]
];

let allPosts = [];
let selectedCategory = "all";
let selectedLang = "all";
let knownIds = new Set();
let isSyncing = false;

// 1. Slugify
function slugify(title, id) {
  const map = { "ç":"c", "ğ":"g", "ı":"i", "ö":"o", "ş":"s", "ü":"u", "â":"a", "î":"i", "û":"u" };
  const clean = String(title || "").toLowerCase()
    .replace(/[çğıöşüâîû]/g, ch => map[ch] || ch)
    .replace(/[^a-z0-9\s-]/g, "")
    .trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);
  return clean ? `${clean}-${id}` : `makale-${id}`;
}

// 2. Dil Tespiti
function detectLang(title, text) {
  const sample = `${title} ${text.slice(0, 1000)}`.toLowerCase();
  const scores = {
    de: (sample.match(/[äöüß]/g) || []).length * 2 + (sample.match(/\b(und|der|die|das|nicht|ist|sie|dass|bewusstsein)\b/g) || []).length * 3,
    fr: (sample.match(/[éèêàùçœ]/g) || []).length * 2 + (sample.match(/\b(les|des|une|est|dans|que|qui|fait|conscience)\b/g) || []).length * 3,
    es: (sample.match(/[ñ¿¡]/g) || []).length * 3 + (sample.match(/\b(los|las|una|que|por|del|con|para|hecho|conciencia)\b/g) || []).length * 3,
    tr: (sample.match(/[çğıöşü]/g) || []).length * 4 + (sample.match(/\b(ve|bir|bu|ile|icin|için|olan|olarak|diye|şuur|insan)\b/g) || []).length * 2
  };
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] >= 4) return best[0];
  if (/\b(the|and|of|is|that|this|with|for|human|behavior|consciousness)\b/i.test(sample)) return "en";
  return "tr";
}

// 3. HTML Süzgeci
function filterHtml(raw) {
  if (!raw) return "<p>İçerik mevcut değil.</p>";
  let clean = raw;
  clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  clean = clean.replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '');
  clean = clean.replace(/<button\b[^<]*(?:(?!<\/button>)<[^<]*)*<\/button>/gi, '');
  clean = clean.replace(/style=([\"'][^\"']*[\"']|[^>\s]+)/gi, '');
  clean = clean.replace(/class=([\"'][^\"']*[\"']|[^>\s]+)/gi, '');
  clean = clean.replace(/on\w+=([\"'][^\"']*[\"']|[^>\s]+)/gi, '');
  return clean.trim() || "<p>İçerik süzgeçten geçirilmiştir.</p>";
}

function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
}

// 4. Blogger Yazısını Sitedeki Epistemolojik Formata Uyarlama (Süzgeç)
function adaptEntry(entry) {
  const id = ((entry.id && entry.id.$t) || "").split("post-").pop() || Math.random().toString(36).slice(2);
  const title = ((entry.title && entry.title.$t) || "Başlıksız").trim();
  const published = (entry.published && entry.published.$t) || new Date().toISOString();
  const updated = (entry.updated && entry.updated.$t) || published;
  const raw = (entry.content && entry.content.$t) || (entry.summary && entry.summary.$t) || "";
  const originalUrl = (entry.link || []).find(l => l.rel === "alternate")?.href || `${BLOGGER_URL}`;
  const labels = (entry.category || []).map(c => c.term).filter(Boolean);
  const content = filterHtml(raw);
  const text = plainText(content);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const minutes = Math.max(1, Math.round(wordCount / 180) || 1);
  const language = detectLang(title, text);

  const categories = [...labels];
  const blob = `${title} ${text.slice(0, 500)}`.toLowerCase();
  TOPIC_RULES.forEach(([name, pat]) => {
    if (pat.test(blob) && !categories.includes(name)) categories.push(name);
  });
  if (!categories.length) categories.push("Bilim & Felsefe");

  // İddia Özeti
  const claim = text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 280) || title;

  // Neyin Kanıt Olmadığı
  const notProof = wordCount < 120
    ? "Kısa veya özet metin tek başına ampirik ispat sayılamaz; iddia ile olgu ayrılmalıdır."
    : (title.includes("?")
      ? "Başlığın soru formunda olması, sorunun olumlu cevabını doğrudan ispatlamaz."
      : "Yazarın mantıksal argümanı ve analojisi, ampirik/gözlemsel veriyle doğrulanmadıkça mutlak doğa yasası sayılamaz.");

  return {
    id,
    title,
    slug: slugify(title, id),
    published,
    updated,
    language,
    languageName: LANG_NAME[language] || language,
    categories: categories.slice(0, 6),
    author: "Emre Pelit",
    originalUrl,
    wordCount,
    readingTime: `${minutes} dk`,
    readingMinutes: minutes,
    excerpt: text.slice(0, 160) + (text.length > 160 ? "…" : ""),
    claim,
    notProof,
    content
  };
}

// 5. JSONP ve Proxy Yardımıyla Canlı Çekim
function fetchBatchJSONP(startIndex, maxResults) {
  return new Promise((resolve, reject) => {
    const callbackName = "blogger_cb_" + startIndex + "_" + Math.floor(Math.random() * 1e6);
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Blogger API zaman aşımına uğradı"));
    }, 10000);

    function cleanup() {
      clearTimeout(timer);
      try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[callbackName] = data => {
      cleanup();
      resolve(data);
    };

    script.src = `${BLOGGER_URL}/feeds/posts/default?alt=json-in-script&callback=${callbackName}&start-index=${startIndex}&max-results=${maxResults}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("Blogger scripti yüklenemedi"));
    };
    document.head.appendChild(script);
  });
}

async function fetchBatch(startIndex, maxResults) {
  // Önce hızlı sunucu proxy'sini dene
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`/api/blogger/feeds/posts/default?alt=json&start-index=${startIndex}&max-results=${maxResults}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const json = await res.json();
      if (json && json.feed) return json;
    }
  } catch (e) {}

  // Proxy olmazsa doğrudan Blogger JSONP çağrısı (CORS engelsiz)
  return await fetchBatchJSONP(startIndex, maxResults);
}

// 6. Canlı Senkronizasyon (Tüm Yazıları Eksiksiz Çeker)
async function syncLive(isManual = false) {
  if (isSyncing) return;
  isSyncing = true;
  const status = document.getElementById("sync-status-indicator");
  if (status) {
    status.style.display = "block";
    status.textContent = "Blogger canlı arşivi taranıyor ve süzgeçten geçiriliyor...";
  }

  let start = 1;
  const remote = [];
  try {
    while (true) {
      const data = await fetchBatch(start, 150);
      const entries = data?.feed?.entry || [];
      const total = parseInt(data?.feed?.openSearch$totalResults?.$t || "0", 10);
      entries.forEach(entry => remote.push(adaptEntry(entry)));

      if (!entries.length || remote.length >= total || start >= total) break;
      start += entries.length;
    }

    if (remote.length > 0) {
      remote.sort((a, b) => b.published.localeCompare(a.published));
      allPosts = remote;
      knownIds = new Set(allPosts.map(p => p.id));
      paint();

      if (status) {
        status.innerHTML = `✓ Canlı Blogger senkronizasyonu tamam: <strong>${allPosts.length}</strong> makale yayında.`;
        setTimeout(() => { if (status) status.style.display = "none"; }, 4000);
      }
    }
  } catch (err) {
    console.warn("[SyncLive] Canlı sorgu yavaşladı, yerel katalog aktif:", err);
    if (status) {
      status.textContent = `Külliyat yayında: ${allPosts.length} makale.`;
      setTimeout(() => { if (status) status.style.display = "none"; }, 3000);
    }
  } finally {
    isSyncing = false;
  }
}

// 7. Arka Planda Yeni Yazı Gözetleyicisi (Her 30 saniyede bir yeni yazı var mı bakar)
async function pollNew() {
  try {
    const data = await fetchBatch(1, 6);
    const entries = data?.feed?.entry || [];
    const fresh = entries.map(adaptEntry).filter(p => !knownIds.has(p.id));

    if (fresh.length > 0) {
      console.log(`[PollNew] ${fresh.length} adet yeni Blogger yazısı tespit edildi! Süzgeçten geçiriliyor...`);
      allPosts = [...fresh, ...allPosts];
      fresh.forEach(p => knownIds.add(p.id));
      paint();

      const status = document.getElementById("sync-status-indicator");
      if (status) {
        status.style.display = "block";
        status.textContent = `🎉 Yeni yazı süzgeçten geçirilerek yayınlandı: "${fresh[0].title}" (Toplam: ${allPosts.length})`;
        setTimeout(() => { if (status) status.style.display = "none"; }, 6000);
      }
    }
  } catch (e) {
    // Sessiz devam et
  }
}

// 8. Sayaçları ve Metinleri Güncelle
function updateCounters() {
  const count = allPosts.length || 289;
  document.querySelectorAll("[data-counter='total-posts'], #nav-post-count, #stat-total-articles").forEach(el => {
    el.textContent = count;
  });

  const words = allPosts.reduce((sum, p) => sum + (p.wordCount || 0), 0);
  const avg = count ? (allPosts.reduce((sum, p) => sum + (p.readingMinutes || 1), 0) / count).toFixed(1) : "3.5";
  const wordEl = document.getElementById("stat-total-words");
  const avgEl = document.getElementById("stat-avg-reading-time");
  if (wordEl) wordEl.textContent = words ? words.toLocaleString("tr-TR") : "145.000+";
  if (avgEl) avgEl.textContent = `${avg} dk`;

  const latest = allPosts[0];
  if (latest) {
    const heroTitle = document.getElementById("hero-latest-title");
    const heroDate = document.getElementById("hero-latest-date");
    const heroRead = document.getElementById("hero-latest-read");
    const heroIndex = document.getElementById("hero-latest-index");
    if (heroTitle) heroTitle.textContent = latest.title;
    if (heroDate) heroDate.textContent = latest.published ? latest.published.slice(0, 10) : "Bugün";
    if (heroRead) heroRead.textContent = latest.readingTime;
    if (heroIndex) heroIndex.textContent = count;

    const flagTitle = document.getElementById("flagship-title");
    const flagLead = document.getElementById("flagship-lead");
    if (flagTitle) flagTitle.textContent = latest.title;
    if (flagLead) flagLead.textContent = latest.excerpt;
  }

  const footer = document.getElementById("footer-post-count-desc");
  if (footer) {
    footer.textContent = `Toplam ${count} bilim ve felsefe makalesi Blogger'dan çekilip süzgeçten geçirilerek yayına alınmıştır.`;
  }
}

// 9. Kategori ve Dil Filtre Butonları
function buildPills() {
  const cats = document.getElementById("category-filter-container");
  const langs = document.getElementById("lang-filter-container");

  if (cats) {
    const catCounts = {};
    allPosts.forEach(p => p.categories.forEach(c => { catCounts[c] = (catCounts[c] || 0) + 1; }));
    const top = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

    cats.innerHTML = `<button class="category-pill ${selectedCategory === "all" ? "active" : ""}" data-cat="all">Tüm Konular (${allPosts.length})</button>` +
      top.map(([cat, n]) => `<button class="category-pill ${selectedCategory === cat ? "active" : ""}" data-cat="${cat}">${cat} (${n})</button>`).join("");

    cats.querySelectorAll(".category-pill").forEach(btn => {
      btn.onclick = () => {
        selectedCategory = btn.dataset.cat;
        buildPills();
        renderArticleGrid();
      };
    });
  }

  if (langs) {
    const langCounts = {};
    allPosts.forEach(p => { langCounts[p.language] = (langCounts[p.language] || 0) + 1; });

    langs.innerHTML = `<button class="lang-pill ${selectedLang === "all" ? "active" : ""}" data-lang="all">Tüm Diller</button>` +
      Object.entries(langCounts).map(([lang, n]) => `<button class="lang-pill ${selectedLang === lang ? "active" : ""}" data-lang="${lang}">${LANG_NAME[lang] || lang} (${n})</button>`).join("");

    langs.querySelectorAll(".lang-pill").forEach(btn => {
      btn.onclick = () => {
        selectedLang = btn.dataset.lang;
        buildPills();
        renderArticleGrid();
      };
    });
  }
}

// 10. Filtreleme ve Sıralama
function filteredPosts() {
  const q = (document.getElementById("article-search")?.value || "").toLowerCase().trim();
  const sort = document.getElementById("sort-select")?.value || "date-desc";

  let list = allPosts.filter(p => {
    const text = `${p.title} ${p.excerpt} ${p.categories.join(" ")}`.toLowerCase();
    const okQ = !q || text.includes(q);
    const okC = selectedCategory === "all" || p.categories.includes(selectedCategory);
    const okL = selectedLang === "all" || p.language === selectedLang;
    return okQ && okC && okL;
  });

  if (sort === "date-asc") list.sort((a, b) => a.published.localeCompare(b.published));
  else if (sort === "reading-time-desc") list.sort((a, b) => (b.readingMinutes || 0) - (a.readingMinutes || 0));
  else if (sort === "title-asc") list.sort((a, b) => a.title.localeCompare(b.title, "tr"));
  else list.sort((a, b) => b.published.localeCompare(a.published));

  return list;
}

// 11. Makale Listesini Ekrana Bas
function renderArticleGrid() {
  const grid = document.getElementById("article-grid");
  if (!grid) return;

  const list = filteredPosts();
  const badge = document.getElementById("search-count-badge");
  if (badge) badge.textContent = `${list.length} makale listeleniyor (Toplam ${allPosts.length})`;

  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `<p style="grid-column: 1 / -1; text-align: center; color: #94a3b8; padding: 2.5rem;">Bu arama kriterine uygun makale bulunamadı.</p>`;
    return;
  }

  list.forEach(p => {
    const card = document.createElement("article");
    card.className = "article-card";
    card.innerHTML = `
      <div class="card-meta">
        <span>⏱️ ${p.readingTime}</span> · 
        <span class="lang-tag">${p.languageName}</span> · 
        <span style="color: #38bdf8; font-weight: 600;">${p.categories[0] || "Felsefe"}</span>
      </div>
      <h3 class="card-title">${p.title}</h3>
      <p class="card-snippet">${p.excerpt}</p>
      <div class="card-footer">
        <span style="font-size: 0.8rem; color: #94a3b8;">✍️ Emre Pelit</span>
        <span class="btn-read-label">Süzgeci & Metni İncele →</span>
      </div>
    `;
    card.onclick = () => openArticleModal(p);
    grid.appendChild(card);
  });
}

// 12. Makale Okuma Modalı
function openArticleModal(post) {
  const modal = document.getElementById("article-modal");
  if (!modal) return;

  document.getElementById("modal-article-title").textContent = post.title;
  document.getElementById("modal-article-meta").innerHTML = `
    <span>✍️ <strong>Yazar:</strong> ${post.author}</span> · 
    <span>📅 <strong>Yayın:</strong> ${post.published ? post.published.slice(0, 10) : "Bugün"}</span> · 
    <span>⏱️ <strong>Okuma:</strong> ${post.readingTime} (${post.wordCount} kelime)</span> · 
    <span>🌍 <strong>Dil:</strong> ${post.languageName}</span> · 
    <span>📂 <strong>Kategori:</strong> ${post.categories.join(", ")}</span>
  `;

  document.getElementById("modal-article-content").innerHTML = `
    <div class="epistemology-filter-box">
      <div class="filter-box-title">🛡️ BİLİM & FELSEFE SÜZGECİ (EPISTEMOLOGICAL AUDIT)</div>
      <p><strong>Temel İddia:</strong> ${post.claim || post.title}</p>
      <p><strong>Neyin Kanıtı Değildir:</strong> ${post.notProof}</p>
      <div class="filter-box-links">
        <a href="${post.originalUrl}" target="_blank" rel="noopener">🔗 Orijinal Blogger Yazısı</a> · 
        <a href="${SITE_URL}/#makale/${post.slug}">🌐 Sitedeki Otoriter Yayın Linki</a>
      </div>
    </div>
    <div class="article-clean-body">
      ${post.content}
    </div>
  `;

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
  history.replaceState(null, "", `#makale/${post.slug}`);
}

function closeArticleModal() {
  const modal = document.getElementById("article-modal");
  if (modal) modal.style.display = "none";
  document.body.style.overflow = "";
  history.replaceState(null, "", "#kulliyat");
}

function paint() {
  updateCounters();
  buildPills();
  renderArticleGrid();
  
  const hash = location.hash || "";
  if (hash.startsWith("#makale/")) {
    const slug = decodeURIComponent(hash.slice(8));
    const target = allPosts.find(p => p.slug === slug || p.id === slug);
    if (target) openArticleModal(target);
  }
}

// 13. Açılış Motoru: Önce 289'luk Hazır Kataloğu Anında Yükler, Ardından Canlı Eşitlemeyi Başlatır
async function boot() {
  console.log("[Boot] Science & Philosophy portalı başlatılıyor...");

  // 1. catalog.json'ı anında yükle (0ms gecikmeyle 289 yazının tümü açılır)
  try {
    const res = await fetch("/catalog.json");
    if (res.ok) {
      const catalog = await res.json();
      if (catalog && catalog.posts && catalog.posts.length > 0) {
        allPosts = catalog.posts;
        knownIds = new Set(allPosts.map(p => p.id));
        paint();
        console.log(`[Boot] ${allPosts.length} makale katalogdan anında yüklendi.`);
      }
    }
  } catch (err) {
    console.warn("[Boot] Yerel katalog okuma uyarısı:", err);
  }

  // 2. Canlı Blogger senkronizasyonunu arka planda hemen çalıştır
  syncLive().catch(console.warn);

  // 3. Her 30 saniyede bir yeni yazı gözetleyicisi
  setInterval(pollNew, 30000);

  // 4. Sekmeye dönüldüğünde hemen kontrol et
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pollNew();
  });
}

// 14. Olay Dinleyicileri
document.addEventListener("DOMContentLoaded", () => {
  boot();

  document.getElementById("article-search")?.addEventListener("input", renderArticleGrid);
  document.getElementById("sort-select")?.addEventListener("change", renderArticleGrid);

  document.getElementById("btn-force-sync")?.addEventListener("click", () => {
    const btn = document.getElementById("btn-force-sync");
    if (btn) btn.textContent = "Taranıyor...";
    syncLive(true).finally(() => {
      setTimeout(() => { if (btn) btn.textContent = "Senkronize et"; }, 1500);
    });
  });

  document.getElementById("modal-close-btn")?.addEventListener("click", closeArticleModal);
  window.addEventListener("click", (e) => {
    if (e.target === document.getElementById("article-modal")) closeArticleModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeArticleModal();
  });

  document.getElementById("hero-latest-btn")?.addEventListener("click", () => {
    if (allPosts.length > 0) openArticleModal(allPosts[0]);
  });

  document.querySelectorAll(".hook-pill").forEach(pill => {
    pill.addEventListener("click", function() {
      const q = this.getAttribute("data-hook");
      const search = document.getElementById("article-search");
      if (search && q) {
        search.value = q;
        renderArticleGrid();
        document.getElementById("kulliyat")?.scrollIntoView({ behavior: "smooth" });
      }
    });
  });

  // İnteraktif Düşünce Deneyleri
  document.querySelectorAll(".choice-btn").forEach(btn => {
    btn.addEventListener("click", function() {
      const card = this.closest(".experiment-card");
      if (!card) return;
      card.querySelectorAll(".choice-btn").forEach(b => b.classList.remove("selected"));
      this.classList.add("selected");
      const box = card.querySelector(".experiment-analysis-box");
      if (box) box.style.display = "block";
    });
  });

  // Sokratik AI
  document.getElementById("socratic-form")?.addEventListener("submit", async function(e) {
    e.preventDefault();
    const input = document.getElementById("socratic-input");
    const text = (input?.value || "").trim();
    if (!text) return;

    const windowDiv = document.getElementById("socratic-dialogue-window");
    if (windowDiv) {
      windowDiv.insertAdjacentHTML("beforeend", `
        <div class="msg-bubble user-bubble" style="text-align: right; margin: 0.75rem 0;">
          <div style="background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); display: inline-block; padding: 0.6rem 1rem; border-radius: 8px;">
            <strong>Sen:</strong> ${text}
          </div>
        </div>
      `);
      windowDiv.scrollTop = windowDiv.scrollHeight;
    }
    input.value = "";

    let reply = "";
    try {
      const res = await fetch("/api/socratic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text })
      });
      if (res.ok) {
        const data = await res.json();
        reply = data.reply;
      }
    } catch (e) {}

    if (!reply) {
      reply = `"${text}" iddiası güçlü bir epistemolojik kabul barındırıyor. Peki bu düşüncenin doğru olduğunu kanıtlarken başvurduğun akıl yürütme kurallarının kendisinin güvenilir olduğunu nasıl temellendiriyorsun? Eğer tam tersi doğru olsaydı, varlığın nedensellik zincirinde ne değişirdi?`;
    }

    if (windowDiv) {
      windowDiv.insertAdjacentHTML("beforeend", `
        <div class="msg-bubble socrates-bubble" style="margin: 0.75rem 0;">
          <div style="background: var(--bg-surface-elevated, #1e293b); border-left: 3px solid #d4af37; padding: 0.8rem 1.2rem; border-radius: 8px;">
            <strong>Sokratik Filozof:</strong> ${reply}
          </div>
        </div>
      `);
      windowDiv.scrollTop = windowDiv.scrollHeight;
    }
  });
});
