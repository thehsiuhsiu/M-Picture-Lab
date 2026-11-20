// lineLimitCheck.js - 列印與 PDF 檔案輸出前檢查行數上限；超過時擋下並帶使用者去修改
// （Word 不擋，見 docs/adr/0005-shared-layout-spec.md）

import { state } from "./state.js?v=20261121-4";
import { showDialog } from "./utils.js?v=20261121-4";
import { handleViewModeChange } from "./imageHandler.js?v=20261121-4";
import {
  describeImages,
  describeViolation,
  findLineLimitViolations,
  isLayoutFormat,
  readFormData,
} from "./documentLayout.js?v=20261121-4";

const CASE_INPUT_IDS = Object.freeze({
  caseReason: "zipPrefix",
  caseUnit: "caseUni",
  photographer: "caseNumber",
  address: "caseAddress",
  date: "caseDate",
});

const IMAGE_FIELD_SELECTORS = Object.freeze({
  date: ".image-date-input",
  address: ".image-address-input",
  description: "[data-line-field='description']:not([hidden])",
});

const focusField = (violation) => {
  let target = null;
  if (violation.source === "case") {
    const card = document.getElementById("caseCard");
    if (card?.classList.contains("is-collapsed")) document.getElementById("caseCardToggle")?.click();
    target = document.getElementById(CASE_INPUT_IDS[violation.field]);
  } else {
    if (state.viewMode !== "list") handleViewModeChange("list");
    const container = document.querySelector(`.image-container[data-id="${violation.imageId}"]`);
    const candidates = container?.querySelectorAll(IMAGE_FIELD_SELECTORS[violation.field]) || [];
    target =
      [...candidates].find((element) => element.offsetParent !== null) || candidates[0] || null;
  }
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = target.matches("input, textarea") ? target : target.querySelector("input");
  window.setTimeout(() => focusable?.focus({ preventScroll: true }), 300);
};

/** 可以列印或產生 PDF 時回傳 true；有文字超過行數上限時擋下並帶去修改 */
export const ensureWithinLineLimits = async () => {
  const format = state.selectedFormat;
  if (!isLayoutFormat(format)) return true;
  const formData = readFormData();
  const violations = findLineLimitViolations(format, describeImages(format, formData), formData);
  if (!violations.length) return true;
  const goFix = await showDialog({
    title: "有文字超過行數上限",
    message: "列印與 PDF 檔案的版面固定，請先精簡下列文字再輸出。（Word 可照樣輸出。）",
    details: violations.map(describeViolation),
    tone: "warning",
    confirmText: "前往修改",
    cancelText: "取消",
  });
  if (goFix) focusField(violations[0]);
  return false;
};
