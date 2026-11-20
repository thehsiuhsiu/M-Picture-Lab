// lineLimitHints.js - 欄位下方的行數提示：超過行數上限時變橘色（見 docs/adr/0005-shared-layout-spec.md）

import { state } from "./state.js?v=20261121-6";
import { PROJECT_CHANGED_EVENT } from "./projectEvents.js?v=20261121-6";
import {
  fieldLines,
  lineLimit,
  generateAccidentTagsText,
} from "./documentLayout.js?v=20261121-6";

// 案件資料欄位：輸入框 id → 欄位與適用版型
const CASE_FIELDS = Object.freeze({
  zipPrefix: { field: "caseReason", formats: "left" },
  caseUni: { field: "caseUnit", formats: "left" },
  caseNumber: { field: "photographer", formats: "left" },
  caseAddress: { field: "address", formats: "left" },
  caseDate: { field: "date", formats: "left middle" },
});

const SELECTOR = `[data-line-field], ${Object.keys(CASE_FIELDS)
  .map((id) => `#${id}`)
  .join(", ")}`;

const describeTarget = (element) => {
  const caseField = CASE_FIELDS[element.id];
  if (caseField) return { ...caseField, text: element.value };
  const { lineField: field, lineFormats: formats = "", imageId } = element.dataset;
  const text =
    element.dataset.lineSource === "accident-tags"
      ? generateAccidentTagsText(state.imageAccidentTags[imageId] || {})
      : element.value;
  return { field, formats, text };
};

/**
 * 提示掛在欄位上框線的右側，不佔版面空間、不蓋住文字，出現或消失時不會讓網頁排版跳動。
 * 欄位外包一層 .line-limit-field（平常 display: contents，不影響排版）。
 */
const getHint = (element) => {
  const anchor = element.closest(".date-field") || element;
  let field = anchor.parentElement;
  if (!field?.classList.contains("line-limit-field")) {
    field = document.createElement("span");
    field.className = "line-limit-field";
    anchor.before(field);
    field.appendChild(anchor);
  }
  let hint = field.querySelector(":scope > .line-limit-hint");
  if (!hint) {
    hint = document.createElement("span");
    hint.className = "line-limit-hint";
    hint.setAttribute("aria-live", "polite");
    hint.hidden = true;
    field.appendChild(hint);
  }
  return hint;
};

/** 更新一個欄位的提示 */
export const updateLineHint = (element) => {
  if (!(element instanceof Element)) return;
  const { field, formats, text } = describeTarget(element);
  const format = state.selectedFormat;
  const hint = getHint(element);
  const applies = Boolean(field) && formats.split(" ").includes(format);
  const lines = applies ? fieldLines(format, field, text) : 0;
  const limit = lineLimit(format, field);
  const over = lines > limit;
  // 說明一律顯示行數；其他欄位只有超過時才提示
  const showCount = field === "description" && format === "left" && lines > 0;
  const visible = over || showCount;
  hint.hidden = !visible;
  hint.parentElement.classList.toggle("is-active", visible);
  hint.classList.toggle("is-over", over);
  element.classList.toggle("is-over-line-limit", over);
  hint.textContent = `約 ${lines} 行／上限 ${limit} 行`;
  hint.title = over ? "超過行數上限，列印與 PDF 檔案需先精簡；Word 可照樣輸出" : "";
};

export const refreshAllLineHints = () => {
  document.querySelectorAll(SELECTOR).forEach(updateLineHint);
};

let initialized = false;

export const initLineLimitHints = () => {
  if (initialized) return;
  initialized = true;
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches(SELECTOR)) updateLineHint(target);
    // 「其他」的文字會影響交通事故說明的長度
    if (target.matches(".accident-tag-other-input")) {
      target
        .closest(".image-container")
        ?.querySelectorAll("[data-line-source='accident-tags']")
        .forEach(updateLineHint);
    }
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches(".accident-tag-checkbox")) {
      target
        .closest(".image-container")
        ?.querySelectorAll("[data-line-source='accident-tags']")
        .forEach(updateLineHint);
    }
  });
  // 切換版型時欄寬不同，全部重新計算
  new MutationObserver(refreshAllLineHints).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  document.addEventListener(PROJECT_CHANGED_EVENT, refreshAllLineHints);
  refreshAllLineHints();
};
