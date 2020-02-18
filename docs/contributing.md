# Contributing to Tab Stash

First of all, thanks for your interest in contributing to Tab Stash!  The best
way to get your new feature or bugfix included is to open a pull request in
GitHub.  Please make sure you've read and followed the *Code Style* section
below, and included adequate comments and notes in your commit message for
reviewers to understand what you're trying to do and why.

Importantly, *don't expect your pull request to be merged right away*.  You will
likely get at least one round of constructive feedback; this is to help catch
bugs and ensure the code stays maintainable for the next person who wants to
contribute.  I hope you will take this feedback in the spirit in which it's
given--as reflecting our shared desire to make Tab Stash the best it can
possibly be.

*-- Josh*

## Getting the Source Code

Tab Stash's source code is available
[on GitHub](https://github.com/josh-berry/tab-stash/).

## Building Tab Stash for Development

You must have [Node.js](https://nodejs.org/) installed, which provides the `npm`
command.  If you are on a UNIX-like system and you have GNU Make available, to
build and run the tests, just navigate to the top-level *tab-stash* directory
and run:

```sh
$ make
```

If you don't have GNU Make available and/or you're on Windows, run:

```sh
$ npm i
$ npm run build
$ npm run test
```

The result will be in the `dist` directory.  You can load it into your Firefox
by following these steps:

1. Open a new tab and go to `about:debugging`
2. Click on "*This Firefox*" in the sidebar.
3. Click "*Load Temporary Add-on*".
4. Browse to the `dist` directory, and select the `manifest.json` file.

## Building Tab Stash for Release

Linux and Mac only.  May only be done in a clean tree, and your HEAD commit must
be pointing at a release tag (or `make` will create one for you with the version
listed in `manifest.json`).  In the top-level *tab-stash* directory, run:

```sh
$ make rel
```

All generated files in `dist` will be rebuilt, with debugging information and
code stripped.  Two package files will be generated, both of which can be
uploaded to addons.mozilla.org--the first, `tab-stash-X.Y.zip`, is the actual
extension.  The second, `tab-stash-src-X.Y.tar.gz`, is the source to go along
with it.

## Code Style

- **Indentation:** Four spaces (no tabs) per indentation level.
- **Line Length:** No lines should be longer than 80 columns.
  - When wrapping, please line up your wrapped line with the relevant opening
    '(' or '[' on the previous line.  (Emacs does this correctly by default.)
  - If there's no grouping character to line up with, indent wrapped lines an
    additional four spaces.
- **Comments:** Where it's not immediately obvious, please write comments
  explaining *why* your code is doing what it's doing.  Use `//` comments, not
  `/* */` comments.
- **Variable Names:** Use your best judgment--the larger the scope, the more
  descriptive the name should be.  Single-letter variable names are fine if the
  contents/usage of the variable are obvious in context and the variable's scope
  fits on a single (small) screen.
  - *Constants* are written `LIKE_THIS`.
  - *Class Names* are written `LikeThis`.
  - *Function and Argument Names* are written `likeThis` for arguments and
    public functions or `like_this` for private functions.
  - *Local Variable Names* are written `like_this`.  Prefer `const` for local
    variables when possible, or `let` when necessary.  Don't use `var`.

The existing code does not always follow these guidelines consistently; if you
find inconsistencies, please feel free to correct them (but please submit
corrections in commits which are separate from functional changes).

## Editing Icons

We recommend [Inkscape](https://inkscape.org/en/).  Please be sure to follow the
Firefox [Photon Design Guide](https://design.firefox.com/photon/).
