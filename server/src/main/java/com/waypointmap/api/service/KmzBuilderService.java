package com.waypointmap.api.service;

import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Builds a DJI WPML-compliant KMZ file from a list of waypoints.
 *
 * KMZ structure:
 *   wpmz/template.kml   — mission envelope (takeoff, route, payloads)
 *   wpmz/waylines.wpml  — waypoint path with actions
 */
@Service
public class KmzBuilderService {

    public enum FinishAction { HOVER, GO_HOME, AUTO_LAND }

    public record BuildRequest(
            List<LawnmowerService.WaypointResult> waypoints,
            String missionName,
            double altitude,
            double speed,
            double gimbalAngle,
            FinishAction finishAction,
            boolean useRtkHeight
    ) {}

    public byte[] build(BuildRequest req) throws IOException {
        String templateKml = buildTemplateKml(req);
        String waylinesWpml = buildWaylinesWpml(req);

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(baos)) {
            addEntry(zip, "wpmz/template.kml", templateKml);
            addEntry(zip, "wpmz/waylines.wpml", waylinesWpml);
        }
        return baos.toByteArray();
    }

    // ─── template.kml ────────────────────────────────────────────────────────

    private String buildTemplateKml(BuildRequest req) {
        StringBuilder sb = new StringBuilder();
        sb.append("""
                <?xml version="1.0" encoding="UTF-8"?>
                <kml xmlns="http://www.opengis.net/kml/2.2"
                     xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
                  <Document>
                    <wpml:author>WaypointMap</wpml:author>
                    <wpml:createTime>%d</wpml:createTime>
                    <wpml:updateTime>%d</wpml:updateTime>
                    <wpml:missionConfig>
                      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
                      <wpml:finishAction>%s</wpml:finishAction>
                      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
                      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
                      <wpml:globalTransitionalSpeed>%.1f</wpml:globalTransitionalSpeed>
                      <wpml:droneInfo>
                        <wpml:droneEnumValue>67</wpml:droneEnumValue>
                        <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>
                      </wpml:droneInfo>
                    </wpml:missionConfig>
                    <Folder>
                      <name>%s</name>
                      <wpml:templateType>waypoint</wpml:templateType>
                      <wpml:templateId>0</wpml:templateId>
                      <wpml:waylineCoordinateSysParam>
                        <wpml:coordinateMode>WGS84</wpml:coordinateMode>
                        <wpml:heightMode>%s</wpml:heightMode>
                      </wpml:waylineCoordinateSysParam>
                      <wpml:autoFlightSpeed>%.1f</wpml:autoFlightSpeed>
                """.formatted(
                System.currentTimeMillis(),
                System.currentTimeMillis(),
                finishActionKml(req.finishAction()),
                req.speed(),
                xmlEsc(req.missionName()),
                req.useRtkHeight() ? "realTimeFollowSurface" : "EGM96",
                req.speed()
        ));

        for (LawnmowerService.WaypointResult wp : req.waypoints()) {
            sb.append("""
                          <Placemark>
                            <Point>
                              <coordinates>%.10f,%.10f</coordinates>
                            </Point>
                            <wpml:index>%d</wpml:index>
                            <wpml:executeHeight>%.2f</wpml:executeHeight>
                            <wpml:waypointSpeed>%.1f</wpml:waypointSpeed>
                            <wpml:waypointHeadingParam>
                              <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
                              <wpml:waypointHeadingAngle>%.1f</wpml:waypointHeadingAngle>
                            </wpml:waypointHeadingParam>
                            <wpml:waypointTurnParam>
                              <wpml:waypointTurnMode>%s</wpml:waypointTurnMode>
                              <wpml:waypointTurnDampingDist>%.1f</wpml:waypointTurnDampingDist>
                            </wpml:waypointTurnParam>
                            <wpml:useStraightLine>%d</wpml:useStraightLine>
                            <wpml:gimbalPitchAngle>%.1f</wpml:gimbalPitchAngle>
                          </Placemark>
                    """.formatted(
                    wp.longitude(), wp.latitude(),
                    wp.id(),
                    wp.altitude(),
                    wp.speed(),
                    wp.heading(),
                    djiTurnMode(wp.turnMode()),
                    wp.waypointTurnDampingDist(),
                    wp.useStraightLine(),
                    wp.gimbalAngle()
            ));
        }

        sb.append("""
                    </Folder>
                  </Document>
                </kml>
                """);
        return sb.toString();
    }

    // ─── waylines.wpml ───────────────────────────────────────────────────────

    private String buildWaylinesWpml(BuildRequest req) {
        StringBuilder sb = new StringBuilder();
        sb.append("""
                <?xml version="1.0" encoding="UTF-8"?>
                <kml xmlns="http://www.opengis.net/kml/2.2"
                     xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
                  <Document>
                    <Folder>
                      <wpml:templateId>0</wpml:templateId>
                      <wpml:executeHeightMode>%s</wpml:executeHeightMode>
                      <wpml:waylineId>0</wpml:waylineId>
                      <wpml:distance>%.1f</wpml:distance>
                      <wpml:duration>%.1f</wpml:duration>
                      <wpml:autoFlightSpeed>%.1f</wpml:autoFlightSpeed>
                """.formatted(
                req.useRtkHeight() ? "realTimeFollowSurface" : "WGS84",
                estimateDistance(req.waypoints()),
                estimateDistance(req.waypoints()) / Math.max(0.1, req.speed()),
                req.speed()
        ));

        for (LawnmowerService.WaypointResult wp : req.waypoints()) {
            String actionGroup = buildActionGroup(wp);
            sb.append("""
                          <Placemark>
                            <Point>
                              <coordinates>%.10f,%.10f</coordinates>
                            </Point>
                            <wpml:index>%d</wpml:index>
                            <wpml:executeHeight>%.2f</wpml:executeHeight>
                            <wpml:waypointSpeed>%.1f</wpml:waypointSpeed>
                            <wpml:waypointHeadingParam>
                              <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
                              <wpml:waypointHeadingAngle>%.1f</wpml:waypointHeadingAngle>
                            </wpml:waypointHeadingParam>
                            <wpml:waypointTurnParam>
                              <wpml:waypointTurnMode>%s</wpml:waypointTurnMode>
                              <wpml:waypointTurnDampingDist>%.1f</wpml:waypointTurnDampingDist>
                            </wpml:waypointTurnParam>
                            <wpml:useStraightLine>%d</wpml:useStraightLine>
                            <wpml:gimbalPitchAngle>%.1f</wpml:gimbalPitchAngle>
                    %s      </Placemark>
                    """.formatted(
                    wp.longitude(), wp.latitude(),
                    wp.id(),
                    wp.altitude(),
                    wp.speed(),
                    wp.heading(),
                    djiTurnMode(wp.turnMode()),
                    wp.waypointTurnDampingDist(),
                    wp.useStraightLine(),
                    wp.gimbalAngle(),
                    actionGroup
            ));
        }

        sb.append("""
                    </Folder>
                  </Document>
                </kml>
                """);
        return sb.toString();
    }

    private String buildActionGroup(LawnmowerService.WaypointResult wp) {
        String action = wp.action();
        if (action == null || action.isBlank() || "noAction".equalsIgnoreCase(action) || "none".equalsIgnoreCase(action)) {
            return "";
        }

        String djiAction = switch (action) {
            case "takePicture", "take-picture" -> """
                        <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
                        <wpml:actionActuatorFuncParam>
                          <wpml:fileSuffix></wpml:fileSuffix>
                          <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
                        </wpml:actionActuatorFuncParam>
                    """;
            case "startRecording", "start-recording" -> """
                        <wpml:actionActuatorFunc>startRecord</wpml:actionActuatorFunc>
                        <wpml:actionActuatorFuncParam>
                          <wpml:fileSuffix></wpml:fileSuffix>
                          <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
                        </wpml:actionActuatorFuncParam>
                    """;
            case "stopRecording", "stop-recording" -> """
                        <wpml:actionActuatorFunc>stopRecord</wpml:actionActuatorFunc>
                        <wpml:actionActuatorFuncParam>
                          <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
                        </wpml:actionActuatorFuncParam>
                    """;
            default -> null;
        };

        if (djiAction == null) return "";

        return """
                    <wpml:actionGroup>
                      <wpml:actionGroupId>%d</wpml:actionGroupId>
                      <wpml:actionGroupStartIndex>%d</wpml:actionGroupStartIndex>
                      <wpml:actionGroupEndIndex>%d</wpml:actionGroupEndIndex>
                      <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
                      <wpml:actionTrigger>
                        <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
                      </wpml:actionTrigger>
                      <wpml:action>
                        <wpml:actionId>0</wpml:actionId>
                %s      </wpml:action>
                    </wpml:actionGroup>
                """.formatted(wp.id(), wp.id(), wp.id(), djiAction);
    }

    // ─── Mission split ────────────────────────────────────────────────────────

    public List<List<LawnmowerService.WaypointResult>> splitByBattery(
            List<LawnmowerService.WaypointResult> wps, double batterySeconds) {
        return splitByBattery(wps, batterySeconds, false);
    }

    /**
     * Split waypoints by battery time, optionally inserting resume waypoints
     * so each subsequent segment starts from where the previous segment left off.
     */
    public List<List<LawnmowerService.WaypointResult>> splitByBattery(
            List<LawnmowerService.WaypointResult> wps, double batterySeconds, boolean rthResume) {
        List<List<LawnmowerService.WaypointResult>> segments = new java.util.ArrayList<>();
        if (wps.isEmpty()) return segments;
        List<LawnmowerService.WaypointResult> current = new java.util.ArrayList<>();
        double elapsed = 0;
        for (int i = 0; i < wps.size(); i++) {
            current.add(wps.get(i));
            if (i + 1 < wps.size()) {
                double dist = haversine(wps.get(i).latitude(), wps.get(i).longitude(),
                        wps.get(i + 1).latitude(), wps.get(i + 1).longitude());
                double spd = Math.max(0.1, wps.get(i).speed());
                elapsed += dist / spd;
                if (elapsed >= batterySeconds) {
                    segments.add(current);
                    current = new java.util.ArrayList<>();
                    // Insert resume waypoint: copy of last waypoint from previous segment
                    if (rthResume) {
                        LawnmowerService.WaypointResult last = segments.get(segments.size() - 1)
                                .get(segments.get(segments.size() - 1).size() - 1);
                        current.add(new LawnmowerService.WaypointResult(
                                last.id(),
                                last.latitude(),
                                last.longitude(),
                                last.altitude(),
                                last.speed(),
                                last.gimbalAngle(),
                                last.heading(),
                                "noAction",
                                last.turnMode(),
                                last.useStraightLine(),
                                last.waypointTurnDampingDist()
                        ));
                    }
                    elapsed = 0;
                }
            }
        }
        if (!current.isEmpty()) segments.add(current);
        return segments;
    }

    public List<List<LawnmowerService.WaypointResult>> splitByCount(
            List<LawnmowerService.WaypointResult> wps, int maxWp) {
        List<List<LawnmowerService.WaypointResult>> segments = new java.util.ArrayList<>();
        for (int i = 0; i < wps.size(); i += maxWp) {
            segments.add(new java.util.ArrayList<>(wps.subList(i, Math.min(i + maxWp, wps.size()))));
        }
        return segments;
    }

    public byte[] buildMultiKmz(List<BuildRequest> segments, List<String> names) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(baos)) {
            for (int i = 0; i < segments.size(); i++) {
                String segName = (names != null && i < names.size()) ? names.get(i) : "segment_" + (i + 1);
                byte[] kmzBytes = build(segments.get(i));
                zip.putNextEntry(new ZipEntry(segName + ".kmz"));
                zip.write(kmzBytes);
                zip.closeEntry();
            }
        }
        return baos.toByteArray();
    }

    // ─── KMZ import ──────────────────────────────────────────────────────────

    public record ImportResult(
            String missionName,
            List<WpImport> waypoints
    ) {}

    public record WpImport(int index, double lat, double lng, double altitude, double speed, double gimbalAngle, double heading) {}

    public record OverlayShape(String name, String type, List<double[]> path) {}

    public record KmlOverlayResult(String missionName, List<OverlayShape> overlays) {}

    public ImportResult importKmz(byte[] bytes) throws IOException {
        // Try as ZIP (KMZ)
        try (java.util.zip.ZipInputStream zin = new java.util.zip.ZipInputStream(
                new java.io.ByteArrayInputStream(bytes))) {
            java.util.zip.ZipEntry entry;
            while ((entry = zin.getNextEntry()) != null) {
                if (entry.getName().endsWith("waylines.wpml") || entry.getName().endsWith("template.kml")) {
                    String xml = new String(zin.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
                    return parseWpml(xml);
                }
            }
        } catch (Exception ignored) {}
        // Try as plain KML
        try {
            String xml = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
            if (xml.trim().startsWith("<?xml") || xml.trim().startsWith("<kml")) {
                return parseWpml(xml);
            }
        } catch (Exception ignored) {}
        return new ImportResult("Imported Mission", List.of());
    }

    public KmlOverlayResult importKmlOverlays(byte[] bytes) throws IOException {
        String xml = null;
        // Try as ZIP (KMZ)
        try (java.util.zip.ZipInputStream zin = new java.util.zip.ZipInputStream(
                new java.io.ByteArrayInputStream(bytes))) {
            java.util.zip.ZipEntry entry;
            while ((entry = zin.getNextEntry()) != null) {
                String name = entry.getName();
                if (name.endsWith(".kml") || name.endsWith(".wpml")) {
                    xml = new String(zin.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
                    break;
                }
            }
        } catch (Exception ignored) {}
        // Try as plain KML
        if (xml == null) {
            String candidate = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
            if (candidate.trim().startsWith("<?xml") || candidate.trim().startsWith("<kml")) {
                xml = candidate;
            }
        }
        if (xml == null) return new KmlOverlayResult("Imported", List.of());

        List<OverlayShape> overlays = new java.util.ArrayList<>();
        String missionName = "Imported";
        int nameStart = xml.indexOf("<name>");
        if (nameStart >= 0) {
            int nameEnd = xml.indexOf("</name>", nameStart);
            if (nameEnd > nameStart) missionName = xml.substring(nameStart + 6, nameEnd).trim();
        }
        int pos = 0;
        while (true) {
            int pmStart = xml.indexOf("<Placemark>", pos);
            if (pmStart < 0) break;
            int pmEnd = xml.indexOf("</Placemark>", pmStart);
            if (pmEnd < 0) break;
            String pm = xml.substring(pmStart, pmEnd + 12);
            pos = pmEnd + 12;
            // Skip waypoints (have wpml:index)
            if (pm.contains("<wpml:index>")) continue;
            // Check for name
            String shapeName = "";
            int sn = pm.indexOf("<name>");
            if (sn >= 0) { int se = pm.indexOf("</name>", sn); if (se > sn) shapeName = pm.substring(sn + 6, se).trim(); }
            // Polygon
            int polyS = pm.indexOf("<Polygon>");
            if (polyS >= 0) {
                List<double[]> path = parseCoordinatesBlock(pm);
                if (!path.isEmpty()) overlays.add(new OverlayShape(shapeName, "polygon", path));
                continue;
            }
            // LineString
            int lineS = pm.indexOf("<LineString>");
            if (lineS >= 0) {
                List<double[]> path = parseCoordinatesBlock(pm);
                if (!path.isEmpty()) overlays.add(new OverlayShape(shapeName, "polyline", path));
            }
        }
        return new KmlOverlayResult(missionName, overlays);
    }

    private List<double[]> parseCoordinatesBlock(String xml) {
        List<double[]> result = new java.util.ArrayList<>();
        int s = xml.indexOf("<coordinates>");
        if (s < 0) return result;
        int e = xml.indexOf("</coordinates>", s);
        if (e < 0) return result;
        String raw = xml.substring(s + 13, e).trim();
        for (String token : raw.split("\\s+")) {
            String[] parts = token.split(",");
            if (parts.length < 2) continue;
            try {
                double lng = Double.parseDouble(parts[0].trim());
                double lat = Double.parseDouble(parts[1].trim());
                result.add(new double[]{lat, lng});
            } catch (NumberFormatException ignored) {}
        }
        return result;
    }

    private ImportResult parseWpml(String xml) {
        List<WpImport> waypoints = new java.util.ArrayList<>();
        // Simple regex-free SAX-like extraction using string searching
        int pos = 0;
        String missionName = "Imported Mission";

        // Try to get mission name
        int nameStart = xml.indexOf("<name>");
        if (nameStart >= 0) {
            int nameEnd = xml.indexOf("</name>", nameStart);
            if (nameEnd > nameStart) {
                missionName = xml.substring(nameStart + 6, nameEnd).trim();
            }
        }

        while (true) {
            int pmStart = xml.indexOf("<Placemark>", pos);
            if (pmStart < 0) break;
            int pmEnd = xml.indexOf("</Placemark>", pmStart);
            if (pmEnd < 0) break;
            String pm = xml.substring(pmStart, pmEnd + 12);
            pos = pmEnd + 12;

            double[] coords = extractCoords(pm);
            if (coords == null) continue;

            int index = extractInt(pm, "wpml:index", waypoints.size());
            double alt = extractDouble(pm, "wpml:executeHeight", 60);
            double speed = extractDouble(pm, "wpml:waypointSpeed", 3.5);
            double gimbal = extractDouble(pm, "wpml:gimbalPitchAngle", -45);
            double heading = extractDouble(pm, "wpml:waypointHeadingAngle", 0);

            waypoints.add(new WpImport(index, coords[0], coords[1], alt, speed, gimbal, heading));
        }

        return new ImportResult(missionName, waypoints);
    }

    private double[] extractCoords(String xml) {
        int s = xml.indexOf("<coordinates>");
        if (s < 0) return null;
        int e = xml.indexOf("</coordinates>", s);
        if (e < 0) return null;
        String raw = xml.substring(s + 13, e).trim();
        String[] parts = raw.split(",");
        if (parts.length < 2) return null;
        try {
            double lng = Double.parseDouble(parts[0].trim());
            double lat = Double.parseDouble(parts[1].trim());
            return new double[]{lat, lng};
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private double extractDouble(String xml, String tag, double fallback) {
        int s = xml.indexOf("<" + tag + ">");
        if (s < 0) return fallback;
        int e = xml.indexOf("</" + tag + ">", s);
        if (e < 0) return fallback;
        try {
            return Double.parseDouble(xml.substring(s + tag.length() + 2, e).trim());
        } catch (NumberFormatException ex) {
            return fallback;
        }
    }

    private int extractInt(String xml, String tag, int fallback) {
        return (int) Math.round(extractDouble(xml, tag, fallback));
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private static String finishActionKml(FinishAction action) {
        return switch (action) {
            case HOVER -> "hover";
            case AUTO_LAND -> "autoLand";
            default -> "goHome";
        };
    }

    private static String djiTurnMode(String mode) {
        if (mode == null) return "toPointAndStopWithDiscontinuityCurvature";
        return switch (mode) {
            case "coordinateTurn" -> "coordinateTurn";
            case "toPointAndPassWithContinuityCurvature" -> "toPointAndPassWithContinuityCurvature";
            default -> "toPointAndStopWithDiscontinuityCurvature";
        };
    }

    private static double estimateDistance(List<LawnmowerService.WaypointResult> wps) {
        if (wps.size() < 2) return 0;
        double total = 0;
        for (int i = 1; i < wps.size(); i++) {
            total += haversine(wps.get(i - 1).latitude(), wps.get(i - 1).longitude(),
                    wps.get(i).latitude(), wps.get(i).longitude());
        }
        return total;
    }

    private static double haversine(double lat1, double lng1, double lat2, double lng2) {
        double R = 6_371_000;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    private static String xmlEsc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static void addEntry(ZipOutputStream zip, String name, String content) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(content.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        zip.closeEntry();
    }
}
