package com.aivault.migration;

import com.aivault.entity.NoteSegment;
import com.aivault.repository.NoteSegmentRepository;
import com.aivault.service.MarkdownHtmlConverter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * One-time conversion of legacy Markdown answers into rich-text HTML, so the
 * TipTap editor renders existing notes correctly instead of showing raw
 * Markdown syntax.
 *
 * <p>Runs after {@link SegmentBackfillRunner} so freshly back-filled segments
 * are converted too. Idempotent: only segments whose {@code contentFormat} is
 * still {@code null} or {@code "markdown"} are touched; once converted they are
 * flagged {@code "html"} and skipped on subsequent boots.</p>
 */
@Component
@Order(2)
public class MarkdownToHtmlRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(MarkdownToHtmlRunner.class);

    private final NoteSegmentRepository segmentRepository;
    private final MarkdownHtmlConverter converter;

    public MarkdownToHtmlRunner(NoteSegmentRepository segmentRepository,
                                MarkdownHtmlConverter converter) {
        this.segmentRepository = segmentRepository;
        this.converter = converter;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        int converted = 0;
        for (NoteSegment segment : segmentRepository.findAll()) {
            String format = segment.getContentFormat();
            if (format != null && !"markdown".equalsIgnoreCase(format)) {
                continue; // already HTML
            }
            segment.setAnswerHtml(converter.toHtml(segment.getAnswerHtml()));
            segment.setContentFormat("html");
            segmentRepository.save(segment);
            converted++;
        }

        if (converted > 0) {
            log.info("Markdown->HTML: converted {} segment(s) to rich-text HTML", converted);
        }
    }
}
