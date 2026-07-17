package com.aivault.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

public record NoteRequest(
        @NotNull String title,
        Long folderId,
        String sourceModel,
        List<String> tags,
        List<NoteSegmentRequest> segments
) {
}
