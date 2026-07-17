package com.aivault.repository;

import com.aivault.entity.NoteSegment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface NoteSegmentRepository extends JpaRepository<NoteSegment, Long> {

    List<NoteSegment> findByNoteIdOrderByPositionAsc(Long noteId);

    List<NoteSegment> findByNoteIdInOrderByNoteIdAscPositionAsc(List<Long> noteIds);

    void deleteByNoteId(Long noteId);
}
