import { hideUploadingModal, showToast, showUploadingModal } from "./utils.js";

const GOOGLE_CLIENT_ID =
  "675840758894-q4rblce0hgor78li4a8kkr5vgq6gdkgu.apps.googleusercontent.com";
const PHOTOS_PICKER_SCOPE =
  "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
const PHOTOS_PICKER_API = "https://photospicker.googleapis.com/v1";
const MAX_PICKED_ITEMS = "100";

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let pickerWindow = null;

const isGooglePhotoItem = (item) => {
  const mediaFile = item?.mediaFile;
  const mimeType = mediaFile?.mimeType || "";
  return item?.type === "PHOTO" && mimeType.startsWith("image/");
};

const waitForGoogleIdentity = () =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        window.clearInterval(timer);
        resolve();
        return;
      }

      if (Date.now() - startedAt > 10000) {
        window.clearInterval(timer);
        reject(new Error("Google Identity Services 載入逾時"));
      }
    }, 100);
  });

const getTokenClient = async () => {
  if (tokenClient) return tokenClient;

  await waitForGoogleIdentity();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: PHOTOS_PICKER_SCOPE,
    prompt: "",
    callback: () => {},
    error_callback: () => {},
  });

  return tokenClient;
};

const requestAccessToken = async ({ forceConsent = false } = {}) => {
  if (accessToken && Date.now() < tokenExpiresAt - 60000) {
    return accessToken;
  }

  const client = await getTokenClient();

  return await new Promise((resolve, reject) => {
    client.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }

      accessToken = response.access_token;
      tokenExpiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
      updateAuthUi(true);
      resolve(accessToken);
    };

    client.error_callback = (error) => {
      reject(new Error(error?.message || "Google 授權失敗"));
    };

    client.requestAccessToken({
      prompt: forceConsent || !accessToken ? "consent" : "",
    });
  });
};

const revokeAccessToken = () => {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken);
  }
  accessToken = null;
  tokenExpiresAt = 0;
  updateAuthUi(false);
  showToast("已取消 Google 授權，本網頁未保存 token。", "info");
};

const updateAuthUi = (isAuthorized) => {
  document.querySelectorAll("[data-google-authorized]").forEach((element) => {
    element.dataset.googleAuthorized = String(isAuthorized);
  });
};

const photosFetch = async (path, options = {}) => {
  const token = await requestAccessToken();
  const response = await fetch(`${PHOTOS_PICKER_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Google Photos API 錯誤 ${response.status}: ${errorText}`);
  }

  if (response.status === 204) return null;
  return await response.json();
};

const createPickerSession = async () => {
  return await photosFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({
      pickingConfig: {
        maxItemCount: MAX_PICKED_ITEMS,
      },
    }),
  });
};

const parseDurationMs = (duration, fallbackMs) => {
  if (!duration || typeof duration !== "string") return fallbackMs;
  const seconds = Number(duration.replace(/s$/, ""));
  return Number.isFinite(seconds) ? Math.max(seconds * 1000, 1000) : fallbackMs;
};

const pollSessionUntilReady = async (session) => {
  const startedAt = Date.now();
  let current = session;
  let timeoutMs = parseDurationMs(
    session.pollingConfig?.timeoutIn,
    5 * 60 * 1000,
  );

  while (!current.mediaItemsSet) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("等待 Google 相簿選取逾時");
    }

    const waitMs = parseDurationMs(current.pollingConfig?.pollInterval, 3000);

    await new Promise((resolve) => window.setTimeout(resolve, waitMs));
    current = await photosFetch(`/sessions/${encodeURIComponent(session.id)}`);

    if (current.pollingConfig?.timeoutIn) {
      timeoutMs = parseDurationMs(current.pollingConfig.timeoutIn, timeoutMs);
    }
  }

  return current;
};

const listPickedMediaItems = async (sessionId) => {
  const items = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      sessionId,
      pageSize: "100",
    });

    if (pageToken) params.set("pageToken", pageToken);

    const result = await photosFetch(`/mediaItems?${params.toString()}`, {
      method: "GET",
    });

    items.push(...(result.mediaItems || []));
    pageToken = result.nextPageToken || "";
  } while (pageToken);

  return items;
};

const downloadPickedPhoto = async (item) => {
  const token = await requestAccessToken();
  const mediaFile = item.mediaFile;
  const response = await fetch(`${mediaFile.baseUrl}=d`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`照片下載失敗：${mediaFile.filename}`);
  }

  const blob = await response.blob();
  const fileName = mediaFile.filename || `google-photo-${item.id}.jpg`;

  return new File([blob], fileName, {
    type: blob.type || mediaFile.mimeType || "image/jpeg",
    lastModified: item.createTime ? Date.parse(item.createTime) : Date.now(),
  });
};

const deleteSession = async (sessionId) => {
  try {
    await photosFetch(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  } catch (error) {
    console.warn("Google Photos session cleanup failed:", error);
  }
};

const importFromGooglePhotos = async (processFiles) => {
  let session = null;

  try {
    await requestAccessToken();
    session = await createPickerSession();

    const pickerUri = `${session.pickerUri}/autoclose`;
    pickerWindow = window.open(
      pickerUri,
      "mpictureGooglePhotosPicker",
      "popup=yes,width=1080,height=760",
    );

    if (!pickerWindow) {
      showToast(
        "瀏覽器封鎖了 Google 相簿視窗，請允許彈出式視窗。",
        "warning",
        6000,
      );
    } else {
      pickerWindow.focus();
    }

    showToast("請在 Google 相簿視窗選取照片。", "info", 5000);
    await pollSessionUntilReady(session);

    showUploadingModal();
    const pickedItems = await listPickedMediaItems(session.id);
    const photoItems = pickedItems.filter(isGooglePhotoItem);
    const skippedCount = pickedItems.length - photoItems.length;

    if (!photoItems.length) {
      showToast("未選取可匯入的照片。", "warning");
      return;
    }

    const files = [];
    for (const item of photoItems) {
      files.push(await downloadPickedPhoto(item));
    }

    await processFiles(files);
    showToast(`已從 Google 相簿匯入 ${files.length} 張照片。`, "success");
    if (skippedCount > 0) {
      showToast(`已略過 ${skippedCount} 個非照片項目。`, "warning", 5000);
    }
  } catch (error) {
    console.error("Google Photos import failed:", error);
    hideUploadingModal();
    showToast(error.message || "Google 相簿匯入失敗。", "error", 7000);
  } finally {
    if (session?.id) {
      await deleteSession(session.id);
    }
    pickerWindow = null;
  }
};

export const initGooglePhotosImport = (processFiles) => {
  const authButton = document.getElementById("googleAuthBtn");
  const signOutButton = document.getElementById("googleSignOutBtn");
  const importButton =
    document.getElementById("googlePhotoSourceBtn") ||
    document.getElementById("fabGooglePhoto");
  const photoSourcePicker = document.getElementById("photoSourcePicker");

  authButton?.addEventListener("click", async () => {
    try {
      await requestAccessToken({ forceConsent: true });
      showToast("Google 授權完成。Token 只暫存在記憶體。", "success");
    } catch (error) {
      showToast(error.message || "Google 授權失敗。", "error", 6000);
    }
  });

  signOutButton?.addEventListener("click", revokeAccessToken);

  importButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    photoSourcePicker?.classList.remove("open");
    importFromGooglePhotos(processFiles);
  });
};
