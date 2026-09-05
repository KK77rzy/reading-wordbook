const CACHE_KEY = "margin-dictionary-cache-v5";
const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 30;
const CACHE_LIMIT = 120;

function cleanTerm(value) {
  return String(value || "")
    .trim()
    .replace(/^[\s“”‘’'"([{]+|[\s“”‘’'"\])},.!?;:]+$/g, "")
    .replace(/\s+/g, " ");
}

function readCache() {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY));
    return value && typeof value === "object" ? value : {};
  } catch (_) {
    return {};
  }
}

function writeCache(cache) {
  try {
    const entries = Object.entries(cache)
      .sort((a, b) => (b[1]?.cachedAt || 0) - (a[1]?.cachedAt || 0))
      .slice(0, CACHE_LIMIT);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (_) {}
}

function unique(values, limit = 8) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))].slice(0, limit);
}

function normalizeFreeDictionary(entries, requestedTerm) {
  const records = Array.isArray(entries) ? entries : [];
  const first = records[0] || {};
  const phonetics = records.flatMap((entry) => entry.phonetics || []);
  const audioItem = phonetics.find((item) => item.audio && /-us(?:\.|-)/i.test(item.audio)) || phonetics.find((item) => item.audio);
  const phonetic = phonetics.find((item) => item.text)?.text || first.phonetic || "";
  const meanings = records.flatMap((entry) => entry.meanings || []).map((meaning) => ({
    partOfSpeech: meaning.partOfSpeech || "",
    definitions: (meaning.definitions || []).slice(0, 3).map((item) => ({
      definition: item.definition || "",
      example: item.example || "",
      synonyms: unique(item.synonyms || [], 5),
      antonyms: unique(item.antonyms || [], 5),
    })),
    synonyms: unique(meaning.synonyms || [], 8),
    antonyms: unique(meaning.antonyms || [], 8),
  })).filter((meaning) => meaning.definitions.length);
  const sourceUrl = records.flatMap((entry) => entry.sourceUrls || [])[0] || "https://dictionaryapi.dev/";
  return {
    term: requestedTerm,
    headword: first.word || requestedTerm,
    lemma: first.word || requestedTerm,
    phonetic,
    audio: audioItem?.audio || "",
    audioRegion: audioItem?.audio && /-us(?:\.|-)/i.test(audioItem.audio) ? "US" : "",
    meanings,
    synonyms: unique(meanings.flatMap((meaning) => meaning.synonyms.concat(meaning.definitions.flatMap((item) => item.synonyms))), 10),
    antonyms: unique(meanings.flatMap((meaning) => meaning.antonyms.concat(meaning.definitions.flatMap((item) => item.antonyms))), 10),
    source: { id: "free-dictionary", label: "Free Dictionary", url: sourceUrl },
    fetchedAt: Date.now(),
  };
}

class FreeDictionaryProvider {
  constructor() {
    this.id = "free-dictionary";
  }

  async lookup(term) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(term), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (response.status === 404) throw new Error("not-found");
      if (!response.ok) throw new Error("dictionary-unavailable");
      return normalizeFreeDictionary(await response.json(), term);
    } finally {
      clearTimeout(timeout);
    }
  }
}

class ServerDictionaryProvider {
  constructor() {
    this.id = "licensed-dictionary";
  }

  async lookup(term) {
    if (!window.location?.origin || window.location.origin === "null") throw new Error("provider-not-configured");
    const response = await fetch("/api/dictionary?term=" + encodeURIComponent(term), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(response.status === 404 ? "provider-not-configured" : "dictionary-unavailable");
    const payload = await response.json(), data = payload.data || payload;
    if (!data || !Array.isArray(data.meanings)) throw new Error("invalid-dictionary-response");
    return { ...data, term, fetchedAt: data.fetchedAt || Date.now() };
  }
}

class DictionaryService {
  constructor() {
    this.providers = [new ServerDictionaryProvider(), new FreeDictionaryProvider()];
    this.pending = new Map();
  }

  async lookup(rawTerm, { force = false } = {}) {
    const term = cleanTerm(rawTerm);
    if (!term) throw new Error("empty-term");
    const key = term.toLocaleLowerCase("en-US");
    const cache = readCache();
    if (!force && cache[key] && Date.now() - cache[key].cachedAt < CACHE_MAX_AGE) return cache[key].data;
    if (this.pending.has(key)) return this.pending.get(key);
    const request = this.lookupFromProviders(term).then((data) => {
      cache[key] = { cachedAt: Date.now(), data };
      writeCache(cache);
      return data;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  async lookupFromProviders(term) {
    let lastError;
    for (const provider of this.providers) {
      try {
        return await provider.lookup(term);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("dictionary-unavailable");
  }

  async pronounce(rawTerm, audioUrl = "") {
    const term = cleanTerm(rawTerm);
    if (audioUrl) {
      try {
        const audio = new Audio(audioUrl);
        await audio.play();
        return "audio";
      } catch (_) {}
    }
    if (!("speechSynthesis" in window) || !term) throw new Error("speech-unavailable");
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(term);
    utterance.lang = "en-US";
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => /^en-US$/i.test(voice.lang)) || voices.find((voice) => /^en-/i.test(voice.lang)) || null;
    utterance.rate = 0.88;
    window.speechSynthesis.speak(utterance);
    return "speech";
  }
}

export const dictionaryService = new DictionaryService();
export { cleanTerm };
