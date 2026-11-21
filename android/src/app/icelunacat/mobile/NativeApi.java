package app.icelunacat.mobile;

import android.util.Base64;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

final class NativeApi {
    private static final int CHUNK_BYTES = 24 * 1024;
    private static final String[] REQUEST_HEADERS = {
        "authorization", "x-api-key", "content-type", "anthropic-version"
    };
    private final ConcurrentHashMap<String, Call> calls = new ConcurrentHashMap<>();
    private final ExecutorService workers = Executors.newFixedThreadPool(4);

    JSONObject handle(JSONObject message) throws Exception {
        String id = message.getString("id");
        if (!id.matches("[0-9a-f-]{36}")) return error("无效的兼容模式请求。");
        switch (message.getString("action")) {
            case "start":
                if (calls.size() >= 12 || calls.containsKey(id))
                    return error("当前 API 请求较多，请稍后重试。");
                URL url = new URL(message.getString("url"));
                String method = message.getString("method");
                if (!allowed(url, method)) return error("原生兼容模式只支持 HTTPS 模型 API。");
                Call call = new Call();
                calls.put(id, call);
                call.task = workers.submit(() -> run(call, url, method, message));
                return event("pending");
            case "read":
                Call pending = calls.get(id);
                if (pending == null) return event("end");
                JSONObject next = pending.events.poll();
                if (next == null) return event("pending");
                String type = next.optString("type");
                if ("error".equals(type) || "end".equals(type)) calls.remove(id, pending);
                return next;
            case "cancel":
                cancel(id);
                return event("end");
            default:
                return error("未知的兼容模式请求。");
        }
    }

    private static boolean allowed(URL url, String method) {
        if (!"https".equals(url.getProtocol()) || url.getHost().isEmpty()
            || url.getUserInfo() != null || url.getRef() != null) return false;
        if ("GET".equals(method)) return url.getPath().endsWith("/models");
        return "POST".equals(method) && url.getQuery() == null
            && (url.getPath().endsWith("/chat/completions")
                || url.getPath().endsWith("/messages")
                || url.getPath().endsWith("/images/generations"));
    }

    private static JSONObject event(String type) {
        return new JSONObject(Collections.singletonMap("type", type));
    }

    private static JSONObject error(String message) {
        JSONObject event = event("error");
        try { event.put("message", message); } catch (Exception ignored) {}
        return event;
    }

    private void run(Call call, URL url, String method, JSONObject request) {
        try {
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            call.connection = connection;
            if (Thread.currentThread().isInterrupted()) return;
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(120_000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("User-Agent", "IceLunaCat-Android/0.1.5");
            JSONObject headers = request.getJSONObject("headers");
            for (String name : REQUEST_HEADERS) {
                String value = headers.optString(name);
                if (!value.isEmpty()) connection.setRequestProperty(name, value);
            }
            if ("POST".equals(method)) {
                byte[] data = request.getString("body").getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(data.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(data);
                }
            }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                call.events.put(error("API 返回了重定向，兼容模式不会转发密钥到其他地址。"));
                return;
            }
            String contentType = connection.getContentType();
            call.events.put(event("headers").put("status", status).put("contentType",
                contentType == null ? "application/json" : contentType));
            try (InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                if (stream != null) {
                    byte[] buffer = new byte[CHUNK_BYTES];
                    int length;
                    while ((length = stream.read(buffer)) >= 0) {
                        if (length == 0) continue;
                        call.events.put(event("data").put("bytes",
                            Base64.encodeToString(buffer, 0, length, Base64.NO_WRAP)));
                    }
                }
            }
            call.events.put(event("end"));
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        } catch (Exception ex) {
            try {
                call.events.put(error("Android 原生网络无法连接此 API。请检查 HTTPS 地址和网络后重试。"));
            } catch (InterruptedException stopped) {
                Thread.currentThread().interrupt();
            }
        } finally {
            HttpURLConnection connection = call.connection;
            if (connection != null) connection.disconnect();
        }
    }

    private void cancel(String id) {
        Call call = calls.remove(id);
        if (call == null) return;
        if (call.task != null) call.task.cancel(true);
        HttpURLConnection connection = call.connection;
        if (connection != null) new Thread(connection::disconnect, "IceLunaCat network cancel").start();
    }

    void close() {
        for (String id : calls.keySet()) cancel(id);
        workers.shutdownNow();
    }

    private static final class Call {
        final ArrayBlockingQueue<JSONObject> events = new ArrayBlockingQueue<>(8);
        volatile HttpURLConnection connection;
        Future<?> task;
    }
}
