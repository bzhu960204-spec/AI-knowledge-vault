package com.aivault.repository;

import com.aivault.entity.Tag;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface TagRepository extends JpaRepository<Tag, Long> {

    Optional<Tag> findByNameIgnoreCase(String name);

    @Query("SELECT DISTINCT t FROM Note n JOIN n.tags t")
    List<Tag> findAllInUse();

    @Query("SELECT t FROM Tag t WHERE NOT EXISTS (SELECT 1 FROM Note n JOIN n.tags nt WHERE nt.id = t.id)")
    List<Tag> findOrphans();
}
