package com.waypointmap.api.repository;

import com.waypointmap.api.model.MissionEntity;
import com.waypointmap.api.model.UserEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface MissionRepository extends JpaRepository<MissionEntity, Long> {
    List<MissionEntity> findByUserOrderByUpdatedAtDesc(UserEntity user);
    void deleteByUserAndId(UserEntity user, Long id);
}
