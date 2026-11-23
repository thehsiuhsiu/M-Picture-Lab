// pdfGenerator.js - PDF 生成模組

import { state } from "./state.js?v=20261123-2";
import {
  showLoadingModal,
  hideLoadingModal,
  createObjectUrl,
  revokeObjectUrl,
  showToast,
} from "./utils.js?v=20261123-2";
import { createDocumentImageBlob } from "./annotations.js?v=20261123-2";
import {
  getMultiPhotoPageEntries,
  getMultiPhotoSettings,
} from "./multiPhotoLayout.js?v=20261123-2";
import {
  buildSheetCss,
  buildSheetHtml,
  describeImages,
  getDocumentTitle,
  isLayoutFormat,
  planPages,
  readFormData,
} from "./documentLayout.js?v=20261123-2";
import { ensureWithinLineLimits } from "./lineLimitCheck.js?v=20261123-2";
import {
  getPdfPageNumber,
  getPdfPageNumberSettings,
} from "./pageNumbering.js?v=20261123-2";

const PDF_PRINT_IMAGE_MAX_DIMENSION = 1800;

const PDF_FONT_OPTIONS = {
  kai: {
    family:
      '"BiauKaiTC", "BiauKai TC", "Kaiti TC", "Kai", "BiauKai", "DFKai-SB", "標楷體", "KaiTi", serif',
  },
  "noto-serif-tc": {
    family: '"Noto Serif TC", serif',
  },
  "noto-sans-tc": {
    family: '"Noto Sans TC", sans-serif',
  },
  "jf-openhuninn": {
    family: '"jf open huninn", sans-serif',
    face: `
                @font-face {
                    font-family: "jf open huninn";
                    src: url("./font/jf-openhuninn-2.1.ttf") format("truetype");
                    font-weight: 400;
                    font-style: normal;
                    font-display: swap;
                }
    `,
  },
  iansui: {
    family: '"Iansui", sans-serif',
    face: `
                @font-face {
                    font-family: "Iansui";
                    src: url("./font/Iansui-Regular.ttf") format("truetype");
                    font-weight: 400;
                    font-style: normal;
                    font-display: swap;
                }
    `,
  },
  "gen-ryumin": {
    family: '"Gen Ryu Min", "Noto Serif TC", serif',
    face: `
                @font-face {
                    font-family: "Gen Ryu Min";
                    src: url("./font/GenRyuMin2TW-B.otf") format("opentype");
                    font-weight: 700;
                    font-style: normal;
                    font-display: swap;
                }
    `,
  },
  "chen-yuluoyan": {
    family: '"Chen Yuluoyan", sans-serif',
    face: `
                @font-face {
                    font-family: "Chen Yuluoyan";
                    src: url("./font/ChenYuluoyan-2.0-Thin.ttf") format("truetype");
                    font-weight: 300;
                    font-style: normal;
                    font-display: swap;
                }
    `,
  },
};

const PDF_FONT_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&family=Noto+Serif+TC:wght@400;700&display=swap";

const getSelectedPdfFont = () => {
  const selectedFont = document.getElementById("pdfFontSelect")?.value;
  return PDF_FONT_OPTIONS[selectedFont] || PDF_FONT_OPTIONS.kai;
};

const escapeHtml = (value) => {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const isAppleTouchDevice = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * 在目前頁面列印：文件放進 Shadow DOM（樣式不會和網頁互相影響），
 * 列印時用 @media print 只顯示文件，列印完畢後移除。
 */
const printInMainDocument = async (printContent, title, printUrls) => {
  const parsed = new DOMParser().parseFromString(printContent, "text/html");
  const styleText = [...parsed.querySelectorAll("style")]
    .map((style) => style.textContent)
    .join("\n");
  const pageRules = (styleText.match(/@page\s*\{[^}]*\}/g) || []).join("\n");
  const fontFaces = (styleText.match(/@font-face\s*\{[^}]*\}/g) || []).join("\n");
  const shadowCss = styleText
    .replace(/@page\s*\{[^}]*\}/g, "")
    .replace(/(^|[\s}])body\s*\{/g, "$1:host {");

  document.getElementById("mainPrintRoot")?.remove();
  document.getElementById("mainPrintStyle")?.remove();

  const root = document.createElement("div");
  root.id = "mainPrintRoot";
  root.setAttribute("aria-hidden", "true");
  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>:host{display:block;background:#fff;color:#000}${shadowCss}</style>${parsed.body.innerHTML}`;

  const pageStyle = document.createElement("style");
  pageStyle.id = "mainPrintStyle";
  pageStyle.textContent = `
    @media screen { #mainPrintRoot { display: none !important; } }
    @media print {
      html, body { min-height: 0 !important; background: #fff !important; }
      body > *:not(#mainPrintRoot) { display: none !important; }
      #mainPrintRoot { display: block !important; }
    }
    ${pageRules}
    ${fontFaces}
  `;
  const fontLinks = [...parsed.querySelectorAll('link[rel="stylesheet"]')].map((link) => {
    const clone = document.createElement("link");
    clone.rel = "stylesheet";
    clone.href = link.href;
    clone.dataset.mainPrint = "true";
    return clone;
  });
  document.head.append(pageStyle, ...fontLinks);
  document.body.appendChild(root);

  const previousTitle = document.title;
  document.title = title;

  await Promise.all(
    [...shadow.querySelectorAll("img")].map((img) =>
      img.decode ? img.decode().catch(() => {}) : Promise.resolve(),
    ),
  );
  try {
    await document.fonts?.ready;
  } catch (error) {
    console.warn("PDF 字型載入等待失敗，改用瀏覽器備援字型:", error);
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    root.remove();
    pageStyle.remove();
    fontLinks.forEach((link) => link.remove());
    document.title = previousTitle;
    printUrls.forEach(revokeObjectUrl);
  };
  // Safari 可能在列印畫面出現前就觸發 afterprint，所以不在那時清除；
  // 文件在螢幕上本來就是隱藏的，等使用者回到網頁操作時再移除。
  window.setTimeout(() => {
    window.addEventListener("pointerdown", cleanup, { once: true });
  }, 2000);

  window.print();
};

/**
 * 產生列印用的整份 HTML。「列印」與「PDF 檔案」共用，確保兩者版面相同。
 * printUrls 會收集建立的照片網址，使用完畢要釋放；imageBlobs 對應網址與照片內容。
 */
export const buildPrintDocument = async ({
  pdfFont,
  printUrls,
  imageBlobs = null,
  pdfFileMode = false,
}) => {
  const format = state.selectedFormat;
  const pageNumberSettings = getPdfPageNumberSettings();
  const title = getDocumentTitle(format);

  const printableImages = await Promise.all(
    state.selectedImages.map(async (image) => {
      const printBlob = await createDocumentImageBlob(image, PDF_PRINT_IMAGE_MAX_DIMENSION);
      const printUrl = createObjectUrl(printBlob);
      printUrls.push(printUrl);
      imageBlobs?.set(printUrl, printBlob);
      return {
        ...image,
        printUrl,
      };
    }),
  );

  let printContent = buildPrintHTML(title, pdfFont, pdfFileMode, format);

  if (isLayoutFormat(format)) {
    // 刑事案件、交通事故：照版面規格排版，和 Word、版面預覽相同
    const printUrlById = new Map(printableImages.map((image) => [image.id, image.printUrl]));
    const formData = readFormData();
    const items = describeImages(format, formData);
    planPages(format, items, formData).forEach((page, pageIndex) => {
      printContent += buildSheetHtml({
        format,
        title,
        page,
        formData,
        imageSrc: (item) => printUrlById.get(item.image.id),
        pageNumberText: pageNumberSettings.enabled
          ? `第 ${getPdfPageNumber(pageIndex, pageNumberSettings.startNumber)} 頁`
          : "",
        className: "page-container",
      });
    });
  } else if (format === "right") {
    const multiPhotoSettings = getMultiPhotoSettings();
    printContent += buildMultiPhotoContent(
      title,
      printableImages,
      multiPhotoSettings.count,
      multiPhotoSettings.order,
      pageNumberSettings,
    );
  }

  printContent += "</body></html>";
  return { html: printContent, title };
};

export const getSelectedPdfFontKey = () => {
  const selectedFont = document.getElementById("pdfFontSelect")?.value;
  return PDF_FONT_OPTIONS[selectedFont] ? selectedFont : "kai";
};

export const handleGeneratePDF = async () => {
  if (state.selectedImages.length === 0) {
    showToast("請先新增照片，再輸出 PDF。", "warning");
    return;
  }
  if (!(await ensureWithinLineLimits())) return;
  showLoadingModal();

  let printFrame;
  const printUrls = [];
  let cleanupTimer = null;
  let cleanupTimeout = null;
  let didCleanup = false;

  try {
    const { html: printContent, title } = await buildPrintDocument({
      pdfFont: getSelectedPdfFont(),
      printUrls,
    });

    hideLoadingModal();

    // iPhone／iPad 的 Safari 列印隱藏 iframe 時會改印整個網頁，改在本頁直接列印
    if (isAppleTouchDevice()) {
      await printInMainDocument(printContent, title, printUrls);
      return;
    }

    printFrame = document.createElement("iframe");
    printFrame.title = "PDF 列印預覽";
    printFrame.style.position = "fixed";
    printFrame.style.right = "0";
    printFrame.style.bottom = "0";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    printFrame.style.opacity = "0";
    printFrame.setAttribute("aria-hidden", "true");
    document.body.appendChild(printFrame);

    const frameWindow = printFrame.contentWindow;
    const frameDocument = printFrame.contentDocument || frameWindow?.document;
    if (!frameWindow || !frameDocument) {
      throw new Error("無法建立列印框架");
    }

    frameDocument.open();
    frameDocument.write(printContent);
    frameDocument.close();

    const cleanup = () => {
      if (didCleanup) return;
      didCleanup = true;
      if (cleanupTimer) {
        window.clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
      if (cleanupTimeout) {
        window.clearTimeout(cleanupTimeout);
        cleanupTimeout = null;
      }
      printUrls.forEach(revokeObjectUrl);
      if (printFrame?.parentNode) {
        printFrame.parentNode.removeChild(printFrame);
      }
      window.focus();
    };

    frameWindow.addEventListener("afterprint", cleanup, { once: true });
    frameWindow.addEventListener("pagehide", cleanup, { once: true });
    cleanupTimer = window.setInterval(cleanup, 1500);
    cleanupTimeout = window.setTimeout(cleanup, 5 * 60 * 1000);

    const startPrint = async () => {
      try {
        await frameDocument.fonts?.ready;
      } catch (error) {
        console.warn("PDF 字型載入等待失敗，改用瀏覽器備援字型:", error);
      }
      frameWindow.focus();
      frameWindow.print();
      window.setTimeout(() => {
        window.focus();
      }, 0);
    };

    if (frameDocument.readyState === "complete") {
      window.setTimeout(startPrint, 500);
    } else {
      printFrame.addEventListener(
        "load",
        () => window.setTimeout(startPrint, 500),
        { once: true },
      );
    }
  } catch (error) {
    printUrls.forEach(revokeObjectUrl);
    if (cleanupTimer) {
      window.clearInterval(cleanupTimer);
    }
    if (cleanupTimeout) {
      window.clearTimeout(cleanupTimeout);
    }
    if (printFrame?.parentNode) {
      printFrame.parentNode.removeChild(printFrame);
    }
    hideLoadingModal();
    console.error("Error in PDF generation:", error);
    showToast("產生 PDF 時發生問題，請重新整理頁面後再試一次。", "error", 6000);
  }
};

const buildPrintHTML = (title, pdfFont, pdfFileMode = false, format = "right") => {
  const isSheet = isLayoutFormat(format);
  const safeTitle = escapeHtml(title);
  const fontFamily = pdfFont.family;
  // PDF 檔案：字型由程式另外載入，版面寬度固定為 A4 扣掉左右邊界
  const remoteFonts = pdfFileMode
    ? ""
    : `<link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="${PDF_FONT_STYLESHEET}" rel="stylesheet">`;
  const pdfFileCss = pdfFileMode
    ? `html, body { width: ${isSheet ? "210mm" : "174mm"}; background: #fff; } .page-container { margin-bottom: 30mm; }`
    : "";
  // 刑事案件、交通事故的頁面（.doc-sheet）已含邊界，紙張不再留邊
  const pageMargin = isSheet ? "0" : "12mm 18mm 1mm 18mm";
  const sheetCss = isSheet
    ? `${buildSheetCss(".doc-sheet")}
                .doc-sheet { break-after: page; page-break-after: always; }
                .doc-sheet:last-child { break-after: auto; page-break-after: auto; }`
    : "";

  return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>${safeTitle}</title>
            ${remoteFonts}
            <style>
                ${pdfFileMode ? "" : pdfFont.face || ""}
                @page {
                    size: A4;
                    margin: ${pageMargin};
                }
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    font-family: ${fontFamily};
                    font-size: 11.5pt;
                    line-height: 1.2;
                }
                h1 {
                    text-align: justify;
                    text-align-last: justify;
                    letter-spacing: 0;
                    font-size: 22pt;
                    font-weight: normal;
                    margin-bottom: 0.5em;
                    padding: 0;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                    border: 1px solid #000;
                }
                td, th {
                    border: 1px solid #000;
                    padding: 4px 6px;
                    vertical-align: middle;
                    word-wrap: break-word;
                }
                .photo-cell {
                    text-align: center;
                    height: 100mm;
                    vertical-align: middle;
                    padding: 1px;
                }
                .photo-cell img {
                    max-width: 100%;
                    max-height: 97mm;
                    object-fit: contain;
                }
                .label-cell {
                    text-align: center;
                    text-align: justify;
                    text-align-last: justify;
                    width: 15%;
                }
                .value-cell {
                    text-align: left;
                }
                .page-container {
                    page-break-after: always;
                    page-break-inside: avoid;
                }
                .page-container:last-child {
                    page-break-after: auto;
                }
                .page-container.with-page-number {
                    position: relative;
                    box-sizing: border-box;
                    min-height: 283mm;
                }
                .pdf-page-number {
                    position: absolute;
                    right: 0;
                    bottom: 0;
                    left: 0;
                    height: 5mm;
                    font-size: 10pt;
                    line-height: 5mm;
                    text-align: center;
                }
                .footer {
                    text-align: center;
                    font-size: 10pt;
                    margin-top: 10px;
                }
                .spacer {
                    height: 3px;
                }
                .empty-cell {
                    border: none !important;
                    background: transparent !important;
                }
                .multi-photo-grid {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 0;
                    border-top: 1px solid #000;
                    border-left: 1px solid #000;
                }
                .multi-photo-grid.count-2 {
                    grid-template-rows: 260mm;
                }
                .multi-photo-grid.count-4 {
                    grid-template-rows: repeat(2, 130mm);
                }
                .multi-photo-cell {
                    display: flex;
                    min-width: 0;
                    min-height: 0;
                    flex-direction: column;
                    overflow: hidden;
                    border-right: 1px solid #000;
                    border-bottom: 1px solid #000;
                }
                .multi-photo-cell.empty {
                    background: #fafafa;
                }
                .multi-photo-image {
                    display: flex;
                    min-height: 0;
                    flex: 1;
                    align-items: center;
                    justify-content: center;
                    padding: 1mm;
                    overflow: hidden;
                }
                .multi-photo-image img {
                    display: block;
                    max-width: 100%;
                    max-height: 100%;
                    object-fit: contain;
                }
                .multi-photo-caption {
                    display: grid;
                    height: 7mm;
                    min-height: 7mm;
                    grid-template-columns: 22% 78%;
                    border-top: 1px solid #000;
                }
                .multi-photo-number,
                .multi-photo-description {
                    display: flex;
                    min-width: 0;
                    align-items: center;
                    padding: 1mm 1.5mm;
                }
                .multi-photo-number {
                    justify-content: center;
                    border-right: 1px solid #000;
                    white-space: nowrap;
                }
                .multi-photo-description {
                    display: -webkit-box;
                    max-height: 6mm;
                    overflow: hidden;
                    overflow-wrap: anywhere;
                    -webkit-box-orient: vertical;
                    -webkit-line-clamp: 1;
                }
                .multi-photo-grid.count-2 .multi-photo-caption {
                    height: auto;
                    min-height: 7mm;
                    max-height: 12mm;
                }
                .multi-photo-grid.count-2 .multi-photo-description {
                    max-height: 12mm;
                    white-space: pre-wrap;
                    -webkit-line-clamp: 2;
                }
                ${sheetCss}
                ${pdfFileCss}
                @media print {
                    .page-container {
                        page-break-after: always;
                        page-break-inside: avoid;
                    }
                    .page-container:last-child {
                        page-break-after: auto;
                    }
                }
            </style>
        </head>
        <body>
    `;
};

const getPageContainerClass = (pageNumberSettings) =>
  pageNumberSettings.enabled
    ? "page-container with-page-number"
    : "page-container";

const buildPageNumber = (pageIndex, pageNumberSettings) =>
  pageNumberSettings.enabled
    ? `<div class="pdf-page-number">第 ${getPdfPageNumber(
        pageIndex,
        pageNumberSettings.startNumber,
      )} 頁</div>`
    : "";

const buildMultiPhotoContent = (
  title,
  images,
  count,
  order,
  pageNumberSettings,
) => {
  let content = "";
  const pageCount = Math.ceil(images.length / count);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const firstIndex = pageIndex * count;
    const entries = getMultiPhotoPageEntries(
      images,
      firstIndex,
      count,
      order,
    );
    content += `<div class="${getPageContainerClass(pageNumberSettings)}">`;
    content += `<h1>${escapeHtml(title)}</h1>`;
    content += `<div class="multi-photo-grid count-${count}">`;

    entries.forEach((entry) => {
      if (!entry) {
        content += `<section class="multi-photo-cell empty"></section>`;
        return;
      }
      const { image, number } = entry;
      const description = state.imageDescriptions[image.id] || "";
      content += `
        <section class="multi-photo-cell">
          <div class="multi-photo-image"><img src="${image.printUrl}" alt=""></div>
          <div class="multi-photo-caption">
            <span class="multi-photo-number">編號(${number})</span>
            <span class="multi-photo-description">${escapeHtml(description)}</span>
          </div>
        </section>`;
    });

    content += `</div>${buildPageNumber(pageIndex, pageNumberSettings)}</div>`;
  }
  return content;
};
