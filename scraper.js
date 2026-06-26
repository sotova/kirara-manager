/**
 * 芳文社公式サイト コミックススクレイパー
 *
 * 対象URL:
 * https://houbunsha.co.jp/search/labeldetail.php?p=kr,krforward,krtubomi,krgl,kryell,krgia
 *
 * 取得項目はアプリの JSON データ形式に合わせて以下へ正規化します。
 * id, title, volume, fullTitle, author, label, releaseDate, synopsis, coverUrl, cid, detailUrl
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

const BASE_URL = 'https://houbunsha.co.jp';
const LIST_URL = `${BASE_URL}/search/labeldetail.php?p=kr,krforward,krtubomi,krgl,kryell,krgia`;
const OUTPUT_FILE = path.join(__dirname, 'kirara_data.json');
const SLEEP_MS = 1500;
const DETAIL_LIMIT = Number(process.env.DETAIL_LIMIT || 0); // 0 = 全件

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanText(value) {
  return (value || '').replace(/\u00a0/g, ' ').replace(/[\t\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function absoluteUrl(url) {
  if (!url) return '';
  return new URL(url, BASE_URL).href;
}

function normalizeDate(dateStr) {
  const cleaned = cleanText(dateStr).replace(/発売日|発売|（|）|\(|\)/g, '').trim();
  const match = cleaned.match(/(\d{4})[\s/年.\-](\d{1,2})[\s/月.\-](\d{1,2})日?/);
  if (!match) return cleaned.replace(/\./g, '-').replace(/\//g, '-');
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function parseTitleAndVolume(fullTitle) {
  const normalized = cleanText(fullTitle).replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
  const match = normalized.match(/(?:第\s*)?(\d+)\s*巻(?:\s*\([^)]*発売\))?\s*$/);
  if (!match) return { title: normalized, volume: 1 };
  return {
    title: cleanText(normalized.slice(0, match.index)),
    volume: Number(match[1]) || 1
  };
}

function decodeResponse(buffer, contentType = '') {
  const lower = contentType.toLowerCase();
  if (lower.includes('shift_jis') || lower.includes('sjis')) return iconv.decode(buffer, 'shift_jis');
  if (lower.includes('euc-jp')) return iconv.decode(buffer, 'euc-jp');

  const utf8 = buffer.toString('utf8');
  const charset = utf8.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase();
  if (charset?.includes('shift') || charset?.includes('sjis')) return iconv.decode(buffer, 'shift_jis');
  if (charset?.includes('euc')) return iconv.decode(buffer, 'euc-jp');
  if (utf8.includes('�') || utf8.includes('����')) {
    const sjis = iconv.decode(buffer, 'shift_jis');
    if (!sjis.includes('�')) return sjis;
    return iconv.decode(buffer, 'euc-jp');
  }
  return utf8;
}

async function fetchHtml(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
      }
    });
    return decodeResponse(response.data, response.headers['content-type'] || '');
  } catch (error) {
    console.error(`ページの取得に失敗しました: ${url}`, error.message);
    return null;
  }
}

function extractFromStructuredList($) {
  const items = [];
  $('a[href*="/comics/detail.php"], a[href*="comics/detail.php"]').each((_, link) => {
    const $link = $(link);
    const detailUrl = absoluteUrl($link.attr('href'));
    const container = $link.closest('li, article, .item, .book, .comic, tr, div');
    const text = cleanText(container.text() || $link.text());
    if (!text) return;

    const rawTitle = cleanText($link.text()) || text.split(':')[0];
    const latestMatch = text.match(/最新刊\s*(\d+)\s*巻(?:[（(]([^）)]+発売)[）)])?/);
    const releaseMatch = text.match(/(\d{4}[/.年]\d{1,2}[/.月]\d{1,2}日?発売?)/);
    const labelMatch = text.match(/(まんがタイムKRコミックス(?:フォワードシリーズ)?|KRコミックス(?:フォワードシリーズ)?|つぼみシリーズ|GLシリーズ|きらら(?:ベース)?)/);
    const titleLine = latestMatch ? `${rawTitle} ${latestMatch[1]}巻` : rawTitle;
    const author = cleanText(text.replace(rawTitle, '').replace(latestMatch?.[0] || '').replace(releaseMatch?.[0] || '', '').replace(labelMatch?.[0] || '', '').replace(/最新刊|著者名|著者|レーベル|作品名|[:：]/g, '')) || '不明';
    const { title, volume } = parseTitleAndVolume(titleLine.replace(/最新刊\s*/, ''));
    const cid = new URL(detailUrl).searchParams.get('p') || Buffer.from(detailUrl).toString('base64url').slice(0, 16);

    items.push({
      id: `houbunsha_${cid}_${volume}`,
      title,
      volume,
      fullTitle: titleLine,
      author,
      label: labelMatch?.[1] || labelMatch?.[0] || 'まんがタイムKRコミックス',
      releaseDate: normalizeDate(releaseMatch?.[1] || ''),
      synopsis: 'あらすじ情報はありません。',
      coverUrl: absoluteUrl(container.find('img').first().attr('src') || ''),
      cid,
      detailUrl
    });
  });
  return items;
}

async function scrapeComicsList() {
  console.log(`取得先: ${LIST_URL}`);
  const html = await fetchHtml(LIST_URL);
  if (!html) return [];
  const $ = cheerio.load(html);
  return extractFromStructuredList($);
}

function readTableValue($, label) {
  let value = '';
  $('tr').each((_, tr) => {
    const head = cleanText($(tr).find('th,td').first().text());
    if (head.includes(label)) value = cleanText($(tr).find('td').last().text());
  });
  return value;
}

async function enrichBookDetails(book) {
  if (!book.detailUrl) return book;
  const html = await fetchHtml(book.detailUrl);
  if (!html) return book;
  const $ = cheerio.load(html);
  const bodyText = cleanText($('body').text());

  const author = readTableValue($, '著者') || readTableValue($, '作者') || bodyText.match(/著者名?\s*[:：]?\s*([^\s:：]+(?:\s*[:：][^\s:：]+)?)/)?.[1];
  const label = readTableValue($, 'レーベル') || bodyText.match(/(まんがタイムKRコミックス(?:フォワードシリーズ)?|KRコミックス(?:フォワードシリーズ)?)/)?.[1];
  const releaseDate = readTableValue($, '発売日') || bodyText.match(/\d{4}[/.年]\d{1,2}[/.月]\d{1,2}日?/)?.[0];
  const synopsis = cleanText($('.introduction, .story, .synopsis, .description, .worksIntroduction, .contents, #contents p').filter((_, el) => cleanText($(el).text()).length > 30).first().text()) || readTableValue($, '作品紹介');
  const coverUrl = absoluteUrl($('img[src*="comic"], img[src*="books"], img').first().attr('src') || book.coverUrl);

  return {
    ...book,
    author: cleanText(author) || book.author,
    label: cleanText(label) || book.label,
    releaseDate: normalizeDate(releaseDate) || book.releaseDate,
    synopsis: synopsis || book.synopsis,
    coverUrl
  };
}

async function run() {
  console.log('芳文社公式サイト コミックススクレイパーを開始します');
  const detectedBooks = await scrapeComicsList();
  if (detectedBooks.length === 0) {
    console.error('作品情報が見つかりませんでした。');
    process.exitCode = 1;
    return;
  }

  const limit = DETAIL_LIMIT > 0 ? Math.min(DETAIL_LIMIT, detectedBooks.length) : detectedBooks.length;
  const enrichedBooks = [];
  for (let i = 0; i < detectedBooks.length; i += 1) {
    const book = i < limit ? await enrichBookDetails(detectedBooks[i]) : detectedBooks[i];
    enrichedBooks.push(book);
    console.log(`${i + 1}/${detectedBooks.length}: ${book.fullTitle} / ${book.author} / ${book.releaseDate}`);
    if (i < limit - 1) await sleep(SLEEP_MS);
  }

  let mergedData = enrichedBooks;
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
      const map = new Map(existingData.map((b) => [b.cid || b.id, b]));
      enrichedBooks.forEach((b) => map.set(b.cid || b.id, b));
      mergedData = Array.from(map.values());
    } catch (error) {
      console.warn('既存JSONを読み込めないため、新規データで保存します。', error.message);
    }
  }
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(mergedData, null, 2)}\n`, 'utf8');
  console.log(`保存しました: ${OUTPUT_FILE}`);
}

if (require.main === module) run();
