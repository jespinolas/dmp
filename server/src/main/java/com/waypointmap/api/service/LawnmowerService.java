package com.waypointmap.api.service;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Generates boustrophedon (lawnmower) survey waypoints for polygons and
 * orbital waypoints for circles, matching the behaviour of the live
 * WaypointMap advanced editor.
 */
@Service
public class LawnmowerService {

    // Earth radius and degree-to-metre constants
    private static final double EARTH_R = 6_371_000.0;
    private static final double DEG_TO_RAD = Math.PI / 180.0;
    // Metres per degree of latitude (constant)
    private static final double M_PER_DEG_LAT = 111_320.0;

    // ─── Public API ───────────────────────────────────────────────────────────

    public record WaypointResult(
            int id,
            double latitude,
            double longitude,
            double altitude,
            double speed,
            double gimbalAngle,
            double heading,
            String action,
            String turnMode,
            int useStraightLine,
            double waypointTurnDampingDist
    ) {}

    public record GenerateRequest(
            List<double[]> polygon,   // list of [lat, lng] vertices
            String boundsType,        // "polygon" | "circle"
            double circleRadius,      // metres (only for circle)
            double[] circleCenter,    // [lat, lng] (only for circle)
            double altitude,
            double speed,
            double gimbalAngle,
            double lineSpacingM,      // metres between scan rows  (in_distance)
            double pointSpacingM,     // metres between points along row
            int orientation,          // 0 = E-W rows, 1 = N-S rows
            double angleDeg,          // manual line angle (degrees, clockwise from N)
            String lineAngleMode,     // "preset" | "manual"
            boolean flipPath,
            boolean maintainAlt,
            boolean straightenLines,
            boolean generateAllPoints,
            String allPointsAction,
            String turnMode,
            int startingIndex
    ) {}

    /**
     * Generates waypoints for the given request and returns them sorted by id.
     */
    public List<WaypointResult> generate(GenerateRequest req) {
        if ("circle".equals(req.boundsType())) {
            return generateCircle(req);
        }
        return generateLawnmower(req);
    }

    // ─── Circle (orbital) ─────────────────────────────────────────────────────

    private List<WaypointResult> generateCircle(GenerateRequest req) {
        double[] c = req.circleCenter();
        double r = req.circleRadius();
        if (c == null || r <= 0) return List.of();

        // Number of points: circumference / spacing, min 8
        double circumference = 2 * Math.PI * r;
        int n = Math.max(8, (int) Math.round(circumference / Math.max(1, req.pointSpacingM())));
        n = Math.min(n, 100); // safety cap

        List<WaypointResult> out = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            double angleRad = (2 * Math.PI * i) / n;
            double dLat = (r * Math.cos(angleRad)) / M_PER_DEG_LAT;
            double dLng = (r * Math.sin(angleRad)) / mPerDegLng(c[0]);
            double lat = c[0] + dLat;
            double lng = c[1] + dLng;
            // Heading points toward center (nadir)
            double heading = (Math.toDegrees(Math.atan2(-Math.sin(angleRad), -Math.cos(angleRad))) + 360) % 360;
            out.add(build(req, req.startingIndex() + i, lat, lng, heading));
        }
        return out;
    }

    // ─── Lawnmower ────────────────────────────────────────────────────────────

    private List<WaypointResult> generateLawnmower(GenerateRequest req) {
        List<double[]> poly = req.polygon();
        if (poly == null || poly.size() < 3) return List.of();

        double lineSpacing = Math.max(0.5, req.lineSpacingM());
        double pointSpacing = Math.max(0.5, req.pointSpacingM() > 0 ? req.pointSpacingM() : lineSpacing);

        // Decide actual angle in degrees (geographic bearing, clockwise from N)
        double angleDeg = resolveAngle(req);

        // Work in a rotated local metric frame
        // Origin = centroid of the polygon
        double[] centroid = centroid(poly);
        double cosPhi = Math.cos(centroid[0] * DEG_TO_RAD);

        // Project polygon to metres relative to centroid, then rotate
        double angleRad = angleDeg * DEG_TO_RAD;
        double cosA = Math.cos(angleRad);
        double sinA = Math.sin(angleRad);

        double[][] rotated = new double[poly.size()][2];
        for (int i = 0; i < poly.size(); i++) {
            double mx = (poly.get(i)[1] - centroid[1]) * mPerDegLng(centroid[0]);
            double my = (poly.get(i)[0] - centroid[0]) * M_PER_DEG_LAT;
            // Rotate: x' = x cos A + y sin A,  y' = -x sin A + y cos A
            rotated[i][0] = mx * cosA + my * sinA;
            rotated[i][1] = -mx * sinA + my * cosA;
        }

        // Bounding box in rotated frame
        double minX = Double.MAX_VALUE, maxX = -Double.MAX_VALUE;
        double minY = Double.MAX_VALUE, maxY = -Double.MAX_VALUE;
        for (double[] p : rotated) {
            minX = Math.min(minX, p[0]);
            maxX = Math.max(maxX, p[0]);
            minY = Math.min(minY, p[1]);
            maxY = Math.max(maxY, p[1]);
        }

        // Number of scan rows
        int numRows = (int) Math.ceil((maxY - minY) / lineSpacing) + 1;

        List<WaypointResult> out = new ArrayList<>();
        int wpId = req.startingIndex();
        boolean leftToRight = true;

        for (int row = 0; row < numRows; row++) {
            double y = minY + row * lineSpacing;
            if (y > maxY + lineSpacing * 0.5) break;

            // Find intersections of scan line (y = const) with polygon edges
            List<Double> xs = scanLineIntersections(rotated, y);

            // Fall back to full width if no intersections found (bbox fallback)
            double rowMinX, rowMaxX;
            if (xs.size() >= 2) {
                rowMinX = xs.stream().mapToDouble(v -> v).min().getAsDouble();
                rowMaxX = xs.stream().mapToDouble(v -> v).max().getAsDouble();
            } else {
                rowMinX = minX;
                rowMaxX = maxX;
            }

            // Generate points along row
            int numPts = Math.max(2, (int) Math.round((rowMaxX - rowMinX) / pointSpacing) + 1);
            List<double[]> rowPts = new ArrayList<>();
            for (int p = 0; p < numPts; p++) {
                double x = rowMinX + ((double) p / (numPts - 1)) * (rowMaxX - rowMinX);
                rowPts.add(new double[]{x, y});
            }

            if (!leftToRight) {
                // Reverse for boustrophedon
                java.util.Collections.reverse(rowPts);
            }

            // Compute heading along row
            double rowHeading = leftToRight ? 90 : 270; // E or W (E-W rows)

            for (double[] rp : rowPts) {
                // Un-rotate back to metric, then back to lat/lng
                double mx = rp[0] * cosA - rp[1] * sinA;
                double my = rp[0] * sinA + rp[1] * cosA;
                double lat = centroid[0] + my / M_PER_DEG_LAT;
                double lng = centroid[1] + mx / mPerDegLng(centroid[0]);
                out.add(build(req, wpId++, lat, lng, rowHeading));
            }

            leftToRight = !leftToRight;
        }

        if (req.flipPath()) {
            java.util.Collections.reverse(out);
            // Re-number after flip
            List<WaypointResult> renumbered = new ArrayList<>();
            int idx = req.startingIndex();
            for (WaypointResult w : out) {
                renumbered.add(new WaypointResult(
                        idx++, w.latitude(), w.longitude(), w.altitude(),
                        w.speed(), w.gimbalAngle(), w.heading(), w.action(),
                        w.turnMode(), w.useStraightLine(), w.waypointTurnDampingDist()));
            }
            return renumbered;
        }

        return out;
    }

    // ─── Scan-line polygon intersection ──────────────────────────────────────

    /**
     * Returns X-coordinates where the horizontal line y=scanY crosses the polygon edges.
     */
    private List<Double> scanLineIntersections(double[][] poly, double scanY) {
        List<Double> xs = new ArrayList<>();
        int n = poly.length;
        for (int i = 0; i < n; i++) {
            double[] a = poly[i];
            double[] b = poly[(i + 1) % n];
            double ay = a[1], by = b[1];
            if ((ay <= scanY && by > scanY) || (by <= scanY && ay > scanY)) {
                double t = (scanY - ay) / (by - ay);
                xs.add(a[0] + t * (b[0] - a[0]));
            }
        }
        return xs;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private double resolveAngle(GenerateRequest req) {
        if ("manual".equals(req.lineAngleMode())) {
            return req.angleDeg();
        }
        // orientation 0 = E-W rows (angle=0 → rows parallel to equator)
        // orientation 1 = N-S rows (angle=90 → rows parallel to meridian)
        return req.orientation() == 1 ? 90.0 : 0.0;
    }

    private double[] centroid(List<double[]> poly) {
        double lat = 0, lng = 0;
        for (double[] p : poly) { lat += p[0]; lng += p[1]; }
        return new double[]{lat / poly.size(), lng / poly.size()};
    }

    private double mPerDegLng(double latDeg) {
        return M_PER_DEG_LAT * Math.cos(latDeg * DEG_TO_RAD);
    }

    private WaypointResult build(GenerateRequest req, int id, double lat, double lng, double heading) {
        String action = req.generateAllPoints() ? req.allPointsAction() : "noAction";
        String turnMode = req.straightenLines()
                ? "toPointAndStopWithDiscontinuityCurvature"
                : req.turnMode();
        int straightLine = req.straightenLines() ? 1 : 0;
        double dampingDist = req.straightenLines() ? 0.0 : 0.2;

        return new WaypointResult(
                id, lat, lng,
                req.altitude(), req.speed(), req.gimbalAngle(),
                heading, action, turnMode, straightLine, dampingDist
        );
    }
}
