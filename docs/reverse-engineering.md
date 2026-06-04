# Reverse-Engineering Notes

Date audited: 2026-05-24

## Confirmed products

- The purchased product is an ASP.NET Core MVC app, not a public SPA.
- Production editor:
  - host: `https://www.waypointmap.com/Home/Editor`
  - footer version: `1.4.1S`
  - title: `Legacy WaypointMap Mission Editor`
- Advanced editor:
  - host: `https://test.waypointmap.com/Home/Editor`
  - footer version: `2.1.1RL`
  - title: `Advanced WaypointMap Mission Editor`

## Shared capabilities

- Both editors provide:
  - create custom shape selections
  - generate waypoint flight plans from a shape
  - save missions to account
  - export DJI `.KMZ`
  - satellite and street map layers
  - per-waypoint editing for:
    - altitude
    - speed
    - gimbal angle
    - heading
    - action

## Legacy production editor: `1.4.1S`

- Top bar includes:
  - location search
  - `Reset/Clear`
- Tooling includes:
  - polygon-like shape generation
  - rectangle-like shape selection
  - circle/POI generation
  - direct waypoint marker placement
- Settings surface includes:
  - units
  - altitude
  - speed
  - gimbal angle
  - distance between paths
  - action on completion
- Premium-gated legacy features:
  - dynamic altitude correction
  - generated waypoint actions
  - reverse flight path
  - line orientation
  - straighten flight paths
  - DJI `.KMZ` import
  - generate every point
  - image overlap controls
  - Windows KMZ installer
- Clicking a generated shape opens `Generate` and `Remove`.
- Clicking a waypoint opens an inspector for:
  - waypoint number
  - latitude and longitude
  - altitude
  - speed
  - gimbal angle
  - heading
  - action

## Advanced test editor: `2.1.1RL`

- Top action row includes:
  - location search
  - undo
  - redo
  - reset
  - premium KML/KMZ import
- Map tools include:
  - polygon
  - rectangle
  - POI
  - waypoint
  - select
- Workflow is split into:
  - `Simple`
  - `Advanced`
  - `Download`
- `Simple` tab:
  - quality slider
  - automatic overlap/spacings guidance
  - generate CTA
- `Advanced` tab:
  - searchable settings area
  - basics/coverage/camera/advanced sections
  - units, altitude, speed
  - preset saving
  - generation CTA
  - documented keybinds
- `Download` tab:
  - on-completion behavior
  - premium mission splitting
  - mission time estimate
  - download KMZ
  - Windows auto-installer download
  - mission save
- Includes a first-run onboarding tour.
- Offers a fallback link to the old production editor.

## Next rewrite target

- Default to the `2.1.1RL` advanced interaction model.
- Preserve legacy compatibility for:
  - old editor layout
  - legacy premium controls
  - older mission editing flow

## Remaining blockers to exact parity

- The exact KMZ serialization format still needs download inspection.
- Mission persistence and importer requests still need network capture.
- Premium-gated controls are visible, but not all can be exercised with the current account state.
- Automatic installer flows and multi-mission split behavior still need hands-on validation.

## Next inputs needed

- Network traces from key flows:
  - generate
  - save mission
  - import KMZ
  - download KMZ
- Example mission files:
  - output `.kmz`
  - imported DJI `.kmz`
  - any KML/KMZ samples used by the advanced editor
- Optional source bundle or deployment archive from the purchase
