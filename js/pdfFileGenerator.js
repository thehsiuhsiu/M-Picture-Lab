// pdfFileGenerator.js - 直接下載的「PDF 檔案」
//
// 做法（見 docs/adr/0003）：
// 1. 用和「列印」相同的 HTML 排版，放進看不見的 iframe，讓瀏覽器排好每一頁。
// 2. 字型只取用到的字（harfbuzz 子集化），同一份子集同時給瀏覽器排版、也內嵌進 PDF，
//    所以量到的位置和 PDF 裡的字寬完全一致。
// 3. 逐一讀取每個格線、照片、文字的位置，用 pdf-lib 畫進 PDF。
import { state } from "./state.js?v=20261025-4";
import {
  showLoadingModal,
  hideLoadingModal,
  revokeObjectUrl,
  getFormattedDate,
  showToast,
} from "./utils.js?v=20261025-4";
import { buildPrintDocument, getSelectedPdfFontKey } from "./pdfGenerator.js?v=20261025-4";

const PDF_LIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
const PDF_LIB_SRI = "sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI";
const FONTKIT_URL = "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js";
const FONTKIT_SRI = "sha384-2p6U+1mmqF10USehFeRiyG2ESG9FwIqN+jxULn5w9jjQIihSn9Pt13dVCn/Hawjn";
const HB_SUBSET_WASM = "./vendor/harfbuzz-subset.wasm";

// 全字庫正楷體依 Big5 分成三個檔：常用字、次常用字、其他罕用字，用到才下載
const TW_KAI = ["./font/TW-Kai-1.ttf", "./font/TW-Kai-2.ttf", "./font/TW-Kai-3.ttf"];
const NOTO_SANS = "./font/NotoSansTC-Regular.ttf";

const FONT_FILES = Object.freeze({
  kai: TW_KAI,
  "noto-serif-tc": ["./font/NotoSerifTC-Regular.ttf"],
  "noto-sans-tc": [NOTO_SANS],
  "jf-openhuninn": ["./font/jf-openhuninn-2.1.ttf"],
  iansui: ["./font/Iansui-Regular.ttf"],
  "gen-ryumin": ["./font/GenRyuMin2TW-B.otf"],
  "chen-yuluoyan": ["./font/ChenYuluoyan-2.0-Thin.ttf"],
});
// 選用字型缺字時，先用思源黑體補，再用全字庫正楷體補罕用字
const FALLBACK_FILES = [NOTO_SANS, ...TW_KAI];

const MM_TO_PT = 72 / 25.4;
const PX_TO_PT = 0.75; // CSS 1px = 1/96 吋 = 0.75pt
const A4_WIDTH = 210 * MM_TO_PT;
const A4_HEIGHT = 297 * MM_TO_PT;
const MARGIN_LEFT = 18 * MM_TO_PT; // 與列印的 @page 邊界相同
const MARGIN_TOP = 12 * MM_TO_PT;

/* ---------- 載入程式庫與字型 ---------- */

const scriptPromises = new Map();
const loadScript = (src, integrity, globalName) => {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (!scriptPromises.has(src)) {
    scriptPromises.set(
      src,
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.integrity = integrity;
        script.crossOrigin = "anonymous";
        script.onload = () =>
          window[globalName] ? resolve(window[globalName]) : reject(new Error(`${globalName} 未載入`));
        script.onerror = () => {
          scriptPromises.delete(src);
          script.remove();
          reject(new Error(`無法載入 ${src}`));
        };
        document.head.appendChild(script);
      }),
    );
  }
  return scriptPromises.get(src);
};

const fontBytesCache = new Map();
const loadFontBytes = (url) => {
  if (!fontBytesCache.has(url)) {
    fontBytesCache.set(
      url,
      fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(`字型下載失敗：${url}`);
          return response.arrayBuffer();
        })
        .then((buffer) => new Uint8Array(buffer))
        .catch((error) => {
          fontBytesCache.delete(url);
          throw error;
        }),
    );
  }
  return fontBytesCache.get(url);
};

let harfbuzzPromise = null;
const loadHarfbuzz = () => {
  if (!harfbuzzPromise) {
    harfbuzzPromise = fetch(HB_SUBSET_WASM)
      .then((response) => {
        if (!response.ok) throw new Error("字型子集化程式下載失敗");
        return response.arrayBuffer();
      })
      .then((buffer) => WebAssembly.instantiate(buffer, {}))
      .then(({ instance }) => instance.exports)
      .catch((error) => {
        harfbuzzPromise = null;
        throw error;
      });
  }
  return harfbuzzPromise;
};

/** 只保留用得到的字，讓字型從幾 MB 變成幾十 KB。 */
const subsetFont = (hb, fontBytes, codePoints) => {
  const fontPtr = hb.malloc(fontBytes.byteLength);
  new Uint8Array(hb.memory.buffer).set(fontBytes, fontPtr);
  const blob = hb.hb_blob_create(fontPtr, fontBytes.byteLength, 2, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  try {
    if (!input) throw new Error("字型子集化失敗");
    const unicodeSet = hb.hb_subset_input_unicode_set(input);
    codePoints.forEach((codePoint) => hb.hb_set_add(unicodeSet, codePoint));
    const subsetFace = hb.hb_subset_or_fail(face, input);
    if (!subsetFace) throw new Error("字型子集化失敗");
    const resultBlob = hb.hb_face_reference_blob(subsetFace);
    const offset = hb.hb_blob_get_data(resultBlob, 0);
    const length = hb.hb_blob_get_length(resultBlob);
    const result = new Uint8Array(hb.memory.buffer).slice(offset, offset + length);
    hb.hb_blob_destroy(resultBlob);
    hb.hb_face_destroy(subsetFace);
    return result;
  } finally {
    if (input) hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.free(fontPtr);
  }
};

const isWhitespace = (char) => /\s/.test(char);
// 表情符號等字型都沒有的字不必為它下載補字字型
const isSkippableCodePoint = (codePoint) =>
  (codePoint >= 0x1f000 && codePoint < 0x20000) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || codePoint === 0x200d;
const ELLIPSIS = "\u2026";

/**
 * 決定每個字用哪個字型：依序檢查選用字型、補字字型，字型檔用到才下載。
 * 回傳 [{ url, codePoints:Set, ascent, descent, unitsPerEm }]，第一個是主要字型。
 */
const planFonts = async (fontkit, fontKey, text) => {
  const files = [...new Set([...(FONT_FILES[fontKey] || TW_KAI), ...FALLBACK_FILES])];
  const pending = new Set(
    [...`${text}${ELLIPSIS}`]
      .filter((char) => !isWhitespace(char))
      .map((char) => char.codePointAt(0))
      .filter((codePoint) => !isSkippableCodePoint(codePoint)),
  );
  const plan = [];
  for (const [index, url] of files.entries()) {
    if (index > 0 && !pending.size) break;
    const bytes = await loadFontBytes(url);
    const font = fontkit.create(bytes);
    const codePoints = new Set();
    pending.forEach((codePoint) => {
      if (font.hasGlyphForCodePoint(codePoint)) codePoints.add(codePoint);
    });
    codePoints.forEach((codePoint) => pending.delete(codePoint));
    if (index === 0) {
      // 主要字型也負責空白，讓排版的字距和行高以它為準
      [0x20, 0xa0, 0x3000].forEach((codePoint) => {
        if (font.hasGlyphForCodePoint(codePoint)) codePoints.add(codePoint);
      });
    }
    if (index === 0 || codePoints.size) {
      plan.push({
        url,
        codePoints,
        ascent: font.ascent,
        descent: Math.abs(font.descent),
        unitsPerEm: font.unitsPerEm,
      });
    }
  }
  if (pending.size) console.warn("PDF 檔案：以下字元所有字型都沒有", [...pending].map((cp) => String.fromCodePoint(cp)).join(""));
  return plan;
};

/* ---------- 排版 ---------- */

const createLayoutFrame = async (html, fonts) => {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:800px;height:1200px;border:0;visibility:hidden;pointer-events:none;";
  document.body.appendChild(frame);
  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument || frameWindow.document;
  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  await Promise.all(
    fonts.map(async (font) => {
      const face = new frameWindow.FontFace(font.family, font.subset);
      await face.load();
      frameDocument.fonts.add(face);
    }),
  );
  await Promise.all(
    [...frameDocument.images].map((image) =>
      image.complete ? Promise.resolve() : image.decode().catch(() => {}),
    ),
  );
  await frameDocument.fonts.ready;
  // 等字型套用後重新排版
  await new Promise((resolve) => frameWindow.requestAnimationFrame(() => resolve()));
  return frame;
};

const parseColor = (value) => {
  const match = String(value).match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const [r, g, b, a = "1"] = match[1].split(/[\s,/]+/).filter(Boolean);
  const alpha = Number(a);
  if (!alpha) return null;
  return { r: Number(r) / 255, g: Number(g) / 255, b: Number(b) / 255, alpha };
};

const toImageForPdf = async (pdfDoc, blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (blob.type === "image/jpeg") return pdfDoc.embedJpg(bytes);
  if (blob.type === "image/png") return pdfDoc.embedPng(bytes);
  // 其他格式先轉成 JPEG
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const jpeg = await new Promise((resolve, reject) =>
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("照片轉換失敗"))), "image/jpeg", 0.92),
  );
  return pdfDoc.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
};

const SIDES = ["top", "right", "bottom", "left"];

const isCollapsedTablePart = (element, style) => {
  if (element.tagName === "TABLE") return style.borderCollapse === "collapse";
  if (element.tagName === "TD" || element.tagName === "TH") {
    const table = element.closest("table");
    return table ? getComputedStyle(table).borderCollapse === "collapse" : false;
  }
  return false;
};

/** 把一頁（.page-container）畫進 PDF。 */
const drawPage = async ({ PDFLib, pdfDoc, pageElement, frameWindow, fonts, imageCache, imageBlobs }) => {
  const { rgb } = PDFLib;
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  const origin = pageElement.getBoundingClientRect();
  const toX = (px) => MARGIN_LEFT + (px - origin.left) * PX_TO_PT;
  const toY = (px) => A4_HEIGHT - MARGIN_TOP - (px - origin.top) * PX_TO_PT;

  // 背景、框線、照片
  for (const element of [pageElement, ...pageElement.querySelectorAll("*")]) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = frameWindow.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;

    const background = parseColor(style.backgroundColor);
    if (background && !(background.r === 1 && background.g === 1 && background.b === 1)) {
      page.drawRectangle({
        x: toX(rect.left),
        y: toY(rect.bottom),
        width: rect.width * PX_TO_PT,
        height: rect.height * PX_TO_PT,
        color: rgb(background.r, background.g, background.b),
        opacity: background.alpha,
      });
    }

    if (element.tagName === "IMG") {
      const blob = imageBlobs.get(element.getAttribute("src"));
      if (blob) {
        if (!imageCache.has(blob)) imageCache.set(blob, await toImageForPdf(pdfDoc, blob));
        page.drawImage(imageCache.get(blob), {
          x: toX(rect.left),
          y: toY(rect.bottom),
          width: rect.width * PX_TO_PT,
          height: rect.height * PX_TO_PT,
        });
      }
    }

    const collapsed = isCollapsedTablePart(element, style);
    // 合併框線的表格由儲存格畫，表格本身不畫，避免重複變粗
    if (collapsed && element.tagName === "TABLE") continue;
    SIDES.forEach((side) => {
      const width = parseFloat(style[`border-${side}-width`]) || 0;
      const lineStyle = style[`border-${side}-style`];
      if (!width || lineStyle === "none" || lineStyle === "hidden") return;
      const color = parseColor(style[`border-${side}-color`]);
      if (!color) return;
      // 合併框線畫在格線正中；一般框線畫在元素內側
      const inset = collapsed ? 0 : width / 2;
      let start;
      let end;
      if (side === "top" || side === "bottom") {
        const y = side === "top" ? rect.top + inset : rect.bottom - inset;
        start = { x: toX(rect.left), y: toY(y) };
        end = { x: toX(rect.right), y: toY(y) };
      } else {
        const x = side === "left" ? rect.left + inset : rect.right - inset;
        start = { x: toX(x), y: toY(rect.top) };
        end = { x: toX(x), y: toY(rect.bottom) };
      }
      page.drawLine({
        start,
        end,
        thickness: width * PX_TO_PT,
        color: rgb(color.r, color.g, color.b),
        opacity: color.alpha,
      });
    });
  }

  // 文字：逐字放在瀏覽器排好的位置
  const primary = fonts[0];
  const ascentRatio = primary.ascent / (primary.ascent + primary.descent);
  const fontFor = (codePoint) => fonts.find((font) => font.codePoints.has(codePoint)) || primary;
  const walker = pageElement.ownerDocument.createTreeWalker(pageElement, NodeFilter.SHOW_TEXT);
  const range = pageElement.ownerDocument.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue;
    if (!text || !text.trim()) continue;
    const parent = node.parentElement;
    const style = frameWindow.getComputedStyle(parent);
    if (style.visibility === "hidden") continue;
    const fontSizePt = parseFloat(style.fontSize) * PX_TO_PT;
    const color = parseColor(style.color) || { r: 0, g: 0, b: 0, alpha: 1 };
    // 有 overflow:hidden（例如多格照片說明只顯示一兩行）的話，超出的字不畫
    let clip = null;
    let clamped = false;
    for (let ancestor = parent; ancestor && ancestor !== pageElement.parentElement; ancestor = ancestor.parentElement) {
      const ancestorStyle = frameWindow.getComputedStyle(ancestor);
      if (ancestorStyle.overflow !== "visible" || ancestorStyle.overflowY !== "visible") {
        clip = ancestor.getBoundingClientRect();
        clamped = (ancestorStyle.webkitLineClamp || "none") !== "none";
        clip = {
          top: clip.top,
          bottom: clip.bottom,
          left: clip.left,
          right: clip.right,
          contentRight:
            clip.right -
            (parseFloat(ancestorStyle.paddingRight) || 0) -
            (parseFloat(ancestorStyle.borderRightWidth) || 0),
        };
        break;
      }
    }
    const visibleChars = [];
    let hiddenCount = 0;

    let offset = 0;
    for (const char of text) {
      const length = char.length;
      if (!isWhitespace(char)) {
        range.setStart(node, offset);
        range.setEnd(node, offset + length);
        const rect = [...range.getClientRects()].find((item) => item.width > 0);
        if (rect) {
          const centerY = rect.top + rect.height / 2;
          const centerX = rect.left + rect.width / 2;
          const visible =
            !clip ||
            (centerY >= clip.top && centerY <= clip.bottom && centerX >= clip.left && centerX <= clip.right);
          const codePoint = char.codePointAt(0);
          if (!visible) {
            hiddenCount += 1;
          } else if (!isSkippableCodePoint(codePoint)) {
            visibleChars.push({ char, rect, baseline: rect.top + rect.height * ascentRatio, font: fontFor(codePoint) });
          }
        }
      }
      offset += length;
    }
    // 只顯示一兩行的說明被截斷時，和列印一樣把最後放不下的字換成「…」
    let ellipsis = null;
    if (clamped && hiddenCount && visibleChars.length) {
      const ellipsisFont = fontFor(ELLIPSIS.codePointAt(0));
      const ellipsisWidthPx = ellipsisFont.pdfFont.widthOfTextAtSize(ELLIPSIS, fontSizePt) / PX_TO_PT;
      while (
        visibleChars.length > 1 &&
        visibleChars[visibleChars.length - 1].rect.right + ellipsisWidthPx > clip.contentRight + 0.5
      ) {
        visibleChars.pop();
      }
      const last = visibleChars[visibleChars.length - 1];
      ellipsis = { char: ELLIPSIS, x: last.rect.right, baseline: last.baseline, font: ellipsisFont };
    }
    const drawItems = visibleChars.map((item) => ({ ...item, x: item.rect.left }));
    if (ellipsis) drawItems.push(ellipsis);
    drawItems.forEach((item) => {
      page.drawText(item.char, {
        x: toX(item.x),
        y: toY(item.baseline),
        size: fontSizePt,
        font: item.font.pdfFont,
        color: rgb(color.r, color.g, color.b),
      });
    });
  }
};

/* ---------- 主流程 ---------- */

const setLoadingText = (text) => {
  const paragraph = document.querySelector("#loadingModal p");
  if (!paragraph) return () => {};
  const original = paragraph.dataset.originalText || paragraph.textContent;
  paragraph.dataset.originalText = original;
  paragraph.textContent = text;
  return () => {
    paragraph.textContent = original;
  };
};

const sanitizeDownloadFileName = (fileName) => {
  const cleaned = String(fileName ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");
  return cleaned || "照片黏貼表";
};

export const handleGeneratePdfFile = async () => {
  if (state.selectedImages.length === 0) {
    showToast("請先新增照片，再輸出 PDF。", "warning");
    return;
  }
  showLoadingModal();
  let restoreText = setLoadingText("字型套用中，請稍候…");
  const printUrls = [];
  const imageBlobs = new Map();
  let frame = null;

  try {
    const [PDFLib, fontkit, hb] = await Promise.all([
      loadScript(PDF_LIB_URL, PDF_LIB_SRI, "PDFLib"),
      loadScript(FONTKIT_URL, FONTKIT_SRI, "fontkit"),
      loadHarfbuzz(),
    ]);

    // 先用暫時的字型名稱產生 HTML，取出所有會出現的字
    const fontKey = getSelectedPdfFontKey();
    const familyList = (count) =>
      Array.from({ length: count }, (_, index) => `"MPictureFont${index}"`).join(", ");
    const draft = await buildPrintDocument({
      pdfFont: { family: familyList(1) },
      printUrls,
      imageBlobs,
      pdfFileMode: true,
    });
    const parsed = new DOMParser().parseFromString(draft.html, "text/html");
    const plan = await planFonts(fontkit, fontKey, parsed.body.textContent || "");

    restoreText();
    restoreText = setLoadingText("正在產生 PDF 檔案…");

    const pdfDoc = await PDFLib.PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    pdfDoc.setTitle(draft.title);
    pdfDoc.setCreator("M-Picture");
    pdfDoc.setProducer("M-Picture");
    const fonts = [];
    for (const [index, item] of plan.entries()) {
      const subset = subsetFont(hb, await loadFontBytes(item.url), item.codePoints);
      fonts.push({
        ...item,
        family: `MPictureFont${index}`,
        subset: subset.slice().buffer,
        pdfFont: await pdfDoc.embedFont(subset, { subset: false }),
      });
    }

    const html = draft.html.replace(familyList(1), familyList(fonts.length));
    frame = await createLayoutFrame(html, fonts);
    const frameWindow = frame.contentWindow;
    const pages = [...frame.contentDocument.querySelectorAll(".page-container")];
    const imageCache = new Map();
    for (const pageElement of pages) {
      await drawPage({ PDFLib, pdfDoc, pageElement, frameWindow, fonts, imageCache, imageBlobs });
    }

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeDownloadFileName(state.customDocTitles[state.selectedFormat] ?? draft.title)}_${getFormattedDate()}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error("Error in PDF file generation:", error);
    showToast("產生 PDF 檔案時發生問題，請確認網路連線後再試一次，或改用「列印」另存 PDF。", "error", 7000);
  } finally {
    frame?.remove();
    printUrls.forEach(revokeObjectUrl);
    restoreText();
    hideLoadingModal();
  }
};
