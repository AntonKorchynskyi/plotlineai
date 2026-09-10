package com.plotlineai.backend.gallery;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GalleryExampleRepository extends JpaRepository<GalleryExample, Long> {

    Optional<GalleryExample> findBySlug(String slug);

    List<GalleryExample> findAllByOrderByDisplayOrderAsc();
}
