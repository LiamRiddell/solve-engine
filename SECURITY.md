# Security policy

## Reporting a vulnerability

Report privately through GitHub's advisory form rather than opening a public
issue:

**https://github.com/LiamRiddell/solve-engine/security/advisories/new**

That keeps the report private until a fix exists, and gives you a place to
discuss it with a maintainer. Please do not open a public issue for a
vulnerability.

Expect an acknowledgement within a few days. If a report is valid you will be
credited in the advisory unless you would rather not be.

## Supported versions

Fixes land on the most recent release. While the project is in beta there is no
long-term support branch.

## What this package does and does not do

Worth knowing when assessing risk:

**It evaluates untrusted input by design.** The engine is built to run on text
as a person types it, so hostile or malformed input is the expected case rather
than an edge case. Expression length, parse complexity, instruction count and
stack depth are all bounded, and each limit produces a named error rather than
hanging. A way to bypass those bounds, or to make the engine consume unbounded
time or memory, is a legitimate report.

**It does not evaluate arbitrary code.** Expressions compile to a fixed
instruction set executed by a purpose-built virtual machine. There is no
`eval`, no dynamic code generation, and no access to the host environment from
an expression.

**It holds no credentials.** The engine never stores, transmits or logs a
secret, because it is never given one. The stocks and knowledge packages take a
fetching function supplied by the host rather than an API key, and neither is
registered by default: unconfigured, they return a `NOT_CONFIGURED` value rather
than a guess.

**One built-in package does reach the network.** Weather is part of the default
package set and calls Open-Meteo, a keyless public endpoint, when an expression
asks for a forecast. The city name in the expression is what gets sent. Nothing
else leaves the process, and no request happens unless an expression asks for
one. A host that wants no outbound traffic at all should assemble its package
list rather than using the built-in set.
