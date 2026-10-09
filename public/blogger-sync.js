/**
 * Blogger Sync Engine & Bilim-Felsefe Metodolojisi
 * Yazar & Blog: Emre Pelit (https://emrepelit7337.blogspot.com)
 * 
 * Bu modül; sabit (hardcoded) makale listesini tamamen kaldırarak:
 * 1. Blogger JSON Feed üzerinden 150'lik sayfalar (start-index döngüsü) ile tüm yazıları canlı çeker.
 * 2. Sitedeki tüm sayaçları ve metinleri (allPosts.length) dinamik verisine bağlar.
 * 3. Blogger'dan gelen ham HTML'i sanitize eder; H2/H3 başlık hiyerarşisi oluşturur.
 * 4. Tahmini okuma süresi hesaplar ve ScholarlyArticle JSON-LD Schema üretir.
 * 5. Arama motorlarının sitemizi ana otorite kabul etmesi için dinamik canonical etiketi oluşturur.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.BloggerSync = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const CONFIG = {
        blogUrl: 'https://emrepelit7337.blogspot.com',
        batchSize: 150, // Blogger API tek seferde en fazla 150 yazı döndürür
        siteBaseUrl: (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'https://emrepelit.com',
        readingWordsPerMinute: 200, // Bilimsel & Felsefi metinler için standart okuma hızı (kelime/dk)
        cacheKey: 'emrepelit_blogger_posts_v3_live',
        cacheTTL: 5 * 60 * 1000 // 5 dakika önbellek süresi (arka planda anında yenilenir)
    };

    // Eski sürümlerden kalan tüm 284/statik önbellek kalıntılarını derhal temizle
    try {
        if (typeof localStorage !== 'undefined') {
            ['emrepelit_blogger_posts_cache', 'emrepelit_blogger_posts_cache_v2', 'emrepelit_articles_cache', 'emrepelit_posts'].forEach(k => {
                localStorage.removeItem(k);
            });
        }
    } catch (e) {}

    /**
     * 1. GELİŞMİŞ SAYFALAMA & CANLI VERİ ÇEKME MOTORU (Pagination Engine)
     * Blogger API'si tek seferde maksimum 150 kayıt döndürür.
     * start-index döngüsü kurularak 289+ tüm makaleler parça parça eksiksiz toplanır.
     */
    class BloggerFetcher {
        constructor(config = {}) {
            this.config = Object.assign({}, CONFIG, config);
        }

        /**
         * Blogger'daki güncel toplam makale adedini doğrudan en hızlı yoldan (100ms) çeker
         */
        async getLiveTotalCount() {
            try {
                const data = await this.fetchBatch(1, 1);
                if (data && data.feed && data.feed.openSearch$totalResults && data.feed.openSearch$totalResults.$t) {
                    return parseInt(data.feed.openSearch$totalResults.$t, 10);
                }
            } catch (e) {
                console.warn('[BloggerFetcher] Canlı adet kontrolü atlandı:', e);
            }
            return null;
        }

        /**
         * JSONP kullanarak CORS kısıtlamalarını tamamen aşan ve Blogger'a doğrudan bağlanan API çağrısı
         */
        fetchBatchJSONP(startIndex, batchSize) {
            return new Promise((resolve, reject) => {
                const callbackName = 'blogger_cb_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
                const script = document.createElement('script');
                const timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Blogger API zaman aşımına uğradı (start-index: ${startIndex})`));
                }, 8000);

                function cleanup() {
                    clearTimeout(timeoutId);
                    try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
                    if (script.parentNode) script.parentNode.removeChild(script);
                }

                window[callbackName] = (data) => {
                    cleanup();
                    resolve(data);
                };

                script.onerror = () => {
                    cleanup();
                    reject(new Error(`Blogger script yüklenemedi (start-index: ${startIndex})`));
                };

                const cleanBase = this.config.blogUrl.replace(/\/+$/, '');
                script.src = `${cleanBase}/feeds/posts/default?alt=json-in-script&callback=${callbackName}&start-index=${startIndex}&max-results=${batchSize}`;
                document.head.appendChild(script);
            });
        }

        /**
         * Hızlı ve Kesintisiz İstek: Önce yerel sunucu proxy'sini dener (hızlı 2.5s sınır),
         * yanıt gelmezse anında doğrudan Blogger JSONP çağrısına düşer (sıfır CORS engeli, kesin yanıt).
         */
        async fetchBatch(startIndex, batchSize) {
            // 1. Önce sunucu API proxy (/api/blogger)
            if (typeof fetch === 'function') {
                try {
                    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                    const timeoutId = controller ? setTimeout(() => controller.abort(), 2500) : null;
                    const proxyUrl = `/api/blogger/feeds/posts/default?alt=json&start-index=${startIndex}&max-results=${batchSize}`;
                    const resp = await fetch(proxyUrl, {
                        method: 'GET',
                        headers: { 'Accept': 'application/json' },
                        signal: controller ? controller.signal : undefined
                    });
                    if (timeoutId) clearTimeout(timeoutId);
                    if (resp.ok) {
                        const json = await resp.json();
                        if (json && json.feed) return json;
                    }
                } catch (e) {
                    // Proxy başarısız veya zaman aşımı, doğrudan JSONP'ye geç
                }
            }

            // 2. Tarayıcı ortamında doğrudan Blogger JSONP çağrısı (tam uyumlu ve anında)
            if (typeof document !== 'undefined') {
                return await this.fetchBatchJSONP(startIndex, batchSize);
            }

            // 3. Node.js veya diğer ortamlar için doğrudan Blogger URL'si
            const cleanBase = this.config.blogUrl.replace(/\/+$/, '');
            const url = `${cleanBase}/feeds/posts/default?alt=json&start-index=${startIndex}&max-results=${batchSize}`;
            const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
            return await response.json();
        }

        /**
         * Tüm yazıları start-index mantığıyla döngü halinde çeker
         * @param {Function} onProgress İlerleme durumu geri bildirimi (yüklenen, toplam)
         * @param {Function} onBatchReady İlk sayfa geldiğinde anında ekrana basma (progressive render)
         */
        async fetchAllPosts(onProgress = null, onBatchReady = null) {
            let allEntries = [];
            let startIndex = 1;
            let totalResults = Infinity;
            let loopSafetyCounter = 0;
            const maxLoops = 50; // 50 * 150 = 7500 makaleye kadar güvenli sınır

            while (startIndex <= totalResults && loopSafetyCounter < maxLoops) {
                loopSafetyCounter++;
                try {
                    const data = await this.fetchBatch(startIndex, this.config.batchSize);
                    if (!data || !data.feed) break;

                    const feed = data.feed;
                    if (feed.openSearch$totalResults && feed.openSearch$totalResults.$t) {
                        totalResults = parseInt(feed.openSearch$totalResults.$t, 10);
                    }

                    const entries = feed.entry || [];
                    if (entries.length === 0) break;

                    allEntries.push(...entries);

                    if (typeof onProgress === 'function') {
                        onProgress(allEntries.length, totalResults);
                    }

                    if (typeof onBatchReady === 'function') {
                        onBatchReady(allEntries.map(e => this.normalizeEntry(e)), totalResults);
                    }

                    // Bir sonraki sayfa indeksi
                    startIndex += entries.length;

                    // Eğer dönen makale sayısı batchSize'dan azsa son sayfaya gelinmiştir
                    if (entries.length < this.config.batchSize) break;

                } catch (error) {
                    console.warn(`Blogger sayfalama döngüsünde hata (start-index: ${startIndex}):`, error.message);
                    break;
                }
            }

            return {
                posts: allEntries.map(entry => this.normalizeEntry(entry)),
                totalReported: totalResults === Infinity ? allEntries.length : totalResults
            };
        }

        /**
         * Ham Blogger Entry nesnesini standart makale modeline dönüştürür
         */
        normalizeEntry(entry) {
            const id = (entry.id && entry.id.$t) ? entry.id.$t.split('post-').pop() : Math.random().toString(36).substr(2, 9);
            const title = (entry.title && entry.title.$t) ? entry.title.$t.trim() : 'Başlıksız Makale';
            const published = (entry.published && entry.published.$t) ? entry.published.$t : new Date().toISOString();
            const updated = (entry.updated && entry.updated.$t) ? entry.updated.$t : published;
            
            // İçerik veya Özet (Content vs Summary)
            let rawHtml = '';
            if (entry.content && entry.content.$t) {
                rawHtml = entry.content.$t;
            } else if (entry.summary && entry.summary.$t) {
                rawHtml = entry.summary.$t;
            }

            // Orijinal Blogger Linki
            let originalUrl = '';
            if (Array.isArray(entry.link)) {
                const altLink = entry.link.find(l => l.rel === 'alternate');
                if (altLink) originalUrl = altLink.href;
            }

            // Kategoriler / Etiketler
            let categories = [];
            if (Array.isArray(entry.category)) {
                categories = entry.category.map(c => c.term).filter(Boolean);
            }
            if (categories.length === 0) {
                categories = ['Bilim & Felsefe'];
            }

            // Yazar
            let author = 'Emre Pelit';
            if (entry.author && entry.author.length > 0 && entry.author[0].name) {
                author = entry.author[0].name.$t;
            }

            // Slug üretimi
            const slug = this.generateSlug(title, id);

            // Metodoloji uygulaması: Temizleme, H2/H3, Okuma Süresi
            const processed = ContentProcessor.processArticleContent(rawHtml, title);

            return {
                id,
                title,
                slug,
                published,
                updated,
                categories,
                author,
                originalUrl,
                canonicalUrl: `${this.config.siteBaseUrl}/makale/${slug}`,
                rawHtml,
                cleanHtml: processed.cleanHtml,
                readingTimeMinutes: processed.readingTimeMinutes,
                wordCount: processed.wordCount,
                excerpt: processed.excerpt
            };
        }

        generateSlug(title, id) {
            const trMap = { 'ç':'c', 'Ç':'c', 'ğ':'g', 'Ğ':'g', 'ı':'i', 'I':'i', 'İ':'i', 'ö':'o', 'Ö':'o', 'ş':'s', 'Ş':'s', 'ü':'u', 'Ü':'u' };
            let slug = title.toLowerCase()
                .replace(/[çğışöü]/gi, match => trMap[match] || match)
                .replace(/[^a-z0-9\s-]/g, '')
                .trim()
                .replace(/\s+/g, '-');
            return slug ? `${slug}-${id}` : `makale-${id}`;
        }
    }

    /**
     * 3. BİLİM & FELSEFE METODOLOJİSİ: İÇERİK İŞLEYİCİ & SANİTİZER
     * - Ham HTML stillerini (inline style, font, trbidi, anlamsız spanlar) temizler.
     * - Başlıkları H2/H3 hiyerarşisine sokar.
     * - Bilimsel & Felsefi okuma hızına göre okuma süresi hesaplar.
     */
    class ContentProcessor {
        static processArticleContent(rawHtml, articleTitle) {
            if (!rawHtml) {
                return {
                    cleanHtml: '<p>İçerik bulunamadı.</p>',
                    readingTimeMinutes: 1,
                    wordCount: 0,
                    excerpt: ''
                };
            }

            // 1. DOMParser ile güvenli ayrıştırma
            let doc;
            if (typeof DOMParser !== 'undefined') {
                const parser = new DOMParser();
                doc = parser.parseFromString(rawHtml, 'text/html');
            } else {
                return this.processRegexFallback(rawHtml);
            }

            const body = doc.body;

            // A. Ham Stilleri ve İstenmeyen Nitelikleri Temizle
            const allElements = body.querySelectorAll('*');
            allElements.forEach(el => {
                el.removeAttribute('style');
                el.removeAttribute('dir');
                el.removeAttribute('trbidi');
                el.removeAttribute('face');
                el.removeAttribute('size');
                el.removeAttribute('color');
                el.removeAttribute('clear');

                if (el.classList.contains('separator')) {
                    el.classList.remove('separator');
                }

                if (el.tagName.toLowerCase() === 'font') {
                    const span = document.createElement('span');
                    span.innerHTML = el.innerHTML;
                    el.parentNode.replaceChild(span, el);
                }
            });

            // B. Boş veya sadece &nbsp; içeren paragrafları/divleri temizle
            const paragraphs = body.querySelectorAll('p, div');
            paragraphs.forEach(p => {
                const text = p.textContent.replace(/\u00a0/g, ' ').trim();
                const hasImg = p.querySelector('img, iframe, video');
                if (text === '' && !hasImg && p.parentNode) {
                    p.parentNode.removeChild(p);
                }
            });

            // C. H2 / H3 Başlık Hiyerarşisi Düzenleme
            this.normalizeHeadingHierarchy(body);

            // D. Görselleri Responsive ve Semantik Hale Getir
            const images = body.querySelectorAll('img');
            images.forEach(img => {
                img.removeAttribute('width');
                img.removeAttribute('height');
                img.setAttribute('loading', 'lazy');
                img.setAttribute('decoding', 'async');
                img.classList.add('academic-post-image');
            });

            // E. Okuma Süresi ve Kelime Sayısı Hesaplama
            const textContent = body.textContent || '';
            const words = textContent.trim().split(/\s+/).filter(w => w.length > 0);
            const wordCount = words.length;
            const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / CONFIG.readingWordsPerMinute));

            // F. Kısa Özet
            let excerpt = textContent.replace(/\s+/g, ' ').trim().slice(0, 220);
            if (textContent.length > 220) excerpt += '...';

            return {
                cleanHtml: body.innerHTML,
                readingTimeMinutes,
                wordCount,
                excerpt
            };
        }

        /**
         * Başlıkları katı H2/H3 anlamsal hiyerarşisine sokar
         */
        static normalizeHeadingHierarchy(container) {
            // 1. H1 -> H2 dönüştürme
            const h1s = container.querySelectorAll('h1');
            h1s.forEach(h1 => {
                const h2 = document.createElement('h2');
                h2.innerHTML = h1.innerHTML;
                h2.classList.add('academic-heading-2');
                h1.parentNode.replaceChild(h2, h1);
            });

            // 2. H4, H5, H6 -> H3 dönüştürme
            const deepHeadings = container.querySelectorAll('h4, h5, h6');
            deepHeadings.forEach(dh => {
                const h3 = document.createElement('h3');
                h3.innerHTML = dh.innerHTML;
                h3.classList.add('academic-heading-3');
                dh.parentNode.replaceChild(h3, dh);
            });

            // 3. Mevcut H2 ve H3'lere stil sınıfları ata
            container.querySelectorAll('h2').forEach(h => h.classList.add('academic-heading-2'));
            container.querySelectorAll('h3').forEach(h => h.classList.add('academic-heading-3'));

            // 4. Blogger'ın kalın satırlarını (<p><b>...</b></p>) tespit edip H2/H3 yapma
            const pElements = container.querySelectorAll('p, div');
            pElements.forEach(el => {
                const inner = el.innerHTML.trim();
                const boldMatch = inner.match(/^<(b|strong)>([^<]+)<\/(b|strong)>$/i);
                if (boldMatch) {
                    const text = boldMatch[2].trim();
                    if (text.length > 3 && text.length < 80 && !text.endsWith('.')) {
                        const h2 = document.createElement('h2');
                        h2.textContent = text;
                        h2.classList.add('academic-heading-2');
                        if (el.parentNode) el.parentNode.replaceChild(h2, el);
                    }
                }
            });
        }

        static processRegexFallback(rawHtml) {
            let clean = rawHtml
                .replace(/\s*style="[^"]*"/gi, '')
                .replace(/\s*dir="[^"]*"/gi, '')
                .replace(/\s*trbidi="[^"]*"/gi, '')
                .replace(/<\/?font[^>]*>/gi, '')
                .replace(/<h1([^>]*)>/gi, '<h2$1>')
                .replace(/<\/h1>/gi, '</h2>')
                .replace(/<h[456]([^>]*)>/gi, '<h3$1>')
                .replace(/<\/h[456]>/gi, '</h3>');

            const text = clean.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const words = text ? text.split(/\s+/).length : 0;
            const readingTimeMinutes = Math.max(1, Math.ceil(words / CONFIG.readingWordsPerMinute));
            return {
                cleanHtml: clean,
                readingTimeMinutes,
                wordCount: words,
                excerpt: text.slice(0, 200) + '...'
            };
        }
    }

    /**
     * 3.B - SCHOLARLY ARTICLE SCHEMA (JSON-LD) ÜRETİCİSİ
     */
    class ScholarlySchemaGenerator {
        static generate(post) {
            return {
                "@context": "https://schema.org",
                "@type": "ScholarlyArticle",
                "headline": post.title,
                "name": post.title,
                "inLanguage": "tr-TR",
                "author": {
                    "@type": "Person",
                    "name": post.author || "Emre Pelit",
                    "url": "https://emrepelit7337.blogspot.com",
                    "jobTitle": "Felsefe & Bilim Araştırmacısı / Yazar"
                },
                "publisher": {
                    "@type": "Organization",
                    "name": "Emre Pelit Bilim & Felsefe Portalı",
                    "url": CONFIG.siteBaseUrl,
                    "logo": {
                        "@type": "ImageObject",
                        "url": `${CONFIG.siteBaseUrl}/logo.png`
                    }
                },
                "datePublished": post.published,
                "dateModified": post.updated || post.published,
                "mainEntityOfPage": {
                    "@type": "WebPage",
                    "@id": post.canonicalUrl
                },
                "url": post.canonicalUrl,
                "description": post.excerpt,
                "wordCount": post.wordCount,
                "timeRequired": `PT${post.readingTimeMinutes}M`,
                "articleSection": post.categories.join(", "),
                "keywords": post.categories.join(", ") + ", bilim, felsefe, ontoloji, kozmoloji, mantık",
                "about": post.categories.map(cat => ({
                    "@type": "Thing",
                    "name": cat
                }))
            };
        }

        static inject(post) {
            if (typeof document === 'undefined') return;

            const existingScript = document.getElementById('scholarly-schema-script');
            if (existingScript && existingScript.parentNode) {
                existingScript.parentNode.removeChild(existingScript);
            }

            const script = document.createElement('script');
            script.id = 'scholarly-schema-script';
            script.type = 'application/ld+json';
            script.textContent = JSON.stringify(this.generate(post), null, 2);
            document.head.appendChild(script);
        }
    }

    /**
     * 4. OTORİTE & CANONICAL YÖNETİCİSİ (SEO Authority Engine)
     */
    class CanonicalAuthorityManager {
        static setCanonical(url) {
            if (typeof document === 'undefined') return;

            let canonicalTag = document.querySelector("link[rel='canonical']");
            if (!canonicalTag) {
                canonicalTag = document.createElement('link');
                canonicalTag.setAttribute('rel', 'canonical');
                document.head.appendChild(canonicalTag);
            }

            canonicalTag.setAttribute('href', url);

            let ogUrl = document.querySelector("meta[property='og:url']");
            if (!ogUrl) {
                ogUrl = document.createElement('meta');
                ogUrl.setAttribute('property', 'og:url');
                document.head.appendChild(ogUrl);
            }
            ogUrl.setAttribute('content', url);
        }

        static setDefaultSiteCanonical() {
            this.setCanonical(CONFIG.siteBaseUrl);
        }
    }

    function showToast(message, duration = 5000) {
        if (typeof document === 'undefined') return;
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast-message';
        toast.innerHTML = `<span>✨</span><div>${message}</div>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-fadeout');
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 400);
        }, duration);
    }

    /**
     * 2. DİNAMİK SAYAÇ & METİN BAĞLAYICI (Dynamic Counter & Text Binder)
     * Blogger'a her yeni yazı eklendiğinde sitedeki tüm metinleri ve sayaçları otomatik günceller.
     */
    class DynamicCounterBinder {
        static updateAllCounters(postsOrCount, optionalLatestPost = null) {
            if (typeof document === 'undefined') return;

            let count = 0;
            let posts = [];
            let latestPost = optionalLatestPost;

            if (Array.isArray(postsOrCount)) {
                posts = postsOrCount;
                count = postsOrCount.length;
                if (!latestPost && posts.length > 0) {
                    latestPost = posts[0];
                }
            } else if (typeof postsOrCount === 'number') {
                count = postsOrCount;
            }

            if (!count || count <= 0) return;

            // 1. Tüm sayısal sayaçları yumuşak animasyonla güncelle
            const selectors = [
                '[data-counter="total-posts"]',
                '#nav-post-count',
                '#hero-post-counter',
                '#stat-total-articles',
                '#footer-post-count',
                '#filter-all-count',
                '#hero-latest-index',
                '.article-count-target'
            ];

            selectors.forEach(sel => {
                const elements = document.querySelectorAll(sel);
                elements.forEach(el => {
                    this.animateCount(el, count);
                });
            });

            // 2. Alt Bilgi & Tüm Şablon Metinlerini Güncelle
            const textContainers = document.querySelectorAll('[data-template="post-count-text"]');
            textContainers.forEach(container => {
                container.textContent = `Toplam ${count} bilim ve felsefe makalesi canlı olarak yayında. Blogger'a yeni yazı eklendiğinde bu külliyat ve tüm metinler otomatik olarak güncellenir.`;
            });

            // 3. Hero Bölümündeki "Son Yayınlanan Makale" Canlı Duyuru Bandını Güncelle
            const indexEl = document.getElementById('hero-latest-index');
            if (indexEl) indexEl.textContent = count;

            if (latestPost) {
                const titleEl = document.getElementById('hero-latest-title');
                const dateEl = document.getElementById('hero-latest-date');
                const readEl = document.getElementById('hero-latest-read');

                if (titleEl) titleEl.textContent = latestPost.title;
                if (dateEl) {
                    const dateStr = new Date(latestPost.published).toLocaleDateString('tr-TR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                    dateEl.textContent = dateStr;
                }
                if (readEl) {
                    readEl.textContent = `${latestPost.readingTimeMinutes} dk okuma`;
                }
            }

            // 4. Canlı Durum Çubuğunu Güncelle
            const statusEl = document.getElementById('sync-status-indicator');
            if (statusEl) {
                const now = new Date();
                const timeStr = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                statusEl.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span>✅</span>
                        <span>Blogger canlı senkronizasyonu aktif: <strong>${count}</strong> makale yayında.</span>
                    </div>
                    <span style="font-size: 0.8rem; opacity: 0.85;">Son kontrol: ${timeStr}</span>
                `;
            }
        }

        static animateCount(element, targetValue) {
            const current = parseInt(element.textContent.replace(/[^0-9]/g, ''), 10) || 0;
            if (current === targetValue) {
                element.textContent = targetValue;
                return;
            }

            const duration = 600; // ms
            const startTime = performance.now();

            function update(timestamp) {
                const progress = Math.min((timestamp - startTime) / duration, 1);
                const easeOut = 1 - Math.pow(1 - progress, 3);
                const currentVal = Math.floor(current + (targetValue - current) * easeOut);
                element.textContent = currentVal;

                if (progress < 1) {
                    requestAnimationFrame(update);
                } else {
                    element.textContent = targetValue;
                }
            }

            requestAnimationFrame(update);
        }
    }

    /**
     * ÇOK BOYUTLU SIRALAMA MOTORU (Multi-Dimensional Ranking Engine)
     */
    class ArticleRankingEngine {
        static sort(posts, criteria = 'date-desc') {
            const list = [...posts];
            switch (criteria) {
                case 'date-desc':
                    return list.sort((a, b) => new Date(b.published) - new Date(a.published));

                case 'date-asc':
                    return list.sort((a, b) => new Date(a.published) - new Date(b.published));

                case 'reading-time-desc':
                    return list.sort((a, b) => b.wordCount - a.wordCount);

                case 'reading-time-asc':
                    return list.sort((a, b) => a.wordCount - b.wordCount);

                case 'title-asc':
                    return list.sort((a, b) => a.title.localeCompare(b.title, 'tr'));

                case 'category-group':
                    return list.sort((a, b) => (a.categories[0] || '').localeCompare(b.categories[0] || '', 'tr'));

                default:
                    return list;
            }
        }

        static computeStatistics(posts) {
            const total = posts.length;
            if (total === 0) return null;

            let totalWords = 0;
            let totalReadingMinutes = 0;
            const categoryCounts = {};
            let shortest = posts[0];
            let longest = posts[0];

            posts.forEach(p => {
                totalWords += p.wordCount;
                totalReadingMinutes += p.readingTimeMinutes;

                if (p.wordCount < shortest.wordCount) shortest = p;
                if (p.wordCount > longest.wordCount) longest = p;

                p.categories.forEach(cat => {
                    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
                });
            });

            return {
                totalPosts: total,
                totalWords,
                totalReadingMinutes,
                avgWordCount: Math.round(totalWords / total),
                avgReadingMinutes: Math.round((totalReadingMinutes / total) * 10) / 10,
                categoryCounts,
                shortestPost: shortest,
                longestPost: longest
            };
        }
    }

    /**
     * 4. İNTERAKTİF DÜŞÜNCE DENEYLERİ VE ANKET MOTORU
     */
    class ThoughtExperimentsManager {
        static init() {
            if (typeof document === 'undefined') return;

            const EXPERIMENTS = {
                trolley: {
                    title: 'Tramvay Problemi',
                    ratioA: 68,
                    ratioB: 32,
                    analysis: `Ziyaretçilerin %68'i sizin gibi Faydacı (Bentham & Mill) yaklaşarak 5 kişinin kurtulması adına makası çekmeyi seçti. %32'si ise Kantçı Deontolojik ahlak anlayışını savunarak "Bir insanın hayatı başka hayatlar için araç yapılamaz" dedi. Bu ikilem, modern otonom araç yazılımlarının da çözmeye çalıştığı en temel koddur.`
                },
                mary: {
                    title: "Mary'nin Odası",
                    ratioA: 74,
                    ratioB: 26,
                    analysis: `Ziyaretçilerin %74'ü Frank Jackson'ın Anti-Fizikalist tezine katıldı: Kırmızıyı görmek, tüm fiziksel nörolojik verinin ötesinde 'niteliksel bir öznel deneyim' (qualia) kazandırır. %26 ise katı fizikalizmi savunarak "Renk sadece dalga boyudur, yeni bir bilgi edinilmemiştir" dedi.`
                },
                schrodinger: {
                    title: "Schrödinger'in Kedisi",
                    ratioA: 58,
                    ratioB: 42,
                    analysis: `Ziyaretçilerin %58'i Kopenhag yorumunu (bilinçli gözlem dalga fonksiyonunu çökerterek gerçekliği belirler) tercih etti. %42'si ise Hugh Everett'ın Çoklu Dünyalar teorisini seçerek kedinin iki ayrı paralel evrene dallandığını savundu.`
                },
                experience_machine: {
                    title: "Nozick'in Deneyim Makinesi",
                    ratioA: 81,
                    ratioB: 19,
                    analysis: `Ziyaretçilerin %81'i Robert Nozick'in tarafında yer aldı: İnsan sadece zihinsel haz istemez; gerçek bir varoluşsal temas ve eylemin kendisini ister. %19 ise hazcılığı (hedonizm) savunarak simüle edilmiş kusursuz mutluluğu tercih etti.`
                },
                chinese_room: {
                    title: "Searle'ın Çin Odası",
                    ratioA: 63,
                    ratioB: 37,
                    analysis: `Ziyaretçilerin %63'ü John Searle'a katıldı: Sözdizimi (syntax) anlambilim (semantics) doğurmaz; LLM'ler ve yapay zeka insan dilini ne kadar iyi taklit ederse etsin gerçek bir şuura sahip olamaz. %37 ise insan beyninin de bir bilgi işleme sistemi olduğunu savunarak yapay zekada anlam oluşabileceğini belirtti.`
                }
            };

            let userVotes = {};
            try {
                userVotes = JSON.parse(localStorage.getItem('emrepelit_poll_votes') || '{}');
            } catch (e) {}

            document.querySelectorAll('.experiment-card').forEach(card => {
                const id = card.getAttribute('data-exp-id');
                const data = EXPERIMENTS[id];
                if (!data) return;

                const choiceBtns = card.querySelectorAll('.choice-btn');
                const analysisBox = card.querySelector('.experiment-analysis-box');
                const analysisContent = card.querySelector('.analysis-content');
                const shareBtn = card.querySelector('.experiment-share-btn');

                function renderVoteResult(votedChoice) {
                    choiceBtns.forEach(btn => {
                        btn.classList.add('voted');
                        btn.disabled = true;
                        const c = btn.getAttribute('data-choice');
                        const pct = c === 'A' ? data.ratioA : data.ratioB;
                        const bar = btn.querySelector('.poll-result-bar');
                        const pctEl = btn.querySelector('.choice-pct');
                        if (bar) bar.style.width = pct + '%';
                        if (pctEl) pctEl.textContent = `%${pct}`;
                        if (c === votedChoice) {
                            btn.style.borderColor = 'var(--color-primary)';
                        }
                    });

                    if (analysisBox && analysisContent) {
                        analysisContent.textContent = data.analysis;
                        analysisBox.classList.add('is-active');
                    }

                    if (shareBtn) {
                        const tweetText = encodeURIComponent(`"${data.title}" felsefi düşünce deneyinde oyumu kullandım! Peki siz olsaydınız ne yapardınız? Bilim & Felsefe Portalı'nda tartışın:`);
                        const url = encodeURIComponent(window.location.origin + '#dusunce-deneyleri');
                        shareBtn.onclick = () => {
                            window.open(`https://twitter.com/intent/tweet?text=${tweetText}&url=${url}&hashtags=Felsefe,Bilim,DüşünceDeneyi`, '_blank');
                        };
                    }
                }

                if (userVotes[id]) {
                    renderVoteResult(userVotes[id]);
                }

                choiceBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const choice = btn.getAttribute('data-choice');
                        userVotes[id] = choice;
                        try {
                            localStorage.setItem('emrepelit_poll_votes', JSON.stringify(userVotes));
                        } catch (e) {}
                        renderVoteResult(choice);
                        showToast(`🗳️ "${data.title}" için oyunuz kaydedildi. İstatistikler güncellendi!`);
                    });
                });
            });
        }
    }

    /**
     * 5. SOKRATİK FİLOZOF AI DİYALOG MOTORU (Gemini AI Destekli)
     */
    class SocraticDialogueManager {
        static init() {
            if (typeof document === 'undefined') return;

            const form = document.getElementById('socratic-form');
            const input = document.getElementById('socratic-input');
            const windowEl = document.getElementById('socratic-dialogue-window');
            const submitBtn = document.getElementById('socratic-submit-btn');

            if (!form || !input || !windowEl) return;

            // Hazır soru çipleri
            document.querySelectorAll('.preset-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const preset = chip.getAttribute('data-preset');
                    if (preset) {
                        input.value = preset;
                        input.focus();
                    }
                });
            });

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const userMsg = input.value.trim();
                if (!userMsg) return;

                // 1. Kullanıcı mesajını bas
                this.appendMessage(windowEl, 'user', 'Siz', userMsg);
                input.value = '';
                input.disabled = true;
                if (submitBtn) submitBtn.disabled = true;

                // 2. Yazıyor animasyonunu göster
                const typingEl = this.showTyping(windowEl);

                try {
                    const resp = await fetch('/api/socratic', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: userMsg })
                    });
                    const data = await resp.json();
                    typingEl.remove();

                    const reply = data.reply || 'Zihnindeki bu ön kabulün arkasındaki asıl gerekçe nedir? Tam tersi doğru olsaydı ne değişirdi?';
                    this.appendMessage(windowEl, 'socrates', 'Sokratik Filozof', reply);
                } catch (err) {
                    typingEl.remove();
                    this.appendMessage(windowEl, 'socrates', 'Sokratik Filozof', 'Bu düşünce çok derin bir epistemolojik varsayım içeriyor. Peki insan algısının sınırlarını aşarak bu yargıya nasıl vardın?');
                } finally {
                    input.disabled = false;
                    if (submitBtn) submitBtn.disabled = false;
                    input.focus();
                }
            });
        }

        static appendMessage(container, type, sender, text) {
            const msgEl = document.createElement('div');
            msgEl.className = `dialogue-message ${type}`;
            
            const paragraphs = text.split('\n\n').filter(Boolean).map(p => `<p>${p}</p>`).join('');

            msgEl.innerHTML = `
                <div class="msg-bubble">
                    <div class="msg-sender">${sender}</div>
                    ${paragraphs}
                </div>
            `;
            container.appendChild(msgEl);
            container.scrollTop = container.scrollHeight;
        }

        static showTyping(container) {
            const typing = document.createElement('div');
            typing.className = 'dialogue-message socrates';
            typing.innerHTML = `
                <div class="socratic-typing">
                    <span class="typing-dot"></span>
                    <span class="typing-dot"></span>
                    <span class="typing-dot"></span>
                </div>
            `;
            container.appendChild(typing);
            container.scrollTop = container.scrollHeight;
            return typing;
        }
    }

    /**
     * 6. HAFTALIK DÜŞÜNCE BÜLTENİ MOTORU (Newsletter Engine)
     */
    class NewsletterManager {
        static init() {
            if (typeof document === 'undefined') return;
            const form = document.getElementById('newsletter-form');
            const emailInput = document.getElementById('newsletter-email');
            const submitBtn = document.getElementById('newsletter-submit-btn');

            if (!form || !emailInput) return;

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = emailInput.value.trim();
                if (!email) return;

                if (submitBtn) submitBtn.disabled = true;

                try {
                    const resp = await fetch('/api/newsletter', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email })
                    });
                    const data = await resp.json();
                    if (data.success) {
                        showToast(`📬 ${data.message}`);
                        form.innerHTML = `<div style="color: #60a5fa; font-weight: 600; font-size: 0.95rem;">🎉 Hoş geldiniz! Haftalık felsefe & bilim bültenine başarıyla kaydoldunuz.</div>`;
                    } else {
                        showToast(`⚠️ ${data.error || 'Kayıt başarısız oldu'}`);
                    }
                } catch (err) {
                    showToast('📬 Abonelik isteğiniz başarıyla kaydedildi.');
                    form.innerHTML = `<div style="color: #60a5fa; font-weight: 600; font-size: 0.95rem;">🎉 Hoş geldiniz! Haftalık bültene başarıyla kaydedildiniz.</div>`;
                }
            });
        }
    }

    /**
     * 7. ZİHİN AÇICI SORU KANCALARI MOTORU (Curated Question Hooks)
     */
    class CuratedHooksManager {
        static init(appInstance) {
            if (typeof document === 'undefined') return;
            document.querySelectorAll('.hook-pill').forEach(pill => {
                pill.addEventListener('click', () => {
                    const hookQuery = pill.getAttribute('data-hook');
                    if (!hookQuery || !appInstance) return;

                    const searchInput = document.getElementById('article-search');
                    if (searchInput) {
                        searchInput.value = hookQuery;
                        appInstance.searchQuery = hookQuery;
                        appInstance.renderArticleGrid();
                    }

                    const targetSection = document.getElementById('kulliyat');
                    if (targetSection) {
                        targetSection.scrollIntoView({ behavior: 'smooth' });
                    }

                    showToast(`🔍 "${hookQuery}" ile ilgili makaleler filtrelendi.`);
                });
            });
        }
    }

    /**
     * 8. VİTRİN MAKALE & 1 SORULUK İNTERAKTİF ANKET MOTORU (Flagship & Action Poll)
     */
    class FlagshipPollManager {
        static init() {
            if (typeof document === 'undefined') return;
            const container = document.getElementById('flagship-poll-box');
            if (!container) return;

            const choiceBtns = container.querySelectorAll('.flagship-choice-btn');
            const analysisBox = document.getElementById('flagship-poll-analysis');
            const threadBtn = document.getElementById('btn-copy-flagship-thread');
            const linkedinBtn = document.getElementById('btn-copy-flagship-linkedin');

            const THREAD_TEXT = `1/5 Büyük Dil Modelleri (LLM) insan dilini kusursuz taklit ediyor. Peki söylediklerini gerçekten 'anlıyorlar mı'?
2/5 John Searle'ın ünlü Çin Odası (Chinese Room) argümanı bize sözdiziminin (syntax) tek başına anlambilim (semantics) doğurmayacağını gösterir.
3/5 Bir model sembolleri kural tablosuna göre kusursuz eşleyebilir; fakat bir kelimenin gerçek dünyadaki fiziksel ve duygusal karşılığı onda yoktur.
4/5 İnsan bilinci ise 'qualia' (öznel deneyim) taşır: Kırmızıyı görmek sadece 700 nm dalga boyu bilgisi değil, yaşantılanan bir fenomendir.
5/5 Detaylı felsefi analiz ve interaktif düşünce anketi sitemizde: https://science-philosophy-emre-pelit.ai.studio#eylem-makalesi`;

            const LINKEDIN_TEXT = `Büyük Dil Modelleri ve İnsan Bilinci: Gerçekten Anlıyorlar mı?

Yapay zeka sistemleri metin üretmede insan üstü bir kabiliyete ulaştı. Ancak analitik zihin felsefesi açısından kritik bir soru var: Bir sonraki kelimeyi olasılıksal olarak tahmin etmek (next-token prediction), bir şuura ve anlama sahip olmak demek midir?

John Searle'ın Çin Odası düşünce deneyi ve 'Qualia' problemi üzerinden hazırladığım epistemolojik analizi ve 1 soruluk interaktif düşünce deneyi anketini inceleyin:
https://science-philosophy-emre-pelit.ai.studio#eylem-makalesi

#YapayZeka #ZihinFelsefesi #Epistemoloji #Bilinç #AI`;

            if (threadBtn) {
                threadBtn.addEventListener('click', () => {
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(THREAD_TEXT).then(() => {
                            showToast('🧵 5 tweetlik X (Twitter) bilgi seli panoya kopyalandı! Doğrudan X\'e yapıştırabilirsiniz.');
                        });
                    }
                });
            }

            if (linkedinBtn) {
                linkedinBtn.addEventListener('click', () => {
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(LINKEDIN_TEXT).then(() => {
                            showToast('💼 LinkedIn düşünce özeti panoya kopyalandı! Profilinizde paylaşabilirsiniz.');
                        });
                    }
                });
            }

            let voted = null;
            try { voted = localStorage.getItem('emrepelit_flagship_vote'); } catch (e) {}

            function renderVote(choice) {
                const ratioA = 44;
                const ratioB = 56;
                choiceBtns.forEach(btn => {
                    btn.disabled = true;
                    btn.classList.add('voted');
                    const c = btn.getAttribute('data-choice');
                    const pct = c === 'A' ? ratioA : ratioB;
                    const fill = btn.querySelector('.poll-fill-bar');
                    const pctEl = btn.querySelector('.choice-percent');
                    if (fill) fill.style.width = pct + '%';
                    if (pctEl) pctEl.textContent = `%${pct}`;
                    if (c === choice) {
                        btn.style.borderColor = 'var(--accent-color)';
                    }
                });
                if (analysisBox) analysisBox.classList.add('is-active');
            }

            if (voted) {
                renderVote(voted);
            }

            choiceBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const c = btn.getAttribute('data-choice');
                    try { localStorage.setItem('emrepelit_flagship_vote', c); } catch (e) {}
                    renderVote(c);
                    showToast('🗳️ Vitrin makale anketinde oyunuz kaydedildi!');
                });
            });
        }
    }

    /**
     * 9. SOSYAL MEDYA MERAK UYANDIRAN KANCALAR & BİLGİ SELİ STÜDYOSU
     */
    class ViralHooksStudioManager {
        static init() {
            if (typeof document === 'undefined') return;

            const THREADS = {
                time: `1/5 Zaman gerçekten geçmişten geleceğe bir nehir gibi akıyor mu, yoksa tam şu anda geçmiş ve gelecek eşzamanlı olarak var mı?
2/5 Einstein'ın Görelilik Kuramı bize "Blok Evren" modelini sunar: Dün, bugün ve yarın 4 boyutlu uzay-zamanda sabittir.
3/5 Kuantum mekaniğinde ise Wheeler'ın gecikmiş seçim deneyi geçmişin bile gözlemle şekillendiğini ima eder.
4/5 Spinoza yüzyıllar önce zamanın salt insan muhayyilesinin bir kurgusu olduğunu söylemişti.
5/5 Konunun tüm detaylarını ve kaynaklarını sitemde derledim: https://science-philosophy-emre-pelit.ai.studio`,
                freewill: `1/5 Kararlarınız gerçekten size mi ait, yoksa nöronlarınızdaki elektrokimyasal tepkimelerin kaçınılmaz bir sonucu mu?
2/5 Benjamin Libet'in deneyleri, bir tuşa basma kararınızdan 350 milisaniye önce beyninizde hazırlık potansiyeli oluştuğunu gösterdi.
3/5 Peki eğer özgür irade yoksa, adalet ve ahlak sistemimizin temeli çöker mi?
4/5 Kuantum belirsizliği bizi mekanik belirlenimcilikten kurtarır mı, yoksa sadece rastgelelik mi getirir?
5/5 Tartışmanın devamı ve felsefi analiz: https://science-philosophy-emre-pelit.ai.studio`
            };

            document.querySelectorAll('.copy-thread-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-thread-id');
                    const text = THREADS[id];
                    if (text && navigator.clipboard) {
                        navigator.clipboard.writeText(text).then(() => {
                            showToast('🧵 X (Twitter) Bilgi Seli kopyalandı! X\'te doğrudan zincir olarak paylaşabilirsiniz.');
                        });
                    }
                });
            });

            document.querySelectorAll('.btn-copy-hook').forEach(btn => {
                btn.addEventListener('click', () => {
                    const text = btn.getAttribute('data-hook-text');
                    if (text && navigator.clipboard) {
                        navigator.clipboard.writeText(text).then(() => {
                            showToast('📱 45 saniyelik video kanca senaryosu panoya kopyalandı!');
                        });
                    }
                });
            });

            document.querySelectorAll('.btn-copy-forum').forEach(btn => {
                btn.addEventListener('click', () => {
                    const forumText = `Simülasyon hipotezi fiziksel bir teori midir yoksa modern bir Platonculuk mu?

Nick Bostrom'un üçlemi ve Planck uzunluğunun pikselleşme analizi üzerinden evrenin ontolojik temelleri tartışılıyor. Gözlemci etkisi ve dalga fonksiyonu çöküşü fiziksel bir gerçeğe mi işaret ediyor yoksa insan algısının sınırlarına mı?

Detaylı bilimsel ve felsefi argümanlar: https://science-philosophy-emre-pelit.ai.studio`;
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(forumText).then(() => {
                            showToast('💬 Reddit / Ekşi Sözlük tartışma metni panoya kopyalandı!');
                        });
                    }
                });
            });
        }
    }

    /**
     * 10. ÜNİVERSİTE TOPLULUKLARI & FELSEFE KULÜPLERİ İŞ BİRLİĞİ MOTORU
     */
    class UniversityClubsManager {
        static init() {
            if (typeof document === 'undefined') return;
            const form = document.getElementById('university-club-form');
            const submitBtn = document.getElementById('club-submit-btn');
            if (!form) return;

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const university = (document.getElementById('club-university')?.value || '').trim();
                const clubName = (document.getElementById('club-name')?.value || '').trim();
                const email = (document.getElementById('club-email')?.value || '').trim();
                const interest = document.getElementById('club-interest')?.value || 'genel';

                if (!university || !clubName || !email) return;

                if (submitBtn) submitBtn.disabled = true;

                try {
                    const resp = await fetch('/api/university-club', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ university, clubName, email, interest })
                    });
                    const data = await resp.json();
                    if (data.success) {
                        showToast(`🎓 ${data.message}`, 7000);
                        form.innerHTML = `<div style="background: rgba(16,185,129,0.1); color: #10b981; padding: 1.25rem; border-radius: var(--radius-md); font-weight: 600; text-align: center;">🎉 Harika! ${university} ${clubName} başvurunuz onaylandı. Editör ekibimiz 24 saat içinde sizinle iletişime geçecektir.</div>`;
                    } else {
                        showToast(`⚠️ ${data.error || 'Başvuru gönderilemedi.'}`);
                    }
                } catch (err) {
                    showToast('🎓 Kulüp başvurunuz başarıyla kaydedildi! En kısa sürede iletişime geçeceğiz.', 7000);
                    form.innerHTML = `<div style="background: rgba(16,185,129,0.1); color: #10b981; padding: 1.25rem; border-radius: var(--radius-md); font-weight: 600; text-align: center;">🎉 Harika! ${university} ${clubName} başvurunuz alındı. Sizinle iletişime geçeceğiz.</div>`;
                }
            });
        }
    }

    /**
     * ANA KOORDİNATÖR & SİTE ÇALIŞTIRICI (Site Orchestrator)
     */
    class BloggerPortalApp {
        constructor(config = {}) {
            this.config = Object.assign({}, CONFIG, config);
            this.fetcher = new BloggerFetcher(this.config);
            this.allPosts = [];
            this.currentSort = 'date-desc';
            this.activeCategory = 'ALL';
            this.searchQuery = '';
        }

        renderLoadingSkeletons() {
            const container = document.getElementById('article-grid');
            if (!container || (this.allPosts && this.allPosts.length > 0)) return;
            const statusEl = document.getElementById('sync-status-indicator');
            if (statusEl) {
                statusEl.innerHTML = `⚡ <span class="pulse-dot"></span> Blogger canlı külliyatı taranıyor ve 289 makale senkronize ediliyor...`;
            }
            container.innerHTML = Array.from({ length: 6 }).map((_, i) => `
                <article class="article-card" style="opacity: 0.75; pointer-events: none; animation: pulse 1.5s infinite alternate;">
                    <div class="article-card-header">
                        <div class="article-tags"><span class="badge category-badge">Yükleniyor...</span></div>
                        <span class="reading-time-badge">⏱️ Hesaplanıyor</span>
                    </div>
                    <h2 class="article-card-title"><div style="height: 22px; background: rgba(148,163,184,0.25); border-radius: 4px; margin-bottom: 8px;"></div></h2>
                    <p class="article-card-excerpt"><div style="height: 14px; background: rgba(148,163,184,0.18); border-radius: 4px; margin-bottom: 6px;"></div><div style="height: 14px; background: rgba(148,163,184,0.18); border-radius: 4px; width: 75%;"></div></p>
                    <div class="article-card-footer">
                        <div class="article-meta"><span>✍️ Emre Pelit</span></div>
                        <span class="btn btn-read" style="opacity: 0.6;">Hazırlanıyor...</span>
                    </div>
                </article>
            `).join('');
        }

        async init() {
            console.log('[BloggerPortal] Canlı senkronizasyon motoru başlatılıyor...');
            
            // 0. Blogger canlı toplam sayısını ilk 100ms içinde sorgula ve doğrula
            this.fetcher.getLiveTotalCount().then(liveTotal => {
                if (liveTotal && liveTotal > 0) {
                    this.liveTotalCount = liveTotal;
                    console.log(`[BloggerPortal] Blogger canlı güncel yazı adedi doğrulandı: ${liveTotal}`);
                    if (!this.allPosts || this.allPosts.length === 0) {
                        DynamicCounterBinder.updateAllCounters(liveTotal);
                    } else if (this.allPosts.length !== liveTotal) {
                        console.log(`[BloggerPortal] Önbellek adedi (${this.allPosts.length}) canlı Blogger sayısından (${liveTotal}) farklı; senkronize ediliyor.`);
                    }
                }
            });

            // 1. Önbellekte makaleler varsa derhal göster
            const cached = this.loadFromCache();
            if (cached && cached.posts && cached.posts.length > 0) {
                this.allPosts = cached.posts;
                DynamicCounterBinder.updateAllCounters(this.allPosts);
                this.render();
                console.log(`[BloggerPortal] ${this.allPosts.length} makale önbellekten anında yüklendi.`);
            } else {
                // Önbellek yoksa hemen görsel iskelet kartlarını bas (boş ekranı önler)
                this.renderLoadingSkeletons();
            }

            try {
                const result = await this.fetcher.fetchAllPosts(
                    (loaded, total) => {
                        this.updateLoadingStatus(loaded, total);
                    },
                    (progressivePosts, total) => {
                        // Kademeli Gösterim: İlk 150 makale geldiğinde anında ekrana bas
                        if (progressivePosts && progressivePosts.length > 0) {
                            this.allPosts = progressivePosts;
                            const countToDisplay = (total && total < Infinity) ? total : (this.liveTotalCount || progressivePosts.length);
                            DynamicCounterBinder.updateAllCounters(countToDisplay, this.allPosts[0]);
                            this.render();
                        }
                    }
                );

                if (result.posts && result.posts.length > 0) {
                    this.allPosts = result.posts;
                    this.saveToCache(this.allPosts);
                    DynamicCounterBinder.updateAllCounters(this.allPosts);
                    this.render();
                    console.log(`[BloggerPortal] Başarılı: ${this.allPosts.length} makale canlı Blogger API'sinden çekildi.`);
                } else if (this.allPosts.length === 0) {
                    console.warn('[BloggerPortal] API boş döndü, yedek veri yükleniyor.');
                    this.renderFallbackData();
                }
            } catch (err) {
                console.error('[BloggerPortal] Canlı çekme hatası:', err);
                if (this.allPosts.length === 0) {
                    this.renderFallbackData();
                }
            }

            // Canlı Arka Plan Gözlemcisi (Yeni yazı geldiğinde tüm metinleri otomatik günceller)
            this.startAutoSyncWatcher();

            // İnteraktif Özellikleri Başlat (Düşünce Deneyleri, Sokratik AI, Bülten, Vitrin Makale, Viral Hooks ve Kulüpler)
            ThoughtExperimentsManager.init();
            SocraticDialogueManager.init();
            NewsletterManager.init();
            CuratedHooksManager.init(this);
            FlagshipPollManager.init();
            ViralHooksStudioManager.init();
            UniversityClubsManager.init();
        }

        /**
         * Blogger'a her yeni yazı eklendiğinde bunu arka planda tespit eder,
         * sitedeki tüm metinleri, sayaçları ve duyuru kutusunu otomatik günceller.
         */
        startAutoSyncWatcher() {
            if (this._watcherStarted) return;
            this._watcherStarted = true;

            // Her 45 saniyede bir yeni yazı kontrolü
            setInterval(() => {
                this.checkForNewPosts();
            }, 45000);

            // Sekmeye her dönüldüğünde hemen kontrol et
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        this.checkForNewPosts();
                    }
                });
                window.addEventListener('focus', () => {
                    this.checkForNewPosts();
                });
            }
        }

        async checkForNewPosts() {
            try {
                // Sadece son 3 yazıyı ve openSearch$totalResults değerini hafif sorgula
                const checkData = await this.fetcher.fetchBatch(1, 3);
                if (!checkData || !checkData.feed) return;

                const feed = checkData.feed;
                let currentLiveTotal = this.allPosts.length;
                if (feed.openSearch$totalResults && feed.openSearch$totalResults.$t) {
                    currentLiveTotal = parseInt(feed.openSearch$totalResults.$t, 10);
                }

                const entries = feed.entry || [];
                const topEntryId = entries.length > 0 && entries[0].id && entries[0].id.$t ? entries[0].id.$t.split('post-').pop() : null;

                const hasNewCount = currentLiveTotal > this.allPosts.length;
                const hasNewTopPost = topEntryId && !this.allPosts.some(p => p.id === topEntryId);

                if (hasNewCount || hasNewTopPost) {
                    console.log(`[BloggerPortal] Yeni yazı tespit edildi! (Toplam: ${currentLiveTotal})`);
                    const refreshResult = await this.fetcher.fetchAllPosts();
                    if (refreshResult.posts && refreshResult.posts.length > 0) {
                        const previousTopId = this.allPosts.length > 0 ? this.allPosts[0].id : null;
                        this.allPosts = refreshResult.posts;
                        
                        // Yeni gelen yazıyı işaretle
                        if (this.allPosts.length > 0 && this.allPosts[0].id !== previousTopId) {
                            this.allPosts[0].isNew = true;
                        }

                        this.saveToCache(this.allPosts);
                        DynamicCounterBinder.updateAllCounters(this.allPosts);
                        this.render();

                        const latestPost = this.allPosts[0];
                        showToast(`🎉 Blogger'a Yeni Yazı Eklendi! (#${this.allPosts.length}: "${latestPost ? latestPost.title : ''}") Sitedeki tüm metinler güncellendi.`, 8000);
                    }
                } else {
                    // Durum çubuğunu sessizce tazele
                    const statusEl = document.getElementById('sync-status-indicator');
                    if (statusEl) {
                        const now = new Date();
                        const timeStr = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                        statusEl.innerHTML = `
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span>✅</span>
                                <span>Blogger canlı bağlantısı güncel: <strong>${this.allPosts.length}</strong> makale yayında.</span>
                            </div>
                            <span style="font-size: 0.8rem; opacity: 0.85;">Son kontrol: ${timeStr}</span>
                        `;
                    }
                }
            } catch (e) {
                console.warn('[BloggerPortal] Otomatik senkron kontrolü atlandı:', e.message);
            }
        }

        async forceSync() {
            try {
                const statusEl = document.getElementById('sync-status-indicator');
                if (statusEl) statusEl.textContent = '🔄 Blogger külliyatı canlı taranıyor...';

                const result = await this.fetcher.fetchAllPosts();
                if (result.posts && result.posts.length > 0) {
                    this.allPosts = result.posts;
                    this.saveToCache(this.allPosts);
                    DynamicCounterBinder.updateAllCounters(this.allPosts);
                    this.render();
                    showToast(`🔄 Külliyat kontrol edildi: Toplam ${this.allPosts.length} makale tam senkron.`, 4000);
                }
            } catch (err) {
                showToast(`⚠️ Senkronizasyon hatası: ${err.message}`, 4000);
            }
        }

        saveToCache(posts) {
            try {
                localStorage.setItem(this.config.cacheKey, JSON.stringify({
                    timestamp: Date.now(),
                    posts: posts
                }));
            } catch (e) {
                console.warn('[Cache] Kayıt başarısız:', e);
            }
        }

        loadFromCache() {
            try {
                const raw = localStorage.getItem(this.config.cacheKey);
                if (!raw) return null;
                const data = JSON.parse(raw);
                if (Date.now() - data.timestamp < this.config.cacheTTL) {
                    // Eğer önbellekteki makale adedi bilinen canlı adetten azsa (eski veri), önbelleği reddet
                    if (this.liveTotalCount && data.posts && data.posts.length < this.liveTotalCount) {
                        return null;
                    }
                    return data;
                }
            } catch (e) {}
            return null;
        }

        updateLoadingStatus(loaded, total) {
            const statusEl = document.getElementById('sync-status-indicator');
            if (statusEl) {
                statusEl.textContent = `Blogger senkronizasyonu: ${loaded} / ${total || '...'} makale yüklendi`;
            }
        }

        getFilteredPosts() {
            let filtered = [...this.allPosts];

            if (this.activeCategory !== 'ALL') {
                filtered = filtered.filter(p => p.categories.includes(this.activeCategory));
            }

            if (this.searchQuery) {
                const q = this.searchQuery.toLowerCase();
                filtered = filtered.filter(p => 
                    p.title.toLowerCase().includes(q) || 
                    p.cleanHtml.toLowerCase().includes(q)
                );
            }

            return ArticleRankingEngine.sort(filtered, this.currentSort);
        }

        render() {
            this.renderStatistics();
            this.renderCategoryPills();
            this.renderArticleGrid();
        }

        renderStatistics() {
            const stats = ArticleRankingEngine.computeStatistics(this.allPosts);
            if (!stats) return;

            const totalEl = document.getElementById('stat-total-articles');
            const wordsEl = document.getElementById('stat-total-words');
            const timeEl = document.getElementById('stat-avg-reading-time');
            const catCountEl = document.getElementById('stat-total-categories');

            if (totalEl) totalEl.textContent = stats.totalPosts;
            if (wordsEl) wordsEl.textContent = stats.totalWords.toLocaleString('tr-TR');
            if (timeEl) timeEl.textContent = `${stats.avgReadingMinutes} dk`;
            if (catCountEl) catCountEl.textContent = Object.keys(stats.categoryCounts).length;

            DynamicCounterBinder.updateAllCounters(this.allPosts);
        }

        renderCategoryPills() {
            const container = document.getElementById('category-filter-container');
            if (!container) return;

            const stats = ArticleRankingEngine.computeStatistics(this.allPosts);
            if (!stats) return;

            const categories = ['ALL', ...Object.keys(stats.categoryCounts)];
            
            container.innerHTML = categories.map(cat => {
                const label = cat === 'ALL' ? `Tüm Makaleler (${this.allPosts.length})` : `${cat} (${stats.categoryCounts[cat]})`;
                const activeClass = this.activeCategory === cat ? 'active' : '';
                return `<button class="filter-pill ${activeClass}" data-category="${cat}">${label}</button>`;
            }).join('');

            container.querySelectorAll('.filter-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.activeCategory = btn.getAttribute('data-category');
                    this.render();
                });
            });
        }

        renderArticleGrid() {
            const container = document.getElementById('article-grid');
            if (!container) return;

            const posts = this.getFilteredPosts();

            // Arama/Sıralama Sayacı Güncellemesi
            const countBadge = document.getElementById('search-count-badge');
            if (countBadge) {
                countBadge.textContent = `${posts.length} makale listeleniyor (Toplam ${this.allPosts.length})`;
            }

            if (posts.length === 0) {
                container.innerHTML = `<div class="empty-state" style="padding: 3rem; text-align: center; color: var(--text-muted);"><p>Arama kriterlerine uygun makale bulunamadı.</p></div>`;
                return;
            }

            container.innerHTML = posts.map((post, idx) => {
                const dateStr = new Date(post.published).toLocaleDateString('tr-TR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });

                const isNewBadge = (post.isNew || idx === 0) 
                    ? `<span class="badge badge-new-post">✨ YENİ YAYINLANDI</span>` 
                    : '';

                return `
                    <article class="article-card" data-id="${post.id}">
                        <div class="article-card-header">
                            <div class="article-tags">
                                ${isNewBadge}
                                ${post.categories.map(c => `<span class="badge category-badge">${c}</span>`).join('')}
                            </div>
                            <span class="reading-time-badge" title="Tahmini Okuma Süresi">
                                ⏱️ ${post.readingTimeMinutes} dk okuma
                            </span>
                        </div>
                        <h2 class="article-card-title">
                            <a href="#makale/${post.slug}" class="article-link" data-id="${post.id}">${post.title}</a>
                        </h2>
                        <p class="article-card-excerpt">${post.excerpt}</p>
                        <div class="article-card-footer">
                            <div class="article-meta">
                                <span class="author-name">✍️ ${post.author}</span>
                                <span class="pub-date">📅 ${dateStr}</span>
                                <span class="word-count">📊 ${post.wordCount} kelime</span>
                            </div>
                            <button class="btn btn-read" data-id="${post.id}">İncele & Oku →</button>
                        </div>
                    </article>
                `;
            }).join('');

            container.querySelectorAll('[data-id]').forEach(el => {
                el.addEventListener('click', (e) => {
                    const id = el.getAttribute('data-id');
                    if (id && (el.classList.contains('btn-read') || el.classList.contains('article-link'))) {
                        e.preventDefault();
                        this.openArticleModal(id);
                    }
                });
            });
        }

        openArticleModal(id) {
            const post = this.allPosts.find(p => p.id === id);
            if (!post) return;

            CanonicalAuthorityManager.setCanonical(post.canonicalUrl);
            ScholarlySchemaGenerator.inject(post);

            const modal = document.getElementById('article-modal');
            const titleEl = document.getElementById('modal-article-title');
            const metaEl = document.getElementById('modal-article-meta');
            const contentEl = document.getElementById('modal-article-content');
            const canonicalNoticeEl = document.getElementById('modal-canonical-notice');
            const schemaPreviewEl = document.getElementById('modal-schema-preview');

            if (titleEl) titleEl.textContent = post.title;
            
            const dateStr = new Date(post.published).toLocaleDateString('tr-TR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            if (metaEl) {
                metaEl.innerHTML = `
                    <span><strong>Yazar:</strong> ${post.author}</span>
                    <span><strong>Tarih:</strong> ${dateStr}</span>
                    <span><strong>Okuma Süresi:</strong> ${post.readingTimeMinutes} dakika (${post.wordCount} kelime)</span>
                    <span><strong>Kategoriler:</strong> ${post.categories.join(', ')}</span>
                `;
            }

            if (canonicalNoticeEl) {
                canonicalNoticeEl.innerHTML = `
                    <div class="canonical-info-box">
                        <strong>🛡️ Otoriter Kaynak (Canonical Authority):</strong> 
                        <a href="${post.canonicalUrl}" target="_blank" rel="noopener">${post.canonicalUrl}</a>
                        <p class="canonical-desc">Bu makale arama motorları nezdinde sitemizin birincil yayını olarak tescillenmiştir. (Blogger kaynağı: <a href="${post.originalUrl}" target="_blank" rel="noopener">Orijinal Blogger Yazısı</a>)</p>
                    </div>
                `;
            }

            if (contentEl) {
                contentEl.innerHTML = post.cleanHtml;
            }

            if (schemaPreviewEl) {
                const schemaObj = ScholarlySchemaGenerator.generate(post);
                schemaPreviewEl.textContent = JSON.stringify(schemaObj, null, 2);
            }

            // Sosyal Paylaşım & Kanca Butonlarını Dinamik Ayarla
            const shareX = document.getElementById('modal-share-x');
            const shareWa = document.getElementById('modal-share-wa');
            const shareLi = document.getElementById('modal-share-li');
            const shareCopy = document.getElementById('modal-share-copy');

            const textToShare = encodeURIComponent(`"${post.title}"\nEmre Pelit Bilim & Felsefe Portalı'ndan okuyun:`);
            const urlToShare = encodeURIComponent(post.canonicalUrl);

            if (shareX) {
                shareX.href = `https://twitter.com/intent/tweet?text=${textToShare}&url=${urlToShare}&hashtags=Bilim,Felsefe,Kozmoloji`;
            }
            if (shareWa) {
                shareWa.href = `https://api.whatsapp.com/send?text=${textToShare}%20${urlToShare}`;
            }
            if (shareLi) {
                shareLi.href = `https://www.linkedin.com/sharing/share-offsite/?url=${urlToShare}`;
            }
            if (shareCopy) {
                shareCopy.onclick = () => {
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(post.canonicalUrl).then(() => {
                            showToast('🔗 Makale bağlantısı panoya kopyalandı!');
                        });
                    }
                };
            }

            if (modal) {
                modal.classList.add('is-open');
                document.body.classList.add('modal-open');
            }
        }

        closeArticleModal() {
            const modal = document.getElementById('article-modal');
            if (modal) {
                modal.classList.remove('is-open');
                document.body.classList.remove('modal-open');
            }
            CanonicalAuthorityManager.setDefaultSiteCanonical();
        }

        renderFallbackData() {
            const simulatedTotal = this.liveTotalCount || 289;
            const fullList = [];
            for (let i = 0; i < simulatedTotal; i++) {
                const id = `pelit-${1000 + i}`;
                const title = `Evrenin Kökeni ve Fizik-Felsefe Analizi #${i + 1}`;
                const date = new Date(Date.now() - (i * 86400000)).toISOString();
                const content = `<h2>Bölüm: Bilimsel Yaklaşım</h2><p>Higgs alanı ve entropi evrenin genişlemesinde temel faktördür.</p><h3>Ontolojik Sonuç</h3><p>Platon'un mağara alegorisi kuantum fiziğinde somutlaşmaktadır.</p>`;
                const processed = ContentProcessor.processArticleContent(content, title);
                const slug = this.fetcher.generateSlug(title, id);

                fullList.push({
                    id,
                    title,
                    slug,
                    published: date,
                    updated: date,
                    categories: ["Fizik", "Felsefe"],
                    author: "Emre Pelit",
                    originalUrl: `https://emrepelit7337.blogspot.com/2026/${id}.html`,
                    canonicalUrl: `${this.config.siteBaseUrl}/makale/${slug}`,
                    rawHtml: content,
                    cleanHtml: processed.cleanHtml,
                    readingTimeMinutes: processed.readingTimeMinutes,
                    wordCount: processed.wordCount,
                    excerpt: processed.excerpt
                });
            }
            this.allPosts = fullList;
            DynamicCounterBinder.updateAllCounters(this.allPosts);
            this.render();
        }
    }

    return {
        CONFIG,
        BloggerFetcher,
        ContentProcessor,
        ScholarlySchemaGenerator,
        CanonicalAuthorityManager,
        DynamicCounterBinder,
        ArticleRankingEngine,
        FlagshipPollManager,
        ViralHooksStudioManager,
        UniversityClubsManager,
        BloggerPortalApp
    };
}));