# WaypointMap Rewrite

Greenfield rewrite of the purchased WaypointMap product as:

- `apps/expo`: cross-platform client for `web`, `ios`, and `android`
- `server`: Java API for missions, KMZ workflows, and persistence

## What exists now

This repo starts with a reverse-engineered editor shell based on authenticated access to:

- legacy production editor `1.4.1S`
- advanced test editor `2.1.1RL`

It already models:

- selection shapes
- generated waypoint loops and grid passes
- per-waypoint editing for altitude, speed, gimbal, heading, and action
- advanced workflow tabs for `Simple`, `Advanced`, and `Download`
- import / undo / redo / reset affordances
- mission save/export surface
- parity notes for the features still not validated end-to-end

## Run the client

```bash
npm install
npm run dev:web
```

For native:

```bash
npm run dev:ios
npm run dev:android
```

## Run the server

The Java API is a Spring Boot app.

```bash
cd server
mvn spring-boot:run
```

## Current constraint

Authenticated access is now confirmed, but exact 1:1 parity still requires deeper flow capture for:

- real KMZ download payloads
- save/load network contracts
- premium-only behaviors
- auto-installer flows

The repo documents the remaining gap list in [docs/reverse-engineering.md](/Users/martinespinola/Documents/WaypointMap/docs/reverse-engineering.md).
