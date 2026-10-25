import { state, ACCIDENT_TAG_OPTIONS } from "./state.js?v=20261025-4";
import { IMAGE_SECURITY_LIMITS } from "./imageHandler.js?v=20261025-4";
import { PROJECT_CHANGED_EVENT } from "./projectEvents.js?v=20261025-4";
import {
  createObjectUrl,
  revokeObjectUrl,
  showDialog,
  showNotice,
  showPromptDialog,
  showToast,
} from "./utils.js?v=20261025-4";
import { normalizeAnnotations } from "./annotations.js?v=20261025-4";
import { normalizePhotoStartNumber } from "./photoNumbering.js?v=20261025-4";
import { normalizePdfPageStartNumber } from "./pageNumbering.js?v=20261025-4";

const DATABASE_NAME = "mpicture-local-projects-v1";
const DATABASE_VERSION = 3;
// 舊版（單一草稿、2 小時到期）資料表，只用於一次性轉換成專案。
const LEGACY_DRAFT_STORE = "drafts";
const LEGACY_DRAFT_IMAGE_STORE = "draftImages";
const LEGACY_DRAFT_ID = "active";
// 新版：多個專案，保存到使用者自行刪除。
const PROJECT_STORE = "projects";
const PROJECT_IMAGE_STORE = "projectImages";
const LAST_PROJECT_STORAGE_KEY = "mpictureLastProjectId";
const AUTOSAVE_DELAY_MS = 1000;
const MAX_PROJECT_NAME_LENGTH = 80;

const PROJECT_FORMAT = "m-picture-project";
const PROJECT_VERSION = 7;
const SUPPORTED_PROJECT_VERSIONS = new Set([1, 2, 3, 4, 5, 6, PROJECT_VERSION]);
const PROJECT_MAGIC = new Uint8Array([
  0x4d, 0x50, 0x49, 0x43, 0x54, 0x55, 0x52, 0x45,
]);
const PROJECT_HEADER_BYTES = 44;
const PROJECT_FLAG_ENCRYPTED = 1;
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_PER_SPLIT = 100;
const MAX_PROJECT_BYTES = IMAGE_SECURITY_LIMITS.maxTotalBytes + 16 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const MAX_PASSWORD_BYTES = 256;

const FIELD_LIMITS = Object.freeze({
  docTitleLeft: 120,
  docTitleMiddle: 120,
  docTitleRight: 120,
  zipPrefix: 200,
  caseUni: 200,
  caseDate: 80,
  caseAddress: 500,
  caseNumber: 200,
  imageName: 255,
  imageDate: 80,
  imageAddress: 500,
  imageDescription: 5000,
  otherText: 500,
  sourceFileName: 255,
  importId: 120,
});

const SAFE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/avif",
]);

const SAFE_FORMATS = new Set(["left", "middle", "right"]);
const SAFE_VIEW_MODES = new Set(["grid", "list", "preview"]);
const SAFE_MULTI_PHOTO_COUNTS = new Set([2, 4]);
const SAFE_MULTI_PHOTO_ORDERS = new Set(["horizontal", "vertical"]);
const SAFE_PDF_FONTS = new Set([
  "kai",
  "noto-serif-tc",
  "noto-sans-tc",
  "jf-openhuninn",
  "iansui",
  "gen-ryumin",
  "chen-yuluoyan",
]);
const SAFE_ROTATIONS = new Set([0, 90, 180, 270]);
const ACCIDENT_TAG_IDS = new Set(ACCIDENT_TAG_OPTIONS.map((option) => option.id));

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

let databasePromise = null;
let autosaveTimer = null;
let saveInProgress = false;
let activeSave = Promise.resolve();
let saveRequestedWhileBusy = false;
let persistenceSuspended = true;
let dirty = false;
let persistRequested = false;
let applyProjectSnapshot = null;
let persistenceInitialized = false;
let localDraftStorageAvailable = true;

// 目前開啟的專案。isStored 為 false 表示還沒有內容、尚未寫進清單。
let currentProject = null;
// 照片 Blob → 資料庫鍵值；同一張照片重複儲存時不必再寫一次。
let blobStorageKeys = new WeakMap();
let persistedImageKeys = new Set();
let projectIndex = [];

const getElementValue = (id) => document.getElementById(id)?.value || "";

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const requirePlainObject = (value, label) => {
  if (!isPlainObject(value)) {
    throw new Error(`${label}格式無效`);
  }
  return value;
};

const assertOnlyKeys = (value, allowedKeys, label) => {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${label}包含未知欄位`);
  }
};

const requireString = (value, maxLength, label) => {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${label}格式無效或超過長度限制`);
  }
  return value;
};

const requireBoolean = (value, label) => {
  if (typeof value !== "boolean") throw new Error(`${label}格式無效`);
  return value;
};

const requireInteger = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label}超出安全範圍`);
  }
  return value;
};

const requireEnum = (value, allowed, label) => {
  if (!allowed.has(value)) throw new Error(`${label}不是支援的值`);
  return value;
};

const sanitizeFileName = (value, fallback = "M-Picture專案") => {
  const safeName = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, FIELD_LIMITS.imageName);
  return safeName || fallback;
};

const bytesEqual = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const concatBytes = (...arrays) => {
  const length = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  arrays.forEach((array) => {
    result.set(array, offset);
    offset += array.length;
  });
  return result;
};

const uint32Bytes = (value) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
};

const readUint32 = (bytes, offset) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    false,
  );

const readBlobBytes = async (blob, start, length) => {
  if (start < 0 || length < 0 || start + length > blob.size) {
    throw new Error("專案檔長度不正確");
  }
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
};

const openDatabase = () => {
  if (!window.indexedDB) {
    return Promise.reject(new Error("此瀏覽器不支援本機專案儲存"));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(PROJECT_IMAGE_STORE)) {
        const imageStore = database.createObjectStore(PROJECT_IMAGE_STORE, {
          keyPath: "key",
        });
        imageStore.createIndex("projectId", "projectId", { unique: false });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error("無法開啟專案資料庫"));
    request.onblocked = () => reject(new Error("專案資料庫正被其他分頁占用"));
  });

  return databasePromise;
};

/** 在同一個交易中執行 work(stores)，交易完成後回傳 work 的結果。 */
const runTransaction = async (storeNames, mode, work) => {
  const database = await openDatabase();
  const names = storeNames.filter((name) => database.objectStoreNames.contains(name));
  if (!names.length) return undefined;
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction(names, mode);
    const stores = Object.fromEntries(
      names.map((name) => [name, transaction.objectStore(name)]),
    );
    let result;
    try {
      result = work(stores);
    } catch (error) {
      reject(error);
      try {
        transaction.abort();
      } catch (_abortError) {
        // 交易可能已自行結束
      }
      return;
    }
    transaction.oncomplete = () =>
      resolve(typeof result === "function" ? result() : result);
    transaction.onerror = () =>
      reject(transaction.error || new Error("專案資料庫操作失敗"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("專案資料庫交易已中止"));
  });
};

const requestToCollector = (request) => {
  let value;
  request.onsuccess = () => {
    value = request.result;
  };
  return () => value;
};

const listProjectRecords = () =>
  runTransaction([PROJECT_STORE], "readonly", (stores) =>
    requestToCollector(stores[PROJECT_STORE].getAll()),
  ).then((records) => (Array.isArray(records) ? records : []));

const getProjectRecord = (id) =>
  runTransaction([PROJECT_STORE], "readonly", (stores) =>
    requestToCollector(stores[PROJECT_STORE].get(id)),
  );

const getProjectImages = (keys) =>
  runTransaction([PROJECT_IMAGE_STORE], "readonly", (stores) => {
    const results = new Map();
    keys.forEach((key) => {
      const request = stores[PROJECT_IMAGE_STORE].get(key);
      request.onsuccess = () => results.set(key, request.result);
    });
    return results;
  });

const updateProjectRecord = (id, changes) =>
  runTransaction([PROJECT_STORE], "readwrite", (stores) => {
    const store = stores[PROJECT_STORE];
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, ...changes });
    };
  });

const deleteProjectData = (id) =>
  runTransaction([PROJECT_STORE, PROJECT_IMAGE_STORE], "readwrite", (stores) => {
    stores[PROJECT_STORE].delete(id);
    const index = stores[PROJECT_IMAGE_STORE].index("projectId");
    const cursorRequest = index.openKeyCursor(IDBKeyRange.only(id));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      stores[PROJECT_IMAGE_STORE].delete(cursor.primaryKey);
      cursor.continue();
    };
  });

const createProjectId = () =>
  crypto?.randomUUID?.() ||
  `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const createImageKey = (projectId) =>
  `${projectId}:${crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;

const FORMAT_LABELS = Object.freeze({
  left: "刑事案件",
  middle: "交通事故",
  right: "多格照片",
});

const formatShortDate = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const buildAutoProjectName = (project, createdAt) => {
  const caseName = String(project.fields?.zipPrefix || "").trim();
  if (caseName) return caseName.slice(0, MAX_PROJECT_NAME_LENGTH);
  const label = FORMAT_LABELS[project.settings?.selectedFormat] || "照片";
  return `${label} ${formatShortDate(createdAt)}`.trim();
};

const getDisplayName = (meta) =>
  (meta?.customName || meta?.autoName || "").trim() || "未命名專案";

const putProjectRecord = async (project) => {
  const meta = currentProject;
  const imageKeys = state.selectedImages.map((image) => {
    let key = blobStorageKeys.get(image.blob);
    if (!key || !key.startsWith(`${meta.id}:`)) {
      key = createImageKey(meta.id);
      blobStorageKeys.set(image.blob, key);
    }
    return key;
  });
  if (new Set(imageKeys).size !== imageKeys.length) {
    throw new Error("照片識別碼重複，無法安全儲存專案");
  }
  const projectWithoutBlobs = {
    ...project,
    images: project.images.map(({ blob, ...metadata }) => metadata),
  };
  const autoName = buildAutoProjectName(project, meta.createdAt);
  const record = {
    id: meta.id,
    customName: meta.customName || "",
    autoName,
    pinned: Boolean(meta.pinned),
    createdAt: meta.createdAt,
    updatedAt: project.savedAt,
    imageCount: imageKeys.length,
    imageKeys,
    project: projectWithoutBlobs,
  };
  const nextKeys = new Set(imageKeys);

  // iPhone／iPad 的 WebKit 存進 IndexedDB 的 Blob 之後可能讀回空檔，
  // 因此照片一律以原始位元組（ArrayBuffer）儲存，讀取時再組回 Blob。
  const newImageData = [];
  for (let index = 0; index < state.selectedImages.length; index += 1) {
    const key = imageKeys[index];
    if (persistedImageKeys.has(key)) continue;
    const blob = state.selectedImages[index].blob;
    const bytes = await blob.arrayBuffer();
    if (!bytes.byteLength) throw new Error("照片資料讀取失敗，無法儲存專案");
    newImageData.push({ key, projectId: meta.id, type: blob.type, bytes });
  }

  await runTransaction([PROJECT_STORE, PROJECT_IMAGE_STORE], "readwrite", (stores) => {
    stores[PROJECT_STORE].put(record);
    newImageData.forEach((entry) => stores[PROJECT_IMAGE_STORE].put(entry));
    persistedImageKeys.forEach((key) => {
      if (!nextKeys.has(key)) stores[PROJECT_IMAGE_STORE].delete(key);
    });
  });

  // 儲存期間若已切換到別的專案，就不要改動新專案的狀態
  if (currentProject !== meta) return;
  persistedImageKeys = nextKeys;
  meta.autoName = autoName;
  meta.isStored = true;
  try {
    localStorage.setItem(LAST_PROJECT_STORAGE_KEY, meta.id);
  } catch (_error) {
    // 瀏覽器不允許時只是不記住上次開啟的專案
  }
};

const normalizeAccidentTags = (value) => {
  const source = requirePlainObject(value || {}, "事故照片標籤");
  const result = {};
  for (const [key, tagValue] of Object.entries(source)) {
    if (key === "otherText") {
      result.otherText = requireString(
        tagValue,
        FIELD_LIMITS.otherText,
        "其他事故說明",
      );
      continue;
    }
    if (!ACCIDENT_TAG_IDS.has(key)) throw new Error("事故照片標籤包含未知欄位");
    result[key] = requireBoolean(tagValue, "事故照片標籤");
  }
  return result;
};

const detectImageType = (bytes) => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytesEqual(bytes.slice(0, 8), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  const ascii = String.fromCharCode(...bytes.slice(0, 16));
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  if (ascii.startsWith("BM")) return "image/bmp";
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a))
  ) {
    return "image/tiff";
  }
  if (ascii.slice(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii.slice(8, 12))) {
    return "image/avif";
  }
  return null;
};

const validateImageBlob = async (blob, declaredType) => {
  if (!(blob instanceof Blob)) throw new Error("圖片內容不是有效的二進位資料");
  if (!blob.size) throw new Error("照片資料讀取失敗（內容是空的）");
  if (blob.size > IMAGE_SECURITY_LIMITS.maxFileBytes) {
    throw new Error("圖片大小超過安全限制");
  }
  const safeDeclaredType = requireEnum(declaredType, SAFE_IMAGE_TYPES, "圖片類型");
  const signatureType = detectImageType(
    new Uint8Array(await blob.slice(0, 16).arrayBuffer()),
  );
  if (!signatureType || signatureType !== safeDeclaredType) {
    throw new Error("圖片內容與宣告格式不一致");
  }
};

const normalizeImageMetadata = (rawImage, index, sourceVersion) => {
  const image = requirePlainObject(rawImage, `第 ${index + 1} 張圖片`);
  const dateKeys =
    sourceVersion === 1 ? ["date"] : ["exifDate", "customDate"];
  assertOnlyKeys(
    image,
    new Set([
      "name",
      "type",
      "size",
      "width",
      "height",
      ...dateKeys,
      "address",
      "description",
      "accidentTags",
      "rotation",
      "importBatchId",
      "originalImportIndex",
      "splitGroupId",
      "splitPartIndex",
      "splitPartCount",
      "sourceFileName",
      "annotations",
      "blob",
    ]),
    `第 ${index + 1} 張圖片`,
  );
  const type = requireEnum(image.type, SAFE_IMAGE_TYPES, "圖片類型");
  const size = requireInteger(
    image.size,
    1,
    IMAGE_SECURITY_LIMITS.maxFileBytes,
    "圖片大小",
  );
  const width = requireInteger(
    image.width,
    1,
    IMAGE_SECURITY_LIMITS.maxDimension,
    "圖片寬度",
  );
  const height = requireInteger(
    image.height,
    1,
    IMAGE_SECURITY_LIMITS.maxDimension,
    "圖片高度",
  );
  if (width * height > IMAGE_SECURITY_LIMITS.maxPixels) {
    throw new Error("圖片像素數超過安全限制");
  }

  const exifDate = requireString(
    sourceVersion === 1 ? image.date || "" : image.exifDate || "",
    FIELD_LIMITS.imageDate,
    "照片 EXIF 日期",
  );
  const customDate =
    sourceVersion === 1
      ? ""
      : requireString(
          image.customDate || "",
          FIELD_LIMITS.imageDate,
          "照片自訂日期",
        );

  const importBatchId = requireString(
    image.importBatchId || "",
    FIELD_LIMITS.importId,
    "照片匯入批次",
  );
  const splitGroupId = requireString(
    image.splitGroupId || "",
    FIELD_LIMITS.importId,
    "長截圖群組",
  );
  const originalImportIndex = importBatchId
    ? requireInteger(image.originalImportIndex ?? index, 0, IMAGE_SECURITY_LIMITS.maxCount, "原始匯入順序")
    : null;
  const splitPartIndex = splitGroupId
    ? requireInteger(image.splitPartIndex, 1, MAX_OUTPUT_PER_SPLIT, "長截圖分段順序")
    : null;
  const splitPartCount = splitGroupId
    ? requireInteger(image.splitPartCount, 1, MAX_OUTPUT_PER_SPLIT, "長截圖分段總數")
    : null;

  return {
    name: sanitizeFileName(
      requireString(image.name, FIELD_LIMITS.imageName, "圖片名稱"),
      `photo-${index + 1}`,
    ),
    type,
    size,
    width,
    height,
    exifDate,
    customDate,
    address: requireString(
      image.address || "",
      FIELD_LIMITS.imageAddress,
      "圖片地址",
    ),
    description: requireString(
      image.description || "",
      FIELD_LIMITS.imageDescription,
      "圖片說明",
    ),
    accidentTags: normalizeAccidentTags(image.accidentTags || {}),
    annotations: normalizeAnnotations(image.annotations),
    rotation: requireEnum(image.rotation ?? 0, SAFE_ROTATIONS, "圖片旋轉角度"),
    importBatchId,
    originalImportIndex,
    splitGroupId,
    splitPartIndex,
    splitPartCount,
    sourceFileName: requireString(
      image.sourceFileName || "",
      FIELD_LIMITS.sourceFileName,
      "來源檔名",
    ),
  };
};

const normalizeProjectStructure = (rawProject) => {
  const project = requirePlainObject(rawProject, "專案");
  assertOnlyKeys(
    project,
    new Set(["format", "version", "savedAt", "fields", "titles", "settings", "images"]),
    "專案",
  );
  if (
    project.format !== PROJECT_FORMAT ||
    !SUPPORTED_PROJECT_VERSIONS.has(project.version)
  ) {
    throw new Error("不支援此專案格式或版本");
  }

  const fields = requirePlainObject(project.fields, "案件欄位");
  const settings = requirePlainObject(project.settings, "專案設定");
  const titles = requirePlainObject(project.titles, "文件標題");
  assertOnlyKeys(
    fields,
    new Set(["zipPrefix", "caseUni", "caseDate", "caseAddress", "caseNumber"]),
    "案件欄位",
  );
  assertOnlyKeys(
    settings,
    new Set([
      "selectedFormat",
      "viewMode",
      "pdfFont",
      "photoSize",
      "dateMode",
      "multiPhotoCount",
      "multiPhotoOrder",
      "photoStartNumber",
      "pdfPageNumberEnabled",
      "pdfPageStartNumber",
    ]),
    "專案設定",
  );
  assertOnlyKeys(titles, new Set(["left", "middle", "right"]), "文件標題");
  if (!Array.isArray(project.images) || project.images.length > IMAGE_SECURITY_LIMITS.maxCount) {
    throw new Error("專案照片數量超過安全限制");
  }

  const images = project.images.map((image, index) =>
    normalizeImageMetadata(image, index, project.version),
  );
  const totalBytes = images.reduce((sum, image) => sum + image.size, 0);
  if (totalBytes > IMAGE_SECURITY_LIMITS.maxTotalBytes) {
    throw new Error("專案照片總容量超過安全限制");
  }

  const savedAt = requireString(project.savedAt, 40, "儲存時間");
  if (!Number.isFinite(Date.parse(savedAt))) throw new Error("儲存時間格式無效");

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt,
    fields: {
      zipPrefix: requireString(fields.zipPrefix || "", FIELD_LIMITS.zipPrefix, "案由"),
      caseUni: requireString(fields.caseUni || "", FIELD_LIMITS.caseUni, "單位"),
      caseDate: requireString(fields.caseDate || "", FIELD_LIMITS.caseDate, "攝影日期"),
      caseAddress: requireString(
        fields.caseAddress || "",
        FIELD_LIMITS.caseAddress,
        "攝影地址",
      ),
      caseNumber: requireString(
        fields.caseNumber || "",
        FIELD_LIMITS.caseNumber,
        "攝影人員",
      ),
    },
    titles: {
      left: requireString(titles.left, FIELD_LIMITS.docTitleLeft, "刑案文件標題"),
      middle: requireString(
        titles.middle,
        FIELD_LIMITS.docTitleMiddle,
        "交通事故文件標題",
      ),
      right: requireString(
        titles.right || "照片黏貼表",
        FIELD_LIMITS.docTitleRight,
        "多格照片文件標題",
      ),
    },
    settings: {
      selectedFormat: requireEnum(settings.selectedFormat, SAFE_FORMATS, "文件格式"),
      viewMode: requireEnum(settings.viewMode, SAFE_VIEW_MODES, "檢視模式"),
      pdfFont: requireEnum(settings.pdfFont, SAFE_PDF_FONTS, "PDF 字型"),
      photoSize: requireInteger(settings.photoSize, 120, 600, "照片預覽大小"),
      dateMode: requireBoolean(settings.dateMode, "日期模式"),
      multiPhotoCount: requireEnum(
        settings.multiPhotoCount ?? 4,
        SAFE_MULTI_PHOTO_COUNTS,
        "多格照片每頁張數",
      ),
      multiPhotoOrder: requireEnum(
        settings.multiPhotoOrder ?? "horizontal",
        SAFE_MULTI_PHOTO_ORDERS,
        "多格照片排序方式",
      ),
      photoStartNumber: requireInteger(
        settings.photoStartNumber ?? 1,
        1,
        999,
        "照片起始編號",
      ),
      pdfPageNumberEnabled: requireBoolean(
        settings.pdfPageNumberEnabled ?? false,
        "PDF 頁碼顯示設定",
      ),
      pdfPageStartNumber: requireInteger(
        settings.pdfPageStartNumber ?? 1,
        1,
        9999,
        "PDF 頁碼起始編號",
      ),
    },
    images,
  };
};

const captureProject = () => {
  const savedAt = new Date().toISOString();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt,
    fields: {
      zipPrefix: getElementValue("zipPrefix"),
      caseUni: getElementValue("caseUni"),
      caseDate: getElementValue("caseDate"),
      caseAddress: getElementValue("caseAddress"),
      caseNumber: getElementValue("caseNumber"),
    },
    titles: {
      left: state.customDocTitles.left,
      middle: state.customDocTitles.middle,
      right: state.customDocTitles.right,
    },
    settings: {
      selectedFormat: state.selectedFormat,
      viewMode: state.viewMode,
      pdfFont: document.getElementById("pdfFontSelect")?.value || "kai",
      photoSize: Number(document.getElementById("photoSizeSlider")?.value || 250),
      dateMode: Boolean(document.getElementById("dateModeSwitch")?.checked),
      multiPhotoCount: Number(
        document.querySelector('input[name="multiPhotoCount"]:checked')?.value || 4,
      ),
      multiPhotoOrder:
        document.querySelector('input[name="multiPhotoOrder"]:checked')?.value ||
        "horizontal",
      photoStartNumber: normalizePhotoStartNumber(
        document.getElementById("photoStartNumber")?.value || 1,
      ),
      pdfPageNumberEnabled: Boolean(
        document.getElementById("pdfPageNumberEnabled")?.checked,
      ),
      pdfPageStartNumber: normalizePdfPageStartNumber(
        document.getElementById("pdfPageStartNumber")?.value || 1,
      ),
    },
    images: state.selectedImages.map((image) => ({
      name: image.name,
      type: image.blob.type,
      size: image.blob.size,
      width: image.width,
      height: image.height,
      exifDate: image.date || "",
      customDate: state.imageDates[image.id] || "",
      address: state.imageAddresses[image.id] || "",
      description: state.imageDescriptions[image.id] || "",
      accidentTags: state.imageAccidentTags[image.id] || {},
      annotations: state.imageAnnotations[image.id] || [],
      rotation: state.imageRotations[image.id] || 0,
      importBatchId: image.importBatchId || "",
      originalImportIndex: image.originalImportIndex ?? null,
      splitGroupId: image.splitGroupId || "",
      splitPartIndex: image.splitPartIndex ?? null,
      splitPartCount: image.splitPartCount ?? null,
      sourceFileName: image.sourceFileName || "",
      blob: image.blob,
    })),
  };
};

const hasMeaningfulContent = (project) => {
  return (
    project.images.length > 0 ||
    Object.values(project.fields).some((value) => value.trim()) ||
    project.titles.left !== "照片黏貼表" ||
    project.titles.middle !== "照片黏貼表" ||
    project.titles.right !== "照片黏貼表" ||
    project.settings.selectedFormat !== "left" ||
    project.settings.multiPhotoCount !== 4 ||
    project.settings.multiPhotoOrder !== "horizontal" ||
    project.settings.photoStartNumber !== 1 ||
    project.settings.pdfPageNumberEnabled ||
    project.settings.pdfPageStartNumber !== 1
  );
};

const normalizeProjectRecord = async (record) => {
  const stored = requirePlainObject(record, "專案");
  assertOnlyKeys(
    stored,
    new Set([
      "id",
      "customName",
      "autoName",
      "pinned",
      "createdAt",
      "updatedAt",
      "imageCount",
      "imageKeys",
      "project",
    ]),
    "專案",
  );
  const id = requireString(stored.id, 80, "專案識別碼");
  const normalized = normalizeProjectStructure(stored.project);
  if (
    !Array.isArray(stored.imageKeys) ||
    stored.imageKeys.length !== normalized.images.length
  ) {
    throw new Error("專案照片資料不完整");
  }
  const imageKeys = stored.imageKeys.map((value) =>
    requireString(value, 160, "專案照片識別碼"),
  );
  if (
    imageKeys.some((key) => !key.startsWith(`${id}:`)) ||
    new Set(imageKeys).size !== imageKeys.length
  ) {
    throw new Error("專案照片識別碼無效或重複");
  }
  const storedImages = await getProjectImages(imageKeys);
  const images = [];
  const loadedKeys = [];
  const upToDateKeys = [];
  const unreadable = [];
  for (let index = 0; index < normalized.images.length; index += 1) {
    const key = imageKeys[index];
    const metadata = normalized.images[index];
    try {
      const source = storedImages.get(key);
      if (!source || source.key !== key || source.projectId !== id) {
        throw new Error("專案照片資料遺失");
      }
      let blob;
      let isCurrentFormat = false;
      if (source.bytes instanceof ArrayBuffer) {
        blob = new Blob([source.bytes], { type: metadata.type });
        isCurrentFormat = true;
      } else if (source.blob instanceof Blob) {
        // 舊格式：先讀成位元組確認可讀，下次儲存時改用新格式
        const bytes = await source.blob.arrayBuffer();
        blob = new Blob([bytes], { type: metadata.type });
      } else {
        throw new Error("專案照片資料遺失");
      }
      await validateImageBlob(blob, metadata.type);
      if (blob.size !== metadata.size) throw new Error("專案照片大小不一致");
      images.push({ ...metadata, blob });
      loadedKeys.push(key);
      if (isCurrentFormat) upToDateKeys.push(key);
    } catch (error) {
      console.warn(`第 ${index + 1} 張照片無法讀取:`, error);
      unreadable.push(metadata.name || `第 ${index + 1} 張照片`);
    }
  }
  return {
    meta: {
      id,
      customName: String(stored.customName || "").slice(0, MAX_PROJECT_NAME_LENGTH),
      autoName: String(stored.autoName || "").slice(0, MAX_PROJECT_NAME_LENGTH),
      pinned: stored.pinned === true,
      createdAt: String(stored.createdAt || stored.updatedAt || ""),
      isStored: true,
    },
    imageKeys: loadedKeys,
    upToDateKeys,
    unreadable,
    project: { ...normalized, images },
  };
};

/** 儲存狀態顯示在左側清單「目前專案」的第二行。 */
let storageStatus = { message: "新專案", status: "idle" };

const getStatusText = () =>
  storageStatus.status === "idle" && !currentProject?.isStored
    ? "新增照片後自動儲存"
    : storageStatus.message;

const applyStatusToElement = (element) => {
  if (!element) return;
  element.textContent = getStatusText();
  element.dataset.status = storageStatus.status;
};

const setStorageStatus = (message, status = "idle") => {
  storageStatus = { message, status };
  applyStatusToElement(document.querySelector(".project-list-item.is-current .project-save-status"));
};

const requestPersistentStorage = async () => {
  if (persistRequested || !navigator.storage?.persist) return;
  persistRequested = true;
  try {
    await navigator.storage.persist();
  } catch (error) {
    console.warn("瀏覽器未提供持續儲存權限:", error);
  }
};

const saveDraftNow = async () => {
  if (persistenceSuspended || !currentProject) return;
  if (saveInProgress) {
    saveRequestedWhileBusy = true;
    return;
  }

  saveInProgress = true;
  let finishSave;
  activeSave = new Promise((resolve) => {
    finishSave = resolve;
  });
  dirty = true;
  setStorageStatus("儲存中…", "saving");
  const project = captureProject();

  try {
    const normalized = normalizeProjectStructure(project);
    if (!currentProject.isStored && !hasMeaningfulContent(normalized) && !currentProject.customName) {
      dirty = false;
      setStorageStatus("新專案", "idle");
      return;
    }

    const availableStorage = await navigator.storage?.estimate?.();
    const changedImageBytes = state.selectedImages.reduce((sum, image) => {
      const key = blobStorageKeys.get(image.blob);
      return sum + (key && persistedImageKeys.has(key) ? 0 : image.blob.size);
    }, 0);
    if (
      availableStorage?.quota &&
      availableStorage.quota - (availableStorage.usage || 0) <
        changedImageBytes + 10 * 1024 * 1024
    ) {
      throw new Error("瀏覽器可用空間不足，請刪除不需要的專案，或先匯出加密專案備份");
    }

    await putProjectRecord(project);
    await requestPersistentStorage();
    if (!saveRequestedWhileBusy) {
      dirty = false;
      setStorageStatus("已儲存", "saved");
    }
    await refreshProjectList();
  } catch (error) {
    console.error("專案自動儲存失敗:", error);
    dirty = true;
    setStorageStatus("儲存失敗", "error");
    showToast(error.message || "專案自動儲存失敗", "error", 5000);
  } finally {
    saveInProgress = false;
    finishSave();
    if (saveRequestedWhileBusy) {
      saveRequestedWhileBusy = false;
      scheduleAutosave();
    }
  }
};

const scheduleAutosave = () => {
  if (persistenceSuspended) return;
  if (!localDraftStorageAvailable) {
    dirty = true;
    setStorageStatus("無法自動儲存", "error");
    return;
  }
  if (saveInProgress) saveRequestedWhileBusy = true;
  dirty = true;
  setStorageStatus("尚未儲存", "pending");
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(saveDraftNow, AUTOSAVE_DELAY_MS);
};

/** 切換專案前，把目前專案尚未寫入的變更存好。 */
const flushPendingSave = async () => {
  // 等目前這次儲存真正完成（照片多時可能需要較久），再把剩下的變更存好。
  for (let attempt = 0; attempt < 20; attempt += 1) {
    window.clearTimeout(autosaveTimer);
    if (saveInProgress) {
      await activeSave;
    } else if (dirty && localDraftStorageAvailable && !persistenceSuspended) {
      await saveDraftNow();
    } else {
      return;
    }
  }
};

const buildHeader = (salt, manifestIv) => {
  const header = new Uint8Array(PROJECT_HEADER_BYTES);
  header.set(PROJECT_MAGIC, 0);
  header[8] = PROJECT_VERSION;
  header[9] = PROJECT_FLAG_ENCRYPTED;
  new DataView(header.buffer).setUint32(12, PBKDF2_ITERATIONS, false);
  header.set(salt, 16);
  header.set(manifestIv, 32);
  return header;
};

const parseHeader = (header) => {
  if (header.length !== PROJECT_HEADER_BYTES || !bytesEqual(header.slice(0, 8), PROJECT_MAGIC)) {
    throw new Error("不是有效的 M-Picture 專案檔");
  }
  if (
    !SUPPORTED_PROJECT_VERSIONS.has(header[8]) ||
    header[9] !== PROJECT_FLAG_ENCRYPTED ||
    header[10] !== 0 ||
    header[11] !== 0 ||
    readUint32(header, 12) !== PBKDF2_ITERATIONS
  ) {
    throw new Error("不支援此專案檔版本或加密設定");
  }
  return {
    version: header[8],
    salt: header.slice(16, 32),
    manifestIv: header.slice(32, 44),
  };
};

const deriveEncryptionKey = async (password, salt, usages) => {
  const passwordBytes = encoder.encode(password);
  if (!passwordBytes.length || passwordBytes.length > MAX_PASSWORD_BYTES) {
    passwordBytes.fill(0);
    throw new Error("密碼長度不符合安全限制");
  }
  try {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      usages,
    );
  } finally {
    passwordBytes.fill(0);
  }
};

const manifestContext = (version) =>
  encoder.encode(`M-Picture manifest v${version}`);
const imageContext = (version, index, size) =>
  encoder.encode(`M-Picture image v${version}:${index}:${size}`);

export const encryptProject = async (project, password) => {
  const normalized = normalizeProjectStructure(project);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const manifestIv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = buildHeader(salt, manifestIv);
  const key = await deriveEncryptionKey(password, salt, ["encrypt"]);
  const manifest = {
    ...normalized,
    images: normalized.images.map(({ blob, ...metadata }) => metadata),
  };
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  if (manifestBytes.length > MAX_MANIFEST_BYTES) throw new Error("專案描述資料過大");

  const encryptedManifest = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: manifestIv,
        additionalData: concatBytes(header, manifestContext(PROJECT_VERSION)),
      },
      key,
      manifestBytes,
    ),
  );
  const parts = [
    header,
    uint32Bytes(encryptedManifest.length),
    new Blob([encryptedManifest]),
  ];
  let totalBytes = PROJECT_HEADER_BYTES + 4 + encryptedManifest.length;

  for (let index = 0; index < project.images.length; index += 1) {
    const image = project.images[index];
    await validateImageBlob(image.blob, normalized.images[index].type);
    if (image.blob.size !== normalized.images[index].size) {
      throw new Error("圖片資料在匯出前發生變更");
    }
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: concatBytes(
            header,
            imageContext(PROJECT_VERSION, index, image.blob.size),
          ),
        },
        key,
        await image.blob.arrayBuffer(),
      ),
    );
    parts.push(uint32Bytes(encrypted.length), iv, new Blob([encrypted]));
    totalBytes += 4 + IV_BYTES + encrypted.length;
    if (totalBytes > MAX_PROJECT_BYTES) throw new Error("專案檔超過 1 GB 安全限制");
  }

  return new Blob(parts, { type: "application/octet-stream" });
};

export const decryptProject = async (file, password) => {
  if (!(file instanceof Blob) || file.size < PROJECT_HEADER_BYTES + 4 + AES_GCM_TAG_BYTES) {
    throw new Error("專案檔不完整");
  }
  if (file.size > MAX_PROJECT_BYTES) throw new Error("專案檔超過 1 GB 安全限制");

  const header = await readBlobBytes(file, 0, PROJECT_HEADER_BYTES);
  const { version: encryptedVersion, salt, manifestIv } = parseHeader(header);
  const key = await deriveEncryptionKey(password, salt, ["decrypt"]);
  const manifestLengthBytes = await readBlobBytes(file, PROJECT_HEADER_BYTES, 4);
  const manifestCipherLength = readUint32(manifestLengthBytes, 0);
  if (
    manifestCipherLength <= AES_GCM_TAG_BYTES ||
    manifestCipherLength > MAX_MANIFEST_BYTES + AES_GCM_TAG_BYTES
  ) {
    throw new Error("專案描述資料長度無效");
  }

  let offset = PROJECT_HEADER_BYTES + 4;
  const encryptedManifest = await readBlobBytes(file, offset, manifestCipherLength);
  offset += manifestCipherLength;

  let rawManifest;
  try {
    const plainManifest = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: manifestIv,
        additionalData: concatBytes(header, manifestContext(encryptedVersion)),
      },
      key,
      encryptedManifest,
    );
    rawManifest = JSON.parse(decoder.decode(plainManifest));
  } catch {
    throw new Error("密碼錯誤，或專案檔已損毀或遭竄改");
  }

  if (rawManifest.version !== encryptedVersion) {
    throw new Error("專案檔版本資訊不一致");
  }

  const normalized = normalizeProjectStructure(rawManifest);
  const restoredImages = [];
  for (let index = 0; index < normalized.images.length; index += 1) {
    const metadata = normalized.images[index];
    const prefix = await readBlobBytes(file, offset, 4 + IV_BYTES);
    const cipherLength = readUint32(prefix, 0);
    if (cipherLength !== metadata.size + AES_GCM_TAG_BYTES) {
      throw new Error("專案圖片長度與描述不一致");
    }
    offset += 4 + IV_BYTES;
    const encrypted = await readBlobBytes(file, offset, cipherLength);
    offset += cipherLength;

    let plainImage;
    try {
      plainImage = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: prefix.slice(4),
          additionalData: concatBytes(
            header,
            imageContext(encryptedVersion, index, metadata.size),
          ),
        },
        key,
        encrypted,
      );
    } catch {
      throw new Error("密碼錯誤，或專案檔已損毀或遭竄改");
    }
    const blob = new Blob([plainImage], { type: metadata.type });
    await validateImageBlob(blob, metadata.type);
    restoredImages.push({ ...metadata, blob });
  }
  if (offset !== file.size) throw new Error("專案檔包含未預期的附加資料");
  return { ...normalized, images: restoredImages };
};

const requestProjectPassword = (mode) => {
  return new Promise((resolve) => {
    const modal = document.getElementById("projectPasswordModal");
    const title = document.getElementById("projectPasswordTitle");
    const description = document.getElementById("projectPasswordDescription");
    const passwordInput = document.getElementById("projectPasswordInput");
    const passwordToggle = document.getElementById("projectPasswordToggleBtn");
    const confirmGroup = document.getElementById("projectPasswordConfirmGroup");
    const confirmInput = document.getElementById("projectPasswordConfirmInput");
    const confirmToggle = document.getElementById("projectPasswordConfirmToggleBtn");
    const errorElement = document.getElementById("projectPasswordError");
    const submitButton = document.getElementById("projectPasswordSubmitBtn");
    const cancelButton = document.getElementById("projectPasswordCancelBtn");
    const closeButton = document.getElementById("projectPasswordCloseBtn");

    title.textContent = mode === "export" ? "匯出加密專案" : "開啟加密專案";
    description.textContent =
      mode === "export"
        ? "請設定至少 12 字元的專案密碼。密碼無法復原，請妥善保存。"
        : "請輸入建立此專案檔時設定的密碼。";
    confirmGroup.hidden = mode !== "export";
    submitButton.textContent = mode === "export" ? "加密並匯出" : "解密並開啟";
    passwordInput.value = "";
    confirmInput.value = "";
    const setPasswordVisibility = (input, button, visible, name) => {
      input.type = visible ? "text" : "password";
      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute("aria-label", `${visible ? "隱藏" : "顯示"}${name}`);
      button.title = `${visible ? "隱藏" : "顯示"}${name}`;
      button.querySelector(".material-symbols-outlined").textContent =
        visible ? "visibility_off" : "visibility";
    };
    const togglePasswordVisibility = () => {
      setPasswordVisibility(
        passwordInput,
        passwordToggle,
        passwordInput.type === "password",
        "專案密碼",
      );
      passwordInput.focus({ preventScroll: true });
    };
    const toggleConfirmVisibility = () => {
      setPasswordVisibility(
        confirmInput,
        confirmToggle,
        confirmInput.type === "password",
        "確認密碼",
      );
      confirmInput.focus({ preventScroll: true });
    };
    setPasswordVisibility(passwordInput, passwordToggle, false, "專案密碼");
    setPasswordVisibility(confirmInput, confirmToggle, false, "確認密碼");
    errorElement.textContent = "";
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    passwordInput.focus();

    const cleanup = () => {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      passwordInput.value = "";
      confirmInput.value = "";
      setPasswordVisibility(passwordInput, passwordToggle, false, "專案密碼");
      setPasswordVisibility(confirmInput, confirmToggle, false, "確認密碼");
      submitButton.removeEventListener("click", submit);
      cancelButton.removeEventListener("click", cancel);
      closeButton.removeEventListener("click", cancel);
      passwordInput.removeEventListener("keydown", handleKeydown);
      confirmInput.removeEventListener("keydown", handleKeydown);
      passwordToggle.removeEventListener("click", togglePasswordVisibility);
      confirmToggle.removeEventListener("click", toggleConfirmVisibility);
    };
    const finish = (value) => {
      cleanup();
      resolve(value);
    };
    const submit = () => {
      const password = passwordInput.value;
      if (!password || password.length > MAX_PASSWORD_LENGTH || encoder.encode(password).length > MAX_PASSWORD_BYTES) {
        errorElement.textContent = "密碼長度不符合安全限制。";
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        errorElement.textContent = `密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元。`;
        return;
      }
      if (mode === "export" && password !== confirmInput.value) {
        errorElement.textContent = "兩次輸入的密碼不一致。";
        return;
      }
      finish(password);
    };
    const cancel = () => finish(null);
    const handleKeydown = (event) => {
      if (event.key === "Enter") submit();
      if (event.key === "Escape") cancel();
    };
    submitButton.addEventListener("click", submit);
    cancelButton.addEventListener("click", cancel);
    closeButton.addEventListener("click", cancel);
    passwordInput.addEventListener("keydown", handleKeydown);
    confirmInput.addEventListener("keydown", handleKeydown);
    passwordToggle.addEventListener("click", togglePasswordVisibility);
    confirmToggle.addEventListener("click", toggleConfirmVisibility);
  });
};

const setProjectBusy = (visible, message = "處理專案中…") => {
  const modal = document.getElementById("projectBusyModal");
  const messageElement = document.getElementById("projectBusyMessage");
  if (messageElement) messageElement.textContent = message;
  if (modal) modal.style.display = visible ? "block" : "none";
};

const downloadProjectBlob = (blob, fileName) => {
  const url = createObjectUrl(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${sanitizeFileName(fileName)}.mpicture`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => revokeObjectUrl(url), 0);
};

const handleExport = async () => {
  if (!crypto?.subtle || !window.isSecureContext) {
    showToast("目前環境不支援安全加密匯出，請使用 HTTPS 開啟網站", "error", 5000);
    return;
  }
  const project = captureProject();
  const normalized = normalizeProjectStructure(project);
  if (!hasMeaningfulContent(normalized)) {
    showToast("目前沒有可匯出的專案內容", "error");
    return;
  }
  const password = await requestProjectPassword("export");
  if (!password) return;

  setProjectBusy(true, "正在加密專案…");
  try {
    const encryptedBlob = await encryptProject(project, password);
    downloadProjectBlob(encryptedBlob, getDisplayName(currentProject) || "M-Picture專案");
    showToast("加密專案檔已匯出", "success");
  } catch (error) {
    console.error("專案匯出失敗:", error);
    showToast(error.message || "專案匯出失敗", "error", 5000);
  } finally {
    setProjectBusy(false);
  }
};

const handleImportFile = async (file) => {
  if (!file) return;
  if (file.size > MAX_PROJECT_BYTES) {
    showToast("專案檔超過 1 GB 安全限制", "error", 5000);
    return;
  }
  const password = await requestProjectPassword("import");
  if (!password) return;

  setProjectBusy(true, "正在驗證並解密專案…");
  try {
    const project = await decryptProject(file, password);
    await flushPendingSave();
    persistenceSuspended = true;
    const baseName = String(file.name || "").replace(/\.mpicture$/i, "").trim();
    resetCurrentProject({ customName: baseName.slice(0, MAX_PROJECT_NAME_LENGTH) });
    await applyProjectSnapshot(project);
    persistenceSuspended = false;
    dirty = true;
    await saveDraftNow();
    renderProjectHeader();
    showToast("已開啟為新專案", "success");
  } catch (error) {
    persistenceSuspended = false;
    console.error("專案匯入失敗:", error);
    showToast(error.message || "無法開啟專案檔", "error", 6000);
  } finally {
    setProjectBusy(false);
  }
};

const createEmptyProject = () => ({
  format: PROJECT_FORMAT,
  version: PROJECT_VERSION,
  savedAt: new Date().toISOString(),
  fields: { zipPrefix: "", caseUni: "", caseDate: "", caseAddress: "", caseNumber: "" },
  titles: {
    left: "照片黏貼表",
    middle: "照片黏貼表",
    right: "照片黏貼表",
  },
  settings: {
    selectedFormat: "left",
    viewMode: "list",
    pdfFont: "kai",
    photoSize: 250,
    dateMode: false,
    multiPhotoCount: 4,
    multiPhotoOrder: "horizontal",
    photoStartNumber: 1,
    pdfPageNumberEnabled: false,
    pdfPageStartNumber: 1,
  },
  images: [],
});

const resetCurrentProject = ({ customName = "" } = {}) => {
  currentProject = {
    id: createProjectId(),
    customName,
    autoName: "",
    pinned: false,
    createdAt: new Date().toISOString(),
    isStored: false,
  };
  blobStorageKeys = new WeakMap();
  persistedImageKeys = new Set();
  dirty = false;
};

const startNewProject = async () => {
  await flushPendingSave();
  persistenceSuspended = true;
  try {
    resetCurrentProject();
    await applyProjectSnapshot(createEmptyProject());
    setStorageStatus("新專案", "idle");
  } finally {
    persistenceSuspended = false;
    dirty = false;
    renderProjectHeader();
    renderProjectList();
  }
};

const openProject = async (id) => {
  if (currentProject?.id === id) return;
  let needsResave = false;
  let unreadablePhotos = [];
  await flushPendingSave();
  setProjectBusy(true, "正在開啟專案…");
  persistenceSuspended = true;
  try {
    const record = await getProjectRecord(id);
    if (!record) throw new Error("找不到這個專案，可能已被刪除");
    const loaded = await normalizeProjectRecord(record);
    currentProject = loaded.meta;
    blobStorageKeys = new WeakMap();
    loaded.project.images.forEach((image, index) => {
      blobStorageKeys.set(image.blob, loaded.imageKeys[index]);
    });
    persistedImageKeys = new Set(loaded.upToDateKeys);
    await applyProjectSnapshot(loaded.project);
    needsResave = loaded.upToDateKeys.length !== loaded.imageKeys.length;
    unreadablePhotos = loaded.unreadable;
    try {
      localStorage.setItem(LAST_PROJECT_STORAGE_KEY, id);
    } catch (_error) {
      // 忽略
    }
    setStorageStatus("已儲存", "saved");
  } catch (error) {
    console.error("開啟專案失敗:", error);
    showToast(error.message || "無法開啟這個專案", "error", 5000);
  } finally {
    persistenceSuspended = false;
    dirty = false;
    setProjectBusy(false);
    renderProjectHeader();
    renderProjectList();
  }
  if (unreadablePhotos.length) {
    needsResave = true;
    showNotice({
      title: `有 ${unreadablePhotos.length} 張照片讀取不到`,
      message:
        "這台裝置的瀏覽器沒有完整保留這些照片，專案已先開啟其他照片。若手邊還有原始照片，請重新加入。",
      details: unreadablePhotos,
      tone: "warning",
    });
  }
  // 舊格式或有照片讀不到時，用新格式重新儲存一次
  if (needsResave) scheduleAutosave();
};

const renameProject = async (id) => {
  const meta =
    id === currentProject?.id
      ? currentProject
      : projectIndex.find((item) => item.id === id);
  if (!meta) return;
  const name = await showPromptDialog({
    title: "重新命名專案",
    value: getDisplayName(meta),
    placeholder: "例：竊盜案 現場照片",
    maxLength: MAX_PROJECT_NAME_LENGTH,
    confirmText: "儲存",
  });
  if (name === null) return;
  const customName = name.trim().slice(0, MAX_PROJECT_NAME_LENGTH);
  if (id === currentProject?.id) {
    currentProject.customName = customName;
    renderProjectHeader();
    if (currentProject.isStored) {
      await updateProjectRecord(id, { customName });
    } else {
      dirty = true;
      await saveDraftNow();
    }
  } else {
    await updateProjectRecord(id, { customName });
  }
  await refreshProjectList();
};

const togglePinProject = async (id) => {
  const meta = projectIndex.find((item) => item.id === id);
  if (!meta) {
    showToast("新增照片或填寫資料後，專案才會儲存，之後就能釘選。", "info", 4000);
    return;
  }
  const pinned = !meta.pinned;
  await updateProjectRecord(id, { pinned });
  if (id === currentProject?.id) currentProject.pinned = pinned;
  await refreshProjectList();
  showToast(pinned ? "已釘選到清單最上方" : "已取消釘選", "success");
};

const deleteProject = async (id) => {
  const meta =
    projectIndex.find((item) => item.id === id) ||
    (id === currentProject?.id ? currentProject : null);
  if (!meta) return;
  const confirmed = await showDialog({
    title: `刪除「${getDisplayName(meta)}」？`,
    message:
      "專案中的照片和填寫的資料都會從這台裝置刪除，無法復原。需要保留的話，請先用「輸出」選單匯出加密專案。",
    tone: "danger",
    confirmText: "刪除專案",
    cancelText: "取消",
  });
  if (!confirmed) return;
  try {
    const isCurrent = id === currentProject?.id;
    if (isCurrent) {
      window.clearTimeout(autosaveTimer);
      dirty = false;
    }
    if (meta.isStored !== false) await deleteProjectData(id);
    try {
      if (localStorage.getItem(LAST_PROJECT_STORAGE_KEY) === id) {
        localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
      }
    } catch (_error) {
      // 忽略
    }
    if (isCurrent) await startNewProject();
    await refreshProjectList();
    showToast("專案已刪除", "success");
  } catch (error) {
    console.error("刪除專案失敗:", error);
    showToast("無法完整刪除專案資料", "error");
  }
};

/** 舊版只保存一份 2 小時草稿；第一次開啟新版時，把未到期的草稿轉成專案。 */
const migrateLegacyDraft = async () => {
  const legacy = await runTransaction([LEGACY_DRAFT_STORE], "readonly", (stores) =>
    requestToCollector(stores[LEGACY_DRAFT_STORE].get(LEGACY_DRAFT_ID)),
  );
  if (legacy) {
    try {
      const expiresAt = Date.parse(String(legacy.expiresAt || ""));
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error("舊草稿已到期");
      }
      const normalized = normalizeProjectStructure(legacy.project);
      const imageIds = Array.isArray(legacy.imageIds) ? legacy.imageIds.map(String) : [];
      if (imageIds.length !== normalized.images.length) {
        throw new Error("舊草稿照片不完整");
      }
      const legacyImages = await runTransaction(
        [LEGACY_DRAFT_IMAGE_STORE],
        "readonly",
        (stores) => {
          const results = new Map();
          imageIds.forEach((imageId) => {
            const request = stores[LEGACY_DRAFT_IMAGE_STORE].get(imageId);
            request.onsuccess = () => results.set(imageId, request.result);
          });
          return results;
        },
      );
      const id = createProjectId();
      const imageKeys = imageIds.map(() => createImageKey(id));
      const buffers = [];
      for (let index = 0; index < imageIds.length; index += 1) {
        const source = legacyImages?.get(imageIds[index]);
        if (!source?.blob) throw new Error("舊草稿照片遺失");
        const type = normalized.images[index].type;
        const bytes = await source.blob.arrayBuffer();
        await validateImageBlob(new Blob([bytes], { type }), type);
        buffers.push({ type, bytes });
      }
      const createdAt = normalized.savedAt || new Date().toISOString();
      await runTransaction([PROJECT_STORE, PROJECT_IMAGE_STORE], "readwrite", (stores) => {
        stores[PROJECT_STORE].put({
          id,
          customName: "",
          autoName: buildAutoProjectName(normalized, createdAt),
          pinned: false,
          createdAt,
          updatedAt: createdAt,
          imageCount: imageKeys.length,
          imageKeys,
          project: {
            ...normalized,
            images: normalized.images.map(({ blob, ...metadata }) => metadata),
          },
        });
        buffers.forEach(({ type, bytes }, index) => {
          stores[PROJECT_IMAGE_STORE].put({ key: imageKeys[index], projectId: id, type, bytes });
        });
      });
      try {
        localStorage.setItem(LAST_PROJECT_STORAGE_KEY, id);
      } catch (_error) {
        // 忽略
      }
    } catch (error) {
      console.warn("舊版草稿未轉換:", error);
    }
  }
  await runTransaction(
    [LEGACY_DRAFT_STORE, LEGACY_DRAFT_IMAGE_STORE],
    "readwrite",
    (stores) => {
      Object.values(stores).forEach((store) => store.clear());
    },
  );
};

/* ---------- 專案清單畫面 ---------- */

const formatRelativeTime = (iso) => {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const diff = Date.now() - time;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diff < minute) return "剛剛";
  if (diff < hour) return `${Math.floor(diff / minute)} 分鐘前`;
  const date = new Date(time);
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  if (time >= startOfToday) return `${Math.floor(diff / hour)} 小時前`;
  if (time >= startOfToday - 24 * hour) return "昨天";
  if (date.getFullYear() === today.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return "不到 1 MB";
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const updateStorageUsage = async () => {
  const element = document.getElementById("storageUsage");
  if (!element) return;
  if (!navigator.storage?.estimate) {
    element.textContent = "專案只存在這台裝置的瀏覽器中";
    return;
  }
  try {
    const { usage } = await navigator.storage.estimate();
    element.textContent = `專案只存在這台裝置・已使用 ${formatBytes(usage || 0)}`;
  } catch (_error) {
    element.textContent = "專案只存在這台裝置的瀏覽器中";
  }
};

const renderProjectHeader = () => {
  const title = document.getElementById("projectTitleText");
  const isBlankNew = !currentProject?.isStored && !currentProject?.customName;
  if (title) title.textContent = isBlankNew ? "新專案" : getDisplayName(currentProject);
  const titleButton = document.getElementById("projectTitleBtn");
  titleButton?.classList.toggle("is-new", !currentProject?.isStored);
  document.title = currentProject?.isStored
    ? `${getDisplayName(currentProject)} - M-Picture`
    : "M-Picture";
};

const createProjectListItem = (meta) => {
  const item = document.createElement("li");
  item.className = "project-list-item";
  item.dataset.projectId = meta.id;
  const isCurrent = meta.id === currentProject?.id;
  item.classList.toggle("is-current", isCurrent);

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "project-link";
  openButton.title = getDisplayName(meta);
  if (isCurrent) openButton.setAttribute("aria-current", "page");
  const name = document.createElement("span");
  name.className = "project-link-name";
  name.textContent = getDisplayName(meta);
  const detail = document.createElement("span");
  detail.className = "project-link-detail";
  if (isCurrent) {
    detail.classList.add("project-save-status");
    detail.setAttribute("role", "status");
    detail.setAttribute("aria-live", "polite");
    applyStatusToElement(detail);
  } else {
    detail.textContent = `${meta.imageCount || 0} 張照片・${formatRelativeTime(meta.updatedAt)}`;
  }
  openButton.append(name, detail);
  openButton.addEventListener("click", () => {
    closeNavOnMobile();
    if (isCurrent) return;
    openProject(meta.id);
  });
  if (!meta.isStored) {
    // 尚未儲存的新專案：只標示目前位置，沒有改名或刪除可做
    item.append(openButton);
    return item;
  }

  const moreButton = document.createElement("button");
  moreButton.type = "button";
  moreButton.className = "project-more-btn";
  moreButton.title = "更多動作";
  moreButton.setAttribute("aria-label", `「${getDisplayName(meta)}」的更多動作`);
  moreButton.setAttribute("aria-haspopup", "menu");
  moreButton.setAttribute("aria-expanded", "false");
  const moreIcon = document.createElement("span");
  moreIcon.className = "material-symbols-outlined";
  moreIcon.setAttribute("aria-hidden", "true");
  moreIcon.textContent = "more_horiz";
  moreButton.appendChild(moreIcon);
  moreButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openProjectMenu(meta.id, moreButton);
  });

  item.append(openButton, moreButton);
  return item;
};

const renderProjectList = () => {
  const pinnedList = document.getElementById("pinnedProjectList");
  const recentList = document.getElementById("recentProjectList");
  const pinnedSection = document.getElementById("pinnedProjectsSection");
  const recentSection = document.getElementById("recentProjectsSection");
  const emptyHint = document.getElementById("projectListEmpty");
  if (!pinnedList || !recentList) return;
  const sorted = [...projectIndex].sort((a, b) =>
    String(b.updatedAt).localeCompare(String(a.updatedAt)),
  );
  const pinned = sorted.filter((item) => item.pinned);
  const recent = sorted.filter((item) => !item.pinned);
  pinnedList.replaceChildren(...pinned.map(createProjectListItem));
  const recentItems = recent.map(createProjectListItem);
  if (currentProject && !currentProject.isStored) {
    recentItems.unshift(
      createProjectListItem({
        ...currentProject,
        customName: currentProject.customName || "新專案",
        isStored: false,
      }),
    );
  }
  recentList.replaceChildren(...recentItems);
  if (pinnedSection) pinnedSection.hidden = pinned.length === 0;
  if (recentSection) recentSection.hidden = recentItems.length === 0 && pinned.length > 0;
  if (emptyHint) emptyHint.hidden = recentItems.length > 0 || pinned.length > 0;
};

const refreshProjectList = async () => {
  try {
    const records = await listProjectRecords();
    projectIndex = records.map((record) => ({
      id: String(record.id),
      customName: String(record.customName || ""),
      autoName: String(record.autoName || ""),
      pinned: record.pinned === true,
      createdAt: String(record.createdAt || ""),
      updatedAt: String(record.updatedAt || ""),
      imageCount: Number(record.imageCount) || 0,
      isStored: true,
    }));
    const current = projectIndex.find((item) => item.id === currentProject?.id);
    if (current && currentProject) {
      currentProject.pinned = current.pinned;
      currentProject.customName = current.customName;
      currentProject.autoName = current.autoName;
    }
  } catch (error) {
    console.warn("無法讀取專案清單:", error);
  }
  renderProjectList();
  renderProjectHeader();
  updateStorageUsage();
};

/* 專案動作選單（清單的「⋯」與頂列專案名稱共用） */
let projectMenuTargetId = null;
let projectMenuAnchor = null;

const closeProjectMenu = () => {
  const menu = document.getElementById("projectMenu");
  if (!menu) return;
  menu.classList.remove("show");
  projectMenuAnchor?.setAttribute("aria-expanded", "false");
  projectMenuAnchor = null;
  projectMenuTargetId = null;
};

const openProjectMenu = (id, anchor) => {
  const menu = document.getElementById("projectMenu");
  if (!menu) return;
  if (projectMenuTargetId === id && projectMenuAnchor === anchor) {
    closeProjectMenu();
    return;
  }
  closeProjectMenu();
  projectMenuTargetId = id;
  projectMenuAnchor = anchor;
  const meta =
    projectIndex.find((item) => item.id === id) ||
    (id === currentProject?.id ? currentProject : null);
  const pinButton = menu.querySelector('[data-project-action="pin"]');
  const pinLabel = pinButton?.querySelector(".menu-label");
  const pinIcon = pinButton?.querySelector(".material-symbols-outlined");
  if (pinLabel) pinLabel.textContent = meta?.pinned ? "取消釘選" : "釘選";
  if (pinIcon) pinIcon.textContent = meta?.pinned ? "keep_off" : "keep";
  menu.classList.add("show");
  anchor.setAttribute("aria-expanded", "true");
  const rect = anchor.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 200;
  const menuHeight = menu.offsetHeight || 140;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - menuWidth - 8);
  let top = rect.bottom + 6;
  if (top + menuHeight > window.innerHeight - 8) top = rect.top - menuHeight - 6;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.querySelector("button")?.focus({ preventScroll: true });
};

const closeNavOnMobile = () => {
  if (window.matchMedia("(max-width: 820px)").matches) {
    document.body.classList.remove("nav-open");
    document.getElementById("navBackdrop")?.setAttribute("aria-hidden", "true");
  }
};

const setupProjectControls = () => {
  const exportButton = document.getElementById("exportProjectBtn");
  const importButton = document.getElementById("openProjectBtn");
  const newButton = document.getElementById("newProjectBtn");
  const titleButton = document.getElementById("projectTitleBtn");
  const menu = document.getElementById("projectMenu");
  const fileInput = document.getElementById("projectFileInput");

  exportButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    document.getElementById("downloadMenu")?.classList.remove("show");
    handleExport();
  });
  newButton?.addEventListener("click", () => {
    closeNavOnMobile();
    startNewProject();
  });
  importButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeNavOnMobile();
    fileInput?.click();
  });
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0] || null;
    fileInput.value = "";
    if (file) await handleImportFile(file);
  });

  titleButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!currentProject) return;
    openProjectMenu(currentProject.id, titleButton);
  });

  menu?.addEventListener("click", async (event) => {
    event.stopPropagation();
    const button = event.target.closest("[data-project-action]");
    if (!button || !projectMenuTargetId) return;
    const id = projectMenuTargetId;
    closeProjectMenu();
    const action = button.dataset.projectAction;
    if (action === "rename") await renameProject(id);
    if (action === "pin") await togglePinProject(id);
    if (action === "delete") await deleteProject(id);
  });
  document.addEventListener("click", closeProjectMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu?.classList.contains("show")) {
      const anchor = projectMenuAnchor;
      closeProjectMenu();
      anchor?.focus();
    }
  });
  window.addEventListener("resize", closeProjectMenu);
  document.getElementById("navScroll")?.addEventListener("scroll", closeProjectMenu, {
    passive: true,
  });
  // 讓「幾分鐘前」的時間保持正確
  window.setInterval(renderProjectList, 60 * 1000);
};

const isProjectInput = (target) =>
  target instanceof Element &&
  target.matches(
    ".sidebar-input, .image-date-input, .image-address-input, .image-description-textarea, .accident-tag-checkbox, .accident-tag-other-input, .multi-layout-input, #dateModeSwitch, #pdfFontSelect, #photoSizeSlider, #pdfPageNumberEnabled, #pdfPageStartNumber",
  );

export const shouldWarnBeforeUnload = () => dirty || saveInProgress;

export const initProjectPersistence = async ({ applyProject }) => {
  if (persistenceInitialized) return;
  persistenceInitialized = true;
  applyProjectSnapshot = applyProject;
  setupProjectControls();
  resetCurrentProject();
  renderProjectHeader();
  document.addEventListener(PROJECT_CHANGED_EVENT, scheduleAutosave);
  document.addEventListener("input", (event) => {
    if (isProjectInput(event.target)) scheduleAutosave();
  });
  document.addEventListener("change", (event) => {
    if (isProjectInput(event.target)) scheduleAutosave();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty) saveDraftNow();
  });

  try {
    await openDatabase();
    await migrateLegacyDraft();
    await refreshProjectList();
    let lastId = null;
    try {
      lastId = localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
    } catch (_error) {
      lastId = null;
    }
    persistenceSuspended = false;
    if (lastId && projectIndex.some((item) => item.id === lastId)) {
      await openProject(lastId);
    } else {
      setStorageStatus("新專案", "idle");
    }
  } catch (error) {
    console.error("專案儲存功能初始化失敗:", error);
    localDraftStorageAvailable = false;
    setStorageStatus("無法自動儲存", "error");
    showToast("此瀏覽器目前無法在本機儲存專案", "error", 5000);
  } finally {
    persistenceSuspended = false;
    dirty = false;
  }
};
