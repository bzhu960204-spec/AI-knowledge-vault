package com.aivault.repository;

import com.aivault.entity.QuestionImage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface QuestionImageRepository extends JpaRepository<QuestionImage, Long> {

    List<QuestionImage> findByNoteIdOrderByCreatedAtAsc(Long noteId);

    Optional<QuestionImage> findByIdAndNoteId(Long id, Long noteId);

    List<QuestionImage> findBySegmentIdOrderByCreatedAtAsc(Long segmentId);

    Optional<QuestionImage> findByIdAndSegmentId(Long id, Long segmentId);

    List<QuestionImage> findBySegmentIdIn(List<Long> segmentIds);
}
