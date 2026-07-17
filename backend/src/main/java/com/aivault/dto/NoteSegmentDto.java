package com.aivault.dto;

import java.util.List;

public record NoteSegmentDto(
        Long id,
        int position,
        String question,
        String answerHtml,
        List<QuestionImageDto> images
) {
}
