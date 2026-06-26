/**
 * きらら作品管理アプリ (app.js) - 更新版
 * 
 * 【修正内容】
 * 1. タブ切り替え時のコンテンツ非表示バグを修正：
 *    各セクションに個別のgrid-container（mangaGrid, animeGrid, settingsGrid）を割り当て、
 *    アクティブなコンテナのみに描画を行うよう変更。
 * 2. コミックスの手動追加（CRUD機能）の追加：
 *    「コミックスを手動追加」ボタンからマンガ情報（作品名、巻数、著者、発売日、画像、あらすじ）を
 *    直接手動で追加、編集、削除できるよう設計。LocalStorageに `kirara_user_custom_comics` として保存し、
 *    既存のデータベースとマージして動作します。
 */

class KiraraApp {
  constructor() {
    // アプリケーション状態
    this.comics = [];              // マスターコミックスデータ (JSON + 手動カスタムの合算)
    this.userCustomComics = [];    // 手動で追加したコミックスリスト
    this.userComics = {};          // ユーザーの読書ステータス・評価・感想 { [bookId]: { status, rating, review } }
    this.userMangaWorks = {};      // 作品単位のステータス・評価・メモ { [title]: { status, rating, review } }
    this.userAnime = [];           // ユーザーの手動登録アニメリスト
    
    // UI制御状態
    this.activeTab = 'home';       // 'home' | 'manga' | 'anime' | 'settings'
    this.viewType = 'grouped';     // 'grouped' (タイトル別まとめ) | 'individual' (1巻ずつ表示)
    
    // ページネーション状態
    this.currentPage = 1;
    this.itemsPerPage = 50;
    
    // フィルター状態
    this.filters = {
      searchQuery: '',
      label: 'all',
      status: 'all',
      sortBy: 'release_desc'        // 'release_desc' | 'release_asc' | 'title_asc' | 'rating_desc'
    };

    // 初期化
    this.init();
  }

  async init() {
    // 1. DOM要素の取得とイベントリスナーの登録
    this.cacheDomElements();
    this.bindEvents();

    // 2. データのロード
    this.loadLocalStorage();
    await this.loadComicsData();

    // 3. 描画
    this.initTheme();
    this.initBgCanvas();
    this.render();
    this.updateLucide();
  }

  // --- 背景アニメーション ---
  initBgCanvas() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let W, H, particles;
    const PARTICLE_COUNT = 70;

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };

    const isLight = () => document.body.classList.contains('light-theme');

    const randomParticle = () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 2 + 0.5,
      dx: (Math.random() - 0.5) * 0.4,
      dy: (Math.random() - 0.5) * 0.4,
      alpha: Math.random() * 0.5 + 0.1
    });

    resize();
    particles = Array.from({ length: PARTICLE_COUNT }, randomParticle);
    window.addEventListener('resize', resize);

    const colors = [
      [255, 64, 129],   // pink
      [213, 0, 249],    // purple
      [61, 90, 254],    // blue
    ];

    const draw = () => {
      const light = isLight();
      ctx.clearRect(0, 0, W, H);

      // 背景単色
      ctx.fillStyle = light ? '#f5f0ff' : '#090514';
      ctx.fillRect(0, 0, W, H);

      // グラデーションオーブ層
      const grd1 = ctx.createRadialGradient(W * 0.1, H * 0.2, 0, W * 0.1, H * 0.2, W * 0.4);
      grd1.addColorStop(0, light ? 'rgba(200,0,106,0.06)' : 'rgba(213,0,249,0.08)');
      grd1.addColorStop(1, 'transparent');
      ctx.fillStyle = grd1;
      ctx.fillRect(0, 0, W, H);

      const grd2 = ctx.createRadialGradient(W * 0.85, H * 0.75, 0, W * 0.85, H * 0.75, W * 0.4);
      grd2.addColorStop(0, light ? 'rgba(26,69,212,0.06)' : 'rgba(61,90,254,0.08)');
      grd2.addColorStop(1, 'transparent');
      ctx.fillStyle = grd2;
      ctx.fillRect(0, 0, W, H);

      // パーティクル描画
      particles.forEach(p => {
        const c = colors[Math.floor(Math.random() * colors.length)];
        const alphaAdj = light ? p.alpha * 0.5 : p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alphaAdj})`;
        ctx.fill();

        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0 || p.x > W) p.dx *= -1;
        if (p.y < 0 || p.y > H) p.dy *= -1;
      });

      requestAnimationFrame(draw);
    };

    draw();
  }

  // --- テーマ設定 ---
  initTheme() {
    const savedTheme = localStorage.getItem('kirara_theme') || 'dark';
    if (savedTheme === 'light') {
      document.body.classList.add('light-theme');
    }
    this.updateThemeToggleIcon();
  }

  toggleTheme() {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('kirara_theme', isLight ? 'light' : 'dark');
    this.updateThemeToggleIcon();
  }

  updateThemeToggleIcon() {
    if (!this.themeToggleBtn) return;
    const isLight = document.body.classList.contains('light-theme');
    this.themeToggleBtn.innerHTML = `<i data-lucide="${isLight ? 'moon' : 'sun'}"></i>`;
    this.themeToggleBtn.title = isLight ? 'ダークテーマへ切り替え' : 'ライトテーマへ切り替え';
    this.updateLucide();
  }

  // --- データ処理 ---

  // LocalStorageからユーザーデータを読み込む
  loadLocalStorage() {
    try {
      const savedUserComics = localStorage.getItem('kirara_user_comics');
      this.userComics = savedUserComics ? JSON.parse(savedUserComics) : {};

      const savedUserMangaWorks = localStorage.getItem('kirara_user_manga_works');
      this.userMangaWorks = savedUserMangaWorks ? JSON.parse(savedUserMangaWorks) : {};

      const savedUserAnime = localStorage.getItem('kirara_user_anime');
      this.userAnime = savedUserAnime ? JSON.parse(savedUserAnime) : [];

      const savedUserCustomComics = localStorage.getItem('kirara_user_custom_comics');
      this.userCustomComics = savedUserCustomComics ? JSON.parse(savedUserCustomComics) : [];
    } catch (e) {
      console.error('LocalStorageの読み込みに失敗しました。', e);
      this.showToast('データの読み込み中にエラーが発生しました。', 'red');
    }
  }

  // LocalStorageへユーザーデータを保存する
  saveLocalStorage() {
    try {
      localStorage.setItem('kirara_user_comics', JSON.stringify(this.userComics));
      localStorage.setItem('kirara_user_manga_works', JSON.stringify(this.userMangaWorks));
      localStorage.setItem('kirara_user_anime', JSON.stringify(this.userAnime));
      localStorage.setItem('kirara_user_custom_comics', JSON.stringify(this.userCustomComics));
    } catch (e) {
      console.error('LocalStorageへの保存に失敗しました。', e);
      this.showToast('データの保存中にエラーが発生しました。', 'red');
    }
  }

  // スクレイピング済みJSONと手動追加コミックスデータを読み込む
  async loadComicsData() {
    let scrapedComics = [];
    try {
      const response = await fetch('kirara_data.json', { cache: 'no-store' });
      if (response.ok) {
        scrapedComics = await response.json();
      } else {
        console.warn('kirara_data.json が見つかりません。手動追加データのみで起動します。');
      }
    } catch (e) {
      console.warn('kirara_data.json の読み込みに失敗しました。ローカルファイルで開いている場合は、手動追加データのみ表示します。', e);
    }

    const comicsById = new Map();
    [...scrapedComics, ...this.userCustomComics].forEach((comic) => {
      if (!comic) return;
      const key = comic.id || comic.cid || `${comic.title}_${comic.volume}_${comic.releaseDate}`;
      comicsById.set(key, comic);
    });
    this.comics = Array.from(comicsById.values());
  }

  // DOM要素のキャッシュ
  cacheDomElements() {
    // タブナビゲーション
    this.tabHome = document.getElementById('tab-home');
    this.tabManga = document.getElementById('tab-manga');
    this.tabAnime = document.getElementById('tab-anime');
    this.tabSettings = document.getElementById('tab-settings');

    // コンテンツセクション
    this.sectionHome = document.getElementById('section-home');
    this.sectionManga = document.getElementById('section-manga');
    this.sectionAnime = document.getElementById('section-anime');
    this.sectionSettings = document.getElementById('section-settings');

    // ページネーション用
    this.mangaPagination = document.getElementById('manga-pagination');
    this.animePagination = document.getElementById('anime-pagination');

    // テーマ切り替え
    this.themeToggleBtn = document.getElementById('theme-toggle');

    // コントロール
    this.controlsCard = document.getElementById('controls-card');
    this.searchInput = document.getElementById('search-input');
    this.toggleGroup = document.getElementById('toggle-grouped');
    this.toggleIndividual = document.getElementById('toggle-individual');
    
    // フィルター
    this.filterLabel = document.getElementById('filter-label');
    this.filterStatusList = document.querySelectorAll('.status-tag-btn');
    this.sortSelect = document.getElementById('sort-select');

    // 各セクション専用のグリッドコンテナ (バグ修正用)
    this.mangaGrid = document.getElementById('manga-grid-container');
    this.animeGrid = document.getElementById('anime-grid-container');
    this.settingsGrid = document.getElementById('settings-grid-container');

    // モーダル関連
    this.modalOverlay = document.getElementById('modal-overlay');
    this.modalWrapper = document.getElementById('modal-wrapper');
    this.modalClose = document.getElementById('modal-close');
    this.modalContent = document.getElementById('modal-content');

    // トースト通知
    this.toast = document.getElementById('toast');
    this.toastText = document.getElementById('toast-text');
  }

  // イベント登録
  bindEvents() {
    // タブ切り替え
    this.tabHome.addEventListener('click', () => this.switchTab('home'));
    this.tabManga.addEventListener('click', () => this.switchTab('manga'));
    this.tabAnime.addEventListener('click', () => this.switchTab('anime'));
    this.tabSettings.addEventListener('click', () => this.switchTab('settings'));

    // テーマ切り替え
    if (this.themeToggleBtn) {
      this.themeToggleBtn.addEventListener('click', () => this.toggleTheme());
    }

    // 検索・絞り込みイベント（リアルタイム反映）
    this.searchInput.addEventListener('input', (e) => {
      this.filters.searchQuery = e.target.value.trim();
      this.currentPage = 1;
      this.render();
    });

    this.toggleGroup.addEventListener('click', () => this.switchViewType('grouped'));
    this.toggleIndividual.addEventListener('click', () => this.switchViewType('individual'));

    this.filterLabel.addEventListener('change', (e) => {
      this.filters.label = e.target.value;
      this.currentPage = 1;
      this.render();
    });

    this.filterStatusList.forEach(btn => {
      btn.addEventListener('click', () => {
        this.filterStatusList.forEach(b => b.classList.remove('active'));
        const status = btn.getAttribute('data-status');
        
        if (this.filters.status === status) {
          this.filters.status = 'all';
        } else {
          this.filters.status = status;
          btn.classList.add('active');
        }
        this.currentPage = 1;
        this.render();
      });
    });

    this.sortSelect.addEventListener('change', (e) => {
      this.filters.sortBy = e.target.value;
      this.currentPage = 1;
      this.render();
    });

    // モーダル閉じる
    this.modalClose.addEventListener('click', () => this.closeModal());
    this.modalOverlay.addEventListener('click', (e) => {
      if (e.target === this.modalOverlay) this.closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modalOverlay.classList.contains('active')) {
        this.closeModal();
      }
    });
  }

  // --- 共通ステータス定義 ---
  getMangaStatusDefinitions() {
    return {
      read: { label: '読了', colorVar: 'var(--status-read)' },
      reading: { label: '読書中', colorVar: 'var(--accent-blue)' },
      unread: { label: '未読', colorVar: 'var(--status-unread)' },
      paused: { label: '中断', colorVar: 'var(--status-paused)' },
      dropped: { label: '読書切り', colorVar: 'var(--status-dropped)' },
      want: { label: '読みたい', colorVar: 'var(--status-want)' }
    };
  }

  getAnimeStatusDefinitions() {
    return {
      read: { label: '視聴完了', colorVar: 'var(--status-read)' },
      watching: { label: '視聴中', colorVar: 'var(--accent-blue)' },
      want: { label: '見たい', colorVar: 'var(--status-want)' },
      paused: { label: '中断', colorVar: 'var(--status-paused)' },
      dropped: { label: '視聴切り', colorVar: 'var(--status-dropped)' }
    };
  }

  getMangaStatusLabel(status) {
    const defs = this.getMangaStatusDefinitions();
    return (defs[status] || defs.unread).label;
  }

  getAnimeStatusLabel(status) {
    const defs = this.getAnimeStatusDefinitions();
    return (defs[status] || defs.want).label;
  }

  getWorkStatus(title, volumes = []) {
    const explicit = this.userMangaWorks[title];
    if (explicit && explicit.status) return explicit.status;
    if (volumes.length === 0) return 'unread';
    const statuses = volumes.map(v => (this.userComics[v.id] || {}).status || 'unread');
    const readCount = statuses.filter(st => st === 'read').length;
    if (readCount === volumes.length) return 'read';
    if (statuses.includes('reading')) return 'reading';
    if (statuses.includes('paused')) return 'paused';
    if (statuses.includes('dropped')) return 'dropped';
    if (statuses.includes('want')) return 'want';
    return readCount > 0 ? 'reading' : 'unread';
  }

  getReadCount(volumes) {
    return volumes.filter(v => ((this.userComics[v.id] || {}).status || 'unread') === 'read').length;
  }

  createMangaStatusOptions(selectedStatus) {
    return Object.entries(this.getMangaStatusDefinitions()).map(([value, def]) =>
      `<option value="${value}" ${selectedStatus === value ? 'selected' : ''}>${def.label}</option>`
    ).join('');
  }

  renderMangaStatusRadios(name, selectedStatus) {
    return Object.entries(this.getMangaStatusDefinitions()).map(([value, def]) => `
      <div class="status-radio-btn" data-status="${value}">
        <input type="radio" name="${name}" id="${name}-${value}" value="${value}" ${selectedStatus === value ? 'checked' : ''}>
        <label class="status-radio-label" for="${name}-${value}"><span class="dot" style="background:${def.colorVar}"></span> ${def.label}</label>
      </div>
    `).join('');
  }

  // --- UI ロジック ---

  // トーストメッセージを表示
  showToast(message, type = 'pink') {
    this.toastText.textContent = message;
    this.toast.className = 'toast-notification active';
    if (type === 'blue') {
      this.toast.classList.add('blue');
    }
    
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toast.classList.remove('active');
    }, 3000);
  }

  // Lucideアイコンの更新
  updateLucide() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // タブの切り替え
  switchTab(tabName) {
    this.activeTab = tabName;
    this.currentPage = 1;

    // ボタンのスタイル更新
    this.tabHome.classList.toggle('active', tabName === 'home');
    this.tabManga.classList.toggle('active', tabName === 'manga');
    this.tabAnime.classList.toggle('active', tabName === 'anime');
    this.tabSettings.classList.toggle('active', tabName === 'settings');

    // セクションの表示非表示 (displayを個別に切替)
    this.sectionHome.style.display = tabName === 'home' ? 'block' : 'none';
    this.sectionManga.style.display = tabName === 'manga' ? 'block' : 'none';
    this.sectionAnime.style.display = tabName === 'anime' ? 'block' : 'none';
    this.sectionSettings.style.display = tabName === 'settings' ? 'block' : 'none';

    // 検索・フィルターコントロールカードの表示切替
    if (tabName === 'settings' || tabName === 'home') {
      this.controlsCard.style.display = 'none';
    } else {
      this.controlsCard.style.display = 'flex';
      
      const labelFilterGroup = document.getElementById('filter-label-group');
      const viewToggleGroup = document.getElementById('view-toggle-group');
      
      if (tabName === 'anime') {
        if (labelFilterGroup) labelFilterGroup.style.display = 'none';
        if (viewToggleGroup) viewToggleGroup.style.display = 'none';
      } else {
        if (labelFilterGroup) labelFilterGroup.style.display = 'flex';
        if (viewToggleGroup) viewToggleGroup.style.display = 'flex';
      }
    }

    this.render();
  }

  // コミックス表示形式（まとめ vs 1巻ずつ）の切り替え
  switchViewType(type) {
    this.viewType = type;
    this.currentPage = 1;
    this.toggleGroup.classList.toggle('active', type === 'grouped');
    this.toggleIndividual.classList.toggle('active', type === 'individual');
    this.render();
  }

  // モーダルを開く
  openModal(contentHtml) {
    this.modalContent.innerHTML = contentHtml;
    this.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    this.updateLucide();
  }

  // モーダルを閉じる
  closeModal() {
    this.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    this.render();
  }

  // --- レンダリング処理 ---

  render() {
    // 現在のタブに応じた表示 (それぞれ専用のグリッドにクリア＆描画)
    if (this.activeTab === 'home') {
      const homeGrid = document.getElementById('home-grid-container');
      if (homeGrid) {
        homeGrid.innerHTML = '';
        this.renderHomeTab(homeGrid);
      }
    } else if (this.activeTab === 'manga') {
      this.mangaGrid.innerHTML = '';
      this.renderMangaTab();
    } else if (this.activeTab === 'anime') {
      this.animeGrid.innerHTML = '';
      this.renderAnimeTab();
    } else if (this.activeTab === 'settings') {
      this.settingsGrid.innerHTML = '';
      this.renderSettingsTab();
    }
    
    this.updateLucide();
  }

  // 1. マンガタブの描画
  renderMangaTab() {
    let filteredComics = [...this.comics];

    // レーベルフィルターの適応
    if (this.filters.label !== 'all') {
      filteredComics = filteredComics.filter(c => c.label.includes(this.filters.label));
    }

    // 検索語の適応（タイトル、著者、レーベル、あらすじ）
    if (this.filters.searchQuery) {
      const q = this.filters.searchQuery.toLowerCase();
      filteredComics = filteredComics.filter(c => 
        c.title.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.synopsis.toLowerCase().includes(q)
      );
    }

    // 「手動コミックスを追加」ヘッダーボタンを描画
    const addMangaBtnContainer = document.createElement('div');
    addMangaBtnContainer.style.gridColumn = '1 / -1';
    addMangaBtnContainer.style.display = 'flex';
    addMangaBtnContainer.style.justifyContent = 'flex-end';
    addMangaBtnContainer.style.marginBottom = '1rem';
    addMangaBtnContainer.innerHTML = `
      <button class="btn-primary" id="btn-add-manga-modal">
        <i data-lucide="plus"></i> コミックスを手動追加
      </button>
    `;
    this.mangaGrid.appendChild(addMangaBtnContainer);
    
    document.getElementById('btn-add-manga-modal').addEventListener('click', () => this.showAddMangaModal());

    // A. 1巻ずつ個別に表示する場合
    if (this.viewType === 'individual') {
      // ステータスフィルターの適応
      if (this.filters.status !== 'all') {
        filteredComics = filteredComics.filter(c => {
          const userState = this.userComics[c.id] || { status: 'unread' };
          return userState.status === this.filters.status;
        });
      }

      // ソート処理
      this.sortComics(filteredComics);

      const totalPages = Math.ceil(filteredComics.length / this.itemsPerPage);
      const paginatedComics = filteredComics.slice((this.currentPage - 1) * this.itemsPerPage, this.currentPage * this.itemsPerPage);

      if (filteredComics.length === 0) {
        this.renderEmptyState('条件に一致するコミックスが見つかりませんでした。');
        if (this.mangaPagination) this.mangaPagination.innerHTML = '';
        return;
      }

      paginatedComics.forEach(book => {
        const card = this.createMangaCard(book);
        this.mangaGrid.appendChild(card);
      });
      this.renderPaginationUI(this.mangaPagination, totalPages, 'manga');

    } 
    // B. タイトルごとにまとめて表示する場合 (Grouped View)
    else {
      // タイトル別にグループ化
      const groups = {};
      filteredComics.forEach(c => {
        if (!groups[c.title]) {
          groups[c.title] = [];
        }
        groups[c.title].push(c);
      });

      // グループ化されたデータの整形
      const groupedList = Object.keys(groups).map(title => {
        const volumes = groups[title].sort((a, b) => a.volume - b.volume);
        const firstVol = volumes[0];
        
        let totalValuedRating = 0;
        let ratedCount = 0;

        volumes.forEach(v => {
          const state = this.userComics[v.id] || { status: 'unread', rating: 0 };
          if (state.rating > 0) {
            totalValuedRating += state.rating;
            ratedCount++;
          }
        });

        const readCount = this.getReadCount(volumes);
        const overallStatus = this.getWorkStatus(title, volumes);
        const explicitWorkState = this.userMangaWorks[title] || {};
        const avgRating = explicitWorkState.rating > 0 ? explicitWorkState.rating : (ratedCount > 0 ? (totalValuedRating / ratedCount).toFixed(1) : 0);

        return {
          title,
          firstVol,
          volumes,
          overallStatus,
          readCount,
          avgRating,
          releaseDate: firstVol.releaseDate,
          author: firstVol.author,
          label: firstVol.label
        };
      });

      // グループに対するステータスフィルターの適応
      let displayGroups = groupedList;
      if (this.filters.status !== 'all') {
        displayGroups = groupedList.filter(g => g.overallStatus === this.filters.status);
      }

      // グループのソート処理
      this.sortGroupedList(displayGroups);

      const totalPages = Math.ceil(displayGroups.length / this.itemsPerPage);
      const paginatedGroups = displayGroups.slice((this.currentPage - 1) * this.itemsPerPage, this.currentPage * this.itemsPerPage);

      if (displayGroups.length === 0) {
        this.renderEmptyState('条件に一致する作品が見つかりませんでした。');
        if (this.mangaPagination) this.mangaPagination.innerHTML = '';
        return;
      }

      paginatedGroups.forEach(group => {
        const card = this.createGroupedMangaCard(group);
        this.mangaGrid.appendChild(card);
      });
      this.renderPaginationUI(this.mangaPagination, totalPages, 'manga');
    }
  }

  // コミックスのソート（単巻表示用）
  sortComics(list) {
    list.sort((a, b) => {
      if (this.filters.sortBy === 'release_desc') {
        return new Date(b.releaseDate) - new Date(a.releaseDate);
      } else if (this.filters.sortBy === 'release_asc') {
        return new Date(a.releaseDate) - new Date(b.releaseDate);
      } else if (this.filters.sortBy === 'title_asc') {
        return a.title.localeCompare(b.title, 'ja');
      } else if (this.filters.sortBy === 'rating_desc') {
        const ratingA = (this.userComics[a.id] || {}).rating || 0;
        const ratingB = (this.userComics[b.id] || {}).rating || 0;
        return ratingB - ratingA;
      }
      return 0;
    });
  }

  // コミックスのソート（グループ表示用）
  sortGroupedList(list) {
    list.sort((a, b) => {
      if (this.filters.sortBy === 'release_desc') {
        return new Date(b.releaseDate) - new Date(a.releaseDate);
      } else if (this.filters.sortBy === 'release_asc') {
        return new Date(a.releaseDate) - new Date(b.releaseDate);
      } else if (this.filters.sortBy === 'title_asc') {
        return a.title.localeCompare(b.title, 'ja');
      } else if (this.filters.sortBy === 'rating_desc') {
        return b.avgRating - a.avgRating;
      }
      return 0;
    });
  }

  // 単巻のカードHTML生成
  createMangaCard(book) {
    const card = document.createElement('div');
    card.className = 'work-card fade-in';
    
    const userState = this.userComics[book.id] || { status: 'unread', rating: 0 };
    const statusTextMap = Object.fromEntries(Object.entries(this.getMangaStatusDefinitions()).map(([key, value]) => [key, value.label]));
    
    let ratingStars = '';
    if (userState.rating > 0) {
      ratingStars = `
        <div class="card-rating">
          ${'<i data-lucide="star"></i>'.repeat(userState.rating)}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="cover-wrapper">
        <img class="cover-img" src="${book.coverUrl}" alt="${book.fullTitle}" onerror="this.src='https://placehold.co/300x420/1b0f33/f5f3f7?text=${encodeURIComponent(book.title)}'">
        <div class="cover-overlay"></div>
        <div class="card-badges">
          <span class="badge status-${userState.status}">
            <span class="dot"></span> ${statusTextMap[userState.status] || statusTextMap.unread}
          </span>
        </div>
      </div>
      <div class="card-info">
        <span class="card-label">${book.label}</span>
        <h4 class="card-title">${book.fullTitle}</h4>
        <div class="card-author">
          <i data-lucide="user"></i> ${book.author}
        </div>
        <div class="card-footer">
          <span class="card-release"><i data-lucide="calendar"></i> ${book.releaseDate}</span>
          ${ratingStars}
        </div>
      </div>
    `;

    card.addEventListener('click', () => this.showBookDetail(book.id));
    return card;
  }

  // グループ（作品別）カードHTML生成
  createGroupedMangaCard(group) {
    const card = document.createElement('div');
    card.className = 'work-card fade-in';
    
    const statusTextMap = Object.fromEntries(Object.entries(this.getMangaStatusDefinitions()).map(([key, value]) => [key, value.label]));
    
    let ratingStars = '';
    if (group.avgRating > 0) {
      ratingStars = `
        <div class="card-rating" title="平均評価: ${group.avgRating}">
          <i data-lucide="star"></i>
          <span>${group.avgRating}</span>
        </div>
      `;
    }

    const readPct = group.volumes.length > 0 ? Math.round((group.readCount / group.volumes.length) * 100) : 0;

    card.innerHTML = `
      <div class="cover-wrapper">
        <img class="cover-img" src="${group.firstVol.coverUrl}" alt="${group.title}" onerror="this.src='https://placehold.co/300x420/1b0f33/f5f3f7?text=${encodeURIComponent(group.title)}'">
        <div class="cover-overlay"></div>
        <div class="card-badges">
          <span class="badge status-${group.overallStatus}">
            <span class="dot"></span> ${statusTextMap[group.overallStatus] || statusTextMap.unread}
          </span>
          <span class="badge volume-count">全 ${group.volumes.length} 巻</span>
        </div>
      </div>
      <div class="card-info">
        <span class="card-label">${group.label}</span>
        <h4 class="card-title">${group.title}</h4>
        <div class="card-author">
          <i data-lucide="user"></i> ${group.author}
        </div>
        <div class="progress-bar-wrapper">
          <div class="progress-bar-fill" style="width: ${readPct}%"></div>
        </div>
        <div class="card-footer">
          <span class="card-release" style="color: var(--accent-pink); font-weight: 600;">
            <i data-lucide="book-open"></i> ${group.readCount}/${group.volumes.length}巻
          </span>
          ${ratingStars}
        </div>
      </div>
    `;

    card.addEventListener('click', () => this.showGroupedDetail(group.title));
    return card;
  }

  // 空の状態を描画
  renderEmptyState(message) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <i data-lucide="search-x"></i>
      <h3>作品が見つかりません</h3>
      <p>${message}</p>
    `;
    
    if (this.activeTab === 'manga') {
      this.mangaGrid.appendChild(empty);
    } else {
      this.animeGrid.appendChild(empty);
    }
    this.updateLucide();
  }

  // --- 詳細モーダルのレンダリング ---

  // 単巻コミックの詳細表示モーダル
  showBookDetail(bookId) {
    const book = this.comics.find(c => c.id === bookId);
    if (!book) return;

    const userState = this.userComics[bookId] || { status: 'unread', rating: 0, review: '' };
    
    const linkedAnimes = this.userAnime.filter(a => a.linkedMangaTitle === book.title);
    let animeSection = '';
    
    if (linkedAnimes.length > 0) {
      animeSection = `
        <div class="volume-list-section" style="margin-top: 1rem;">
          <h4 class="volume-list-title"><i data-lucide="tv"></i> 関連アニメ情報</h4>
          <div class="volumes-accordion">
            ${linkedAnimes.map(a => `
              <div class="volume-row-item" style="border-color: rgba(61, 90, 254, 0.2); background: rgba(61, 90, 254, 0.02)">
                <div class="vol-title-info">
                  <i data-lucide="play" style="color: var(--accent-blue);"></i>
                  <div>
                    <span class="vol-title-text" style="color: #90caf9">${a.title}</span>
                    <div class="vol-meta-info">${a.broadcastDate || '放送時期不明'} / ${a.episodes || '話数未設定'}</div>
                  </div>
                </div>
                <div class="vol-actions-area">
                  <span class="badge anime-card-badge">${this.getAnimeStatusLabel(a.status)}</span>
                  ${a.rating > 0 ? `<div class="card-rating"><i data-lucide="star"></i> ${a.rating}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    const modalHtml = `
      <div class="modal-body">
        <div class="detail-grid">
          <!-- 左カラム: 表紙 & 基本情報 -->
          <div class="detail-left">
            <img class="detail-cover" src="${book.coverUrl}" alt="${book.fullTitle}" onerror="this.src='https://placehold.co/300x420/1b0f33/f5f3f7?text=${encodeURIComponent(book.title)}'">
            <div class="detail-meta-table">
              <div class="meta-item">
                <span class="label">著者</span>
                <span class="val">${book.author}</span>
              </div>
              <div class="meta-item">
                <span class="label">レーベル</span>
                <span class="val">${book.label}</span>
              </div>
              <div class="meta-item">
                <span class="label">発売日</span>
                <span class="val">${book.releaseDate}</span>
              </div>
            </div>
          </div>
          
          <!-- 右カラム: あらすじ & ユーザーの評価フォーム -->
          <div class="detail-right">
            <span class="detail-label">${book.label}</span>
            <h2 class="detail-title">${book.fullTitle}</h2>
            <div class="detail-author"><i data-lucide="user"></i> ${book.author}</div>
            
            <div class="detail-synopsis-box">
              ${book.synopsis}
            </div>

            ${animeSection}

            <!-- ユーザー読書記録フォーム -->
            <div class="edit-form-section">
              <h3 class="form-title"><i data-lucide="edit-3"></i> 読書記録を残す</h3>
              
              <div class="form-grid">
                <!-- ステータスラジオボタン -->
                <div class="form-group full-width">
                  <label>読書状況</label>
                  <div class="status-radio-group">
                    ${this.renderMangaStatusRadios('detail-status', userState.status)}
                  </div>
                </div>

                <!-- インタラクティブ星評価 -->
                <div class="form-group full-width">
                  <label>マイ評価</label>
                  <div class="star-rating-interactive" id="detail-star-container">
                    ${[1, 2, 3, 4, 5].map(num => `
                      <button class="star-interactive ${num <= userState.rating ? 'filled' : ''}" data-star="${num}" type="button">
                        <i data-lucide="star"></i>
                      </button>
                    `).join('')}
                  </div>
                </div>

                <!-- 感想テキストエリア -->
                <div class="form-group full-width">
                  <label for="detail-review">感想・メモ</label>
                  <textarea class="textarea-custom" id="detail-review" placeholder="この作品についての感想や、何巻まで読んだかなどのメモを自由に記録できます。">${userState.review || ''}</textarea>
                </div>
              </div>

              <!-- アクションボタン -->
              <div class="form-actions">
                <button class="btn-secondary" id="btn-edit-manga-info" style="margin-right: auto;"><i data-lucide="edit-3"></i> 作品データを編集</button>
                <button class="btn-primary" id="btn-save-record"><i data-lucide="check"></i> 記録を保存</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.openModal(modalHtml);

    // 作品情報の手動編集ボタンのバインド
    document.getElementById('btn-edit-manga-info').addEventListener('click', () => {
      this.showAddMangaModal(bookId);
    });

    // インタラクティブ評価の星クリックロジックのバインド
    let selectedRating = userState.rating;
    const starContainer = document.getElementById('detail-star-container');
    const stars = starContainer.querySelectorAll('.star-interactive');

    stars.forEach(star => {
      star.addEventListener('click', () => {
        const rating = parseInt(star.getAttribute('data-star'), 10);
        selectedRating = rating;
        
        stars.forEach((s, idx) => {
          s.classList.toggle('filled', idx < rating);
        });
      });
    });

    // 記録の保存処理
    document.getElementById('btn-save-record').addEventListener('click', () => {
      const selectedStatus = document.querySelector('input[name="detail-status"]:checked').value;
      const reviewText = document.getElementById('detail-review').value.trim();

      this.userComics[bookId] = {
        status: selectedStatus,
        rating: selectedRating,
        review: reviewText
      };

      this.saveLocalStorage();
      this.showToast(`「${book.fullTitle}」の記録を保存しました！`);
      this.closeModal();
    });
  }

  // グループ化表示（作品別）時の詳細表示モーダル（作品単位ステータス＋複数巻を一覧・個別編集可能）
  showGroupedDetail(titleName) {
    const volumes = this.comics.filter(c => c.title === titleName).sort((a, b) => a.volume - b.volume);
    if (volumes.length === 0) return;

    const firstVol = volumes[0];
    const workState = this.userMangaWorks[titleName] || { status: this.getWorkStatus(titleName, volumes), rating: 0, review: '' };
    const readCount = this.getReadCount(volumes);
    const readPct = volumes.length > 0 ? Math.round((readCount / volumes.length) * 100) : 0;
    const lastReadVolume = [...volumes].reverse().find(v => ((this.userComics[v.id] || {}).status || 'unread') === 'read');
    const progressLabel = lastReadVolume ? `第${lastReadVolume.volume}巻まで読了` : 'まだ読了巻はありません';
    const statusDefs = this.getMangaStatusDefinitions();
    const selectedStatus = workState.status || this.getWorkStatus(titleName, volumes);
    
    // 関連アニメの検索
    const linkedAnimes = this.userAnime.filter(a => a.linkedMangaTitle === titleName);
    const animeListHtml = linkedAnimes.length > 0 ? `
      <div class="volume-list-section">
        <h4 class="volume-list-title"><i data-lucide="tv"></i> メディア展開（アニメ）</h4>
        <div class="volumes-accordion">
          ${linkedAnimes.map(a => `
            <div class="volume-row-item" style="border-color: rgba(61, 90, 254, 0.2); background: rgba(61, 90, 254, 0.02); cursor: pointer;" onclick="window.app.showAnimeDetail('${a.id}')">
              <div class="vol-title-info">
                <i data-lucide="play" style="color: var(--accent-blue);"></i>
                <div>
                  <span class="vol-title-text" style="color: #90caf9">${a.title}</span>
                  <div class="vol-meta-info">${a.broadcastDate || '放送時期不明'} / ${a.episodes || '話数未設定'}</div>
                </div>
              </div>
              <div class="vol-actions-area">
                <span class="badge anime-card-badge">${this.getAnimeStatusLabel(a.status)}</span>
                ${a.rating > 0 ? `<div class="card-rating"><i data-lucide="star"></i> ${a.rating}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    const volumesHtml = volumes.map(v => {
      const state = this.userComics[v.id] || { status: 'unread', rating: 0, review: '' };
      return `
        <div class="vol-card" onclick="window.app.showBookDetail('${v.id}')">
          <img class="vol-card-cover" src="${v.coverUrl}" onerror="this.src='https://placehold.co/100x140/1b0f33/f5f3f7?text=${encodeURIComponent(v.volume)}'">
          <div class="vol-card-info">
            <span class="vol-card-title">第${v.volume}巻</span>
            <select class="vol-status-select" onclick="event.stopPropagation()" onchange="event.stopPropagation(); window.app.setVolumeStatus('${v.id}', this.value, '${titleName}')">
              ${this.createMangaStatusOptions(state.status)}
            </select>
          </div>
        </div>
      `;
    }).join('');

    const modalHtml = `
      <div class="modal-body grouped-detail-modal">
        <div class="detail-grid grouped-detail-grid">
          <div class="detail-left">
            <img class="detail-cover" src="${firstVol.coverUrl}" alt="${titleName}" onerror="this.src='https://placehold.co/300x420/1b0f33/f5f3f7?text=${encodeURIComponent(titleName)}'">
            <div class="detail-meta-table">
              <div class="meta-item"><span class="label">著者</span><span class="val">${firstVol.author}</span></div>
              <div class="meta-item"><span class="label">レーベル</span><span class="val">${firstVol.label}</span></div>
              <div class="meta-item"><span class="label">既刊</span><span class="val">全 ${volumes.length} 巻</span></div>
            </div>
          </div>

          <div class="detail-right">
            <span class="detail-label">${firstVol.label}</span>
            <h2 class="detail-title">${titleName}</h2>
            <div class="detail-author"><i data-lucide="user"></i> ${firstVol.author}</div>
            <div class="detail-synopsis-box"><strong>作品あらすじ（第1巻より）：</strong><br>${firstVol.synopsis}</div>

            <div class="edit-form-section work-status-panel">
              <h3 class="form-title"><i data-lucide="bookmark-check"></i> 作品全体のステータス</h3>
              <div class="work-progress-summary">
                <span class="badge status-${selectedStatus}"><span class="dot" style="background:${(statusDefs[selectedStatus] || statusDefs.unread).colorVar}"></span> ${this.getMangaStatusLabel(selectedStatus)}</span>
                <strong>${progressLabel}</strong>
                <span>${readCount}/${volumes.length}巻 読了</span>
              </div>
              <div class="progress-bar-wrapper large-progress"><div class="progress-bar-fill" style="width:${readPct}%"></div></div>
              <div class="form-grid">
                <div class="form-group full-width">
                  <label>作品ステータス</label>
                  <div class="status-radio-group">
                    ${this.renderMangaStatusRadios('work-status', selectedStatus)}
                  </div>
                </div>
                <div class="form-group full-width">
                  <label for="work-review">作品メモ</label>
                  <textarea class="textarea-custom" id="work-review" placeholder="作品全体の印象や、次に読みたい巻などを記録できます。">${workState.review || ''}</textarea>
                </div>
              </div>
              <div class="form-actions"><button class="btn-primary" id="btn-save-work-record"><i data-lucide="check"></i> 作品ステータスを保存</button></div>
            </div>

            ${animeListHtml}
          </div>
        </div>

        <div class="volume-list-section full-width-volume-section">
          <div class="section-toolbar">
            <h4 class="volume-list-title" style="margin: 0;"><i data-lucide="book-open"></i> コミックス既刊一覧 (${volumes.length}巻)</h4>
            <div class="batch-status-control">
              <span>全巻を一括変更:</span>
              <select class="select-custom" id="batch-status-select">
                <option value="">-- 選択 --</option>
                ${this.createMangaStatusOptions('')}
              </select>
            </div>
          </div>
          <div class="volumes-card-grid full-width-volumes-grid">${volumesHtml}</div>
        </div>
      </div>
    `;

    this.openModal(modalHtml);

    document.getElementById('btn-save-work-record').addEventListener('click', () => {
      const newStatus = document.querySelector('input[name="work-status"]:checked').value;
      const review = document.getElementById('work-review').value.trim();
      this.userMangaWorks[titleName] = { ...this.userMangaWorks[titleName], status: newStatus, review };
      this.saveLocalStorage();
      this.showToast(`「${titleName}」の作品ステータスを保存しました！`, 'pink');
      this.render();
      this.showGroupedDetail(titleName);
    });

    document.getElementById('batch-status-select').addEventListener('change', (e) => {
      const newStatus = e.target.value;
      if (!newStatus) return;
      if (confirm(`全 ${volumes.length} 巻のステータスを「${this.getMangaStatusLabel(newStatus)}」に変更しますか？`)) {
        volumes.forEach(v => {
          this.userComics[v.id] = { ...(this.userComics[v.id] || { rating: 0, review: '' }), status: newStatus };
        });
        this.saveLocalStorage();
        this.showToast('全巻のステータスを一括更新しました！', 'pink');
        this.showGroupedDetail(titleName);
      } else {
        e.target.value = '';
      }
    });
  }

  setVolumeStatus(volumeId, status, titleName = null) {
    this.userComics[volumeId] = { ...(this.userComics[volumeId] || { rating: 0, review: '' }), status };
    this.saveLocalStorage();
    this.showToast('巻ごとのステータスを更新しました。', 'pink');
    if (titleName) this.showGroupedDetail(titleName);
    this.render();
  }

  // --- 手動コミックス追加・編集モーダルフォーム ---
  
  showAddMangaModal(mangaId = null) {
    const isEdit = mangaId !== null;
    const book = isEdit ? this.comics.find(c => c.id === mangaId) : {
      title: '', volume: 1, fullTitle: '', author: '', label: 'KRコミックス', releaseDate: '', synopsis: '', coverUrl: '', cid: ''
    };

    const modalHtml = `
      <div class="modal-body" style="max-width: 650px; margin: 0 auto;">
        <h2 class="detail-title" style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
          <i data-lucide="book-open" style="color:var(--accent-pink)"></i>
          ${isEdit ? 'コミックス情報の編集' : '新規コミックスの追加'}
        </h2>
        
        <div class="edit-form-section" style="background: transparent; border: none; padding: 0;">
          <div class="form-grid">
            
            <!-- 作品タイトル -->
            <div class="form-group">
              <label for="manga-title">作品名 (シリーズ名) <span style="color:var(--accent-pink)">*</span></label>
              <input type="text" class="input-text" id="manga-title" placeholder="例：ぼっち・ざ・ろっく！" value="${book.title}" required>
            </div>

            <!-- 巻数 -->
            <div class="form-group">
              <label for="manga-volume">巻数 <span style="color:var(--accent-pink)">*</span></label>
              <input type="number" class="input-text" id="manga-volume" min="1" placeholder="例：4" value="${book.volume}" required>
            </div>

            <!-- 巻タイトル -->
            <div class="form-group full-width">
              <label for="manga-full-title">巻表示名 (フルタイトル)</label>
              <input type="text" class="input-text" id="manga-full-title" placeholder="例：ぼっち・ざ・ろっく！　第４巻" value="${book.fullTitle || ''}">
              <small style="color: var(--text-muted); font-size: 0.75rem; margin-top: 0.2rem;">空欄の場合、「作品名 + 第X巻」で自動生成されます。</small>
            </div>

            <!-- 著者 -->
            <div class="form-group">
              <label for="manga-author">著者/作者 <span style="color:var(--accent-pink)">*</span></label>
              <input type="text" class="input-text" id="manga-author" placeholder="例：はまじあき" value="${book.author}" required>
            </div>

            <!-- レーベル -->
            <div class="form-group">
              <label for="manga-label">レーベル</label>
              <select class="select-custom" id="manga-label" style="width: 100%;">
                <option value="KRコミックス" ${book.label === 'KRコミックス' ? 'selected' : ''}>KRコミックス</option>
                <option value="KRコミックスフォワードシリーズ" ${book.label === 'KRコミックスフォワードシリーズ' ? 'selected' : ''}>KRコミックスフォワードシリーズ</option>
                <option value="その他" ${book.label !== 'KRコミックス' && book.label !== 'KRコミックスフォワードシリーズ' ? 'selected' : ''}>その他 (手入力可)</option>
              </select>
            </div>
            
            <!-- カスタムレーベル手入力 -->
            <div class="form-group full-width" id="custom-label-group" style="display: ${book.label !== 'KRコミックス' && book.label !== 'KRコミックスフォワードシリーズ' ? 'block' : 'none'};">
              <label for="manga-custom-label">レーベル名入力</label>
              <input type="text" class="input-text" id="manga-custom-label" placeholder="例：KRコミックス" value="${book.label}">
            </div>

            <!-- 発売日 -->
            <div class="form-group">
              <label for="manga-release">発売日 <span style="color:var(--accent-pink)">*</span></label>
              <input type="text" class="input-text" id="manga-release" placeholder="例：2026-05-31" value="${book.releaseDate}" required>
            </div>

            <!-- 表紙画像URL -->
            <div class="form-group">
              <label for="manga-cover">表紙画像URL</label>
              <input type="url" class="input-text" id="manga-cover" placeholder="例：https://..." value="${book.coverUrl}">
            </div>

            <!-- あらすじ -->
            <div class="form-group full-width">
              <label for="manga-synopsis">作品あらすじ</label>
              <textarea class="textarea-custom" id="manga-synopsis" placeholder="作品のあらすじや紹介文を記録できます。">${book.synopsis || ''}</textarea>
            </div>

          </div>

          <!-- 保存・削除アクション -->
          <div class="form-actions" style="margin-top: 1.5rem;">
            ${isEdit && book.id.startsWith('custom_') ? `
              <button class="btn-danger" id="btn-delete-manga" style="margin-right: auto;"><i data-lucide="trash-2"></i> 削除</button>
            ` : ''}
            <button class="btn-secondary" id="btn-cancel-manga">キャンセル</button>
            <button class="btn-primary" id="btn-save-manga"><i data-lucide="check"></i> 保存する</button>
          </div>
        </div>
      </div>
    `;

    this.openModal(modalHtml);

    // レーベルセレクト連動
    const labelSelect = document.getElementById('manga-label');
    const customLabelGroup = document.getElementById('custom-label-group');
    labelSelect.addEventListener('change', (e) => {
      customLabelGroup.style.display = e.target.value === 'その他' ? 'block' : 'none';
    });

    // キャンセル
    document.getElementById('btn-cancel-manga').addEventListener('click', () => this.closeModal());

    // 保存
    document.getElementById('btn-save-manga').addEventListener('click', () => {
      const title = document.getElementById('manga-title').value.trim();
      const volumeStr = document.getElementById('manga-volume').value.trim();
      const author = document.getElementById('manga-author').value.trim();
      const releaseDate = document.getElementById('manga-release').value.trim();

      if (!title || !volumeStr || !author || !releaseDate) {
        this.showToast('必須項目（*）をすべて入力してください。', 'red');
        return;
      }

      const volume = parseInt(volumeStr, 10);
      let label = labelSelect.value;
      if (label === 'その他') {
        label = document.getElementById('manga-custom-label').value.trim() || 'その他';
      }

      let fullTitle = document.getElementById('manga-full-title').value.trim();
      if (!fullTitle) {
        fullTitle = `${title}　第${volume}巻`;
      }

      const coverUrl = document.getElementById('manga-cover').value.trim() || `https://placehold.co/300x420/1b0f33/f5f3f7?text=${encodeURIComponent(title + ' ' + volume)}`;
      const synopsis = document.getElementById('manga-synopsis').value.trim() || 'あらすじ情報はありません。';

      if (isEdit) {
        // 更新
        const idx = this.userCustomComics.findIndex(c => c.id === mangaId);
        if (idx !== -1) {
          this.userCustomComics[idx] = {
            id: mangaId, title, volume, fullTitle, author, label, releaseDate, synopsis, coverUrl, cid: book.cid || `custom_${Date.now()}`
          };
        }
        const mainIdx = this.comics.findIndex(c => c.id === mangaId);
        if (mainIdx !== -1) {
          this.comics[mainIdx] = this.userCustomComics[idx];
        }
      } else {
        // 新規登録
        const newMangaId = `custom_${Date.now()}`;
        const newManga = {
          id: newMangaId,
          title, volume, fullTitle, author, label, releaseDate, synopsis, coverUrl, cid: `custom_${Date.now()}`
        };
        this.userCustomComics.push(newManga);
        this.comics.push(newManga);
      }

      this.saveLocalStorage();
      this.showToast(isEdit ? 'コミックス情報を更新しました！' : '新規コミックスを登録しました！', 'pink');
      this.render();
      this.closeModal();
    });

    // 削除
    if (isEdit && book.id.startsWith('custom_')) {
      document.getElementById('btn-delete-manga').addEventListener('click', () => {
        if (confirm(`本当に「${book.fullTitle}」を削除しますか？`)) {
          this.userCustomComics = this.userCustomComics.filter(c => c.id !== mangaId);
          this.comics = this.comics.filter(c => c.id !== mangaId);
          this.saveLocalStorage();
          this.showToast('コミックス情報を削除しました。', 'red');
          this.render();
          this.closeModal();
        }
      });
    }
  }

  // --- アニメタブのレンダリング・登録処理 ---

  renderAnimeTab() {
    let filteredAnime = [...this.userAnime];
    if (this.filters.searchQuery) {
      const q = this.filters.searchQuery.toLowerCase();
      filteredAnime = filteredAnime.filter(a => 
        a.title.toLowerCase().includes(q) ||
        a.linkedMangaTitle.toLowerCase().includes(q) ||
        (a.review && a.review.toLowerCase().includes(q))
      );
    }

    if (this.filters.status !== 'all') {
      filteredAnime = filteredAnime.filter(a => a.status === this.filters.status || (this.filters.status === 'reading' && a.status === 'watching'));
    }

    filteredAnime.sort((a, b) => {
      if (this.filters.sortBy === 'release_desc') {
        return (b.broadcastDate || '').localeCompare(a.broadcastDate || '');
      } else if (this.filters.sortBy === 'release_asc') {
        return (a.broadcastDate || '').localeCompare(b.broadcastDate || '');
      } else if (this.filters.sortBy === 'title_asc') {
        return a.title.localeCompare(b.title, 'ja');
      } else if (this.filters.sortBy === 'rating_desc') {
        return (b.rating || 0) - (a.rating || 0);
      }
      return 0;
    });

    const totalPages = Math.ceil(filteredAnime.length / this.itemsPerPage);
    const paginatedAnime = filteredAnime.slice((this.currentPage - 1) * this.itemsPerPage, this.currentPage * this.itemsPerPage);

    const addBtnContainer = document.createElement('div');
    addBtnContainer.style.gridColumn = '1 / -1';
    addBtnContainer.style.display = 'flex';
    addBtnContainer.style.justifyContent = 'flex-end';
    addBtnContainer.style.marginBottom = '1rem';
    addBtnContainer.innerHTML = `
      <button class="btn-primary" id="btn-add-anime-modal">
        <i data-lucide="plus"></i> アニメ作品を手動追加
      </button>
    `;
    this.animeGrid.appendChild(addBtnContainer);
    
    document.getElementById('btn-add-anime-modal').addEventListener('click', () => this.showAddAnimeModal());

    if (filteredAnime.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.style.gridColumn = '1 / -1';
      empty.innerHTML = `
        <i data-lucide="tv"></i>
        <h3>アニメ情報が登録されていません</h3>
        <p>「アニメ作品を手動追加」ボタンからお気に入りのアニメ化作品を登録してみましょう！</p>
      `;
      this.animeGrid.appendChild(empty);
      if (this.animePagination) this.animePagination.innerHTML = '';
      this.updateLucide();
      return;
    }

    const statusTextMap = Object.fromEntries(Object.entries(this.getAnimeStatusDefinitions()).map(([key, value]) => [key, value.label]));

    paginatedAnime.forEach(anime => {
      const card = document.createElement('div');
      card.className = 'work-card fade-in';
      
      let ratingStars = '';
      if (anime.rating > 0) {
        ratingStars = `
          <div class="card-rating">
            ${'<i data-lucide="star"></i>'.repeat(anime.rating)}
          </div>
        `;
      }

      const animeStatusDef = this.getAnimeStatusDefinitions()[anime.status] || this.getAnimeStatusDefinitions().want;
      const watchedEps = anime.watchedEpisodes || 0;
      const totalEps = parseInt(anime.episodes) || 0;
      const epPct = totalEps > 0 ? Math.min(100, Math.round((watchedEps / totalEps) * 100)) : 0;

      card.innerHTML = `
        <div class="cover-wrapper" style="padding-top: 140%;">
          ${anime.coverUrl ? `
            <img class="cover-img" src="${anime.coverUrl}" alt="${anime.title}" onerror="this.src='https://placehold.co/300x420/1b0f33/f5f3f7?text=${encodeURIComponent(anime.title)}'">
          ` : `
          <div style="position: absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; background:linear-gradient(45deg, #1b0f33, #090514); border-bottom:1px solid rgba(61,90,254,0.15)">
            <i data-lucide="tv" style="width:48px; height:48px; color:var(--accent-blue); opacity:0.8; filter:drop-shadow(0 0 10px rgba(61,90,254,0.4))"></i>
            <span style="font-size:0.8rem; color:var(--text-muted); margin-top:0.5rem">Anime</span>
          </div>
          `}
          <div class="cover-overlay"></div>
          <div class="card-badges">
            <span class="badge status-${anime.status === 'watching' ? 'watching' : anime.status}" style="border-color:${animeStatusDef.colorVar};color:${animeStatusDef.colorVar};">
              <span class="dot" style="background:${animeStatusDef.colorVar}"></span>
              ${statusTextMap[anime.status] || statusTextMap.want}
            </span>
          </div>
        </div>
        <div class="card-info">
          ${anime.linkedMangaTitle ? `
            <span class="card-label" style="color:var(--accent-blue); font-size:0.65rem;">
              <i data-lucide="link" style="width:10px;height:10px;"></i> ${anime.linkedMangaTitle}
            </span>
          ` : `<span class="card-label">アニメ</span>`}
          <h4 class="card-title">${anime.title}</h4>
          <div class="card-author">
            <i data-lucide="calendar"></i> ${anime.broadcastDate || '未設定'}
          </div>
          ${totalEps > 0 ? `
          <div class="progress-bar-wrapper">
            <div class="progress-bar-fill blue" style="width: ${epPct}%"></div>
          </div>
          ` : ''}
          <div class="card-footer">
            <span class="card-release"><i data-lucide="play-circle"></i> ${watchedEps}/${totalEps > 0 ? totalEps + '話' : '?'}</span>
            ${ratingStars}
          </div>
        </div>
      `;

      card.addEventListener('click', () => this.showAnimeDetail(anime.id));
      this.animeGrid.appendChild(card);
    });

    this.renderPaginationUI(this.animePagination, totalPages, 'anime');
  }

  // アニメ追加・編集モーダルの表示
  showAddAnimeModal(animeId = null) {
    const isEdit = animeId !== null;
    const anime = isEdit ? this.userAnime.find(a => a.id === animeId) : {
      title: '', linkedMangaTitle: '', status: 'want', rating: 0, review: '', synopsis: '', broadcastDate: '', episodes: '', watchedEpisodes: 0, coverUrl: '', pvUrl: '', copyright: '', officialUrl: ''
    };

    const mangaTitles = Array.from(new Set(this.comics.map(c => c.title)));
    const mangaOptions = mangaTitles.map(t => `
      <option value="${t}" ${anime.linkedMangaTitle === t ? 'selected' : ''}>${t}</option>
    `).join('');

    const modalHtml = `
      <div class="modal-body" style="max-width: 650px; margin: 0 auto;">
        <h2 class="detail-title" style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
          <i data-lucide="tv" style="color:var(--accent-blue)"></i>
          ${isEdit ? 'アニメ情報の編集' : '新規アニメ作品の追加'}
        </h2>
        
        <div class="edit-form-section" style="background: transparent; border: none; padding: 0;">
          <div class="form-grid">
            
            <!-- アニメタイトル -->
            <div class="form-group full-width">
              <label for="anime-title">アニメ作品名 <span style="color:var(--accent-pink)">*</span></label>
              <input type="text" class="input-text" id="anime-title" placeholder="例：ぼっち・ざ・ろっく！ (TVアニメ)" value="${anime.title}" required>
            </div>

            <!-- 原作マンガとのリンク -->
            <div class="form-group full-width">
              <label for="anime-link-manga">原作マンガと連携</label>
              <select class="select-custom" id="anime-link-manga" style="width: 100%;">
                <option value="">-- 連動させない（その他） --</option>
                ${mangaOptions}
              </select>
            </div>

            <!-- 放送時期 -->
            <div class="form-group">
              <label for="anime-broadcast">放送時期</label>
              <input type="text" class="input-text" id="anime-broadcast" placeholder="例：2022年秋" value="${anime.broadcastDate || ''}">
            </div>

            <!-- 話数 -->
            <div class="form-group">
              <label for="anime-episodes">話数</label>
              <input type="text" class="input-text" id="anime-episodes" placeholder="例：全12話" value="${anime.episodes || ''}">
            </div>

            <!-- サムネイル画像URL -->
            <div class="form-group">
              <label for="anime-cover">サムネイル画像URL</label>
              <input type="url" class="input-text" id="anime-cover" placeholder="例：https://..." value="${anime.coverUrl || ''}">
            </div>

            <!-- PV動画URL -->
            <div class="form-group">
              <label for="anime-pv">PV動画URL (YouTubeなど)</label>
              <input type="url" class="input-text" id="anime-pv" placeholder="例：https://www.youtube.com/watch?v=..." value="${anime.pvUrl || ''}">
            </div>

            <!-- 視聴話数 -->
            <div class="form-group">
              <label for="anime-watched">視聴履歴 (何話まで)</label>
              <input type="number" class="input-text" id="anime-watched" min="0" placeholder="0" value="${anime.watchedEpisodes || 0}">
            </div>

            <!-- コピーライト -->
            <div class="form-group">
              <label for="anime-copyright">コピーライト</label>
              <input type="text" class="input-text" id="anime-copyright" placeholder="例：© 2022 作家名 / 芳文社" value="${anime.copyright || ''}">
            </div>

            <!-- 公式サイトURL -->
            <div class="form-group full-width">
              <label for="anime-official">公式サイトURL</label>
              <input type="url" class="input-text" id="anime-official" placeholder="例：https://..." value="${anime.officialUrl || ''}">
            </div>

            <!-- ステータス -->
            <div class="form-group full-width">
              <label>視聴状況</label>
              <div class="status-radio-group">
                <div class="status-radio-btn" data-status="read">
                  <input type="radio" name="anime-status" id="ast-read" value="read" ${anime.status === 'read' ? 'checked' : ''}>
                  <label class="status-radio-label" for="ast-read"><span class="dot" style="background:var(--status-read)"></span> 視聴完了</label>
                </div>
                <div class="status-radio-btn" data-status="watching">
                  <input type="radio" name="anime-status" id="ast-watching" value="watching" ${anime.status === 'watching' ? 'checked' : ''}>
                  <label class="status-radio-label" for="ast-watching"><span class="dot" style="background:var(--accent-blue)"></span> 視聴中</label>
                </div>
                <div class="status-radio-btn" data-status="want">
                  <input type="radio" name="anime-status" id="ast-want" value="want" ${anime.status === 'want' ? 'checked' : ''}>
                  <label class="status-radio-label" for="ast-want"><span class="dot" style="background:var(--status-want)"></span> 見たい</label>
                </div>
                <div class="status-radio-btn" data-status="paused">
                  <input type="radio" name="anime-status" id="ast-paused" value="paused" ${anime.status === 'paused' ? 'checked' : ''}>
                  <label class="status-radio-label" for="ast-paused"><span class="dot" style="background:var(--status-paused)"></span> 中断</label>
                </div>
                <div class="status-radio-btn" data-status="dropped">
                  <input type="radio" name="anime-status" id="ast-dropped" value="dropped" ${anime.status === 'dropped' ? 'checked' : ''}>
                  <label class="status-radio-label" for="ast-dropped"><span class="dot" style="background:var(--status-dropped)"></span> 視聴切り</label>
                </div>
              </div>
            </div>

            <!-- 星評価 -->
            <div class="form-group full-width">
              <label>マイ評価</label>
              <div class="star-rating-interactive" id="anime-star-container">
                ${[1, 2, 3, 4, 5].map(num => `
                  <button class="star-interactive ${num <= anime.rating ? 'filled' : ''}" data-star="${num}" type="button">
                    <i data-lucide="star"></i>
                  </button>
                `).join('')}
              </div>
            </div>

            <!-- あらすじ -->
            <div class="form-group full-width">
              <label for="anime-synopsis">あらすじ</label>
              <textarea class="textarea-custom" id="anime-synopsis" placeholder="アニメのあらすじ">${anime.synopsis || ''}</textarea>
            </div>

            <!-- 感想メモ -->
            <div class="form-group full-width">
              <label for="anime-review">感想・考察</label>
              <textarea class="textarea-custom" id="anime-review" placeholder="アニメ版の感想や、作画、演出、音楽などのメモを書き記せます。">${anime.review || ''}</textarea>
            </div>

          </div>

          <!-- 保存・削除アクション -->
          <div class="form-actions" style="margin-top: 1.5rem;">
            ${isEdit ? `
              <button class="btn-danger" id="btn-delete-anime" style="margin-right: auto;"><i data-lucide="trash-2"></i> 削除</button>
            ` : ''}
            <button class="btn-secondary" id="btn-cancel-anime">キャンセル</button>
            <button class="btn-primary" id="btn-save-anime"><i data-lucide="check"></i> 保存する</button>
          </div>
        </div>
      </div>
    `;

    this.openModal(modalHtml);

    let selectedRating = anime.rating;
    const starContainer = document.getElementById('anime-star-container');
    const stars = starContainer.querySelectorAll('.star-interactive');

    stars.forEach(star => {
      star.addEventListener('click', () => {
        const rating = parseInt(star.getAttribute('data-star'), 10);
        selectedRating = rating;
        
        stars.forEach((s, idx) => {
          s.classList.toggle('filled', idx < rating);
        });
      });
    });

    document.getElementById('btn-cancel-anime').addEventListener('click', () => this.closeModal());

    document.getElementById('btn-save-anime').addEventListener('click', () => {
      const title = document.getElementById('anime-title').value.trim();
      if (!title) {
        this.showToast('アニメ作品名を入力してください。', 'red');
        return;
      }

      const linkedMangaTitle = document.getElementById('anime-link-manga').value;
      const broadcastDate = document.getElementById('anime-broadcast').value.trim();
      const episodes = document.getElementById('anime-episodes').value.trim();
      const status = document.querySelector('input[name="anime-status"]:checked').value;
      const review = document.getElementById('anime-review').value.trim();
      const synopsis = document.getElementById('anime-synopsis').value.trim();

      const coverUrl = document.getElementById('anime-cover').value.trim();
      const pvUrl = document.getElementById('anime-pv').value.trim();
      const watchedEpisodes = parseInt(document.getElementById('anime-watched').value) || 0;
      const copyright = document.getElementById('anime-copyright').value.trim();
      const officialUrl = document.getElementById('anime-official').value.trim();

      if (isEdit) {
        const idx = this.userAnime.findIndex(a => a.id === animeId);
        if (idx !== -1) {
          this.userAnime[idx] = {
            id: animeId,
            title, linkedMangaTitle, broadcastDate, episodes, status, rating: selectedRating, review, synopsis, coverUrl, pvUrl, watchedEpisodes, copyright, officialUrl
          };
        }
      } else {
        const newAnime = {
          id: `anime_${Date.now()}`,
          title, linkedMangaTitle, broadcastDate, episodes, status, rating: selectedRating, review, synopsis, coverUrl, pvUrl, watchedEpisodes, copyright, officialUrl
        };
        this.userAnime.push(newAnime);
      }

      this.saveLocalStorage();
      this.showToast(isEdit ? 'アニメ情報を更新しました！' : 'アニメ情報を登録しました！', 'blue');
      this.render();
      this.closeModal();
    });

    if (isEdit) {
      document.getElementById('btn-delete-anime').addEventListener('click', () => {
        if (confirm(`本当に「${anime.title}」を削除しますか？`)) {
          this.userAnime = this.userAnime.filter(a => a.id !== animeId);
          this.saveLocalStorage();
          this.showToast('アニメ情報を削除しました。', 'red');
          this.render();
          this.closeModal();
        }
      });
    }
  }

  // --- 設定・バックアップ管理タブのレンダリング ---

  renderSettingsTab() {
    const jsonTemplate = JSON.stringify([
      {
        "id": "custom_manga_example",
        "title": "オリジナルきらら作品",
        "volume": 1,
        "fullTitle": "オリジナルきらら作品　第１巻",
        "author": "きららファン",
        "label": "KRコミックス",
        "releaseDate": "2026-05-31",
        "synopsis": "手動で追加するコミックス情報を直接JSONでインポート・バックアップするためのサンプルテンプレートです。",
        "coverUrl": "https://placehold.co/300x420",
        "cid": "9999"
      }
    ], null, 2);

    const settingsHtml = `
      <div class="settings-section">
        
        <!-- コミックスデータのインポート・エクスポート -->
        <div class="settings-card fade-in">
          <h3 class="settings-card-title"><i data-lucide="database"></i> ユーザーデータのバックアップと移行</h3>
          <p class="settings-desc">
            これまで記録したコミックスの巻別読書状態、作品単位ステータス、星評価、感想、手動で追加したコミックス情報、およびアニメ情報を含む<strong>すべてのデータ</strong>をエクスポートしたり、以前バックアップしたファイルをインポートすることができます。
          </p>
          <div class="settings-actions">
            <button class="btn-primary" id="btn-export-data"><i data-lucide="download"></i> マイデータをエクスポート (JSON)</button>
            
            <label class="btn-secondary" for="input-import-data" style="margin: 0; display: inline-flex; align-items: center; gap: 0.5rem;">
              <i data-lucide="upload"></i> データをインポート (JSON)
              <input type="file" id="input-import-data" accept=".json" style="display: none;">
            </label>

            <button class="btn-danger" id="btn-reset-data"><i data-lucide="alert-triangle"></i> 全データを完全リセット</button>
          </div>
        </div>

        <!-- マニュアル操作について -->
        <div class="settings-card fade-in" style="animation-delay: 0.1s;">
          <h3 class="settings-card-title"><i data-lucide="help-circle"></i> マニュアルデータ管理機能について</h3>
          <p class="settings-desc">
            当アプリは、外部サービスや複雑なコマンドラインを実行することなく、ブラウザ上で直感的に<strong>すべてのマンガ作品およびアニメ作品の情報を手動で追加・編集・削除</strong>できるように見直しを行いました。
          </p>
          
          <h4 style="font-size:0.95rem; font-weight:700; margin-bottom:0.5rem; color:var(--text-primary);">【マンガデータの管理】</h4>
          <p class="settings-desc">
            コミックス一覧画面の右上にある「<strong>コミックスを手動追加</strong>」ボタンから、いつでも新刊や別のきらら作品を追加できます。また、手動追加したマンガの詳細画面を開くと、メタデータの編集や削除が簡単に行えます。
          </p>

          <h4 style="font-size:0.95rem; font-weight:700; margin-bottom:0.5rem; color:var(--text-primary);">【アニメデータの管理】</h4>
          <p class="settings-desc">
            アニメ管理画面の右上にある「<strong>アニメ作品を手動追加</strong>」ボタンから登録できます。原作マンガと連携させることで、マンガ側からも自分の視聴記録が一元管理されます。
          </p>

          <h4 style="font-size:0.95rem; font-weight:700; margin-bottom:0.5rem; color:var(--text-primary);"><i data-lucide="file-json"></i> 自主インポート用のJSONフォーマットテンプレート</h4>
          <p class="settings-desc" style="margin-bottom:0.5rem;">
            バックアップファイルをインポートする際、以下のフォーマットに沿って記述された自作のJSONファイルを直接インポートして、本棚のリストを一気に追加することも可能です。
          </p>
          <pre class="scraper-code-box">${jsonTemplate}</pre>
        </div>

      </div>
    `;

    this.settingsGrid.innerHTML = '';
    const container = document.createElement('div');
    container.innerHTML = settingsHtml;
    this.settingsGrid.appendChild(container);

    // イベントバインド
    document.getElementById('btn-export-data').addEventListener('click', () => this.exportUserData());
    document.getElementById('input-import-data').addEventListener('change', (e) => this.importUserData(e));
    document.getElementById('btn-reset-data').addEventListener('click', () => this.resetUserData());
  }

  // ユーザーデータをJSONファイルとしてダウンロード出力
  exportUserData() {
    const exportData = {
      version: "1.0",
      exportDate: new Date().toISOString(),
      userComics: this.userComics,
      userMangaWorks: this.userMangaWorks,
      userAnime: this.userAnime,
      userCustomComics: this.userCustomComics,
      comics: this.comics
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `kirara_manager_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    this.showToast('データを正常にエクスポートしました！', 'blue');
  }

  // ユーザーデータJSONファイルを読み込んでマージ/復元
  importUserData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        
        if (imported.userComics || imported.userMangaWorks || imported.userAnime || imported.userCustomComics || Array.isArray(imported)) {
          
          if (Array.isArray(imported)) {
            // コミックス情報リストの場合 (手動追加に合算)
            const existingIds = new Set(this.comics.map(c => c.id));
            const newComics = imported.filter(c => c.id && c.title && !existingIds.has(c.id));
            
            if (newComics.length > 0) {
              this.userCustomComics = [...this.userCustomComics, ...newComics];
              this.comics = [...this.comics, ...newComics];
              this.saveLocalStorage();
              this.showToast(`${newComics.length} 件のコミックスデータを手動追加マージしました！`, 'blue');
            } else {
              this.showToast('追加できる新しいコミックス情報は検出されませんでした。', 'red');
            }
          } else {
            // フルバックアップ形式の場合
            if (imported.userComics) this.userComics = { ...this.userComics, ...imported.userComics };
            if (imported.userMangaWorks) this.userMangaWorks = { ...this.userMangaWorks, ...imported.userMangaWorks };
            
            if (imported.userAnime) {
              const existingAnimeIds = new Set(this.userAnime.map(a => a.id));
              const newAnime = (imported.userAnime || []).filter(a => !existingAnimeIds.has(a.id));
              this.userAnime = [...this.userAnime, ...newAnime];
            }
            
            if (imported.userCustomComics) {
              const existingCustomIds = new Set(this.userCustomComics.map(c => c.id));
              const newCustom = (imported.userCustomComics || []).filter(c => !existingCustomIds.has(c.id));
              this.userCustomComics = [...this.userCustomComics, ...newCustom];
            }
            
            // 全コミックスリストを再構築
            await this.loadComicsData();
            this.saveLocalStorage();
            this.showToast('マイデータのバックアップを正常に復元しました！', 'blue');
          }
          
          this.render();
        } else {
          this.showToast('無効なJSONファイルフォーマットです。', 'red');
        }
      } catch (err) {
        console.error(err);
        this.showToast('JSONファイルのパースに失敗しました。', 'red');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  // LocalStorageのリセット処理
  async resetUserData() {
    if (confirm('【警告】すべての読書記録、評価、感想、追加した手動マンガ・アニメ作品情報が完全に削除されます。よろしいですか？')) {
      if (confirm('本当に削除しますか？この操作は取り消せません。')) {
        this.userComics = {};
        this.userMangaWorks = {};
        this.userAnime = [];
        this.userCustomComics = [];
        this.saveLocalStorage();
        await this.loadComicsData(); // 再ロード
        this.showToast('すべてのユーザー記録をリセットしました。', 'red');
        this.switchTab('manga');
      }
    }
  }

  // --- 新機能追加用メソッド ---

  renderPaginationUI(container, totalPages, type) {
    if (!container) return;
    container.innerHTML = '';
    
    if (totalPages <= 1) return;

    const maxBtns = 5;
    let startPage = Math.max(1, this.currentPage - Math.floor(maxBtns / 2));
    let endPage = startPage + maxBtns - 1;
    if (endPage > totalPages) {
      endPage = totalPages;
      startPage = Math.max(1, endPage - maxBtns + 1);
    }

    const controls = document.createElement('div');
    controls.className = 'pagination-controls';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'pagination-btn';
    prevBtn.disabled = this.currentPage === 1;
    prevBtn.innerHTML = '<i data-lucide="chevron-left"></i> 前へ';
    prevBtn.addEventListener('click', () => {
      this.currentPage--;
      this.render();
    });
    controls.appendChild(prevBtn);

    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = document.createElement('button');
      pageBtn.className = 'pagination-btn';
      if (i === this.currentPage) {
        pageBtn.style.background = 'var(--accent-gradient)';
        pageBtn.style.color = 'white';
        pageBtn.style.borderColor = 'transparent';
      }
      pageBtn.textContent = i;
      pageBtn.addEventListener('click', () => {
        this.currentPage = i;
        this.render();
      });
      controls.appendChild(pageBtn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = 'pagination-btn';
    nextBtn.disabled = this.currentPage === totalPages;
    nextBtn.innerHTML = '次へ <i data-lucide="chevron-right"></i>';
    nextBtn.addEventListener('click', () => {
      this.currentPage++;
      this.render();
    });
    controls.appendChild(nextBtn);

    container.appendChild(controls);
  }

  showAnimeDetail(animeId) {
    const anime = this.userAnime.find(a => a.id === animeId);
    if (!anime) return;

    let pvEmbedHtml = '';
    if (anime.pvUrl) {
      let embedUrl = anime.pvUrl;
      if (embedUrl.includes('youtube.com/watch?v=')) {
        embedUrl = embedUrl.replace('youtube.com/watch?v=', 'youtube.com/embed/').split('&')[0] + '?autoplay=1';
      } else if (embedUrl.includes('youtu.be/')) {
        embedUrl = embedUrl.replace('youtu.be/', 'youtube.com/embed/').split('?')[0] + '?autoplay=1';
      }
      pvEmbedHtml = `
        <div style="margin-top: 1rem; width: 100%; aspect-ratio: 16/9; background: #000; border-radius: var(--radius-sm); overflow: hidden; margin-bottom: 1rem;">
          <iframe width="100%" height="100%" src="${embedUrl}" title="PV" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
        </div>
      `;
    }

    const modalHtml = `
      <div class="modal-body" style="max-width: 800px; margin: 0 auto;">
        <div class="detail-grid" style="grid-template-columns: 240px 1fr; gap: 2rem;">
          <div class="detail-left">
            <img class="detail-cover" src="${anime.coverUrl || 'https://placehold.co/300x420/1b0f33/f5f3f7?text=' + encodeURIComponent(anime.title)}" alt="${anime.title}" style="aspect-ratio: 1/1.4; object-fit: cover; border-radius: var(--radius-md);">
            <div class="detail-meta-table">
              <div class="meta-item">
                <span class="label">放送時期</span>
                <span class="val">${anime.broadcastDate || '不明'}</span>
              </div>
              <div class="meta-item">
                <span class="label">話数</span>
                <span class="val">${anime.episodes || '不明'}</span>
              </div>
              <div class="meta-item">
                <span class="label">原作連携</span>
                <span class="val" ${anime.linkedMangaTitle ? `style="color: var(--accent-blue); cursor: pointer; text-decoration: underline;" onclick="window.app.showGroupedDetail('${anime.linkedMangaTitle}')"` : ''}>${anime.linkedMangaTitle || 'なし'}</span>
              </div>
            </div>
            ${anime.pvUrl && !pvEmbedHtml ? `
              <a href="${anime.pvUrl}" target="_blank" class="btn-primary" style="width: 100%; display: flex; justify-content: center; margin-top: 1rem; text-decoration: none;">
                <i data-lucide="youtube"></i> PVを見る
              </a>
            ` : ''}
          </div>
          <div class="detail-right">
            <h2 class="detail-title">${anime.title}</h2>
            <div class="form-actions" style="justify-content: flex-start; margin-top: 1rem; margin-bottom: 2rem;">
              <button class="btn-secondary" id="btn-edit-anime-info"><i data-lucide="edit-3"></i> 情報を編集する</button>
            </div>
            ${pvEmbedHtml}
            ${anime.synopsis ? `
            <div class="detail-synopsis-box" style="margin-bottom: 1rem;">
              <strong>あらすじ：</strong><br>
              ${anime.synopsis.replace(/\\n/g, '<br>')}
            </div>
            ` : ''}
            <div class="detail-synopsis-box">
              <strong>視聴メモ・感想：</strong><br>
              ${anime.review ? anime.review.replace(/\\n/g, '<br>') : 'メモはありません。'}
            </div>
          </div>
        </div>
      </div>
    `;

    this.openModal(modalHtml);

    document.getElementById('btn-edit-anime-info').addEventListener('click', () => {
      this.showAddAnimeModal(animeId);
    });
  }

  renderHomeTab(container) {
    if (!container) return;

    let totalMangaVolumes = 0;
    let readMangaVolumes = 0;
    
    // Group logic to get volume counts
    this.comics.forEach(c => {
      totalMangaVolumes++;
      const userState = this.userComics[c.id] || { status: 'unread' };
      if (userState.status === 'read') {
        readMangaVolumes++;
      }
    });

    const totalAnime = this.userAnime.length;
    const watchedAnime = this.userAnime.filter(a => a.status === 'read').length;

    // Recommendations (Random 3 works)
    const titles = [...new Set(this.comics.map(c => c.title))];
    const shuffledTitles = titles.sort(() => 0.5 - Math.random()).slice(0, 3);
    const recommendedHtml = shuffledTitles.map(t => {
      const group = this.comics.filter(c => c.title === t).sort((a, b) => a.volume - b.volume);
      const firstVol = group[0];
      return `
        <div class="vol-card" onclick="window.app.showGroupedDetail('${t}')" style="min-width: 100px; max-width: 120px; flex: 1;">
          <img class="vol-card-cover" src="${firstVol.coverUrl}" onerror="this.src='https://placehold.co/100x140/1b0f33/f5f3f7?text=${encodeURIComponent(t)}'">
          <div class="vol-card-info" style="padding: 0.4rem;">
            <span class="vol-card-title" style="font-size: 0.7rem;">${t}</span>
            <span class="vol-card-badge" style="color:var(--accent-pink); font-size: 0.6rem;">おすすめ</span>
          </div>
        </div>
      `;
    }).join('');

    // Reading / Watching now
    const readingManga = this.comics.filter(c => (this.userComics[c.id] || {}).status === 'reading').slice(0, 5);
    const readingMangaHtml = readingManga.length > 0 ? readingManga.map(v => `
        <div class="vol-card" onclick="window.app.showBookDetail('${v.id}')">
          <img class="vol-card-cover" src="${v.coverUrl}" onerror="this.src='https://placehold.co/100x140/1b0f33/f5f3f7?text=${encodeURIComponent(v.title)}'">
          <div class="vol-card-info">
            <span class="vol-card-title">${v.fullTitle}</span>
            <span class="vol-card-badge" style="color:#60a5fa;">読書中</span>
          </div>
        </div>
    `).join('') : '<p style="color: var(--text-muted); font-size: 0.9rem;">現在読書中の作品はありません。</p>';

    const watchingAnime = this.userAnime.filter(a => a.status === 'watching').slice(0, 5);
    const watchingAnimeHtml = watchingAnime.length > 0 ? watchingAnime.map(a => `
        <div class="vol-card" onclick="window.app.showAnimeDetail('${a.id}')">
          <img class="vol-card-cover" src="${a.coverUrl || 'https://placehold.co/100x100/1b0f33/f5f3f7?text=Anime'}" style="aspect-ratio: 1/1;">
          <div class="vol-card-info">
            <span class="vol-card-title">${a.title}</span>
            <span class="vol-card-badge" style="color:cyan;">視聴中</span>
          </div>
        </div>
    `).join('') : '<p style="color: var(--text-muted); font-size: 0.9rem;">現在視聴中のアニメはありません。</p>';

    const html = `
      <div class="home-grid">
        <section class="home-section fade-in">
          <h3 class="home-section-title"><i data-lucide="bar-chart-2"></i> ライブラリ統計</h3>
          <div class="home-stats-container">
            <div class="home-stat-card" style="cursor: pointer;" onclick="document.querySelector('#tab-manga').click(); Array.from(document.querySelectorAll('#section-manga .status-tag-btn')).forEach(b=>b.classList.remove('active')); const rb = document.querySelector('#section-manga .status-tag-btn[data-status=\'read\']'); if(rb) rb.classList.add('active'); window.app.filters.status='read'; window.app.currentPage=1; window.app.render();">
              <div class="icon-wrapper" style="background: linear-gradient(135deg, #f43f5e, #e11d48);"><i data-lucide="book-open"></i></div>
              <div>
                <div class="stat-value">${readMangaVolumes} <span style="font-size: 1rem; color: var(--text-secondary);">/ ${totalMangaVolumes}巻</span></div>
                <div class="stat-label">読んだコミックス</div>
              </div>
            </div>
            <div class="home-stat-card" style="cursor: pointer;" onclick="document.querySelector('#tab-anime').click(); Array.from(document.querySelectorAll('#section-anime .status-tag-btn')).forEach(b=>b.classList.remove('active')); const ab = document.querySelector('#section-anime .status-tag-btn[data-status=\'read\']'); if(ab) ab.classList.add('active'); window.app.filters.status='read'; window.app.currentPage=1; window.app.render();">
              <div class="icon-wrapper" style="background: linear-gradient(135deg, #3b82f6, #2563eb);"><i data-lucide="tv"></i></div>
              <div>
                <div class="stat-value">${watchedAnime} <span style="font-size: 1rem; color: var(--text-secondary);">/ ${totalAnime}作</span></div>
                <div class="stat-label">視聴完了したアニメ</div>
              </div>
            </div>
          </div>
        </section>

        <section class="home-section fade-in" style="animation-delay: 0.1s;">
          <h3 class="home-section-title"><i data-lucide="play-circle"></i> 現在楽しんでいる作品</h3>
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <div>
              <h4 style="margin-bottom: 0.5rem; font-size: 1rem;"><i data-lucide="book"></i> コミックス (読書中)</h4>
              <div class="volumes-card-grid" style="grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));">
                ${readingMangaHtml}
              </div>
            </div>
            <div>
              <h4 style="margin-bottom: 0.5rem; font-size: 1rem;"><i data-lucide="monitor-play"></i> アニメ (視聴中)</h4>
              <div class="volumes-card-grid" style="grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));">
                ${watchingAnimeHtml}
              </div>
            </div>
          </div>
        </section>

        <section class="home-section fade-in" style="animation-delay: 0.2s;">
          <h3 class="home-section-title"><i data-lucide="sparkles"></i> ランダムピックアップ</h3>
          <p style="color: var(--text-secondary); margin-bottom: 1rem; font-size: 0.9rem;">ライブラリから無作為に3作品を選びました。</p>
          <div style="display: flex; gap: 1.5rem; overflow-x: auto; padding-bottom: 1rem;">
            ${recommendedHtml}
          </div>
        </section>
      </div>
    `;

    container.innerHTML = html;
  }
}

// アプリのグローバルインスタンスの作成
document.addEventListener('DOMContentLoaded', () => {
  window.app = new KiraraApp();
});
