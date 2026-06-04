package com.waypointmap.api.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.waypointmap.api.model.FeatureAuditResponse;
import com.waypointmap.api.model.MissionPreviewResponse;
import com.waypointmap.api.service.KmzBuilderService;
import com.waypointmap.api.service.LawnmowerService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
public class ReverseEngineeringController {

    private final LawnmowerService lawnmower;
    private final KmzBuilderService kmzBuilder;
    private final ObjectMapper jackson = new ObjectMapper();

    // Cache the last generated KMZ for phone download
    private volatile byte[] lastKmzBytes;
    private volatile String lastKmzFilename = "mission.kmz";

    public ReverseEngineeringController(LawnmowerService lawnmower, KmzBuilderService kmzBuilder) {
        this.lawnmower = lawnmower;
        this.kmzBuilder = kmzBuilder;
    }

    // ─── Feature audit ────────────────────────────────────────────────────────

    @GetMapping("/api/reverse-engineering/features")
    public FeatureAuditResponse featureAudit() {
        return new FeatureAuditResponse(
                "1.4.1S legacy / 2.1.1RL advanced",
                false,
                List.of(
                        "Custom shape selections",
                        "Generated waypoint loops and grids",
                        "Per-waypoint editing",
                        "Undo/redo/reset workflow",
                        "Simple/Advanced/Download tabs",
                        "KMZ export/import",
                        "Terrain-aware flight-height adjustment",
                        "Travel-direction changes",
                        "Waypoint actions for camera control",
                        "Preset-oriented advanced settings",
                        "Mission persistence",
                        "Automatic mission installer",
                        "Developer API"
                ),
                List.of(
                        "Exact premium-gated workflows",
                        "Original KMZ serialization details",
                        "Mission installer binary",
                        "Server-side auth and persistence rules"
                )
        );
    }

    @GetMapping("/api/missions/mock")
    public MissionPreviewResponse mockMission() {
        return new MissionPreviewResponse(
                "mission-1",
                "WaypointMap Public Replica",
                List.of("Polygon", "Rectangle"),
                24,
                "DJI KMZ preview"
        );
    }

    // ─── GeneratePoints ───────────────────────────────────────────────────────

    @PostMapping("/Home/GeneratePoints")
    public List<Map<String, Object>> generatePoints(@RequestParam MultiValueMap<String, String> formData) {
        String boundsType   = firstValue(formData, "boundsType",          "polygon");
        String bounds       = firstValue(formData, "bounds",              "");
        int startingIndex   = parseInt(firstValue(formData, "in_startingIndex",       "1"),  1);
        double altitude     = parseDouble(firstValue(formData, "altitude",            "60"), 60);
        double speed        = parseDouble(firstValue(formData, "speed",               "3.5"), 3.5);
        double gimbalAngle  = parseDouble(firstValue(formData, "angle",               "-45"), -45);
        double lineSpacingM = parseDouble(firstValue(formData, "in_distance",         "20"),  20);
        double pointSpacing = parseDouble(firstValue(formData, "in_pointSpacing",     "0"),    0);
        int orientation     = parseInt(firstValue(formData, "in_lineOrientation",     "0"),   0);
        double angleDeg     = parseDouble(firstValue(formData, "in_lineAngleDegrees", "0"),   0);
        String lineAngleMode = firstValue(formData, "in_lineAngleMode",   "preset");
        boolean flipPath    = parseBoolean(firstValue(formData, "in_flipPath",        "false"));
        boolean maintainAlt = parseBoolean(firstValue(formData, "in_maintainAlt",     "false"));
        boolean straighten  = parseBoolean(firstValue(formData, "in_straightenLines", "false"));
        boolean genAll      = parseBoolean(firstValue(formData, "in_generateAllPoints","false"));
        String allAction    = firstValue(formData, "in_allPointsAction",  "noAction");
        String turnMode     = firstValue(formData, "in_turnMode",         "coordinateTurn");
        double circleRadius = parseDouble(firstValue(formData, "circleRadius",        "0"),   0);
        String circleCenter = firstValue(formData, "circleCenter",        "");

        List<double[]> polygon = parsePolygon(bounds);
        double[] center = parseCenter(circleCenter);

        LawnmowerService.GenerateRequest req = new LawnmowerService.GenerateRequest(
                polygon, boundsType, circleRadius, center,
                altitude, speed, gimbalAngle,
                lineSpacingM, pointSpacing > 0 ? pointSpacing : lineSpacingM,
                orientation, angleDeg, lineAngleMode,
                flipPath, maintainAlt, straighten,
                genAll, allAction, turnMode, startingIndex
        );

        List<LawnmowerService.WaypointResult> wps = lawnmower.generate(req);

        // Convert to the original response shape expected by the frontend
        List<Map<String, Object>> response = new ArrayList<>();
        for (LawnmowerService.WaypointResult wp : wps) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id",                       wp.id());
            row.put("Latitude",                 wp.latitude());
            row.put("Longitude",                wp.longitude());
            row.put("altitude",                 wp.altitude());
            row.put("speed",                    wp.speed());
            row.put("gimbalAngle",              wp.gimbalAngle());
            row.put("heading",                  wp.heading());
            row.put("action",                   wp.action());
            row.put("turnMode",                 wp.turnMode());
            row.put("useStraightLine",          wp.useStraightLine());
            row.put("waypointTurnDampingDist",  wp.waypointTurnDampingDist());
            response.add(row);
        }
        return response;
    }

    // ─── Download KMZ ────────────────────────────────────────────────────────

    @PostMapping(value = "/Download", produces = "application/vnd.google-earth.kmz")
    public ResponseEntity<byte[]> downloadMission(@RequestParam MultiValueMap<String, String> formData) {
        String missionName    = firstValue(formData, "missionName",     "WaypointMap Mission");
        double altitude       = parseDouble(firstValue(formData, "altitude", "60"),  60);
        double speed          = parseDouble(firstValue(formData, "speed",    "3.5"), 3.5);
        double gimbalAngle    = parseDouble(firstValue(formData, "angle",    "-45"), -45);
        String finishStr      = firstValue(formData, "finalAction",  "goHome");
        boolean useRtk        = parseBoolean(firstValue(formData, "useRtkHeight", "false"));
        String waypointsJson  = firstValue(formData, "waypoints",    "[]");

        KmzBuilderService.FinishAction finish = switch (finishStr) {
            case "hover"     -> KmzBuilderService.FinishAction.HOVER;
            case "autoLand"  -> KmzBuilderService.FinishAction.AUTO_LAND;
            default          -> KmzBuilderService.FinishAction.GO_HOME;
        };

        List<LawnmowerService.WaypointResult> waypoints = parseWaypointsJson(waypointsJson, altitude, speed, gimbalAngle);

        KmzBuilderService.BuildRequest buildReq = new KmzBuilderService.BuildRequest(
                waypoints, missionName, altitude, speed, gimbalAngle, finish, useRtk
        );

        try {
            byte[] kmzBytes = kmzBuilder.build(buildReq);
            String filename = sanitizeFilename(missionName) + ".kmz";

            // Cache for phone download
            lastKmzBytes = kmzBytes;
            lastKmzFilename = filename;

            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            ContentDisposition.attachment().filename(filename).build().toString())
                    .contentType(MediaType.parseMediaType("application/vnd.google-earth.kmz"))
                    .body(kmzBytes);
        } catch (IOException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    // ─── Import KMZ ──────────────────────────────────────────────────────────

    @PostMapping("/Home/ImportKmzSmart")
    public Map<String, Object> importKmzSmart(@RequestParam("file") MultipartFile file) {
        try {
            byte[] bytes = file.getBytes();
            KmzBuilderService.ImportResult result = kmzBuilder.importKmz(bytes);
            KmzBuilderService.KmlOverlayResult overlayResult = kmzBuilder.importKmlOverlays(bytes);

            List<Map<String, Object>> wps = new ArrayList<>();
            for (KmzBuilderService.WpImport w : result.waypoints()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("id",          w.index());
                row.put("Latitude",    w.lat());
                row.put("Longitude",   w.lng());
                row.put("altitude",    w.altitude());
                row.put("speed",       w.speed());
                row.put("gimbalAngle", w.gimbalAngle());
                row.put("heading",     w.heading());
                row.put("action",      "noAction");
                row.put("turnMode",    "coordinateTurn");
                row.put("useStraightLine", 0);
                row.put("waypointTurnDampingDist", 0.2);
                wps.add(row);
            }

            List<Map<String, Object>> overlayMaps = new ArrayList<>();
            for (KmzBuilderService.OverlayShape o : overlayResult.overlays()) {
                Map<String, Object> om = new LinkedHashMap<>();
                om.put("name", o.name());
                om.put("type", o.type());
                List<Map<String, Double>> path = new ArrayList<>();
                for (double[] pt : o.path()) {
                    Map<String, Double> p = new LinkedHashMap<>();
                    p.put("lat", pt[0]);
                    p.put("lng", pt[1]);
                    path.add(p);
                }
                om.put("path", path);
                overlayMaps.add(om);
            }

            boolean hasWps = !wps.isEmpty();
            boolean hasOverlays = !overlayMaps.isEmpty();

            if (!hasWps && hasOverlays) {
                return Map.of(
                        "kind",      "overlay",
                        "missionName", overlayResult.missionName(),
                        "overlays",  overlayMaps
                );
            } else if (hasWps && hasOverlays) {
                Map<String, Object> resp = new LinkedHashMap<>();
                resp.put("missionName",   result.missionName());
                resp.put("waypointCount", result.waypoints().size());
                resp.put("waypoints",     wps);
                resp.put("overlays",      overlayMaps);
                resp.put("source",        "KmzBuilderService");
                return resp;
            } else {
                return Map.of(
                        "missionName",   result.missionName(),
                        "waypointCount", result.waypoints().size(),
                        "waypoints",     wps,
                        "source",        "KmzBuilderService"
                );
            }
        } catch (IOException e) {
            return Map.of(
                    "missionName",   file.getOriginalFilename() == null ? "Imported" : file.getOriginalFilename(),
                    "waypointCount", 0,
                    "waypoints",     List.of(),
                    "error",         e.getMessage()
            );
        }
    }

    @PostMapping(value = "/Home/DownloadSplit", produces = "application/zip")
    public ResponseEntity<byte[]> downloadSplit(@RequestParam MultiValueMap<String, String> formData) {
        String missionName   = firstValue(formData, "missionName",     "WaypointMap Mission");
        double altitude      = parseDouble(firstValue(formData, "altitude", "60"),  60);
        double speed         = parseDouble(firstValue(formData, "speed",    "3.5"), 3.5);
        double gimbalAngle   = parseDouble(firstValue(formData, "angle",    "-45"), -45);
        String finishStr     = firstValue(formData, "finalAction",  "goHome");
        boolean useRtk       = parseBoolean(firstValue(formData, "useRtkHeight", "false"));
        String waypointsJson = firstValue(formData, "waypoints",    "[]");
        String splitMode     = firstValue(formData, "splitMode",    "waypoints");
        float batteryMinutes = (float) parseDouble(firstValue(formData, "batteryMinutes", "20"), 20);
        int maxWaypoints     = parseInt(firstValue(formData, "maxWaypoints", "99"), 99);
        boolean rthResume    = parseBoolean(firstValue(formData, "rthResume", "false"));

        KmzBuilderService.FinishAction finish = switch (finishStr) {
            case "hover"     -> KmzBuilderService.FinishAction.HOVER;
            case "autoLand"  -> KmzBuilderService.FinishAction.AUTO_LAND;
            default          -> KmzBuilderService.FinishAction.GO_HOME;
        };

        List<LawnmowerService.WaypointResult> waypoints = parseWaypointsJson(waypointsJson, altitude, speed, gimbalAngle);

        List<List<LawnmowerService.WaypointResult>> segments;
        if ("battery".equals(splitMode)) {
            segments = kmzBuilder.splitByBattery(waypoints, batteryMinutes * 60.0, rthResume);
        } else {
            segments = kmzBuilder.splitByCount(waypoints, maxWaypoints);
        }

        try {
            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            try (java.util.zip.ZipOutputStream zout = new java.util.zip.ZipOutputStream(baos)) {
                for (int i = 0; i < segments.size(); i++) {
                    // Intermediate segments: force goHome so drone RTHs between batteries
                    // Last segment: use user's chosen finish action
                    KmzBuilderService.FinishAction segFinish = (rthResume && i < segments.size() - 1)
                            ? KmzBuilderService.FinishAction.GO_HOME
                            : finish;
                    KmzBuilderService.BuildRequest req = new KmzBuilderService.BuildRequest(
                            segments.get(i), missionName + "_seg" + (i + 1),
                            altitude, speed, gimbalAngle, segFinish, useRtk);
                    byte[] kmzBytes = kmzBuilder.build(req);
                    zout.putNextEntry(new java.util.zip.ZipEntry("segment_" + (i + 1) + ".kmz"));
                    zout.write(kmzBytes);
                    zout.closeEntry();
                }
            }
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            ContentDisposition.attachment().filename("mission_split.zip").build().toString())
                    .contentType(MediaType.parseMediaType("application/zip"))
                    .body(baos.toByteArray());
        } catch (IOException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    // ─── Phone download (KMZ cache) ──────────────────────────────────────────

    @GetMapping(value = "/api/kmz/latest", produces = "application/vnd.google-earth.kmz")
    public ResponseEntity<byte[]> getLatestKmz() {
        if (lastKmzBytes == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(lastKmzFilename).build().toString())
                .contentType(MediaType.parseMediaType("application/vnd.google-earth.kmz"))
                .body(lastKmzBytes);
    }

    @GetMapping(value = "/download", produces = MediaType.TEXT_HTML_VALUE)
    public String downloadPage() {
        String serverUrl = serverUrl();
        String kmzUrl = serverUrl + "/api/kmz/latest";
        String qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + java.net.URLEncoder.encode(kmzUrl, java.nio.charset.StandardCharsets.UTF_8);

        if (lastKmzBytes != null) {
            return """
                    <!DOCTYPE html>
                    <html><head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
                    <title>WaypointMap — Downloading…</title>
                    <style>
                      * { margin:0; padding:0; box-sizing:border-box; }
                      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #e2e8f0; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; padding:32px 20px; text-align:center; }
                      h1 { font-size: 22px; font-weight: 800; margin-bottom: 6px; }
                      .sub { font-size: 13px; color: #94a3b8; margin-bottom: 24px; }
                      .card { background: #1e293b; border-radius: 14px; padding: 28px 24px; max-width: 340px; width: 100%%; margin-bottom: 16px; }
                      .spinner { width: 40px; height: 40px; border: 3px solid #334155; border-top: 3px solid #3b82f6; border-radius: 50%%; animation: spin 0.8s linear infinite; margin: 0 auto 16px auto; }
                      @keyframes spin { to { transform: rotate(360deg); } }
                      .status { font-size: 14px; font-weight: 600; color: #22c55e; margin-bottom: 8px; }
                      .status-sub { font-size: 12px; color: #64748b; margin-bottom: 20px; }
                      .qr-img { width: 200px; height: 200px; border-radius: 12px; margin-bottom: 8px; background: #fff; padding: 10px; }
                      .hint { font-size: 10px; color: #475569; margin-bottom: 20px; }
                      .btn { display: block; background: #3b82f6; color: #fff; padding: 14px; border-radius: 10px; font-size: 16px; font-weight: 700; text-decoration: none; margin-bottom: 10px; }
                      .btn:active { background: #2563eb; }
                      .copy-btn { display: block; background: transparent; color: #64748b; border: 1px solid #334155; padding: 10px; border-radius: 10px; font-size: 13px; cursor: pointer; width: 100%%; }
                      .copy-btn:active { background: #1e293b; }
                      .tip { font-size: 11px; color: #475569; margin-top: 16px; line-height: 1.5; }
                    </style>
                    </head><body>
                    <h1>WaypointMap</h1>
                    <p class="sub">Mission KMZ</p>
                    <div class="card">
                      <div class="spinner"></div>
                      <p class="status">Downloading %s…</p>
                      <p class="status-sub">Open with DJI Fly when done</p>
                      <img class="qr-img" src="%s" alt="Scan to download">
                      <p class="hint">Scan QR to download if it doesn't start automatically</p>
                      <a class="btn" href="%s">Download KMZ</a>
                      <button class="copy-btn" onclick="navigator.clipboard.writeText('%s').then(()=>this.textContent='Copied!')">Copy URL</button>
                    </div>
                    <p class="tip">After download, open the file<br>with DJI Fly / DJI Pilot</p>
                    <script>
                      // Auto-trigger download
                      setTimeout(function() {
                        window.location.href = '%s';
                      }, 800);
                    </script>
                    </body></html>
                    """.formatted(lastKmzFilename, qrUrl, kmzUrl, kmzUrl, kmzUrl);
        } else {
            return """
                    <!DOCTYPE html>
                    <html><head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
                    <title>WaypointMap — Download KMZ</title>
                    <style>
                      * { margin:0; padding:0; box-sizing:border-box; }
                      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #e2e8f0; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; padding:32px 20px; text-align:center; }
                      h1 { font-size: 24px; font-weight: 800; margin-bottom: 4px; }
                      .sub { font-size: 13px; color: #94a3b8; margin-bottom: 28px; }
                      .card { background: #1e293b; border-radius: 14px; padding: 24px; max-width: 320px; width: 100%%; }
                      .stat { font-size: 13px; color: #f59e0b; font-weight: 600; margin-bottom: 16px; }
                      .tip { font-size: 12px; color: #64748b; line-height: 1.6; }
                    </style>
                    </head><body>
                    <h1>WaypointMap</h1>
                    <p class="sub">Phone download portal</p>
                    <div class="card">
                      <p class="stat">No mission generated yet</p>
                      <p class="tip">Open the WaypointMap web app on your laptop,<br>plan a mission, download the KMZ,<br>then refresh this page on your phone.</p>
                    </div>
                    </body></html>
                    """;
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private static String firstValue(MultiValueMap<String, String> values, String key, String fallback) {
        String v = values.getFirst(key);
        return v == null || v.isBlank() ? fallback : v;
    }

    private static int parseInt(String value, int fallback) {
        try { return Integer.parseInt(value); } catch (NumberFormatException e) { return fallback; }
    }

    private static double parseDouble(String value, double fallback) {
        try { return Double.parseDouble(value); } catch (NumberFormatException e) { return fallback; }
    }

    private static boolean parseBoolean(String value) {
        return "true".equalsIgnoreCase(value) || "1".equals(value) || "on".equalsIgnoreCase(value);
    }

    private static List<double[]> parsePolygon(String bounds) {
        if (bounds == null || bounds.isBlank()) return List.of();
        String[] pairs = bounds.split("[|;]");
        List<double[]> coords = new ArrayList<>();
        for (String pair : pairs) {
            String[] parts = pair.trim().split(",");
            if (parts.length < 2) continue;
            try {
                coords.add(new double[]{
                        Double.parseDouble(parts[0].trim()),
                        Double.parseDouble(parts[1].trim())
                });
            } catch (NumberFormatException ignored) {}
        }
        return coords;
    }

    private static double[] parseCenter(String s) {
        if (s == null || s.isBlank()) return null;
        String[] parts = s.split(",");
        if (parts.length < 2) return null;
        try {
            return new double[]{
                    Double.parseDouble(parts[0].trim()),
                    Double.parseDouble(parts[1].trim())
            };
        } catch (NumberFormatException e) { return null; }
    }

    @SuppressWarnings("unchecked")
    private List<LawnmowerService.WaypointResult> parseWaypointsJson(
            String json, double defaultAlt, double defaultSpeed, double defaultGimbal) {
        List<LawnmowerService.WaypointResult> out = new ArrayList<>();
        try {
            List<Map<String, Object>> list = jackson.readValue(json, new TypeReference<>() {});
            for (Map<String, Object> m : list) {
                out.add(new LawnmowerService.WaypointResult(
                        toInt(m.get("id")),
                        toDouble(m.get("Latitude"), toDouble(m.get("latitude"), 0)),
                        toDouble(m.get("Longitude"), toDouble(m.get("longitude"), 0)),
                        toDouble(m.get("altitude"), defaultAlt),
                        toDouble(m.get("speed"), defaultSpeed),
                        toDouble(m.get("gimbalAngle"), defaultGimbal),
                        toDouble(m.get("heading"), 0),
                        str(m.get("action"), "noAction"),
                        str(m.get("turnMode"), "coordinateTurn"),
                        toInt(m.get("useStraightLine")),
                        toDouble(m.get("waypointTurnDampingDist"), 0.2)
                ));
            }
        } catch (Exception e) {
            // Return empty list; KMZ will be empty but won't crash
        }
        return out;
    }

    private static double toDouble(Object v, double fallback) {
        if (v == null) return fallback;
        try { return ((Number) v).doubleValue(); } catch (Exception e) { return fallback; }
    }

    private static int toInt(Object v) {
        if (v == null) return 0;
        try { return ((Number) v).intValue(); } catch (Exception e) { return 0; }
    }

    private static String str(Object v, String fallback) {
        return v == null ? fallback : v.toString();
    }

    private static String sanitizeFilename(String name) {
        return name.replaceAll("[^a-zA-Z0-9_\\-]", "_");
    }

    /** Guess the server's external URL from the request. */
    private String serverUrl() {
        try {
            var req = ((org.springframework.web.context.request.ServletRequestAttributes)
                    org.springframework.web.context.request.RequestContextHolder.currentRequestAttributes())
                    .getRequest();
            String host = req.getHeader("Host");
            String scheme = req.getHeader("X-Forwarded-Proto");
            if (scheme == null) scheme = req.getScheme();
            if (host != null && scheme != null) return scheme + "://" + host;
        } catch (Exception ignored) {}
        return "http://localhost:8088";
    }
}
