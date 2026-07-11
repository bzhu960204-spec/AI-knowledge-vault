package com.aivault.dto;

import java.time.Instant;
import java.util.List;

public record NoteSummaryDto(
        Long id,
        String title,
        Long folderId,
        String sourceModel,
        List<String> tags,
        String excerpt,
        Instant updatedAt,
        int sortOrder
) {
}
