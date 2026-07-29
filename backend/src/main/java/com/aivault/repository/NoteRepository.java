package com.aivault.repository;

import com.aivault.entity.Note;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface NoteRepository extends JpaRepository<Note, Long>, JpaSpecificationExecutor<Note> {

    List<Note> findByFolderIdOrderBySortOrderAscCreatedAtDesc(Long folderId);

    List<Note> findByFolderIdInOrderByFolderIdAscSortOrderAscCreatedAtDesc(List<Long> folderIds);

    List<Note> findAllByOrderByFolderIdAscSortOrderAscCreatedAtDesc();

    List<Note> findByFolderIdIsNullOrderBySortOrderAscCreatedAtDesc();

    @Query("select distinct n from Note n left join n.tags t where lower(t.name) = lower(:tag) order by n.updatedAt desc")
    List<Note> findByTagName(@Param("tag") String tag);
}
