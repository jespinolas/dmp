package com.waypointmap.api.controller;

import com.waypointmap.api.model.UserEntity;
import com.waypointmap.api.repository.UserRepository;
import com.waypointmap.api.security.JwtUtil;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;

    public AuthController(UserRepository userRepository, PasswordEncoder passwordEncoder, JwtUtil jwtUtil) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtil = jwtUtil;
    }

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody Map<String, String> body) {
        String email = body.get("email");
        String password = body.get("password");

        if (email == null || email.isBlank() || password == null || password.length() < 4) {
            return ResponseEntity.badRequest().body(Map.of("error", "Email and password (min 4 chars) required"));
        }

        email = email.trim().toLowerCase();

        if (userRepository.existsByEmail(email)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Email already registered"));
        }

        UserEntity user = new UserEntity(email, passwordEncoder.encode(password));
        userRepository.save(user);

        String token = jwtUtil.generateToken(user.getEmail(), user.getId());
        return ResponseEntity.ok(Map.of(
                "token", token,
                "email", user.getEmail(),
                "userId", user.getId()
        ));
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> body) {
        String email = body.get("email");
        String password = body.get("password");

        if (email == null || email.isBlank() || password == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Email and password required"));
        }

        email = email.trim().toLowerCase();
        Optional<UserEntity> userOpt = userRepository.findByEmail(email);

        if (userOpt.isEmpty() || !passwordEncoder.matches(password, userOpt.get().getPasswordHash())) {
            return ResponseEntity.status(401).body(Map.of("error", "Invalid email or password"));
        }

        UserEntity user = userOpt.get();
        String token = jwtUtil.generateToken(user.getEmail(), user.getId());
        return ResponseEntity.ok(Map.of(
                "token", token,
                "email", user.getEmail(),
                "userId", user.getId()
        ));
    }
}
