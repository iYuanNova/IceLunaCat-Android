package app.icelunacat.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JsPromptResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private static final int OPEN_FILE = 1;
    private static final int CREATE_FILE = 2;
    private FrameLayout root;
    private WebView web;
    private final NativeApi nativeApi = new NativeApi();
    private boolean pageReady;
    private int safeLeft, safeTop, safeRight, safeBottom, keyboardBottom;
    private ValueCallback<Uri[]> upload;
    private File saving;
    private OutputStream saveStream;
    private String saveName;
    private String saveType;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        configureEdgeToEdge();
        root.setOnApplyWindowInsetsListener((view, insets) -> captureInsets(insets));
        setContentView(root);
        root.requestApplyInsets();
        boolean systemDark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        applySystemBars(getPreferences(MODE_PRIVATE).getBoolean("darkBars", systemDark));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setUseWideViewPort(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString() + " IceLunaCatAndroid/3");
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageCommitVisible(WebView view, String url) {
                pageReady = local(Uri.parse(url));
                syncSafeAreas();
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (local(uri)) return false;
                if (request.isForMainFrame()) openExternal(uri);
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!local(uri)) return null;
                String path = uri.getPath();
                if ("/".equals(path)) path = "/index.html";
                if (path != null && (path.equals("/index.html") || path.equals("/favicon.svg")
                    || (path.startsWith("/static/") && !path.contains("..")))) {
                    try {
                        String mime = mimeType(path);
                        InputStream data = getAssets().open("site" + path);
                        return new WebResourceResponse(mime, mime.startsWith("text/")
                            || mime.equals("application/javascript") || mime.equals("image/svg+xml")
                            ? "UTF-8" : null, 200, "OK", Collections.singletonMap(
                            "Content-Security-Policy", "frame-src 'none'; object-src 'none'; base-uri 'self'"), data);
                    } catch (IOException ignored) {
                        // A missing local asset must never fall back to the network.
                    }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                       FileChooserParams params) {
                if (upload != null) upload.onReceiveValue(null);
                upload = callback;
                try {
                    startActivityForResult(params.createIntent(), OPEN_FILE);
                } catch (ActivityNotFoundException ex) {
                    upload.onReceiveValue(null);
                    upload = null;
                    tell("找不到系统文件选择器。");
                }
                return true;
            }

            @Override public boolean onJsPrompt(WebView view, String url, String message, String json,
                                               JsPromptResult result) {
                boolean bars = "IceLunaCat:system-bars".equals(message);
                boolean nativeRequest = "IceLunaCat:api".equals(message);
                if (!bars && !nativeRequest && !"IceLunaCat:save".equals(message)) return false;
                if (!local(Uri.parse(url))) {
                    result.cancel();
                    return true;
                }
                if (nativeRequest) {
                    try {
                        result.confirm(nativeApi.handle(new JSONObject(json)).toString());
                    } catch (Exception ex) {
                        result.confirm("{\"type\":\"error\",\"message\":\"无法处理原生网络请求。\"}");
                    }
                    return true;
                }
                if (bars) {
                    if ("dark".equals(json) || "light".equals(json)) {
                        boolean dark = "dark".equals(json);
                        applySystemBars(dark);
                        getPreferences(MODE_PRIVATE).edit().putBoolean("darkBars", dark).apply();
                        result.confirm("ok");
                    } else {
                        result.cancel();
                    }
                    return true;
                }
                try {
                    handleSave(new JSONObject(json));
                    result.confirm("ok");
                } catch (Exception ex) {
                    discardSave();
                    result.cancel();
                }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> openExternal(Uri.parse(url)));
        web.loadUrl(HOME);
    }

    private void configureEdgeToEdge() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attributes);
        }
    }

    private WindowInsets captureInsets(WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= 30) {
            int bars = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout();
            int ime = WindowInsets.Type.ime();
            Insets safe = insets.getInsets(bars);
            updateSafeAreas(safe.left, safe.top, safe.right, safe.bottom, insets.getInsets(ime).bottom);
            // CSS owns these insets. Pass zero values down so WebView does not add them again.
            return new WindowInsets.Builder(insets).setInsets(bars | ime, Insets.NONE).build();
        }
        int bottom = insets.getSystemWindowInsetBottom();
        int nav = Math.min(bottom, insets.getStableInsetBottom());
        updateSafeAreas(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
            insets.getSystemWindowInsetRight(), nav, bottom > nav ? bottom : 0);
        WindowInsets handled = insets.replaceSystemWindowInsets(0, 0, 0, 0);
        return Build.VERSION.SDK_INT >= 28 ? handled.consumeDisplayCutout() : handled;
    }

    private void updateSafeAreas(int left, int top, int right, int bottom, int keyboard) {
        if (safeLeft == left && safeTop == top && safeRight == right && safeBottom == bottom
            && keyboardBottom == keyboard) return;
        safeLeft = left;
        safeTop = top;
        safeRight = right;
        safeBottom = bottom;
        keyboardBottom = keyboard;
        syncSafeAreas();
    }

    private void syncSafeAreas() {
        if (!pageReady || web.getUrl() == null || !local(Uri.parse(web.getUrl()))) return;
        double density = getResources().getDisplayMetrics().density;
        web.evaluateJavascript("(function(){const root=document.documentElement;const style=root.style;"
            + "style.setProperty('--android-safe-left','" + safeLeft / density + "px');"
            + "style.setProperty('--android-safe-top','" + safeTop / density + "px');"
            + "style.setProperty('--android-safe-right','" + safeRight / density + "px');"
            + "style.setProperty('--android-safe-bottom','" + safeBottom / density + "px');"
            + "style.setProperty('--android-keyboard-bottom','" + keyboardBottom / density + "px');"
            + "root.classList.add('android-edge');}())", null);
    }

    private void applySystemBars(boolean dark) {
        int background = dark ? 0xff181a20 : Color.WHITE;
        root.setBackgroundColor(background);
        web.setBackgroundColor(background);

        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 28) window.setNavigationBarDividerColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(dark ? 0 : flags, flags);
            }
        } else {
            View decor = window.getDecorView();
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            int previous = decor.getSystemUiVisibility();
            decor.setSystemUiVisibility(dark ? previous & ~flags : previous | flags);
        }
    }

    private static boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getEncodedAuthority());
    }

    private static String mimeType(String path) {
        String extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (extension) {
            case "html": return "text/html";
            case "css": return "text/css";
            case "js": return "application/javascript";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "webp": return "image/webp";
            case "woff": return "font/woff";
            case "woff2": return "font/woff2";
            case "ttf": return "font/ttf";
            default: return "application/octet-stream";
        }
    }

    private void openExternal(Uri uri) {
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ex) {
            tell("找不到可以打开链接的应用。");
        }
    }

    private void handleSave(JSONObject request) throws Exception {
        switch (request.getString("action")) {
            case "start":
                if (saving != null) throw new IOException("A save is already pending");
                saveName = request.getString("filename").replace('/', '_').replace('\\', '_');
                saveType = request.optString("mime", "application/octet-stream");
                if (!saveType.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")) saveType = "application/octet-stream";
                saving = File.createTempFile("icelunacat-", ".download", getCacheDir());
                saveStream = new FileOutputStream(saving);
                break;
            case "data":
                if (saveStream == null) throw new IOException("No pending save");
                saveStream.write(Base64.decode(request.getString("bytes"), Base64.DEFAULT));
                break;
            case "finish":
                if (saveStream == null) throw new IOException("No pending save");
                saveStream.close();
                saveStream = null;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(saveType);
                intent.putExtra(Intent.EXTRA_TITLE, saveName);
                startActivityForResult(intent, CREATE_FILE);
                break;
            case "cancel":
                discardSave();
                break;
            default:
                throw new IOException("Unknown save action");
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == OPEN_FILE && upload != null) {
            ValueCallback<Uri[]> callback = upload;
            upload = null;
            callback.onReceiveValue(selectedFiles(result, data));
        } else if (request == CREATE_FILE && saving != null) {
            File source = saving;
            saving = null;
            if (result != RESULT_OK || data == null || data.getData() == null) {
                source.delete();
                return;
            }
            Uri target = data.getData();
            new Thread(() -> {
                try (OutputStream output = getContentResolver().openOutputStream(target)) {
                    if (output == null) throw new IOException("No file output stream");
                    Files.copy(source.toPath(), output);
                    runOnUiThread(() -> tell("文件已保存"));
                } catch (IOException | SecurityException ex) {
                    runOnUiThread(() -> tell("保存失败，请重试。"));
                } finally {
                    source.delete();
                }
            }, "IceLunaCat file export").start();
        }
    }

    private static Uri[] selectedFiles(int result, Intent data) {
        if (result != RESULT_OK || data == null) return null;

        // The photo picker can return ClipData even when only one photo is selected.
        ClipData selection = data.getClipData();
        if (selection != null) {
            LinkedHashSet<Uri> files = new LinkedHashSet<>();
            for (int i = 0; i < selection.getItemCount(); i++) {
                Uri uri = selection.getItemAt(i).getUri();
                if (uri != null) files.add(uri);
            }
            if (!files.isEmpty()) return files.toArray(new Uri[0]);
        }

        Uri uri = data.getData();
        return uri == null ? null : new Uri[] {uri};
    }

    private void tell(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void discardSave() {
        if (saveStream != null) {
            try { saveStream.close(); } catch (IOException ignored) {}
            saveStream = null;
        }
        if (saving != null) {
            saving.delete();
            saving = null;
        }
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (upload != null) upload.onReceiveValue(null);
        discardSave();
        nativeApi.close();
        web.destroy();
        super.onDestroy();
    }
}
