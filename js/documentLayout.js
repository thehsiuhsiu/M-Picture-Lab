// documentLayout.js - 版面規格：刑事案件與交通事故版型的 Word、列印、PDF 檔案、版面預覽共用
// 所有排版數字以 Word 為準（見 docs/adr/0005-shared-layout-spec.md）。

import { state, ACCIDENT_TAG_OPTIONS, FORMAT_TITLES } from "./state.js?v=20261121-7";
import { getPhotoNumber } from "./photoNumbering.js?v=20261121-7";

// ============ 頁面（A4，單位 mm） ============
export const PAGE = Object.freeze({
  width: 210,
  height: 297,
  marginTop: 20,
  marginBottom: 10,
  marginSide: 24,
  headerDistance: 8, // 標題離紙張上緣
  footerDistance: 5, // 頁碼離紙張下緣
});

const mmToTwips = (mm) => Math.round((mm / 25.4) * 1440);
export const TEXT_WIDTH_TWIPS = 11906 - 2 * mmToTwips(PAGE.marginSide);
export const TEXT_WIDTH_MM = (TEXT_WIDTH_TWIPS / 1440) * 25.4;
export const BODY_HEIGHT_MM = PAGE.height - PAGE.marginTop - PAGE.marginBottom;

// ============ 文字 ============
export const FONT_PT = 12; // 表格文字
export const TITLE_PT = 22; // 文件標題
export const PAGE_NUMBER_PT = 10; // 頁碼
export const LINE_PT = 15; // 固定行高
export const LINE_TWIPS = LINE_PT * 20;
export const LINE_MM = (LINE_PT / 72) * 25.4;
const FONT_EM_MM = (FONT_PT / 72) * 25.4;

// 儲存格內距：左右用 Word 預設各 0.19 cm；
// Word 的固定行高把多出的行距放在文字上方，下方補約 2.5 點，上下留白才一樣
export const CELL_SIDE_PADDING_TWIPS = 108;
export const CELL_SIDE_PADDING_MM = (CELL_SIDE_PADDING_TWIPS / 1440) * 25.4;
export const TEXT_BOTTOM_PADDING_TWIPS = 50;
export const TEXT_BOTTOM_PADDING_MM = (TEXT_BOTTOM_PADDING_TWIPS / 1440) * 25.4;
const BORDER_MM = 0.4;
const ROW_EXTRA_MM = BORDER_MM + TEXT_BOTTOM_PADDING_MM;
const TINY_PARAGRAPH_MM = 0.5; // Word 換頁與文件結尾用的極小段落
const SAFETY_MM = 4; // 估算誤差的保留空間

// ============ 照片框 ============
export const PHOTO_FRAME_MAX_MM = 95;
// 只有 Word 會用到：文字超過行數上限時照片框一起變矮，最矮 85mm
export const PHOTO_FRAME_MIN_MM = 85;
// 照片貼齊框線，只留框線的寬度
export const PHOTO_GAP_MM = 0.4;

// ============ 表格欄位 ============
// 所有寬度都落在同一組 6 欄格線上（百分比），Word、LibreOffice、WPS 與網頁欄寬才會一致
export const LAYOUTS = Object.freeze({
  left: Object.freeze({
    columns: Object.freeze([15, 15, 20, 15, 15, 20]),
    hasCaseHeader: true,
  }),
  middle: Object.freeze({
    columns: Object.freeze([15, 27.5, 27.5, 15, 7.5, 7.5]),
    hasCaseHeader: false,
  }),
});

export const isLayoutFormat = (format) => Boolean(LAYOUTS[format]);

export const columnTwips = (columns) => {
  const widths = columns.map((percent) => Math.floor((TEXT_WIDTH_TWIPS * percent) / 100));
  widths[widths.length - 1] += TEXT_WIDTH_TWIPS - widths.reduce((sum, value) => sum + value, 0);
  return widths;
};

/** 從第 start 欄起合併 span 欄的寬度（twips 與 mm） */
export const spanWidth = (layout, start, span) => {
  const twips = columnTwips(layout.columns)
    .slice(start, start + span)
    .reduce((sum, value) => sum + value, 0);
  return { twips, mm: (twips / 1440) * 25.4 };
};

// ============ 行數上限 ============
const LINE_LIMITS = Object.freeze({
  description: 2,
  caseReason: 2,
  caseUnit: 2,
  address: 1,
  date: 1,
  photographer: 1,
});

/** 欄位的行數上限；交通事故的說明是 13 個勾選項目，本身就約 2.2 行，所以放寬到 3 行 */
export const lineLimit = (format, field) =>
  format === "middle" && field === "description" ? 3 : LINE_LIMITS[field];

/** 說明列固定的行高（行數） */
export const descriptionRowLines = (format) => lineLimit(format, "description");

// ============ 文字行數估算 ============
const isHalfWidth = (char) => {
  const code = char.codePointAt(0);
  return code <= 0x7e || (code >= 0xff61 && code <= 0xff9f);
};

/** 估算文字放進寬 widthMm 的儲存格會佔幾行（含使用者自己按的換行） */
export const estimateLines = (text, widthMm) => {
  const available = Math.max(1, widthMm - 2 * CELL_SIDE_PADDING_MM);
  return String(text ?? "")
    .split(/\r\n|\r|\n/)
    .reduce((total, segment) => {
      let width = 0;
      for (const char of segment) width += isHalfWidth(char) ? FONT_EM_MM / 2 : FONT_EM_MM;
      return total + Math.max(1, Math.ceil((width * 1.05) / available));
    }, 0);
};

/** 空白文字算 0 行（欄位提示用） */
const linesOf = (text, widthMm) => (String(text ?? "").trim() ? estimateLines(text, widthMm) : 0);

/** 各欄位在文件上的寬度 */
export const FIELD_SPANS = Object.freeze({
  left: Object.freeze({
    caseReason: [1, 2],
    caseUnit: [4, 2],
    date: [2, 2],
    photographer: [5, 1],
    address: [1, 5],
    description: [1, 5],
  }),
  middle: Object.freeze({
    date: [1, 2],
    description: [1, 5],
  }),
});

export const fieldWidthMm = (format, field) => {
  const span = FIELD_SPANS[format]?.[field];
  return span ? spanWidth(LAYOUTS[format], span[0], span[1]).mm : 0;
};

/** 文字放進某欄位約佔幾行；這個版型沒有該欄位時回傳 0 */
export const fieldLines = (format, field, text) => {
  const width = fieldWidthMm(format, field);
  return width ? linesOf(text, width) : 0;
};

// ============ 文件內容 ============
export const getDocumentTitle = (format) =>
  state.customDocTitles[format] ?? FORMAT_TITLES[format] ?? "照片黏貼表";

export const readFormData = () => {
  const value = (id) => document.getElementById(id)?.value || "";
  return {
    caseReason: value("zipPrefix"),
    caseUnit: value("caseUni"),
    caseAddress: value("caseAddress"),
    caseDate: value("caseDate"),
    caseNumber: value("caseNumber"),
    isAutoDate: Boolean(document.getElementById("dateModeSwitch")?.checked),
  };
};

export const generateAccidentTagsText = (tags) =>
  ACCIDENT_TAG_OPTIONS.map((option) => {
    const isChecked = tags && tags[option.id];
    const checkbox = isChecked ? "■" : "□";
    if (option.id === "other") {
      const otherText = isChecked && tags.otherText ? tags.otherText : "___________";
      return `${checkbox}其他:${otherText}`;
    }
    return `${checkbox}${option.label}`;
  }).join(" ");

const getDateToShow = (image, formData) => {
  const customDate = state.imageDates[image.id] || "";
  if (customDate) return customDate;
  if (formData.isAutoDate) return image.date || formData.caseDate;
  return formData.caseDate;
};

/** 整理一張照片在文件上要印的文字 */
export const describeImage = (image, index, format, formData) => ({
  image,
  index,
  number: getPhotoNumber(index),
  date: getDateToShow(image, formData) || "",
  address: state.imageAddresses[image.id] || formData.caseAddress || "",
  description:
    format === "middle"
      ? generateAccidentTagsText(state.imageAccidentTags[image.id] || {})
      : state.imageDescriptions[image.id] || "",
});

export const describeImages = (format, formData) =>
  state.selectedImages.map((image, index) => describeImage(image, index, format, formData));

// ============ 每頁排法 ============
const rowHeight = (lines) => lines * LINE_MM + ROW_EXTRA_MM;

const caseHeaderLines = (formData) =>
  Math.max(
    1,
    fieldLines("left", "caseReason", formData.caseReason),
    fieldLines("left", "caseUnit", formData.caseUnit),
  );

/** 一組（照片框以外的文字列）的高度 */
const groupTextHeight = (format, item, formData) => {
  const descriptionLines = Math.max(
    descriptionRowLines(format),
    fieldLines(format, "description", item.description),
  );
  if (format === "middle") {
    const dateLines = Math.max(1, fieldLines(format, "date", item.date));
    return rowHeight(dateLines) + rowHeight(descriptionLines);
  }
  const dateLines = Math.max(
    1,
    fieldLines(format, "date", item.date),
    fieldLines(format, "photographer", formData.caseNumber),
  );
  return (
    rowHeight(dateLines) +
    rowHeight(Math.max(1, fieldLines(format, "address", item.address))) +
    rowHeight(descriptionLines)
  );
};

/** 這幾組放同一頁時，照片框可以多高 */
const frameHeightFor = (format, items, formData) => {
  let fixed = TINY_PARAGRAPH_MM * 2 + SAFETY_MM;
  if (LAYOUTS[format].hasCaseHeader) fixed += rowHeight(caseHeaderLines(formData));
  fixed += (items.length - 1) * LINE_MM; // 兩組之間空一行
  for (const item of items) fixed += groupTextHeight(format, item, formData);
  return Math.min(PHOTO_FRAME_MAX_MM, (BODY_HEIGHT_MM - fixed) / items.length);
};

/**
 * 每頁固定放 2 張；同頁兩個照片框一樣高。
 * 文字在行數上限內時照片框都是 95mm；只有 Word 會遇到超過上限的文字，
 * 那時照片框一起變矮（最矮 85mm），還是放不下就交給 Word 自然接到下一頁。
 */
export const planPages = (format, items, formData) => {
  const pages = [];
  for (let index = 0; index < items.length; index += 2) {
    const pair = items.slice(index, index + 2);
    const frame = frameHeightFor(format, pair, formData);
    pages.push({ items: pair, frameHeight: Math.max(PHOTO_FRAME_MIN_MM, frame) });
  }
  return pages;
};

// ============ 檢查行數上限 ============
const FIELD_LABELS = Object.freeze({
  caseReason: "案由",
  caseUnit: "單位",
  photographer: "攝影人員",
  date: "照片日期",
  address: "攝影地址",
  description: "說明",
});

export const fieldLabel = (format, field) =>
  format === "middle" && field === "date" ? "攝影日期" : FIELD_LABELS[field];

/**
 * 找出超過行數上限的欄位。
 * 回傳 [{ field, label, lines, limit, imageId?, number?, source }]；
 * source 是要去修改的地方："case"（案件資料）或 "image"（照片卡片）。
 */
export const findLineLimitViolations = (format, items, formData) => {
  if (!isLayoutFormat(format)) return [];
  const violations = [];
  const check = (field, text, extra) => {
    const lines = fieldLines(format, field, text);
    const limit = lineLimit(format, field);
    if (lines > limit) violations.push({ field, label: fieldLabel(format, field), lines, limit, ...extra });
  };
  if (format === "left") {
    check("caseReason", formData.caseReason, { source: "case" });
    check("caseUnit", formData.caseUnit, { source: "case" });
    check("photographer", formData.caseNumber, { source: "case" });
  }
  items.forEach((item) => {
    const imageId = item.image.id;
    const extra = { imageId, number: item.number };
    const ownDate = Boolean(state.imageDates[imageId]);
    check("date", item.date, { ...extra, source: ownDate ? "image" : "case" });
    if (format === "left") {
      const ownAddress = Boolean(state.imageAddresses[imageId]);
      check("address", item.address, { ...extra, source: ownAddress ? "image" : "case" });
    }
    check("description", item.description, { ...extra, source: "image" });
  });
  // 同一個案件資料欄位造成多張照片超過時，只列一次
  const seen = new Set();
  return violations.filter((item) => {
    if (item.source !== "case") return true;
    if (seen.has(item.field)) return false;
    seen.add(item.field);
    return true;
  });
};

export const describeViolation = (item) => {
  if (item.source === "image") return `照片 ${item.number} 的${item.label}超過 ${item.limit} 行`;
  return `${item.label}（案件資料）超過 ${item.limit} 行`;
};

// ============ 網頁排版（列印、PDF 檔案、版面預覽共用） ============
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const pt = (value) => `${value}pt`;
const mm = (value) => `${Number(value.toFixed(3))}mm`;

/** 網頁排版用的樣式；scope 是頁面元素的選擇器 */
export const buildSheetCss = (scope = ".doc-sheet") => `
${scope} {
  position: relative;
  box-sizing: border-box;
  width: ${mm(PAGE.width)};
  height: ${mm(PAGE.height)};
  overflow: hidden;
  background: #fff;
  color: #000;
  font-size: ${pt(FONT_PT)};
  line-height: ${pt(LINE_PT)};
}
${scope} *, ${scope} *::before, ${scope} *::after { box-sizing: border-box; }
${scope} .doc-title {
  position: absolute;
  top: ${mm(PAGE.headerDistance)};
  left: ${mm(PAGE.marginSide)};
  right: ${mm(PAGE.marginSide)};
  margin: 0;
  overflow: hidden;
  font-size: ${pt(TITLE_PT)};
  font-weight: normal;
  line-height: 1.15;
  white-space: nowrap;
  text-align: justify;
  text-align-last: justify;
}
${scope} .doc-body {
  position: absolute;
  top: ${mm(PAGE.marginTop)};
  left: ${mm(PAGE.marginSide)};
  width: ${mm(TEXT_WIDTH_MM)};
  height: ${mm(BODY_HEIGHT_MM)};
}
${scope} .doc-page-number {
  position: absolute;
  right: 0;
  bottom: ${mm(PAGE.footerDistance)};
  left: 0;
  font-size: ${pt(PAGE_NUMBER_PT)};
  line-height: 1.2;
  text-align: center;
}
${scope} table.doc-table {
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  table-layout: fixed;
}
${scope} table.doc-table + table.doc-table { margin-top: -1px; }
${scope} .doc-gap { height: ${pt(LINE_PT)}; }
${scope} .doc-table td {
  padding: ${mm(TEXT_BOTTOM_PADDING_MM / 2)} ${mm(CELL_SIDE_PADDING_MM)};
  border: 1px solid #000;
  vertical-align: middle;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
${scope} .doc-table .doc-label {
  text-align: justify;
  text-align-last: justify;
  white-space: nowrap;
}
${scope} .doc-table .doc-center { text-align: center; }
${scope} .doc-table .doc-left { text-align: left; }
${scope} .doc-table .doc-justify { text-align: justify; text-align-last: left; }
${scope} .doc-table .doc-text {
  max-height: calc(var(--doc-lines, 1) * ${pt(LINE_PT)});
  overflow: hidden;
}
${scope} .doc-table .doc-description-row .doc-text {
  display: flex;
  height: calc(var(--doc-lines, 2) * ${pt(LINE_PT)});
  flex-direction: column;
  justify-content: center;
}
${scope} .doc-table td.doc-photo {
  padding: ${mm(PHOTO_GAP_MM)};
  text-align: center;
  white-space: normal;
}
${scope} .doc-photo img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  margin: 0 auto;
  object-fit: contain;
}
`;

const colgroup = (layout) =>
  `<colgroup>${layout.columns.map((percent) => `<col style="width:${percent}%">`).join("")}</colgroup>`;

const label = (text, span = 1) =>
  `<td class="doc-label"${span > 1 ? ` colspan="${span}"` : ""}>${escapeHtml(text)}</td>`;

const value = (text, { span = 1, align = "doc-left", lines = 1 } = {}) =>
  `<td class="${align}"${span > 1 ? ` colspan="${span}"` : ""}><div class="doc-text" data-overflow-check="true" style="--doc-lines:${lines}">${escapeHtml(text)}</div></td>`;

const photoRow = (src, frameHeight) => {
  const inner = mm(frameHeight - 2 * PHOTO_GAP_MM);
  return `<tr><td class="doc-photo" colspan="6" style="height:${mm(frameHeight)}"><div style="height:${inner}"><img src="${escapeHtml(src)}" alt=""></div></td></tr>`;
};

const caseHeaderTable = (formData) => {
  const layout = LAYOUTS.left;
  return `<table class="doc-table">${colgroup(layout)}<tr>
${label("案由")}${value(formData.caseReason, { span: 2, lines: lineLimit("left", "caseReason") })}
${label("單位")}${value(formData.caseUnit, { span: 2, lines: lineLimit("left", "caseUnit") })}
</tr></table>`;
};

const criminalTable = (item, formData, src, frameHeight) => `<table class="doc-table">${colgroup(LAYOUTS.left)}
${photoRow(src, frameHeight)}
<tr>
<td class="doc-center">${escapeHtml(`編號(${item.number})`)}</td>
${label("照片日期")}${value(item.date, { span: 2 })}
${label("攝影人")}${value(formData.caseNumber, { align: "doc-center" })}
</tr>
<tr>${label("攝影地址")}${value(item.address, { span: 5 })}</tr>
<tr class="doc-description-row">${label("說明")}${value(item.description, { span: 5, align: "doc-justify", lines: lineLimit("left", "description") })}</tr>
</table>`;

const trafficTable = (item, src, frameHeight) => `<table class="doc-table">${colgroup(LAYOUTS.middle)}
${photoRow(src, frameHeight)}
<tr>
${label("攝影日期")}${value(item.date, { span: 2 })}
${label("照片編號")}${value(String(item.number), { span: 2, align: "doc-center" })}
</tr>
<tr class="doc-description-row">${label("說明")}${value(item.description, { span: 5, align: "doc-justify", lines: lineLimit("middle", "description") })}</tr>
</table>`;

/**
 * 產生一頁的 HTML（.doc-sheet，A4 大小，邊界已含在頁面內）。
 * imageSrc(item) 回傳照片網址；pageNumberText 為空字串時不印頁碼。
 */
export const buildSheetHtml = ({
  format,
  title,
  page,
  formData,
  imageSrc,
  pageNumberText = "",
  className = "",
}) => {
  const tables = page.items.map((item) =>
    format === "middle"
      ? trafficTable(item, imageSrc(item), page.frameHeight)
      : criminalTable(item, formData, imageSrc(item), page.frameHeight),
  );
  const header = LAYOUTS[format].hasCaseHeader ? caseHeaderTable(formData) : "";
  const [first = "", ...rest] = tables;
  const body = header + first + rest.map((table) => `<div class="doc-gap"></div>${table}`).join("");
  return `<div class="doc-sheet ${className}">
<h1 class="doc-title">${escapeHtml(title)}</h1>
<div class="doc-body">${body}</div>
${pageNumberText ? `<div class="doc-page-number">${escapeHtml(pageNumberText)}</div>` : ""}
</div>`;
};
