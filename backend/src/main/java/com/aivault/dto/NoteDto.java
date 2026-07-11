package com.aivault.dto;

import java.time.Instant;
import java.util.List;

public record NoteDto(
        Long id,
        String title,
        String question,
        String contentMarkdown,
        Long folderId,
        String sourceModel,
        List<String> tags,
        Instant createdAt,
        Instant updatedAt
) {
}
