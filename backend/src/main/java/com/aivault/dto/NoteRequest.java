package com.aivault.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

public record NoteRequest(
        @NotNull String title,
        String contentMarkdown,
        Long folderId,
        String sourceModel,
        List<String> tags
) {
}
