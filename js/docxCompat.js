/**
 * 讓 docx 套件產生的 Word 檔也能在 Word 2007／Word 2003（相容性套件）開啟。
 *
 * 舊版 Word 只認得第一版 Office Open XML（Ecma-376 第 1 版）的寫法，新版 Word 比較寬鬆。
 * docx 套件依新版規格輸出，有三處舊版 Word 會判定檔案毀損：
 * 1. 百分比寬度寫成 "100%"；舊版只接受「五十分之一百分比」的整數（100% = 5000）。
 * 2. 文字格式 <w:rPr> 裡的子元素順序不符合規格（例如字型排在字級後面）。
 * 3. 每張圖片的 <wp:docPr id> 都是 0；舊版要求每張圖的編號不重複。
 */

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// Ecma-376 規定的 <w:rPr> 子元素順序
const RPR_ORDER = [
  "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike",
  "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid",
  "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz",
  "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign",
  "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath",
];

const fixPercentages = (xml) =>
  xml.replace(/(\sw:w=")(\d+(?:\.\d+)?)%"/g, (_, prefix, value) =>
    `${prefix}${Math.round(Number(value) * 50)}"`,
  );

const sortRunProperties = (xml) =>
  xml.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (whole, inner) => {
    // 只處理全是自我結束元素的 rPr（docx 套件輸出的都是這種）
    const parts = inner.match(/<w:[A-Za-z]+\b[^>]*\/>/g);
    if (!parts || parts.join("") !== inner) return whole;
    const rank = (part) => {
      const name = part.match(/^<w:([A-Za-z]+)/)[1];
      const index = RPR_ORDER.indexOf(name);
      return index === -1 ? RPR_ORDER.length : index;
    };
    const sorted = parts
      .map((part, position) => ({ part, position, order: rank(part) }))
      .sort((a, b) => a.order - b.order || a.position - b.position)
      .map(({ part }) => part);
    return `<w:rPr>${sorted.join("")}</w:rPr>`;
  });

const numberDrawings = (xml, counter) =>
  xml.replace(/<wp:docPr id="\d+"/g, () => `<wp:docPr id="${counter.next++}"`);

const PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|styles|numbering)\.xml$/;

export const makeWord2007Compatible = async (blob) => {
  if (typeof JSZip === "undefined") return blob;
  try {
    const zip = await JSZip.loadAsync(blob, { createFolders: false });
    const counter = { next: 1 };
    const names = Object.keys(zip.files)
      .filter((name) => PARTS.test(name))
      .sort();
    for (const name of names) {
      const original = await zip.file(name).async("string");
      if (!original.includes(W_NS)) continue;
      const fixed = numberDrawings(sortRunProperties(fixPercentages(original)), counter);
      if (fixed !== original) zip.file(name, fixed);
    }
    // 重新打包：只放檔案、不放資料夾項目，[Content_Types].xml 放第一個
    const output = new JSZip();
    const entries = Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .sort((a, b) =>
        a.name === "[Content_Types].xml" ? -1 : b.name === "[Content_Types].xml" ? 1 : 0,
      );
    for (const entry of entries) {
      output.file(entry.name, await entry.async("uint8array"), { createFolders: false });
    }
    return await output.generateAsync({
      type: "blob",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      compression: "DEFLATE",
    });
  } catch (error) {
    // 修正失敗時仍給使用者原本的檔案（新版 Word 可正常開啟）
    console.warn("Word 舊版相容處理失敗，改用原始檔案:", error);
    return blob;
  }
};
