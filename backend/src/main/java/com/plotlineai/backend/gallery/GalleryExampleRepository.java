package com.plotlineai.backend.gallery;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface GalleryExampleRepository extends JpaRepository<GalleryExample, Long> {

    Optional<GalleryExample> findBySlug(String slug);

    List<GalleryExample> findAllByOrderByDisplayOrderAscSlugAsc();

    @Modifying(clearAutomatically = true)
    @Query("delete from GalleryExample g where g.slug not in :slugs")
    int deleteBySlugNotIn(@Param("slugs") Collection<String> slugs);
}
