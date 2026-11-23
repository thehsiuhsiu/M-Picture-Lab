// docxGenerator.js：產生 Word 文件（刑案、交通事故兩種版型；多格照片只能輸出 PDF）

import { state } from "./state.js?v=20261123-1";
import { getFieldLabel } from "./fieldLabels.js?v=20261123-1";
import {
  getFormattedDate,
  showLoadingModal,
  hideLoadingModal,
  blobToArrayBuffer,
  showToast,
  showDialog,
} from "./utils.js?v=20261123-1";
import { createDocumentImageBlob, getDisplaySize } from "./annotations.js?v=20261123-1";
import { makeWord2007Compatible } from "./docxCompat.js?v=20261123-1";
import {
  CELL_SIDE_PADDING_MM,
  CELL_SIDE_PADDING_TWIPS,
  descriptionRowLines,
  FONT_PT,
  GROUP_GAP_PT,
  LAYOUTS,
  LINE_TWIPS,
  PAGE,
  PHOTO_GAP_MM,
  TEXT_BOTTOM_PADDING_TWIPS,
  TEXT_WIDTH_MM,
  TEXT_WIDTH_TWIPS,
  TITLE_LINE_PT,
  TITLE_PT,
  columnTwips,
  describeImages,
  describeViolation,
  findLineLimitViolations,
  getDocumentTitle,
  planPages,
  readFormData,
  spanWidth,
} from "./documentLayout.js?v=20261123-1";

const platformName =
  globalThis.navigator?.userAgentData?.platform ||
  globalThis.navigator?.platform ||
  globalThis.navigator?.userAgent ||
  "";
// Windows 用中文名稱「標楷體」：新版 Word 認得英文名 DFKai-SB，
// 但 Word 2003／2007 只認中文名，寫英文名會被換成別的字型。
const DOCX_KAI_FONT = /Mac|iPhone|iPad|iPod/i.test(platformName)
  ? "BiauKaiTC"
  : "標楷體";

const DOCX_IMAGE_MAX_DIMENSION = 1200;

// ============ 版面規格（與列印、PDF、版面預覽共用，見 documentLayout.js） ============
const FONT_HALF_POINTS = FONT_PT * 2;

const mmToTwips = (mm) => Math.round((mm / 25.4) * 1440);
const mmToPixels = (mm) => (mm / 25.4) * 96; // docx 套件的圖片尺寸以 96 dpi 像素計

/** Word 不擋輸出（使用者可在 Word 裡修改），只提醒超過行數上限的欄位 */
const confirmLineLimitsBeforeExport = async (violations) => {
  if (!violations.length) return true;
  return showDialog({
    title: "部分文字超過行數上限",
    message:
      "列印與 PDF 檔案需要先修改才能輸出；Word 可以照樣輸出，照片會稍微縮小或接到下一頁，之後可在 Word 裡自行調整。",
    details: violations.map(describeViolation),
    tone: "warning",
    confirmText: "照樣輸出",
    cancelText: "回去修改",
  });
};

// ============ 產生 Word 文件 ============
const sanitizeDownloadFileName = (fileName) => {
  const cleanedName = String(fileName ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");

  return cleanedName || "照片黏貼表";
};

export const handleGenerateWrapper = async (event) => {
  event.preventDefault();
  event.stopPropagation();

  if (state.selectedFormat === "right") {
    showToast("多格照片版型只能輸出 PDF。", "warning");
    return;
  }

  if (state.isGenerating) return;
  state.isGenerating = true;

  try {
    await handleGenerate();
  } finally {
    setTimeout(() => {
      state.isGenerating = false;
    }, 1000);
  }
};

const handleGenerate = async () => {
  if (state.selectedImages.length === 0) {
    showToast("請先新增照片，再產生文件。", "warning");
    return;
  }

  const format = state.selectedFormat;
  if (!LAYOUTS[format]) throw new Error("未知的文檔格式");
  const formData = readFormData();
  const items = describeImages(format, formData);
  const pages = planPages(format, items, formData);
  const violations = findLineLimitViolations(format, items, formData);
  if (!(await confirmLineLimitsBeforeExport(violations))) return;

  showLoadingModal();
  try {
    await Promise.all(
      items.map(async (item) => {
        // 有標記的照片輸出合成後的版本（原圖不變）
        const blob = await createDocumentImageBlob(item.image, DOCX_IMAGE_MAX_DIMENSION);
        item.imageData = await blobToArrayBuffer(blob);
      }),
    );

    const docx = window.docx;
    const doc = createDocument(docx, format, formData, pages);
    const blob = await makeWord2007Compatible(await docx.Packer.toBlob(doc));
    hideLoadingModal();

    const downloadTitle = sanitizeDownloadFileName(state.customDocTitles[format]);
    downloadBlob(blob, `${downloadTitle}_${getFormattedDate()}.docx`);
  } catch (error) {
    hideLoadingModal();
    console.error("Error in document generation:", error);
    showToast("產生 Word 文件時發生問題，請重新整理頁面後再試一次。", "error", 6000);
  }
};

const downloadBlob = (blob, fileName) => {
  const link = document.createElement("a");
  const downloadUrl = URL.createObjectURL(blob);
  link.href = downloadUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari 需要一點時間才開始下載，太早釋放網址會下載失敗
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
};

const createDocument = (docx, format, formData, pages) => {
  const title = getDocumentTitle(format);
  const layout = LAYOUTS[format];

  const children = [];
  pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) children.push(createPageBreak(docx));
    if (layout.hasCaseHeader) children.push(createCaseHeaderTable(docx, layout, formData));
    page.items.forEach((item, itemIndex) => {
      // 兩組之間空半行：固定行高的空段落
      if (itemIndex > 0) {
        children.push(
          new docx.Paragraph({
            style: "Normal",
            children: [new docx.TextRun({ text: "", size: 2 })],
            spacing: {
              before: 0,
              after: 0,
              line: GROUP_GAP_PT * 20,
              lineRule: docx.LineRuleType.EXACTLY,
            },
          }),
        );
      }
      children.push(
        format === "middle"
          ? createTrafficAccidentTable(docx, layout, item, page.frameHeight)
          : createCriminalTable(docx, layout, item, formData, page.frameHeight),
      );
    });
  });
  // 文件結尾一定要有段落；用極小段落，避免最後多出一張空白頁
  children.push(createTinyParagraph(docx));

  return new docx.Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: mmToTwips(PAGE.marginTop),
              bottom: mmToTwips(PAGE.marginBottom),
              left: mmToTwips(PAGE.marginSide),
              right: mmToTwips(PAGE.marginSide),
              header: mmToTwips(PAGE.headerDistance),
              footer: mmToTwips(PAGE.footerDistance),
            },
          },
        },
        headers: {
          default: new docx.Header({
            children: [
              new docx.Paragraph({
                text: title,
                alignment: docx.AlignmentType.DISTRIBUTE,
                style: "Header",
              }),
            ],
          }),
        },
        footers: { default: createDefaultFooter(docx) },
        children,
      },
    ],
    styles: createDocumentStyles(docx),
    compatibility: {
      doNotUseHTMLParagraphAutoSpacing: true,
      doNotUseIndentAsNumberingTabStop: true,
    },
  });
};

const tinySpacing = (docx) => ({
  before: 0,
  after: 0,
  line: 20,
  lineRule: docx.LineRuleType.EXACTLY,
});

const createTinyParagraph = (docx, options = {}) =>
  new docx.Paragraph({
    children: [new docx.TextRun({ text: "", size: 2 })],
    spacing: tinySpacing(docx),
    ...options,
  });

/** 換頁：下一頁開頭的極小段落，不會在新頁面多出一行空白 */
const createPageBreak = (docx) => createTinyParagraph(docx, { pageBreakBefore: true });

/** 文字段落；使用者按的換行保留為 Word 的換行 */
const textParagraph = (docx, text, alignment) =>
  new docx.Paragraph({
    style: "Normal",
    alignment,
    children: String(text ?? "")
      .split(/\r\n|\r|\n/)
      .map((line, index) => new docx.TextRun({ text: line, break: index > 0 ? 1 : 0 })),
  });

const labelCell = (docx, layout, start, text, span = 1) =>
  textCell(docx, layout, start, text, span, docx.AlignmentType.DISTRIBUTE);

const textCell = (docx, layout, start, text, span = 1, alignment = docx.AlignmentType.LEFT) =>
  new docx.TableCell({
    children: [textParagraph(docx, text, alignment)],
    width: { size: spanWidth(layout, start, span).twips, type: docx.WidthType.DXA },
    columnSpan: span > 1 ? span : undefined,
    verticalAlign: docx.VerticalAlign.CENTER,
    margins: {
      top: 0,
      bottom: TEXT_BOTTOM_PADDING_TWIPS,
      left: CELL_SIDE_PADDING_TWIPS,
      right: CELL_SIDE_PADDING_TWIPS,
    },
  });

const createTable = (docx, layout, rows) =>
  new docx.Table({
    layout: docx.TableLayoutType.FIXED,
    width: { size: TEXT_WIDTH_TWIPS, type: docx.WidthType.DXA },
    columnWidths: columnTwips(layout.columns),
    rows,
  });

const textRow = (docx, cells) => new docx.TableRow({ cantSplit: true, children: cells });

/** 說明列：固定行高（刑事案件 2 行、交通事故 3 行）；超過時 Word 讓它自動長高 */
const descriptionRow = (docx, layout, item, format) =>
  new docx.TableRow({
    cantSplit: true,
    height: {
      value: descriptionRowLines(format) * LINE_TWIPS + TEXT_BOTTOM_PADDING_TWIPS,
      rule: docx.HeightRule.ATLEAST,
    },
    children: [
      labelCell(docx, layout, 0, "說明"),
      // 左右對齊（不是分散對齊）：每行兩端切齊，最後一行靠左
      textCell(docx, layout, 1, item.description, 5, docx.AlignmentType.BOTH),
    ],
  });

/** 照片框：照片等比例縮放，上下貼齊框線、左右保留 0.19 cm 內距，不超出框線 */
const photoRow = (docx, layout, item, frameHeight) => {
  const maxWidthMm = TEXT_WIDTH_MM - 2 * CELL_SIDE_PADDING_MM;
  const maxHeightMm = frameHeight - 2 * PHOTO_GAP_MM;
  // 調整過比例的照片，照框依拉伸後的形狀計算
  const size = getDisplaySize(item.image);
  const width = Math.max(1, Number(size.width) || 1);
  const height = Math.max(1, Number(size.height) || 1);
  const scale = Math.min(maxWidthMm / width, maxHeightMm / height);
  return new docx.TableRow({
    cantSplit: true,
    height: { value: mmToTwips(frameHeight), rule: docx.HeightRule.EXACT },
    children: [
      new docx.TableCell({
        children: [
          new docx.Paragraph({
            alignment: docx.AlignmentType.CENTER,
            // 照片所在段落用單行間距，不受表格文字的固定行高限制
            spacing: { before: 0, after: 0, line: 240, lineRule: docx.LineRuleType.AUTO },
            children: [
              new docx.ImageRun({
                data: item.imageData,
                transformation: {
                  width: Math.round(mmToPixels(width * scale)),
                  height: Math.round(mmToPixels(height * scale)),
                },
              }),
            ],
          }),
        ],
        columnSpan: layout.columns.length,
        width: { size: TEXT_WIDTH_TWIPS, type: docx.WidthType.DXA },
        verticalAlign: docx.VerticalAlign.CENTER,
        // 上下貼齊框線；左右保留 Word 預設的 0.19 cm，舊版 Word 的上下表格才會對齊
        margins: {
          top: mmToTwips(PHOTO_GAP_MM),
          bottom: mmToTwips(PHOTO_GAP_MM),
          left: CELL_SIDE_PADDING_TWIPS,
          right: CELL_SIDE_PADDING_TWIPS,
        },
      }),
    ],
  });
};

const createCaseHeaderTable = (docx, layout, formData) =>
  createTable(docx, layout, [
    textRow(docx, [
      labelCell(docx, layout, 0, getFieldLabel("caseReason")),
      textCell(docx, layout, 1, formData.caseReason, 2),
      labelCell(docx, layout, 3, getFieldLabel("caseUnit")),
      textCell(docx, layout, 4, formData.caseUnit, 2),
    ]),
  ]);

const createCriminalTable = (docx, layout, item, formData, frameHeight) =>
  createTable(docx, layout, [
    photoRow(docx, layout, item, frameHeight),
    textRow(docx, [
      textCell(docx, layout, 0, `編號(${item.number})`, 1, docx.AlignmentType.CENTER),
      labelCell(docx, layout, 1, "照片日期"),
      textCell(docx, layout, 2, item.date, 2),
      labelCell(docx, layout, 4, getFieldLabel("photographer")),
      textCell(docx, layout, 5, formData.caseNumber, 1, docx.AlignmentType.CENTER),
    ]),
    textRow(docx, [
      labelCell(docx, layout, 0, getFieldLabel("address")),
      textCell(docx, layout, 1, item.address, 5),
    ]),
    descriptionRow(docx, layout, item, "left"),
  ]);

const createTrafficAccidentTable = (docx, layout, item, frameHeight) =>
  createTable(docx, layout, [
    photoRow(docx, layout, item, frameHeight),
    textRow(docx, [
      labelCell(docx, layout, 0, "攝影日期"),
      textCell(docx, layout, 1, item.date, 2),
      labelCell(docx, layout, 3, "照片編號"),
      textCell(docx, layout, 4, String(item.number), 2, docx.AlignmentType.CENTER),
    ]),
    descriptionRow(docx, layout, item, "middle"),
  ]);

const createDefaultFooter = (docx) =>
  new docx.Footer({
    children: [
      new docx.Paragraph({
        alignment: docx.AlignmentType.CENTER,
        style: "Footer",
        spacing: { before: 0, after: 0, line: 240, lineRule: docx.LineRuleType.EXACTLY },
        children: [
          new docx.TextRun({ text: "第 ", size: 20, font: DOCX_KAI_FONT }),
          new docx.TextRun({
            children: [docx.PageNumber.CURRENT],
            size: 20,
            font: DOCX_KAI_FONT,
          }),
          new docx.TextRun({ text: " 頁", size: 20, font: DOCX_KAI_FONT }),
        ],
      }),
    ],
  });

const createDocumentStyles = (docx) => ({
  paragraphStyles: [
    {
      id: "Normal",
      name: "Normal",
      next: "Normal",
      quickFormat: true,
      run: { size: FONT_HALF_POINTS, font: DOCX_KAI_FONT },
      paragraph: {
        alignment: docx.AlignmentType.DISTRIBUTE,
        spacing: { before: 0, after: 0, line: LINE_TWIPS, lineRule: docx.LineRuleType.EXACTLY },
      },
    },
    {
      id: "Header",
      name: "Header",
      basedOn: "Normal",
      next: "Normal",
      quickFormat: true,
      run: { size: TITLE_PT * 2, font: DOCX_KAI_FONT },
      paragraph: {
        // 固定行高：不論電腦上用哪種字型，標題高度都一樣，不會把下面的表格往下推
        spacing: { before: 0, after: 0, line: TITLE_LINE_PT * 20, lineRule: docx.LineRuleType.EXACTLY },
      },
    },
  ],
});
