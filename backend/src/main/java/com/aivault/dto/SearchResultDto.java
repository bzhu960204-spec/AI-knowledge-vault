package com.aivault.dto;

import java.time.Instant;
import java.util.List;

/**
 * A single search hit. Carries enough context for the UI to explain why the
 * note matched: a context snippet around the first match, which fields matched
 * ({@code title}/{@code tag}/{@code question}/{@code answer}), the 1-based
 * position of the segment that matched (if any), and the query terms so the
 * client can highlight them.
 */
public record SearchResultDto(
        Long id,
        String title,
        Long folderId,
        String folderPath,
        String sourceModel,
        List<String> tags,
        String snippet,
        List<String> terms,
        List<String> matchFields,
        Integer matchSegment,
        Instant updatedAt
) {
}
