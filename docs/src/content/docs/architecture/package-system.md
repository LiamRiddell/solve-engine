---
title: The package system
description: Registration, isolation and version compatibility.
---

## Registration

A package declares what it contributes and is registered into shared registries.
Registration is ordered, and arithmetic goes first so later packages build on a
working operator set.

Registering a duplicate name is refused, because a silent overwrite would orphan
whatever the first registration contributed.

```mermaid Every check that stands between a package and a working engine.
sequenceDiagram
  participant App as Your code
  participant Engine as Engine
  participant Reg as Registries

  App->>Engine: register(package)
  Engine->>Engine: engine version in the declared range?
  alt out of range
    Engine-->>App: refused, naming both versions
  else in range
    Engine->>Reg: name already taken?
    alt taken
      Reg-->>App: refused, no silent overwrite
    else free
      Engine->>Reg: keywords, operators, units
      Engine->>Reg: parselets and token types
      Engine->>Reg: token categories
      Reg-->>Engine: warn on any token type two packages both claim
      Engine-->>App: registered
    end
  end
```

## Version compatibility

Each package declares the engine version range it was built against. The range
is checked at registration and an incompatible package is refused with a message
naming both versions, rather than failing later in a way that looks like a bug
in the package.

## Collision visibility

Two packages claiming the same token type would silently shadow each other. The
registry warns when that happens, naming both, because the failure is otherwise
extremely hard to diagnose.

## Configuration

A package that needs configuration is exposed as a factory rather than a
constant. This is how the stocks and knowledge packages take a fetching function
without the engine ever holding credentials.
