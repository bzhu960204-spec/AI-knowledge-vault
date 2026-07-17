package com.aivault.migration;

import com.aivault.entity.Note;
import com.aivault.entity.NoteSegment;
import com.aivault.entity.QuestionImage;
import com.aivault.repository.NoteRepository;
import com.aivault.repository.NoteSegmentRepository;
import com.aivault.repository.QuestionImageRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * One-time backfill that turns each legacy note (single {@code question} +
 * {@code contentMarkdown}) into its first {@link NoteSegment}, and re-points the
 * note's {@link QuestionImage}s at that segment.
 *
 * <p>Idempotent: a note that already has at least one segment is skipped, so
 * running the app repeatedly is safe. Once every note is migrated and the
 * legacy columns are removed (a later phase), this runner can be deleted.</p>
 */
@Component
@Order(1)
public class SegmentBackfillRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SegmentBackfillRunner.class);

    private final NoteRepository noteRepository;
    private final NoteSegmentRepository segmentRepository;
    private final QuestionImageRepository imageRepository;

    public SegmentBackfillRunner(NoteRepository noteRepository,
                                 NoteSegmentRepository segmentRepository,
                                 QuestionImageRepository imageRepository) {
        this.noteRepository = noteRepository;
        this.segmentRepository = segmentRepository;
        this.imageRepository = imageRepository;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        int migrated = 0;
        for (Note note : noteRepository.findAll()) {
            if (!segmentRepository.findByNoteIdOrderByPositionAsc(note.getId()).isEmpty()) {
                continue; // already has segments
            }

            NoteSegment segment = new NoteSegment();
            segment.setNoteId(note.getId());
            segment.setPosition(0);
            segment.setQuestion(note.getQuestion());
            // Legacy content is Markdown; mark it so MarkdownToHtmlRunner converts it.
            segment.setAnswerHtml(note.getContentMarkdown() != null ? note.getContentMarkdown() : "");
            segment.setContentFormat("markdown");
            NoteSegment saved = segmentRepository.save(segment);

            List<QuestionImage> images = imageRepository.findByNoteIdOrderByCreatedAtAsc(note.getId());
            for (QuestionImage image : images) {
                if (image.getSegmentId() == null) {
                    image.setSegmentId(saved.getId());
                }
            }
            if (!images.isEmpty()) {
                imageRepository.saveAll(images);
            }
            migrated++;
        }

        if (migrated > 0) {
            log.info("Segment backfill: migrated {} legacy note(s) into their first segment", migrated);
        }
    }
}
