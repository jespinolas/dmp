package com.waypointmap.api.model;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "missions")
public class MissionEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String waypointsJson;    // JSON array of waypoint objects

    @Column(length = 50)
    private String finalAction;      // "hover", "goHome", "autoLand"

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private UserEntity user;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();

    public MissionEntity() {}

    public MissionEntity(String name, String waypointsJson, String finalAction, UserEntity user) {
        this.name = name;
        this.waypointsJson = waypointsJson;
        this.finalAction = finalAction;
        this.user = user;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getWaypointsJson() { return waypointsJson; }
    public void setWaypointsJson(String waypointsJson) { this.waypointsJson = waypointsJson; }
    public String getFinalAction() { return finalAction; }
    public void setFinalAction(String finalAction) { this.finalAction = finalAction; }
    public UserEntity getUser() { return user; }
    public void setUser(UserEntity user) { this.user = user; }
    public Long getUserId() { return user != null ? user.getId() : null; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
