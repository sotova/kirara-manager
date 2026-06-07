/**
 * まんがタイムきららコミックス スクレイパー (scraper.js) - 更新版
 * 
 * 最新の「まんがタイムきららWeb」のコミックス一覧（/comics/）のサイト構造に対応したスクレイパーです。
 * 
 * 【新しいサイト構造の解析結果】
 * - 一覧URL: https://www.dokidokivisual.com/comics/
 * - 各書籍要素: a.list-item.inner（href="https://www.dokidokivisual.com/comics/[id]"）
 * - カバー画像: img src
 * - タイトル: p.title
 * - 発売日: span.number
 * - レーベル: dd.body (または dl / dd の構成)
 * 
 * 【動作フロー】
 * 1. 一覧ページから上記要素を Cheerio を用いて一斉取得。
 * 2. 取得した各詳細リンク（https://www.dokidokivisual.com/comics/[id]）にアクセス。
 * 3. 詳細ページから「著者（作者）」および「あらすじ」を安全にスクレイピングして補完。
 * 4. 既存の `kirara_data.json` とマージして保存。
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

// 設定
const BASE_URL = 'https://www.dokidokivisual.com';
const LIST_URL = `${BASE_URL}/comics/`;
const OUTPUT_FILE = path.join(__dirname, 'kirara_data.json');

// 遅延処理（ミリ秒）- サーバーに負荷をかけないマナー設計
const SLEEP_MS = 1500; 
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 日付の正規化ユーティリティ (YYYY.MM.DD -> YYYY-MM-DD)
function normalizeDate(dateStr) {
  if (!dateStr) return '';
  const cleaned = dateStr.replace(/発売日[\s：:　]*/g, '').trim();
  const match = cleaned.match(/(\d{4})[\s/年.](\d{1,2})[\s/月.](\d{1,2})日?/);
  if (match) {
    const year = match[1];
    const month = match[2].padStart(2, '0');
    const day = match[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return cleaned.replace(/\./g, '-').replace(/\//g, '-');
}

// タイトルと巻数の分割
function parseTitleAndVolume(fullTitle) {
  let title = fullTitle;
  let volume = 1;
  const volMatch = fullTitle.match(/(第(\d+|[一二三四五六七八九十]|上|中|下|アンソロジー)巻|(\d+)巻|(\d+)$)/);
  if (volMatch) {
    const volStr = volMatch[2] || volMatch[3] || volMatch[4];
    if (!isNaN(volStr)) {
      volume = parseInt(volStr, 10);
    } else {
      const kanjiMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '上': 1, '中': 2, '下': 3 };
      volume = kanjiMap[volStr] || 1;
    }
    title = fullTitle.replace(volMatch[0], '').replace(/\s+/g, ' ').trim();
  }
  return { title, volume };
}

// HTML取得ユーティリティ（文字化け対策 Shift_JISデコード対応）
async function fetchHtml(url) {
  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
      }
    });
    
    const contentType = response.headers['content-type'] || '';
    let html = '';
    
    // きららWebはShift_JISが多く使われているため、デコードを慎重に行う
    if (contentType.includes('shift_jis') || contentType.includes('sjis')) {
      try {
        const iconv = require('iconv-lite');
        html = iconv.decode(response.data, 'shift-jis');
      } catch (e) {
        html = response.data.toString('utf-8');
      }
    } else {
      html = response.data.toString('utf-8');
      // 文字化けの簡易チェックとフォールバック
      if (html.includes('縺') || html.includes('縺ゅ') || html.includes('')) {
        try {
          const iconv = require('iconv-lite');
          html = iconv.decode(response.data, 'shift-jis');
        } catch (e) {
          // iconv-liteがない場合はそのまま
        }
      }
    }
    return html;
  } catch (error) {
    console.error(`ページの取得に失敗しました: ${url}`, error.message);
    return null;
  }
}

// 一覧ページから全コミックス基本情報を抽出する
async function scrapeComicsList() {
  console.log(`\n--- コミックス一覧ページから基本データを抽出します ---`);
  console.log(`取得先: ${LIST_URL}`);
  
  const html = await fetchHtml(LIST_URL);
  if (!html) {
    console.error('一覧ページのHTMLが取得できませんでした。');
    return [];
  }
  
  const $ = cheerio.load(html);
  const items = [];
  
  // a.list-item.inner または a.list-item でかつ class に inner を含むものを探索
  $('a.list-item').each((i, el) => {
    const $el = $(el);
    
    // "inner" クラスを持っているかダブルチェック
    if (!$el.hasClass('inner')) return;
    
    // 1. 詳細リンク
    let href = $el.attr('href') || '';
    if (href && !href.startsWith('http')) {
      href = `${BASE_URL}${href.startsWith('/') ? '' : '/comics/'}${href}`;
    }
    
    // コミックスIDの抽出 (例: https://www.dokidokivisual.com/comics/13294 -> 13294)
    const idMatch = href.match(/comics\/(\d+)/);
    const cid = idMatch ? idMatch[1] : `local_${i}_${Date.now()}`;
    
    // 2. 表紙カバー画像
    let coverUrl = $el.find('img').attr('src') || '';
    if (coverUrl && !coverUrl.startsWith('http')) {
      coverUrl = `${BASE_URL}${coverUrl.startsWith('/') ? '' : '/comics/'}${coverUrl}`;
    }
    
    // 3. タイトル
    const fullTitle = $el.find('p.title').text().trim();
    if (!fullTitle) return; // タイトルがなければスキップ
    
    const { title, volume } = parseTitleAndVolume(fullTitle);
    
    // 4. 発売日
    const releaseDateRaw = $el.find('span.number').text().trim();
    const releaseDate = normalizeDate(releaseDateRaw);
    
    // 5. レーベル
    let label = $el.find('dd.body').text().trim();
    if (!label) {
      // dl -> dd 構造などのフォールバック
      label = $el.find('dd').text().trim() || 'まんがタイムKRコミックス';
    }
    // レーベル名から「レーベル：」を取り除く
    label = label.replace(/レーベル[\s：:　]*/g, '').trim();
    
    items.push({
      id: `scraped_${cid}`,
      title,
      volume,
      fullTitle,
      author: '不明', // 詳細ページから後ほど取得
      label,
      releaseDate,
      synopsis: 'あらすじ情報はありません。', // 詳細ページから後ほど取得
      coverUrl,
      cid,
      detailUrl: href
    });
  });
  
  console.log(`抽出完了: 一覧から ${items.length} 件の作品情報を検出しました。\n`);
  return items;
}

// 各詳細ページから「著者」と「あらすじ」を安全に補完する
async function enrichBookDetails(book) {
  if (!book.detailUrl) return book;
  
  console.log(`詳細データを解析して補完中: ${book.fullTitle} (ID: ${book.cid})...`);
  const html = await fetchHtml(book.detailUrl);
  if (!html) return book;
  
  const $ = cheerio.load(html);
  const pageText = $('body').text();
  
  // 1. 著者の抽出
  let author = '不明';
  const authorMatch = pageText.match(/(著者|作|画|著者名|作画)[\s：:　]*([^\n\r\|★◆\<\>（）\s]+)/);
  if (authorMatch) {
    author = authorMatch[2].trim();
  } else {
    // セレクタによる抽出の試み
    const authorSelector = $('.author, .writer, .book_detail_author, .name, .profile h4').first().text().trim();
    if (authorSelector) author = authorSelector;
  }
  
  // 余分な接頭辞の除去
  author = author.replace(/著者[\s：:　]*/g, '').trim();
  book.author = author;
  
  // 2. あらすじの抽出
  let synopsis = '';
  // 良く使われるあらすじ用クラスまたは紹介テキストブロック
  const synopsisBlock = $('.story, .synopsis, .introduction, .book_detail_story, .book_detail_text, .text, .comment').text().trim();
  if (synopsisBlock) {
    synopsis = synopsisBlock;
  } else {
    // pタグを調べて、ある程度の長さがあり、JavaScriptコードやコピーライトを含まない日本語の長文をあらすじとする
    let longestText = '';
    $('p').each((i, el) => {
      const pText = $(el).text().trim();
      if (pText.length > longestText.length && pText.length > 35 && pText.length < 500 && !pText.includes('JavaScript') && !pText.includes('著作権') && !pText.includes('推奨')) {
        longestText = pText;
      }
    });
    synopsis = longestText;
  }
  
  if (synopsis) {
    book.synopsis = synopsis.replace(/\s+/g, ' ').trim();
  }
  
  return book;
}

// メイン実行関数
async function run() {
  console.log('===================================================');
  console.log(' 新・まんがタイムきららコミックス スクレイパーを開始します');
  console.log('===================================================');
  
  // 1. 一覧ページから全コミックスの基本情報をスクレイピング
  const detectedBooks = await scrapeComicsList();
  
  if (detectedBooks.length === 0) {
    console.error('作品情報が1件も見つかりませんでした。サイトの構造が変わったか、アクセス制限の可能性があります。');
    return;
  }
  
  const enrichedBooks = [];
  // サーバーの負荷に配慮し、先頭の10件を詳細ページまで深く巡回して取得（テスト用に制限）
  // 完全に全件を取得したい場合は、limit を detectedBooks.length に変更してください
  const limit = Math.min(detectedBooks.length, 10);
  console.log(`--- 検出した ${detectedBooks.length} 件のうち、先頭 ${limit} 件の詳細情報（著者・あらすじ）を補完します ---`);
  
  for (let i = 0; i < limit; i++) {
    let book = detectedBooks[i];
    try {
      book = await enrichBookDetails(book);
      enrichedBooks.push(book);
      console.log(`成功: 「${book.fullTitle}」著者: ${book.author} / 発売日: ${book.releaseDate}`);
    } catch (e) {
      console.error(`ID ${book.cid} の詳細補完中にエラーが発生しました:`, e.message);
      enrichedBooks.push(book); // エラーでも一覧から得た基本情報を残す
    }
    
    // マナー遅延
    await sleep(SLEEP_MS);
  }
  
  // 10件以降のデータも、詳細巡回はせず一覧の基本データとして保存に含める
  if (detectedBooks.length > limit) {
    console.log(`\n残り ${detectedBooks.length - limit} 件は詳細巡回をスキップし、一覧の基本データのみを保存します。`);
    for (let i = limit; i < detectedBooks.length; i++) {
      enrichedBooks.push(detectedBooks[i]);
    }
  }
  
  // 3. 既存のデータがあればマージする
  let mergedData = enrichedBooks;
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const existingContent = fs.readFileSync(OUTPUT_FILE, 'utf-8');
      const existingData = JSON.parse(existingContent);
      
      // 重複チェック（cid または id を基準にマージ）
      const existingMap = new Map(existingData.map(b => [b.cid || b.id, b]));
      
      enrichedBooks.forEach(newBook => {
        existingMap.set(newBook.cid || newBook.id, newBook);
      });
      
      mergedData = Array.from(existingMap.values());
      console.log(`\n既存データとマージ完了（既存: ${existingData.length}件 -> マージ後: ${mergedData.length}件）`);
    } catch (e) {
      console.log('既存の JSON ファイルの読み込みまたはパースに失敗したため、新規に上書き保存します。');
    }
  }
  
  // 4. JSONとして書き出す
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mergedData, null, 2), 'utf-8');
  console.log(`\nデータを保存しました: ${OUTPUT_FILE}`);
  console.log('===================================================');
  console.log(' スクレイパー処理が正常に完了しました！');
  console.log('===================================================');
}

// 実行
if (require.main === module) {
  try {
    require('iconv-lite');
  } catch (e) {
    console.log('【お知らせ】Shift_JIS デコード用に iconv-lite をインストールすることをお勧めします。');
    console.log('>> npm install iconv-lite\n');
  }
  
  run();
}
