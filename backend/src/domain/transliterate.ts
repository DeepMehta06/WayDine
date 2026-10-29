/**
 * Approximate Devanagari -> Latin transliteration for place-name queries
 * (Hindi/Marathi). Used only to send an *additional* query to a provider that
 * handles Latin spellings better; results are merged, never substituted.
 * Applies inherent-vowel deletion at word ends only, which suits common
 * Mumbai locality names (बोरीवली -> borivali, कांदिवली -> kandivali).
 */
const VOWELS: Record<string, string> = {
  "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ऋ": "ri",
  "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
};
const MATRAS: Record<string, string> = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
};
const CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h",
};
const VIRAMA = "्";
const NASALS = new Set(["ं", "ँ"]);
const NUKTA = "़";

const WORDS: Record<string, string> = {
  "पूर्व": "East",
  "पश्चिम": "West",
  "स्टेशन": "Station",
  "मुंबई": "Mumbai",
};

export function hasDevanagari(s: string): boolean {
  return /[ऀ-ॿ]/.test(s);
}

function transliterateWord(word: string): string {
  if (WORDS[word]) return WORDS[word]!;
  const chars = [...word.normalize("NFC")].filter((c) => c !== NUKTA);
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    const next = chars[i + 1];
    if (VOWELS[c]) out += VOWELS[c];
    else if (CONSONANTS[c]) {
      out += CONSONANTS[c];
      if (next === VIRAMA) i++;
      else if (next && MATRAS[next]) {
        out += MATRAS[next];
        i++;
      } else if (i + 1 < chars.length && !NASALS.has(next ?? "")) {
        out += "a";
      } else if (next && NASALS.has(next)) {
        out += "a";
      }
    } else if (NASALS.has(c)) out += "n";
    else if (MATRAS[c]) out += MATRAS[c];
    else if (!/[ऀ-ॿ]/.test(c)) out += c;
  }
  return out;
}

export function transliterateDevanagari(text: string): string {
  const latin = text
    .split(/(\s+)/)
    .map((part) => (/\s+/.test(part) ? part : transliterateWord(part)))
    .join("");
  return latin.replace(/\b\w/g, (m) => m.toUpperCase());
}
