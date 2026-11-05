# Third-party notices

The code in this repository is MIT licensed (see `LICENSE`). The following third-party material is bundled or used.

## Azure Architecture Icons (Microsoft)
`icons/icons.json` contains 101 SVG icons taken from Microsoft's official **Azure Architecture Icons** set
(https://learn.microsoft.com/azure/architecture/icons/). They are Microsoft's property and are used under
Microsoft's terms for the set, which allow use in architecture diagrams and documentation and forbid
cropping, flipping, rotating or distorting them. The MIT licence of this repository does not apply to them.
The icons are drawn unmodified (only their internal SVG ids are prefixed so they cannot collide).

## elkjs (EPL-2.0)
Layered and box layout of nested containers uses [elkjs](https://github.com/kieler/elkjs) 0.9.3 (Eclipse Public License 2.0),
a JavaScript build of the Eclipse Layout Kernel. It is bundled unmodified into the built HTML.

## esbuild (MIT)
Used at build time only.

## Inspiration
The idea of nested containers with typed edges was inspired by looking at existing Azure diagram tools such as
AzViz and ZureMap. No code from those projects was copied; this is an independent implementation.
