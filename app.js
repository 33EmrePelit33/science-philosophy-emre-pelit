/* Science & Philosophy süzgeç + canlı Blogger eşitleme */
const SITE = "https://science-philosophy-emre-pelit.ai.studio";
const BLOGGER = "https://emrepelit7337.blogspot.com";
const LANG_NAME = { tr: "Türkçe", en: "English", de: "Deutsch", fr: "Français", es: "Español" };
const TOPIC_RULES = [
  ["Yapay Zeka", /llm|yapay zeka|artificial intelligence|chatgpt|othello|consciousness|bewusst/i],
  ["Zihin Felsefesi", /qualia|zihin|mind|chinese room|çin odası|mary|geist/i],
  ["Kuantum", /kuantum|quantum|dolanık|entangle|schrödinger|schrodinger/i],
  ["Kozmoloji", /big bang|büyük patlama|kozmolog|evren|universe|holograf|kosmos/i],
  ["Zaman", /zaman|time|entropi|entropy|zeit/i],
  ["Özgür İrade", /özgür irade|free will|determin|freier wille/i],
  ["Simülasyon", /simülasyon|simulation|simulacion/i],
  ["Kelâm", /kur'an|kuran|quran|allah|kelam|kelâm|ayet|coran/i],
  ["Etik", /etik|trolley|tramvay|ahlak|ethic/i]
];

let allPosts = [];
let selectedCategory = "all";
let selectedLang = "all";
let knownIds = new Set();

function slugify(title, id) {
  const map = { ç:"c", ğ:"g", ı:"i", ö:"o", ş:"s", ü:"u", â:"a", î:"i", û:"u" };
  const slug = String(title || "").toLowerCase()
    .replace(/[çğıöşüâîû]/g, ch => map[ch] || ch)
    .replace(/[^a-z0-9\s-]/g, "")
    .trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);
  return slug ? `${slug}-${id}` : `makale-${id}`;
}

function detectLang(title, text) {
  const sample = `${title} ${text.slice(0, 800)}`.toLowerCase();
  const scores = {
    tr: (sample.match(/[çğıöşü]/g) || []).length * 3,
    de: (sample.match(/[äöüß]/g) || []).length + (sample.match(/\b(und|der|die|das|nicht|ist)\b/g) || []).length,
    fr: (sample.match(/[éèêàùçœ]/g) || []).length + (sample.match(/\b(les|des|une|est|dans)\b/g) || []).length,
    es: (sample.match(/[ñ¿¡]/g) || []).length + (sample.match(/\b(los|las|una|que|por)\b/g) || []).length
  };
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (best[1] >= 3) return best[0];
  if (/\b(the|and|of|is|that)\b/.test(sample)) return "en";
  return "tr";
}

function plain(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return (div.textContent || "").replace(/\s+/g, " ").trim();
}

function filterHtml(raw) {
  const div = document.createElement("div");
  div.innerHTML = raw || "";
  div.querySelectorAll("script, style, noscript, iframe, form, button, svg").forEach(n => n.remove());
  div.querySelectorAll("*").forEach(el => {
    [...el.attributes].forEach(attr => {
      if (attr.name.startsWith("on") || attr.name === "style" || attr.name === "class") el.removeAttribute(attr.name);
    });
  });
  return div.innerHTML || "<p>İçerik süzgeçten boş döndü.</p>";
}

function adaptEntry(entry) {
  const id = ((entry.id && entry.id.$t) || "").split("post-").pop();
  const title = ((entry.title && entry.title.$t) || "Başlıksız").trim();
  const published = (entry.published && entry.published.$t) || new Date().toISOString();
  const updated = (entry.updated && entry.updated.$t) || published;
  const raw = (entry.content && entry.content.$t) || (entry.summary && entry.summary.$t) || "";
  const originalUrl = (entry.link || []).find(l => l.rel === "alternate")?.href || "";
  const labels = (entry.category || []).map(c => c.term).filter(Boolean);
  const content = filterHtml(raw);
  const text = plain(content);
  const wordCount = text ? text.split(" ").filter(Boolean).length : 0;
  const minutes = Math.max(1, Math.round(wordCount / 180) || 1);
  const language = detectLang(title, text);
  const categories = [...labels];
  const blob = `${title} ${text.slice(0, 500)}`;
  TOPIC_RULES.forEach(([name, pat]) => { if (pat.test(blob) && !categories.includes(name)) categories.push(name); });
  if (!categories.length) categories.push("Bilim & Felsefe");
  const claim = text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 320);
  const notProof = wordCount < 120
    ? "Kısa metin tek başına ampirik kanıt sayılmaz; iddia ile kanıt ayrılmalıdır."
    : (title.includes("?")
      ? "Başlığın soru formunda olması, sorunun olumlu yanıtını kanıtlamaz."
      : "Yazarın yorumu ve analojisi, kaynak gösterilmedikçe deneysel kanıt yerine geçmez.");
  return {
    id, title, slug: slugify(title, id), published, updated, language,
    languageName: LANG_NAME[language] || language,
    categories: categories.slice(0, 6), author: "Emre Pelit", originalUrl,
    wordCount, readingTime: `${minutes} dk`, readingMinutes: minutes,
    excerpt: text.slice(0, 180) + (text.length > 180 ? "…" : ""),
    claim, notProof, content
  };
}

function fetchJSONP(startIndex, maxResults) {
  return new Promise((resolve, reject) => {
    const callbackName = "blogger_cb_" + startIndex + "_" + Math.floor(Math.random() * 1e6);
    const script = document.createElement("script");
    const timer = setTimeout(() => { cleanup(); reject(new Error("Blogger zaman aşımı")); }, 12000);
    function cleanup() {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }
    window[callbackName] = data => { cleanup(); resolve(data); };
    script.src = `${BLOGGER}/feeds/posts/default?alt=json-in-script&callback=${callbackName}&start-index=${startIndex}&max-results=${maxResults}`;
    script.onerror = () => { cleanup(); reject(new Error("Blogger beslemesi yüklenemedi")); };
    document.head.appendChild(script);
  });
}

async function syncLive() {
  const status = document.getElementById("sync-status-indicator");
  if (status) status.textContent = "Blogger külliyatı süzgeçten geçiriliyor…";
  let start = 1;
  const remote = [];
  while (true) {
    const data = await fetchJSONP(start, 150);
    const entries = data?.feed?.entry || [];
    const total = parseInt(data?.feed?.openSearch$totalResults?.$t || "0", 10);
    entries.forEach(entry => remote.push(adaptEntry(entry)));
    if (!entries.length || remote.length >= total) break;
    start += entries.length;
  }
  remote.sort((a, b) => b.published.localeCompare(a.published));
  allPosts = remote;
  knownIds = new Set(allPosts.map(p => p.id));
  paint();
  if (status) status.textContent = `Süzgeç tamam: ${allPosts.length} makale yayında. Yeni Blogger yazısı bir dakika içinde buraya düşer.`;
}

async function pollNew() {
  try {
    const data = await fetchJSONP(1, 5);
    const entries = data?.feed?.entry || [];
    const fresh = entries.map(adaptEntry).filter(p => !knownIds.has(p.id));
    if (!fresh.length) return;
    allPosts = [...fresh, ...allPosts];
    fresh.forEach(p => knownIds.add(p.id));
    paint();
    const status = document.getElementById("sync-status-indicator");
    if (status) status.textContent = `Yeni yazı süzgeçten geçti: ${fresh[0].title}`;
  } catch (err) {
    console.warn(err);
  }
}

function updateCounters() {
  const count = allPosts.length;
  document.querySelectorAll("[data-counter='total-posts']").forEach(el => { el.textContent = count; });
  const words = allPosts.reduce((sum, p) => sum + (p.wordCount || 0), 0);
  const avg = count ? (allPosts.reduce((sum, p) => sum + p.readingMinutes, 0) / count).toFixed(1) : "0";
  const wordEl = document.getElementById("stat-total-words");
  const avgEl = document.getElementById("stat-avg-reading-time");
  if (wordEl) wordEl.textContent = words.toLocaleString("tr-TR");
  if (avgEl) avgEl.textContent = `${avg} dk`;
  const latest = allPosts[0];
  if (!latest) return;
  const title = document.getElementById("hero-latest-title");
  const date = document.getElementById("hero-latest-date");
  const read = document.getElementById("hero-latest-read");
  const index = document.getElementById("hero-latest-index");
  if (title) title.textContent = latest.title;
  if (date) date.textContent = latest.published.slice(0, 10);
  if (read) read.textContent = latest.readingTime;
  if (index) index.textContent = count;
  const flagTitle = document.getElementById("flagship-title");
  const flagLead = document.getElementById("flagship-lead");
  if (flagTitle) flagTitle.textContent = latest.title;
  if (flagLead) flagLead.textContent = latest.excerpt;
  const footer = document.getElementById("footer-post-count-desc");
  if (footer) footer.textContent = `Toplam ${count} bilim ve felsefe makalesi süzgeçten geçirilerek yayında.`;
}

function buildPills() {
  const cats = document.getElementById("category-filter-container");
  const langs = document.getElementById("lang-filter-container");
  if (!cats || !langs) return;
  const catCounts = {};
  allPosts.forEach(p => p.categories.forEach(c => { catCounts[c] = (catCounts[c] || 0) + 1; }));
  const top = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  cats.innerHTML = `<button class="category-pill ${selectedCategory === "all" ? "active" : ""}" data-cat="all">Tümü (${allPosts.length})</button>` +
    top.map(([cat, n]) => `<button class="category-pill ${selectedCategory === cat ? "active" : ""}" data-cat="${cat}">${cat} (${n})</button>`).join("");
  cats.querySelectorAll(".category-pill").forEach(btn => btn.onclick = () => {
    selectedCategory = btn.dataset.cat;
    buildPills();
    renderArticleGrid();
  });
  const langCounts = {};
  allPosts.forEach(p => { langCounts[p.language] = (langCounts[p.language] || 0) + 1; });
  langs.innerHTML = `<button class="lang-pill ${selectedLang === "all" ? "active" : ""}" data-lang="all">Tüm diller</button>` +
    Object.entries(langCounts).map(([lang, n]) => `<button class="lang-pill ${selectedLang === lang ? "active" : ""}" data-lang="${lang}">${LANG_NAME[lang] || lang} (${n})</button>`).join("");
  langs.querySelectorAll(".lang-pill").forEach(btn => btn.onclick = () => {
    selectedLang = btn.dataset.lang;
    buildPills();
    renderArticleGrid();
  });
}

function filteredPosts() {
  const q = (document.getElementById("article-search")?.value || "").toLowerCase();
  const sort = document.getElementById("sort-select")?.value || "date-desc";
  let list = allPosts.filter(p => {
    const text = `${p.title} ${p.excerpt} ${p.categories.join(" ")}`.toLowerCase();
    const okQ = !q || text.includes(q);
    const okC = selectedCategory === "all" || p.categories.includes(selectedCategory);
    const okL = selectedLang === "all" || p.language === selectedLang;
    return okQ && okC && okL;
  });
  if (sort === "date-asc") list.sort((a, b) => a.published.localeCompare(b.published));
  if (sort === "reading-time-desc") list.sort((a, b) => b.readingMinutes - a.readingMinutes);
  if (sort === "title-asc") list.sort((a, b) => a.title.localeCompare(b.title, "tr"));
  if (sort === "date-desc") list.sort((a, b) => b.published.localeCompare(a.published));
  return list;
}

function renderArticleGrid() {
  const grid = document.getElementById("article-grid");
  if (!grid) return;
  const list = filteredPosts();
  const badge = document.getElementById("search-count-badge");
  if (badge) badge.textContent = `${list.length} makale`;
  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:#94a3b8;">Bu süzgeçte makale yok.</p>`;
    return;
  }
  list.forEach(p => {
    const card = document.createElement("article");
    card.className = "article-card";
    card.innerHTML = `
      <div class="card-meta"><span>${p.readingTime}</span> · <span>${p.languageName}</span> · <span style="color:#60a5fa">${p.categories[0] || "Felsefe"}</span></div>
      <h3 class="card-title">${p.title}</h3>
      <p class="card-snippet">${p.excerpt}</p>
      <div class="card-footer">Oku →</div>`;
    card.onclick = () => openArticleModal(p);
    grid.appendChild(card);
  });
}

function openArticleModal(post) {
  document.getElementById("modal-article-title").textContent = post.title;
  document.getElementById("modal-article-meta").innerHTML = `${post.languageName} · ${post.readingTime} · ${post.wordCount} kelime · ${post.published.slice(0, 10)}`;
  document.getElementById("modal-article-content").innerHTML = `
    <div class="filter-card">
      <p><strong>Süzgeç:</strong> Blogger ham HTML'i temizlendi, dil ve konu ayrıldı, site yayınına alındı.</p>
      <p><strong>İddia özeti:</strong> ${post.claim || "—"}</p>
      <p><strong>Neyin kanıt olmadığı:</strong> ${post.notProof}</p>
      <p><a href="${post.originalUrl}" target="_blank" rel="noopener">Blogger kaynağı</a> · <a href="${SITE}/#makale/${post.slug}">Site bağlantısı</a></p>
    </div>
    <div class="article-clean-body">${post.content}</div>`;
  const modal = document.getElementById("article-modal");
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
  history.replaceState(null, "", `#makale/${post.slug}`);
}

function closeArticleModal() {
  document.getElementById("article-modal").style.display = "none";
  document.body.style.overflow = "";
  history.replaceState(null, "", "#kulliyat");
}

function paint() {
  updateCounters();
  buildPills();
  renderArticleGrid();
  const hash = location.hash || "";
  const slug = hash.startsWith("#makale/") ? decodeURIComponent(hash.slice(8)) : "";
  if (slug) {
    const post = allPosts.find(p => p.slug === slug || p.id === slug);
    if (post) openArticleModal(post);
  }
}

async function boot() {
  try {
    const res = await fetch("catalog.json");
    if (res.ok) {
      const catalog = await res.json();
      allPosts = catalog.posts || [];
      knownIds = new Set(allPosts.map(p => p.id));
      paint();
    }
  } catch (err) {
    console.warn("Yerel katalog okunamadı", err);
  }
  try { await syncLive(); } catch (err) {
    const status = document.getElementById("sync-status-indicator");
    if (status) status.textContent = allPosts.length
      ? `Canlı eşitlenemedi; süzgeç kataloğu yayında: ${allPosts.length} makale.`
      : "Blogger beslemesi alınamadı.";
  }
  setInterval(pollNew, 60000);
}

document.addEventListener("DOMContentLoaded", () => {
  boot();
  document.getElementById("article-search")?.addEventListener("input", renderArticleGrid);
  document.getElementById("sort-select")?.addEventListener("change", renderArticleGrid);
  document.getElementById("btn-force-sync")?.addEventListener("click", () => syncLive().catch(console.warn));
  document.getElementById("modal-close-btn")?.addEventListener("click", closeArticleModal);
  document.getElementById("hero-latest-btn")?.addEventListener("click", () => allPosts[0] && openArticleModal(allPosts[0]));
  document.querySelectorAll(".hook-pill").forEach(pill => pill.addEventListener("click", () => {
    const search = document.getElementById("article-search");
    search.value = pill.dataset.hook || "";
    renderArticleGrid();
    document.getElementById("kulliyat").scrollIntoView({ behavior: "smooth" });
  }));
  document.querySelectorAll(".choice-btn").forEach(btn => btn.addEventListener("click", () => {
    const card = btn.closest(".experiment-card");
    card.querySelectorAll(".choice-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    const box = card.querySelector(".experiment-analysis-box");
    if (box) box.style.display = "block";
  }));
  document.getElementById("socratic-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const input = document.getElementById("socratic-input");
    const text = input.value.trim();
    if (!text) return;
    const windowDiv = document.getElementById("socratic-dialogue-window");
    windowDiv.insertAdjacentHTML("beforeend", `
      <div class="msg-bubble"><strong>Sen:</strong> ${text}</div>
      <div class="msg-bubble"><strong>Sokratik Filozof:</strong> "${text}" iddiasının temeli nedir? Bu doğruysa, eylemlerimizin nedensellik zincirindeki özgürlüğünü nasıl temellendirirsin?</div>`);
    input.value = "";
    windowDiv.scrollTop = windowDiv.scrollHeight;
  });
});
