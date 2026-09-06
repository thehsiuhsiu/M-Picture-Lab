import { state, ACCIDENT_TAG_OPTIONS, FORMAT_TITLES } from "./state.js";
import { PROJECT_CHANGED_EVENT } from "./projectEvents.js";
import {
  getMultiPhotoPageEntries,
  getMultiPhotoSettings,
} from "./multiPhotoLayout.js";
import { getPhotoNumber } from "./photoNumbering.js";
import {
  getPdfPageNumber,
  getPdfPageNumberSettings,
} from "./pageNumbering.js";

const PREVIEW_UPDATE_DELAY_MS = 220;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1;
const ZOOM_STEP = 0.05;

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
let zoom = 0.75;
let updateTimer = null;
let renderToken = 0;
let initialized = false;

const createElement = (tagName, className, text) => {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
};

const getValue = (id) => document.getElementById(id)?.value || "";

const getPageSize = () =>
  state.selectedFormat === "right" ? getMultiPhotoSettings().count : 2;

const getPageCount = () =>
  Math.ceil(state.selectedImages.length / getPageSize());

const getDateText = (image) => {
  const customDate = state.imageDates[image.id] || "";
  const manualDate = getValue("caseDate");
  const useExif = Boolean(document.getElementById("dateModeSwitch")?.checked);
  return customDate || (useExif ? image.date || manualDate : manualDate);
};

const createCell = ({
  text = "",
  className = "",
  colSpan = 1,
  overflowCheck = false,
} = {}) => {
  const cell = createElement("td", className);
  cell.colSpan = colSpan;
  if (overflowCheck) {
    const content = createElement("div", "document-cell-content", text);
    content.dataset.overflowCheck = "true";
    cell.appendChild(content);
  } else {
    cell.textContent = String(text);
  }
  return cell;
};

const appendRow = (table, cells, className = "") => {
  const row = createElement("tr", className);
  cells.forEach((cell) => row.appendChild(cell));
  table.appendChild(row);
  return row;
};

const createTable = () => {
  const table = createElement("table", "document-table");
  const colgroup = document.createElement("colgroup");
  [15, 15, 17.5, 17.5, 15, 20].forEach((width) => {
    const column = document.createElement("col");
    column.style.width = `${width}%`;
    colgroup.appendChild(column);
  });
  table.appendChild(colgroup);
  return table;
};

const createPhotoRow = (table, image) => {
  const photoCell = createCell({ className: "document-photo-cell", colSpan: 6 });
  const photo = createElement("img", "document-photo");
  photo.src = image.previewUrl;
  photo.alt = image.name || "照片";
  photo.loading = "eager";
  photo.draggable = false;
  photoCell.appendChild(photo);
  appendRow(table, [photoCell], "document-photo-row");
};

const createCriminalHeader = () => {
  const table = createTable();
  table.classList.add("document-header-table");
  appendRow(table, [
    createCell({ text: "案由", className: "document-label-cell" }),
    createCell({
      text: getValue("zipPrefix"),
      className: "document-value-cell document-center-cell",
      colSpan: 2,
      overflowCheck: true,
    }),
    createCell({ text: "單位", className: "document-label-cell" }),
    createCell({
      text: getValue("caseUni"),
      className: "document-value-cell document-center-cell",
      colSpan: 2,
      overflowCheck: true,
    }),
  ]);
  return table;
};

const createCriminalPhotoTable = (image, number) => {
  const table = createTable();
  createPhotoRow(table, image);

  appendRow(table, [
    createCell({ text: `編號(${number})`, className: "document-label-cell" }),
    createCell({ text: "照片日期", className: "document-label-cell" }),
    createCell({
      text: getDateText(image),
      className: "document-value-cell",
      colSpan: 2,
      overflowCheck: true,
    }),
    createCell({ text: "攝影人", className: "document-label-cell" }),
    createCell({
      text: getValue("caseNumber"),
      className: "document-value-cell document-center-cell",
      overflowCheck: true,
    }),
  ], "document-meta-row");

  appendRow(table, [
    createCell({ text: "攝影地址", className: "document-label-cell" }),
    createCell({
      text: state.imageAddresses[image.id] || getValue("caseAddress"),
      className: "document-value-cell",
      colSpan: 5,
      overflowCheck: true,
    }),
  ], "document-text-row");

  appendRow(table, [
    createCell({ text: "說明", className: "document-label-cell" }),
    createCell({
      text: state.imageDescriptions[image.id] || "",
      className: "document-value-cell",
      colSpan: 5,
      overflowCheck: true,
    }),
  ], "document-text-row");

  return table;
};

const getAccidentTagsText = (image) => {
  const tags = state.imageAccidentTags[image.id] || {};
  return ACCIDENT_TAG_OPTIONS.map((option) => {
    const checked = Boolean(tags[option.id]);
    const box = checked ? "■" : "□";
    if (option.id === "other") {
      return `${box}其他:${checked && tags.otherText ? tags.otherText : "___________"}`;
    }
    return `${box}${option.label}`;
  }).join(" ");
};

const createTrafficPhotoTable = (image, number) => {
  const table = createTable();
  createPhotoRow(table, image);
  appendRow(table, [
    createCell({ text: "攝影日期", className: "document-label-cell" }),
    createCell({
      text: getDateText(image),
      className: "document-value-cell",
      colSpan: 2,
      overflowCheck: true,
    }),
    createCell({ text: "照片編號", className: "document-label-cell" }),
    createCell({
      text: number,
      className: "document-value-cell document-center-cell",
      colSpan: 2,
    }),
  ], "document-meta-row");
  appendRow(table, [
    createCell({ text: "說明", className: "document-label-cell" }),
    createCell({
      text: getAccidentTagsText(image),
      className: "document-value-cell",
      colSpan: 5,
      overflowCheck: true,
    }),
  ], "document-traffic-text-row");
  return table;
};

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
  photo.src = entry.image.previewUrl;
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
        cell.title = "內容過長，正式輸出可能換行或影響版面";
      } else {
        cell.removeAttribute("title");
      }
    });
    if (warning) {
      warning.hidden = overflowCount === 0;
      warning.textContent = overflowCount
        ? `本頁有 ${overflowCount} 個欄位內容過長，正式輸出前請確認版面。`
        : "";
    }
  });
};

const renderPreview = () => {
  if (state.viewMode !== "preview") return;
  const stage = document.getElementById("documentPreviewStage");
  if (!stage) return;

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

  const title =
    state.customDocTitles[state.selectedFormat] ||
    FORMAT_TITLES[state.selectedFormat] ||
    "照片黏貼表";
  const heading = createElement("h1", "document-page-title", title);
  heading.dataset.overflowCheck = "true";
  page.appendChild(heading);

  if (state.selectedFormat === "left") {
    page.appendChild(createCriminalHeader());
  }

  const pageSize = getPageSize();
  const firstIndex = currentPage * pageSize;
  if (state.selectedFormat === "right") {
    page.appendChild(createMultiPhotoGrid(firstIndex));
  } else {
    state.selectedImages
      .slice(firstIndex, firstIndex + pageSize)
      .forEach((image, index) => {
        if (index > 0) {
          page.appendChild(createElement("div", "document-table-spacer"));
        }
        page.appendChild(
          state.selectedFormat === "left"
            ? createCriminalPhotoTable(image, getPhotoNumber(firstIndex + index))
            : createTrafficPhotoTable(image, getPhotoNumber(firstIndex + index)),
        );
      });
  }

  const pageNumberSettings = getPdfPageNumberSettings();
  if (pageNumberSettings.enabled) {
    page.appendChild(
      createElement(
        "div",
        "document-page-number",
        `第 ${getPdfPageNumber(currentPage, pageNumberSettings.startNumber)} 頁`,
      ),
    );
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
