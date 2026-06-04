package com.waypointmap.api.model;

import java.util.List;

public record MissionPreviewResponse(
        String id,
        String name,
        List<String> selections,
        int waypointCount,
        String exportFormat
) {
}

