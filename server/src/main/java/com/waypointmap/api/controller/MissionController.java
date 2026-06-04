package com.waypointmap.api.controller;

import com.waypointmap.api.model.MissionEntity;
import com.waypointmap.api.model.UserEntity;
import com.waypointmap.api.repository.MissionRepository;
import com.waypointmap.api.repository.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/missions")
public class MissionController {

    private final MissionRepository missionRepository;
    private final UserRepository userRepository;

    public MissionController(MissionRepository missionRepository, UserRepository userRepository) {
        this.missionRepository = missionRepository;
        this.userRepository = userRepository;
    }

    private UserEntity requireUser(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        if (userId == null) throw new RuntimeException("Not authenticated");
        return userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));
    }

    @GetMapping
    public ResponseEntity<?> listMissions(HttpServletRequest request) {
        UserEntity user = requireUser(request);
        List<MissionEntity> missions = missionRepository.findByUserOrderByUpdatedAtDesc(user);
        List<Map<String, Object>> result = new ArrayList<>();
        for (MissionEntity m : missions) {
            result.add(Map.of(
                    "id", m.getId(),
                    "name", m.getName(),
                    "finalAction", m.getFinalAction() != null ? m.getFinalAction() : "goHome",
                    "waypointCount", countWaypoints(m.getWaypointsJson()),
                    "createdAt", m.getCreatedAt().toString(),
                    "updatedAt", m.getUpdatedAt().toString()
            ));
        }
        return ResponseEntity.ok(result);
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getMission(@PathVariable Long id, HttpServletRequest request) {
        UserEntity user = requireUser(request);
        MissionEntity m = missionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Mission not found"));
        if (!m.getUser().getId().equals(user.getId())) {
            return ResponseEntity.status(403).body(Map.of("error", "Not your mission"));
        }
        return ResponseEntity.ok(Map.of(
                "id", m.getId(),
                "name", m.getName(),
                "finalAction", m.getFinalAction() != null ? m.getFinalAction() : "goHome",
                "waypoints", m.getWaypointsJson(),
                "createdAt", m.getCreatedAt().toString()
        ));
    }

    @PostMapping
    public ResponseEntity<?> saveMission(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        UserEntity user = requireUser(request);
        String name = (String) body.getOrDefault("name", "Untitled Mission");
        String finalAction = (String) body.getOrDefault("finalAction", "goHome");
        String waypointsJson = body.get("waypoints") instanceof String s ? s :
                body.get("waypoints") != null ? new com.fasterxml.jackson.databind.ObjectMapper()
                        .valueToTree(body.get("waypoints")).toString() : "[]";

        MissionEntity mission = new MissionEntity(name, waypointsJson, finalAction, user);
        missionRepository.save(mission);

        return ResponseEntity.ok(Map.of(
                "id", mission.getId(),
                "name", mission.getName(),
                "createdAt", mission.getCreatedAt().toString()
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> updateMission(@PathVariable Long id, @RequestBody Map<String, Object> body,
                                           HttpServletRequest request) {
        UserEntity user = requireUser(request);
        MissionEntity m = missionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Mission not found"));
        if (!m.getUser().getId().equals(user.getId())) {
            return ResponseEntity.status(403).body(Map.of("error", "Not your mission"));
        }

        if (body.containsKey("name")) m.setName((String) body.get("name"));
        if (body.containsKey("finalAction")) m.setFinalAction((String) body.get("finalAction"));
        if (body.containsKey("waypoints")) {
            String wps = body.get("waypoints") instanceof String s ? s :
                    new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(body.get("waypoints")).toString();
            m.setWaypointsJson(wps);
        }
        m.setUpdatedAt(Instant.now());
        missionRepository.save(m);

        return ResponseEntity.ok(Map.of("id", m.getId(), "name", m.getName(), "updated", true));
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<?> deleteMission(@PathVariable Long id, HttpServletRequest request) {
        UserEntity user = requireUser(request);
        MissionEntity m = missionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Mission not found"));
        if (!m.getUser().getId().equals(user.getId())) {
            return ResponseEntity.status(403).body(Map.of("error", "Not your mission"));
        }
        missionRepository.delete(m);
        return ResponseEntity.ok(Map.of("deleted", true));
    }

    private int countWaypoints(String json) {
        if (json == null || json.isBlank()) return 0;
        try {
            var list = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readValue(json, List.class);
            return list.size();
        } catch (Exception e) {
            return 0;
        }
    }
}
