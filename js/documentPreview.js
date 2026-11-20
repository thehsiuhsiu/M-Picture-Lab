import { state, FORMAT_TITLES } from "./state.js?v=20261121-5";
import { PROJECT_CHANGED_EVENT } from "./projectEvents.js?v=20261121-5";
import {
  getMultiPhotoPageEntries,
  getMultiPhotoSettings,
} from "./multiPhotoLayout.js?v=20261121-5";
import {
  buildSheetCss,
  buildSheetHtml,
  describeImages,
  getDocumentTitle,
  isLayoutFormat,
  planPages,
  readFormData,
} from "./documentLayout.js?v=20261121-5";
import {
  getPdfPageNumber,
  getPdfPageNumberSettings,
} from "./pageNumbering.js?v=20261121-5";

const PREVIEW_UPDATE_DELAY_MS = 220;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1;
const ZOOM_STEP = 0.05;
const DEFAULT_ZOOM = 0.75;
const A4_PAGE_WIDTH_PX = 794;

const FONT_CLASS_BY_VALUE = Object.freeze({
  kai: "font-preview-kai",
  "noto-serif-tc": "font-preview-noto-serif",
  "noto-sans-tc": "font-preview-noto-sans",
  "jf-openhuninn": "font-preview-jf-openhuninn",
  iansui: "font-preview-iansui",
  "gen-ryumin": "font-preview-gen-ryumin",
  "chen-yuluoyan": "font-preview-chen-yuluoyan",
});

let currentPage = 0;
let zoom = DEFAULT_ZOOM;
// 使用者按過縮放按鈕後就保留其設定；否則依預覽區寬度自動縮放，避免手機上頁面被裁切。
let userAdjustedZoom = false;
let updateTimer = null;
let renderToken = 0;
let initialized = false;

const createElement = (tagName, className, text) => {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
};

const getPageSize = () =>
  state.selectedFormat === "right" ? getMultiPhotoSettings().count : 2;

const getPageCount = () =>
  Math.ceil(state.selectedImages.length / getPageSize());

const createMultiPhotoCell = (entry) => {
  const cell = createElement(
    "section",
    `document-multi-cell${entry ? "" : " document-multi-cell-empty"}`,
  );
  if (!entry) {
    cell.setAttribute("aria-hidden", "true");
    return cell;
  }

  const photoArea = createElement("div", "document-multi-photo-area");
  const photo = createElement("img", "document-multi-photo");
  photo.src = entry.image.annotatedPreviewUrl || entry.image.previewUrl;
  photo.alt = entry.image.name || `照片 ${entry.number}`;
  photo.loading = "eager";
  photo.draggable = false;
  photoArea.appendChild(photo);

  const caption = createElement("div", "document-multi-caption");
  caption.appendChild(
    createElement("span", "document-multi-number", `編號(${entry.number})`),
  );
  const description = createElement(
    "span",
    "document-multi-description",
    state.imageDescriptions[entry.image.id] || "",
  );
  description.dataset.overflowCheck = "true";
  caption.appendChild(description);
  cell.append(photoArea, caption);
  return cell;
};

const createMultiPhotoGrid = (firstIndex) => {
  const { count, order } = getMultiPhotoSettings();
  const entries = getMultiPhotoPageEntries(
    state.selectedImages,
    firstIndex,
    count,
    order,
  );
  const grid = createElement(
    "div",
    `document-multi-grid document-multi-grid-${count}`,
  );
  entries.forEach((entry) => {
    grid.appendChild(createMultiPhotoCell(entry));
  });
  return grid;
};

const updateControls = (pageCount) => {
  const status = document.getElementById("documentPageStatus");
  const previousButton = document.getElementById("documentPrevPageBtn");
  const nextButton = document.getElementById("documentNextPageBtn");
  const zoomStatus = document.getElementById("documentZoomStatus");
  const zoomOutButton = document.getElementById("documentZoomOutBtn");
  const zoomInButton = document.getElementById("documentZoomInBtn");

  if (status) status.textContent = `第 ${pageCount ? currentPage + 1 : 0} / ${pageCount} 頁`;
  if (previousButton) previousButton.disabled = !pageCount || currentPage === 0;
  if (nextButton) nextButton.disabled = !pageCount || currentPage >= pageCount - 1;
  if (zoomStatus) zoomStatus.textContent = `${Math.round(zoom * 100)}%`;
  if (zoomOutButton) zoomOutButton.disabled = zoom <= MIN_ZOOM;
  if (zoomInButton) zoomInButton.disabled = zoom >= MAX_ZOOM;
};

const detectOverflow = (token) => {
  requestAnimationFrame(() => {
    if (token !== renderToken || state.viewMode !== "preview") return;
    const warning = document.getElementById("documentPreviewWarning");
    const cells = Array.from(
      document.querySelectorAll("#documentPreviewStage [data-overflow-check]"),
    );
    let overflowCount = 0;
    cells.forEach((cell) => {
      const hasOverflow =
        cell.scrollHeight > cell.clientHeight + 1 ||
        cell.scrollWidth > cell.clientWidth + 1;
      cell.classList.toggle("has-overflow", hasOverflow);
      if (hasOverflow) {
        overflowCount += 1;
        cell.title = "超過行數上限";
      } else {
        cell.removeAttribute("title");
      }
    });
    if (warning) {
      warning.hidden = overflowCount === 0;
      warning.textContent = overflowCount
        ? `本頁有 ${overflowCount} 個欄位超過行數上限；列印與 PDF 檔案需先修改，Word 可照樣輸出。`
        : "";
    }
  });
};

const getFitZoom = (stage) => {
  const styles = getComputedStyle(stage);
  const available =
    stage.clientWidth -
    (parseFloat(styles.paddingLeft) || 0) -
    (parseFloat(styles.paddingRight) || 0);
  if (!(available > 0)) return DEFAULT_ZOOM;
  const fit = Math.floor((available / A4_PAGE_WIDTH_PX) * 100) / 100;
  return Math.min(DEFAULT_ZOOM, Math.max(MIN_ZOOM, fit));
};

const applyAutoZoom = (stage) => {
  if (userAdjustedZoom || !stage) return false;
  const nextZoom = getFitZoom(stage);
  if (nextZoom === zoom) return false;
  zoom = nextZoom;
  stage.style.setProperty("--document-preview-zoom", String(zoom));
  return true;
};

/** 版面規格的樣式只需要加一次 */
const ensureSheetStyles = () => {
  if (document.getElementById("documentSheetStyles")) return;
  const style = document.createElement("style");
  style.id = "documentSheetStyles";
  style.textContent = `${buildSheetCss(".document-page-sheet .doc-sheet")}
.document-page.document-page-sheet { padding: 0; }`;
  document.head.appendChild(style);
};

const renderPreview = () => {
  if (state.viewMode !== "preview") return;
  const stage = document.getElementById("documentPreviewStage");
  if (!stage) return;
  applyAutoZoom(stage);

  const token = ++renderToken;
  const pageCount = getPageCount();
  currentPage = Math.max(0, Math.min(currentPage, Math.max(0, pageCount - 1)));
  stage.style.setProperty("--document-preview-zoom", String(zoom));
  stage.replaceChildren();
  updateControls(pageCount);

  if (!pageCount) {
    const empty = createElement("div", "document-preview-empty");
    empty.appendChild(createElement("span", "material-symbols-outlined", "preview"));
    empty.appendChild(createElement("strong", "", "尚無可預覽的照片"));
    empty.appendChild(createElement("span", "", "新增照片後，這裡會顯示 A4 文件版面。"));
    stage.appendChild(empty);
    const warning = document.getElementById("documentPreviewWarning");
    if (warning) warning.hidden = true;
    return;
  }

  const page = createElement("article", "document-page");
  page.classList.add(`document-page-${state.selectedFormat}`);
  const fontValue = document.getElementById("pdfFontSelect")?.value || "kai";
  page.classList.add(FONT_CLASS_BY_VALUE[fontValue] || "font-preview-kai");
  page.setAttribute("aria-label", `文件第 ${currentPage + 1} 頁`);

  const pageNumberSettings = getPdfPageNumberSettings();
  const pageNumberText = pageNumberSettings.enabled
    ? `第 ${getPdfPageNumber(currentPage, pageNumberSettings.startNumber)} 頁`
    : "";

  if (isLayoutFormat(state.selectedFormat)) {
    // 刑事案件、交通事故：與列印、PDF 檔案、Word 用同一份版面規格
    ensureSheetStyles();
    const format = state.selectedFormat;
    const formData = readFormData();
    const pages = planPages(format, describeImages(format, formData), formData);
    page.classList.add("document-page-sheet");
    page.innerHTML = buildSheetHtml({
      format,
      title: getDocumentTitle(format),
      page: pages[currentPage],
      formData,
      imageSrc: (item) => item.image.annotatedPreviewUrl || item.image.previewUrl,
      pageNumberText,
    });
    stage.appendChild(page);
    detectOverflow(token);
    return;
  }

  const title =
    state.customDocTitles[state.selectedFormat] ||
    FORMAT_TITLES[state.selectedFormat] ||
    "照片黏貼表";
  const heading = createElement("h1", "document-page-title", title);
  heading.dataset.overflowCheck = "true";
  page.appendChild(heading);

  page.appendChild(createMultiPhotoGrid(currentPage * getPageSize()));

  if (pageNumberText) {
    page.appendChild(createElement("div", "document-page-number", pageNumberText));
  }

  stage.appendChild(page);
  detectOverflow(token);
};

const scheduleRender = (delay = PREVIEW_UPDATE_DELAY_MS) => {
  if (state.viewMode !== "preview") return;
  clearTimeout(updateTimer);
  updateTimer = setTimeout(renderPreview, delay);
};

const changePage = (offset) => {
  const nextPage = currentPage + offset;
  if (nextPage < 0 || nextPage >= getPageCount()) return;
  currentPage = nextPage;
  renderPreview();
  document.getElementById("documentPreview")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
};

const changeZoom = (offset) => {
  userAdjustedZoom = true;
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((zoom + offset).toFixed(2))));
  renderPreview();
};

export const initDocumentPreview = () => {
  if (initialized) return;
  initialized = true;

  document.getElementById("documentPrevPageBtn")?.addEventListener("click", () =>
    changePage(-1),
  );
  document.getElementById("documentNextPageBtn")?.addEventListener("click", () =>
    changePage(1),
  );
  document.getElementById("documentZoomOutBtn")?.addEventListener("click", () =>
    changeZoom(-ZOOM_STEP),
  );
  document.getElementById("documentZoomInBtn")?.addEventListener("click", () =>
    changeZoom(ZOOM_STEP),
  );

  document.addEventListener(PROJECT_CHANGED_EVENT, () => scheduleRender(0));
  // 含標記的小圖產生完成時（例如開啟專案後）也要更新預覽
  document.addEventListener("mpicture:annotated-preview-updated", () => scheduleRender(0));

  const stage = document.getElementById("documentPreviewStage");
  if (stage && "ResizeObserver" in window) {
    // 縮放視窗時，自動縮放會改變預覽大小；放到下一個畫面再處理，避免 ResizeObserver 連鎖觸發
    let resizeFrame = 0;
    new ResizeObserver(() => {
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        if (state.viewMode !== "preview") return;
        if (applyAutoZoom(stage)) updateControls(getPageCount());
      });
    }).observe(stage);
  }
  document.addEventListener("input", (event) => {
    if (
      event.target instanceof Element &&
      event.target.matches(
        ".sidebar-input, .image-date-input, .image-address-input, .image-description-textarea, .accident-tag-other-input, #pdfPageStartNumber",
      )
    ) {
      scheduleRender();
    }
  });
  document.addEventListener("change", (event) => {
    if (
      event.target instanceof Element &&
      event.target.matches(
        "#dateModeSwitch, #pdfFontSelect, #pdfPageNumberEnabled, .accident-tag-checkbox, .multi-layout-input",
      )
    ) {
      scheduleRender(0);
    }
  });
};
