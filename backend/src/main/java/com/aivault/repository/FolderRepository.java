package com.aivault.repository;

import com.aivault.entity.Folder;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface FolderRepository extends JpaRepository<Folder, Long> {

    List<Folder> findByParentIdOrderBySortOrderAscNameAsc(Long parentId);

    List<Folder> findAllByOrderBySortOrderAscNameAsc();

    boolean existsByParentId(Long parentId);
}
