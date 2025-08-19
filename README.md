# Buk EventBus Navigator (VS Code)

CodeLens + commands to jump from Ruby event emitters to EventBus configuration and handlers.

- Adds CodeLens above `broadcast_success` / `workflow_event_success` in Ruby files:
  - "Open event config (bus_event.<emitter>.<suffix>)" opens matching `config/event_bus_subscriptions.yml` at the event.
  - "Open handlers" shows a list of handlers from all packs and opens the selected Ruby file.

## Development

- Install deps: `npm install`
- Build: `npm run compile`
- Press F5 in VS Code to launch Extension Development Host.

## How it works

- Computes event name from the enclosing class (e.g., `Vacacion::Create` → `vacacion/create`) and the call kind (`success` or `workflow_success`).
- Scans workspace for `**/config/event_bus_subscriptions.yml` and matches `event_name`.
- Resolves handler constants to file paths with a simple constant→path mapping.
