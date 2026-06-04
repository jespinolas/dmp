package com.waypointmap.api.model;

import java.util.List;

public record FeatureAuditResponse(
        String sourceVersion,
        boolean editorRequiresLogin,
        List<String> publicFeatures,
        List<String> missingInputs
) {
}

