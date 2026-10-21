# Other Pitch v2 data contract

Static files under `/data/v2/`, produced by `python -m otherpitch.v2.build`.

- `scenes.json`: catalogue (scene_id, title, scenario_version, heldout, variants[{variant_id, status, run_id, label}]).
- `{scene}/{variant}/bundle.json`: the replay bundle the site consumes.
- `{scene}/{variant}/motion/{action_id}.json`: representative trajectory frames, loaded on demand.
- `{scene}/{variant}/trace.json`: sanitized RunTrace (steps and MCP tool calls).
- `{scene}/{variant}/validation.json`: QA status, claims checked, outcome-tree sums.
- `diagnostics/fault-injection-trace.json`: labelled diagnostic run.

Frames: `{t, ball:[x,y], p:{player_id:[x,y]}}` in metres, pitch 105 x 68, home attacks toward x = 105, t in seconds from the decision (lead-in frames have t < 0).

## bundle.json (shape)

```json
{
 "schema_version": "str",
 "bundle_id": "str",
 "scene_id": "str",
 "scenario_version": "str",
 "variant_id": "str",
 "title": "str",
 "brief": "str",
 "tactic": "str",
 "clock": "str",
 "score": {
  "home": "int",
  "away": "int"
 },
 "teams": {
  "home": {
   "id": "str",
   "name": "str",
   "short": "str",
   "color": "str"
  },
  "away": {
   "id": "str",
   "name": "str",
   "short": "str",
   "color": "str"
  }
 },
 "horizon_s": "float",
 "objective": "str",
 "provenance": "str"
}
```

## motion file (shape)

```json
{
 "action_id": "str",
 "variant_id": "str",
 "dt": "float",
 "kind": "str",
 "leaf": "str",
 "frames": [
  {
   "t": "float",
   "ball": [
    "float"
   ],
   "p": "{\u2026}"
  }
 ]
}
```
