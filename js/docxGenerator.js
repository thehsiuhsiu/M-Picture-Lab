// docxGenerator.js：產生 Word 文件（刑案、交通事故兩種版型；多格照片只能輸出 PDF）

import { state, ACCIDENT_TAG_OPTIONS } from "./state.js?v=20261121-2";
import {
  getFormattedDate,
  showLoadingModal,
  hideLoadingModal,
  blobToArrayBuffer,
  showToast,
  showDialog,
} from "./utils.js?v=20261121-2";
import { createDocumentImageBlob, getDisplaySize } from "./annotations.js?v=20261121-2";
import { makeWord2007Compatible } from "./docxCompat.js?v=20261121-2";
import { getPhotoNumber } from "./photoNumbering.js?v=20261121-2";

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

// ============ 版面尺寸（A4，單位 mm） ============
// 標題與頁碼盡量靠近紙張邊緣，把空間留給照片與文字。
const PAGE = {
  height: 297,
  marginTop: 20,
  marginBottom: 10,
  marginSide: 27,
  headerDistance: 8, // 標題離紙張上緣
  footerDistance: 5, // 頁碼離紙張下緣
};
const TEXT_WIDTH_TWIPS = 11906 - 2 * Math.round((PAGE.marginSide / 25.4) * 1440); // 8844
const TEXT_WIDTH_MM = (TEXT_WIDTH_TWIPS / 1440) * 25.4;
const BODY_HEIGHT_MM = PAGE.height - PAGE.marginTop - PAGE.marginBottom;

// 表格文字：11.5 點標楷體、固定行高 15 點，行數才能準確估算
const FONT_HALF_POINTS = 23;
const FONT_EM_MM = (FONT_HALF_POINTS / 2 / 72) * 25.4;
const LINE_TWIPS = 300;
const LINE_MM = (LINE_TWIPS / 20 / 72) * 25.4;
const CELL_PADDING_MM = (2 * 108 * 25.4) / 1440; // Word 預設儲存格左右內距各 0.19 cm
const ROW_EXTRA_MM = 0.4; // 框線
const TINY_PARAGRAPH_MM = 0.5; // 換頁與文件結尾用的極小段落
const SAFETY_MM = 4; // 估算誤差的保留空間

// 照片框：一般 95mm；文字換行多時同頁一起變矮，最矮 85mm（約可多容納 3 行說明）
const PHOTO_FRAME_MAX_MM = 95;
const PHOTO_FRAME_MIN_MM = 85;
// 照片貼齊框線：照片框的儲存格不留內距，只保留框線的寬度，避免照片壓到框線
const PHOTO_GAP_MM = 0.4;
const DESCRIPTION_MAX_LINES = 3;

const mmToTwips = (mm) => Math.round((mm / 25.4) * 1440);
const mmToPixels = (mm) => (mm / 25.4) * 96; // docx 套件的圖片尺寸以 96 dpi 像素計

// 表格欄位：所有寬度都落在同一組 6 欄格線上，Word、LibreOffice、WPS 欄寬才會一致
const LAYOUTS = {
  left: {
    columns: [15, 15, 20, 15, 15, 20],
    hasCaseHeader: true,
  },
  middle: {
    columns: [15, 27.5, 27.5, 15, 7.5, 7.5],
    hasCaseHeader: false,
  },
};

const columnTwips = (columns) => {
  const widths = columns.map((percent) => Math.floor((TEXT_WIDTH_TWIPS * percent) / 100));
  widths[widths.length - 1] += TEXT_WIDTH_TWIPS - widths.reduce((sum, value) => sum + value, 0);
  return widths;
};

/** 從第 start 欄起合併 span 欄的寬度（twips 與 mm） */
const spanWidth = (layout, start, span) => {
  const twips = columnTwips(layout.columns)
    .slice(start, start + span)
    .reduce((sum, value) => sum + value, 0);
  return { twips, mm: (twips / 1440) * 25.4 };
};

// ============ 文字行數估算 ============
const isHalfWidth = (char) => {
  const code = char.codePointAt(0);
  return code <= 0x7e || (code >= 0xff61 && code <= 0xff9f);
};

/** 估算文字放進寬 widthMm 的儲存格會佔幾行（含使用者自己按的換行） */
export const estimateLines = (text, widthMm) => {
  const available = Math.max(1, widthMm - CELL_PADDING_MM);
  return String(text ?? "")
    .split(/\r\n|\r|\n/)
    .reduce((total, segment) => {
      let width = 0;
      for (const char of segment) width += isHalfWidth(char) ? FONT_EM_MM / 2 : FONT_EM_MM;
      return total + Math.max(1, Math.ceil((width * 1.05) / available));
    }, 0);
};

const rowHeight = (lines) => lines * LINE_MM + ROW_EXTRA_MM;

// ============ 每張照片要印的內容 ============
const getDateToShow = (image, isAutoDate, manualDate) => {
  if (image.customDate) return image.customDate;
  if (isAutoDate) return image.date || manualDate;
  return manualDate;
};

const generateAccidentTagsText = (tags) =>
  ACCIDENT_TAG_OPTIONS.map((option) => {
    const isChecked = tags && tags[option.id];
    const checkbox = isChecked ? "■" : "□";
    if (option.id === "other") {
      const otherText = isChecked && tags.otherText ? tags.otherText : "___________";
      return `${checkbox}其他:${otherText}`;
    }
    return `${checkbox}${option.label}`;
  }).join(" ");

/** 整理一張照片在文件上要印的文字 */
const describeImage = (image, index, format, formData, isAutoDate, manualDate) => {
  const description =
    format === "middle"
      ? generateAccidentTagsText(state.imageAccidentTags[image.id] || {})
      : state.imageDescriptions[image.id] || "";
  return {
    image,
    number: getPhotoNumber(index),
    date: getDateToShow(
      { ...image, customDate: state.imageDates[image.id] || "" },
      isAutoDate,
      manualDate,
    ) || "",
    address: state.imageAddresses[image.id] || formData.caseAddress || "",
    description,
  };
};

// ============ 版面規劃：決定每頁放哪幾張、照片框多高 ============
const caseHeaderLines = (layout, formData) =>
  Math.max(
    estimateLines(formData.caseReason, spanWidth(layout, 1, 2).mm),
    estimateLines(formData.caseUnit, spanWidth(layout, 4, 2).mm),
  );

const descriptionLines = (layout, item) => estimateLines(item.description, spanWidth(layout, 1, 5).mm);

/** 一組（照片框以外的文字列）的高度 */
const groupTextHeight = (format, layout, item, formData) => {
  if (format === "middle") {
    const dateLines = Math.max(
      estimateLines(item.date, spanWidth(layout, 1, 2).mm),
      estimateLines(String(item.number), spanWidth(layout, 4, 2).mm),
    );
    return rowHeight(dateLines) + rowHeight(descriptionLines(layout, item));
  }
  const dateLines = Math.max(
    estimateLines(item.date, spanWidth(layout, 2, 2).mm),
    estimateLines(formData.caseNumber, spanWidth(layout, 5, 1).mm),
  );
  return (
    rowHeight(dateLines) +
    rowHeight(estimateLines(item.address, spanWidth(layout, 1, 5).mm)) +
    rowHeight(descriptionLines(layout, item))
  );
};

/** 這幾組放同一頁時，照片框可以多高 */
const frameHeightFor = (format, layout, items, formData) => {
  let fixed = TINY_PARAGRAPH_MM * 2 + SAFETY_MM;
  if (layout.hasCaseHeader) fixed += rowHeight(caseHeaderLines(layout, formData));
  fixed += (items.length - 1) * LINE_MM; // 兩組之間空一行
  for (const item of items) fixed += groupTextHeight(format, layout, item, formData);
  return Math.min(PHOTO_FRAME_MAX_MM, (BODY_HEIGHT_MM - fixed) / items.length);
};

/**
 * 每頁原則上放 2 張。文字多時同頁兩個照片框一起變矮（最矮 85mm）；
 * 再放不下時，第二張搬到下一頁。
 */
export const planDocxPages = (format, items, formData) => {
  const layout = LAYOUTS[format];
  const pages = [];
  const movedNumbers = [];
  let index = 0;
  while (index < items.length) {
    const pair = items.slice(index, index + 2);
    if (pair.length === 2) {
      const frame = frameHeightFor(format, layout, pair, formData);
      if (frame >= PHOTO_FRAME_MIN_MM) {
        pages.push({ items: pair, frameHeight: frame });
        index += 2;
        continue;
      }
      movedNumbers.push(pair[1].number);
    }
    const single = [items[index]];
    const frame = frameHeightFor(format, layout, single, formData);
    // 只有一張還是放不下時，照片框不再縮，交給 Word 自然換頁
    pages.push({ items: single, frameHeight: Math.max(PHOTO_FRAME_MIN_MM, frame) });
    index += 1;
  }
  const longDescriptions = items
    .filter((item) => descriptionLines(layout, item) > DESCRIPTION_MAX_LINES)
    .map((item) => item.number);
  return { pages, movedNumbers, longDescriptions };
};

const confirmLongTextBeforeExport = async ({ movedNumbers, longDescriptions }) => {
  if (!movedNumbers.length && !longDescriptions.length) return true;
  const details = [];
  if (longDescriptions.length) {
    details.push(`說明超過 ${DESCRIPTION_MAX_LINES} 行：照片 ${longDescriptions.join("、")}`);
  }
  if (movedNumbers.length) {
    details.push(`會單獨移到下一頁：照片 ${movedNumbers.join("、")}`);
  }
  return showDialog({
    title: "部分照片的文字較多",
    message:
      "Word 文件每頁放 2 張照片，文字多時照片會稍微縮小；放不下時，那張照片會移到下一頁。可以回去精簡文字，或照樣輸出。",
    details,
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

const DEFAULT_TITLES = {
  left: "刑案照片黏貼表",
  middle: "非道路交通事故照片黏貼紀錄表",
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

const readFormData = () => {
  const value = (id) => document.getElementById(id)?.value || "";
  return {
    caseReason: value("zipPrefix"),
    caseUnit: value("caseUni"),
    caseAddress: value("caseAddress"),
    caseDate: value("caseDate"),
    caseNumber: value("caseNumber"),
  };
};

const handleGenerate = async () => {
  if (state.selectedImages.length === 0) {
    showToast("請先新增照片，再產生文件。", "warning");
    return;
  }

  const format = state.selectedFormat;
  if (!LAYOUTS[format]) throw new Error("未知的文檔格式");
  const formData = readFormData();
  const isAutoDate = Boolean(document.getElementById("dateModeSwitch")?.checked);
  const items = state.selectedImages.map((image, index) =>
    describeImage(image, index, format, formData, isAutoDate, formData.caseDate),
  );
  const plan = planDocxPages(format, items, formData);
  if (!(await confirmLongTextBeforeExport(plan))) return;

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
    const doc = createDocument(docx, format, formData, plan.pages);
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
  const title = state.customDocTitles[format] ?? DEFAULT_TITLES[format];
  const layout = LAYOUTS[format];

  const children = [];
  pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) children.push(createPageBreak(docx));
    if (layout.hasCaseHeader) children.push(createCaseHeaderTable(docx, layout, formData));
    page.items.forEach((item, itemIndex) => {
      if (itemIndex > 0) children.push(new docx.Paragraph({ text: "", style: "Normal" }));
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
  });

const createTable = (docx, layout, rows) =>
  new docx.Table({
    layout: docx.TableLayoutType.FIXED,
    width: { size: TEXT_WIDTH_TWIPS, type: docx.WidthType.DXA },
    columnWidths: columnTwips(layout.columns),
    rows,
  });

const textRow = (docx, cells) => new docx.TableRow({ cantSplit: true, children: cells });

/** 照片框：照片等比例縮放，以較寬或較高的那一邊貼齊框線，不超出框線 */
const photoRow = (docx, layout, item, frameHeight) => {
  const maxWidthMm = TEXT_WIDTH_MM - 2 * PHOTO_GAP_MM;
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
        // 不用 Word 預設的左右內距（各 0.19 cm），照片才能貼齊框線
        margins: {
          top: mmToTwips(PHOTO_GAP_MM),
          bottom: mmToTwips(PHOTO_GAP_MM),
          left: mmToTwips(PHOTO_GAP_MM),
          right: mmToTwips(PHOTO_GAP_MM),
        },
      }),
    ],
  });
};

const createCaseHeaderTable = (docx, layout, formData) =>
  createTable(docx, layout, [
    textRow(docx, [
      labelCell(docx, layout, 0, "案由"),
      textCell(docx, layout, 1, formData.caseReason, 2, docx.AlignmentType.CENTER),
      labelCell(docx, layout, 3, "單位"),
      textCell(docx, layout, 4, formData.caseUnit, 2, docx.AlignmentType.CENTER),
    ]),
  ]);

const createCriminalTable = (docx, layout, item, formData, frameHeight) =>
  createTable(docx, layout, [
    photoRow(docx, layout, item, frameHeight),
    textRow(docx, [
      textCell(docx, layout, 0, `編號(${item.number})`, 1, docx.AlignmentType.CENTER),
      labelCell(docx, layout, 1, "照片日期"),
      textCell(docx, layout, 2, item.date, 2),
      labelCell(docx, layout, 4, "攝影人"),
      textCell(docx, layout, 5, formData.caseNumber, 1, docx.AlignmentType.CENTER),
    ]),
    textRow(docx, [
      labelCell(docx, layout, 0, "攝影地址"),
      textCell(docx, layout, 1, item.address, 5),
    ]),
    textRow(docx, [
      labelCell(docx, layout, 0, "說明"),
      textCell(docx, layout, 1, item.description, 5),
    ]),
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
    textRow(docx, [
      labelCell(docx, layout, 0, "說明"),
      textCell(docx, layout, 1, item.description, 5),
    ]),
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
      run: { size: 44, font: DOCX_KAI_FONT },
      paragraph: {
        spacing: { before: 0, after: 0, line: 240, lineRule: docx.LineRuleType.AUTO },
      },
    },
  ],
});
