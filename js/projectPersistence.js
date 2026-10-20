import { state, ACCIDENT_TAG_OPTIONS } from "./state.js?v=20261020-2";
import { IMAGE_SECURITY_LIMITS } from "./imageHandler.js?v=20261020-2";
import { PROJECT_CHANGED_EVENT } from "./projectEvents.js?v=20261020-2";
import { createObjectUrl, revokeObjectUrl, showDialog, showToast } from "./utils.js?v=20261020-2";
import { normalizePhotoStartNumber } from "./photoNumbering.js?v=20261020-2";
import { normalizePdfPageStartNumber } from "./pageNumbering.js?v=20261020-2";

const DATABASE_NAME = "mpicture-local-projects-v1";
const DATABASE_VERSION = 2;
const DRAFT_STORE = "drafts";
const DRAFT_IMAGE_STORE = "draftImages";
const ACTIVE_DRAFT_ID = "active";
const DRAFT_RETENTION_MS = 2 * 60 * 60 * 1000;
const AUTOSAVE_DELAY_MS = 1000;

const PROJECT_FORMAT = "m-picture-project";
const PROJECT_VERSION = 6;
const SUPPORTED_PROJECT_VERSIONS = new Set([1, 2, 3, 4, 5, PROJECT_VERSION]);
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
let saveRequestedWhileBusy = false;
let persistenceSuspended = true;
let dirty = false;
let persistRequested = false;
let applyProjectSnapshot = null;
let persistenceInitialized = false;
let persistedDraftImages = new Map();
let localDraftStorageAvailable = true;

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
    return Promise.reject(new Error("此瀏覽器不支援本機草稿儲存"));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        database.createObjectStore(DRAFT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(DRAFT_IMAGE_STORE)) {
        database.createObjectStore(DRAFT_IMAGE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error("無法開啟草稿資料庫"));
    request.onblocked = () => reject(new Error("草稿資料庫正被其他分頁占用"));
  });

  return databasePromise;
};

const runDraftRequest = async (mode, operation) => {
  const database = await openDatabase();
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction(DRAFT_STORE, mode);
    const store = transaction.objectStore(DRAFT_STORE);
    let request;
    let requestResult;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      request = operation(store);
    } catch (error) {
      fail(error);
      return;
    }
    request.onsuccess = () => {
      requestResult = request.result;
    };
    request.onerror = () =>
      fail(request.error || new Error("草稿資料庫操作失敗"));
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(requestResult);
    };
    transaction.onerror = () =>
      fail(transaction.error || new Error("草稿資料庫交易失敗"));
    transaction.onabort = () =>
      fail(transaction.error || new Error("草稿寫入已中止"));
  });
};

const getDraft = () => runDraftRequest("readonly", (store) => store.get(ACTIVE_DRAFT_ID));

const getDraftImages = async (ids) => {
  const database = await openDatabase();
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction(DRAFT_IMAGE_STORE, "readonly");
    const store = transaction.objectStore(DRAFT_IMAGE_STORE);
    const results = new Map();
    ids.forEach((id) => {
      const request = store.get(id);
      request.onsuccess = () => results.set(id, request.result);
    });
    transaction.oncomplete = () => resolve(results);
    transaction.onerror = () =>
      reject(transaction.error || new Error("無法讀取草稿圖片"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("草稿圖片讀取已中止"));
  });
};

const putProjectDraft = async (project) => {
  const database = await openDatabase();
  const imageIds = state.selectedImages.map((image) => String(image.id));
  if (new Set(imageIds).size !== imageIds.length) {
    throw new Error("照片識別碼重複，無法安全儲存草稿");
  }
  const currentImages = new Map(
    state.selectedImages.map((image, index) => [imageIds[index], image.blob]),
  );
  const projectWithoutBlobs = {
    ...project,
    images: project.images.map(({ blob, ...metadata }) => metadata),
  };
  const record = {
    id: ACTIVE_DRAFT_ID,
    savedAt: project.savedAt,
    expiresAt: new Date(Date.now() + DRAFT_RETENTION_MS).toISOString(),
    imageIds,
    project: projectWithoutBlobs,
  };

  await new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [DRAFT_STORE, DRAFT_IMAGE_STORE],
      "readwrite",
    );
    const draftStore = transaction.objectStore(DRAFT_STORE);
    const imageStore = transaction.objectStore(DRAFT_IMAGE_STORE);
    draftStore.put(record);

    currentImages.forEach((blob, id) => {
      if (persistedDraftImages.get(id) !== blob) {
        imageStore.put({ id, blob });
      }
    });
    persistedDraftImages.forEach((_blob, id) => {
      if (!currentImages.has(id)) imageStore.delete(id);
    });

    transaction.oncomplete = resolve;
    transaction.onerror = () =>
      reject(transaction.error || new Error("草稿交易寫入失敗"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("草稿交易已中止"));
  });
  persistedDraftImages = currentImages;
};

const deleteDraft = async () => {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [DRAFT_STORE, DRAFT_IMAGE_STORE],
      "readwrite",
    );
    transaction.objectStore(DRAFT_STORE).delete(ACTIVE_DRAFT_ID);
    transaction.objectStore(DRAFT_IMAGE_STORE).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () =>
      reject(transaction.error || new Error("無法清除本機草稿"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("清除草稿交易已中止"));
  });
  persistedDraftImages = new Map();
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
  if (!blob.size || blob.size > IMAGE_SECURITY_LIMITS.maxFileBytes) {
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

const normalizeDraftRecord = async (record) => {
  const draft = requirePlainObject(record, "草稿");
  assertOnlyKeys(
    draft,
    new Set(["id", "savedAt", "expiresAt", "imageIds", "project"]),
    "草稿",
  );
  if (draft.id !== ACTIVE_DRAFT_ID) throw new Error("草稿識別碼無效");
  const expiresAt = Date.parse(requireString(draft.expiresAt, 40, "草稿到期時間"));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("草稿已到期");
  }
  const normalized = normalizeProjectStructure(draft.project);
  if (
    !Array.isArray(draft.imageIds) ||
    draft.imageIds.length !== normalized.images.length
  ) {
    throw new Error("草稿圖片資料不完整");
  }

  const images = [];
  const loadedImages = new Map();
  const validatedImageIds = draft.imageIds.map((value) =>
    requireString(value, 64, "草稿圖片識別碼"),
  );
  if (
    validatedImageIds.some((imageId) => !/^\d+(?:\.\d+)?$/.test(imageId)) ||
    new Set(validatedImageIds).size !== validatedImageIds.length
  ) {
    throw new Error("草稿圖片識別碼無效或重複");
  }
  const storedImages = await getDraftImages(validatedImageIds);
  for (let index = 0; index < normalized.images.length; index += 1) {
    const imageId = validatedImageIds[index];
    const source = storedImages.get(imageId);
    if (!source || source.id !== imageId) throw new Error("草稿圖片資料遺失");
    const metadata = normalized.images[index];
    await validateImageBlob(source.blob, metadata.type);
    if (source.blob.size !== metadata.size) throw new Error("草稿圖片大小不一致");
    images.push({ ...metadata, blob: source.blob });
    loadedImages.set(imageId, source.blob);
  }
  persistedDraftImages = loadedImages;
  return { ...normalized, images };
};

const setStorageStatus = (message, status = "idle") => {
  const element = document.getElementById("projectSaveStatus");
  if (!element) return;
  element.textContent = message;
  element.dataset.status = status;
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
  if (persistenceSuspended) return;
  if (saveInProgress) {
    saveRequestedWhileBusy = true;
    return;
  }

  saveInProgress = true;
  dirty = true;
  setStorageStatus("儲存中…", "saving");
  const project = captureProject();

  try {
    const normalized = normalizeProjectStructure(project);
    if (!hasMeaningfulContent(normalized)) {
      await deleteDraft();
      dirty = false;
      setStorageStatus("尚無草稿", "idle");
      return;
    }

    const availableStorage = await navigator.storage?.estimate?.();
    const changedImageBytes = state.selectedImages.reduce((sum, image) => {
      const imageId = String(image.id);
      return sum + (persistedDraftImages.get(imageId) === image.blob ? 0 : image.blob.size);
    }, 0);
    if (
      availableStorage?.quota &&
      availableStorage.quota - (availableStorage.usage || 0) <
        changedImageBytes + 10 * 1024 * 1024
    ) {
      throw new Error("瀏覽器可用空間不足，請先匯出專案檔或清理空間");
    }

    await putProjectDraft(project);
    await requestPersistentStorage();
    if (!saveRequestedWhileBusy) {
      dirty = false;
      setStorageStatus("已儲存", "saved");
    }
  } catch (error) {
    console.error("草稿自動儲存失敗:", error);
    dirty = true;
    setStorageStatus("儲存失敗", "error");
    showToast(error.message || "草稿自動儲存失敗", "error", 5000);
  } finally {
    saveInProgress = false;
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
    setStorageStatus("草稿功能不可用", "error");
    return;
  }
  if (saveInProgress) saveRequestedWhileBusy = true;
  dirty = true;
  setStorageStatus("尚未儲存", "pending");
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(saveDraftNow, AUTOSAVE_DELAY_MS);
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
    downloadProjectBlob(encryptedBlob, project.fields.zipPrefix || "M-Picture專案");
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
  persistenceSuspended = true;
  try {
    const project = await decryptProject(file, password);
    await applyProjectSnapshot(project);
    persistenceSuspended = false;
    dirty = true;
    await saveDraftNow();
    showToast("專案已安全開啟", "success");
  } catch (error) {
    persistenceSuspended = false;
    console.error("專案匯入失敗:", error);
    showToast(error.message || "無法開啟專案檔", "error", 6000);
  } finally {
    setProjectBusy(false);
  }
};

const showRestorePrompt = (project) => {
  return new Promise((resolve) => {
    const modal = document.getElementById("projectRestoreModal");
    const summary = document.getElementById("projectRestoreSummary");
    const restoreButton = document.getElementById("projectRestoreBtn");
    const discardButton = document.getElementById("projectDiscardBtn");
    const savedDate = new Date(project.savedAt);
    summary.textContent = `${Number.isNaN(savedDate.getTime()) ? "先前" : savedDate.toLocaleString("zh-TW")}儲存，包含 ${project.images.length} 張照片。`;
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    restoreButton.focus();

    const finish = (shouldRestore) => {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      restoreButton.removeEventListener("click", restore);
      discardButton.removeEventListener("click", discard);
      resolve(shouldRestore);
    };
    const restore = () => finish(true);
    const discard = () => finish(false);
    restoreButton.addEventListener("click", restore);
    discardButton.addEventListener("click", discard);
  });
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
    viewMode: "grid",
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

const clearCurrentProject = async () => {
  const confirmed = await showDialog({
    title: "清除所有照片與草稿？",
    message: "目前的照片、填寫的資料，以及這台裝置上自動儲存的草稿都會刪除，無法復原。",
    tone: "danger",
    confirmText: "全部清除",
    cancelText: "取消",
  });
  if (!confirmed) return;
  persistenceSuspended = true;
  try {
    await applyProjectSnapshot(createEmptyProject());
    await deleteDraft();
    dirty = false;
    setStorageStatus("尚無草稿", "idle");
    showToast("目前專案與本機草稿已清除", "success");
  } catch (error) {
    console.error("清除專案失敗:", error);
    showToast("無法完整清除專案資料", "error");
  } finally {
    persistenceSuspended = false;
  }
};

const setupProjectControls = () => {
  const exportButton = document.getElementById("exportProjectBtn");
  const importButton = document.getElementById("openProjectBtn");
  const clearButton = document.getElementById("clearProjectBtn");
  const fileInput = document.getElementById("projectFileInput");
  exportButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    document.getElementById("downloadMenu")?.classList.remove("show");
    handleExport();
  });
  clearButton?.addEventListener("click", clearCurrentProject);
  importButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    document.getElementById("photoSourcePicker")?.classList.remove("open");
    fileInput?.click();
  });
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0] || null;
    fileInput.value = "";
    if (!file) return;
    if (hasMeaningfulContent(normalizeProjectStructure(captureProject()))) {
      const proceed = await showDialog({
        title: "開啟專案會取代目前內容",
        message: "目前的照片和資料會被專案檔的內容取代。需要保留的話，請先匯出加密專案備份。",
        tone: "warning",
        confirmText: "開啟專案",
        cancelText: "取消",
      });
      if (!proceed) return;
    }
    await handleImportFile(file);
  });
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
  let didRestoreDraft = false;
  setupProjectControls();
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
    const draftRecord = await getDraft();
    if (draftRecord) {
      let draft;
      try {
        draft = await normalizeDraftRecord(draftRecord);
      } catch (error) {
        console.warn("已移除無效或過期的本機草稿:", error);
        await deleteDraft();
      }
      if (draft) {
        const shouldRestore = await showRestorePrompt(draft);
        if (shouldRestore) {
          setProjectBusy(true, "正在恢復本機草稿…");
          try {
            await applyProjectSnapshot(draft);
            didRestoreDraft = true;
          } catch (error) {
            await deleteDraft();
            throw error;
          }
          setStorageStatus("已儲存", "saved");
          showToast("已恢復上次未完成的專案", "success");
        } else {
          await deleteDraft();
          setStorageStatus("尚無草稿", "idle");
        }
      }
    } else {
      setStorageStatus("尚無草稿", "idle");
    }
  } catch (error) {
    console.error("草稿功能初始化失敗:", error);
    localDraftStorageAvailable = false;
    setStorageStatus("草稿功能不可用", "error");
    showToast("此瀏覽器目前無法使用本機草稿功能", "error", 5000);
  } finally {
    setProjectBusy(false);
    persistenceSuspended = false;
    dirty = false;
    if (didRestoreDraft && localDraftStorageAvailable) {
      dirty = true;
      await saveDraftNow();
    }
  }
};
