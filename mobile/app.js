const DB_NAME = "margin-sentences";
const DB_VERSION = 2;
const STORES = ["sentences", "annotations", "entries", "links", "collections", "settings", "wordInsights"];
const READING_WORD_COLLECTION_ID = "words-reading";
const ANNOTATION_TYPES = { target: "词条", word: "生词", phrase: "短语", context: "语境", pattern: "句式", grammar: "语法" };
const ENTRY_TYPES = { word: "Word", phrase: "Phrase", pattern: "Pattern", other: "Other" };

const id = (prefix) => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const now = () => Date.now();
const escapeHTML = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const normalizeTerm = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const dateLabel = (value) => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
const wordCount = (text) => (String(text).match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      STORES.forEach((name) => { if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: "id" }); });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const db = {
  async all(store) { const database = await openDB(); return new Promise((resolve, reject) => { const request = database.transaction(store, "readonly").objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); },
  async put(store, record) { const database = await openDB(); return new Promise((resolve, reject) => { const request = database.transaction(store, "readwrite").objectStore(store).put(record); request.onsuccess = () => resolve(record); request.onerror = () => reject(request.error); }); },
  async remove(store, recordId) { const database = await openDB(); return new Promise((resolve, reject) => { const request = database.transaction(store, "readwrite").objectStore(store).delete(recordId); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); },
  async replaceAll(payload) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORES, "readwrite");
      STORES.forEach((store) => { const target = transaction.objectStore(store); target.clear(); (payload[store] || []).forEach((record) => target.put(record)); });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  },
};

let model = { sentences: [], annotations: [], entries: [], links: [], collections: [], settings: [], wordInsights: [] };
let ui = { screen: "reading", collectionId: null, wordbookCollectionId: null, wordbookReturn: "reading", wordbookType: "all", wordbookSort: "recent", wordbookMode: "read", wordbookShowOriginal: true, wordbookShowNotes: true, wordsLibraryOpen: false, wordsLibraryTab: "reading", wordsLibraryType: "all", wordCollectionId: "words-all", wordsMode: "read", wordBulkEditing: false, wordBulkSelection: [], wordExampleDisplay: "one", wordShowPhrases: true, wordShowSynonyms: true, sentenceId: null, entryId: null, entryTab: "examples", entryEditing: false, entryEditingTargetId: "", entryDrafts: {}, entryNewExampleCount: 0, entryInsightTargetId: "", entryInsightDrafts: {}, entryInsightNewCounts: {}, entrySynonymExampleCounts: {}, entrySynonymDrafts: {}, entryNewSynonymCount: 0, search: "", sort: "recent", sentenceSort: "recent", allCollectionSort: "recent", annotationSort: "recent", showAnnotations: true, showNotes: true, showAnnotationDetails: true, showSentenceNotes: true, showCollectionNames: true, bulkEditing: false, bulkSelection: [], sheet: null, selection: null, tokenSelection: [], appendAnnotationId: "", toast: "" };
let toastTimer;

async function load() {
  const values = await Promise.all(STORES.map((store) => db.all(store)));
  model = Object.fromEntries(STORES.map((store, index) => [store, values[index]]));
  let defaultCollection = model.collections.find((item) => item.scope !== "words" && item.isDefault);
  if (!defaultCollection) {
    defaultCollection = { id: id("collection"), name: "未分类", parentId: "", isDefault: true, createdAt: now(), updatedAt: now() };
    await db.put("collections", defaultCollection);
    model.collections.push(defaultCollection);
  }
  const unassigned = model.sentences.filter((sentence) => sentence.createdVia !== "wordExample" && !sentence.collectionId);
  if (unassigned.length) {
    await Promise.all(unassigned.map((sentence) => db.put("sentences", { ...sentence, collectionId: defaultCollection.id, updatedAt: now() })));
    model.sentences = model.sentences.map((sentence) => sentence.createdVia !== "wordExample" && !sentence.collectionId ? { ...sentence, collectionId: defaultCollection.id } : sentence);
  }
  if (!model.collections.some((item) => item.scope !== "words" && item.isAll)) {
    const allCollection = { id: id("collection"), name: "全部", parentId: "", isAll: true, createdAt: now(), updatedAt: now() };
    await db.put("collections", allCollection);
    model.collections.push(allCollection);
  }
  await ensureReadingWordCollection();
  await ensureColorfulDemo();
  render();
}

async function ensureReadingWordCollection() {
  if (model.collections.some((item) => item.id === READING_WORD_COLLECTION_ID)) return;
  const collection = { id: READING_WORD_COLLECTION_ID, name: "Reading", scope: "words", isSystem: true, createdAt: now(), updatedAt: now() };
  await db.put("collections", collection);
  model.collections.push(collection);
}

async function ensureColorfulDemo() {
  if (model.settings.some((item) => item.id === "colorful-demo")) return;
  let entry = model.entries.find((item) => item.normalizedTerm === "colorful");
  const timestamp = now();
  if (!entry) {
    entry = { id: id("entry"), term: "colorful", normalizedTerm: "colorful", kind: "word", hint: "", collectionId: "", createdAt: timestamp, updatedAt: timestamp };
    await db.put("entries", entry);
    model.entries.push(entry);
  }
  const phraseSamples = [
    ["basic", "colorful clothes", "色彩鲜艳的衣服"],
    ["basic", "colorful history", "丰富多彩的历史"],
    ["basic", "colorful display", "彩色展示"],
    ["context", "a colorful array of flowers", "五彩斑斓的花朵"],
    ["context", "a colorful and vibrant market", "热闹多彩的市场"],
    ["context", "wear colorful clothing", "穿着色彩鲜艳的衣服"],
    ["context", "colorful cultural traditions", "丰富多彩的文化传统"],
    ["context", "a colorful and lively festival", "欢快多彩的节日"],
  ].map(([group, phrase, meaning]) => ({ id: id("insight"), entryId: entry.id, type: "phrase", group, phrase, meaning, demo: true, createdAt: timestamp, updatedAt: timestamp }));
  const synonymSamples = [
    { term: "vibrant", description: "情感积极，常用来形容充满生机与活力的颜色或氛围。", examples: [["vibrant colors", "鲜艳的色彩"], ["a vibrant city", "一座充满活力的城市"]] },
    { term: "variegated", description: "情感中性，多用于描述物体表面有多种不规则色块的样貌。", examples: [["variegated leaves", "杂色叶子"], ["variegated marble", "杂色大理石"]] },
    { term: "kaleidoscopic", description: "情感积极，文学性强，强调色彩图案复杂且不断变化的动态美。", examples: [["a kaleidoscopic display", "万花筒般的展示"], ["kaleidoscopic patterns", "千变万化的图案"]] },
    { term: "bright", description: "情感中性，口语中通常直接描述颜色鲜明、不暗淡。", examples: [] },
  ].map(({ term, description, examples }) => ({ id: id("insight"), entryId: entry.id, type: "synonym", term, description, examples, demo: true, createdAt: timestamp, updatedAt: timestamp }));
  const insights = [...phraseSamples, ...synonymSamples];
  await Promise.all(insights.map((item) => db.put("wordInsights", item)));
  model.wordInsights.push(...insights);
  await db.put("settings", { id: "colorful-demo", value: true, createdAt: timestamp });
  model.settings.push({ id: "colorful-demo", value: true, createdAt: timestamp });
}

function flash(message) {
  ui.toast = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = ""; render(); }, 1800);
  render();
}

function entryFor(idValue) { return model.entries.find((item) => item.id === idValue); }
function sentenceFor(idValue) { return model.sentences.find((item) => item.id === idValue); }
function annotationFor(idValue) { return model.annotations.find((item) => item.id === idValue); }
function collectionFor(idValue) { return model.collections.find((item) => item.id === idValue); }
function linksForSentence(sentenceId) { return model.links.filter((item) => item.sentenceId === sentenceId); }
function linksForEntry(entryId) { return model.links.filter((item) => item.entryId === entryId); }
function insightsForEntry(entryId, type = "") { return model.wordInsights.filter((item) => item.entryId === entryId && (!type || item.type === type)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); }
function annotationsForSentence(sentenceId) { return model.annotations.filter((item) => item.sentenceId === sentenceId).sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset); }
function rememberedText(annotation) { return String(annotation.entryText || annotation.selectedText || "").trim(); }
function annotationRanges(annotation) {
  const ranges = Array.isArray(annotation.ranges) && annotation.ranges.length ? annotation.ranges : [{ startOffset: annotation.startOffset, endOffset: annotation.endOffset, selectedText: annotation.selectedText }];
  return ranges.filter((range) => Number.isInteger(range.startOffset) && Number.isInteger(range.endOffset) && range.endOffset > range.startOffset);
}
function wordTokens(sentence) {
  const tokens = [];
  const chunks = sentence.text.matchAll(/\S+/g);
  for (const chunk of chunks) {
    const chunkStart = chunk.index || 0;
    for (const word of chunk[0].matchAll(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)) {
      const startOffset = chunkStart + (word.index || 0);
      tokens.push({ sentenceId: sentence.id, startOffset, endOffset: startOffset + word[0].length, text: word[0] });
    }
  }
  return tokens;
}
function tokenKey(token) { return `${token.sentenceId}:${token.startOffset}:${token.endOffset}`; }
function tokenSelectionFor(sentence) {
  const selectedKeys = new Set((ui.tokenSelection || []).filter((token) => token.sentenceId === sentence.id).map(tokenKey));
  const tokens = wordTokens(sentence);
  const selected = tokens.filter((token) => selectedKeys.has(tokenKey(token)));
  if (!selected.length) return null;
  const ranges = [];
  selected.forEach((token) => {
    const previous = ranges.at(-1);
    const previousToken = previous?.lastToken;
    if (previousToken && previousToken.tokenIndex + 1 === tokens.indexOf(token)) {
      previous.endOffset = token.endOffset;
      previous.lastToken = { ...token, tokenIndex: tokens.indexOf(token) };
      return;
    }
    ranges.push({ startOffset: token.startOffset, endOffset: token.endOffset, lastToken: { ...token, tokenIndex: tokens.indexOf(token) } });
  });
  const cleanRanges = ranges.map(({ startOffset, endOffset }) => ({ startOffset, endOffset, selectedText: sentence.text.slice(startOffset, endOffset) }));
  return { sentenceId: sentence.id, ranges: cleanRanges, startOffset: cleanRanges[0].startOffset, endOffset: cleanRanges[0].endOffset, text: cleanRanges.map((range) => range.selectedText).join(" · "), count: selected.length };
}
function readingSentences() { return model.sentences.filter((sentence) => sentence.createdVia !== "wordExample"); }
function defaultCollection() { return model.collections.find((item) => item.scope !== "words" && item.isDefault) || model.collections.find((item) => item.scope !== "words" && item.name === "未分类" && !item.parentId); }
function rootCollections() { return model.collections.filter((item) => item.scope !== "words" && !item.parentId).sort((a, b) => Number(Boolean(b.isAll)) - Number(Boolean(a.isAll)) || Number(Boolean(a.isDefault)) - Number(Boolean(b.isDefault)) || a.name.localeCompare(b.name, "en")); }
function wordCollections() { return model.collections.filter((item) => item.scope === "words" && !item.isSystem).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); }
function wordCollectionFor(idValue) { return model.collections.find((item) => item.scope === "words" && item.id === idValue); }
function entryWordCollectionId(entry) { return wordCollectionFor(entry?.collectionId)?.id || ""; }
function wordCollectionName(entry) { return wordCollectionFor(entryWordCollectionId(entry))?.name || "未分类"; }
function entriesForWordCollection(collectionId) {
  if (collectionId === "words-all") return model.entries;
  if (collectionId === "words-phrases") return model.entries.filter((entry) => insightsForEntry(entry.id, "phrase").length);
  if (collectionId === "words-synonyms") return model.entries.filter((entry) => insightsForEntry(entry.id, "synonym").length);
  if (collectionId === "words-uncategorized") return model.entries.filter((entry) => !entryWordCollectionId(entry));
  return model.entries.filter((entry) => entryWordCollectionId(entry) === collectionId);
}
function collectionHomeRank(collectionId) {
  const collection = collectionFor(collectionId);
  const rootId = collection?.parentId || collection?.id;
  return rootCollections().filter((item) => !item.isAll).findIndex((item) => item.id === rootId);
}
function allCollectionSorted(sentences) {
  return [...sentences].sort((a, b) => collectionHomeRank(a.collectionId) - collectionHomeRank(b.collectionId) || (b.createdAt || 0) - (a.createdAt || 0));
}
function childrenFor(collectionId) { return model.collections.filter((item) => item.scope !== "words" && item.parentId === collectionId).sort((a, b) => a.name.localeCompare(b.name, "en")); }
function collectionBranchIds(collectionId) {
  const ids = new Set([collectionId]);
  const pending = [collectionId];
  while (pending.length) {
    const current = pending.shift();
    model.collections.filter((item) => item.parentId === current).forEach((child) => { ids.add(child.id); pending.push(child.id); });
  }
  return ids;
}

function sorted(items, field = "createdAt", mode = ui.sort) {
  const copied = [...items];
  if (mode === "oldest") return copied.sort((a, b) => (a[field] || 0) - (b[field] || 0));
  if (mode === "alpha") return copied.sort((a, b) => String(a.term || a.text || "").localeCompare(String(b.term || b.text || ""), "en", { sensitivity: "base" }));
  if (mode === "random") return copied.sort(() => Math.random() - .5);
  return copied.sort((a, b) => (b[field] || 0) - (a[field] || 0));
}

function sortedAnnotations(items) {
  const typeOrder = ["target", "word", "context", "phrase", "pattern", "grammar"];
  return [...items].sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || a.startOffset - b.startOffset || (a.createdAt || 0) - (b.createdAt || 0));
}

function sentenceMarkup(sentence, { interactive = true, visible = true, selectable = false, annotationFilter = null } = {}) {
  if (!visible) return escapeHTML(sentence.text);
  const annotations = annotationsForSentence(sentence.id).filter((item) => (!annotationFilter || annotationFilter(item)) && annotationRanges(item).some((range) => range.startOffset >= 0 && range.endOffset <= sentence.text.length));
  if (!annotations.length && !selectable) return escapeHTML(sentence.text);
  const segments = annotations.flatMap((annotation) => annotationRanges(annotation).map((range) => ({ annotation, startOffset: range.startOffset, endOffset: range.endOffset }))).filter((segment) => segment.startOffset >= 0 && segment.endOffset <= sentence.text.length);
  const tokens = selectable ? wordTokens(sentence) : [];
  const selectedKeys = new Set((ui.tokenSelection || []).filter((token) => token.sentenceId === sentence.id).map(tokenKey));
  const points = [...new Set([0, sentence.text.length, ...segments.flatMap((item) => [item.startOffset, item.endOffset]), ...tokens.flatMap((item) => [item.startOffset, item.endOffset])])].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const active = [...new Map(segments.filter((segment) => segment.startOffset <= start && segment.endOffset >= end).map((segment) => [segment.annotation.id, segment.annotation])).values()]
      .sort((a, b) => (annotationRanges(a)[0].endOffset - annotationRanges(a)[0].startOffset) - (annotationRanges(b)[0].endOffset - annotationRanges(b)[0].startOffset));
    const token = tokens.find((item) => item.startOffset === start && item.endOffset === end);
    let markup = escapeHTML(sentence.text.slice(start, end));
    if (token) markup = `<button class="word-token ${selectedKeys.has(tokenKey(token)) ? "selected" : ""}" data-action="toggle-token" data-sentence-id="${sentence.id}" data-start="${start}" data-end="${end}" aria-pressed="${selectedKeys.has(tokenKey(token))}">${markup}</button>`;
    active.forEach((annotation) => { markup = `<mark class="annotation ${annotation.type}"${interactive ? ` data-action="annotation-detail" data-id="${annotation.id}"` : ""}>${markup}</mark>`; });
    return markup;
  }).join("");
}

function header(title, backAction = "", rightControl = "") {
  const right = rightControl || `<button class="icon-button" data-action="settings" aria-label="Settings">•••</button>`;
  return `<header class="topbar">${backAction ? `<button class="icon-button" data-action="${backAction}" aria-label="Back">‹</button>` : `<span class="brand-dot"></span>`}<div><h1>${escapeHTML(title)}</h1></div>${right}</header>`;
}

function renderSentenceRow(sentence, compact = false) {
  const bulk = ui.bulkEditing && ui.collectionId && !ui.sentenceId && (collectionFor(ui.collectionId)?.isAll || sentence.collectionId === ui.collectionId);
  const selected = bulk && ui.bulkSelection.includes(sentence.id);
  const notes = sortedAnnotations(annotationsForSentence(sentence.id).filter((annotation) => annotation.type !== "target" && ui.showAnnotationDetails && (rememberedText(annotation) !== annotation.selectedText || annotation.note))).map((annotation) => `<div class="annotation-summary ${annotation.type}"><span class="annotation-pill ${annotation.type}">${ANNOTATION_TYPES[annotation.type]}</span><strong>${escapeHTML(rememberedText(annotation))}</strong>${annotation.note ? `<p>${escapeHTML(annotation.note)}</p>` : ""}</div>`).join("");
  const sentenceNote = ui.showSentenceNotes && sentence.note ? `<div class="annotation-summary sentence-note-summary"><p>${escapeHTML(sentence.note)}</p></div>` : "";
  const collectionName = collectionFor(ui.collectionId)?.isAll && ui.showCollectionNames ? `<div class="sentence-collection-name">${escapeHTML(collectionFor(sentence.collectionId)?.name || "未分类")}</div>` : "";
  const readOnly = collectionFor(ui.collectionId)?.isAll;
  const row = readOnly ? `<div class="sentence-row read-only ${compact ? "compact" : ""}"><p>${sentenceMarkup(sentence, { interactive: false, visible: ui.showAnnotations })}</p></div>` : `<button class="sentence-row ${compact ? "compact" : ""}" data-action="${bulk ? "toggle-bulk-sentence" : "open-sentence"}" data-id="${sentence.id}"><p>${sentenceMarkup(sentence, { interactive: false, visible: ui.showAnnotations })}</p></button>`;
  return `<article class="sentence-item ${bulk ? "bulk-mode" : ""} ${selected ? "selected" : ""}">${row}${collectionName}${notes || sentenceNote ? `<div class="annotation-summary-list">${notes}${sentenceNote}</div>` : ""}</article>`;
}

function renderSentenceControls(compact = false) {
  const labels = compact ? { annotations: "标注", notes: "笔记", sort: "排序", recent: "最新", oldest: "最早", random: "随机" } : { annotations: "Annotations", notes: "Notes", sort: "Sort", recent: "Newest", oldest: "Oldest", random: "Random" };
  if (compact) return `<div class="sentence-controls compact"><button class="control-pill ${ui.showAnnotations || ui.showAnnotationDetails || ui.showSentenceNotes ? "active" : ""}" data-action="display-options">显示</button><button class="control-pill" data-action="sort-options">排序</button></div>`;
  return `<div class="sentence-controls ${compact ? "compact" : ""}"><button class="marker-toggle ${ui.showAnnotations ? "active" : ""}" data-action="toggle-annotations">${labels.annotations}</button><button class="marker-toggle ${ui.showNotes ? "active" : ""}" data-action="toggle-notes">${labels.notes}</button><label>${labels.sort} <select id="sentence-sort"><option value="recent" ${ui.sentenceSort === "recent" ? "selected" : ""}>${labels.recent}</option><option value="oldest" ${ui.sentenceSort === "oldest" ? "selected" : ""}>${labels.oldest}</option><option value="random" ${ui.sentenceSort === "random" ? "selected" : ""}>${labels.random}</option></select></label></div>`;
}

function renderAnnotationControls() {
  const sortMode = ui.annotationSort === "random" ? "type" : ui.annotationSort;
  return `<div class="sentence-controls annotation-controls"><button class="marker-toggle ${ui.showAnnotations ? "active" : ""}" data-action="toggle-annotations">Annotations</button><button class="marker-toggle ${ui.showNotes ? "active" : ""}" data-action="toggle-notes">Notes</button><label>Sort <select id="annotation-sort"><option value="recent" ${sortMode === "recent" ? "selected" : ""}>Newest</option><option value="oldest" ${sortMode === "oldest" ? "selected" : ""}>Oldest</option><option value="type" ${sortMode === "type" ? "selected" : ""}>By type</option></select></label></div>`;
}

function renderReading() {
  if (ui.wordbookCollectionId) return renderWordbook();
  if (ui.collectionId) return renderCollection();
  const query = ui.search.trim().toLocaleLowerCase("en-US");
  const sentenceResults = query ? sorted(readingSentences().filter((sentence) => sentence.text.toLocaleLowerCase("en-US").includes(query))) : [];
  const wordResults = query ? sorted(model.entries.filter((entry) => {
    const insightText = insightsForEntry(entry.id).flatMap((item) => [item.phrase, item.meaning, item.term, item.description, ...(item.examples || []).flat()]).filter(Boolean).join(" ");
    return `${entry.term} ${insightText}`.toLocaleLowerCase("en-US").includes(query);
  })) : [];
  const resultCount = sentenceResults.length + wordResults.length;
  const resultSections = `${sentenceResults.length ? `<section class="search-result-group"><h3>句子</h3><div class="sentence-list">${sentenceResults.map((sentence) => renderSentenceRow(sentence)).join("")}</div></section>` : ""}${wordResults.length ? `<section class="search-result-group"><h3>单词</h3><div class="entry-list">${wordResults.map((entry) => renderEntryRow(entry)).join("")}</div></section>` : ""}`;
  const content = query ? (resultCount ? `<section class="search-results"><div class="section-head"><h2>搜索结果</h2><span>${resultCount}</span></div>${resultSections}</section>` : `<div class="quiet-empty">没有找到匹配的内容。</div>`) : `<section class="collection-list">${rootCollections().map((collection) => renderCollectionCard(collection, true)).join("")}</section>`;
  return `${header("Reading")}<section class="page-content">${renderSearch("Search saved sentences")}${content}</section>`;
}

function renderCollectionCard(collection, showWordbook = false) {
  const directCount = collection.isAll ? readingSentences().length : readingSentences().filter((sentence) => sentence.collectionId === collection.id).length;
  const children = childrenFor(collection.id);
  const total = directCount + children.reduce((sum, child) => sum + readingSentences().filter((sentence) => sentence.collectionId === child.id).length, 0);
  const mainCard = `<button class="collection-card ${showWordbook ? "collection-card-main" : ""}" data-action="open-collection" data-id="${collection.id}"><span class="folder-mark">⌁</span><span class="collection-copy"><strong>${escapeHTML(collection.name)}</strong></span><small class="collection-count">${total} sentences${children.length ? ` · ${children.length} sections` : ""}</small><i>›</i></button>`;
  if (!showWordbook) return mainCard;
  return `<div class="collection-card-split">${mainCard}<button class="collection-wordbook-card" data-action="open-wordbook" data-id="${collection.id}" aria-label="打开${escapeHTML(collection.name)}的单词本">词</button></div>`;
}

function renderCollection() {
  const collection = collectionFor(ui.collectionId);
  if (!collection) { ui.collectionId = null; return renderReading(); }
  const children = collection.isAll ? [] : childrenFor(collection.id);
  const sentences = collection.isAll ? readingSentences() : readingSentences().filter((item) => item.collectionId === collection.id);
  const allSelected = sentences.length > 0 && sentences.every((sentence) => ui.bulkSelection.includes(sentence.id));
  const bulkBar = !collection.isAll && ui.bulkEditing ? `<div class="bulk-edit-bar"><button class="bulk-select-all ${allSelected ? "active" : ""}" data-action="toggle-bulk-all">${allSelected ? "取消全选" : "全选"}</button><span>已选 ${ui.bulkSelection.length}</span><button data-action="bulk-move-selected">移动</button><button data-action="bulk-delete-selected">删除</button><button data-action="cancel-bulk">取消</button></div>` : "";
  const actionButtons = `<button class="text-action" data-action="open-wordbook" data-id="${collection.id}">单词本</button><button class="text-action add-sentence" data-action="save-sentence">＋ 新增</button>${collection.isAll ? "" : `<button class="text-action ${ui.bulkEditing ? "active" : ""}" data-action="toggle-bulk">批量</button>`}`;
  const orderedSentences = collection.isAll && ui.allCollectionSort === "collection" ? allCollectionSorted(sentences) : sorted(sentences, "createdAt", collection.isAll ? ui.allCollectionSort : ui.sentenceSort);
  return `${header(collection.name, "back-reading", `<button class="icon-button" data-action="collection-menu" data-id="${collection.id}" aria-label="Collection menu">•••</button>`)}<section class="page-content collection-page"><div class="collection-actions"><div class="collection-action-buttons">${actionButtons}</div>${renderSentenceControls(true)}</div>${bulkBar}${children.length ? `<section class="collection-list small">${children.map(renderCollectionCard).join("")}</section>` : ""}${sentences.length ? `<div class="sentence-list">${orderedSentences.map((sentence) => renderSentenceRow(sentence)).join("")}</div>` : empty("Start this collection with one real sentence.", "save-sentence", "Add a sentence")}</section>`;
}

function renderWordbook() {
  const collection = collectionFor(ui.wordbookCollectionId);
  if (!collection) { ui.wordbookCollectionId = null; return renderReading(); }
  const collectionIds = collection.isAll ? null : collectionBranchIds(collection.id);
  const sentenceIds = new Set(readingSentences().filter((sentence) => !collectionIds || collectionIds.has(sentence.collectionId)).map((sentence) => sentence.id));
  const allAnnotations = model.annotations.filter((annotation) => annotation.type !== "target" && sentenceIds.has(annotation.sentenceId));
  const annotations = ui.wordbookType === "all" ? sortedAnnotations(allAnnotations) : sorted(allAnnotations.filter((annotation) => annotation.type === ui.wordbookType), "updatedAt", ui.wordbookSort);
  const sentenceNotes = ui.wordbookType === "all" && ui.wordbookShowNotes ? model.sentences.filter((sentence) => sentenceIds.has(sentence.id) && sentence.note).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) : [];
  const filters = [["all", "全部"], ...Object.entries(ANNOTATION_TYPES).filter(([type]) => type !== "target")];
  const modeLabel = ui.wordbookMode === "edit" ? "编辑" : "阅读";
  const annotationRows = annotations.map((annotation) => {
    const sentence = sentenceFor(annotation.sentenceId);
    const isEditing = ui.wordbookMode === "edit";
    return `<button data-action="${isEditing ? "annotation-detail" : "speak-wordbook"}" data-id="${annotation.id}" data-term="${escapeHTML(rememberedText(annotation))}" aria-label="${isEditing ? "编辑" : "朗读"}${escapeHTML(rememberedText(annotation))}"><span class="annotation-pill ${annotation.type}">${ANNOTATION_TYPES[annotation.type]}</span><strong>${escapeHTML(rememberedText(annotation))}</strong>${ui.wordbookShowOriginal ? `<small class="wordbook-source">${escapeHTML(sentence?.text || "")}</small>` : ""}${ui.wordbookShowNotes && annotation.note ? `<small class="wordbook-note">${escapeHTML(annotation.note)}</small>` : ""}${isEditing ? "<i>›</i>" : ""}</button>`;
  }).join("");
  const noteRows = sentenceNotes.map((sentence) => ui.wordbookMode === "edit" ? `<button data-action="sentence-note" data-id="${sentence.id}"><span class="annotation-pill note">笔记</span><strong>${escapeHTML(sentence.note)}</strong>${ui.wordbookShowOriginal ? `<small class="wordbook-source">${escapeHTML(sentence.text)}</small>` : ""}<i>›</i></button>` : `<div class="wordbook-read-only-row"><span class="annotation-pill note">笔记</span><strong>${escapeHTML(sentence.note)}</strong>${ui.wordbookShowOriginal ? `<small class="wordbook-source">${escapeHTML(sentence.text)}</small>` : ""}</div>`).join("");
  return `${header("单词本", "back-wordbook")}<section class="page-content wordbook-page"><div class="wordbook-toolbar"><strong>${escapeHTML(collection.name)}</strong><div><button class="text-action ${ui.wordbookMode === "edit" ? "mode-active" : ""}" data-action="toggle-wordbook-mode" aria-label="切换到${ui.wordbookMode === "edit" ? "阅读" : "编辑"}模式">${modeLabel}</button><button class="control-pill" data-action="wordbook-display-options">显示</button><button class="control-pill" data-action="wordbook-sort-options">排序</button></div></div><div class="wordbook-filters">${filters.map(([type, label]) => `<button class="${ui.wordbookType === type ? "active" : ""} ${type}" data-action="wordbook-filter" data-value="${type}">${label}</button>`).join("")}</div>${annotations.length || sentenceNotes.length ? `<div class="annotation-list wordbook-list">${annotationRows}${noteRows}</div>` : `<div class="quiet-empty">This collection has no marked items yet.</div>`}</section>`;
}

function renderWords() {
  if (ui.entryId) return renderEntry();
  if (ui.wordsLibraryOpen) return renderWordsLibrary();
  const entries = entriesForWordCollection(ui.wordCollectionId);
  const listKind = ui.wordCollectionId === "words-phrases" ? "phrases" : ui.wordCollectionId === "words-synonyms" ? "synonyms" : "all";
  const currentCollectionName = ui.wordCollectionId === "words-all" ? "全部单词" : ui.wordCollectionId === "words-phrases" ? "词组" : ui.wordCollectionId === "words-synonyms" ? "同义辨析" : ui.wordCollectionId === "words-uncategorized" ? "未分类" : wordCollectionFor(ui.wordCollectionId)?.name || "全部单词";
  const modeLabel = ui.wordsMode === "edit" ? "编辑" : "阅读";
  const allSelected = entries.length > 0 && entries.every((entry) => ui.wordBulkSelection.includes(entry.id));
  const bulkBar = ui.wordBulkEditing ? `<div class="bulk-edit-bar word-bulk-edit-bar"><button class="bulk-select-all ${allSelected ? "active" : ""}" data-action="toggle-bulk-entry-all">${allSelected ? "取消全选" : "全选"}</button><span>已选 ${ui.wordBulkSelection.length}</span><button data-action="word-bulk-move-selected">移动</button><button data-action="word-bulk-delete-selected">删除</button><button data-action="cancel-word-bulk">取消</button></div>` : "";
  return `${header("Words")}<section class="page-content"><button class="word-collection-display" data-action="word-collection-switcher"><strong>${escapeHTML(currentCollectionName)}</strong><span aria-hidden="true">⌄</span></button><div class="words-actions"><div><button class="text-action" data-action="open-words-library">单词本</button><button class="text-action" data-action="new-entry">＋ 新增</button><button class="text-action ${ui.wordsMode === "edit" ? "mode-active" : ""}" data-action="toggle-words-mode" aria-label="切换到${ui.wordsMode === "edit" ? "阅读" : "编辑"}模式">${modeLabel}</button><button class="text-action ${ui.wordBulkEditing ? "active" : ""}" data-action="toggle-word-bulk">批量</button></div><div><button class="control-pill ${ui.wordExampleDisplay !== "none" ? "active" : ""}" data-action="words-display-options">显示</button><button class="control-pill" data-action="words-sort-options">排序</button></div></div>${bulkBar}${entries.length ? `<div class="entry-list">${sorted(entries).map((entry) => renderEntryRow(entry, listKind)).join("")}</div>` : empty(ui.wordCollectionId === "words-all" ? "Add a word, then collect examples that make it stick." : "这个分类里还没有内容。", "new-entry", "＋ 新增")}</section>`;
}

function renderEntryRow(entry, listKind = "all") {
  const examples = linksForEntry(entry.id).map((link) => sentenceFor(link.sentenceId)).filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const visibleExamples = listKind === "all" ? (ui.wordExampleDisplay === "all" ? examples : ui.wordExampleDisplay === "one" ? examples.slice(0, 1) : []) : [];
  const phrases = listKind === "synonyms" ? [] : listKind === "phrases" ? insightsForEntry(entry.id, "phrase") : ui.wordShowPhrases ? insightsForEntry(entry.id, "phrase") : [];
  const synonyms = listKind === "phrases" ? [] : listKind === "synonyms" ? insightsForEntry(entry.id, "synonym") : ui.wordShowSynonyms ? insightsForEntry(entry.id, "synonym") : [];
  const phraseModules = phrases.map((item) => `<span class="entry-insight-module"><span class="entry-insight-copy">${highlightEntryRanges(item.phrase, item.targetRanges, entry.term)} <em>${escapeHTML(item.meaning)}</em></span></span>`);
  const synonymModules = synonyms.map((item) => `<span class="entry-insight-module"><span class="entry-insight-copy"><strong class="entry-insight-term">${escapeHTML(item.term)}</strong><em>${escapeHTML(item.description)}</em>${(item.examples || []).map(([text, meaning]) => `<small>${escapeHTML(text)}（${escapeHTML(meaning)}）</small>`).join("")}</span></span>`);
  const exampleModules = visibleExamples.map((example) => `<span class="entry-insight-module entry-example-module"><span class="entry-insight-copy">${entrySentenceMarkup(entry, example)}</span></span>`);
  const groupBlock = (kind, label, modules) => modules.length ? `<span class="entry-insight-group ${kind}"><span class="entry-insight-tag">${label}</span><span class="entry-insight-group-content">${modules.join("")}</span></span>` : "";
  const previews = [groupBlock("examples", "例句", exampleModules), groupBlock("phrases", "词组", phraseModules), groupBlock("synonyms", "辨析", synonymModules)].filter(Boolean);
  const selected = ui.wordBulkEditing && ui.wordBulkSelection.includes(entry.id);
  const classes = `entry-row ${previews.length ? "has-examples" : ""} ${ui.wordBulkEditing ? "bulk-mode" : ""} ${selected ? "selected" : ""}`;
  const content = `<span class="entry-dot"></span><strong>${escapeHTML(entry.term)}</strong>${previews.length ? `<span class="entry-examples">${previews.join("")}</span>` : ""}`;
  if (ui.wordBulkEditing) return `<button class="${classes}" data-action="toggle-bulk-entry" data-id="${entry.id}" aria-pressed="${selected}">${content}</button>`;
  return ui.wordsMode === "edit" ? `<button class="${classes}" data-action="open-entry" data-id="${entry.id}">${content}</button>` : `<button class="${classes}" data-action="speak-entry" data-term="${escapeHTML(entry.term)}" aria-label="朗读 ${escapeHTML(entry.term)}">${content}</button>`;
}

function renderReadingWordbookOverview() {
  const readingSentenceIds = new Set(readingSentences().map((sentence) => sentence.id));
  const annotations = sortedAnnotations(model.annotations.filter((annotation) => annotation.type !== "target" && readingSentenceIds.has(annotation.sentenceId) && (ui.wordsLibraryType === "all" || annotation.type === ui.wordsLibraryType)));
  const notes = ["all", "note"].includes(ui.wordsLibraryType) ? readingSentences().filter((sentence) => sentence.note) : [];
  const filters = [["all", "全部"], ["word", "生词"], ["context", "语境"], ["phrase", "短语"], ["pattern", "句式"], ["grammar", "语法"], ["note", "笔记"]];
  const rows = annotations.map((annotation) => { const sentence = sentenceFor(annotation.sentenceId); return `<button data-action="annotation-detail" data-id="${annotation.id}"><span class="annotation-pill ${annotation.type}">${ANNOTATION_TYPES[annotation.type]}</span><strong>${escapeHTML(rememberedText(annotation))}</strong><small class="wordbook-source">${escapeHTML(sentence?.text || "")}</small><i>›</i></button>`; }).join("");
  const noteRows = notes.map((sentence) => `<button data-action="sentence-note" data-id="${sentence.id}"><span class="annotation-pill note">笔记</span><strong>${escapeHTML(sentence.note)}</strong><small class="wordbook-source">${escapeHTML(sentence.text)}</small><i>›</i></button>`).join("");
  return `<div class="wordbook-filters unified-wordbook-filters">${filters.map(([type, label]) => `<button class="${ui.wordsLibraryType === type ? "active" : ""} ${type}" data-action="words-library-filter" data-value="${type}">${label}</button>`).join("")}</div>${rows || noteRows ? `<div class="annotation-list wordbook-list">${rows}${noteRows}</div>` : `<div class="quiet-empty">Reading 中还没有这一类标注。</div>`}`;
}

function readingWordbookCount(collection) {
  const ids = collection.isAll ? null : collectionBranchIds(collection.id);
  const sentenceIds = new Set(readingSentences().filter((sentence) => !ids || ids.has(sentence.collectionId)).map((sentence) => sentence.id));
  return model.annotations.filter((annotation) => annotation.type !== "target" && sentenceIds.has(annotation.sentenceId)).length + readingSentences().filter((sentence) => sentenceIds.has(sentence.id) && sentence.note).length;
}

function renderLibraryRow(collection, mode) {
  const isWord = mode === "word";
  const count = isWord ? entriesForWordCollection(collection.id).length : readingWordbookCount(collection);
  const action = isWord ? "open-word-collection" : "open-reading-wordbook";
  const suffix = isWord ? "个词条" : "条标注";
  return `<button class="library-list-row" data-action="${action}" data-id="${collection.id}"><span class="library-list-icon ${mode}">⌁</span><span class="library-list-copy"><strong>${escapeHTML(collection.name)}</strong></span><span class="library-list-count">${count} ${suffix}</span><i>›</i></button>`;
}

function renderWordsLibraryBlock(title, collections, mode) {
  return `<section class="library-block"><h2>${title}</h2><div class="library-list-card">${collections.map((collection) => renderLibraryRow(collection, mode)).join("")}</div></section>`;
}

function renderWordLibraryRow(idValue, label) {
  const count = entriesForWordCollection(idValue).length;
  return `<button class="library-list-row" data-action="open-word-collection" data-id="${idValue}"><span class="library-list-icon word">⌁</span><span class="library-list-copy"><strong>${escapeHTML(label)}</strong></span><span class="library-list-count">${count} 个词条</span><i>›</i></button>`;
}

function renderWordsLibrary() {
  const wordOverview = [["words-all", "全部单词"], ["words-phrases", "词组"], ["words-synonyms", "同义辨析"], [READING_WORD_COLLECTION_ID, "Reading"]];
  const userCollections = [...wordCollections().map((collection) => [collection.id, collection.name]), ["words-uncategorized", "未分类"]];
  return `${header("单词本", "back-words-library", `<span></span>`)}<section class="page-content words-library-page"><section class="library-block"><h2>Word</h2><div class="library-list-card">${wordOverview.map(([idValue, label]) => renderWordLibraryRow(idValue, label)).join("")}</div></section><section class="library-block"><div class="library-list-card">${userCollections.map(([idValue, label]) => renderWordLibraryRow(idValue, label)).join("")}</div></section></section>`;
}

function highlightEntryTerm(text, term) {
  const pattern = String(term || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!pattern) return escapeHTML(text);
  return escapeHTML(text).replace(new RegExp(`(${pattern})`, "ig"), "<strong>$1</strong>");
}

function highlightEntryRanges(text, ranges = [], term = "") {
  const valid = (ranges || []).filter((range) => Number.isInteger(range.startOffset) && Number.isInteger(range.endOffset) && range.endOffset > range.startOffset && range.endOffset <= text.length).sort((a, b) => a.startOffset - b.startOffset);
  if (!valid.length) return highlightEntryTerm(text, term);
  let cursor = 0;
  return valid.map((range) => {
    const before = escapeHTML(text.slice(cursor, range.startOffset));
    const selected = `<strong>${escapeHTML(text.slice(range.startOffset, range.endOffset))}</strong>`;
    cursor = range.endOffset;
    return before + selected;
  }).join("") + escapeHTML(text.slice(cursor));
}

function entrySentenceTarget(entry, sentenceId) {
  const link = model.links.find((item) => item.entryId === entry.id && item.sentenceId === sentenceId);
  return link?.anchorAnnotationId ? annotationFor(link.anchorAnnotationId) : null;
}

function entrySentenceMarkup(entry, sentence) {
  const target = entrySentenceTarget(entry, sentence.id);
  if (target) return sentenceMarkup(sentence, { interactive: false, annotationFilter: (item) => item.id === target.id });
  return highlightEntryTerm(sentence.text, entry.term);
}

function entryDraftText(entry, idValue, fallback = "") {
  return ui.entryDrafts?.[`${entry.id}:${idValue}`] ?? fallback;
}

function renderEntryExampleView(entry, sentence) {
  return `<article class="entry-sentence-row"><span class="entry-dot"></span><p>${entrySentenceMarkup(entry, sentence)}</p></article>`;
}

function renderEntryExamplesEditor(entry, sentences) {
  const renderExampleRow = (draftId, text, isNew = false) => {
    const selecting = ui.entryEditingTargetId === draftId;
    const synthetic = { id: `entry-draft-${entry.id}-${draftId}`, text };
    const selectedCount = tokenSelectionFor(synthetic)?.count || 0;
    const selectedText = tokenSelectionFor(synthetic)?.text || "";
    const body = selecting ? `<div class="entry-target-picker">${sentenceMarkup(synthetic, { selectable: true, annotationFilter: () => false })}</div><div class="entry-target-tools"><span>已选 ${selectedCount} 词</span><b>词条</b><button data-action="entry-finish-target" data-id="${draftId}">完成选择</button></div>` : `<textarea class="entry-example-input" data-entry-example="${draftId}" rows="2" placeholder="${isNew ? "输入新的英文例句" : ""}">${escapeHTML(text)}</textarea><button class="entry-inline-action" data-action="entry-select-target" data-id="${draftId}">选择词条</button>`;
    const actionLabel = selectedText && !selecting ? `已选择词条：${escapeHTML(selectedText)}` : "选择词条";
    const displayBody = selecting ? body : `<textarea class="entry-example-input" data-entry-example="${draftId}" rows="2" placeholder="${isNew ? "输入新的英文例句" : ""}">${escapeHTML(text)}</textarea><button class="entry-inline-action" data-action="entry-select-target" data-id="${draftId}">${actionLabel}</button>`;
    return `<div class="entry-edit-example ${isNew ? "new-entry-example" : ""}"><div class="entry-edit-example-label">例句</div>${displayBody}</div>`;
  };
  const rows = sentences.map((sentence) => {
    const draftId = sentence.id;
    const text = entryDraftText(entry, draftId, sentence.text);
    return renderExampleRow(draftId, text);
  }).join("");
  const newRows = Array.from({ length: ui.entryNewExampleCount || 0 }, (_, index) => {
    const draftId = `new-${index}`;
    return renderExampleRow(draftId, entryDraftText(entry, draftId, ""), true);
  }).join("");
  return `<section class="entry-insight-section examples-section entry-editing-section">${rows}${newRows}<button class="entry-add-row" data-action="add-entry-example">＋ 添加例句</button><button class="entry-save-pill" data-action="save-entry-edit">保存</button></section>`;
}

function renderEntryPhrases(entry, editing = false) {
  const phrases = insightsForEntry(entry.id, "phrase");
  return ["basic", "context"].map((group) => {
    const rows = phrases.filter((item) => item.group === group);
    if (!rows.length && !editing) return "";
    const renderEditRow = (item, isNew = false, newIndex = 0) => {
      const rowKey = isNew ? `new-${group}-${newIndex}` : item.id;
      const draft = ui.entryInsightDrafts?.[rowKey] || {};
      const phrase = draft.phrase ?? (isNew ? "" : item.phrase);
      const meaning = draft.meaning ?? (isNew ? "" : item.meaning);
      const selecting = ui.entryInsightTargetId === rowKey;
      const synthetic = { id: `phrase-draft-${entry.id}-${rowKey}`, text: phrase };
      const selectedCount = tokenSelectionFor(synthetic)?.count || 0;
      const body = selecting ? `<div class="phrase-target-picker">${sentenceMarkup(synthetic, { selectable: true, annotationFilter: () => false })}</div><div class="entry-target-tools"><span>已选 ${selectedCount} 词</span><b>词条</b><button data-action="phrase-finish-target" data-id="${rowKey}">完成选择</button></div>` : `<input data-insight-field="phrase" data-insight-phrase="${rowKey}" value="${escapeHTML(phrase)}" placeholder="添加词组" /><input data-insight-field="meaning" data-insight-meaning="${rowKey}" value="${escapeHTML(meaning)}" placeholder="释义" /><button class="entry-inline-action" data-action="phrase-select-target" data-id="${rowKey}">选择词条</button>`;
      return `<div class="phrase-edit-row ${selecting ? "phrase-selecting-row" : ""}" data-insight-id="${isNew ? "" : item.id}" data-insight-group="${isNew ? group : item.group}" data-insight-key="${rowKey}">${body}</div>`;
    };
    const newRows = editing ? Array.from({ length: ui.entryInsightNewCounts?.[group] || 0 }, (_, index) => renderEditRow({}, true, index)).join("") : "";
    return `<section class="entry-insight-section phrase-section ${editing ? "entry-editing-section" : ""}"><h3>${group === "basic" ? "基础" : "语境"}</h3><div class="phrase-rows">${rows.map((item) => editing ? renderEditRow(item) : `<div class="phrase-row"><p>${highlightEntryRanges(item.phrase, item.targetRanges, entry.term)} <span>${escapeHTML(item.meaning)}</span></p></div>`).join("")}${newRows}</div>${editing ? `<button class="entry-add-row" data-action="add-entry-phrase" data-group="${group}">＋ 添加词组</button>${group === "context" ? `<button class="entry-save-pill" data-action="save-entry-edit">保存</button>` : ""}` : ""}</section>`;
  }).join("");
}

function renderEntrySynonyms(entry, editing = false) {
  const synonyms = insightsForEntry(entry.id, "synonym");
  if (!synonyms.length && !editing) return "";
  const editExamples = (key, examples = []) => {
    const draft = ui.entrySynonymDrafts?.[key];
    const values = draft?.examples ?? examples;
    const count = ui.entrySynonymExampleCounts?.[key] ?? values.length;
    return `<div class="synonym-example-edit-list">${Array.from({ length: count }, (_, index) => { const [text, meaning] = values[index] || ["", ""]; return `<div class="synonym-example-edit"><input data-synonym-example-text value="${escapeHTML(text)}" placeholder="英文例子" /><input data-synonym-example-meaning value="${escapeHTML(meaning)}" placeholder="中文解释" /></div>`; }).join("")}</div><button class="entry-inline-action synonym-add-example" data-action="add-synonym-example" data-id="${key}">＋ 添加例子</button>`;
  };
  const renderEditRow = (item, key, isNew = false) => {
    const draft = ui.entrySynonymDrafts?.[key] || {};
    const term = draft.term ?? (isNew ? "" : item.term);
    const description = draft.description ?? (isNew ? "" : item.description);
    const examples = draft.examples ?? (isNew ? [] : item.examples || []);
    return `<article class="synonym-edit-row ${isNew ? "new-insight-row" : ""}" data-insight-id="${isNew ? "" : item.id}" data-synonym-key="${key}"><input data-insight-field="term" data-synonym-term value="${escapeHTML(term)}" placeholder="${isNew ? "添加同义词" : "同义词"}" /><textarea data-insight-field="description" data-synonym-description rows="2" placeholder="辨析说明">${escapeHTML(description)}</textarea>${editExamples(key, examples)}</article>`;
  };
  const newRows = editing ? Array.from({ length: ui.entryNewSynonymCount || 0 }, (_, index) => renderEditRow({}, `new-synonym-${index}`, true)).join("") : "";
  return `<section class="entry-insight-section synonym-section ${editing ? "entry-editing-section" : ""}"><div class="synonym-rows">${synonyms.map((item) => editing ? renderEditRow(item, item.id) : `<article class="synonym-row"><h4>${escapeHTML(item.term)}</h4><p class="synonym-description">${escapeHTML(item.description)}</p>${(item.examples || []).map(([text, meaning]) => `<p class="synonym-example"><span>${highlightEntryTerm(text, item.term)}</span> <small>（${escapeHTML(meaning)}）</small></p>`).join("")}</article>`).join("")}${newRows}</div>${editing ? `<button class="entry-add-row" data-action="add-entry-synonym">＋ 添加同义词</button><button class="entry-save-pill" data-action="save-entry-edit">保存</button>` : ""}</section>`;
}

function captureSynonymDraft(row) {
  if (!row?.dataset.synonymKey) return;
  const examples = [...row.querySelectorAll(".synonym-example-edit")].map((example) => [example.querySelector("[data-synonym-example-text]")?.value || "", example.querySelector("[data-synonym-example-meaning]")?.value || ""]);
  ui.entrySynonymDrafts = { ...ui.entrySynonymDrafts, [row.dataset.synonymKey]: { term: row.querySelector("[data-synonym-term]")?.value || "", description: row.querySelector("[data-synonym-description]")?.value || "", examples } };
}

function renderEntry() {
  const entry = entryFor(ui.entryId);
  if (!entry) { ui.entryId = null; return renderWords(); }
  const links = linksForEntry(entry.id);
  const sentences = links.map((link) => sentenceFor(link.sentenceId)).filter(Boolean);
  const tabs = [["examples", "例句"], ["phrases", "词组"], ["synonyms", "同义辨析"]];
  const tabBar = `<nav class="entry-tabs" aria-label="词条内容分类">${tabs.map(([value, label]) => `<button class="${ui.entryTab === value ? "active" : ""}" data-action="entry-tab" data-value="${value}">${label}</button>`).join("")}</nav>`;
  let tabContent = "";
  if (ui.entryTab === "phrases") tabContent = ui.entryEditing ? renderEntryPhrases(entry, true) : renderEntryPhrases(entry) || `<div class="quiet-empty">暂无词组，可点击右上角添加。</div>`;
  else if (ui.entryTab === "synonyms") tabContent = ui.entryEditing ? renderEntrySynonyms(entry, true) : renderEntrySynonyms(entry) || `<div class="quiet-empty">暂无同义辨析，可点击右上角添加。</div>`;
  else tabContent = ui.entryEditing ? renderEntryExamplesEditor(entry, sentences) : `<section class="entry-insight-section examples-section">${sentences.length ? `<div class="entry-sentence-list">${sorted(sentences).map((sentence) => renderEntryExampleView(entry, sentence)).join("")}</div>` : `<div class="quiet-empty">暂无例句</div>`}</section>`;
  return `${header(entry.term, "back-words")}<section class="page-content entry-detail ${ui.entryEditing ? "entry-editing" : ""}"><div class="entry-hero"><div><button class="entry-collection-label" data-action="entry-collection" data-id="${entry.id}">合集 · ${escapeHTML(wordCollectionName(entry))} ›</button><h2>${escapeHTML(entry.term)}</h2></div><button class="speak-button entry-edit-button" data-action="entry-toggle-edit" data-id="${entry.id}" aria-label="编辑词条内容">＋</button></div>${tabBar}${tabContent}</section>`;
}

function renderSentence() {
  const sentence = sentenceFor(ui.sentenceId);
  if (!sentence) { ui.sentenceId = null; return ui.screen === "words" ? renderWords() : renderReading(); }
  const exampleEntry = ui.entryId ? entryFor(ui.entryId) : null;
  const annotations = sortedAnnotations(annotationsForSentence(sentence.id).filter((annotation) => annotation.type !== "target"));
  const selected = tokenSelectionFor(sentence);
  const selectionTypes = exampleEntry ? [["target", "词条"]] : Object.entries(ANNOTATION_TYPES).filter(([type]) => type !== "target");
  const selectionTools = selected ? `<div class="selection-tools"><span>已选 ${selected.count} 词</span>${selectionTypes.map(([type, label]) => `<button class="annotation-option ${type}" data-action="create-annotation" data-type="${type}">${escapeHTML(label)}</button>`).join("")}<button class="tool-close" data-action="clear-selection" aria-label="Close">×</button></div>` : "";
  const actions = `<div class="sentence-actions"><button class="text-action" data-action="sentence-note" data-id="${sentence.id}">笔记</button><button class="text-action" data-action="edit-sentence" data-id="${sentence.id}">编辑</button><button class="text-action clear-text" data-action="clear-annotations" data-id="${sentence.id}">清空</button><button class="text-action danger-text" data-action="delete-sentence" data-id="${sentence.id}">删除</button></div>`;
  const sentenceNote = ui.showNotes && sentence.note ? `<button class="sentence-note-row" data-action="sentence-note" data-id="${sentence.id}"><span class="annotation-pill note">笔记</span><small>${escapeHTML(sentence.note)}</small><i>›</i></button>` : "";
  const annotationRows = annotations.map((annotation) => `<button data-action="annotation-detail" data-id="${annotation.id}"><span class="annotation-pill ${annotation.type}">${ANNOTATION_TYPES[annotation.type]}</span><strong>${escapeHTML(rememberedText(annotation))}</strong>${ui.showNotes && annotation.note ? `<small>${escapeHTML(annotation.note)}</small>` : ""}<i>›</i></button>`).join("");
  return `${header(exampleEntry ? "Example" : "Sentence", "back-from-sentence", `<span></span>`)}<section class="page-content sentence-detail ${exampleEntry ? "entry-example-detail" : ""}">${actions}<article class="sentence-paper"><div class="sentence-body" data-sentence-body="${sentence.id}">${sentenceMarkup(sentence, { selectable: true })}</div></article><p class="selection-help">Tap words directly. Select adjacent or separate words.</p>${selectionTools}<section class="section-head"><h2>Annotations</h2><span>${annotations.length}</span></section>${annotationRows || sentenceNote ? `<div class="annotation-list">${annotationRows}${sentenceNote}</div>` : `<div class="quiet-empty">Nothing needs to become a task. Mark only what matters.</div>`}</section>`;
}

function renderSearch(placeholder) { return `<label class="search-box"><span>⌕</span><input id="search" value="${escapeHTML(ui.search)}" placeholder="${placeholder}" autocomplete="off" /></label>`; }
function empty(text, action, label, recordId = "") { return `<div class="empty-state"><p>${escapeHTML(text)}</p><button class="primary-button" data-action="${action}" ${recordId ? `data-id="${recordId}"` : ""}>${escapeHTML(label)}</button></div>`; }
function standardChoiceSheet(options) {
  const rows = options.map((option) => `<button data-action="${option.action}"${option.value !== undefined ? ` data-value="${escapeHTML(option.value)}"` : ""}${option.id !== undefined ? ` data-id="${escapeHTML(option.id)}"` : ""}><b>${escapeHTML(option.label)}</b><span class="sheet-choice-right">${option.meta ? `<em>${escapeHTML(option.meta)}</em>` : ""}${option.checked ? `<strong class="sheet-check">✓</strong>` : ""}</span></button>`).join("");
  return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet standard-choice-sheet">${rows}<button data-action="close-sheet">取消</button></section>`;
}

function renderSheet() {
  if (!ui.sheet) return "";
  const sheet = ui.sheet;
  if (sheet.kind === "quick") return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet"><button data-action="save-sentence"><b>Save a sentence</b><span>Paste something worth meeting again.</span></button><button data-action="new-entry"><b>Add a word or phrase</b><span>Start gathering your own examples.</span></button><button data-action="close-sheet">Cancel</button></section>`;
  if (sheet.kind === "display-options") { const isAll = collectionFor(ui.collectionId)?.isAll; return standardChoiceSheet([{ action: "display-mode", value: "all", label: "显示全部", checked: ui.showAnnotations && ui.showAnnotationDetails && ui.showSentenceNotes && (!isAll || ui.showCollectionNames) }, { action: "display-mode", value: "none", label: "隐藏全部", checked: !ui.showAnnotations && !ui.showAnnotationDetails && !ui.showSentenceNotes && (!isAll || !ui.showCollectionNames) }, { action: "display-mode", value: "annotations", label: "句子标注", checked: ui.showAnnotations }, { action: "display-mode", value: "annotation-details", label: "标注扩展", checked: ui.showAnnotationDetails }, { action: "display-mode", value: "sentence-notes", label: "句子笔记", checked: ui.showSentenceNotes }, ...(isAll ? [{ action: "display-mode", value: "collection-names", label: "显示合集名称", checked: ui.showCollectionNames }] : [])]); }
  if (sheet.kind === "sort-options") { const isAll = collectionFor(ui.collectionId)?.isAll; const mode = isAll ? ui.allCollectionSort : ui.sentenceSort; return standardChoiceSheet([{ action: "set-sentence-sort", value: "recent", label: "最新在前", checked: mode === "recent" }, { action: "set-sentence-sort", value: "oldest", label: "最早在前", checked: mode === "oldest" }, { action: "set-sentence-sort", value: "random", label: "随机", checked: mode === "random" }, ...(isAll ? [{ action: "set-sentence-sort", value: "collection", label: "按照合集排序", checked: mode === "collection" }] : [])]); }
  if (sheet.kind === "wordbook-sort-options") return standardChoiceSheet([{ action: "set-wordbook-sort", value: "recent", label: "最新在前", checked: ui.wordbookSort === "recent" }, { action: "set-wordbook-sort", value: "oldest", label: "最早在前", checked: ui.wordbookSort === "oldest" }, { action: "set-wordbook-sort", value: "random", label: "随机", checked: ui.wordbookSort === "random" }]);
  if (sheet.kind === "words-display-options") return standardChoiceSheet([{ action: "set-word-example-display", value: "one", label: "显示 1 条例句", checked: ui.wordExampleDisplay === "one" }, { action: "set-word-example-display", value: "all", label: "显示全部例句", checked: ui.wordExampleDisplay === "all" }, { action: "toggle-word-display", value: "phrases", label: "显示词组", checked: ui.wordShowPhrases }, { action: "toggle-word-display", value: "synonyms", label: "显示同义词辨析", checked: ui.wordShowSynonyms }]);
  if (sheet.kind === "words-sort-options") return standardChoiceSheet([{ action: "set-words-sort", value: "recent", label: "最新在前", checked: ui.sort === "recent" }, { action: "set-words-sort", value: "oldest", label: "最早在前", checked: ui.sort === "oldest" }, { action: "set-words-sort", value: "alpha", label: "A–Z", checked: ui.sort === "alpha" }, { action: "set-words-sort", value: "random", label: "随机", checked: ui.sort === "random" }]);
  if (sheet.kind === "word-bulk-move") return standardChoiceSheet([{ action: "move-word-bulk-to", id: "", label: "未分类" }, ...wordCollections().map((collection) => ({ action: "move-word-bulk-to", id: collection.id, label: collection.name }))]);
  if (sheet.kind === "wordbook-display-options") return standardChoiceSheet([{ action: "set-wordbook-display", value: "original", label: "显示原句", checked: ui.wordbookShowOriginal }, { action: "set-wordbook-display", value: "notes", label: "显示笔记", checked: ui.wordbookShowNotes }, { action: "set-wordbook-display", value: "all", label: "全部显示", checked: ui.wordbookShowOriginal && ui.wordbookShowNotes }, { action: "set-wordbook-display", value: "none", label: "全部隐藏", checked: !ui.wordbookShowOriginal && !ui.wordbookShowNotes }]);
  if (sheet.kind === "word-collection-switcher") { const choices = [{ id: "words-all", name: "全部单词" }, { id: "words-phrases", name: "词组" }, { id: "words-synonyms", name: "同义辨析" }, { id: READING_WORD_COLLECTION_ID, name: "Reading" }, ...wordCollections(), { id: "words-uncategorized", name: "未分类" }]; return standardChoiceSheet([...choices.map((collection) => ({ action: "set-current-word-collection", id: collection.id, label: collection.name, checked: ui.wordCollectionId === collection.id })), { action: "new-word-collection", label: "＋ 新建合集" }]); }
  if (sheet.kind === "display-options") { const isAll = collectionFor(ui.collectionId)?.isAll; return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet"><button data-action="display-mode" data-value="all"><b>显示全部${ui.showAnnotations && ui.showAnnotationDetails && ui.showSentenceNotes && (!isAll || ui.showCollectionNames) ? " ✓" : ""}</b></button><button data-action="display-mode" data-value="none"><b>隐藏全部${!ui.showAnnotations && !ui.showAnnotationDetails && !ui.showSentenceNotes && (!isAll || !ui.showCollectionNames) ? " ✓" : ""}</b></button><button data-action="display-mode" data-value="annotations"><b>句子标注${ui.showAnnotations ? " ✓" : ""}</b></button><button data-action="display-mode" data-value="annotation-details"><b>标注扩展${ui.showAnnotationDetails ? " ✓" : ""}</b></button><button data-action="display-mode" data-value="sentence-notes"><b>句子笔记${ui.showSentenceNotes ? " ✓" : ""}</b></button>${isAll ? `<button data-action="display-mode" data-value="collection-names"><b>显示合集名称${ui.showCollectionNames ? " ✓" : ""}</b></button>` : ""}<button data-action="close-sheet">取消</button></section>`; }
  if (sheet.kind === "sort-options") { const isAll = collectionFor(ui.collectionId)?.isAll; const mode = isAll ? ui.allCollectionSort : ui.sentenceSort; return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet"><button data-action="set-sentence-sort" data-value="recent"><b>最新在前${mode === "recent" ? " ✓" : ""}</b><span>最近添加的句子排在上面。</span></button><button data-action="set-sentence-sort" data-value="oldest"><b>最早在前${mode === "oldest" ? " ✓" : ""}</b><span>最早保存的句子排在上面。</span></button><button data-action="set-sentence-sort" data-value="random"><b>随机${mode === "random" ? " ✓" : ""}</b><span>打乱顺序，适合复习。</span></button>${isAll ? `<button data-action="set-sentence-sort" data-value="collection"><b>按照合集排序${mode === "collection" ? " ✓" : ""}</b><span>按首页合集的顺序排列。</span></button>` : ""}<button data-action="close-sheet">取消</button></section>`; }
  if (sheet.kind === "wordbook-sort-options") return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet"><button data-action="set-wordbook-sort" data-value="recent"><b>最新在前${ui.wordbookSort === "recent" ? " ✓" : ""}</b><span>最近更新的标注排在上面。</span></button><button data-action="set-wordbook-sort" data-value="oldest"><b>最早在前${ui.wordbookSort === "oldest" ? " ✓" : ""}</b><span>最早添加的标注排在上面。</span></button><button data-action="set-wordbook-sort" data-value="random"><b>随机${ui.wordbookSort === "random" ? " ✓" : ""}</b><span>打乱顺序，适合复习。</span></button><button data-action="close-sheet">取消</button></section>`;
  if (sheet.kind === "words-display-options") return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet"><button data-action="set-word-example-display" data-value="one"><b>显示 1 条例句${ui.wordExampleDisplay === "one" ? " ✓" : ""}</b><span>每个词条显示最近添加的一条例句。</span></button><button data-action="set-word-example-display" data-value="all"><b>显示全部例句${ui.wordExampleDisplay === "all" ? " ✓" : ""}</b><span>在词表中展开每个词条的所有例句。</span></button><button data-action="toggle-word-display" data-value="phrases"><b>显示词组${ui.wordShowPhrases ? " ✓" : ""}</b></button><button data-action="toggle-word-display" data-value="synonyms"><b>显示同义词辨析${ui.wordShowSynonyms ? " ✓" : ""}</b></button><button data-action="close-sheet">取消</button></section>`;
  if (sheet.kind === "word-collection-switcher") { const choices = [{ id: "words-all", name: "全部单词" }, { id: "words-phrases", name: "词组" }, { id: "words-synonyms", name: "同义辨析" }, { id: READING_WORD_COLLECTION_ID, name: "Reading" }, ...wordCollections(), { id: "words-uncategorized", name: "未分类" }]; return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet"><div class="sheet-choice-title">选择合集</div>${choices.map((collection) => `<button data-action="set-current-word-collection" data-id="${collection.id}"><b>${escapeHTML(collection.name)}${ui.wordCollectionId === collection.id ? " ✓" : ""}</b></button>`).join("")}<button data-action="new-word-collection"><b>＋ 新建合集</b></button><button data-action="close-sheet">取消</button></section>`; }
  if (sheet.kind === "words-sort-options") return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet words-sort-sheet"><button data-action="set-words-sort" data-value="recent"><b>最新在前</b>${ui.sort === "recent" ? `<span class="sheet-check">✓</span>` : ""}</button><button data-action="set-words-sort" data-value="oldest"><b>最早在前</b>${ui.sort === "oldest" ? `<span class="sheet-check">✓</span>` : ""}</button><button data-action="set-words-sort" data-value="alpha"><b>A–Z</b>${ui.sort === "alpha" ? `<span class="sheet-check">✓</span>` : ""}</button><button data-action="set-words-sort" data-value="random"><b>随机</b>${ui.sort === "random" ? `<span class="sheet-check">✓</span>` : ""}</button><button data-action="close-sheet">取消</button></section>`;
  if (sheet.kind === "wordbook-display-options") return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet"><button data-action="set-wordbook-display" data-value="original"><b>显示原句${ui.wordbookShowOriginal ? " ✓" : ""}</b></button><button data-action="set-wordbook-display" data-value="notes"><b>显示笔记${ui.wordbookShowNotes ? " ✓" : ""}</b></button><button data-action="set-wordbook-display" data-value="all"><b>全部显示${ui.wordbookShowOriginal && ui.wordbookShowNotes ? " ✓" : ""}</b></button><button data-action="set-wordbook-display" data-value="none"><b>全部隐藏${!ui.wordbookShowOriginal && !ui.wordbookShowNotes ? " ✓" : ""}</b></button><button data-action="close-sheet">取消</button></section>`;
  if (sheet.kind === "bulk-move") {
    const targets = model.collections.filter((collection) => collection.scope !== "words" && collection.id !== sheet.fromCollectionId && !collection.isAll);
    return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet"><div class="sheet-choice-title">移动到合集</div>${targets.map((collection) => `<button data-action="move-bulk-to" data-id="${collection.id}"><b>${escapeHTML(collection.parentId ? `${collectionFor(collection.parentId)?.name || ""} · ${collection.name}` : collection.name)}</b></button>`).join("") || `<p class="sheet-choice-empty">没有其他可移动的合集。</p>`}<button data-action="close-sheet">取消</button></section>`;
  }
  if (sheet.kind === "sentence") {
    const existing = sheet.sentenceId ? sentenceFor(sheet.sentenceId) : null;
    const selectedCollectionId = sheet.collectionId || defaultCollection()?.id || "";
    const collectionOptions = rootCollections().filter((collection) => !collection.isAll).concat(model.collections.filter((item) => item.parentId)).map((collection) => `<option value="${collection.id}" ${selectedCollectionId === collection.id ? "selected" : ""}>${escapeHTML(collection.parentId ? `${collectionFor(collection.parentId)?.name || ""} · ${collection.name}` : collection.name)}</option>`).join("");
    const title = existing ? "Edit sentence" : sheet.entryId ? `Example for ${entryFor(sheet.entryId)?.term || "word"}` : "Save a sentence";
    const entryId = sheet.entryId || "";
    const createdVia = existing?.createdVia || (entryId ? "wordExample" : "reading");
    return `<div class="scrim" data-action="close-sheet"></div><section class="sheet form-sheet"><header><h2>${escapeHTML(title)}</h2><button data-action="close-sheet">×</button></header><form id="sentence-form" data-sentence-id="${existing?.id || ""}" data-entry-id="${entryId}" data-created-via="${createdVia}"><textarea name="text" autofocus required placeholder="Paste one real English sentence…">${escapeHTML(existing?.text || sheet.text || "")}</textarea>${entryId ? "" : `<label>Collection <select name="collectionId">${collectionOptions}</select></label><button class="sheet-link inline-new-collection" type="button" data-action="new-collection-from-sentence">＋ 新建合集</button>`}<button class="primary-button" type="submit">${existing ? "Save changes" : "Save"}</button></form></section>`;
  }
  if (sheet.kind === "collection-from-sentence") return `<div class="scrim" data-action="close-sheet"></div><section class="sheet form-sheet"><header><h2>新建合集</h2><button data-action="close-sheet">×</button></header><form id="collection-from-sentence-form"><label>合集名称 <input name="name" required autofocus placeholder="例如：摩登家庭" /></label><button class="primary-button" type="submit">创建合集</button></form></section>`;
  if (sheet.kind === "sentence-note") {
    const sentence = sentenceFor(sheet.sentenceId);
    return `<div class="scrim" data-action="close-sheet"></div><section class="sheet form-sheet"><header><h2>Notes</h2><button data-action="close-sheet">×</button></header><form id="sentence-note-form" data-id="${sentence?.id || ""}"><textarea name="note" autofocus placeholder="Write a note for this sentence…">${escapeHTML(sentence?.note || "")}</textarea><button class="primary-button" type="submit">Save note</button></form>${sentence?.note ? `<button class="sheet-danger" data-action="delete-sentence-note" data-id="${sentence.id}">Delete note</button>` : ""}</section>`;
  }
  if (sheet.kind === "entry") {
    const annotation = annotationFor(sheet.annotationId);
    const suggested = annotation ? rememberedText(annotation) : "";
    const draft = sheet.draft || {};
    const selectedCollectionId = sheet.collectionId || wordCollectionFor(ui.wordCollectionId)?.id || "";
    const termValue = draft.term ?? suggested;
    const collectionOptions = `<option value="" ${!selectedCollectionId ? "selected" : ""}>未分类</option>${wordCollections().map((collection) => `<option value="${collection.id}" ${selectedCollectionId === collection.id ? "selected" : ""}>${escapeHTML(collection.name)}</option>`).join("")}`;
    return `<div class="scrim" data-action="close-sheet"></div><section class="sheet form-sheet"><header><h2>${annotation ? "加入 Words" : "新增词条"}</h2><button data-action="close-sheet">×</button></header><form id="entry-form" data-annotation-id="${annotation?.id || ""}"><label>单词或短语 <input name="term" required value="${escapeHTML(termValue)}" placeholder="cheek / out of control" /></label><label>合集 <select name="collectionId">${collectionOptions}</select></label><button class="sheet-link inline-new-word-collection" type="button" data-action="new-word-collection-from-entry">＋ 新建分组</button><button class="primary-button" type="submit">保存词条</button></form></section>`;
  }
  if (sheet.kind === "word-collection") return `<div class="scrim" data-action="close-sheet"></div><section class="sheet form-sheet"><header><h2>新建分组</h2><button data-action="close-sheet">×</button></header><form id="word-collection-form"><label>分组名称 <input name="name" required autofocus placeholder="例如：旅行" /></label><label class="checkbox-label"><input type="checkbox" name="showOnWordsHome" checked /> 在 Words 首页显示</label><button class="primary-button" type="submit">创建分组</button></form></section>`;
  if (sheet.kind === "entry-edit-menu") return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet entry-edit-menu"><button data-action="add-example" data-id="${sheet.entryId}"><b>新增例句</b><span>为这个词条添加一个真实例句。</span></button><button data-action="add-entry-phrase" data-id="${sheet.entryId}"><b>添加词组</b><span>选择基础或语境，再填写词组和释义。</span></button><button data-action="add-entry-synonym" data-id="${sheet.entryId}"><b>添加同义辨析</b><span>填写近义词、区别说明和例子。</span></button><button class="danger-choice" data-action="delete-entry" data-id="${sheet.entryId}"><b>删除词条</b></button><button data-action="close-sheet">取消</button></section>`;
  if (sheet.kind === "entry-phrase") return `<div class="scrim" data-action="close-sheet"></div><section class="sheet form-sheet"><header><h2>添加词组</h2><button data-action="close-sheet">×</button></header><form id="entry-phrase-form" data-entry-id="${sheet.entryId}"><label>分类 <select name="group"><option value="basic">基础</option><option value="context">语境</option></select></label><label>词组 <input name="phrase" required autofocus placeholder="colorful clothes" /></label><label>释义 <input name="meaning" placeholder="色彩鲜艳的衣服" /></label><button class="primary-button" type="submit">保存词组</button></form></section>`;
  if (sheet.kind === "entry-synonym") return `<div class="scrim" data-action="close-sheet"></div><section class="sheet form-sheet"><header><h2>添加同义辨析</h2><button data-action="close-sheet">×</button></header><form id="entry-synonym-form" data-entry-id="${sheet.entryId}"><label>同义词 <input name="term" required autofocus placeholder="vibrant" /></label><label>辨析说明 <textarea name="description" required placeholder="说明它与当前词条的语气和使用区别"></textarea></label><label>例子 <textarea name="examples" placeholder="vibrant colors｜鲜艳的色彩&#10;a vibrant city｜一座充满活力的城市"></textarea></label><button class="primary-button" type="submit">保存辨析</button></form></section>`;
  if (sheet.kind === "word-collection-menu") { const collection = wordCollectionFor(sheet.collectionId); return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet"><button data-action="rename-word-collection" data-id="${collection?.id || ""}"><b>重命名合集</b></button><button data-action="toggle-word-collection-home" data-id="${collection?.id || ""}"><b>${collection?.showOnWordsHome ? "从首页隐藏" : "在首页显示"}</b></button><button class="danger-choice" data-action="delete-word-collection" data-id="${collection?.id || ""}"><b>删除合集</b><span>其中的词条会移到未分类。</span></button><button data-action="close-sheet">取消</button></section>`; }
  if (sheet.kind === "rename-word-collection") { const collection = wordCollectionFor(sheet.collectionId); return `<div class="scrim" data-action="close-sheet"></div><section class="sheet form-sheet"><header><h2>重命名词条合集</h2><button data-action="close-sheet">×</button></header><form id="word-collection-rename-form" data-id="${collection?.id || ""}"><label>合集名称 <input name="name" required autofocus value="${escapeHTML(collection?.name || "")}" /></label><button class="primary-button" type="submit">保存</button></form></section>`; }
  if (sheet.kind === "entry-collection") { const entry = entryFor(sheet.entryId); return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet"><div class="sheet-choice-title">移动「${escapeHTML(entry?.term || "")}」到</div><button data-action="move-entry-to-word-collection" data-entry-id="${entry?.id || ""}" data-id=""><b>未分类${!entryWordCollectionId(entry) ? " ✓" : ""}</b></button>${wordCollections().map((collection) => `<button data-action="move-entry-to-word-collection" data-entry-id="${entry?.id || ""}" data-id="${collection.id}"><b>${escapeHTML(collection.name)}${entryWordCollectionId(entry) === collection.id ? " ✓" : ""}</b></button>`).join("")}<button data-action="close-sheet">取消</button></section>`; }
  if (sheet.kind === "collection") return `<div class="scrim" data-action="close-sheet"></div><section class="sheet form-sheet"><header><h2>${sheet.parentId ? "New section" : "New collection"}</h2><button data-action="close-sheet">×</button></header><form id="collection-form" data-parent-id="${sheet.parentId || ""}"><label>Name <input name="name" required autofocus placeholder="Modern Family" /></label><button class="primary-button" type="submit">Create</button></form></section>`;
  if (sheet.kind === "collection-menu") { const collection = collectionFor(sheet.collectionId); return `<div class="scrim" data-action="close-sheet"></div><section class="sheet quick-sheet">${collection?.isAll ? "" : `<button data-action="rename-collection" data-id="${sheet.collectionId}"><b>Rename collection</b><span>Change this collection's name.</span></button>`}${collection?.isDefault || collection?.isAll ? "" : `<button class="danger-choice" data-action="delete-collection" data-id="${sheet.collectionId}"><b>Delete collection</b><span>Its sentences will move to 未分类.</span></button>`}<button data-action="close-sheet">Cancel</button></section>`; }
  if (sheet.kind === "rename-collection") {
    const collection = collectionFor(sheet.collectionId);
    return `<div class="scrim" data-action="close-sheet"></div><section class="sheet form-sheet"><header><h2>Rename collection</h2><button data-action="close-sheet">×</button></header><form id="collection-rename-form" data-id="${collection?.id || ""}"><label>Name <input name="name" required autofocus value="${escapeHTML(collection?.name || "")}" /></label><button class="primary-button" type="submit">Save changes</button></form></section>`;
  }
  if (sheet.kind === "annotation") {
    const annotation = annotationFor(sheet.annotationId);
    const linked = annotation && model.links.find((link) => link.anchorAnnotationId === annotation.id);
    const canAddToLibrary = annotation && !["grammar", "pattern"].includes(annotation.type);
    const libraryStatus = !canAddToLibrary ? "" : linked ? `<div class="sheet-link added-library">已添加（${escapeHTML(entryFor(linked.entryId)?.term || rememberedText(annotation))}）</div>` : `<button class="sheet-link" data-action="promote-annotation" data-id="${annotation?.id || ""}">＋ Add to Library</button>`;
    const canonicalValue = annotation?.entryText && annotation.entryText !== annotation.selectedText ? annotation.entryText : "";
    return `<div class="scrim" data-action="close-sheet"></div><section class="sheet form-sheet annotation-sheet"><header><div class="annotation-title"><span class="annotation-pill ${annotation?.type}">${ANNOTATION_TYPES[annotation?.type]}</span><h2>${escapeHTML(rememberedText(annotation || {}) || "Annotation")}</h2></div><button data-action="close-sheet">×</button></header><form id="annotation-form" data-id="${annotation?.id || ""}"><label>Base form <input name="entryText" value="${escapeHTML(canonicalValue)}" placeholder="headsets → headset / yelling at us → yell at sb" /></label><label>Note <textarea name="note" placeholder="Optional · a small reminder">${escapeHTML(annotation?.note || "")}</textarea></label><button class="primary-button" type="submit">Save</button></form>${libraryStatus}<button class="sheet-danger" data-action="delete-annotation" data-id="${annotation?.id || ""}">Delete annotation</button></section>`;
  }
  if (sheet.kind === "settings") return `<div class="scrim" data-action="close-sheet"></div><section class="sheet settings-sheet"><header><h2>数据</h2><button data-action="close-sheet">×</button></header><p>学习数据仅保存在当前浏览器中，除非你手动导出备份。</p><button class="sheet-link" data-action="export-backup">导出备份</button><button class="sheet-link" data-action="import-backup">导入备份</button><p class="small-copy">建议定期导出到“文件”或 iCloud Drive。清除 Safari 网站数据会删除本地数据。</p></section>`;
  return "";
}

function render() {
  let content = ui.sentenceId ? renderSentence() : ui.screen === "words" ? renderWords() : renderReading();
  const pageVariant = ui.entryId ? "scheme-two-entry" : ui.screen === "words" ? "scheme-one-words" : "";
  document.getElementById("app").innerHTML = `<div class="app-shell ${pageVariant}">${content}${renderNav()}${renderSheet()}${ui.toast ? `<div class="toast">${escapeHTML(ui.toast)}</div>` : ""}</div>`;
}

function renderNav() {
  if (ui.sentenceId || ui.entryId || ui.collectionId || ui.wordbookCollectionId || ui.wordsLibraryOpen) return "";
  return `<nav class="tabbar"><button class="${ui.screen === "reading" ? "active" : ""}" data-action="go-reading"><span>⌁</span>Reading</button><button class="plus-tab" data-action="quick-add" aria-label="Add">＋</button><button class="${ui.screen === "words" ? "active" : ""}" data-action="go-words"><span>⌕</span>Words</button></nav>`;
}

async function saveSentence(form) {
  const text = form.text.value.trim().replace(/\s+/g, " ");
  if (!text) return;
  const existingId = form.dataset.sentenceId || "";
  const existing = existingId ? sentenceFor(existingId) : null;
  const entryId = form.dataset.entryId || "";
  const note = form.note?.value.trim() ?? existing?.note ?? "";
  if (existing) {
    const textChanged = existing.text !== text;
    const annotations = annotationsForSentence(existing.id);
    if (textChanged && annotations.length && !window.confirm("Changing the sentence will remove its annotations so their positions stay accurate. Continue?")) return;
    const updated = { ...existing, text, note, sourceLabel: "", collectionId: entryId ? existing.collectionId : (form.collectionId.value || defaultCollection()?.id || ""), updatedAt: now() };
    await db.put("sentences", updated);
    if (textChanged && annotations.length) {
      await Promise.all(annotations.map((annotation) => db.remove("annotations", annotation.id)));
      await Promise.all(model.links.filter((link) => annotations.some((annotation) => annotation.id === link.anchorAnnotationId)).map((link) => db.put("links", { ...link, anchorAnnotationId: "" })));
    }
    ui.sheet = null; ui.sentenceId = existing.id; await load(); flash("Sentence updated");
    return;
  }
  const sentence = { id: id("sentence"), text, note, sourceLabel: "", collectionId: entryId ? "" : (form.collectionId.value || defaultCollection()?.id || ""), createdVia: form.dataset.createdVia, createdAt: now(), updatedAt: now() };
  await db.put("sentences", sentence);
  if (entryId) await db.put("links", { id: id("link"), entryId, sentenceId: sentence.id, anchorAnnotationId: "", createdAt: now() });
  ui.sheet = null; ui.sentenceId = sentence.id; await load(); flash(entryId ? "Example saved" : "Sentence saved");
}

async function saveSentenceNote(form) {
  const sentence = sentenceFor(form.dataset.id);
  if (!sentence) return;
  await db.put("sentences", { ...sentence, note: form.note.value.trim(), updatedAt: now() });
  ui.sheet = null;
  await load();
  flash("Note saved");
}

async function saveEntry(form) {
  const term = form.term.value.trim().replace(/\s+/g, " ");
  if (!term) return;
  const kind = /\s/.test(term) ? "phrase" : "word";
  const normalized = normalizeTerm(term);
  let entry = model.entries.find((item) => item.normalizedTerm === normalized && item.kind === kind);
  const collectionId = wordCollectionFor(form.collectionId?.value)?.id || "";
  if (!entry) entry = { id: id("entry"), term, normalizedTerm: normalized, kind, hint: "", collectionId, createdAt: now(), updatedAt: now() };
  else entry = { ...entry, term, hint: "", collectionId, updatedAt: now() };
  await db.put("entries", entry);
  const annotationId = form.dataset.annotationId;
  if (annotationId) {
    const annotation = annotationFor(annotationId);
    if (annotation && !["grammar", "pattern"].includes(annotation.type)) {
      const duplicate = model.links.some((link) => link.entryId === entry.id && link.sentenceId === annotation.sentenceId);
      if (!duplicate) await db.put("links", { id: id("link"), entryId: entry.id, sentenceId: annotation.sentenceId, anchorAnnotationId: annotation.id, createdAt: now() });
    }
  }
  ui.sheet = null; ui.entryId = entry.id; ui.sentenceId = null; ui.screen = "words"; await load(); flash("Added to Library");
}

async function promoteAnnotation(annotationId) {
  const annotation = annotationFor(annotationId);
  if (!annotation || ["grammar", "pattern"].includes(annotation.type)) return;
  const term = rememberedText(annotation);
  if (!term) return;
  const kind = annotation.type === "phrase" ? "phrase" : "word";
  const normalized = normalizeTerm(term);
  let entry = model.entries.find((item) => item.normalizedTerm === normalized && item.kind === kind);
  if (!entry) {
    entry = { id: id("entry"), term, normalizedTerm: normalized, kind, hint: "", collectionId: READING_WORD_COLLECTION_ID, createdAt: now(), updatedAt: now() };
  } else {
    entry = { ...entry, collectionId: READING_WORD_COLLECTION_ID, updatedAt: now() };
  }
  await db.put("entries", entry);
  const linked = model.links.some((link) => link.anchorAnnotationId === annotation.id);
  if (!linked) await db.put("links", { id: id("link"), entryId: entry.id, sentenceId: annotation.sentenceId, anchorAnnotationId: annotation.id, createdAt: now() });
  ui.sheet = { kind: "annotation", annotationId: annotation.id };
  await load();
  flash(`已添加（${term}）`);
}

async function saveEntryPhrase(form) {
  const phrase = form.phrase.value.trim().replace(/\s+/g, " ");
  if (!phrase) return;
  const entry = entryFor(form.dataset.entryId);
  if (!entry) return;
  const item = { id: id("insight"), entryId: entry.id, type: "phrase", group: form.group.value, phrase, meaning: form.meaning.value.trim(), createdAt: now(), updatedAt: now() };
  await db.put("wordInsights", item);
  ui.sheet = null;
  await load();
  flash("词组已添加");
}

async function saveEntrySynonym(form) {
  const term = form.term.value.trim();
  const description = form.description.value.trim();
  const entry = entryFor(form.dataset.entryId);
  if (!term || !description || !entry) return;
  const examples = form.examples.value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [text, meaning = ""] = line.split(/[|｜]/);
    return [text.trim(), meaning.trim()];
  }).filter(([text]) => text);
  const item = { id: id("insight"), entryId: entry.id, type: "synonym", term, description, examples, createdAt: now(), updatedAt: now() };
  await db.put("wordInsights", item);
  ui.sheet = null;
  await load();
  flash("同义辨析已添加");
}

async function saveEntryTarget(entry, sentence, link, selected) {
  const oldTargets = model.annotations.filter((item) => item.sentenceId === sentence.id && item.type === "target");
  if (oldTargets.length || selected) await Promise.all(oldTargets.map((item) => db.remove("annotations", item.id)));
  let anchorAnnotationId = "";
  if (selected) {
    const annotation = { id: id("annotation"), sentenceId: sentence.id, startOffset: selected.startOffset, endOffset: selected.endOffset, selectedText: selected.text, ranges: selected.ranges, entryText: entry.term, type: "target", note: "", createdAt: now(), updatedAt: now() };
    await db.put("annotations", annotation);
    anchorAnnotationId = annotation.id;
  }
  if (link && (oldTargets.length || selected)) await db.put("links", { ...link, anchorAnnotationId });
  return anchorAnnotationId;
}

async function saveEntryExamples(entry, sentences) {
  const inputs = [...document.querySelectorAll("[data-entry-example]")];
  inputs.forEach((input) => { ui.entryDrafts = { ...ui.entryDrafts, [`${entry.id}:${input.dataset.entryExample}`]: input.value }; });
  const links = linksForEntry(entry.id);
  for (const sentence of sentences) {
    const text = entryDraftText(entry, sentence.id, sentence.text).trim().replace(/\s+/g, " ");
    const link = links.find((item) => item.sentenceId === sentence.id);
    if (!text) {
      if (link) await db.remove("links", link.id);
      const otherLinks = model.links.filter((item) => item.sentenceId === sentence.id && item.id !== link?.id);
      if (!otherLinks.length) {
        await Promise.all(model.annotations.filter((annotation) => annotation.sentenceId === sentence.id).map((annotation) => db.remove("annotations", annotation.id)));
        await db.remove("sentences", sentence.id);
      }
      continue;
    }
    const changed = text !== sentence.text;
    const updatedSentence = changed ? { ...sentence, text, updatedAt: now() } : sentence;
    if (changed) await db.put("sentences", updatedSentence);
    const synthetic = { id: `entry-draft-${entry.id}-${sentence.id}`, text };
    const selected = tokenSelectionFor(synthetic);
    if (changed || selected) await saveEntryTarget(entry, updatedSentence, link, selected);
  }
  for (let index = 0; index < (ui.entryNewExampleCount || 0); index += 1) {
    const draftId = `new-${index}`;
    const newText = entryDraftText(entry, draftId, "").trim().replace(/\s+/g, " ");
    if (!newText) continue;
    const sentence = { id: id("sentence"), text: newText, note: "", sourceLabel: "", collectionId: "", createdVia: "wordExample", createdAt: now(), updatedAt: now() };
    await db.put("sentences", sentence);
    const link = { id: id("link"), entryId: entry.id, sentenceId: sentence.id, anchorAnnotationId: "", createdAt: now() };
    const selected = tokenSelectionFor({ id: `entry-draft-${entry.id}-${draftId}`, text: newText });
    if (selected) link.anchorAnnotationId = await saveEntryTarget(entry, sentence, link, selected);
    await db.put("links", link);
  }
}

async function saveEntryPhrases(entry) {
  const rows = [...document.querySelectorAll(".phrase-edit-row")];
  for (const row of rows) {
    const draft = ui.entryInsightDrafts?.[row.dataset.insightKey] || {};
    const phrase = (row.querySelector('[data-insight-field="phrase"]')?.value ?? draft.phrase ?? "").trim().replace(/\s+/g, " ");
    const meaning = (row.querySelector('[data-insight-field="meaning"]')?.value ?? draft.meaning ?? "").trim();
    const synthetic = { id: `phrase-draft-${entry.id}-${row.dataset.insightKey}`, text: phrase };
    const selected = tokenSelectionFor(synthetic);
    const existing = row.dataset.insightId ? model.wordInsights.find((insight) => insight.id === row.dataset.insightId) : null;
    const targetRanges = selected?.ranges || existing?.targetRanges || [];
    if (row.dataset.insightId) {
      const item = model.wordInsights.find((insight) => insight.id === row.dataset.insightId);
      if (!item) continue;
      if (!phrase) await db.remove("wordInsights", item.id);
      else await db.put("wordInsights", { ...item, phrase, meaning, targetRanges, updatedAt: now() });
    } else if (phrase) {
      await db.put("wordInsights", { id: id("insight"), entryId: entry.id, type: "phrase", group: row.dataset.insightGroup || "basic", phrase, meaning, targetRanges, createdAt: now(), updatedAt: now() });
    }
  }
}

async function saveEntrySynonyms(entry) {
  const rows = [...document.querySelectorAll(".synonym-edit-row")];
  for (const row of rows) {
    const term = row.querySelector('[data-insight-field="term"]')?.value.trim() || "";
    const description = row.querySelector('[data-insight-field="description"]')?.value.trim() || "";
    const examples = [...row.querySelectorAll(".synonym-example-edit")].map((example) => [example.querySelector("[data-insight-example-text]")?.value.trim() || "", example.querySelector("[data-insight-example-meaning]")?.value.trim() || ""]).filter(([text]) => text);
    if (row.dataset.insightId) {
      const item = model.wordInsights.find((insight) => insight.id === row.dataset.insightId);
      if (!item) continue;
      if (!term) await db.remove("wordInsights", item.id);
      else await db.put("wordInsights", { ...item, term, description, examples, updatedAt: now() });
    } else if (term) {
      await db.put("wordInsights", { id: id("insight"), entryId: entry.id, type: "synonym", term, description, examples, createdAt: now(), updatedAt: now() });
    }
  }
}

async function saveEntryEdit() {
  const entry = entryFor(ui.entryId);
  if (!entry) return;
  const sentences = linksForEntry(entry.id).map((link) => sentenceFor(link.sentenceId)).filter(Boolean);
  if (ui.entryTab === "examples") await saveEntryExamples(entry, sentences);
  if (ui.entryTab === "phrases") await saveEntryPhrases(entry);
  if (ui.entryTab === "synonyms") await saveEntrySynonyms(entry);
  ui.entryEditing = false; ui.entryEditingTargetId = ""; ui.entryInsightTargetId = ""; ui.entryDrafts = {}; ui.entryNewExampleCount = 0; ui.entryInsightDrafts = {}; ui.entryInsightNewCounts = {}; ui.entrySynonymExampleCounts = {}; ui.entrySynonymDrafts = {}; ui.entryNewSynonymCount = 0; ui.tokenSelection = [];
  await load();
  flash("已保存");
}

async function saveAnnotation(type) {
  const sentence = sentenceFor(ui.sentenceId);
  const selection = sentence && tokenSelectionFor(sentence);
  if (!selection) return;
  const sameRanges = (left, right) => left.length === right.length && left.every((range, index) => range.startOffset === right[index].startOffset && range.endOffset === right[index].endOffset);
  const duplicate = model.annotations.some((item) => item.sentenceId === selection.sentenceId && item.type === type && sameRanges(annotationRanges(item), selection.ranges));
  if (duplicate) return flash("This annotation already exists");
  const annotation = { id: id("annotation"), sentenceId: selection.sentenceId, startOffset: selection.startOffset, endOffset: selection.endOffset, selectedText: selection.text, ranges: selection.ranges, entryText: type === "target" ? (entryFor(ui.entryId)?.term || "") : "", type, note: "", createdAt: now(), updatedAt: now() };
  await db.put("annotations", annotation);
  if (type === "target" && ui.entryId) {
    const linked = model.links.find((link) => link.entryId === ui.entryId && link.sentenceId === selection.sentenceId);
    if (linked) await db.put("links", { ...linked, anchorAnnotationId: annotation.id });
    else await db.put("links", { id: id("link"), entryId: ui.entryId, sentenceId: selection.sentenceId, anchorAnnotationId: annotation.id, createdAt: now() });
  }
  ui.selection = null; ui.tokenSelection = []; await load(); flash("已标注为" + ANNOTATION_TYPES[type]);
}

async function saveCollection(form) {
  const name = form.name.value.trim();
  if (!name) return;
  const parentId = form.dataset.parentId || "";
  await db.put("collections", { id: id("collection"), name, parentId, createdAt: now(), updatedAt: now() });
  ui.sheet = null; await load(); flash(parentId ? "Section created" : "Collection created");
}

async function saveWordCollection(form) {
  const name = form.name.value.trim();
  if (!name) return;
  if (wordCollections().some((collection) => collection.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return flash("这个合集已经存在");
  const collection = { id: id("word-collection"), name, scope: "words", showOnWordsHome: form.showOnWordsHome.checked, createdAt: now(), updatedAt: now() };
  await db.put("collections", collection);
  const entryDraft = ui.sheet?.entryDraft;
  if (entryDraft) {
    ui.wordCollectionId = collection.id;
    ui.sheet = { kind: "entry", annotationId: entryDraft.annotationId || "", collectionId: collection.id, draft: { term: entryDraft.term || "", kind: entryDraft.kind || "word", hint: entryDraft.hint || "" } };
  } else ui.sheet = null;
  await load();
  flash(entryDraft ? "分组已创建" : "词条合集已创建");
}

async function renameWordCollection(form) {
  const collection = wordCollectionFor(form.dataset.id);
  const name = form.name.value.trim();
  if (!collection || !name) return;
  await db.put("collections", { ...collection, name, updatedAt: now() });
  ui.sheet = null;
  await load();
  flash("合集已重命名");
}

async function renameCollection(form) {
  const collection = collectionFor(form.dataset.id);
  const name = form.name.value.trim();
  if (!collection || !name) return;
  await db.put("collections", { ...collection, name, updatedAt: now() });
  ui.sheet = null;
  await load();
  flash("Collection renamed");
}

function speak(term) {
  if (!("speechSynthesis" in window)) return flash("Speech is not available here");
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(term);
  utterance.lang = "en-US"; utterance.rate = .88;
  window.speechSynthesis.speak(utterance);
}

function backupPayload() { return { format: "margin-sentences", version: 1, exportedAt: new Date().toISOString(), ...model }; }
function exportBackup() {
  const blob = new Blob([JSON.stringify(backupPayload(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `margin-sentences-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); flash("Backup downloaded");
}

async function importBackup(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload.format !== "margin-sentences" || !STORES.every((store) => Array.isArray(payload[store]))) throw new Error("invalid-backup");
    await db.replaceAll(payload); ui = { ...ui, screen: "reading", collectionId: null, wordbookCollectionId: null, sentenceId: null, entryId: null, bulkEditing: false, bulkSelection: [], sheet: null, selection: null, tokenSelection: [], appendAnnotationId: "" }; await load(); flash("Backup restored");
  } catch (_) { flash("This is not a Margin backup"); }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action; const recordId = target.dataset.id || "";
  if (action === "go-reading") { ui = { ...ui, screen: "reading", wordsLibraryOpen: false, search: "", sort: "recent" }; render(); }
  if (action === "go-words") { ui = { ...ui, screen: "words", wordsLibraryOpen: false, search: "", sort: "recent" }; render(); }
  if (action === "quick-add") { ui.sheet = { kind: "quick" }; render(); }
  if (action === "close-sheet" || action === "clear-selection") { ui.sheet = null; ui.selection = null; ui.tokenSelection = []; ui.appendAnnotationId = ""; window.getSelection()?.removeAllRanges(); render(); }
  if (action === "settings") { ui.sheet = { kind: "settings" }; render(); }
  if (action === "toggle-words-mode") { ui.wordsMode = ui.wordsMode === "edit" ? "read" : "edit"; render(); }
  if (action === "toggle-wordbook-mode") { ui.wordbookMode = ui.wordbookMode === "edit" ? "read" : "edit"; render(); }
  if (action === "toggle-word-bulk") { ui.wordBulkEditing = !ui.wordBulkEditing; ui.wordBulkSelection = []; render(); }
  if (action === "cancel-word-bulk") { ui.wordBulkEditing = false; ui.wordBulkSelection = []; render(); }
  if (action === "save-sentence") { ui.sheet = { kind: "sentence", collectionId: collectionFor(ui.collectionId)?.isAll ? (defaultCollection()?.id || "") : (ui.collectionId || ""), entryId: "" }; render(); }
  if (action === "sentence-note") { ui.sheet = { kind: "sentence-note", sentenceId: recordId }; render(); }
  if (action === "edit-sentence") { const sentence = sentenceFor(recordId); if (sentence) { ui.sheet = { kind: "sentence", sentenceId: sentence.id, collectionId: sentence.collectionId || "", entryId: "" }; render(); } }
  if (action === "add-example") { ui.sheet = { kind: "sentence", collectionId: "", entryId: recordId }; render(); }
  if (action === "new-entry") { ui.sheet = { kind: "entry", annotationId: "" }; render(); }
  if (action === "new-word-collection-from-entry") {
    const form = document.getElementById("entry-form");
    ui.sheet = { kind: "word-collection", entryDraft: { annotationId: form?.dataset.annotationId || "", term: form?.term?.value || "", kind: form?.kind?.value || "word", hint: form?.hint?.value || "" } };
    render();
  }
  if (action === "word-collection-switcher") { ui.sheet = { kind: "word-collection-switcher" }; render(); }
  if (action === "set-current-word-collection") { ui.wordCollectionId = recordId; ui.sheet = null; ui.search = ""; render(); }
  if (action === "open-words-library") { ui.wordsLibraryOpen = true; ui.wordsLibraryTab = "reading"; ui.wordsLibraryType = "all"; ui.search = ""; render(); }
  if (action === "back-words-library") { ui.wordsLibraryOpen = false; ui.search = ""; render(); }
  if (action === "switch-words-library-tab") { ui.wordsLibraryTab = target.dataset.value; render(); }
  if (action === "words-library-filter") { ui.wordsLibraryType = target.dataset.value; render(); }
  if (action === "new-word-collection") { ui.sheet = { kind: "word-collection" }; render(); }
  if (action === "word-collection-menu") { ui.sheet = { kind: "word-collection-menu", collectionId: recordId }; render(); }
  if (action === "rename-word-collection") { ui.sheet = { kind: "rename-word-collection", collectionId: recordId }; render(); }
  if (action === "open-word-collection" || action === "filter-word-collection") { ui.wordCollectionId = recordId; ui.wordsLibraryOpen = false; ui.search = ""; render(); }
  if (action === "toggle-bulk-entry") { ui.wordBulkSelection = ui.wordBulkSelection.includes(recordId) ? ui.wordBulkSelection.filter((idValue) => idValue !== recordId) : [...ui.wordBulkSelection, recordId]; render(); }
  if (action === "toggle-bulk-entry-all") { const visibleEntries = entriesForWordCollection(ui.wordCollectionId); const allSelected = visibleEntries.length > 0 && visibleEntries.every((entry) => ui.wordBulkSelection.includes(entry.id)); ui.wordBulkSelection = allSelected ? ui.wordBulkSelection.filter((idValue) => !visibleEntries.some((entry) => entry.id === idValue)) : [...new Set([...ui.wordBulkSelection, ...visibleEntries.map((entry) => entry.id)])]; render(); }
  if (action === "word-bulk-move-selected") { if (!ui.wordBulkSelection.length) return flash("请先选择词条"); ui.sheet = { kind: "word-bulk-move" }; render(); }
  if (action === "move-word-bulk-to") { const collectionId = wordCollectionFor(recordId)?.id || ""; const selectedEntries = model.entries.filter((entry) => ui.wordBulkSelection.includes(entry.id)); await Promise.all(selectedEntries.map((entry) => db.put("entries", { ...entry, collectionId, updatedAt: now() }))); ui.wordBulkEditing = false; ui.wordBulkSelection = []; ui.sheet = null; await load(); flash("词条已移动"); }
  if (action === "word-bulk-delete-selected") { if (!ui.wordBulkSelection.length) return flash("请先选择词条"); if (!window.confirm(`删除已选的 ${ui.wordBulkSelection.length} 个词条？例句将保留。`)) return; const selectedEntries = model.entries.filter((entry) => ui.wordBulkSelection.includes(entry.id)); await Promise.all(selectedEntries.flatMap((entry) => [db.remove("entries", entry.id), ...linksForEntry(entry.id).map((link) => db.remove("links", link.id)), ...insightsForEntry(entry.id).map((insight) => db.remove("wordInsights", insight.id))])); ui.wordBulkEditing = false; ui.wordBulkSelection = []; await load(); flash("词条已删除"); }
  if (action === "open-reading-wordbook") { ui.screen = "reading"; ui.wordbookReturn = "words"; ui.wordbookCollectionId = recordId; ui.collectionId = null; ui.wordsLibraryOpen = false; render(); }
  if (action === "toggle-word-collection-home") {
    const collection = wordCollectionFor(recordId);
    if (collection && !collection.isSystem) { await db.put("collections", { ...collection, showOnWordsHome: !collection.showOnWordsHome, updatedAt: now() }); ui.sheet = null; await load(); flash(collection.showOnWordsHome ? "已从首页隐藏" : "已在首页显示"); }
  }
  if (action === "entry-collection") { ui.sheet = { kind: "entry-collection", entryId: recordId }; render(); }
  if (action === "move-entry-to-word-collection") {
    const entry = entryFor(target.dataset.entryId);
    const collectionId = wordCollectionFor(recordId)?.id || "";
    if (entry) { await db.put("entries", { ...entry, collectionId, updatedAt: now() }); ui.sheet = null; await load(); flash(`已移到${collectionId ? wordCollectionFor(collectionId)?.name : "未分类"}`); }
  }
  if (action === "new-collection") { ui.sheet = { kind: "collection", parentId: "" }; render(); }
  if (action === "new-collection-from-sentence") {
    const form = document.getElementById("sentence-form");
    ui.sheet = { kind: "collection-from-sentence", sentenceDraft: { text: form?.text?.value || "", sentenceId: form?.dataset.sentenceId || "", entryId: form?.dataset.entryId || "", createdVia: form?.dataset.createdVia || "reading" } };
    render();
  }
  if (action === "new-child-collection") { ui.sheet = { kind: "collection", parentId: recordId }; render(); }
  if (action === "collection-menu") { ui.sheet = { kind: "collection-menu", collectionId: recordId }; render(); }
  if (action === "rename-collection") { ui.sheet = { kind: "rename-collection", collectionId: recordId }; render(); }
  if (action === "open-collection") { ui.collectionId = recordId; ui.wordbookCollectionId = null; ui.bulkEditing = false; ui.bulkSelection = []; ui.search = ""; render(); }
  if (action === "open-wordbook") { ui.wordbookReturn = "reading"; ui.wordbookCollectionId = recordId; ui.wordbookType = "all"; render(); }
  if (action === "back-wordbook") { const returnToWords = ui.wordbookReturn === "words"; ui.wordbookCollectionId = null; ui.wordbookReturn = "reading"; if (returnToWords) { ui.screen = "words"; ui.wordsLibraryOpen = true; } render(); }
  if (action === "back-reading") { ui.collectionId = null; ui.wordbookCollectionId = null; ui.bulkEditing = false; ui.bulkSelection = []; ui.search = ""; render(); }
  if (action === "open-sentence") { ui.sentenceId = recordId; ui.selection = null; ui.tokenSelection = []; render(); }
  if (action === "back-from-sentence") { const sentence = sentenceFor(ui.sentenceId); ui.sentenceId = null; ui.selection = null; ui.tokenSelection = []; ui.appendAnnotationId = ""; if (ui.screen === "reading" && sentence?.collectionId) ui.collectionId = sentence.collectionId; render(); }
  if (action === "speak-entry") { speak(target.dataset.term || ""); }
  if (action === "speak-wordbook") { speak(target.dataset.term || ""); }
  if (action === "open-entry") { ui.entryId = recordId; ui.entryTab = "examples"; ui.entryEditing = false; ui.entryEditingTargetId = ""; ui.entryInsightTargetId = ""; ui.entryDrafts = {}; ui.entryNewExampleCount = 0; ui.entryInsightDrafts = {}; ui.entryInsightNewCounts = {}; ui.entrySynonymExampleCounts = {}; ui.entrySynonymDrafts = {}; ui.entryNewSynonymCount = 0; ui.tokenSelection = []; ui.sentenceId = null; ui.sheet = null; ui.screen = "words"; render(); }
  if (action === "back-words") { ui.entryId = null; ui.search = ""; render(); }
  if (action === "entry-toggle-edit") { ui.entryEditing = !ui.entryEditing; ui.entryEditingTargetId = ""; ui.entryInsightTargetId = ""; ui.entryDrafts = {}; ui.entryNewExampleCount = 0; ui.entryInsightDrafts = {}; ui.entryInsightNewCounts = {}; ui.entrySynonymExampleCounts = {}; ui.entrySynonymDrafts = {}; ui.entryNewSynonymCount = 0; ui.tokenSelection = []; render(); }
  if (action === "entry-select-target") {
    const entry = entryFor(ui.entryId);
    const input = document.querySelector(`[data-entry-example="${recordId}"]`);
    if (entry) {
      const key = `${entry.id}:${recordId}`;
      ui.entryDrafts = { ...ui.entryDrafts, [key]: input?.value || ui.entryDrafts[key] || "" };
      const sentenceId = `entry-draft-${entry.id}-${recordId}`;
      ui.tokenSelection = (ui.tokenSelection || []).filter((token) => token.sentenceId !== sentenceId);
      ui.entryEditingTargetId = recordId;
      render();
    }
  }
  if (action === "entry-finish-target") { ui.entryEditingTargetId = ""; render(); }
  if (action === "phrase-select-target") {
    const entry = entryFor(ui.entryId);
    const row = target.closest(".phrase-edit-row");
    const key = recordId;
    if (entry && row) {
      const phraseInput = row.querySelector('[data-insight-field="phrase"]');
      const meaningInput = row.querySelector('[data-insight-field="meaning"]');
      ui.entryInsightDrafts = { ...ui.entryInsightDrafts, [key]: { phrase: phraseInput?.value || "", meaning: meaningInput?.value || "" } };
      ui.entryInsightTargetId = key;
      ui.tokenSelection = (ui.tokenSelection || []).filter((token) => token.sentenceId !== `phrase-draft-${entry.id}-${key}`);
      render();
    }
  }
  if (action === "phrase-finish-target") { ui.entryInsightTargetId = ""; render(); }
  if (action === "add-entry-example") { ui.entryNewExampleCount = (ui.entryNewExampleCount || 0) + 1; render(); }
  if (action === "add-entry-phrase") { const group = target.dataset.group || "basic"; ui.entryInsightNewCounts = { ...ui.entryInsightNewCounts, [group]: (ui.entryInsightNewCounts[group] || 0) + 1 }; render(); }
  if (action === "add-entry-synonym") { ui.entryNewSynonymCount = (ui.entryNewSynonymCount || 0) + 1; render(); }
  if (action === "add-synonym-example") {
    const row = target.closest(".synonym-edit-row");
    captureSynonymDraft(row);
    const key = recordId;
    const current = ui.entrySynonymExampleCounts?.[key] ?? row?.querySelectorAll(".synonym-example-edit").length ?? 0;
    ui.entrySynonymExampleCounts = { ...ui.entrySynonymExampleCounts, [key]: current + 1 };
    render();
  }
  if (action === "save-entry-edit") await saveEntryEdit();
  if (action === "entry-tab") { ui.entryTab = target.dataset.value || "examples"; render(); }
  if (action === "sort") { ui.sort = target.dataset.value; render(); }
  if (action === "words-display-options") { ui.sheet = { kind: "words-display-options" }; render(); }
  if (action === "words-sort-options") { ui.sheet = { kind: "words-sort-options" }; render(); }
  if (action === "set-word-example-display") { ui.wordExampleDisplay = target.dataset.value; ui.sheet = null; render(); }
  if (action === "toggle-word-display") { if (target.dataset.value === "phrases") ui.wordShowPhrases = !ui.wordShowPhrases; if (target.dataset.value === "synonyms") ui.wordShowSynonyms = !ui.wordShowSynonyms; render(); }
  if (action === "set-words-sort") { ui.sort = target.dataset.value; ui.sheet = null; render(); }
  if (action === "wordbook-filter") { ui.wordbookType = target.dataset.value; render(); }
  if (action === "display-options") { ui.sheet = { kind: "display-options" }; render(); }
  if (action === "display-mode") {
    const mode = target.dataset.value;
    if (mode === "all") { ui.showAnnotations = ui.showAnnotationDetails = ui.showSentenceNotes = true; if (collectionFor(ui.collectionId)?.isAll) ui.showCollectionNames = true; }
    if (mode === "none") { ui.showAnnotations = ui.showAnnotationDetails = ui.showSentenceNotes = false; if (collectionFor(ui.collectionId)?.isAll) ui.showCollectionNames = false; }
    if (mode === "annotations") ui.showAnnotations = !ui.showAnnotations;
    if (mode === "annotation-details") ui.showAnnotationDetails = !ui.showAnnotationDetails;
    if (mode === "sentence-notes") ui.showSentenceNotes = !ui.showSentenceNotes;
    if (mode === "collection-names") ui.showCollectionNames = !ui.showCollectionNames;
    ui.sheet = null; render();
  }
  if (action === "sort-options") { ui.sheet = { kind: "sort-options" }; render(); }
  if (action === "wordbook-sort-options") { ui.sheet = { kind: "wordbook-sort-options" }; render(); }
  if (action === "wordbook-display-options") { ui.sheet = { kind: "wordbook-display-options" }; render(); }
  if (action === "set-sentence-sort") { if (collectionFor(ui.collectionId)?.isAll) ui.allCollectionSort = target.dataset.value; else ui.sentenceSort = target.dataset.value; ui.sheet = null; render(); }
  if (action === "set-wordbook-sort") { ui.wordbookSort = target.dataset.value; ui.sheet = null; render(); }
  if (action === "set-wordbook-display") {
    const mode = target.dataset.value;
    if (mode === "original") ui.wordbookShowOriginal = !ui.wordbookShowOriginal;
    if (mode === "notes") ui.wordbookShowNotes = !ui.wordbookShowNotes;
    if (mode === "all") ui.wordbookShowOriginal = ui.wordbookShowNotes = true;
    if (mode === "none") ui.wordbookShowOriginal = ui.wordbookShowNotes = false;
    ui.sheet = null; render();
  }
  if (action === "toggle-annotations") { ui.showAnnotations = !ui.showAnnotations; render(); }
  if (action === "toggle-notes") { ui.showNotes = !ui.showNotes; render(); }
  if (action === "toggle-bulk") { ui.bulkEditing = !ui.bulkEditing; ui.bulkSelection = []; render(); }
  if (action === "cancel-bulk") { ui.bulkEditing = false; ui.bulkSelection = []; render(); }
  if (action === "toggle-bulk-sentence") {
    const selected = new Set(ui.bulkSelection);
    if (selected.has(recordId)) selected.delete(recordId); else selected.add(recordId);
    ui.bulkSelection = [...selected];
    render();
  }
  if (action === "toggle-bulk-all") {
    const ids = (collectionFor(ui.collectionId)?.isAll ? readingSentences() : readingSentences().filter((sentence) => sentence.collectionId === ui.collectionId)).map((sentence) => sentence.id);
    const allSelected = ids.length > 0 && ids.every((sentenceId) => ui.bulkSelection.includes(sentenceId));
    ui.bulkSelection = allSelected ? [] : ids;
    render();
  }
  if (action === "bulk-delete-selected") {
    const selected = ui.bulkSelection.filter((sentenceId) => sentenceFor(sentenceId));
    if (!selected.length) return flash("先选择句子");
    if (!window.confirm(`Delete ${selected.length} selected sentence${selected.length === 1 ? "" : "s"} and their annotations?`)) return;
    await Promise.all(selected.map((sentenceId) => db.remove("sentences", sentenceId)));
    await Promise.all(model.annotations.filter((item) => selected.includes(item.sentenceId)).map((item) => db.remove("annotations", item.id)));
    await Promise.all(model.links.filter((item) => selected.includes(item.sentenceId)).map((item) => db.remove("links", item.id)));
    ui.bulkEditing = false; ui.bulkSelection = [];
    await load(); flash("Deleted selected sentences");
  }
  if (action === "bulk-move-selected") {
    const selected = ui.bulkSelection.filter((sentenceId) => sentenceFor(sentenceId));
    if (!selected.length) return flash("先选择句子");
    ui.sheet = { kind: "bulk-move", fromCollectionId: ui.collectionId, sentenceIds: selected };
    render();
  }
  if (action === "move-bulk-to") {
    const selected = (ui.sheet?.sentenceIds || []).filter((sentenceId) => sentenceFor(sentenceId));
    if (!selected.length || !collectionFor(recordId)) return;
    await Promise.all(selected.map((sentenceId) => { const sentence = sentenceFor(sentenceId); return db.put("sentences", { ...sentence, collectionId: recordId, updatedAt: now() }); }));
    ui.sheet = null; ui.bulkEditing = false; ui.bulkSelection = [];
    await load(); flash("已移动句子");
  }
  if (action === "speak") { event.stopPropagation(); speak(target.dataset.term); }
  if (action === "toggle-token") {
    event.stopPropagation();
    const token = { sentenceId: target.dataset.sentenceId, startOffset: Number(target.dataset.start), endOffset: Number(target.dataset.end) };
    const allSelections = [...(ui.tokenSelection || [])];
    const existing = allSelections.filter((item) => item.sentenceId === token.sentenceId);
    const position = existing.findIndex((item) => item.startOffset === token.startOffset && item.endOffset === token.endOffset);
    if (position >= 0) existing.splice(position, 1); else existing.push(token);
    ui.selection = null; ui.tokenSelection = [...allSelections.filter((item) => item.sentenceId !== token.sentenceId), ...existing]; render();
  }
  if (action === "annotation-detail") { event.stopPropagation(); ui.sheet = { kind: "annotation", annotationId: recordId }; render(); }
  if (action === "create-annotation") await saveAnnotation(target.dataset.type);
  if (action === "promote-annotation") await promoteAnnotation(recordId);
  if (action === "delete-annotation") { if (!window.confirm("Delete this annotation?")) return; await db.remove("annotations", recordId); await Promise.all(model.links.filter((link) => link.anchorAnnotationId === recordId).map((link) => db.put("links", { ...link, anchorAnnotationId: "" }))); ui.sheet = null; await load(); flash("Annotation deleted"); }
  if (action === "delete-sentence-note") {
    const sentence = sentenceFor(recordId);
    if (!sentence || !window.confirm("Delete this note?")) return;
    await db.put("sentences", { ...sentence, note: "", updatedAt: now() });
    ui.sheet = null;
    await load(); flash("Note deleted");
  }
  if (action === "clear-annotations") {
    const annotations = annotationsForSentence(recordId);
    if (!annotations.length) return flash("没有可清空的标注");
    if (!window.confirm("清空这句话的全部标注？句子和句子笔记会保留。")) return;
    await Promise.all(annotations.map((annotation) => db.remove("annotations", annotation.id)));
    await Promise.all(model.links.filter((link) => annotations.some((annotation) => annotation.id === link.anchorAnnotationId)).map((link) => db.put("links", { ...link, anchorAnnotationId: "" })));
    ui.selection = null; ui.tokenSelection = [];
    await load(); flash("已清空标注");
  }
  if (action === "delete-sentence") { if (!window.confirm("Delete this sentence and its annotations?")) return; await db.remove("sentences", recordId); await Promise.all(annotationsForSentence(recordId).map((item) => db.remove("annotations", item.id))); await Promise.all(linksForSentence(recordId).map((item) => db.remove("links", item.id))); ui.sentenceId = null; await load(); flash("Sentence deleted"); }
  if (action === "delete-entry") { if (!window.confirm("Delete this entry? Its sentences will stay saved.")) return; await db.remove("entries", recordId); await Promise.all(linksForEntry(recordId).map((item) => db.remove("links", item.id))); await Promise.all(insightsForEntry(recordId).map((item) => db.remove("wordInsights", item.id))); ui.entryId = null; ui.sheet = null; await load(); flash("Entry deleted"); }
  if (action === "delete-word-collection") {
    const collection = wordCollectionFor(recordId);
    if (!collection || collection.isSystem || !window.confirm(`删除「${collection.name}」？其中的词条会移到未分类。`)) return;
    await Promise.all(model.entries.filter((entry) => entry.collectionId === collection.id).map((entry) => db.put("entries", { ...entry, collectionId: "", updatedAt: now() })));
    await db.remove("collections", collection.id);
    if (ui.wordCollectionId === collection.id) ui.wordCollectionId = "words-all";
    ui.sheet = null;
    await load(); flash("合集已删除");
  }
  if (action === "delete-collection") {
    const collection = collectionFor(recordId);
    if (!collection || collection.isDefault || collection.isAll || !window.confirm("Delete this collection? Its sentences will move to 未分类.")) return;
    const childIds = childrenFor(collection.id).map((child) => child.id);
    const affected = model.sentences.filter((sentence) => sentence.collectionId === collection.id || childIds.includes(sentence.collectionId));
    await Promise.all(affected.map((sentence) => db.put("sentences", { ...sentence, collectionId: defaultCollection()?.id || "", updatedAt: now() })));
    await Promise.all(childIds.map((childId) => db.remove("collections", childId)));
    await db.remove("collections", collection.id);
    ui.sheet = null; ui.collectionId = null; ui.wordbookCollectionId = null;
    await load(); flash("Collection deleted");
  }
  if (action === "export-backup") exportBackup();
  if (action === "import-backup") document.getElementById("backup-file").click();
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.target.id === "sentence-form") await saveSentence(event.target);
  if (event.target.id === "collection-from-sentence-form") {
    const name = event.target.name.value.trim();
    const draft = ui.sheet?.sentenceDraft;
    if (!name || !draft) return;
    const collection = { id: id("collection"), name, parentId: "", createdAt: now(), updatedAt: now() };
    await db.put("collections", collection);
    ui.sheet = { kind: "sentence", sentenceId: draft.sentenceId, collectionId: collection.id, entryId: draft.entryId, createdVia: draft.createdVia, text: draft.text };
    await load();
  }
  if (event.target.id === "sentence-note-form") await saveSentenceNote(event.target);
  if (event.target.id === "entry-form") await saveEntry(event.target);
  if (event.target.id === "entry-phrase-form") await saveEntryPhrase(event.target);
  if (event.target.id === "entry-synonym-form") await saveEntrySynonym(event.target);
  if (event.target.id === "word-collection-form") await saveWordCollection(event.target);
  if (event.target.id === "word-collection-rename-form") await renameWordCollection(event.target);
  if (event.target.id === "collection-form") await saveCollection(event.target);
  if (event.target.id === "collection-rename-form") await renameCollection(event.target);
  if (event.target.id === "annotation-form") { const annotation = annotationFor(event.target.dataset.id); if (annotation) { annotation.entryText = event.target.entryText.value.trim(); annotation.note = event.target.note.value.trim(); annotation.updatedAt = now(); await db.put("annotations", annotation); ui.sheet = null; await load(); flash("Annotation saved"); } }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "search") {
    const caret = event.target.selectionStart ?? event.target.value.length;
    ui.search = event.target.value;
    render();
    const search = document.getElementById("search");
    search?.focus();
    search?.setSelectionRange(caret, caret);
  }
  if (event.target.matches("[data-entry-example]")) {
    const entry = entryFor(ui.entryId);
    if (entry) ui.entryDrafts = { ...ui.entryDrafts, [`${entry.id}:${event.target.dataset.entryExample}`]: event.target.value };
  }
  if (event.target.matches("[data-insight-phrase], [data-insight-meaning]")) {
    const entry = entryFor(ui.entryId);
    if (entry) {
      const key = event.target.dataset.insightPhrase || event.target.dataset.insightMeaning;
      const row = event.target.closest(".phrase-edit-row");
      ui.entryInsightDrafts = { ...ui.entryInsightDrafts, [key]: { phrase: row?.querySelector('[data-insight-field="phrase"]')?.value || "", meaning: row?.querySelector('[data-insight-field="meaning"]')?.value || "" } };
    }
  }
  if (event.target.matches("[data-synonym-term], [data-synonym-description], [data-synonym-example-text], [data-synonym-example-meaning]")) captureSynonymDraft(event.target.closest(".synonym-edit-row"));
});
document.addEventListener("change", (event) => {
  if (event.target.id === "sentence-sort") { ui.sentenceSort = event.target.value; render(); }
  if (event.target.id === "annotation-sort") { ui.annotationSort = event.target.value; render(); }
});
document.getElementById("backup-file").addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (file) await importBackup(file); event.target.value = ""; });

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
load().catch(() => { document.getElementById("app").innerHTML = `<div class="fatal">Margin needs browser storage to save your sentences.</div>`; });
