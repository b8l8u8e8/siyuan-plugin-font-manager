const { Plugin, showMessage, Setting, Dialog } = require("siyuan");

/* ─── Constants ─── */

const PLUGIN_NAME = "siyuan-plugin-font-manager";
const STORAGE_KEY = "settings";
const FONT_DIR = `/data/public/${PLUGIN_NAME}/fonts`;
const SETTINGS_FILE = `/data/storage/petal/${PLUGIN_NAME}/${STORAGE_KEY}`;

const TOPBAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>`;

const UPLOAD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

const FONT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>`;

const FONT_EXTS = [".ttf", ".otf", ".woff2", ".woff"];
const FONT_SIZE_BASE_ATTR = "data-fm-font-size-base";
const FONT_SIZE_BASE_VAR = "--fm-base-font-size";

/* ─── Utility Functions ─── */

function safeMsg(err) {
  if (!err) return "unknown error";
  return typeof err.message === "string" ? err.message : String(err);
}

function s(v, d) {
  if (d === undefined) d = "";
  return typeof v === "string" ? v : d;
}

function getToken() {
  try {
    var token = globalThis && globalThis.siyuan && globalThis.siyuan.config &&
      globalThis.siyuan.config.api && globalThis.siyuan.config.api.token;
    return typeof token === "string" ? token : "";
  } catch (e) { return ""; }
}

function authHeaders() {
  var token = getToken();
  return token ? { Authorization: "Token " + token } : {};
}

function sanitizeFamilyName(name) {
  return String(name || "unknown")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 80);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function deriveNameFromFilename(filename) {
  var name = String(filename || "Font");
  // Remove extension
  var dotIdx = name.lastIndexOf(".");
  if (dotIdx > 0) name = name.substring(0, dotIdx);
  // Split PascalCase/camelCase
  name = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  // Replace separators
  name = name.replace(/[-_]+/g, " ");
  // Clean up
  name = name.replace(/\s+/g, " ").trim();
  return name || "Font";
}

function guessExtFromBytes(buf) {
  if (!buf || buf.byteLength < 4) return "";
  var view = new Uint8Array(buf, 0, 4);
  if (view[0] === 0x00 && view[1] === 0x01 && view[2] === 0x00 && view[3] === 0x00) return ".ttf";
  if (view[0] === 0x4F && view[1] === 0x54 && view[2] === 0x54 && view[3] === 0x4F) return ".otf";
  if (buf.byteLength >= 8) {
    var v8 = new Uint8Array(buf, 0, 8);
    if (v8[0] === 0x77 && v8[1] === 0x4F && v8[2] === 0x46 && v8[3] === 0x32) return ".woff2";
    if (v8[0] === 0x77 && v8[1] === 0x4F && v8[2] === 0x46 && v8[3] === 0x46) return ".woff";
  }
  return "";
}

function debounce(fn, delay) {
  var timer = 0;
  return function () {
    var self = this, args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function () { fn.apply(self, args); }, delay);
  };
}

function humanFileSize(bytes) {
  var n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function getWorkspaceDir() {
  try {
    return (globalThis.siyuan && globalThis.siyuan.config &&
      globalThis.siyuan.config.system && globalThis.siyuan.config.system.workspaceDir) || "";
  } catch (e) { return ""; }
}

function openDirInOS(siyuanRelPath) {
  var workspaceDir = getWorkspaceDir();
  if (!workspaceDir) { return false; }
  var absPath = workspaceDir + siyuanRelPath;
  try {
    var electron = require("electron");
    if (electron && electron.shell) {
      electron.shell.openPath(absPath);
      return true;
    }
  } catch (e) { /* not electron environment */ }
  return false;
}

function getExtFromFilename(filename) {
  var name = String(filename || "").toLowerCase();
  for (var i = 0; i < FONT_EXTS.length; i++) {
    if (name.endsWith(FONT_EXTS[i])) return FONT_EXTS[i];
  }
  return "";
}

function fontFormatFromExt(extRaw) {
  var ext = String(extRaw || "").toLowerCase();
  if (ext === ".otf") return "opentype";
  if (ext === ".woff2") return "woff2";
  if (ext === ".woff") return "woff";
  return "truetype";
}

function isReadonlyOrPublish() {
  try {
    var siyuan = globalThis && globalThis.siyuan;
    var readonly = !!(siyuan && siyuan.config && siyuan.config.readonly);
    var publish = !!(siyuan && siyuan.isPublish);
    return readonly || publish;
  } catch (e) {
    return false;
  }
}

/* ─── SiYuan File API ─── */

async function putFile(filePath, data) {
  var formData = new FormData();
  var blob;
  if (data instanceof ArrayBuffer) {
    blob = new Blob([data]);
  } else if (data instanceof Blob) {
    blob = data;
  } else {
    blob = new Blob([data]);
  }
  formData.append("path", filePath);
  formData.append("file", blob);
  var resp = await fetch("/api/file/putFile", {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });
  if (!resp.ok) throw new Error("putFile HTTP " + resp.status);
  var json = await resp.json();
  if (json.code !== 0) throw new Error(json.msg || "putFile failed");
  return json;
}

async function removeFile(filePath) {
  var resp = await fetch("/api/file/removeFile", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
    body: JSON.stringify({ path: filePath }),
  });
  if (!resp.ok) throw new Error("removeFile HTTP " + resp.status);
  var json = await resp.json();
  if (json.code !== 0) throw new Error(json.msg || "removeFile failed");
  return json;
}

/* ─── Plugin Class ─── */

class FontManagerPlugin extends Plugin {

  /* ── Lifecycle ── */

  onload() {
    this.settingsData = this.defaultSettings();
    this.injectedStyleEl = null;
    this.mainDialog = null;
    this._renderFontList = null; // callback set by UI
    this._dragCleanup = null; // drag event cleanup
    this._fontSizeObserver = null;
    this._fontSizeBaseReady = false;

    if (!isReadonlyOrPublish()) {
      this.addTopBar({
        icon: TOPBAR_ICON,
        title: this.t("fontManager"),
        callback: () => this.showFontManager(),
      });
      this.addCommand({
        langKey: "fontManager",
        langText: this.t("fontManager"),
        callback: () => this.showFontManager(),
      });
    }

    this.setting = new Setting({});
    void this.loadSettingsData().then(() => this.applyInstalledFonts());

    console.log("[font-manager] Plugin loaded");
  }

  onunload() {
    this.removeInjectedStyles();
    this.clearDomFontSizeBase();
    if (this._dragCleanup) {
      this._dragCleanup();
      this._dragCleanup = null;
    }
    if (this.mainDialog) {
      try { this.mainDialog.destroy(); } catch (e) { /* ignore */ }
      this.mainDialog = null;
    }
    console.log("[font-manager] Plugin unloaded");
  }

  async uninstall() {
    // Clean up font files in plugin directory
    try {
      await removeFile(FONT_DIR);
    } catch (e) { /* directory may not exist */ }
    // Clean up plugin settings storage file
    try {
      await removeFile(SETTINGS_FILE);
    } catch (e) { /* file may not exist */ }
  }

  openSetting() {
    this.showFontManager();
  }

  /* ── i18n ── */

  t(key, params) {
    if (!params) params = {};
    var raw = (this.i18n && this.i18n[key]) || key;
    return raw.replace(/\{\{(\w+)\}\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : "";
    });
  }

  /* ── Settings Data ── */

  defaultSettings() {
    return {
      installedFonts: [],
      activeFont: "",
      fontSizeDelta: 0,
    };
  }

  normalizeSettings(raw) {
    var d = this.defaultSettings();
    if (!raw || typeof raw !== "object") return d;

    var installed = Array.isArray(raw.installedFonts) ? raw.installedFonts : [];
    var normalizedInstalled = installed.map(function (f) {
      var item = f && typeof f === "object" ? Object.assign({}, f) : {};
      item.id = String(item.id || "");
      item.name = s(item.name, "");
      item.family = s(item.family, item.name || "");
      item.filePath = s(item.filePath, "");
      item.fileExt = s(item.fileExt, "");
      item.fileSize = Number(item.fileSize) || 0;
      item.installedAt = s(item.installedAt, "");
      return item;
    }).filter(function (f) { return !!f.id && !!f.filePath && !!f.family; });

    // Migrate from old format: globalFont + enabled boolean -> activeFont
    var activeFont = s(raw.activeFont, "");
    if (!activeFont) {
      var globalFont = s(raw.globalFont, "") || s(raw.editorFont, "") || s(raw.codeFont, "");
      if (globalFont) {
        activeFont = globalFont;
      } else {
        // Find the first enabled font from old format
        for (var i = 0; i < installed.length; i++) {
          var f = installed[i];
          if (f && f.enabled === true && f.family) {
            activeFont = f.family;
            break;
          }
        }
      }
    }

    var fontSizeDelta = Number(raw.fontSizeDelta);
    if (!isFinite(fontSizeDelta)) {
      // Legacy setting: absolute font size slider (12-24), default mapped to 16.
      var legacyFontSize = Number(raw.fontSize) || 0;
      fontSizeDelta = legacyFontSize > 0 ? (legacyFontSize - 16) : 0;
    }
    fontSizeDelta = Math.round(fontSizeDelta);
    if (fontSizeDelta < -24) fontSizeDelta = -24;
    if (fontSizeDelta > 24) fontSizeDelta = 24;

    return {
      installedFonts: normalizedInstalled,
      activeFont: activeFont,
      fontSizeDelta: fontSizeDelta,
    };
  }

  async loadSettingsData() {
    try {
      var saved = await this.loadData(STORAGE_KEY);
      this.settingsData = this.normalizeSettings(saved);
    } catch (err) {
      this.settingsData = this.defaultSettings();
      console.error("[font-manager] load settings failed:", err);
    }
  }

  async saveSettingsData() {
    try {
      await this.saveData(STORAGE_KEY, this.settingsData);
    } catch (err) {
      console.error("[font-manager] save settings failed:", err);
    }
  }

  getInstalledFont(id) {
    var sid = String(id || "");
    return this.settingsData.installedFonts.find(function (f) { return String(f.id || "") === sid; }) || null;
  }

  getInstalledFontByFamily(family) {
    return this.settingsData.installedFonts.find(function (f) { return f.family === family; }) || null;
  }

  getActiveFont() {
    var af = this.settingsData.activeFont;
    if (!af) return null;
    return this.getInstalledFontByFamily(af);
  }

  getFontStorageDir() {
    return FONT_DIR;
  }

  /* ── Font File Import ── */

  async importFontFiles(fileList) {
    var files = [];
    for (var i = 0; i < fileList.length; i++) files.push(fileList[i]);

    var importedCount = 0;
    for (var j = 0; j < files.length; j++) {
      var file = files[j];
      try {
        await this._importSingleFont(file);
        importedCount++;
      } catch (err) {
        console.error("[font-manager] import failed:", file.name, err);
        showMessage(this.t("importFailed", { msg: safeMsg(err) }), 4000);
      }
    }
    if (importedCount > 0) {
      this.applyInstalledFonts();
      await this.saveSettingsData();
      if (this._renderFontList) this._renderFontList();
    }
  }

  async _importSingleFont(file) {
    var ext = getExtFromFilename(file.name);
    if (!ext) {
      throw new Error(this.t("invalidFontFile", { name: file.name }));
    }

    var arrayBuffer = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error("FileReader error")); };
      reader.readAsArrayBuffer(file);
    });

    // Validate magic bytes
    var detectedExt = guessExtFromBytes(arrayBuffer);
    if (!detectedExt) {
      throw new Error(this.t("invalidFontFile", { name: file.name }));
    }
    // Use detected extension as truth
    ext = detectedExt;

    var displayName = deriveNameFromFilename(file.name);
    var family = displayName.replace(/['"\\]/g, "").trim() || "Font";
    var safeName = sanitizeFamilyName(displayName);

    // Check duplicate
    var existing = this.getInstalledFontByFamily(family);
    if (existing) {
      showMessage(this.t("duplicateFont", { name: displayName }), 3000);
      return;
    }

    var filePath = FONT_DIR + "/" + safeName + ext;

    // Write file
    await putFile(filePath, arrayBuffer);

    var fontRecord = {
      id: generateId(),
      name: displayName,
      family: family,
      filePath: filePath,
      fileExt: ext,
      fileSize: arrayBuffer.byteLength,
      installedAt: new Date().toISOString(),
    };

    this.settingsData.installedFonts.push(fontRecord);

    // Auto-activate if no font is active
    if (!this.settingsData.activeFont) {
      this.settingsData.activeFont = fontRecord.family;
    }

    showMessage(this.t("importSuccess", { name: displayName }), 3000);
  }

  /* ── Font Management ── */

  activateFont(id) {
    var font = this.getInstalledFont(id);
    if (!font) return;
    this.settingsData.activeFont = font.family;
    this.applyInstalledFonts();
    void this.saveSettingsData();
    if (this._renderFontList) this._renderFontList();
    showMessage(this.t("activated", { name: font.name || font.family }), 2000);
  }

  deactivateFont() {
    this.settingsData.activeFont = "";
    this.applyInstalledFonts();
    void this.saveSettingsData();
    if (this._renderFontList) this._renderFontList();
    showMessage(this.t("deactivated"), 2000);
  }

  async deleteFont(id) {
    var font = this.getInstalledFont(id);
    if (!font) return;
    var name = font.name || font.family;

    // Remove file
    if (font.filePath) {
      try {
        await removeFile(font.filePath);
      } catch (e) {
        console.warn("[font-manager] Failed to remove file:", e);
      }
    }

    // Remove from list
    var idx = this.settingsData.installedFonts.indexOf(font);
    if (idx >= 0) this.settingsData.installedFonts.splice(idx, 1);

    // Clear active if it was this font
    if (this.settingsData.activeFont === font.family) {
      this.settingsData.activeFont = "";
    }

    this.applyInstalledFonts();
    await this.saveSettingsData();
    if (this._renderFontList) this._renderFontList();
    showMessage(this.t("deleteSuccess", { name: name }), 3000);
  }

  setFontSize(delta) {
    var val = Math.round(Number(delta) || 0);
    if (val < -24) val = -24;
    if (val > 24) val = 24;
    this.settingsData.fontSizeDelta = val;
    this.applyInstalledFonts();
    void this.saveSettingsData();
  }

  getRootCssVarPx(varName, fallbackPx) {
    var fallback = Number(fallbackPx) || 0;
    try {
      if (typeof document === "undefined" || !document.documentElement || typeof getComputedStyle !== "function") return fallback;
      var raw = getComputedStyle(document.documentElement).getPropertyValue(String(varName || ""));
      var parsed = parseFloat(String(raw || "").trim());
      if (!isFinite(parsed) || parsed <= 0) return fallback;
      return parsed;
    } catch (e) {
      return fallback;
    }
  }

  formatPxValue(px) {
    var n = Math.round((Number(px) || 0) * 100) / 100;
    return String(n).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }

  isFontSizePatchTarget(el) {
    if (!(el instanceof HTMLElement)) return false;
    var tag = String(el.tagName || "").toUpperCase();
    if (
      tag === "SCRIPT" ||
      tag === "STYLE" ||
      tag === "LINK" ||
      tag === "META" ||
      tag === "NOSCRIPT" ||
      tag === "SVG" ||
      tag === "PATH" ||
      tag === "G" ||
      tag === "USE" ||
      tag === "SYMBOL" ||
      tag === "IMG" ||
      tag === "CANVAS" ||
      tag === "VIDEO" ||
      tag === "AUDIO"
    ) {
      return false;
    }
    if (el.classList && (el.classList.contains("b3-icon") || el.classList.contains("fn__icon"))) {
      return false;
    }
    return true;
  }

  captureElementBaseFontSize(el, subtractDelta) {
    if (!this.isFontSizePatchTarget(el)) return;
    try {
      var computed = getComputedStyle(el);
      if (!computed) return;
      var px = parseFloat(String(computed.fontSize || "").trim());
      if (!isFinite(px) || px <= 0) return;
      var base = px - (Number(subtractDelta) || 0);
      if (!isFinite(base) || base <= 0) return;
      el.setAttribute(FONT_SIZE_BASE_ATTR, "1");
      el.style.setProperty(FONT_SIZE_BASE_VAR, this.formatPxValue(base) + "px");
    } catch (e) { /* ignore */ }
  }

  captureDomBaseFontSizes(rootNode, subtractDelta) {
    var root = rootNode instanceof HTMLElement
      ? rootNode
      : ((typeof document !== "undefined" && document.body) ? document.body : null);
    if (!(root instanceof HTMLElement)) return;
    this.captureElementBaseFontSize(root, subtractDelta);
    var nodes = root.querySelectorAll("*");
    for (var i = 0; i < nodes.length; i++) {
      this.captureElementBaseFontSize(nodes[i], subtractDelta);
    }
  }

  ensureFontSizeObserver() {
    if (
      this._fontSizeObserver ||
      typeof MutationObserver !== "function" ||
      typeof document === "undefined" ||
      !document.body
    ) {
      return;
    }
    var plugin = this;
    this._fontSizeObserver = new MutationObserver(function (mutations) {
      var delta = Number(plugin.settingsData && plugin.settingsData.fontSizeDelta) || 0;
      if (delta === 0) return;
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        if (!added || !added.length) continue;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (!(node instanceof HTMLElement)) continue;
          // Node is already rendered with current delta, so subtract it to get stable base.
          plugin.captureDomBaseFontSizes(node, delta);
        }
      }
    });
    this._fontSizeObserver.observe(document.body, { childList: true, subtree: true });
  }

  clearDomFontSizeBase() {
    if (this._fontSizeObserver) {
      this._fontSizeObserver.disconnect();
      this._fontSizeObserver = null;
    }
    this._fontSizeBaseReady = false;
    if (typeof document === "undefined") return;
    var marked = document.querySelectorAll("[" + FONT_SIZE_BASE_ATTR + "='1']");
    for (var i = 0; i < marked.length; i++) {
      var el = marked[i];
      if (!(el instanceof HTMLElement)) continue;
      el.removeAttribute(FONT_SIZE_BASE_ATTR);
      el.style.removeProperty(FONT_SIZE_BASE_VAR);
    }
  }

  /* ── CSS Injection ── */

  toPublicUrl(filePath) {
    var path = String(filePath || "");
    if (!path || path.indexOf("/data/public/") !== 0) return "";
    var rel = path.substring("/data/public/".length);
    if (!rel) return "";
    return "/public/" + rel.split("/").map(function (seg) {
      return encodeURIComponent(seg);
    }).join("/");
  }

  applyInstalledFonts() {

    this.removeInjectedStyles();

    var rules = [];
    var rootLangSelector = [
      ":root",
      ":root:lang(zh_CN)",
      ":root:lang(zh_CHT)",
      ":root:lang(en_US)",
      ":root:lang(ja_JP)",
    ].join(",\n");

    // Apply active font globally
    var activeFamily = this.settingsData.activeFont;
    var activeFontRecord = activeFamily ? this.getInstalledFontByFamily(activeFamily) : null;
    var activeFontUrl = activeFontRecord ? this.toPublicUrl(activeFontRecord.filePath) : "";

    if (activeFontRecord && activeFontUrl) {
      var activeFormat = fontFormatFromExt(activeFontRecord.fileExt);
      rules.push(
        "@font-face {\n" +
        "  font-family: '" + activeFamily.replace(/'/g, "\\'") + "';\n" +
        "  font-weight: normal;\n" +
        "  src: url('" + activeFontUrl + "') format('" + activeFormat + "');\n" +
        "  font-style: normal;\n" +
        "  font-display: swap;\n" +
        "}"
      );
    }

    if (activeFontRecord && activeFamily && activeFontUrl) {
      var escapedFamily = activeFamily.replace(/'/g, "\\'");
      var fontStack = "'" + escapedFamily + "', 'Emojis Additional', 'Emojis Reset', BlinkMacSystemFont, Helvetica, 'PingFang SC', 'Luxi Sans', 'DejaVu Sans', 'Hiragino Sans GB', 'Source Han Sans SC', arial, 'Microsoft Yahei', sans-serif, emojis";

      rules.push(
        rootLangSelector + " {\n" +
        "  --b3-font-family: " + fontStack + " !important;\n" +
        "  --b3-font-family-code: " + fontStack + " !important;\n" +
        "}\n" +
        "body,\n" +
        "#layouts,\n" +
        ".layout,\n" +
        ".layout__center,\n" +
        ".layout-tab-container,\n" +
        ".b3-typography,\n" +
        ".protyle,\n" +
        ".protyle-title,\n" +
        ".protyle-title__input,\n" +
        ".protyle-wysiwyg [data-node-id],\n" +
        ".protyle-wysiwyg [data-node-id] *,\n" +
        ".protyle-wysiwyg [data-node-id] code,\n" +
        ".protyle-wysiwyg [data-node-id] .hljs,\n" +
        ".code-block,\n" +
        ".code-block code,\n" +
        ".code-block .hljs,\n" +
        "#layouts *:not(.b3-icon):not(.fn__icon):not([class*='icon']):not(svg):not(svg *),\n" +
        "code,\n" +
        "pre {\n" +
        "  font-family: var(--b3-font-family) !important;\n" +
        "}"
      );
    }

    // Apply font size delta to both UI and editor base sizes.
    var fontSizeDelta = Number(this.settingsData.fontSizeDelta) || 0;
    if (fontSizeDelta !== 0) {
      if (!this._fontSizeBaseReady) {
        this.captureDomBaseFontSizes(null, 0);
        this._fontSizeBaseReady = true;
      }
      this.ensureFontSizeObserver();
      var baseUiSize = this.getRootCssVarPx("--b3-font-size", 14);
      var baseEditorSize = this.getRootCssVarPx("--b3-font-size-editor", 16);
      var uiSize = Math.max(8, baseUiSize + fontSizeDelta);
      var editorSize = Math.max(8, baseEditorSize + fontSizeDelta);
      rules.push(
        rootLangSelector + " {\n" +
        "  --b3-font-size: " + this.formatPxValue(uiSize) + "px !important;\n" +
        "  --b3-font-size-editor: " + this.formatPxValue(editorSize) + "px !important;\n" +
        "}\n" +
        "[" + FONT_SIZE_BASE_ATTR + "='1'] {\n" +
        "  font-size: calc(var(" + FONT_SIZE_BASE_VAR + ") + " + this.formatPxValue(fontSizeDelta) + "px) !important;\n" +
        "}"
      );
    } else {
      this.clearDomFontSizeBase();
    }

    if (rules.length) {
      var style = document.createElement("style");
      style.id = "snippetCSS-" + PLUGIN_NAME;
      style.dataset.fontManagerInjected = "1";
      style.textContent = rules.join("\n\n");
      document.head.appendChild(style);
      this.injectedStyleEl = style;
    }

    // Preload active font
    if (activeFamily && activeFontRecord && activeFontUrl && document.fonts && typeof document.fonts.load === "function") {
      try {
        var preloadFamily = activeFamily.replace(/"/g, "");
        void document.fonts.load('16px "' + preloadFamily + '"');
      } catch (e) { /* ignore */ }
    }
  }

  removeInjectedStyles() {
    if (this.injectedStyleEl) {
      this.injectedStyleEl.remove();
      this.injectedStyleEl = null;
    }
    var styleById = document.getElementById("snippetCSS-" + PLUGIN_NAME);
    if (styleById) styleById.remove();
    document.querySelectorAll("style[data-font-manager-injected]").forEach(function (el) { el.remove(); });
    // Also clean up old font-store styles
    document.querySelectorAll("style[data-font-store-injected]").forEach(function (el) { el.remove(); });
    try {
      var rootStyle = document.documentElement && document.documentElement.style;
      if (rootStyle) {
        rootStyle.removeProperty("--b3-font-family");
        rootStyle.removeProperty("--b3-font-family-code");
        rootStyle.removeProperty("--b3-font-size");
        rootStyle.removeProperty("--b3-font-size-editor");
      }
    } catch (e) { /* ignore */ }
  }

  /* ── Confirm Dialog ── */

  showConfirmDialog(message, onConfirm) {
    var plugin = this;
    var dialog = new Dialog({
      title: "",
      content: '<div class="fm-confirm-stage"></div>',
      width: "min(420px, 90vw)",
      containerClassName: "fm-confirm-dialog",
    });

    var stage = dialog.element ? dialog.element.querySelector(".fm-confirm-stage") : null;
    if (!(stage instanceof HTMLElement)) return;

    var body = document.createElement("div");
    body.className = "fm-confirm-body";
    body.textContent = message;

    var actions = document.createElement("div");
    actions.className = "fm-confirm-actions";

    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "fm-btn";
    cancelBtn.textContent = plugin.t("cancel");
    cancelBtn.addEventListener("click", function () { dialog.destroy(); });

    var confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "fm-btn fm-btn--danger";
    confirmBtn.textContent = plugin.t("confirm");
    confirmBtn.addEventListener("click", function () {
      dialog.destroy();
      if (typeof onConfirm === "function") onConfirm();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    stage.appendChild(body);
    stage.appendChild(actions);
  }

  /* ── Font Manager Dialog ── */

  showFontManager() {
    if (this.mainDialog) {
      try { this.mainDialog.destroy(); } catch (e) { /* ignore */ }
      this.mainDialog = null;
    }

    var dialog = new Dialog({
      title: "",
      content: '<div class="fm-stage"></div>',
      width: "min(580px, 94vw)",
      containerClassName: "fm-dialog",
      destroyCallback: () => {
        if (this.mainDialog === dialog) this.mainDialog = null;
        this._renderFontList = null;
        if (this._dragCleanup) {
          this._dragCleanup();
          this._dragCleanup = null;
        }
      },
    });
    this.mainDialog = dialog;

    var stage = dialog.element ? dialog.element.querySelector(".fm-stage") : null;
    if (!(stage instanceof HTMLElement)) return;

    this._mountManagerUI(stage);
  }

  _mountManagerUI(stage) {
    var plugin = this;

    // Root
    var root = document.createElement("div");
    root.className = "fm-root";

    // ── Header ──
    var header = document.createElement("div");
    header.className = "fm-header";

    var headerLeft = document.createElement("div");
    headerLeft.className = "fm-header-left";

    var headerIcon = document.createElement("div");
    headerIcon.className = "fm-header-icon";
    headerIcon.innerHTML = FONT_ICON;

    var title = document.createElement("div");
    title.className = "fm-title";
    title.textContent = plugin.t("fontManager");

    headerLeft.appendChild(headerIcon);
    headerLeft.appendChild(title);

    var badge = document.createElement("div");
    badge.className = "fm-header-badge";
    badge.textContent = plugin.settingsData.installedFonts.length + " fonts";

    header.appendChild(headerLeft);
    header.appendChild(badge);

    // ── Content ──
    var content = document.createElement("div");
    content.className = "fm-content";

    // ── Drop Zone ──
    var dropzone = document.createElement("div");
    dropzone.className = "fm-dropzone";

    var dzIcon = document.createElement("div");
    dzIcon.className = "fm-dropzone-icon";
    dzIcon.innerHTML = UPLOAD_ICON;

    var dzText = document.createElement("div");
    dzText.className = "fm-dropzone-text";
    dzText.textContent = plugin.t("dropHint");

    var dzSub = document.createElement("div");
    dzSub.className = "fm-dropzone-sub";
    dzSub.textContent = plugin.t("dropHintSub");

    var dzBtn = document.createElement("button");
    dzBtn.type = "button";
    dzBtn.className = "fm-dropzone-btn";
    dzBtn.textContent = plugin.t("browseFiles");

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.accept = ".ttf,.otf,.woff,.woff2";
    fileInput.style.display = "none";

    dropzone.appendChild(dzIcon);
    dropzone.appendChild(dzText);
    dropzone.appendChild(dzSub);
    dropzone.appendChild(dzBtn);
    dropzone.appendChild(fileInput);

    // Drop zone events
    dropzone.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add("fm-dropzone--over");
    });
    dropzone.addEventListener("dragleave", function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("fm-dropzone--over");
    });
    dropzone.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("fm-dropzone--over");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        void plugin.importFontFiles(e.dataTransfer.files);
      }
    });
    dzBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      fileInput.click();
    });
    dropzone.addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      if (fileInput.files && fileInput.files.length > 0) {
        void plugin.importFontFiles(fileInput.files);
        fileInput.value = "";
      }
    });

    // ── Font List Section ──
    var fontSection = document.createElement("div");
    fontSection.className = "fm-section";

    var fontListContainer = document.createElement("div");
    fontListContainer.className = "fm-font-list";

    fontSection.appendChild(fontListContainer);

    // ── Font Size Section ──
    var sizeSection = document.createElement("div");
    sizeSection.className = "fm-section fm-size-section";

    var sizeTitle = document.createElement("div");
    sizeTitle.className = "fm-section-title";
    sizeTitle.textContent = plugin.t("fontSize");

    var sizeControl = document.createElement("div");
    sizeControl.className = "fm-size-control";

    var sizeSlider = document.createElement("input");
    sizeSlider.type = "range";
    sizeSlider.className = "fm-size-slider";
    sizeSlider.min = "-8";
    sizeSlider.max = "8";
    sizeSlider.step = "1";
    sizeSlider.value = String(plugin.settingsData.fontSizeDelta || 0);

    var sizeDisplay = document.createElement("span");
    sizeDisplay.className = "fm-size-display";
    var formatSizeDeltaLabel = function (delta) {
      var val = Number(delta) || 0;
      if (val === 0) return plugin.t("default");
      return (val > 0 ? "+" : "") + String(val) + "px";
    };
    sizeDisplay.textContent = formatSizeDeltaLabel(plugin.settingsData.fontSizeDelta || 0);

    var sizeReset = document.createElement("button");
    sizeReset.type = "button";
    sizeReset.className = "fm-size-reset";
    sizeReset.textContent = plugin.t("resetDefault");

    var debouncedSetSize = debounce(function (val) {
      plugin.setFontSize(val);
    }, 300);

    sizeSlider.addEventListener("input", function () {
      var val = parseInt(sizeSlider.value, 10);
      sizeDisplay.textContent = formatSizeDeltaLabel(val);
      debouncedSetSize(val);
    });

    sizeReset.addEventListener("click", function () {
      plugin.setFontSize(0);
      sizeSlider.value = "0";
      sizeDisplay.textContent = plugin.t("default");
      showMessage(plugin.t("fontSizeReset"), 2000);
    });

    sizeControl.appendChild(sizeSlider);
    sizeControl.appendChild(sizeDisplay);
    sizeControl.appendChild(sizeReset);

    sizeSection.appendChild(sizeTitle);
    sizeSection.appendChild(sizeControl);

    // ── Assemble content ──
    content.appendChild(dropzone);
    content.appendChild(fontSection);
    content.appendChild(sizeSection);

    // ── Footer ──
    var footer = document.createElement("div");
    footer.className = "fm-footer";

    var footerLabel = document.createElement("span");
    footerLabel.className = "fm-footer-label";
    footerLabel.textContent = plugin.t("fontStorage");

    var footerPath = document.createElement("span");
    footerPath.className = "fm-footer-path";
    footerPath.textContent = plugin.getFontStorageDir();

    var footerOpen = document.createElement("button");
    footerOpen.type = "button";
    footerOpen.className = "fm-footer-copy";
    footerOpen.textContent = plugin.t("openFolder");
    footerOpen.addEventListener("click", function () {
      var ok = openDirInOS(plugin.getFontStorageDir());
      if (!ok) showMessage(plugin.t("openFolderFailed"), 3000);
    });

    footer.appendChild(footerLabel);
    footer.appendChild(footerPath);
    footer.appendChild(footerOpen);

    // ── Assemble root ──
    root.appendChild(header);
    root.appendChild(content);
    root.appendChild(footer);
    stage.appendChild(root);

    // ── Enable drag on desktop ──
    (function () {
      var container = stage.closest('.b3-dialog__container');
      if (!container) return;

      var isDragging = false;
      var offsetX = 0, offsetY = 0;

      header.style.cursor = 'move';
      header.style.userSelect = 'none';

      function onMouseDown(e) {
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a')) return;
        isDragging = true;
        var rect = container.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        container.style.position = 'fixed';
        container.style.left = rect.left + 'px';
        container.style.top = rect.top + 'px';
        container.style.transform = 'none';
        container.style.margin = '0';
        container.style.transition = 'none';
        e.preventDefault();
      }

      function onMouseMove(e) {
        if (!isDragging) return;
        container.style.left = (e.clientX - offsetX) + 'px';
        container.style.top = (e.clientY - offsetY) + 'px';
      }

      function onMouseUp() {
        if (!isDragging) return;
        isDragging = false;
        container.style.transition = '';
      }

      header.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      plugin._dragCleanup = function () {
        header.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
    })();

    // ── Render font list ──
    function renderFontList() {
      fontListContainer.innerHTML = "";

      var installed = plugin.settingsData.installedFonts;
      var activeFamily = plugin.settingsData.activeFont;

      // Update badge
      badge.textContent = installed.length + " fonts";

      // Default (System) card - always first
      var defaultCard = createFontCard(null, true, !activeFamily);
      fontListContainer.appendChild(defaultCard);

      if (installed.length === 0) {
        // Empty state
        var empty = document.createElement("div");
        empty.className = "fm-empty";

        var emptyIcon = document.createElement("div");
        emptyIcon.className = "fm-empty-icon";
        emptyIcon.innerHTML = FONT_ICON;

        var emptyText = document.createElement("div");
        emptyText.className = "fm-empty-text";
        emptyText.textContent = plugin.t("noFontsYet");

        var emptyHint = document.createElement("div");
        emptyHint.className = "fm-empty-hint";
        emptyHint.textContent = plugin.t("noFontsHint");

        empty.appendChild(emptyIcon);
        empty.appendChild(emptyText);
        empty.appendChild(emptyHint);
        fontListContainer.appendChild(empty);
      } else {
        installed.forEach(function (font) {
          var isActive = font.family === activeFamily;
          var card = createFontCard(font, false, isActive);
          fontListContainer.appendChild(card);
        });
      }
    }

    function createFontCard(font, isDefault, isActive) {
      var card = document.createElement("div");
      card.className = "fm-font-card" + (isActive ? " is-active" : "");

      // Radio
      var radio = document.createElement("div");
      radio.className = "fm-radio" + (isActive ? " is-checked" : "");

      // Info
      var info = document.createElement("div");
      info.className = "fm-font-info";

      var name = document.createElement("div");
      name.className = "fm-font-name";
      name.textContent = isDefault ? plugin.t("defaultFont") : (font.name || font.family);

      info.appendChild(name);

      // File size meta (for imported fonts only)
      if (!isDefault && font && font.fileSize > 0) {
        var meta = document.createElement("div");
        meta.className = "fm-font-meta";
        meta.textContent = humanFileSize(font.fileSize);
        info.appendChild(meta);
      }

      card.appendChild(radio);
      card.appendChild(info);

      // Delete button (not for default)
      if (!isDefault && font) {
        var deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "fm-delete-btn";
        deleteBtn.innerHTML = TRASH_ICON;
        deleteBtn.title = plugin.t("delete");
        deleteBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          plugin.showConfirmDialog(
            plugin.t("confirmDelete", { name: font.name || font.family }),
            function () {
              void plugin.deleteFont(font.id);
            }
          );
        });
        card.appendChild(deleteBtn);
      }

      // Click to activate
      card.addEventListener("click", function () {
        if (isDefault) {
          if (plugin.settingsData.activeFont) {
            plugin.deactivateFont();
          }
        } else if (font) {
          plugin.activateFont(font.id);
        }
      });

      return card;
    }

    // Register the render callback
    plugin._renderFontList = renderFontList;

    // Initial render
    renderFontList();
  }
}

module.exports = FontManagerPlugin;
